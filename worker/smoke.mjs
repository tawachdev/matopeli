import process from "node:process";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const STEP_TIMEOUT_MS = 5000;

let failures = 0;

function pass(step) {
  console.log(`PASS ${step}`);
}

function fail(step, detail) {
  failures += 1;
  console.log(`FAIL ${step}${detail === undefined ? "" : ` :: ${detail}`}`);
}

async function registerSim() {
  const response = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (response.status !== 201) throw new Error(`register returned ${response.status}`);
  return response.json();
}

async function sendMessage(token, to, body) {
  const response = await fetch(`${BASE}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, kind: "text", body }),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function listMessages(token) {
  const response = await fetch(`${BASE}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 200) throw new Error(`list returned ${response.status}`);
  return response.json();
}

function openSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => reject(new Error("open timeout")), STEP_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("socket error"));
    });
  });
}

function collectMessages(socket) {
  const received = [];
  socket.addEventListener("message", (event) => {
    try {
      received.push(JSON.parse(String(event.data)));
    } catch {
      received.push(null);
    }
  });
  return {
    wait(predicate) {
      const startedAt = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          const hit = received.find(predicate);
          if (hit !== undefined) return resolve(hit);
          if (Date.now() - startedAt >= STEP_TIMEOUT_MS) return resolve(null);
          setTimeout(check, 50);
        };
        check();
      });
    },
  };
}

async function waitForOutboxStatus(token, id, expected) {
  const startedAt = Date.now();
  for (;;) {
    const data = await listMessages(token);
    const hit = data.outbox.find((message) => message.id === id);
    if (hit !== undefined && hit.status === expected) return hit;
    if (Date.now() - startedAt >= STEP_TIMEOUT_MS) return hit === undefined ? null : hit;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  console.log(`step 1 :: base ${BASE}`);
  pass("step 1 base url");

  const simA = await registerSim();
  const simB = await registerSim();
  if (simA.number !== simB.number && simA.token !== simB.token) {
    pass(`step 2 register A=${simA.number} B=${simB.number}`);
  } else {
    fail("step 2 register distinct sims");
  }

  let socketB = null;
  let inboxB = null;
  try {
    socketB = await openSocket(simB.token);
    inboxB = collectMessages(socketB);
    pass("step 3 ws open for B");
  } catch (error) {
    fail("step 3 ws open for B", error.message);
  }

  const sent = await sendMessage(simA.token, simB.number, "SALAM FROM A");
  if (sent.status === 202 && typeof sent.data.id === "string") {
    pass(`step 4 send A->B accepted id=${sent.data.id} status=${sent.data.status}`);
  } else {
    fail("step 4 send A->B accepted", `status=${sent.status}`);
  }

  if (inboxB !== null) {
    const pushed = await inboxB.wait(
      (message) => message !== null && message.type === "message" && message.body === "SALAM FROM A"
    );
    if (pushed !== null && pushed.from === simA.number) {
      pass("step 5 B received message on ws");
    } else {
      fail("step 5 B received message on ws", "timeout or wrong sender");
    }
  } else {
    fail("step 5 B received message on ws", "ws unavailable");
  }

  const outboxLive = await waitForOutboxStatus(simA.token, sent.data.id, "delivered");
  if (outboxLive !== null && outboxLive.status === "delivered") {
    pass("step 6 A outbox shows delivered");
  } else {
    fail(
      "step 6 A outbox shows delivered",
      outboxLive === null ? "message missing" : `status=${outboxLive.status}`
    );
  }

  const simC = await registerSim();
  const queued = await sendMessage(simA.token, simC.number, "QUEUED");
  if (queued.status === 202 && queued.data.status === "queued") {
    pass("step 7a send A->C queued while offline");
  } else {
    fail("step 7a send A->C queued while offline", `status=${queued.status} data=${JSON.stringify(queued.data)}`);
  }

  let socketC = null;
  let inboxC = null;
  try {
    socketC = await openSocket(simC.token);
    inboxC = collectMessages(socketC);
  } catch (error) {
    fail("step 7b ws open for C", error.message);
  }

  if (inboxC !== null) {
    const pushed = await inboxC.wait(
      (message) => message !== null && message.type === "message" && message.body === "QUEUED"
    );
    if (pushed !== null && pushed.from === simA.number) {
      pass("step 7b queued push arrived on C ws");
    } else {
      fail("step 7b queued push arrived on C ws", "timeout");
    }
  } else {
    fail("step 7b queued push arrived on C ws", "ws unavailable");
  }

  const outboxQueued = await waitForOutboxStatus(simA.token, queued.data.id, "delivered");
  if (outboxQueued !== null && outboxQueued.status === "delivered") {
    pass("step 7c A outbox shows delivered after push");
  } else {
    fail(
      "step 7c A outbox shows delivered after push",
      outboxQueued === null ? "message missing" : `status=${outboxQueued.status}`
    );
  }

  if (socketB !== null) socketB.close();
  if (socketC !== null) socketC.close();
}

main()
  .catch((error) => {
    failures += 1;
    console.log(`FAIL fatal :: ${error.message}`);
  })
  .finally(() => {
    console.log(failures === 0 ? "RESULT all steps passed" : `RESULT ${failures} failure(s)`);
    process.exit(failures === 0 ? 0 : 1);
  });
