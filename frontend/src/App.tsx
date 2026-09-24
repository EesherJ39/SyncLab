import React, { useEffect, useMemo, useRef, useState } from "react";
import { CRDT } from "./crdt/crdt";
import { decodeBatch, encodeBatch } from "./crdt/codec";
import { decrypt, encrypt, importRoomKey, randomKeyB64u } from "./crdt/crypto";
import { getOrCreateDeviceId, loadRoomLog, saveRoomLog, StoredEvent } from "./crdt/storage";
import Editor from "./ui/Editor";
import Checklist from "./ui/Checklist";
import Timeline from "./ui/Timeline";
import NetworkToggle from "./ui/NetworkToggle";
import SyncStatus from "./ui/SyncStatus";

type WsServerMsg = {
  t: "op";
  roomId: string;
  seq: number;
  sender: string;
  iv: string;
  ct: string;
  tsMs: number;
};

const WS_BASE = "ws://localhost:8080/ws";

function parseRoomFromUrl(): { roomId: string | null; key: string | null } {
  const u = new URL(location.href);
  const roomId = u.searchParams.get("room");
  const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
  const key = hash.get("key");
  return { roomId, key };
}

function setUrl(roomId: string, key: string) {
  const u = new URL(location.href);
  u.searchParams.set("room", roomId);
  u.hash = `key=${key}`;
  history.replaceState(null, "", u.toString());
}

