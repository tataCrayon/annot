/**
 * Host half of annot-dsh.
 *
 * Read-only routes, and no engine code in this package at all: each route runs
 * the annot CLI and returns its JSON. That is the whole point of the
 * "one engine, two shells" split — the DSH panel and `annot` on the command line
 * must not be able to disagree, and the cheapest way to guarantee that is to
 * have exactly one implementation.
 *
 * Consequences worth knowing:
 *   - the panel needs an annot CLI to exist. `config.cli` names it; the default
 *     is `annot` on PATH. A missing CLI is reported per request instead of
 *     failing the boot, so the panel degrades to "not installed yet".
 *   - the write path (`annot annotate` writing into the user's skill tree) stays
 *     out of the routes on purpose: a web route that rewrites skills is a much
 *     larger permission than a panel that reads them. The one exception writes
 *     to a temp directory the panel owns, because drawing a graph requires it.
 *   - `context` is the read that makes editing possible: it returns a bounded
 *     slice plus the constraints, so the *user's own agent* does the rewrite. A
 *     panel that called a model itself would need a key, a bill and a second
 *     opinion about what the skill should say.
 *
 * Every route carries the loopback fence used elsewhere in this profile family:
 * a direct loopback socket AND a loopback Host header, with forwarding headers
 * refused outright, because a proxy in front of the host makes both describe
 * the proxy rather than the client.
 */

import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'annot';
export const inject = ['webServer'];

export const ROUTES = {
  status: '/api/annot/status',
  selfcheck: '/api/annot/selfcheck',
  report: '/api/annot/selfcheck/report',
  list: '/api/annot/list',
  search: '/api/annot/search',
  flow: '/api/annot/flow',
  context: '/api/annot/context',
  audit: '/api/annot/audit',
};

