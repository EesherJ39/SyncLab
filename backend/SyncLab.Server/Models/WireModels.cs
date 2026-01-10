namespace SyncLab.Server.Models;

// Client -> Server over WS
public sealed record ClientMsg(
    string t,         // "op"
    string roomId,
    string sender,    // deviceId
    string iv,        // base64
    string ct         // base64 (ciphertext+tag)
);

// Server -> Client over WS
public sealed record ServerMsg(
    string t,         // "op" or "hello"
    string roomId,
    long seq,
    string sender,
    string iv,
    string ct,
    long tsMs
);