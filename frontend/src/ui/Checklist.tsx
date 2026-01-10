import React, { useState } from "react";

export default function Checklist(props: {
  items: { itemId: string; text: string; done: boolean }[];
  live: boolean;
  onAdd: (text: string) => void;
  onToggle: (itemId: string, done: boolean) => void;
  onRemove: (itemId: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <div>
      <h4 style={{ margin: "10px 0" }}>Checklist</h4>

      <div className="row">
        <input
          value={text}
          disabled={!props.live}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add item…"
        />
        <button
          disabled={!props.live || text.trim().length === 0}
          onClick={() => { props.onAdd(text.trim()); setText(""); }}
        >
          Add
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        {props.items.length === 0 && <small>(empty)</small>}
        {props.items.map(it => (
          <div key={it.itemId} className="row" style={{ padding: "6px 0" }}>
            <input
              type="checkbox"
              checked={it.done}
              disabled={!props.live}
              onChange={(e) => props.onToggle(it.itemId, e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <div style={{ flex: 1, textDecoration: it.done ? "line-through" : "none" }}>
              {it.text}
              <div><small style={{ fontFamily: "monospace" }}>{it.itemId}</small></div>
            </div>
            <button disabled={!props.live} onClick={() => props.onRemove(it.itemId)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}