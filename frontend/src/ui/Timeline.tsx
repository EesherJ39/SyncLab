import React from "react";
import { StoredEvent } from "../crdt/storage";

export default function Timeline(props: {
  events: StoredEvent[];
  slider: number;
  setSlider: (n: number) => void;
}) {
  const n = props.events.length;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="badge">Events: {n}</span>
        <span className="badge">Replay: {props.slider}/{n}</span>
      </div>

      <input
        type="range"
        min={0}
        max={n}
        value={props.slider}
        onChange={(e) => props.setSlider(Number(e.target.value))}
        style={{ marginTop: 10 }}
      />

      <div style={{ marginTop: 10, maxHeight: 360, overflow: "auto" }}>
        {props.events.slice(-50).map((e, idx) => (
          <div key={`${e.seq}-${idx}`} style={{ padding: "8px 0" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <small>seq: <span style={{ fontFamily: "monospace" }}>{e.seq}</span></small>
              <small>sender: <span style={{ fontFamily: "monospace" }}>{e.sender}</span></small>
            </div>
            <small>ct bytes: {Math.round((e.ct.length * 3) / 4)}</small>
            <hr />
          </div>
        ))}
      </div>
    </div>
  );
}