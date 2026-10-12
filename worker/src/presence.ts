interface PresenceEnv {
  DB: D1Database;
}

interface QueuedMessageRow {
  id: string;
  from_number: string;
  kind: string;
  body: string;
  created_at: number;
}

interface SendInstruction {
  toNumber: string;
  fromNumber: string;
  messageId: string;
  payload: unknown;
}

interface RateWindow {
  start: number;
  count: number;
}

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readInstruction(value: unknown): SendInstruction | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.toNumber !== "string" || record.toNumber.length === 0) return null;
  if (typeof record.fromNumber !== "string" || record.fromNumber.length === 0) return null;
  if (typeof record.messageId !== "string" || record.messageId.length === 0) return null;
  if (record.payload === undefined) return null;
  return {
    toNumber: record.toNumber,
    fromNumber: record.fromNumber,
    messageId: record.messageId,
    payload: record.payload,
  };
}

export class PresenceDO implements DurableObject {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly rateWindows = new Map<string, RateWindow>();
  private readonly db: D1Database;

  constructor(_ctx: DurableObjectState, env: PresenceEnv) {
    this.db = env.DB;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/register" && request.method === "GET") return await this.register(url);
      if (url.pathname === "/send" && request.method === "POST") return await this.send(request);
      if (url.pathname === "/allow" && request.method === "GET") return this.allow(url);
      if (url.pathname === "/unregister" && request.method === "POST") return this.unregister(url);
      return respond({ error: "not_found" }, 404);
    } catch {
      return respond({ error: "internal" }, 500);
    }
  }

  private async register(url: URL): Promise<Response> {
    const number = url.searchParams.get("number");
    if (number === null || number.length === 0) return respond({ error: "invalid_request" }, 400);
    const previous = this.sockets.get(number);
    if (previous !== undefined) {
      this.sockets.delete(number);
      this.closeQuietly(previous);
    }
    const [server, client] = Object.values(new WebSocketPair());
    this.sockets.set(number, server);
    server.accept();
    server.addEventListener("message", (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (data.startsWith('{"type":"ping"')) server.send('{"type":"pong"}');
    });
    server.addEventListener("close", () => this.release(number, server));
    server.addEventListener("error", () => this.release(number, server));
    await this.flushQueued(number, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async send(request: Request): Promise<Response> {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return respond({ error: "invalid_request" }, 400);
    }
    const instruction = readInstruction(parsed);
    if (instruction === null) return respond({ error: "invalid_request" }, 400);
    const recipient = this.sockets.get(instruction.toNumber);
    if (recipient === undefined || recipient.readyState !== WebSocket.OPEN) {
      if (recipient !== undefined) this.sockets.delete(instruction.toNumber);
      return respond({ delivered: false });
    }
    try {
      recipient.send(JSON.stringify(instruction.payload));
    } catch {
      this.sockets.delete(instruction.toNumber);
      return respond({ delivered: false });
    }
    await this.markDelivered(instruction.messageId);
    this.sendAck(instruction.fromNumber, instruction.messageId);
    return respond({ delivered: true });
  }

  private allow(url: URL): Response {
    const number = url.searchParams.get("number");
    if (number === null || number.length === 0) return respond({ error: "invalid_request" }, 400);
    const now = Date.now();
    const window = this.rateWindows.get(number);
    if (window === undefined || now - window.start >= RATE_WINDOW_MS) {
      this.rateWindows.set(number, { start: now, count: 1 });
      return respond({ allowed: true });
    }
    if (window.count >= RATE_LIMIT) return respond({ allowed: false });
    window.count += 1;
    return respond({ allowed: true });
  }

  private unregister(url: URL): Response {
    const number = url.searchParams.get("number");
    if (number === null || number.length === 0) return respond({ error: "invalid_request" }, 400);
    const socket = this.sockets.get(number);
    if (socket !== undefined) {
      this.sockets.delete(number);
      this.closeQuietly(socket);
    }
    return respond({ ok: true });
  }

  private async flushQueued(number: string, socket: WebSocket): Promise<void> {
    try {
      const result = await this.db
        .prepare(
          "SELECT id, from_number, kind, body, created_at FROM messages WHERE to_number = ?1 AND status = 'queued' ORDER BY created_at ASC"
        )
        .bind(number)
        .all<QueuedMessageRow>();
      for (const row of result.results) {
        socket.send(
          JSON.stringify({
            type: "message",
            id: row.id,
            from: row.from_number,
            kind: row.kind,
            body: row.body,
            created_at: row.created_at,
          })
        );
        await this.markDelivered(row.id);
        this.sendAck(row.from_number, row.id);
      }
    } catch {
    }
  }

  private async markDelivered(id: string): Promise<void> {
    try {
      await this.db.prepare("UPDATE messages SET status = 'delivered' WHERE id = ?1").bind(id).run();
    } catch {
    }
  }

  private sendAck(fromNumber: string, id: string): void {
    const sender = this.sockets.get(fromNumber);
    if (sender === undefined || sender.readyState !== WebSocket.OPEN) return;
    try {
      sender.send(JSON.stringify({ type: "ack", id, status: "delivered" }));
    } catch {
    }
  }

  private release(number: string, socket: WebSocket): void {
    if (this.sockets.get(number) === socket) this.sockets.delete(number);
  }

  private closeQuietly(socket: WebSocket): void {
    try {
      socket.close(1000);
    } catch {
    }
  }
}
