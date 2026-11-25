import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditRoots } from './audit.ts';
import { AnalysisValidationError, StaleAnalysisError, buildAnalysisPrompt, buildEvaluationPrompt, buildFlowFromAnalysis, parseAnalysisProposal, proposalFileName } from './analysis.ts';
import { buildEditContext } from './context.ts';
import { DEFAULT_RANKS, defaultRoots, discoverSkills, type RootSpec, type SkillRef } from './discover.ts';
import { buildFlow } from './flow.ts';
import { formatRewriteBrief } from './improve.ts';
import { parseSkill, slugify } from './parse.ts';
import { renderHtml, layoutNodes } from './render.ts';
import { searchSkills } from './search.ts';
import { EVALUATION_METRICS, reviewSkill } from './standards.ts';
import { buildRepairPlan, formatRepairTask, unresolvedCheckIds } from './repair.ts';
import { buildLibraryReport, formatLibraryMarkdown, formatLibraryOptimizationPrompt } from './library-report.ts';
import { createSnapshot, diffSnapshots, listSnapshots } from './versions.ts';
import type { FlowDoc } from './types.ts';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const SYSTEM_SKILLS_ROOT = resolve(WEB_ROOT, '..', 'plugins', 'annot', 'skills');
const MAX_BRIEF_BYTES = 16 * 1024;
const MAX_ROOTS_BYTES = 64 * 1024;
const MAX_ROOTS = 64;
/**
 * A stamp of the engine that produced a layout.
 *
 * The workbench runs as a background daemon, so after `git pull` the browser is
 * still served by a process started from the old code: the page reloads, the
 * JavaScript moves, and the layout it receives does not. One 409 that says
 * "the engine changed, restart the workbench" is worth more than a silent
 * mismatch that reads as "the fix did not work".
 */
const WEB_SOURCE = fileURLToPath(import.meta.url);
const RENDER_SOURCE = fileURLToPath(new URL('./render.ts', import.meta.url));
// Tests that serve two builds from one process need one half of the pair to
// differ; production always reads what is on disk.
let buildOverride: string | undefined;

function readBuildSource(path: string, fallback?: string): string {
  if (fallback !== undefined) return fallback;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // A published package could omit a source file; a stable stamp beats a crash.
    return '';
  }
}

/**
 * Fingerprint of the code this process loaded.
 *
 * One implementation, used by the server (`/api/status`) and by `workbench.ts`
 * when it compares a running daemon against the disk. Two copies of this hash
 * would drift the first time one of them changed which files it reads, and the
 * symptom would be a workbench that either never restarts or always does.
 */
export function buildSignature(web = readBuildSource(WEB_SOURCE, buildOverride), render = readBuildSource(RENDER_SOURCE)): string {
  return createHash('sha256').update(web).update(render).digest('hex').slice(0, 12);
}

/**
 * Serve a given fingerprint instead of the web source. Test-only: it is how a
 * stale daemon is reproduced without editing the repository mid-test.
 */
export function setBuildOverrideForTests(web?: string): void {
  buildOverride = web;
  loadedBuild = undefined;
}

/**
 * The stamp of the code *this process loaded*, captured once.
 *
 * Reading the files on every request would make a daemon compare the disk
 * against the disk, so a process still running yesterday's renderer would
 * report itself up to date forever — which is exactly the failure the stamp
 * exists to catch. Capture at the moment the server starts; a later edit to
 * `render.ts` must then show up as build ≠ currentBuild.
 */
let loadedBuild: string | undefined;

export function loadedBuildSignature(): string {
  return (loadedBuild ??= buildSignature());
}

const ASSETS = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/app.css', { file: 'app.css', type: 'text/css; charset=utf-8' }],
]);

export interface WebServerOptions {
  roots: RootSpec[];
  defaultRoots?: RootSpec[];
  rootConfigPath?: string;
  port?: number;
  analysisDir?: string;
  snapshotDir?: string;
  reportDir?: string;
  /** Where `POST /api/tasks` writes handoff files, default `<cwd>/.annot/tasks`. */
  taskDir?: string;
}

export interface RunningWebServer {
  url: string;
  close(): Promise<void>;
}

