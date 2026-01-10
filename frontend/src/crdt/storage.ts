// Simple local storage for deviceId + op log (JSONL-like).
// For a recruiter demo, localStorage is enough; swap to IndexedDB later.

export type StoredEvent = {
  seq: number;      // server assigned seq, or negative for local-only
  sender: string;
  iv: string;
  ct: string;
  tsMs: number;
};

const DEV_ID_KEY = "synclab_device_id";

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEV_ID_KEY);
  if (!id) {
    id = `dev-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
    localStorage.setItem(DEV_ID_KEY, id);
  }
  return id;
}

export function loadRoomLog(roomId: string): StoredEvent[] {
  const k = `synclab_room_${roomId}_log`;
  const raw = localStorage.getItem(k);
  if (!raw) return [];
  try { return JSON.parse(raw) as StoredEvent[]; } catch { return []; }
}

export function saveRoomLog(roomId: string, events: StoredEvent[]) {
  const k = `synclab_room_${roomId}_log`;
  localStorage.setItem(k, JSON.stringify(events.slice(-5000)));
}