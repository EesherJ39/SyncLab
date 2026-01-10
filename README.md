# SyncLab (MVP)
A local-first collaborative app with:
- CRDT doc model (text + checklist)
- Offline mode + outbox replay
- End-to-end encryption (AES-GCM) where the server stores only encrypted blobs
- WebSocket sync gateway (ASP.NET Core)
- Timeline replay slider (time travel by reapplying ops)

## Quick start (dev)
### Backend
```bash
cd backend/SyncLab.Server
dotnet restore
dotnet run