export async function startWebServer(options: WebServerOptions): Promise<RunningWebServer> {
  const analysisDir = resolve(options.analysisDir ?? join(process.cwd(), '.annot', 'analyses'));
  const snapshotDir = resolve(options.snapshotDir ?? join(process.cwd(), '.annot', 'snapshots'));
  const reportDir = resolve(options.reportDir ?? join(process.cwd(), '.annot', 'reports'));
  const taskDir = resolve(options.taskDir ?? join(process.cwd(), '.annot', 'tasks'));
  const rootState: WebRootState = {
    active: options.roots,
    defaults: options.defaultRoots ?? options.roots,
    configPath: options.rootConfigPath,
    instanceId: randomUUID(),
    build: loadedBuildSignature(),
  };
  const server = createServer((req, res) => void handleRequest(req, res, server, rootState, analysisDir, snapshotDir, reportDir, taskDir));
  await listen(server, options.port ?? 8787);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('web server did not bind to a TCP port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => close(server) };
}

export function webRootConfigPath(cwd = process.cwd()): string {
  return join(cwd, '.annot', 'web-roots.json');
}

export async function loadWebRoots(configPath: string, defaults: RootSpec[]): Promise<RootSpec[]> {
  try {
    const payload = JSON.parse(await readFile(configPath, 'utf8')) as { paths?: unknown };
    return normalizeWebRoots(payload.paths, defaults);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
    throw new Error(`could not read web root configuration ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeWebRoots(value: unknown, defaults: RootSpec[], cwd = process.cwd()): RootSpec[] {
  if (!Array.isArray(value)) throw new RequestProblem(400, 'paths must be an array');
  if (value.length === 0) throw new RequestProblem(400, 'at least one Skill root is required');
  if (value.length > MAX_ROOTS) throw new RequestProblem(400, `at most ${MAX_ROOTS} Skill roots are allowed`);

  const byPath = new Map(defaults.map((root) => [pathKey(root.path), root]));
  const seen = new Set<string>();
  const roots: RootSpec[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new RequestProblem(400, 'every Skill root path must be a string');
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > 1024) throw new RequestProblem(400, 'a Skill root path is too long');
    const expanded = trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? join(homedir(), trimmed.slice(trimmed === '~' ? 1 : 2))
      : trimmed;
    const path = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = byPath.get(key);
    roots.push(known ?? { path, rank: DEFAULT_RANKS.custom + roots.length, label: `custom · ${path}` });
  }
  if (roots.length === 0) throw new RequestProblem(400, 'at least one non-empty Skill root path is required');
  return roots;
}

function pathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function webRoots(
  cwd = process.cwd(),
  home = homedir(),
  env: Record<string, string | undefined> = process.env,
): RootSpec[] {
  return defaultRoots({
    cwd,
    home,
    codexHome: env.CODEX_HOME,
    claudeHome: env.CLAUDE_CONFIG_DIR,
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, server: Server, state: WebRootState, analysisDir: string, snapshotDir: string, reportDir: string, taskDir: string): Promise<void> {
  try {
    if (!isTrustedRequest(req, server)) {
      req.resume();
      return writeJson(res, 403, { error: 'loopback only' });
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/brief') {
      if (req.method !== 'POST') return await methodNotAllowed(req, res, 'POST');
      return await handleBrief(req, res, state.active, analysisDir);
    }
    if (url.pathname === '/api/tasks') {
      if (req.method !== 'POST') return await methodNotAllowed(req, res, 'POST');
      return await handleTaskExport(req, res, state.active, analysisDir, taskDir);
    }
    if (url.pathname === '/api/library-report/task') {
      if (req.method !== 'POST') return await methodNotAllowed(req, res, 'POST');
      return await handleLibraryTask(req, res, state.active, snapshotDir, reportDir);
    }
    if (url.pathname === '/api/snapshots' && req.method === 'POST') {
      return await handleSnapshotCreate(req, res, state.active, snapshotDir);
    }
    if (url.pathname === '/api/roots') {
      if (req.method !== 'PUT') return await methodNotAllowed(req, res, 'PUT');
      return await handleRootConfig(req, res, state);
    }
    if (req.method !== 'GET') return await methodNotAllowed(req, res, 'GET');
    const asset = ASSETS.get(url.pathname);
    if (asset) return await serveAsset(res, asset.file, asset.type);
    if (!url.pathname.startsWith('/api/')) return writeJson(res, 404, { error: 'not found' });
    return await handleApi(url, res, state, analysisDir, snapshotDir);
  } catch (error) {
    if (error instanceof RequestProblem) {
      req.resume();
      return writeJson(res, error.status, { error: error.message }, { connection: 'close' });
    }
    req.resume();
    return writeJson(res, 400, { error: 'invalid request' }, { connection: 'close' });
  }
}

function isTrustedRequest(req: IncomingMessage, server: Server): boolean {
  const remote = req.socket.remoteAddress;
  if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1' && remote !== '::1') return false;
  if (req.headers['x-forwarded-for'] !== undefined) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const host = req.headers.host;
  const origin = req.headers.origin;
  const port = server.address() && typeof server.address() !== 'string' ? server.address().port : -1;
  if (!isLoopbackAuthority(host, port)) return false;
  return origin === undefined || isLoopbackOrigin(origin, port);
}

function isLoopbackOrigin(origin: string, port: number): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && isLoopbackAuthority(url.host, port);
  } catch {
    return false;
  }
}

function isLoopbackAuthority(authority: string | undefined, port: number): boolean {
  if (!authority) return false;
  const parsed = /^([^:]+):(\d+)$/.exec(authority);
  if (!parsed || Number(parsed[2]) !== port) return false;
  return parsed[1] === '127.0.0.1' || parsed[1] === 'localhost';
}

class RequestProblem extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface BriefRequest {
  name: string;
  source: 'user' | 'system';
  node?: string;
  intent: string;
  mode: 'rewrite' | 'analyze' | 'evaluate' | 'repair';
  metrics: string[];
  /** Only for mode=repair: which failing standard checks to include. */
  checks: string[];
}

interface WebRootState {
  active: RootSpec[];
  defaults: RootSpec[];
  configPath?: string;
  instanceId: string;
  /** The engine this process loaded, stamped once at startup. */
  build: string;
}

async function handleRootConfig(req: IncomingMessage, res: ServerResponse, state: WebRootState): Promise<void> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new RequestProblem(415, 'content-type must be application/json');
  }
  const raw = await readBody(req, MAX_ROOTS_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestProblem(400, 'request body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestProblem(400, 'request body must be an object');
  const body = value as Record<string, unknown>;
  const reset = body.reset === true;
  if (reset && body.paths !== undefined) throw new RequestProblem(400, 'send paths or reset, not both');
  const roots = reset ? state.defaults : normalizeWebRoots(body.paths, state.defaults);
  state.active = roots;
  let persisted = false;
  if (state.configPath) {
    await saveRootConfig(state.configPath, roots);
    persisted = true;
  }
  await sendStatus(res, state, persisted);
}

async function saveRootConfig(configPath: string, roots: RootSpec[]): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  const payload = JSON.stringify({ version: 1, paths: roots.map((root) => root.path) }, null, 2) + '\n';
  await writeFile(temporary, payload, 'utf8');
  await rename(temporary, configPath);
}

/**
 * Write a generated task to a file and hand back the command that runs it.
 *
 * The workbench has always been able to copy a task to the clipboard, and that
 * is where it stopped: the reader then had to find a terminal, paste 40KB into
 * an agent, and hope the quoting survived. A file plus one line is the same
 * handoff with none of that. The web server still never executes anything and
 * never writes into a Skill — it writes one Markdown file under `.annot/tasks/`
 * and prints the path.
 *
 * The command uses `cat` on POSIX and `Get-Content -Raw` on Windows because the
 * task contains newlines and quotes that defeat `-p "$(type file)"`.
 */
async function handleTaskExport(
  req: IncomingMessage,
  res: ServerResponse,
  roots: RootSpec[],
  analysisDir: string,
  taskDir: string,
): Promise<void> {
  const request = await readTaskRequest(req);
  const ref = await findSkillRef(request.name, roots, request.source);
  if (!ref) throw new RequestProblem(404, 'Skill was not found in the current scan');
  const source = await readFile(ref.file, 'utf8');
  // The export route cannot answer a stale analysis with a 409 payload, so it
  // says the same thing with the sentence it can carry.
  let doc: FlowDoc | undefined;
  try {
    doc = await flowFromRef(ref, analysisDir);
  } catch (error) {
    if (error instanceof StaleAnalysisError) {
      throw new RequestProblem(409, `the AI analysis on disk was written for an older version of this Skill; re-run annot-analyse to replace ${error.detail.analysisPath}`);
    }
    throw error;
  }
  const node = request.mode === 'rewrite'
    ? doc?.nodes.find((candidate) => candidate.id === request.node)
    : undefined;
  if (request.mode === 'rewrite' && !node) {
    throw new RequestProblem(409, doc ? 'node was not found in the current Skill' : 'this Skill has no AI analysis yet, so there is no card to rewrite');
  }
  const brief = await taskBrief({ request, ref, source, doc, node, analysisDir });
  const skill = slugify(ref.name);
  const suffix = request.mode === 'rewrite' ? `.${slugify(node?.id ?? 'node').slice(0, 40)}` : '';
  const file = join(taskDir, `${skill}.${request.mode}${suffix}.md`);
  await mkdir(taskDir, { recursive: true });
  await writeFile(file, brief, 'utf8');
  const command = process.platform === 'win32'
    ? `claude -p (Get-Content -Raw '${file.replace(/'/g, "''")}')`
    : `claude -p "$(cat '${file}')"`;
  writeJson(res, 201, {
    skill: ref.name,
    mode: request.mode,
    file,
    command,
    bytes: Buffer.byteLength(brief, 'utf8'),
    claudeFound: await claudeAvailable(),
    writesSource: false,
  });
}

/**
 * Is there a `claude` on PATH?
 *
 * Only reported, never used to launch anything: the page says "run this command"
 * and a user with no CLI installed should learn that here rather than from a
 * shell error after pasting. Resolved through PATH rather than through a shell
 * so nothing from the task text can reach a command line.
 */
async function claudeAvailable(): Promise<boolean> {
  const tool = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      await stat(join(dir, tool));
      return true;
    } catch {
      // Keep looking: PATH entries routinely include directories that exist for
      // another toolchain. Only a real file counts.
    }
  }
  return false;
}