export default function App() {
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [keyB64u, setKeyB64u] = useState<string | null>(null);
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);

  const [online, setOnline] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [slider, setSlider] = useState<number>(0); // 0..events.length
  const [live, setLive] = useState(true);          // slider at end

  const wsRef = useRef<WebSocket | null>(null);
  const outboxRef = useRef<StoredEvent[]>([]);

  const crdtRef = useRef<CRDT | null>(null);
  const [viewText, setViewText] = useState("");
  const [viewChecklist, setViewChecklist] = useState<{ itemId: string; text: string; done: boolean }[]>([]);

  // init from URL
  useEffect(() => {
    const p = parseRoomFromUrl();
    if (p.roomId && p.key) {
      setRoomId(p.roomId);
      setKeyB64u(p.key);
    }
  }, []);

  // import key
  useEffect(() => {
    (async () => {
      if (!keyB64u) return;
      const k = await importRoomKey(keyB64u);
      setRoomKey(k);
    })();
  }, [keyB64u]);

  // load log + init CRDT for room
  useEffect(() => {
    if (!roomId) return;
    const log = loadRoomLog(roomId);
    setEvents(log);
    outboxRef.current = log.filter(e => e.seq < 0);
    setSlider(log.length);
    setLive(true);

    crdtRef.current = new CRDT(deviceId);
  }, [roomId, deviceId]);

  // Follow incoming operations only while the user is at the live edge. A
  // historical timeline position remains stable as new operations arrive.
  useEffect(() => {
    if (live) setSlider(events.length);
  }, [events.length, live]);

  // apply events up to slider (time travel)
  useEffect(() => {
    (async () => {
      if (!roomId || !roomKey) return;
      const crdt = new CRDT(deviceId);
      // replay first slider events
      const prefix = events.slice(0, slider);
      for (const e of prefix) {
        const pt = await decrypt(roomKey, e.iv, e.ct);
        const batch = decodeBatch(pt);
        crdt.applyBatch(batch);
      }
      crdtRef.current = crdt;

      const st = crdt.getState();
      setViewText(st.text);
      setViewChecklist(st.checklist.map(i => ({ itemId: i.itemId, text: i.text, done: i.done })));

    })();
  }, [roomId, roomKey, events, slider, deviceId]);

  // connect WS
  useEffect(() => {
    if (!roomId || !roomKey) return;
    if (!online) return;

    let disposed = false;
    let reconnectTimer: number | undefined;
    const ws = new WebSocket(`${WS_BASE}?roomId=${encodeURIComponent(roomId)}&sender=${encodeURIComponent(deviceId)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // flush outbox
      for (const ev of outboxRef.current) {
        ws.send(JSON.stringify({ t: "op", roomId, sender: deviceId, iv: ev.iv, ct: ev.ct }));
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!disposed && online) {
        reconnectTimer = window.setTimeout(
          () => setConnectionAttempt(attempt => attempt + 1),
          400 + Math.floor(Math.random() * 300),
        );
      }
    };

    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data) as WsServerMsg;
      if (msg.t !== "op") return;

      setEvents(prev => {
        // de-dupe by seq
        if (prev.some(e => e.seq === msg.seq)) return prev;
        const confirmed: StoredEvent = {
          seq: msg.seq,
          sender: msg.sender,
          iv: msg.iv,
          ct: msg.ct,
          tsMs: msg.tsMs,
        };
        const placeholder = prev.findIndex(e =>
          e.seq < 0 && e.sender === msg.sender && e.iv === msg.iv && e.ct === msg.ct
        );
        const next = [...prev];
        if (placeholder >= 0) next.splice(placeholder, 1, confirmed);
        else next.push(confirmed);
        next.sort((a, b) => a.seq - b.seq);
        outboxRef.current = outboxRef.current.filter(e =>
          !(e.sender === msg.sender && e.iv === msg.iv && e.ct === msg.ct)
        );
        if (roomId) saveRoomLog(roomId, next);
        return next;
      });
    };

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      try { ws.close(); } catch {}
    };
  }, [roomId, roomKey, online, deviceId, connectionAttempt]);

  async function sendBatch(batchBytes: Uint8Array) {
    if (!roomId || !roomKey) return;
    const { ivB64, ctB64 } = await encrypt(roomKey, batchBytes);

    // local placeholder event: seq negative
    const localEvent: StoredEvent = {
      seq: -(Date.now()),
      sender: deviceId,
      iv: ivB64,
      ct: ctB64,
      tsMs: Date.now()
    };

    // Persist before attempting transport so a refresh or disconnect cannot
    // discard an acknowledged-local edit. The server echo replaces this
    // negative-sequence placeholder with its canonical sequence number.
    outboxRef.current.push(localEvent);
    setEvents(prev => {
      const next = [...prev, localEvent];
      if (roomId) saveRoomLog(roomId, next);
      return next;
    });

    if (online && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ t: "op", roomId, sender: deviceId, iv: ivB64, ct: ctB64 }));
    }
  }

  function startDemoRoom() {
    const rid = crypto.randomUUID();
    const k = randomKeyB64u();
    setUrl(rid, k);
    setRoomId(rid);
    setKeyB64u(k);
  }

  const crdt = crdtRef.current;
  const pendingCount = events.filter(event => event.seq < 0).length;

  return (
    <div style={{ padding: 18, maxWidth: 1200, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>SyncLab</h2>
        <SyncStatus
          roomReady={Boolean(roomId && roomKey)}
          online={online}
          connected={connected}
          pendingCount={pendingCount}
        />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row">
          <button onClick={startDemoRoom}>Start demo room</button>
          <div>
            <div><small>Room</small></div>
            <div style={{ fontFamily: "monospace" }}>{roomId ?? "(none)"}</div>
          </div>
          <div>
            <div><small>Device</small></div>
            <div style={{ fontFamily: "monospace" }}>{deviceId}</div>
          </div>
          <NetworkToggle online={online} setOnline={setOnline} />
          <div style={{ flex: 1 }} />
          <div>
            <small>Share this URL (key is in #fragment)</small><br />
            <a href={location.href} style={{ fontFamily: "monospace" }}>{location.href}</a>
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Document</h3>
          <Editor
            value={viewText}
            live={live}
            onEdit={async (nextText, meta) => {
              if (!crdt) return;
              // minimal diff: prefix/suffix + mid insert/delete
              const prev = crdt.getState().text;
              const { start, delCount, insText } = meta.diff(prev, nextText);

              if (delCount > 0) {
                const b = crdt.localDelete(start, delCount);
                await sendBatch(encodeBatch(b));
              }
              if (insText.length > 0) {
                const b = crdt.localInsert(start, insText);
                await sendBatch(encodeBatch(b));
              }

              const st = crdt.getState();
              setViewText(st.text);
            }}
          />
          <hr />
          <Checklist
            items={viewChecklist}
            live={live}
            onAdd={async (text) => {
              if (!crdt) return;
              const b = crdt.localCheckAdd(text);
              await sendBatch(encodeBatch(b));
              setViewChecklist(crdt.getState().checklist.map(i => ({ itemId: i.itemId, text: i.text, done: i.done })));
            }}
            onToggle={async (itemId, done) => {
              if (!crdt) return;
              const b = crdt.localCheckToggle(itemId, done);
              await sendBatch(encodeBatch(b));
              setViewChecklist(crdt.getState().checklist.map(i => ({ itemId: i.itemId, text: i.text, done: i.done })));
            }}
            onRemove={async (itemId) => {
              if (!crdt) return;
              const b = crdt.localCheckRemove(itemId);
              await sendBatch(encodeBatch(b));
              setViewChecklist(crdt.getState().checklist.map(i => ({ itemId: i.itemId, text: i.text, done: i.done })));
            }}
          />
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Replay timeline</h3>
          <Timeline
            events={events}
            slider={slider}
            setSlider={(value) => {
              setSlider(value);
              setLive(value === events.length);
            }}
          />
          <hr />
          <small>
            Tip: drag the slider back, then keep editing in another tab.
            When you return to the end, you’ll see the merged end-state.
          </small>
        </div>
      </div>
    </div>
  );
}
