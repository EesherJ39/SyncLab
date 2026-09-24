import { describe, expect, it } from "vitest";
import { getSyncStatus } from "./SyncStatus";

describe("sync status", () => {
  it("reports confirmed work as synced", () => {
    expect(getSyncStatus(true, true, true, 0)).toEqual({
      label: "All changes synced",
      tone: "synced",
    });
  });

  it("reports offline work as safely stored", () => {
    expect(getSyncStatus(true, false, false, 2)).toEqual({
      label: "2 changes saved locally",
      tone: "offline",
    });
  });

  it("reports pending work while connected", () => {
    expect(getSyncStatus(true, true, true, 1)).toEqual({
      label: "Syncing 1 change…",
      tone: "syncing",
    });
  });

  it("reports pending work while reconnecting", () => {
    expect(getSyncStatus(true, true, false, 3)).toEqual({
      label: "3 changes waiting to sync",
      tone: "syncing",
    });
  });
});