async function taskBrief(input: {
  request: TaskRequest;
  ref: SkillRef;
  source: string;
  doc: FlowDoc | undefined;
  node: FlowDoc['nodes'][number] | undefined;
  /** Where the workbench reads proposals; the analyze task must name this exact file. */
  analysisDir: string;
}): Promise<string> {
  const { request, ref, source, doc, node, analysisDir } = input;
  const header = [
    `# annot 任务：${request.mode} · ${ref.name}`,
    '',
    `源文件：${ref.file}`,
    `源哈希：${parseSkill(source).sha.slice(0, 12)}`,
    '边界：写完后运行 annot check / annot review 验证；annot 不会自己改 Skill。',
    '',
  ].join('\n');
  if (request.mode === 'rewrite' && node) {
    const context = buildEditContext(doc!, node.id);
    if (!context) throw new RequestProblem(409, 'node was not found in the current Skill');
    return `${header}${formatRewriteBrief(context, request.intent)}\n`;
  }
  if (request.mode === 'analyze') {
    const proposalPath = join(analysisDir, `${slugify(ref.name)}.analysis.json`);
    return `${header}${buildAnalysisPrompt(source, ref.file, { analysisPath: proposalPath })}\n`;
  }
  if (request.mode === 'evaluate') return `${header}${buildEvaluationPrompt(source, ref.file, request.intent, request.metrics)}\n`;
  const report = await reviewSkill(source, ref.file);
  const known = new Set(report.checks.map((check) => check.id));
  const unknown = request.checks.filter((id) => !known.has(id));
  if (unknown.length) throw new RequestProblem(400, `unknown check: ${unknown.join(', ')}`);
  const plan = buildRepairPlan(report, source, {
    checkIds: request.checks,
    note: request.intent,
    analysisPath: join(analysisDir, `${slugify(ref.name)}.analysis.json`),
  });
  const stale = unresolvedCheckIds(report, plan, request.checks);
  if (stale.length) throw new RequestProblem(409, `checks already pass or nothing to repair: ${stale.join(', ')}; refresh the review before generating a task`);
  return `${header}${formatRepairTask(plan)}\n`;
}

