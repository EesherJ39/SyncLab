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
        room.TryAdd(ws, 0);

        // send recent history
        var snapshot = _store.GetSnapshot(roomId);
        foreach (var msg in snapshot)
            await SendAsync(ws, msg);

        // simple anti-abuse limit per connection
        var msgCount = 0;
        const int maxMsgs = 5000;

        try
        {
            var buf = new byte[1024 * 64];
            while (ws.State == WebSocketState.Open)
            {
                var res = await ws.ReceiveAsync(buf, CancellationToken.None);
                if (res.MessageType == WebSocketMessageType.Close) break;

                var payload = Encoding.UTF8.GetString(buf, 0, res.Count);
                var cmsg = JsonSerializer.Deserialize<ClientMsg>(payload, JsonOpts);
                if (cmsg is null || cmsg.t != "op") continue;

                msgCount++;
                if (msgCount > maxMsgs)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Rate limit", CancellationToken.None);
                    break;
                }

                // server stores and broadcasts encrypted blobs
                var smsg = _store.Append(roomId, cmsg);
                await BroadcastAsync(roomId, smsg);
            }
        }
        finally
        {
            room.TryRemove(ws, out _);
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

    private static async Task SendAsync(WebSocket ws, ServerMsg msg)
    {
        var json = JsonSerializer.Serialize(msg, JsonOpts);
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }
}