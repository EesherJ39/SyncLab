# SyncLab

[![CI](https://github.com/EesherJ39/SyncLab/actions/workflows/ci.yml/badge.svg)](https://github.com/EesherJ39/SyncLab/actions/workflows/ci.yml)

SyncLab is a local-first collaborative editor that continues accepting edits
through a network outage, converges after reconnect, and keeps document
contents opaque to the relay server.

## Why this project exists

Most collaborative-editor demos assume an ordered, always-on connection.
SyncLab makes the failure cases visible: operations may be duplicated,
reordered, fragmented across WebSocket frames, or temporarily dropped. A
persisted outbox replays unconfirmed encrypted operations after reconnect, and
an operation-based RGA-style CRDT makes delivery idempotent.

## Architecture

```text
React editor -> RGA/checklist CRDT -> AES-256-GCM -> persisted outbox
                                                       |
                                                       v
                                       ASP.NET Core WebSocket relay
                                                       |
                                                       v
                                      ordered encrypted room history
```

- **Client:** React + TypeScript, CRDT state machine, Web Crypto, local history,
  offline outbox, reconnect, and timeline replay.
- **Relay:** ASP.NET Core WebSockets with bounded fragmented-message assembly,
  per-socket send serialization, per-room broadcast ordering, and monotonic
  server sequence numbers.
- **Privacy model:** the room key lives in the URL fragment, which browsers do
  not send in HTTP or WebSocket requests. The server receives ciphertext,
  IVs, sender identifiers, room identifiers, and timing metadata.

## Verification

The repository includes three complementary checks:

```bash
# TypeScript regression tests for out-of-order dependencies and idempotency
cd frontend
npm ci
npm test
npm run build

# Deterministic convergence stress test
cd ..
python tests/fuzz_crdt.py

# WebSocket ordering/broadcast integration test (server must be running)
python -m pip install -r tests/requirements.txt
python tests/chaos_ws.py
```

The deterministic stress configuration uses 200 trials, 250 operations per
trial, five replicas, 20% temporary loss, and 10% duplicate delivery. Every
replica then receives a shuffled anti-entropy pass; the test verifies identical
materialized state after 250,000 replica-operation observations. This is a
correctness workload, not a claim about internet latency or production scale.

## Run locally

Requirements: .NET 8+, Node.js 20+, npm, and Python 3.11+ for the optional
stress/integration tests.

```bash
# Terminal 1: relay
dotnet run --project backend/SyncLab.Server/SyncLab.Server.csproj

# Terminal 2: client
cd frontend
npm ci
npm run dev
```

Open the Vite URL, choose **Start demo room**, then open the copied URL in a
second browser profile. The encryption key stays after `#` in the shared URL.

## Failure cases covered

- Child insert arriving before its parent
- Delete arriving before the target insert
- Checklist mutation arriving before item creation
- Duplicate operation delivery
- Temporary packet loss followed by reconnect/anti-entropy
- WebSocket messages split across frames
- Concurrent senders racing to broadcast into one room
- Browser refresh with unconfirmed local edits

## Current boundaries

This is an engineering prototype, not a production service. Room history is
in memory on the server, there is no authentication or authorization, the
client retains only its latest 5,000 events, and the relay sees traffic
metadata. Production hardening would add durable append-only storage,
authenticated membership, snapshot compaction, key rotation, observability,
and multi-node room ownership.
