# WebSocket relay benchmark

Recorded on 2026-09-22 against the actual ASP.NET Core `SyncLab.Server` WebSocket endpoint at `/ws`, at source commit `aadeb72`. The server ran in Docker Desktop 29.6.1 with `mcr.microsoft.com/dotnet/sdk:8.0` (.NET SDK 8.0.425). The Node.js 24.19.0 benchmark client ran on the same Mac: Apple M3 Pro, 11 logical CPUs, 18 GiB RAM, macOS Darwin arm64 24.6.0. Docker published server port 8080 to `127.0.0.1:18080`. This is a local relay benchmark, not an internet latency measurement.

## What was timed

Four WebSocket clients sent unique, synthetic ciphertext-shaped operations to one room. The relay assigned sequence numbers and broadcast each operation to those four clients plus one observer. A **distinct message** is one client operation submitted to the server. A **socket delivery** is one copy received by one client; therefore 4,000 messages to five clients produce 20,000 deliveries.

The client prepares its 120-byte-body base64 payloads before timing. After all five sockets open, it waits 50 ms for room registration, then starts a monotonic clock immediately before submitting the first operation. The clock stops when **every** client has received the full ordered sequence. Each client checks contiguous sequence numbers and unique ciphertext. All sockets remain open another 100 ms to catch late duplicates. Server startup, connection setup, that 50 ms wait, payload preparation, the 100 ms duplicate check, browser rendering, CRDT processing, and encryption are outside the timed interval. Each trial uses a new room.

## Results

| Workload | Trial times (ms) | Median (ms) | Delivery check | Raw data |
|---|---:|---:|---|---|
| 4,000 distinct messages / 20,000 deliveries, initial run after 400-message warmup | 196.04, 135.48, 111.38 | **135.48** | 5/5 clients: 4,000 ordered, unique; zero missing or duplicates per trial | [JSON](benchmarks/2026-09-22-20k-deliveries-initial.json) |
| Same workload, immediately repeated on the running server | 109.94, 121.12, 97.85 | **109.94** | 5/5 clients: 4,000 ordered, unique; zero missing or duplicates per trial | [JSON](benchmarks/2026-09-22-20k-deliveries-warmed.json) |
| 20,000 distinct messages / 100,000 deliveries, on the same running server | 386.99, 347.83, 369.48 | **369.48** | 5/5 clients: 20,000 ordered, unique; zero missing or duplicates per trial | [JSON](benchmarks/2026-09-22-20k-messages.json) |

The 20,000-delivery workload sometimes completed below 130 ms once the server was warm. The **20,000-distinct-message** workload did not: its fastest recorded trial was 347.83 ms. A claim of “20,000 messages in 130 ms” would be ambiguous and would overstate these results if read as 20,000 distinct client operations. Timings varied even on the same machine and should not be presented as a production service-level guarantee.

## Repeat the test

From the repository root, start the actual server with .NET 8 and keep it running. The recorded setup used Docker:

```bash
docker run --rm -p 127.0.0.1:18080:8080 -v "$PWD":/src -w /src mcr.microsoft.com/dotnet/sdk:8.0 dotnet run --project backend/SyncLab.Server/SyncLab.Server.csproj
```

In a second terminal, use Node.js 24+ (native `WebSocket` support) and run the same warmup and workloads:

```bash
SYNCLAB_WS_URL=ws://127.0.0.1:18080/ws MESSAGES=400 SENDERS=4 TRIALS=1 node tests/benchmark_ws.mjs > /dev/null
SYNCLAB_WS_URL=ws://127.0.0.1:18080/ws MESSAGES=4000 SENDERS=4 TRIALS=3 OUTPUT_PATH=/tmp/synclab-20k-deliveries-initial.json node tests/benchmark_ws.mjs
SYNCLAB_WS_URL=ws://127.0.0.1:18080/ws MESSAGES=4000 SENDERS=4 TRIALS=3 OUTPUT_PATH=/tmp/synclab-20k-deliveries-warmed.json node tests/benchmark_ws.mjs
SYNCLAB_WS_URL=ws://127.0.0.1:18080/ws MESSAGES=20000 SENDERS=4 TRIALS=3 OUTPUT_PATH=/tmp/synclab-20k-messages.json node tests/benchmark_ws.mjs
```

`OUTPUT_PATH` is optional; the script always prints JSON. `TIMEOUT_MS` defaults to 120,000. At least four senders are required for the 20,000-message run because the server permits at most 5,000 incoming messages per socket. Repeating the commands should reproduce the method and delivery checks, but elapsed time depends on machine load, runtime warmup, and scheduling.
