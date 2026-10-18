/**
 * Minimal Chrome DevTools Protocol client plus ZCode renderer target picking.
 */

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export class CdpError extends Error {}

export async function listTargets(port: number, host = "127.0.0.1"): Promise<CdpTarget[]> {
  let res: Response;
  try {
    res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
  } catch {
    throw new CdpError(
      `Cannot reach CDP at ${host}:${port} — is ZCode running with --remote-debugging-port=${port}?`
    );
  }
  if (!res.ok) throw new CdpError(`CDP /json/list returned HTTP ${res.status}`);
  return (await res.json()) as CdpTarget[];
}

/** The main chat window renderer; excludes webviews, helpers and devtools. */
export function pickRendererTargets(targets: CdpTarget[]): CdpTarget[] {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const main = pages.filter(
    (t) => t.url.includes("out/renderer/index.html") || t.title === "ZCode"
  );
  return main.length > 0 ? main : pages.filter((t) => !t.url.includes("devtools://"));
}

/**
 * ZCode only exposes CDP when started with the flag, and the port is whatever
 * the launching shortcut chose. Scan a small range and return the first port
 * that answers with a ZCode page target.
 *
 * The result is remembered: the poll loop calls this every 1.5s, and re-probing
 * 19 ports each tick is pure overhead. The cache is dropped when the port stops
 * responding so a ZCode restart (possibly on a new port) is still found.
 */
let cachedPort: number | undefined;

export function forgetCdpPort(): void {
  cachedPort = undefined;
}

export async function discoverCdpPort(preferred?: number): Promise<number | undefined> {
  if (cachedPort !== undefined) {
    try {
      const targets = await listTargets(cachedPort);
      if (pickRendererTargets(targets).length > 0) return cachedPort;
    } catch {
      cachedPort = undefined; // stale; fall through to a full scan
    }
  }

  const candidates: number[] = [];
  if (preferred && preferred > 0) candidates.push(preferred);
  for (let p = 9222; p <= 9240; p++) if (!candidates.includes(p)) candidates.push(p);

  const probe = async (port: number): Promise<number | undefined> => {
    try {
      const targets = await listTargets(port);
      return pickRendererTargets(targets).length > 0 ? port : undefined;
    } catch {
      return undefined;
    }
  };

  const results = await Promise.all(candidates.map(probe));
  const found = results.find((p) => p !== undefined);
  if (found) cachedPort = found;
  return found;
}

export class CdpConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<(params: unknown) => void>>();

  private constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new CdpError(`${msg.error.message} (code ${msg.error.code})`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        this.eventHandlers.get(msg.method)?.forEach((h) => h(msg.params));
      }
    });
    this.ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new CdpError("CDP connection closed"));
      this.pending.clear();
    });
  }

  static connect(wsUrl: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const conn = new CdpConnection(wsUrl);
      const timer = setTimeout(() => reject(new CdpError("CDP websocket connect timeout")), 5000);
      conn.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(conn);
      });
      conn.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError(`CDP websocket error for ${wsUrl}`));
      });
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
