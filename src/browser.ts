/**
 * A zero-dependency Chrome DevTools Protocol client.
 *
 * The point is not "take a screenshot". A screenshot proves a page painted
 * *something*; it cannot prove the nodes fit inside their cards, that nothing
 * was fetched over the network, or that no script threw after the first frame.
 * Those are the questions that decide whether a generated HTML is trustworthy,
 * and every one of them is answerable over CDP in a single evaluate.
 *
 * Implementation notes that cost real debugging time:
 *   - the browser's stderr goes to a FILE, not a pipe: pipe capture is blocked
 *     under the sandbox, and a file works everywhere;
 *   - the WebSocket endpoint is only known at runtime because the port is 0,
 *     so it is parsed back out of that file;
 *   - commands are flattened to a session id rather than using per-target
 *     sockets, so one connection drives the whole run.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.ANNOT_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export interface Browser {
  /** Load a file:// URL and wait for the load event. */
  navigate(fileUrl: string): Promise<void>;
  /** Evaluate an expression in the page and return its JSON value. */
  evaluate<T>(expression: string): Promise<T>;
  /** Capture a PNG screenshot of the current viewport. */
  screenshot(): Promise<Buffer>;
  /** Resize the viewport; takes effect before the next evaluate. */
  setViewport(width: number, height: number): Promise<void>;
  /** Console errors and uncaught exceptions seen so far. */
  problems(): string[];
  /** Network requests attempted by the page, excluding the document itself. */
  requests(): string[];
  /** Forget accumulated problems/requests, e.g. between viewports. */
  reset(): void;
  close(): Promise<void>;
}

export class BrowserUnavailable extends Error {}

export function findBrowser(): string | undefined {
  return CANDIDATES.find((path) => Boolean(path) && existsSync(path as string));
}

export async function openBrowser(): Promise<Browser> {
  const executable = findBrowser();
  if (!executable) throw new BrowserUnavailable('no Chrome/Chromium/Edge found (set ANNOT_CHROME)');

  const dir = await mkdtemp(join(tmpdir(), 'annot-cdp-'));
  const logPath = join(dir, 'browser.log');

  // The child's stderr is redirected to a file rather than a pipe: pipe capture
  // is blocked in confined environments, and a file is the one sink that works
  // everywhere. We need the log anyway — the DevTools port is chosen by the
  // browser (port 0) and is only announced there.
  const logFd = openSync(logPath, 'a');
  let child: ChildProcess;
  try {
    child = launch(executable, dir, logFd);
  } finally {
    closeSync(logFd);
  }

  let socket: Cdp | undefined;
  try {
    const wsUrl = await waitForEndpoint(logPath, child);
    socket = await Cdp.connect(wsUrl);
    const created = await socket.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const attached = await socket.send<{ sessionId: string }>('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    const page = new Page(socket, attached.sessionId, child, dir);
    await page.init();
    return page;
  } catch (error) {
    socket?.close();
    child.kill();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function launch(executable: string, dir: string, logFd: number): ChildProcess {
  return spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${join(dir, 'profile')}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', logFd], windowsHide: true },
  );
}

async function waitForEndpoint(logPath: string, child: ChildProcess, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readFile(logPath, 'utf8').catch(() => '');
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
    if (match) return match[1];
    if (child.exitCode !== null) throw new BrowserUnavailable(`browser exited early (${child.exitCode}): ${text.slice(-400)}`);
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new BrowserUnavailable(`browser did not expose a DevTools endpoint within ${timeoutMs}ms`);
}

/** Minimal request/response framing over one WebSocket. */
class Cdp {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  onEvent: (method: string, params: unknown) => void = () => undefined;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown };
      if (msg.id !== undefined) {
        const waiter = this.pending.get(msg.id);
        if (!waiter) return;
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message));
        else waiter.resolve(msg.result);
        return;
      }
      if (msg.method) this.onEvent(msg.method, msg.params);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new Cdp(socket)), { once: true });
      socket.addEventListener('error', () => reject(new BrowserUnavailable(`cannot connect to ${url}`)), { once: true });
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket.send(payload);
    });
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // already closed
    }
  }
}

class Page implements Browser {
  private cdp: Cdp;
  private sessionId: string;
  private child: ChildProcess;
  private dir: string;
  private errors: string[] = [];
  private http: string[] = [];

  constructor(cdp: Cdp, sessionId: string, child: ChildProcess, dir: string) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.child = child;
    this.dir = dir;

    cdp.onEvent = (method, params) => {
      const p = params as Record<string, unknown>;
      if (method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
        this.errors.push(d?.exception?.description ?? d?.text ?? 'uncaught exception');
      }
      if (method === 'Log.entryAdded') {
        const entry = p.entry as { level?: string; text?: string } | undefined;
        if (entry?.level === 'error') this.errors.push(entry.text ?? 'console error');
      }
      if (method === 'Network.requestWillBeSent') {
        const request = p.request as { url?: string } | undefined;
        const url = request?.url ?? '';
        if (url && !url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('about:')) this.http.push(url);
      }
    };
  }

  async init(): Promise<void> {
    await this.cdp.send('Runtime.enable', {}, this.sessionId);
    await this.cdp.send('Log.enable', {}, this.sessionId);
    await this.cdp.send('Network.enable', {}, this.sessionId);
    await this.cdp.send('Page.enable', {}, this.sessionId);
  }

  async navigate(fileUrl: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => {
      const previous = this.cdp.onEvent;
      this.cdp.onEvent = (method, params) => {
        previous(method, params);
        if (method === 'Page.loadEventFired') {
          this.cdp.onEvent = previous;
          resolve();
        }
      };
    });
    await this.cdp.send('Page.navigate', { url: fileUrl }, this.sessionId);
    await loaded;
    // One frame of grace so a script that throws on first paint is recorded
    // before any assertion reads the error list.
    await new Promise((r) => setTimeout(r, 120));
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height },
      this.sessionId,
    );
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.cdp.send<{ result: { value?: unknown; description?: string }; exceptionDetails?: { text?: string } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text ?? 'unknown'}`);
    return result.result.value as T;
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, this.sessionId);
    return Buffer.from(result.data, 'base64');
  }

  problems(): string[] {
    return [...this.errors];
  }

  requests(): string[] {
    return [...this.http];
  }

  reset(): void {
    this.errors = [];
    this.http = [];
  }

  async close(): Promise<void> {
    this.cdp.close();
    this.child.kill();
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export { Page as CdpPage };
