export type OpType = 1 | 2 | 3 | 4 | 5;

export type InsertOp = {
  type: 1;
  opId: string;     // unique op id (deviceId:counter)
  nodeId: string;   // id of inserted character (same as opId in this MVP)
  prevId: string;   // previous node (or "HEAD")
  ch: number;       // unicode codepoint
};

export type DeleteOp = {
  type: 2;
  opId: string;
  targetId: string;
};

export type CheckAddOp = {
  type: 3;
  opId: string;     // also itemId in this MVP
  itemId: string;
  text: string;
};

export type CheckToggleOp = {
  type: 4;
  opId: string;
  itemId: string;
  done: boolean;
};

export type CheckRemoveOp = {
  type: 5;
  opId: string;
  itemId: string;
};

export type Op = InsertOp | DeleteOp | CheckAddOp | CheckToggleOp | CheckRemoveOp;

export type Batch = { v: 1; ops: Op[] };

export type ChecklistItem = { itemId: string; text: string; done: boolean; removed: boolean };

export type DocState = {
  text: string;
  checklist: ChecklistItem[];
};