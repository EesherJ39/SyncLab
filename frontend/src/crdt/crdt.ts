import { Batch, ChecklistItem, DocState, Op } from "./types";

type Node = {
  id: string;
  prev: string;
  ch: number;
  tomb: boolean;
};

const HEAD = "HEAD";

function idCompare(a: string, b: string): number {
  // ids look like "device:counter"
  const [ar, ac] = a.split(":");
  const [br, bc] = b.split(":");
  if (ar < br) return -1;
  if (ar > br) return 1;
  const ai = Number(ac), bi = Number(bc);
  return ai - bi;
}

export class CRDT {
  private deviceId: string;
  private counter = 1;

  private nodes = new Map<string, Node>();
  private children = new Map<string, string[]>();         // prev -> inserted ids (sorted)
  private appliedOpIds = new Set<string>();

  private pendingByPrev = new Map<string, Op[]>();        // inserts waiting for prev
  private pendingDeletes = new Map<string, Op[]>();       // deletes waiting for target

  // checklist state (LWW on done/removed)
  private items = new Map<string, { text: string; done: boolean; doneTs: string; removed: boolean; rmTs: string }>();

  constructor(deviceId: string) {
    this.deviceId = deviceId;
    this.children.set(HEAD, []);
  }

  newOpId(): string {
    return `${this.deviceId}:${this.counter++}`;
  }

  // --------- public API for UI ----------
  localInsert(index: number, text: string): Batch {
    const ops: Op[] = [];
    let idx = Math.max(0, Math.min(index, this.linearizeIds().length));
    for (const ch of Array.from(text)) {
      const codepoint = ch.codePointAt(0)!;
      const prevId = idx === 0 ? HEAD : this.linearizeIds()[idx - 1];
      const opId = this.newOpId();
      ops.push({ type: 1, opId, nodeId: opId, prevId, ch: codepoint });
      // optimistic apply
      this.applyOp({ type: 1, opId, nodeId: opId, prevId, ch: codepoint });
      idx++;
    }
    return { v: 1, ops };
  }

  localDelete(index: number, count: number): Batch {
    const ids = this.linearizeIds();
    const ops: Op[] = [];
    const start = Math.max(0, Math.min(index, ids.length));
    const end = Math.max(start, Math.min(start + Math.max(0, count), ids.length));
    for (let i = start; i < end; i++) {
      const targetId = ids[i];
      const opId = this.newOpId();
      const op: Op = { type: 2, opId, targetId };
      ops.push(op);
      this.applyOp(op);
    }
    return { v: 1, ops };
  }

  localCheckAdd(text: string): Batch {
    const opId = this.newOpId();
    const op: Op = { type: 3, opId, itemId: opId, text };
    this.applyOp(op);
    return { v: 1, ops: [op] };
  }

  localCheckToggle(itemId: string, done: boolean): Batch {
    const opId = this.newOpId();
    const op: Op = { type: 4, opId, itemId, done };
    this.applyOp(op);
    return { v: 1, ops: [op] };
  }

  localCheckRemove(itemId: string): Batch {
    const opId = this.newOpId();
    const op: Op = { type: 5, opId, itemId };
    this.applyOp(op);
    return { v: 1, ops: [op] };
  }

  applyBatch(batch: Batch) {
    for (const op of batch.ops) this.applyOp(op);
  }

  getState(): DocState {
    const text = this.linearizeText();
    const checklist: ChecklistItem[] = [];
    for (const [itemId, it] of this.items.entries()) {
      checklist.push({ itemId, text: it.text, done: it.done, removed: it.removed });
    }
    checklist.sort((a, b) => idCompare(a.itemId, b.itemId));
    return { text, checklist: checklist.filter(i => !i.removed) };
  }

  // --------- core apply ----------
  private applyOp(op: Op) {
    if (this.appliedOpIds.has(op.opId)) return;
    this.appliedOpIds.add(op.opId);

    if (op.type === 1) return this.applyInsert(op);
    if (op.type === 2) return this.applyDelete(op);
    if (op.type === 3) return this.applyCheckAdd(op);
    if (op.type === 4) return this.applyCheckToggle(op);
    if (op.type === 5) return this.applyCheckRemove(op);
  }

  private ensureChildren(prev: string) {
    if (!this.children.has(prev)) this.children.set(prev, []);
  }

  private applyInsert(op: Extract<Op, { type: 1 }>) {
    if (this.nodes.has(op.nodeId)) return;

    if (op.prevId !== HEAD && !this.nodes.has(op.prevId)) {
      const arr = this.pendingByPrev.get(op.prevId) ?? [];
      arr.push(op);
      this.pendingByPrev.set(op.prevId, arr);
      return;
    }

    const node: Node = { id: op.nodeId, prev: op.prevId, ch: op.ch, tomb: false };
    this.nodes.set(node.id, node);
    this.ensureChildren(node.prev);

    const kids = this.children.get(node.prev)!;
    kids.push(node.id);
    kids.sort(idCompare);

    // flush pending inserts waiting on this node
    const pending = this.pendingByPrev.get(node.id);
    if (pending) {
      this.pendingByPrev.delete(node.id);
      for (const p of pending) this.applyOp(p);
    }

    // flush pending deletes targeting this node
    const pdel = this.pendingDeletes.get(node.id);
    if (pdel) {
      this.pendingDeletes.delete(node.id);
      for (const d of pdel) this.applyOp(d);
    }
  }

  private applyDelete(op: Extract<Op, { type: 2 }>) {
    const node = this.nodes.get(op.targetId);
    if (!node) {
      const arr = this.pendingDeletes.get(op.targetId) ?? [];
      arr.push(op);
      this.pendingDeletes.set(op.targetId, arr);
      return;
    }
    node.tomb = true;
  }

  private applyCheckAdd(op: Extract<Op, { type: 3 }>) {
    if (this.items.has(op.itemId)) return;
    this.items.set(op.itemId, { text: op.text, done: false, doneTs: "0:0", removed: false, rmTs: "0:0" });
  }

  private applyCheckToggle(op: Extract<Op, { type: 4 }>) {
    const it = this.items.get(op.itemId);
    if (!it) {
      // ignore for MVP; could buffer similarly
      return;
    }
    if (idCompare(op.opId, it.doneTs) > 0) {
      it.done = op.done;
      it.doneTs = op.opId;
    }
  }

  private applyCheckRemove(op: Extract<Op, { type: 5 }>) {
    const it = this.items.get(op.itemId);
    if (!it) return;
    if (idCompare(op.opId, it.rmTs) > 0) {
      it.removed = true;
      it.rmTs = op.opId;
    }
  }

  // --------- linearization ----------
  private linearizeIds(): string[] {
    const out: string[] = [];
    const dfs = (prev: string) => {
      const kids = this.children.get(prev) ?? [];
      for (const id of kids) {
        const node = this.nodes.get(id);
        if (!node) continue;
        if (!node.tomb) out.push(id);
        dfs(id);
      }
    };
    dfs(HEAD);
    return out;
  }

  private linearizeText(): string {
    const ids = this.linearizeIds();
    const chars: string[] = [];
    for (const id of ids) {
      const n = this.nodes.get(id)!;
      chars.push(String.fromCodePoint(n.ch));
    }
    return chars.join("");
  }
}