import { writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";

const endpoint = process.env.SYNCLAB_WS_URL ?? "ws://127.0.0.1:8080/ws";
const messages = Number(process.env.MESSAGES ?? 20_000);
const senderCount = Number(process.env.SENDERS ?? 4);
const trials = Number(process.env.TRIALS ?? 3);
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 120_000);
const outputPath = process.env.OUTPUT_PATH;

if (![messages, senderCount, trials, timeoutMs].every(Number.isSafeInteger)
    || messages < 1 || senderCount < 1 || trials < 1 || timeoutMs < 1
    || messages % senderCount !== 0 || messages / senderCount > 5_000) {
  throw new Error("Use positive integers; MESSAGES must divide by SENDERS and stay within 5,000 sends per socket");
}

const delay = () => new Promise((resolve) => setImmediate(resolve));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function connect(roomId, name) {
  const url = new URL(endpoint);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("sender", name);
  const socket = new WebSocket(url);
  let count = 0;
  let nextSeq = 1;
  const ciphertexts = new Set();
  let finishAt;
  let failure;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", ({ data }) => {
    try {
      const value = JSON.parse(data);
      if (value.t !== "op" || value.roomId !== roomId) return;
      if (value.seq !== nextSeq) {
        throw new Error(`${name}: expected sequence ${nextSeq}, received ${value.seq}`);
      }
      if (ciphertexts.has(value.ct)) {
        throw new Error(`${name}: duplicate ciphertext ${value.ct.slice(0, 20)}`);
      }
      nextSeq++;
      count++;
      ciphertexts.add(value.ct);
      if (count === messages) {
        finishAt = performance.now();
        resolveDone();
      }
    } catch (error) {
      failure = error;
      rejectDone(error);
    }
  });
  socket.addEventListener("error", (error) => { failure = error; rejectDone(error); });
  socket.addEventListener("close", () => {
    if (count < messages) {
      failure = new Error(`${name}: socket closed after ${count}/${messages} messages`);
      rejectDone(failure);
    }
  });

  return { name, socket, opened, done, get count() { return count; }, get unique() { return ciphertexts.size; }, get finishAt() { return finishAt; }, get failure() { return failure; } };
}

async function runTrial(number) {
  const roomId = `benchmark-${Date.now()}-${process.pid}-${number}`;
  const observer = connect(roomId, "observer");
  const senders = Array.from({ length: senderCount }, (_, i) => connect(roomId, `sender-${i}`));
  const clients = [observer, ...senders];
  const perSender = messages / senderCount;
  const payloads = senders.map((sender) => Array.from({ length: perSender }, (_, i) => JSON.stringify({
    t: "op",
    roomId,
    sender: sender.name,
    iv: Buffer.alloc(12, i % 256).toString("base64"),
    ct: Buffer.from(`${sender.name}:${i}:` + "x".repeat(120)).toString("base64"),
  })));

  let timeout;
  try {
    await Promise.all(clients.map((client) => client.opened));
    // The WebSocket handshake can complete just before the server finishes
    // registering a client for broadcasts. Keep that setup outside timing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = performance.now();
    const sending = senders.map(async (sender, senderIndex) => {
      for (let i = 0; i < perSender; i++) {
        while (sender.socket.bufferedAmount > 512 * 1024) await delay();
        sender.socket.send(payloads[senderIndex][i]);
        if (i % 100 === 99) await delay();
      }
    });
    const watchdog = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`trial ${number} timed out`)), timeoutMs);
    });
    await Promise.race([Promise.all([...sending, ...clients.map((client) => client.done)]), watchdog]);
    const completed = Math.max(...clients.map((client) => client.finishAt));
    // Leave the sockets open briefly after the timed interval so late duplicates
    // cannot be hidden by closing immediately after the expected last delivery.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const elapsedMs = completed - started;
    const failure = clients.find((client) => client.failure)?.failure;
    if (failure) throw failure;
    if (clients.some((client) => client.count !== messages || client.unique !== messages)) {
      throw new Error(`trial ${number}: recipient counts did not match ${messages}`);
    }
    return {
      trial: number,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      observerElapsedMs: Number((observer.finishAt - started).toFixed(2)),
      messagesPerSecond: Number((messages * 1000 / elapsedMs).toFixed(2)),
      socketDeliveries: messages * clients.length,
      socketDeliveriesPerSecond: Number((messages * clients.length * 1000 / elapsedMs).toFixed(2)),
      recipients: Object.fromEntries(clients.map((client) => [client.name, { received: client.count, unique: client.unique, missing: 0, duplicate: 0, ordered: true }])),
    };
  } finally {
    clearTimeout(timeout);
    for (const client of clients) client.socket.close();
  }
}

const results = [];
for (let i = 1; i <= trials; i++) {
  const result = await runTrial(i);
  results.push(result);
  console.error(`trial ${i}: ${result.elapsedMs} ms, ${result.messagesPerSecond} messages/s, all recipients complete`);
}

const report = {
  environment: {
    client: { node: process.version, platform: `${process.platform}-${process.arch}`, osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Number((os.totalmem() / 2 ** 30).toFixed(1)) },
    endpoint,
  },
  workload: { messages, senderCount, sendsPerSender: messages / senderCount, observerCount: 1, recipientCount: senderCount + 1, trials, ciphertext: "synthetic base64 payload, 120-byte body; prepared before timing" },
  method: "Clock starts after all WebSockets open, a 50 ms join-settling period, and payload preparation; clock stops after every recipient has received all messages. Each recipient verifies contiguous sequence numbers and unique payloads, then remains connected for 100 ms to catch late duplicates. Server startup, connection setup, encryption, and settling periods are outside the timed interval.",
  results,
  summary: {
    medianElapsedMs: Number(median(results.map((r) => r.elapsedMs)).toFixed(2)),
    medianMessagesPerSecond: Number(median(results.map((r) => r.messagesPerSecond)).toFixed(2)),
    medianSocketDeliveriesPerSecond: Number(median(results.map((r) => r.socketDeliveriesPerSecond)).toFixed(2)),
  },
};

const json = JSON.stringify(report, null, 2) + "\n";
if (outputPath) writeFileSync(outputPath, json);
console.log(json);
