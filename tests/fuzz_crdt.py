import random
from dataclasses import dataclass

# This fuzz test validates convergence of a simplified op-based RGA-like CRDT
# similar to the TS version (insert after prevId, delete targetId).
# It does not involve encryption or websocket; it focuses on CRDT safety.

HEAD = "HEAD"

def id_compare(a: str, b: str) -> int:
    ar, ac = a.split(":")
    br, bc = b.split(":")
    if ar < br: return -1
    if ar > br: return 1
    return int(ac) - int(bc)

@dataclass
class Insert:
    opId: str
    nodeId: str
    prevId: str
    ch: int

@dataclass
class Delete:
    opId: str
    targetId: str

class CRDT:
    def __init__(self):
        self.nodes = {}          # id -> (prev, ch, tomb)
        self.children = {HEAD: []}
        self.applied = set()
        self.pending_by_prev = {}
        self.pending_del = {}

    def ensure_children(self, prev):
        if prev not in self.children:
            self.children[prev] = []

    def apply(self, op):
        if op.opId in self.applied:
            return
        self.applied.add(op.opId)

        if isinstance(op, Insert):
            if op.nodeId in self.nodes:
                return
            if op.prevId != HEAD and op.prevId not in self.nodes:
                self.pending_by_prev.setdefault(op.prevId, []).append(op)
                return
            self.nodes[op.nodeId] = [op.prevId, op.ch, False]
            self.ensure_children(op.prevId)
            self.children[op.prevId].append(op.nodeId)
            self.children[op.prevId].sort(key=lambda s: (s.split(":")[0], int(s.split(":")[1])))

            for p in self.pending_by_prev.pop(op.nodeId, []):
                self.apply(p)
            for d in self.pending_del.pop(op.nodeId, []):
                self.apply(d)

        elif isinstance(op, Delete):
            if op.targetId not in self.nodes:
                self.pending_del.setdefault(op.targetId, []).append(op)
                return
            self.nodes[op.targetId][2] = True

    def linearize_ids(self):
        out = []
        def dfs(prev):
            for nid in self.children.get(prev, []):
                if nid not in self.nodes:
                    continue
                if not self.nodes[nid][2]:
                    out.append(nid)
                dfs(nid)
        dfs(HEAD)
        return out

    def text(self):
        ids = self.linearize_ids()
        return "".join(chr(self.nodes[i][1]) for i in ids)

def gen_ops(num_ops=200, replicas=("a", "b", "c")):
    counters = {r: 1 for r in replicas}
    crdt_local = CRDT()
    ops = []

    for _ in range(num_ops):
        r = random.choice(replicas)
        # 70% insert, 30% delete if possible
        if random.random() < 0.7 or len(crdt_local.linearize_ids()) == 0:
            # choose insertion index
            ids = crdt_local.linearize_ids()
            idx = random.randint(0, len(ids))
            prev = HEAD if idx == 0 else ids[idx-1]
            opId = f"{r}:{counters[r]}"; counters[r] += 1
            ch = random.choice("abcdefg ")
            op = Insert(opId=opId, nodeId=opId, prevId=prev, ch=ord(ch))
            crdt_local.apply(op)
            ops.append(op)
        else:
            ids = crdt_local.linearize_ids()
            target = random.choice(ids)
            opId = f"{r}:{counters[r]}"; counters[r] += 1
            op = Delete(opId=opId, targetId=target)
            crdt_local.apply(op)
            ops.append(op)

    return ops

def deliver_with_chaos(ops, replica_count=3):
    replicas = [CRDT() for _ in range(replica_count)]
    # create different delivery orders per replica (with duplicates)
    for rep in replicas:
        shuffled = ops[:]
        random.shuffle(shuffled)
        # inject duplicates & drops
        noisy = []
        for op in shuffled:
            if random.random() < 0.05:   # drop
                continue
            noisy.append(op)
            if random.random() < 0.10:   # duplicate
                noisy.append(op)
        for op in noisy:
            rep.apply(op)
    return replicas

if __name__ == "__main__":
    random.seed(0)
    for trial in range(200):
        ops = gen_ops(num_ops=250)
        reps = deliver_with_chaos(ops, replica_count=5)
        texts = {r.text() for r in reps}
        if len(texts) != 1:
            print("DIVERGENCE in trial", trial)
            for t in sorted(texts):
                print(repr(t))
            raise SystemExit(1)
    print("OK: 200 trials, no divergence")