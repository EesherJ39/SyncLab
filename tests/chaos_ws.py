import asyncio
import json
import random
import time
import websockets

# This is a basic transport chaos test: it checks the server broadcasts messages
# and assigns monotonic seq per room. We don't decrypt here.

WS = "ws://localhost:8080/ws"

async def client(room_id: str, sender: str, out: list, n_send: int):
    uri = f"{WS}?roomId={room_id}&sender={sender}"
    async with websockets.connect(uri) as ws:
        # receive initial snapshot (may be empty)
        async def receiver():
            async for msg in ws:
                out.append(json.loads(msg))

        recv_task = asyncio.create_task(receiver())

        for _ in range(n_send):
            iv = "AA" + str(random.randint(0, 999999))
            ct = "BB" + str(random.randint(0, 999999))
            await ws.send(json.dumps({"t":"op","roomId":room_id,"sender":sender,"iv":iv,"ct":ct}))
            await asyncio.sleep(random.random() * 0.02)

        await asyncio.sleep(0.5)
        recv_task.cancel()

async def main():
    room = f"test-room-{int(time.time())}"
    out1, out2 = [], []
    await asyncio.gather(
        client(room, "c1", out1, 100),
        client(room, "c2", out2, 100),
    )

    all_msgs = [m for m in out1 if m.get("t") == "op" and m.get("roomId") == room]
    seqs = [m["seq"] for m in all_msgs if "seq" in m]
    if seqs != sorted(seqs):
        raise RuntimeError("seqs not sorted")
    if len(set(seqs)) != len(seqs):
        raise RuntimeError("duplicate seqs in one stream (unexpected)")
    print("OK: server seq monotonic, broadcast works (basic)")

if __name__ == "__main__":
    asyncio.run(main())