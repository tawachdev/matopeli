const SIM_KEY = 'snake2_sim';
const API_BASE = (import.meta.env.PUBLIC_OS_API as string | undefined) || 'http://127.0.0.1:8787';

export interface Sim {
  number: string;
  token: string;
}

export interface SmsMessage {
  id: string;
  from: string;
  to: string;
  kind: string;
  body: string;
  status: string;
  created_at: number;
}

interface InboxEnvelope {
  type: string;
  id?: string;
  from?: string;
  kind?: string;
  body?: string;
  created_at?: number;
  status?: string;
}

type MessageListener = (message: SmsMessage) => void;
type StatusListener = (online: boolean) => void;

class Net {
  private sim: Sim | null = null;
  private socket: WebSocket | null = null;
  private retryMs = 1000;
  private listeners: Set<MessageListener> = new Set();
  private statusListeners: StatusListener[] = [];
  private pongTimer: ReturnType<typeof setInterval> | null = null;
  online = false;

  currentSim(): Sim | null {
    if (this.sim) return this.sim;
    try {
      const raw = localStorage.getItem(SIM_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const item = parsed as Record<string, unknown>;
      if (typeof item.number !== 'string' || typeof item.token !== 'string') return null;
      this.sim = { number: item.number, token: item.token };
    } catch {
      this.sim = null;
    }
    return this.sim;
  }

  private saveSim(sim: Sim): void {
    this.sim = sim;
    try {
      localStorage.setItem(SIM_KEY, JSON.stringify(sim));
    } catch {}
  }

  onMessage(listener: MessageListener): void {
    this.listeners.add(listener);
  }

  offMessage(listener: MessageListener): void {
    this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): void {
    this.statusListeners.push(listener);
  }

  private emitMessage(message: SmsMessage): void {
    this.listeners.forEach((listener) => listener(message));
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    this.statusListeners.forEach((listener) => listener(online));
  }

  async register(): Promise<Sim | null> {
    const existing = this.currentSim();
    const body = existing ? { token: existing.token } : {};
    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (typeof data !== 'object' || data === null) return null;
      const item = data as Record<string, unknown>;
      if (typeof item.number !== 'string' || typeof item.token !== 'string') return null;
      this.saveSim({ number: item.number, token: item.token });
      return this.sim;
    } catch {
      return null;
    }
  }

  async send(to: string, kind: string, body: string): Promise<{ id: string; status: string } | { error: string }> {
    const sim = this.currentSim();
    if (!sim) return { error: 'no_sim' };
    try {
      const res = await fetch(`${API_BASE}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sim.token}` },
        body: JSON.stringify({ to, kind, body }),
      });
      const data: unknown = await res.json().catch(() => null);
      const item = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
      if (!res.ok) return { error: typeof item.error === 'string' ? item.error : `http_${res.status}` };
      if (typeof item.id !== 'string' || typeof item.status !== 'string') return { error: 'bad_response' };
      return { id: item.id, status: item.status };
    } catch {
      return { error: 'no_signal' };
    }
  }

  async list(): Promise<{ inbox: SmsMessage[]; outbox: SmsMessage[] } | null> {
    const sim = this.currentSim();
    if (!sim) return null;
    try {
      const res = await fetch(`${API_BASE}/api/messages`, {
        headers: { Authorization: `Bearer ${sim.token}` },
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (typeof data !== 'object' || data === null) return null;
      const item = data as Record<string, unknown>;
      const mapList = (raw: unknown): SmsMessage[] => {
        if (!Array.isArray(raw)) return [];
        return raw.filter((entry): entry is SmsMessage => typeof entry === 'object' && entry !== null && 'id' in entry);
      };
      return { inbox: mapList(item.inbox), outbox: mapList(item.outbox) };
    } catch {
      return null;
    }
  }

  connect(): void {
    if (this.socket || !navigator.onLine) return;
    void this.ensureSimThenSocket();
  }

  handleOnline(): void {
    this.connect();
  }

  private async ensureSimThenSocket(): Promise<void> {
    let sim = this.currentSim();
    if (!sim) {
      const registered = await this.register();
      if (!registered) {
        this.scheduleRetry();
        return;
      }
      sim = registered;
    }
    this.openSocket(sim);
  }

  private openSocket(sim: Sim): void {
    const base = API_BASE.replace(/^http/, 'ws');
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${base}/ws?token=${encodeURIComponent(sim.token)}`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retryMs = 1000;
      this.setOnline(true);
      if (this.pongTimer) clearInterval(this.pongTimer);
      this.pongTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    });
    socket.addEventListener('close', () => {
      this.socket = null;
      this.setOnline(false);
      if (this.pongTimer) {
        clearInterval(this.pongTimer);
        this.pongTimer = null;
      }
      this.scheduleRetry();
    });
    socket.addEventListener('error', () => {
      socket.close();
    });
    socket.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const envelope = parsed as InboxEnvelope;
      if (envelope.type === 'message' && typeof envelope.id === 'string') {
        this.emitMessage({
          id: envelope.id,
          from: envelope.from || '',
          to: sim.number,
          kind: envelope.kind || 'text',
          body: envelope.body || '',
          status: 'delivered',
          created_at: envelope.created_at || Date.now(),
        });
      }
    });
  }

  private scheduleRetry(): void {
    setTimeout(() => {
      if (!this.socket) this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }
}

export const net = new Net();
window.addEventListener('online', () => net.handleOnline());
