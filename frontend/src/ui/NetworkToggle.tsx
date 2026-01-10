import React from "react";

export default function NetworkToggle(props: { online: boolean; setOnline: (v: boolean) => void }) {
  return (
    <div className="row">
      <span className="badge">Network: {props.online ? "online" : "offline"}</span>
      <button onClick={() => props.setOnline(!props.online)}>
        Toggle
      </button>
    </div>
  );
}