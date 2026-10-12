import { PresenceDO } from "./presence";

export { PresenceDO };

export interface Env {
  DB: D1Database;
  PRESENCE: DurableObjectNamespace;
}

interface SimRow {
  number: string;
  token: string;
}

interface MessageRow {
  id: string;
  from_number: string;
  to_number: string;
  kind: string;
  body: string;
  status: string;
  created_at: number;
}

interface ApiMessage {
  id: string;
  from: string;
  to: string;
  kind: string;
  body: string;
  status: string;
  created_at: number;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : undefined;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let token = "";
  for (const byte of bytes) token += byte.toString(16).padStart(2, "0");
  return token;
}

function presenceStub(env: Env): DurableObjectStub {
  return env.PRESENCE.get(env.PRESENCE.idFromName("global"));
}

async function findByToken(db: D1Database, token: string): Promise<SimRow | null> {
  return db.prepare("SELECT number, token FROM sims WHERE token = ?1").bind(token).first<SimRow>();
}

async function nextNumber(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT number FROM sims ORDER BY number DESC LIMIT 1")
    .first<{ number: string }>();
  const suffix = row === null ? 612000001 : Number.parseInt(row.number.slice(4), 10) + 1;
  return `+212${suffix}`;
}

async function createSim(db: D1Database): Promise<SimRow> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = await nextNumber(db);
    const token = randomToken();
    try {
      await db
        .prepare("INSERT INTO sims (number, token, created_at) VALUES (?1, ?2, ?3)")
        .bind(number, token, Date.now())
        .run();
      return { number, token };
    } catch {
      continue;
    }
  }
  throw new Error("sim allocation failed");
}

async function authenticate(request: Request, env: Env): Promise<SimRow | null> {
  const header = request.headers.get("Authorization");
  if (header === null || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.length === 0) return null;
  return findByToken(env.DB, token);
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const text = await request.text();
  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
  }
  const token = readString(parsed, "token");
  if (token !== undefined) {
    const existing = await findByToken(env.DB, token);
    if (existing !== null) return json({ number: existing.number, token: existing.token });
  }
  const sim = await createSim(env.DB);
  return json({ number: sim.number, token: sim.token }, 201);
}

async function handleMessageSend(request: Request, env: Env): Promise<Response> {
  const sim = await authenticate(request, env);
  if (sim === null) return json({ error: "unauthorized" }, 401);
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const to = readString(parsed, "to");
  const kind = readString(parsed, "kind");
  const body = readString(parsed, "body");
  if (to === undefined || to.length === 0) return json({ error: "invalid_request", field: "to" }, 400);
  if (kind !== "text" && kind !== "ringtone") {
    return json({ error: "invalid_request", field: "kind" }, 400);
  }
  if (body === undefined || body.length < 1 || body.length > 320) {
    return json({ error: "invalid_request", field: "body" }, 400);
  }
  const recipient = await env.DB
    .prepare("SELECT number FROM sims WHERE number = ?1")
    .bind(to)
    .first<{ number: string }>();
  if (recipient === null) return json({ error: "unknown_number" }, 404);
  const allowResponse = await presenceStub(env).fetch(
    `https://presence/allow?number=${encodeURIComponent(sim.number)}`
  );
  const allowData: unknown = await allowResponse.json();
  if (typeof allowData !== "object" || allowData === null || (allowData as { allowed?: unknown }).allowed !== true) {
    return json({ error: "rate_limited" }, 429);
  }
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await env.DB
    .prepare(
      "INSERT INTO messages (id, from_number, to_number, kind, body, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    )
    .bind(id, sim.number, to, kind, body, "queued", createdAt)
    .run();
  let status = "queued";
  try {
    const payload = { type: "message", id, from: sim.number, kind, body, created_at: createdAt };
    const sendResponse = await presenceStub(env).fetch("https://presence/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toNumber: to, fromNumber: sim.number, messageId: id, payload }),
    });
    const sendResult: unknown = await sendResponse.json();
    if (
      typeof sendResult === "object" &&
      sendResult !== null &&
      (sendResult as { delivered?: unknown }).delivered === true
    ) {
      status = "delivered";
    }
  } catch {
  }
  return json({ id, status }, 202);
}

function toApiMessage(row: MessageRow): ApiMessage {
  return {
    id: row.id,
    from: row.from_number,
    to: row.to_number,
    kind: row.kind,
    body: row.body,
    status: row.status,
    created_at: row.created_at,
  };
}

async function handleListMessages(request: Request, env: Env): Promise<Response> {
  const sim = await authenticate(request, env);
  if (sim === null) return json({ error: "unauthorized" }, 401);
  const inboxResult = await env.DB
    .prepare(
      "SELECT id, from_number, to_number, kind, body, status, created_at FROM messages WHERE to_number = ?1 ORDER BY created_at DESC LIMIT 50"
    )
    .bind(sim.number)
    .all<MessageRow>();
  const outboxResult = await env.DB
    .prepare(
      "SELECT id, from_number, to_number, kind, body, status, created_at FROM messages WHERE from_number = ?1 ORDER BY created_at DESC LIMIT 50"
    )
    .bind(sim.number)
    .all<MessageRow>();
  return json({
    inbox: inboxResult.results.slice().reverse().map(toApiMessage),
    outbox: outboxResult.results.slice().reverse().map(toApiMessage),
  });
}

async function handleWebSocket(env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get("token");
  if (token === null || token.length === 0) return json({ error: "unauthorized" }, 401);
  const sim = await findByToken(env.DB, token);
  if (sim === null) return json({ error: "unauthorized" }, 401);
  const presenceResponse = await presenceStub(env).fetch(
    `https://presence/register?number=${encodeURIComponent(sim.number)}`,
    { headers: { Upgrade: "websocket" } }
  );
  if (presenceResponse.webSocket === null || presenceResponse.webSocket === undefined) {
    return json({ error: "internal" }, 500);
  }
  return new Response(presenceResponse.body, {
    status: 101,
    webSocket: presenceResponse.webSocket,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname === "/ws")) {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (url.pathname === "/health") return json({ ok: true });
      if (url.pathname === "/api/register" && request.method === "POST") {
        return await handleRegister(request, env);
      }
      if (url.pathname === "/api/messages" && request.method === "POST") {
        return await handleMessageSend(request, env);
      }
      if (url.pathname === "/api/messages" && request.method === "GET") {
        return await handleListMessages(request, env);
      }
      if (url.pathname === "/ws" && request.method === "GET") {
        return await handleWebSocket(env, url);
      }
      return json({ error: "not_found" }, 404);
    } catch {
      return json({ error: "internal" }, 500);
    }
  },
};