interface TaskRequest {
  name: string;
  source: 'user' | 'system';
  mode: 'rewrite' | 'analyze' | 'evaluate' | 'repair';
  node?: string;
  intent: string;
  metrics: string[];
  checks: string[];
}

async function readTaskRequest(req: IncomingMessage): Promise<TaskRequest> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new RequestProblem(415, 'content-type must be application/json');
  }
  const raw = await readBody(req, MAX_BRIEF_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestProblem(400, 'request body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestProblem(400, 'request body must be an object');
  const body = value as Record<string, unknown>;
  const mode = body.mode;
  if (mode !== 'rewrite' && mode !== 'analyze' && mode !== 'evaluate' && mode !== 'repair') {
    throw new RequestProblem(400, 'mode must be rewrite, analyze, evaluate, or repair');
  }
  const metrics = Array.isArray(body.metrics) ? body.metrics.map((item) => String(item)) : [];
  return {
    name: boundedString(body.name, 'name', 300, true),
    source: body.source === 'system' ? 'system' : 'user',
    mode,
    node: body.node === undefined ? undefined : boundedString(body.node, 'node', 300, true),
    intent: boundedString(body.intent, 'intent', 8000),
    metrics: metrics.filter((id) => EVALUATION_METRICS.some((metric) => metric.id === id)),
    checks: Array.isArray(body.checks) ? body.checks.map((item) => String(item)) : [],
  };
}

async function handleBrief(req: IncomingMessage, res: ServerResponse, roots: RootSpec[], analysisDir: string): Promise<void> {
  const request = await readBriefRequest(req);
  const ref = await findSkillRef(request.name, roots, request.source);
  if (!ref) throw new RequestProblem(404, 'Skill was not found in the current scan');
  const source = await readFile(ref.file, 'utf8');
  if (request.mode === 'analyze') {
    return writeJson(res, 200, {
      mode: 'analyze', skill: request.name, method: 'ai',
      analysisPath: join(analysisDir, proposalFileName(ref.name)),
      brief: buildAnalysisPrompt(source, ref.file, { analysisPath: join(analysisDir, proposalFileName(ref.name)) }),
      writesSource: false,
    });
  }
  if (request.mode === 'evaluate') {
    return writeJson(res, 200, {
      mode: 'evaluate', skill: request.name, sourceFile: ref.file, method: 'ai', metrics: request.metrics,
      brief: buildEvaluationPrompt(source, ref.file, request.intent, request.metrics), writesSource: false,
    });
  }
  if (request.mode === 'repair') {
    // Repair quotes the exact bytes a fix would touch, so the task cannot drift
    // from the finding that produced it. It also never writes: the host edits
    // and `annot review` is the only thing that decides the item is fixed.
    const report = await reviewSkill(source, ref.file);
    const known = new Set(report.checks.map((check) => check.id));
    const unknown = request.checks.filter((id) => !known.has(id));
    if (unknown.length) throw new RequestProblem(400, `unknown check: ${unknown.join(', ')}`);
    const plan = buildRepairPlan(report, source, {
      checkIds: request.checks,
      note: request.intent,
      analysisPath: join(analysisDir, `${slugify(ref.name)}.analysis.json`),
    });
    const stale = unresolvedCheckIds(report, plan, request.checks);
    if (stale.length) {
      throw new RequestProblem(409, `checks already pass or nothing to repair: ${stale.join(', ')}; refresh the review before generating a repair task`);
    }
    return writeJson(res, 200, {
      mode: 'repair', skill: report.skill, sourceFile: ref.file, source_sha: report.source_sha,
      readiness: report.readiness,
      targets: plan.targets.map((item) => ({ id: item.check.id, status: item.check.status, artifact: item.artifact, lines: item.check.lines ?? [] })),
      unfixable: plan.unfixable.map((check) => check.id),
      note: plan.note ?? '',
      brief: formatRepairTask(plan), writesSource: false,
    });
  }
  let doc: FlowDoc | undefined;
  try {
    doc = await flowFromRef(ref, analysisDir);
  } catch (error) {
    if (error instanceof StaleAnalysisError) {
      throw new RequestProblem(409, `the AI analysis on disk was written for an older version of this Skill; re-run the analysis task to replace ${error.detail.analysisPath}`);
    }
    throw error;
  }
  if (!doc) throw new RequestProblem(409, 'this Skill has no AI analysis yet; generate the analysis task first');
  const context = buildEditContext(doc, request.node ?? '');
  if (!context) throw new RequestProblem(404, 'node was not found in the current Skill');
  return sendRewriteBrief(res, request, context);
}

async function readBriefRequest(req: IncomingMessage): Promise<BriefRequest> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new RequestProblem(415, 'content-type must be application/json');
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BRIEF_BYTES) throw new RequestProblem(413, 'request body is too large');
  const raw = await readBody(req);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestProblem(400, 'request body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestProblem(400, 'request body must be an object');
  const body = value as Record<string, unknown>;
  const mode = boundedString(body.mode, 'mode', 20, true);
  if (mode !== 'rewrite' && mode !== 'analyze' && mode !== 'evaluate' && mode !== 'repair') throw new RequestProblem(400, 'mode must be rewrite, analyze, evaluate, or repair');
  const node = boundedString(body.node, 'node', 300, mode === 'rewrite');
  return {
    name: boundedString(body.name, 'name', 200, true),
    source: readSkillSource(body.source),
    node: node || undefined,
    intent: boundedString(body.intent, 'intent', 8000),
    mode,
    metrics: readMetricIds(body.metrics),
    checks: readCheckIds(body.checks),
  };
}

function readCheckIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new RequestProblem(400, 'checks must be an array');
  if (value.length > 32) throw new RequestProblem(400, 'too many checks');
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 60) throw new RequestProblem(400, 'check ids must be strings');
    seen.add(item.trim());
  }
  return [...seen].filter(Boolean);
}

function readSkillSource(value: unknown): 'user' | 'system' {
  if (value === undefined || value === null || value === '') return 'user';
  if (value !== 'user' && value !== 'system') throw new RequestProblem(400, 'source must be user or system');
  return value;
}
function readMetricIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new RequestProblem(400, 'metrics must be an array');
  if (value.length > EVALUATION_METRICS.length) throw new RequestProblem(400, 'too many metrics');
  const allowed = new Set(EVALUATION_METRICS.map((metric) => metric.id));
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 40) throw new RequestProblem(400, 'metric ids must be strings');
    if (!allowed.has(item)) throw new RequestProblem(400, `unknown metric: ${item}`);
    seen.add(item);
  }
  return [...seen];
}

async function readBody(req: IncomingMessage, maxBytes = MAX_BRIEF_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new RequestProblem(413, 'request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function boundedString(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new RequestProblem(400, `${field} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new RequestProblem(400, `${field} must be a string`);
  const text = value.trim();
  if (required && !text) throw new RequestProblem(400, `${field} is required`);
  if (text.length > max) throw new RequestProblem(400, `${field} is too long`);
  return text;
}

function sendRewriteBrief(res: ServerResponse, request: BriefRequest, context: ReturnType<typeof buildEditContext>): void {
  if (!context) return;
  writeJson(res, 200, {
    mode: 'rewrite',
    skill: request.name,
    node: request.node,
    brief: formatRewriteBrief(context, request.intent),
    writesSource: false,
  });
}

async function handleApi(url: URL, res: ServerResponse, state: WebRootState, analysisDir: string, snapshotDir: string): Promise<void> {
  try {
    if (url.pathname === '/api/status') return sendStatus(res, state);
    if (url.pathname === '/api/skills') return sendSkills(res, state.active);
    if (url.pathname === '/api/system-skills') return sendSystemSkills(res);
    if (url.pathname === '/api/search') return sendSearch(url, res, state.active);
    if (url.pathname === '/api/audit') return sendAudit(res, state.active);
    if (url.pathname === '/api/library-report') return writeJson(res, 200, await buildLibraryReport(state.active));
    if (url.pathname === '/api/review') return sendReview(url, res, state.active);
    if (url.pathname === '/api/snapshots') return writeJson(res, 200, { snapshots: await listSnapshots(snapshotDir) });
    if (url.pathname === '/api/snapshots/diff') return sendSnapshotDiff(url, res, snapshotDir);
    if (url.pathname === '/api/flow') return sendFlow(url, res, state.active, analysisDir);
    if (url.pathname === '/api/graph') return sendGraph(url, res, state.active, analysisDir);
    if (url.pathname === '/api/context') return sendContext(url, res, state.active, analysisDir);
    return writeJson(res, 404, { error: 'not found' });
  } catch (error) {
    if (error instanceof AnalysisValidationError) return writeJson(res, 422, { error: error.message });
    // A stale analysis is a state the reader can act on, not a bug. It must not
    // reach the 400 catch above, because the page has a specific next step for
    // it and a generic "invalid request" hides that step.
    if (error instanceof StaleAnalysisError) {
      return writeJson(res, 409, {
        error: 'the AI analysis on disk was written for an older version of this Skill',
        reason: 'stale-analysis',
        skill: error.detail.skill,
        analysisPath: error.detail.analysisPath,
        proposalSha: error.detail.proposalSha,
        currentSha: error.detail.currentSha,
        analyze: true,
      });
    }
    return writeJson(res, 500, { error: 'could not read the configured Skill roots' });
  }
}

/** Drain the request before refusing it, or the socket stalls on a large body. */
async function methodNotAllowed(req: IncomingMessage, res: ServerResponse, allow: string): Promise<void> {
  req.resume();
  writeJson(res, 405, { error: `${allow} only` }, { allow });
}

async function readSnapshotRequest(req: IncomingMessage): Promise<string> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new RequestProblem(415, 'content-type must be application/json');
  }
  const raw = await readBody(req, 8 * 1024);
  if (!raw.trim()) return '';
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestProblem(400, 'request body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestProblem(400, 'request body must be an object');
  return boundedString((value as Record<string, unknown>).label, 'label', 120);
}

