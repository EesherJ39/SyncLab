import { Batch, Op } from "./types";

// Tiny binary codec (varint + utf8) so we don't ship JSON inside ciphertext.

function encVarint(n: number): number[] {
  const out: number[] = [];
  let x = n >>> 0;
  while (x >= 0x80) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
  return out;
}

function decVarint(buf: Uint8Array, i: number): { v: number; i: number } {
  let shift = 0;
  let x = 0;
  while (true) {
    const b = buf[i++];
    x |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { v: x >>> 0, i };
}

const te = new TextEncoder();
const td = new TextDecoder();

function encStr(s: string): Uint8Array {
  const b = te.encode(s);
  const len = encVarint(b.length);
  return new Uint8Array([...len, ...b]);
}

function decStr(buf: Uint8Array, i: number): { s: string; i: number } {
  const r1 = decVarint(buf, i);
  const len = r1.v;
  const start = r1.i;
  const end = start + len;
  const s = td.decode(buf.slice(start, end));
  return { s, i: end };
}

export function encodeBatch(batch: Batch): Uint8Array {
  const bytes: number[] = [];
  bytes.push(1); // version
  bytes.push(...encVarint(batch.ops.length));
  for (const op of batch.ops) {
    bytes.push(op.type);
    bytes.push(...encStr(op.opId));
    if (op.type === 1) {
      bytes.push(...encStr(op.nodeId));
      bytes.push(...encStr(op.prevId));
      bytes.push(...encVarint(op.ch));
    } else if (op.type === 2) {
      bytes.push(...encStr(op.targetId));
    } else if (op.type === 3) {
      bytes.push(...encStr(op.itemId));
      bytes.push(...encStr(op.text));
    } else if (op.type === 4) {
      bytes.push(...encStr(op.itemId));
      bytes.push(op.done ? 1 : 0);
    } else if (op.type === 5) {
      bytes.push(...encStr(op.itemId));
    }
  }
  return new Uint8Array(bytes);
}

export function decodeBatch(buf: Uint8Array): Batch {
  let i = 0;
  const v = buf[i++];
  if (v !== 1) throw new Error("Unsupported batch version");

  const rCount = decVarint(buf, i);
  const count = rCount.v;
  i = rCount.i;

  const ops: Op[] = [];
  for (let k = 0; k < count; k++) {
    const type = buf[i++] as any;
    const rOpId = decStr(buf, i); i = rOpId.i;
    const opId = rOpId.s;

    if (type === 1) {
      const rNode = decStr(buf, i); i = rNode.i;
      const rPrev = decStr(buf, i); i = rPrev.i;
      const rCh = decVarint(buf, i); i = rCh.i;
      ops.push({ type: 1, opId, nodeId: rNode.s, prevId: rPrev.s, ch: rCh.v });
    } else if (type === 2) {
      const rT = decStr(buf, i); i = rT.i;
      ops.push({ type: 2, opId, targetId: rT.s });
    } else if (type === 3) {
      const rItem = decStr(buf, i); i = rItem.i;
      const rText = decStr(buf, i); i = rText.i;
      ops.push({ type: 3, opId, itemId: rItem.s, text: rText.s });
    } else if (type === 4) {
      const rItem = decStr(buf, i); i = rItem.i;
      const done = buf[i++] === 1;
      ops.push({ type: 4, opId, itemId: rItem.s, done });
    } else if (type === 5) {
      const rItem = decStr(buf, i); i = rItem.i;
      ops.push({ type: 5, opId, itemId: rItem.s });
    } else {
      throw new Error("Unknown op type");
    }
  }

  return { v: 1, ops };
}