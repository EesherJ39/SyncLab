using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using SyncLab.Server.Models;

namespace SyncLab.Server.Services;

public sealed class WsHub
{
    private readonly RoomStore _store;
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<WebSocket, byte>> _roomSockets = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _roomBroadcastLocks = new();
    private readonly ConcurrentDictionary<WebSocket, SemaphoreSlim> _sendLocks = new();
    private const int MaxMessageBytes = 256 * 1024;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public WsHub(RoomStore store) => _store = store;

    public async Task HandleAsync(HttpContext ctx)
    {
        if (!ctx.WebSockets.IsWebSocketRequest)
        {
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsync("WebSocket only.");
            return;
        }

        var roomId = ctx.Request.Query["roomId"].ToString();
        var sender = ctx.Request.Query["sender"].ToString();

        if (string.IsNullOrWhiteSpace(roomId))
        {
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsync("Missing roomId.");
            return;
        }
        if (string.IsNullOrWhiteSpace(sender))
            sender = "anonymous";

        var ws = await ctx.WebSockets.AcceptWebSocketAsync();
        var room = _roomSockets.GetOrAdd(roomId, _ => new ConcurrentDictionary<WebSocket, byte>());
        _sendLocks.TryAdd(ws, new SemaphoreSlim(1, 1));

        // Join atomically with respect to room broadcasts: history is delivered
        // before this socket becomes eligible for new messages, so sequence
        // numbers cannot be observed out of order during connection setup.
        var roomLock = _roomBroadcastLocks.GetOrAdd(roomId, _ => new SemaphoreSlim(1, 1));
        await roomLock.WaitAsync(ctx.RequestAborted);
        try
        {
            var snapshot = _store.GetSnapshot(roomId);
            foreach (var msg in snapshot)
                await SendAsync(ws, msg);
            room.TryAdd(ws, 0);
        }
        finally
        {
            roomLock.Release();
        }

        // simple anti-abuse limit per connection
        var msgCount = 0;
        const int maxMsgs = 5000;

        try
        {
            while (ws.State == WebSocketState.Open)
            {
                var payload = await ReceiveTextMessageAsync(ws, ctx.RequestAborted);
                if (payload is null) break;
                var cmsg = JsonSerializer.Deserialize<ClientMsg>(payload, JsonOpts);
                if (cmsg is null || cmsg.t != "op") continue;

                msgCount++;
                if (msgCount > maxMsgs)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Rate limit", CancellationToken.None);
                    break;
                }

                // server stores and broadcasts encrypted blobs
                await roomLock.WaitAsync(ctx.RequestAborted);
                try
                {
                    var smsg = _store.Append(roomId, cmsg);
                    await BroadcastAsync(roomId, smsg);
                }
                finally
                {
                    roomLock.Release();
                }
            }
        }
        finally
        {
            room.TryRemove(ws, out _);
            if (_sendLocks.TryRemove(ws, out var sendLock)) sendLock.Dispose();
            try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
            ws.Dispose();
        }
    }

    private async Task BroadcastAsync(string roomId, ServerMsg msg)
    {
        if (!_roomSockets.TryGetValue(roomId, out var sockets)) return;

        var tasks = sockets.Keys.Select(async s =>
        {
            if (s.State != WebSocketState.Open) return;
            await SendAsync(s, msg);
        });

        await Task.WhenAll(tasks);
    }

    private async Task SendAsync(WebSocket ws, ServerMsg msg)
    {
        var json = JsonSerializer.Serialize(msg, JsonOpts);
        var bytes = Encoding.UTF8.GetBytes(json);
        var sendLock = _sendLocks.GetOrAdd(ws, _ => new SemaphoreSlim(1, 1));
        await sendLock.WaitAsync();
        try
        {
            if (ws.State == WebSocketState.Open)
                await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
        }
        finally
        {
            sendLock.Release();
        }
    }

    private static async Task<string?> ReceiveTextMessageAsync(WebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();

        while (true)
        {
            WebSocketReceiveResult result;
            try
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
            }
            catch (OperationCanceledException)
            {
                return null;
            }

            if (result.MessageType == WebSocketMessageType.Close) return null;
            if (result.MessageType != WebSocketMessageType.Text)
            {
                await ws.CloseAsync(WebSocketCloseStatus.InvalidMessageType, "Text messages only", CancellationToken.None);
                return null;
            }
            if (message.Length + result.Count > MaxMessageBytes)
            {
                await ws.CloseAsync(WebSocketCloseStatus.MessageTooBig, "Message too large", CancellationToken.None);
                return null;
            }

            message.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
                return Encoding.UTF8.GetString(message.GetBuffer(), 0, checked((int)message.Length));
        }
    }
}