function isIPv4Loopback(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isLoopbackAddress(address) {
  if (address === undefined) return false;
  const a = address.toLowerCase();
  if (a === '::1') return true;
  if (a.startsWith('::ffff:')) return isIPv4Loopback(a.slice(7));
  return isIPv4Loopback(a);
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  return isIPv4Loopback(hostname);
}

/**
 * X-Forwarded-For is never evidence *for* loopback: its presence means a hop
 * forwarded the request, so the socket address describes that hop.
 */
function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
  if (request.headers['cf-connecting-ip'] !== undefined || request.headers['x-forwarded-for'] !== undefined) return false;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  let hostUrl;
  try {
    hostUrl = new URL('http://' + host);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Run the CLI and parse its JSON. `--json` is passed on every call so a future
 * human-readable change to the default output cannot silently break the panel.
 *
 * A JavaScript entry point runs through this process's node (that is how the
 * repo's `src/cli.ts` works without a build step); anything else is executed
 * directly, so an `annot` on PATH is used as-is.
 */
function runCli(cli, args, options = {}) {
  const isScript = /\.[cm]?[jt]sx?$/i.test(cli);
  const file = isScript ? process.execPath : cli;
  // `--json` has to go BEFORE a `--` separator: everything after `--` is a
  // positional by POSIX convention, so appending it at the end silently turned
  // the flag into another root directory and the reply came back as prose.
  const separator = args.indexOf('--');
  const withJson = separator >= 0 ? [...args.slice(0, separator), '--json', ...args.slice(separator)] : [...args, '--json'];
  const argv = [...(isScript ? [...(options.nodeArgs ?? []), cli] : []), ...withJson];
  return new Promise((resolve) => {
    execFile(
      file,
      argv,
      { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, cwd: options.cwd },
      (error, stdout, stderr) => {
        if (error && error.code === 'ENOENT') {
          resolve({ ok: false, missing: true, message: `cannot run ${cli}: command not found` });
          return;
        }
        const text = String(stdout ?? '').trim();
        if (error) {
          // `audit` and `check` exit non-zero with valid JSON on stdout; a
          // failure with no JSON is the case that must be surfaced as-is.
          const parsed = tryParse(text);
          if (parsed) {
            resolve({ ok: true, value: parsed });
            return;
          }
          const detail = String(stderr ?? '').trim();
          const missing = error.code === 1 && /Cannot find module|MODULE_NOT_FOUND/.test(detail);
          resolve({ ok: false, missing, message: missing ? `cannot run ${cli}: not installed` : `${error.message} ${detail}`.trim() });
          return;
        }
        const parsed = tryParse(text);
        resolve(parsed ? { ok: true, value: parsed } : { ok: false, message: `unparseable output: ${text.slice(0, 200)}` });
      },
    );
  });
}

/**
 * Describe whether the client-module registry composed this package.
 *
 * Three answers, and the distinction is the whole point:
 *   `undefined`  the profile has no clientModules service
 *   `{registered:false}`  it does, and this package is not in its table
 *   `{registered:true}`   composed, with the URL the page would fetch
 */
function describeComposed(service, packageName) {
  if (!service || typeof service.graph !== 'function') return undefined;
  try {
    const graph = service.graph();
    const rows = Array.isArray(graph?.entries) ? graph.entries : [];
    const row = rows.find((entry) => entry && entry.id === packageName);
    if (!row) return { registered: false, total: rows.length };
    return {
      registered: true,
      total: rows.length,
      rev: row.rev,
      url: row.url,
      inject: row.inject ?? [],
      immediately: row.immediately === true,
    };
  } catch (error) {
    return { registered: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Read a request body with a hard ceiling.
 *
 * The report route takes arbitrary JSON from the page, so an unbounded read is
 * a memory hole in the Host process. 64 KiB is far more than a diagnostic needs.
 */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve('');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function tryParse(text) {  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // The CLI may print a leading human line; take the last JSON-looking line.
    for (const line of text.split('\n').reverse()) {
      const candidate = line.trim();
      if (!candidate.startsWith('{')) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

/** The skill roots to scan, mirroring how the host resolves them. */
function rootsFor(config) {
  const home = config?.home ?? process.env.DSH_HOME?.replace(/[\\/]\.dsh$/, '') ?? homedir();
  const cwd = config?.cwd ?? process.cwd();
  return [`.dsh/skills`, '.agents/skills']
    .flatMap((rel) => [home ? `${home}/${rel}` : undefined, cwd ? `${cwd}/${rel}` : undefined])
    .filter((p) => typeof p === 'string' && p !== '');
}

/**
 * What this package declares about its browser half, read from disk.
 *
 * The module composer resolves a client bundle from `exports["./client"]` in the
 * manifest of the package the Loader mounted, and emits a graph row only when
 * `dsh.client.platform === "web"`. Both are cheap to check and both are silent
 * when wrong: a missing `./client` export throws at activation, but a bundle
 * that exists and never loads leaves no trace at all. Reporting the declaration
 * next to the file's existence separates those two failures.
 */
function readClientMeta() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
    const decl = pkg?.dsh?.client ?? {};
    const exported = typeof pkg?.exports === 'object' && pkg.exports !== null ? pkg.exports['./client'] : undefined;
    const relative = typeof exported === 'string' ? exported : exported?.default;
    const entry = typeof relative === 'string' ? join(here, relative) : undefined;
    let bytes = 0;
    if (entry !== undefined) {
      try {
        bytes = statSync(entry).size;
      } catch {
        bytes = 0;
      }
    }
    return {
      name: typeof pkg?.name === 'string' ? pkg.name : '(unnamed)',
      platform: typeof decl.platform === 'string' ? decl.platform : '(not declared)',
      entry: entry ?? '(no exports["./client"])',
      exists: bytes > 0,
      bytes,
    };
  } catch (error) {
    return {
      name: '(manifest unreadable)',
      platform: '(manifest unreadable)',
      entry: error instanceof Error ? error.message : String(error),
      exists: false,
      bytes: 0,
    };
  }
}

function makeRoutes(config, logger) {
  const cli = config?.cli ?? 'annot';
  const nodeArgs = config?.cliNodeArgs ?? [];

  /**
   * A live handle on the Host's client-module registry, when the profile has one.
   *
   * This is ground truth for "was the browser half ever composed into the page",
   * and it is answerable from inside the process with no auth, no browser, and no
   * guessing at slot names: the registry holds a row per `dsh.client` package and
   * knows the exact bundle path it would serve. `apply` fills it in later through
   * an optional `ctx.inject`, so the route list stays buildable without one.
   */
  const selfcheckRegistry = { service: undefined };
  /**
   * The set of SKILL.md paths a scan currently produces, cached briefly.
   *
   * The `?path=` guard needs it: without this check the route reads any
   * markdown file the user names, which turns a graph viewer into a file-read
   * primitive. The cache exists because the panel asks for one flow per click
   * and a full rescan per click would double the cost of every open.
   */
  const scanned = { at: 0, files: new Set() };
  const invalidateScan = () => {
    scanned.at = 0;
  };

  /**
   * Scans at most once per 10s, and at most once at a time: the panel asks for a
   * flow per click, and two clicks in quick succession would otherwise run two
   * full library walks concurrently for the same answer.
   */
  let scanInFlight = null;
  const scannedFiles = async () => {
    if (Date.now() - scanned.at < 10_000) return scanned.files;
    if (scanInFlight) return scanInFlight;
    scanInFlight = (async () => {
      try {
        const result = await runCli(cli, ['list', ...roots()], { nodeArgs, cwd: config?.cwd });
        if (result.ok && Array.isArray(result.value.skills)) {
          scanned.files = new Set(result.value.skills.map((skill) => skill.file));
          scanned.at = Date.now();
        }
        return scanned.files;
      } finally {
        scanInFlight = null;
      }
    })();
    return scanInFlight;
  };

  const guard = (req, res, method) => {    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'loopback only' });
      return false;
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `expected ${method}` });
      return false;
    }
    return true;
  };

  const roots = () => rootsFor(config);

  /**
   * What the browser half has told us about itself, newest last.
   *
   * This is the only evidence that distinguishes "the bundle never arrived" from
   * "the bundle ran and the row is not where the user looked". Both look the
   * same from the Host, and neither is answerable without the page.
   */
  const pageReports = [];
  const recordReport = (entry) => {
    pageReports.push({ ...entry, receivedAt: new Date().toISOString() });
    if (pageReports.length > 20) pageReports.splice(0, pageReports.length - 20);
  };

  /**
   * The selfcheck route object itself, so `apply` can hang the optional
   * client-module registry on it without making that a hard dependency.
   */
  let selfcheckRoute;

  const routes = [
    {
      kind: 'exact',
      path: ROUTES.status,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        const result = await runCli(cli, ['version'], { nodeArgs, cwd: config?.cwd });
        // A CLI that exists but exits non-zero on `version` still counts as
        // present unless the failure says the entry point is missing.
        writeJson(res, 200, { installed: !result.missing, cli, roots: roots() });
      },
    },
    {
      kind: 'exact',
      path: ROUTES.selfcheck,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        // Whether the browser half actually reached the page is a fact only the
        // page can report, and the person who can see the page is the user. This
        // route is where that becomes checkable instead of guessed at.
        //
        // It answers three things the Host knows on its own:
        //   - the declared client entry point, and whether that file exists;
        //   - whether `dsh.client.platform` is `web` (otherwise the composer
        //     never emits a graph row for this package at all);
        //   - the URL shape the module system serves bundles under, so a stale
        //     hand-written probe can be corrected rather than believed.
        const meta = readClientMeta();
        writeJson(res, 200, {
          package: meta.name,
          client: {
            platform: meta.platform,
            entry: meta.entry,
            exists: meta.exists,
            bytes: meta.bytes,
          },
          // Whether the Host actually composed a graph row for this package, and
          // what URL it published. `undefined` means the registry service is not
          // in this profile; `{ registered: false }` means it is and we are not
          // in it, which is the failure that leaves no other trace.
          composed: describeComposed(selfcheckRoute && selfcheckRoute.composed, meta.name),
          // `reports` collects what the browser half saw, so a user who CAN see
          // the page turns their observation into data the Host can act on.
          reports: pageReports,
          bundleRoute: '/plugins',
        });
      },
    },
    {
      kind: 'exact',
      path: ROUTES.report,      handler: async (req, res) => {
        // POST, not GET, and it accepts only loopback: this is the page telling
        // the Host what it did, and a cross-site POST would let any tab forge
        // that observation.
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'loopback only' });
          return;
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'expected POST' });
          return;
        }
        const body = await readBody(req);
        if (body === '') {
          writeJson(res, 400, { error: 'expected a JSON body' });
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          writeJson(res, 400, { error: 'body is not JSON' });
          return;
        }
        recordReport(typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed });
        writeJson(res, 200, { ok: true });
      },
    },
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        const url = new URL(req.url ?? '/', 'http://x');
        // `?fresh=1` drops the scan cache. The panel's refresh button needs a
        // way to say "a skill was just added; look again", otherwise the only
        // remedy for a stale list is waiting ten seconds or reloading the page.
        if (url.searchParams.get('fresh') === '1') invalidateScan();
        const result = await runCli(cli, ['list', ...roots()], { nodeArgs, cwd: config?.cwd });
        if (!result.ok) {
          logger.warn(result.message);
          writeJson(res, 503, { error: result.message, cli });
          return;
        }
        writeJson(res, 200, result.value);
      },
    },
    {
      kind: 'exact',
      path: ROUTES.search,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        const url = new URL(req.url ?? '/', 'http://x');
        const query = (url.searchParams.get('q') ?? '').trim();
        if (query === '') {
          writeJson(res, 400, { error: 'expected ?q=<text>' });
          return;
        }
        const body = url.searchParams.get('body') === '1' || url.searchParams.get('body') === 'true';
        // `--` separates the query from the roots: without it the CLI has to
        // guess which positional is which, and a query word that happens to be
        // a directory name would silently become a root.
        const args = ['search', ...(body ? ['--body'] : []), query, '--', ...roots()];
        const result = await runCli(cli, args, { nodeArgs, cwd: config?.cwd });
        if (!result.ok) {
          logger.warn(result.message);
          writeJson(res, 503, { error: result.message, cli });
          return;
        }
        writeJson(res, 200, result.value);
      },
    },
    {
      kind: 'exact',
      path: ROUTES.flow,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        const url = new URL(req.url ?? '/', 'http://x');
        const skill = url.searchParams.get('path');
        if (skill === null || skill.trim() === '') {
          writeJson(res, 400, { error: 'expected ?path=<skill directory or SKILL.md>' });
          return;
        }
        const wanted = skill.trim();
        const files = await scannedFiles();
        const known = [...files].some((file) => file === wanted || file === `${wanted}/SKILL.md` || file === `${wanted}\\SKILL.md`);
        if (!known) {
          // The one likely cause is a skill that appeared after the last scan.
          // Say so and mark it retryable: an error the user cannot act on is
          // just a dead end with an explanation attached.
          writeJson(res, 422, {
            error: '这个 skill 不在最近一次扫描的结果里。点「刷新」重新扫描后再试。',
            retryable: true,
          });
          return;
        }
        const result = await runCli(cli, ['annotate', wanted, '--out', tempOutFor(wanted)], { nodeArgs, cwd: config?.cwd });
        if (!result.ok) {
          logger.warn(result.message);
          writeJson(res, 422, { error: result.message });
          return;
        }
        writeJson(res, 200, result.value);
      },
    },
    {
      kind: 'exact',
      path: ROUTES.context,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        const url = new URL(req.url ?? '/', 'http://x');
        const skill = url.searchParams.get('path');
        const node = url.searchParams.get('node');
        if (skill === null || skill.trim() === '') {
          writeJson(res, 400, { error: 'expected ?path=<skill> &node=<node id>' });
          return;
        }
        if (node === null || node.trim() === '') {
          writeJson(res, 400, { error: 'expected ?node=<node id>; open the skill first and pick a node' });
          return;
        }
        const wanted = skill.trim();
        const files = await scannedFiles();
        const known = [...files].some((file) => file === wanted || file === `${wanted}/SKILL.md` || file === `${wanted}\\SKILL.md`);
        if (!known) {
          writeJson(res, 422, {
            error: '这个 skill 不在最近一次扫描的结果里。点「刷新」重新扫描后再试。',
            retryable: true,
          });
          return;
        }
        // Two CLI calls, not one: the edit context is addressed by node id and
        // the id lives in the flow document. Re-annotating into the same temp
        // directory is cheap (one file read, no writes when content is equal)
        // and it is the only way to be sure the slice matches the graph the
        // panel is showing.
        const out = tempOutFor(wanted);
        const annotated = await runCli(cli, ['annotate', wanted, '--out', out, '--json'], { nodeArgs, cwd: config?.cwd });
        if (!annotated.ok) {
          logger.warn(annotated.message);
          writeJson(res, 422, { error: annotated.message });
          return;
        }
        const flowPath = Array.isArray(annotated.value?.artifacts)
          ? annotated.value.artifacts.map((a) => a.path).find((p) => typeof p === 'string' && p.endsWith('.flow.json'))
          : undefined;
        if (flowPath === undefined) {
          writeJson(res, 422, { error: 'annotate did not report a flow.json path' });
          return;
        }
        const sliced = await runCli(cli, ['context', flowPath, node.trim(), '--json'], { nodeArgs, cwd: config?.cwd });
        if (!sliced.ok) {
          writeJson(res, 422, { error: sliced.message });
          return;
        }
        writeJson(res, 200, sliced.value);
      },
    },
    {
      kind: 'exact',
      path: ROUTES.audit,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
        const url = new URL(req.url ?? '/', 'http://x');
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 40) || 40));
        // No `--limit` is passed: JSON output is complete by contract and the
        // route does the slicing, so the panel still polls `total`/`clean`
        // across the whole library rather than across a truncated page.
        const result = await runCli(cli, ['audit', ...roots()], { nodeArgs, cwd: config?.cwd });
        if (!result.ok) {
          logger.warn(result.message);
          writeJson(res, 503, { error: result.message, cli });
          return;
        }
        const payload = result.value;
        writeJson(res, 200, { ...payload, audits: Array.isArray(payload.audits) ? payload.audits.slice(0, limit) : [] });
      },
    },
  ];

  selfcheckRoute = routes.find((route) => route.path === ROUTES.selfcheck);
  return routes;
}

/**
 * `annotate` writes artifacts; the panel only wants the flow document. Point
 * the output at a per-skill temp directory rather than into the user's skill
 * tree, so opening the panel never leaves files behind next to SKILL.md.
 */
function tempOutFor(skill) {
  const safe = String(skill).replace(/[^\w.-]+/g, '-').slice(-80);
  return join(tmpdir(), 'annot-panel', safe);
}

export function apply(ctx, config) {
  const routes = makeRoutes(config, { warn: (error) => ctx.logger.warn(error) });
  const selfcheck = routes.find((route) => route.path === ROUTES.selfcheck);
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'annot: routes');

  // Optional, and deliberately not in `inject`: the panel is useful without the
  // module registry, and requiring it would keep the whole plugin inactive in
  // profiles that do not serve a Web page. When it is present, the selfcheck
  // route can say whether this package was ever composed into the page.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['clientModules'], (scoped) => {
      scoped.effect(() => {
        if (selfcheck) selfcheck.composed = scoped.clientModules;
        return () => {
          if (selfcheck) selfcheck.composed = undefined;
        };
      }, 'annot: client-modules presence');
    });
  }
}
