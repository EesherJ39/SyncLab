using System.Collections.Concurrent;
using SyncLab.Server.Models;

namespace SyncLab.Server.Services;

public sealed class RoomStore
{
    private sealed class RoomState
    {
        public long NextSeq = 1;
        public readonly List<ServerMsg> Log = new();
        public readonly object Gate = new();
    }

    private readonly ConcurrentDictionary<string, RoomState> _rooms = new();

    private RoomState GetRoom(string roomId) =>
        _rooms.GetOrAdd(roomId, _ => new RoomState());

    public IReadOnlyList<ServerMsg> GetSnapshot(string roomId, int max = 500)
    {
        var r = GetRoom(roomId);
        lock (r.Gate)
        {
            var start = Math.Max(0, r.Log.Count - max);
            return r.Log.Skip(start).ToList();
        }
    }

    public ServerMsg Append(string roomId, ClientMsg cmsg)
    {
        var r = GetRoom(roomId);
        lock (r.Gate)
        {
            var msg = new ServerMsg(
                t: "op",
                roomId: roomId,
                seq: r.NextSeq++,
                sender: cmsg.sender,
                iv: cmsg.iv,
                ct: cmsg.ct,
                tsMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            );
            r.Log.Add(msg);
            return msg;
        }
    }
}