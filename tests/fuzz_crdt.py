"""Deterministic convergence stress test for SyncLab's RGA-style CRDT.

The first delivery wave injects reordering, duplicates, and temporary loss.
An anti-entropy wave then redelivers every operation, matching what SyncLab's
persisted outbox and server history do after a client reconnects. Convergence
is required only after every replica has eventually observed every operation.
"""

from __future__ import annotations

import argparse
import random
import time
from dataclasses import dataclass

HEAD = "HEAD"


def id_key(value: str) -> tuple[str, int]:
    replica, counter = value.rsplit(":", 1)
    return replica, int(counter)


@dataclass(frozen=True)
class Insert:
    op_id: str
    node_id: str
    prev_id: str
    ch: int


@dataclass(frozen=True)
class Delete:
    op_id: str
    target_id: str


Operation = Insert | Delete


class CRDT:
    def __init__(self) -> None:
        self.nodes: dict[str, list[object]] = {}
        self.children: dict[str, list[str]] = {HEAD: []}
        self.applied: set[str] = set()
        self.pending_ids: set[str] = set()
        self.pending_by_prev: dict[str, list[Operation]] = {}
        self.pending_deletes: dict[str, list[Operation]] = {}

    def _queue(self, store: dict[str, list[Operation]], key: str, op: Operation) -> None:
        if op.op_id in self.pending_ids:
            return
        store.setdefault(key, []).append(op)
        self.pending_ids.add(op.op_id)

    def _flush(self, store: dict[str, list[Operation]], key: str) -> None:
        for op in store.pop(key, []):
            self.pending_ids.discard(op.op_id)
            self.apply(op)

    def apply(self, op: Operation) -> None:
        if op.op_id in self.applied or op.op_id in self.pending_ids:
            return

        if isinstance(op, Insert) and op.prev_id != HEAD and op.prev_id not in self.nodes:
            self._queue(self.pending_by_prev, op.prev_id, op)
            return
        if isinstance(op, Delete) and op.target_id not in self.nodes:
            self._queue(self.pending_deletes, op.target_id, op)
            return

        self.applied.add(op.op_id)
        if isinstance(op, Insert):
            if op.node_id in self.nodes:
                return
            self.nodes[op.node_id] = [op.prev_id, op.ch, False]
            siblings = self.children.setdefault(op.prev_id, [])
            siblings.append(op.node_id)
            siblings.sort(key=id_key)
            self._flush(self.pending_by_prev, op.node_id)
            self._flush(self.pending_deletes, op.node_id)
        else:
            self.nodes[op.target_id][2] = True

    def linearize_ids(self) -> list[str]:
        output: list[str] = []

        def visit(parent: str) -> None:
            for node_id in self.children.get(parent, []):
                if not bool(self.nodes[node_id][2]):
                    output.append(node_id)
                visit(node_id)

        visit(HEAD)
        return output

    def text(self) -> str:
        return "".join(chr(int(self.nodes[node_id][1])) for node_id in self.linearize_ids())


def generate_operations(rng: random.Random, count: int, replica_ids: tuple[str, ...]) -> list[Operation]:
    counters = {replica_id: 1 for replica_id in replica_ids}
    source = CRDT()
    operations: list[Operation] = []

    for _ in range(count):
        replica_id = rng.choice(replica_ids)
        visible = source.linearize_ids()
        op_id = f"{replica_id}:{counters[replica_id]}"
        counters[replica_id] += 1

        if not visible or rng.random() < 0.72:
            index = rng.randint(0, len(visible))
            previous = HEAD if index == 0 else visible[index - 1]
            op: Operation = Insert(op_id, op_id, previous, ord(rng.choice("abcdefg ")))
        else:
            op = Delete(op_id, rng.choice(visible))

        source.apply(op)
        operations.append(op)

    return operations


def deliver(
    rng: random.Random,
    operations: list[Operation],
    replica_count: int,
    drop_rate: float,
    duplicate_rate: float,
) -> list[CRDT]:
    replicas = [CRDT() for _ in range(replica_count)]
    for replica in replicas:
        first_wave = operations[:]
        rng.shuffle(first_wave)
        for op in first_wave:
            if rng.random() < drop_rate:
                continue
            replica.apply(op)
            if rng.random() < duplicate_rate:
                replica.apply(op)

        # Eventual redelivery after reconnect/anti-entropy.
        repair_wave = operations[:]
        rng.shuffle(repair_wave)
        for op in repair_wave:
            replica.apply(op)
    return replicas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=200)
    parser.add_argument("--operations", type=int, default=250)
    parser.add_argument("--replicas", type=int, default=5)
    parser.add_argument("--drop-rate", type=float, default=0.20)
    parser.add_argument("--duplicate-rate", type=float, default=0.10)
    parser.add_argument("--seed", type=int, default=20260902)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    started = time.perf_counter()
    for trial in range(args.trials):
        operations = generate_operations(rng, args.operations, ("a", "b", "c"))
        replicas = deliver(rng, operations, args.replicas, args.drop_rate, args.duplicate_rate)
        states = {replica.text() for replica in replicas}
        if len(states) != 1:
            raise AssertionError(f"divergence in trial {trial}: {sorted(states)!r}")

    elapsed = time.perf_counter() - started
    total_deliveries = args.trials * args.operations * args.replicas
    print(
        "PASS "
        f"trials={args.trials} operations_per_trial={args.operations} "
        f"replicas={args.replicas} temporary_drop_rate={args.drop_rate:.0%} "
        f"duplicate_rate={args.duplicate_rate:.0%} "
        f"verified_operations={total_deliveries} elapsed_s={elapsed:.3f}"
    )


if __name__ == "__main__":
    main()
