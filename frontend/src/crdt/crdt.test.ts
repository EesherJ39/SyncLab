import { describe, expect, it } from "vitest";
import { CRDT } from "./crdt";
import type { Batch, Op } from "./types";

const batch = (...ops: Op[]): Batch => ({ v: 1, ops });

describe("CRDT convergence", () => {
  it("replays a child delivered before its parent", () => {
    const replica = new CRDT("reader");
    replica.applyBatch(batch(
      { type: 1, opId: "b:2", nodeId: "b:2", prevId: "a:1", ch: 66 },
      { type: 1, opId: "a:1", nodeId: "a:1", prevId: "HEAD", ch: 65 },
    ));

    expect(replica.getState().text).toBe("AB");
  });

  it("applies a delete delivered before its target insert", () => {
    const replica = new CRDT("reader");
    replica.applyBatch(batch(
      { type: 2, opId: "b:2", targetId: "a:1" },
      { type: 1, opId: "a:1", nodeId: "a:1", prevId: "HEAD", ch: 65 },
    ));

    expect(replica.getState().text).toBe("");
  });

  it("buffers checklist mutations until the item arrives", () => {
    const replica = new CRDT("reader");
    replica.applyBatch(batch(
      { type: 4, opId: "b:2", itemId: "a:1", done: true },
      { type: 3, opId: "a:1", itemId: "a:1", text: "Ship it" },
    ));

    expect(replica.getState().checklist).toEqual([
      { itemId: "a:1", text: "Ship it", done: true, removed: false },
    ]);
  });

  it("is idempotent under duplicate delivery", () => {
    const replica = new CRDT("reader");
    const insert: Op = { type: 1, opId: "a:1", nodeId: "a:1", prevId: "HEAD", ch: 65 };
    replica.applyBatch(batch(insert, insert, insert));
    expect(replica.getState().text).toBe("A");
  });

  it("converges across delivery orders", () => {
    const operations: Op[] = [
      { type: 1, opId: "a:1", nodeId: "a:1", prevId: "HEAD", ch: 65 },
      { type: 1, opId: "b:1", nodeId: "b:1", prevId: "HEAD", ch: 66 },
      { type: 1, opId: "a:2", nodeId: "a:2", prevId: "a:1", ch: 67 },
      { type: 2, opId: "b:2", targetId: "a:1" },
    ];
    const orders = [
      operations,
      [...operations].reverse(),
      [operations[2], operations[3], operations[1], operations[0]],
    ];

    const states = orders.map((ops) => {
      const replica = new CRDT("reader");
      replica.applyBatch(batch(...ops));
      return replica.getState().text;
    });

    expect(new Set(states).size).toBe(1);
  });
});
