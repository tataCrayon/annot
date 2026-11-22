import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditRoots } from './audit.ts';
import { AnalysisValidationError, buildAnalysisPrompt, buildEvaluationPrompt, buildFlowFromAnalysis, parseAnalysisProposal } from './analysis.ts';
import { buildEditContext } from './context.ts';
import { DEFAULT_RANKS, defaultRoots, discoverSkills, type RootSpec, type SkillRef } from './discover.ts';
import { buildFlow } from './flow.ts';
import { formatRewriteBrief } from './improve.ts';
import { parseSkill, slugify } from './parse.ts';
import { renderHtml, layoutNodes } from './render.ts';
import { searchSkills } from './search.ts';
import { EVALUATION_METRICS, reviewSkill } from './standards.ts';
import { buildLibraryReport, formatLibraryMarkdown, formatLibraryOptimizationPrompt } from './library-report.ts';
import { createSnapshot, diffSnapshots, listSnapshots } from './versions.ts';
import type { FlowDoc } from './types.ts';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const SYSTEM_SKILLS_ROOT = resolve(WEB_ROOT, '..', 'plugins', 'annot', 'skills');
const MAX_BRIEF_BYTES = 16 * 1024;
const MAX_ROOTS_BYTES = 64 * 1024;
const MAX_ROOTS = 64;
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
}

export interface RunningWebServer {
  url: string;
  close(): Promise<void>;
}

export async function startWebServer(options: WebServerOptions): Promise<RunningWebServer> {
  const analysisDir = resolve(options.analysisDir ?? join(process.cwd(), '.annot', 'analyses'));
  const snapshotDir = resolve(options.snapshotDir ?? join(process.cwd(), '.annot', 'snapshots'));
  const reportDir = resolve(options.reportDir ?? join(process.cwd(), '.annot', 'reports'));
  const rootState: WebRootState = {
    active: options.roots,
    defaults: options.defaultRoots ?? options.roots,
    configPath: options.rootConfigPath,
    instanceId: randomUUID(),
  };
  const server = createServer((req, res) => void handleRequest(req, res, server, rootState, analysisDir, snapshotDir, reportDir));
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

async function handleRequest(req: IncomingMessage, res: ServerResponse, server: Server, state: WebRootState, analysisDir: string, snapshotDir: string, reportDir: string): Promise<void> {
  try {
    if (!isTrustedRequest(req, server)) return writeJson(res, 403, { error: 'loopback only' });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/brief') {
      if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' }, { allow: 'POST' });
      return await handleBrief(req, res, state.active, analysisDir);
    }
    if (url.pathname === '/api/library-report/task') {
      if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' }, { allow: 'POST' });
      return await handleLibraryTask(req, res, state.active, snapshotDir, reportDir);
    }
    if (url.pathname === '/api/snapshots' && req.method === 'POST') {
      return await handleSnapshotCreate(req, res, state.active, snapshotDir);
    }
    if (url.pathname === '/api/roots') {
      if (req.method !== 'PUT') return writeJson(res, 405, { error: 'PUT only' }, { allow: 'PUT' });
      return await handleRootConfig(req, res, state);
    }
    if (req.method !== 'GET') return writeJson(res, 405, { error: 'GET only' }, { allow: 'GET' });
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
  mode: 'rewrite' | 'analyze' | 'evaluate';
}

interface WebRootState {
  active: RootSpec[];
  defaults: RootSpec[];
  configPath?: string;
  instanceId: string;
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

async function handleBrief(req: IncomingMessage, res: ServerResponse, roots: RootSpec[], analysisDir: string): Promise<void> {
  const request = await readBriefRequest(req);
  const ref = await findSkillRef(request.name, roots, request.source);
  if (!ref) throw new RequestProblem(404, 'Skill was not found in the current scan');
  const source = await readFile(ref.file, 'utf8');
  if (request.mode === 'analyze') {
    return writeJson(res, 200, {
      mode: 'analyze', skill: request.name, method: 'ai',
      brief: buildAnalysisPrompt(source, ref.file), writesSource: false,
    });
  }
  if (request.mode === 'evaluate') {
    return writeJson(res, 200, {
      mode: 'evaluate', skill: request.name, sourceFile: ref.file, method: 'ai', metrics: request.metrics,
      brief: buildEvaluationPrompt(source, ref.file, request.intent, request.metrics), writesSource: false,
    });
  }
  const doc = await flowFromRef(ref, analysisDir);
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
  if (mode !== 'rewrite' && mode !== 'analyze' && mode !== 'evaluate') throw new RequestProblem(400, 'mode must be rewrite, analyze, or evaluate');
  const node = boundedString(body.node, 'node', 300, mode === 'rewrite');
  return {
    name: boundedString(body.name, 'name', 200, true),
    source: readSkillSource(body.source),
    node: node || undefined,
    intent: boundedString(body.intent, 'intent', 8000),
    mode,
    metrics: readMetricIds(body.metrics),
  };
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
    return writeJson(res, 500, { error: 'could not read the configured Skill roots' });
  }
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
  const doc = await loadFlow(url.searchParams.get('name'), roots, analysisDir, readSkillSource(url.searchParams.get('source')));
  if (!doc) return writeJson(res, 404, { error: 'Skill was not found in the current scan' });
  writeJson(res, 200, { doc, layout: layoutNodes(doc) });
}

async function sendGraph(url: URL, res: ServerResponse, roots: RootSpec[], analysisDir: string): Promise<void> {
  const doc = await loadFlow(url.searchParams.get('name'), roots, analysisDir, readSkillSource(url.searchParams.get('source')));
  if (!doc) return writeJson(res, 404, { error: 'Skill was not found in the current scan' });
  res.writeHead(200, {
    ...commonHeaders(),
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'",
  });
  res.end(renderHtml(doc, { embedded: url.searchParams.get('embed') === '1' }));
}

async function sendContext(url: URL, res: ServerResponse, roots: RootSpec[], analysisDir: string): Promise<void> {
  const doc = await loadFlow(url.searchParams.get('name'), roots, analysisDir, readSkillSource(url.searchParams.get('source')));
  if (!doc) return writeJson(res, 404, { error: 'Skill was not found in the current scan' });
  const context = buildEditContext(doc, url.searchParams.get('node') ?? '');
  if (!context) return writeJson(res, 404, { error: 'node was not found in the current Skill' });
  writeJson(res, 200, context);
}

async function loadFlow(name: string | null, roots: RootSpec[], analysisDir: string, source: 'user' | 'system' = 'user'): Promise<FlowDoc | undefined> {
  if (!name) return undefined;
  const ref = await findSkillRef(name, roots, source);
  return ref ? flowFromRef(ref, analysisDir) : undefined;
}

async function findSkillRef(name: string, roots: RootSpec[], source: 'user' | 'system' = 'user'): Promise<SkillRef | undefined> {
  const scanRoots = source === 'system' ? [{ path: SYSTEM_SKILLS_ROOT, rank: -100, label: 'system · annot' }] : roots;
  const { skills } = await discoverSkills(scanRoots);
  return skills.find((skill) => skill.name === name);
}

async function flowFromRef(ref: SkillRef, analysisDir: string): Promise<FlowDoc> {
  const source = await readFile(ref.file, 'utf8');
  const analysisPath = join(analysisDir, `${slugify(ref.name)}.analysis.json`);
  try {
    const proposal = parseAnalysisProposal(await readFile(analysisPath, 'utf8'));
    return buildFlowFromAnalysis(source, proposal, { sourceFile: basename(ref.file) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return buildFlow(parseSkill(source, { file: ref.file }), source, { sourceFile: basename(ref.file) });
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
