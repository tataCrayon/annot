import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_WORKBENCH_PORT = 8787;
export interface WorkbenchOptions {
  port?: number;
  timeoutMs?: number;
  cwd?: string;
  rootConfigPath?: string;
  entryPoint?: string;
  openBrowser?: boolean;
}

export interface WorkbenchRecord {
  version: 1;
  pid: number;
  port: number;
  url: string;
  instanceId: string;
  startedAt: string;
}

export interface WorkbenchStatus {
  running: boolean;
  managed: boolean;
  url: string;
  port: number;
  pid?: number;
  instanceId?: string;
  skills?: number;
  roots?: number;
  record?: WorkbenchRecord;
}

export interface OpenWorkbenchStatus extends WorkbenchStatus {
  started: boolean;
  opened: boolean;
  logPath: string;
}

interface ApiStatus {
  host?: string;
  pid?: number;
  instanceId?: string;
  skills?: number;
  roots?: unknown[];
}

export async function openWorkbench(options: WorkbenchOptions = {}): Promise<OpenWorkbenchStatus> {
  const port = validPort(options.port);
  const cwd = resolve(options.cwd ?? process.cwd());
  const recordPath = workbenchRecordPath(cwd);
  const current = await inspectWorkbench(port, cwd);
  if (current.running) {
    if (current.record && current.pid !== undefined && current.record.pid !== current.pid) await removeRecord(recordPath);
    const opened = await openIfRequested(options, current.url);
    return { ...current, started: false, opened, logPath: workbenchLogPath(cwd, port) };
  }
  if (await portOccupied(port)) throw new Error(`port ${port} is already used by a service that is not an annot workbench`);
  await mkdir(dirname(recordPath), { recursive: true });
  const logPath = workbenchLogPath(cwd, port);
  const child = startWorkbenchChild(options, port, cwd, logPath);
  const status = await waitForStartup(child, options, port, cwd, logPath);
  const record = buildRecord(child, status);
  await writeRecord(recordPath, record);
  const opened = await openIfRequested(options, status.url);
  return { ...status, managed: true, record, started: true, opened, logPath };
}

function startWorkbenchChild(options: WorkbenchOptions, port: number, cwd: string, logPath: string): ChildProcess {
  const log = openSync(logPath, 'a');
  const entryPoint = options.entryPoint ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'annot.ts');
  const rootConfigPath = resolve(options.rootConfigPath ?? join(cwd, '.annot', 'web-roots.json'));
  const child = spawn(process.execPath, [entryPoint, 'web', '--port', String(port), '--root-config', rootConfigPath], {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  closeSync(log);
  return child;
}

async function waitForStartup(child: ChildProcess, options: WorkbenchOptions, port: number, cwd: string, logPath: string): Promise<WorkbenchStatus> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let failure: Error | undefined;
  child.once('error', (error) => { failure = error; });
  while (Date.now() < deadline) {
    if (failure) throw failure;
    const status = await inspectWorkbench(port, cwd);
    if (status.running && status.instanceId) return status;
    if (child.exitCode !== null) throw new Error(`annot workbench exited during startup (code ${child.exitCode}); see ${logPath}`);
    await delay(120);
  }
  throw new Error(`annot workbench did not become ready within ${timeoutMs}ms; see ${logPath}`);
}

function buildRecord(child: ChildProcess, status: WorkbenchStatus): WorkbenchRecord {
  return {
    version: 1,
    pid: child.pid ?? status.pid ?? 0,
    port: status.port,
    url: status.url,
    instanceId: status.instanceId ?? '',
    startedAt: new Date().toISOString(),
  };
}

async function openIfRequested(options: WorkbenchOptions, url: string): Promise<boolean> {
  return options.openBrowser === false ? false : openBrowserUrl(url);
}

export async function workbenchStatus(options: WorkbenchOptions = {}): Promise<WorkbenchStatus> {
  return inspectWorkbench(validPort(options.port), resolve(options.cwd ?? process.cwd()));
}

export async function stopWorkbench(options: WorkbenchOptions = {}): Promise<WorkbenchStatus> {
  const port = validPort(options.port);
  const cwd = resolve(options.cwd ?? process.cwd());
  const recordPath = workbenchRecordPath(cwd);
  const current = await inspectWorkbench(port, cwd);
  if (!current.running) {
    await removeRecord(recordPath);
    return current;
  }
  if (!current.managed || !current.record) throw new Error(`annot workbench at ${current.url} is not managed by ${recordPath}`);
  process.kill(current.record.pid, 'SIGTERM');
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  while (Date.now() < deadline) {
    if (!(await inspectWorkbench(port, cwd)).running) {
      await removeRecord(recordPath);
      return { ...current, running: false };
    }
    await delay(120);
  }
  throw new Error(`annot workbench pid ${current.record.pid} did not stop within ${options.timeoutMs ?? 5_000}ms`);
}

export function workbenchRecordPath(cwd = process.cwd()): string { return join(cwd, '.annot', 'workbench.json'); }
export function workbenchLogPath(cwd: string, port: number): string { return join(cwd, '.annot', `workbench-${port}.log`); }

async function inspectWorkbench(port: number, cwd: string): Promise<WorkbenchStatus> {
  const url = `http://127.0.0.1:${port}`;
  const record = await readRecord(workbenchRecordPath(cwd));
  const api = await probe(url);
  if (!api) return { running: false, managed: false, url, port, record };
  return { running: true, managed: Boolean(record?.instanceId && record.instanceId === api.instanceId), url, port, pid: api.pid, instanceId: api.instanceId, skills: api.skills, roots: Array.isArray(api.roots) ? api.roots.length : undefined, record };
}

async function probe(url: string): Promise<ApiStatus | undefined> {
  try {
    const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return undefined;
    const value = await response.json() as ApiStatus;
    return value.host === '127.0.0.1' && typeof value.instanceId === 'string' ? value : undefined;
  } catch { return undefined; }
}

async function portOccupied(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (occupied: boolean) => { socket.destroy(); done(occupied); };
    socket.setTimeout(400, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function readRecord(path: string): Promise<WorkbenchRecord | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as WorkbenchRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; return undefined; }
}

async function writeRecord(path: string, record: WorkbenchRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', 'utf8');
  await rename(temporary, path);
}

async function removeRecord(path: string): Promise<void> { await rm(path, { force: true }); }

async function openBrowserUrl(url: string): Promise<boolean> {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((done) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => { child.unref(); done(true); });
    child.once('error', () => done(false));
  });
}

function validPort(value: number | undefined): number {
  const port = value ?? DEFAULT_WORKBENCH_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be an integer between 1 and 65535');
  return port;
}

function delay(ms: number): Promise<void> { return new Promise((done) => setTimeout(done, ms)); }