async function handleSnapshotCreate(req: IncomingMessage, res: ServerResponse, roots: RootSpec[], snapshotDir: string): Promise<void> {
  const label = await readSnapshotRequest(req);
  const snapshot = await createSnapshot(roots, snapshotDir, label || 'manual');
  writeJson(res, 201, { snapshot });
}

async function handleLibraryTask(req: IncomingMessage, res: ServerResponse, roots: RootSpec[], snapshotDir: string, reportDir: string): Promise<void> {
  const label = await readSnapshotRequest(req);
  const report = await buildLibraryReport(roots);
  const snapshot = await createSnapshot(roots, snapshotDir, label || 'before-library-optimization');
  await mkdir(reportDir, { recursive: true });
  const markdownPath = join(reportDir, `library-report-${snapshot.id}.md`);
  const reportPath = join(reportDir, `library-report-${snapshot.id}.json`);
  await writeFile(reportPath, JSON.stringify({ snapshot, report }, null, 2) + '\n', 'utf8');
  await writeFile(markdownPath, formatLibraryMarkdown(report), 'utf8');
  writeJson(res, 200, {
    mode: 'library-optimize',
    snapshot,
    reportPath,
    markdownPath,
    report,
    brief: formatLibraryOptimizationPrompt(report, snapshot, reportPath),
    writesSource: false,
  });
}

