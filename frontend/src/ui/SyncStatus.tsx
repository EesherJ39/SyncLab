import React from "react";

export type SyncStatusState = {
  label: string;
  tone: "idle" | "synced" | "syncing" | "offline";
};

export function getSyncStatus(
  roomReady: boolean,
  online: boolean,
  connected: boolean,
  pendingCount: number,
): SyncStatusState {
  if (!roomReady) return { label: "No room selected", tone: "idle" };

  const changes = `${pendingCount} ${pendingCount === 1 ? "change" : "changes"}`;
  if (pendingCount > 0) {
    if (!online) return { label: `${changes} saved locally`, tone: "offline" };
    if (connected) return { label: `Syncing ${changes}…`, tone: "syncing" };
    return { label: `${changes} waiting to sync`, tone: "syncing" };
  }

  if (!online) return { label: "Offline — changes will be saved locally", tone: "offline" };
  if (connected) return { label: "All changes synced", tone: "synced" };
  return { label: "Connecting…", tone: "syncing" };
}

export default function SyncStatus(props: {
  roomReady: boolean;
  online: boolean;
  connected: boolean;
  pendingCount: number;
}) {
  const status = getSyncStatus(
    props.roomReady,
    props.online,
    props.connected,
    props.pendingCount,
  );

  return (
    <span
      className={`badge sync-status sync-status--${status.tone}`}
      role="status"
      aria-live="polite"
    >
      <span className="sync-status__dot" aria-hidden="true" />
      {status.label}
    </span>
  );
}