async function sendSnapshotDiff(url: URL, res: ServerResponse, snapshotDir: string): Promise<void> {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!from || !to) throw new RequestProblem(400, 'from and to snapshot ids are required');
  try {
    writeJson(res, 200, await diffSnapshots(snapshotDir, from, to));
  } catch (error) {
    throw new RequestProblem(404, error instanceof Error ? error.message : 'snapshot was not found');
  }
}
async function sendStatus(res: ServerResponse, state: WebRootState, persisted = Boolean(state.configPath)): Promise<void> {
  const found = await discoverSkills(state.active);
  writeJson(res, 200, {
    host: '127.0.0.1',
    pid: process.pid,
    instanceId: state.instanceId,
    roots: state.active,
    defaultRoots: state.defaults,
    skills: found.skills.length,
    skipped: found.skipped,
    readOnly: true,
    build: state.build,
    evaluationMetrics: EVALUATION_METRICS,
    rootConfig: { path: state.configPath ?? null, persisted, editable: true },
  });
}

async function sendSystemSkills(res: ServerResponse): Promise<void> {
  const root: RootSpec = { path: SYSTEM_SKILLS_ROOT, rank: -100, label: 'system · annot' };
  const found = await discoverSkills([root]);
  const skills = await Promise.all(found.skills.map(async (ref) => {
    const source = await readFile(ref.file, 'utf8');
    const parsed = parseSkill(source, { file: ref.file });
    return {
      name: ref.name,
      file: ref.file,
      root: ref.root,
      rank: ref.rank,
      description: parsed.description,
      role: ref.name === 'annot' ? 'primary' : 'support',
      source: 'system',
    };
  }));
  writeJson(res, 200, { skills, skipped: found.skipped, readOnly: true, source: 'system' });
}
async function sendSkills(res: ServerResponse, roots: RootSpec[]): Promise<void> {
  writeJson(res, 200, await discoverSkills(roots));
}

async function sendSearch(url: URL, res: ServerResponse, roots: RootSpec[]): Promise<void> {
  const query = url.searchParams.get('q') ?? '';
  const body = url.searchParams.get('body') === '1';
  writeJson(res, 200, await searchSkills(roots, query, { body }));
}

async function sendReview(url: URL, res: ServerResponse, roots: RootSpec[]): Promise<void> {
  const ref = await findSkillRef(url.searchParams.get('name') ?? '', roots, readSkillSource(url.searchParams.get('source')));
  if (!ref) return writeJson(res, 404, { error: 'Skill was not found in the current scan' });
  const source = await readFile(ref.file, 'utf8');
  writeJson(res, 200, await reviewSkill(source, ref.file));
}
async function sendAudit(res: ServerResponse, roots: RootSpec[]): Promise<void> {
  writeJson(res, 200, await auditRoots(roots));
}

async function sendFlow(url: URL, res: ServerResponse, roots: RootSpec[], analysisDir: string): Promise<void> {
  const ref = await findSkillRef(url.searchParams.get('name') ?? '', roots, readSkillSource(url.searchParams.get('source')));
  if (!ref) return writeJson(res, 404, { error: 'Skill was not found in the current scan' });
  let doc: FlowDoc | undefined;
  try {
    doc = await flowFromRef(ref, analysisDir);
  } catch (error) {
    if (error instanceof StaleAnalysisError) return staleAnalysisResponse(res, error, ref);
    throw error;
  }
  const analysis = await analysisState(ref, analysisDir);
  if (!doc) {
    return writeJson(res, 409, {
      error: 'this Skill has no AI analysis yet',
      reason: 'no-analysis',
      skill: ref.name,
      file: ref.file,
      analysisPath: analysis.path,
      analyze: true,
    });
  }
  writeJson(res, 200, { doc, layout: layoutNodes(doc), analysis });
}

async function sendGraph(url: URL, res: ServerResponse, roots: RootSpec[], analysisDir: string): Promise<void> {
  const ref = await findSkillRef(url.searchParams.get('name') ?? '', roots, readSkillSource(url.searchParams.get('source')));
  if (!ref) return writeJson(res, 404, { error: 'Skill was not found in the current scan' });
  let doc: FlowDoc | undefined;
  try {
    doc = await flowFromRef(ref, analysisDir);
  } catch (error) {
    if (error instanceof StaleAnalysisError) return staleAnalysisResponse(res, error, ref);
    throw error;
  }
  if (!doc) return writeJson(res, 409, { error: 'this Skill has no AI analysis yet', analyze: true });
  res.writeHead(200, {
    ...commonHeaders(),
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'",
  });
  res.end(renderHtml(doc, { embedded: url.searchParams.get('embed') === '1' }));
}

async function sendContext(url: URL, res: ServerResponse, roots: RootSpec[], analysisDir: string): Promise<void> {
  const ref = await findSkillRef(url.searchParams.get('name') ?? '', roots, readSkillSource(url.searchParams.get('source')));
  let doc: FlowDoc | undefined;
  try {
    doc = ref ? await flowFromRef(ref, analysisDir) : undefined;
  } catch (error) {
    if (error instanceof StaleAnalysisError && ref) return staleAnalysisResponse(res, error, ref);
    throw error;
  }
  if (!doc) return writeJson(res, 409, { error: 'this Skill has no AI analysis yet', analyze: true });
  const context = buildEditContext(doc, url.searchParams.get('node') ?? '');
  if (!context) return writeJson(res, 404, { error: 'node was not found in the current Skill' });
  writeJson(res, 200, context);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findSkillRef(name: string, roots: RootSpec[], source: 'user' | 'system' = 'user'): Promise<SkillRef | undefined> {
  const scanRoots = source === 'system' ? [{ path: SYSTEM_SKILLS_ROOT, rank: -100, label: 'system · annot' }] : roots;
  const { skills } = await discoverSkills(scanRoots);
  return skills.find((skill) => skill.name === name);
}

/**
 * The graph the page draws, or nothing.
 *
 * A Skill has exactly one graph, and it comes from an AI analysis. When there is
 * no analysis yet, the page says so and offers the task that produces one; it
 * does not fall back to the keyword draft, because a draft is a different
 * document that happens to be shaped like a graph, and a reader cannot tell the
 * two apart once they are on screen. `annot annotate --rules` still exists for
 * fixtures and migration.
 */
async function flowFromRef(ref: SkillRef, analysisDir: string): Promise<FlowDoc | undefined> {
  const source = await readFile(ref.file, 'utf8');
  const analysisPath = join(analysisDir, `${slugify(ref.name)}.analysis.json`);
  try {
    const proposal = parseAnalysisProposal(await readFile(analysisPath, 'utf8'));
    return buildFlowFromAnalysis(source, proposal, { sourceFile: basename(ref.file), analysisPath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * A stale analysis is not a bad graph, it is a missing one: the file on disk
 * describes an older byte-string of the Skill, so nothing it says can be
 * trusted past the first edited line. The page treats it exactly like "no
 * analysis yet" — same 409 shape, same analyze task — because the reader's next
 * step is identical, and the path it names is the file to overwrite.
 */
function staleAnalysisResponse(res: ServerResponse, error: StaleAnalysisError, skill: { name: string; file: string }): void {
  writeJson(res, 409, {
    error: 'the AI analysis on disk was written for an older version of this Skill',
    reason: 'stale-analysis',
    skill: skill.name,
    file: skill.file,
    analysisPath: error.detail.analysisPath,
    proposalSha: error.detail.proposalSha,
    currentSha: error.detail.currentSha,
    analyze: true,
  });
}

/** What the page needs to explain an empty canvas without inventing a graph. */
async function analysisState(ref: SkillRef, analysisDir: string): Promise<{ ready: boolean; path: string }> {
  const analysisPath = join(analysisDir, `${slugify(ref.name)}.analysis.json`);
  return { ready: await fileExists(analysisPath), path: analysisPath };
}

async function serveAsset(res: ServerResponse, file: string, type: string): Promise<void> {
  try {
    const body = await readFile(join(WEB_ROOT, file));
    res.writeHead(200, { ...commonHeaders(), 'content-type': type, 'content-security-policy': pagePolicy() });
    res.end(body);
  } catch {
    writeJson(res, 503, { error: 'web assets are missing; install the complete annot package' });
  }
}

function pagePolicy(): string {
  return "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
}

function writeJson(res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...commonHeaders(), ...extra, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function commonHeaders(): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
}
