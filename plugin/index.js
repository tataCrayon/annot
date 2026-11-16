/**
 * Host half of annot-dsh.
 *
 * Three read-only routes, and no engine code in this package at all: each route
 * runs the annot CLI and returns its JSON. That is the whole point of the
 * "one engine, two shells" split — the DSH panel and `annot` on the command
 * line must not be able to disagree, and the cheapest way to guarantee that is
 * to have exactly one implementation.
 *
 * Consequences worth knowing:
 *   - the panel needs an annot CLI to exist. `config.cli` names it; the default
 *     is `annot` on PATH. A missing CLI is reported per request instead of
 *     failing the boot, so the panel degrades to "not installed yet".
 *   - the write path (`annot annotate`) stays out of the routes on purpose: a
 *     web route that rewrites skill artifacts is a much larger permission than
 *     a panel that reads them.
 *
 * Every route carries the loopback fence used elsewhere in this profile family:
 * a direct loopback socket AND a loopback Host header, with forwarding headers
 * refused outright, because a proxy in front of the host makes both describe
 * the proxy rather than the client.
 */

import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const name = 'annot';
export const inject = ['webServer'];

export const ROUTES = {
  status: '/api/annot/status',
  list: '/api/annot/list',
  flow: '/api/annot/flow',
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
  const argv = [...(isScript ? [...(options.nodeArgs ?? []), cli] : []), ...args, '--json'];
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

function tryParse(text) {
  if (text === '') return undefined;
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

function makeRoutes(config, logger) {
  const cli = config?.cli ?? 'annot';
  const nodeArgs = config?.cliNodeArgs ?? [];

  /**
   * The set of SKILL.md paths a scan currently produces, cached briefly.
   *
   * The `?path=` guard needs it: without this check the route reads any
   * markdown file the user names, which turns a graph viewer into a file-read
   * primitive. The cache exists because the panel asks for one flow per click
   * and a full rescan per click would double the cost of every open.
   */
  const scanned = { at: 0, files: new Set() };
  const scannedFiles = async () => {
    if (Date.now() - scanned.at < 10_000) return scanned.files;
    const result = await runCli(cli, ['list', ...roots()], { nodeArgs, cwd: config?.cwd });
    if (result.ok && Array.isArray(result.value.skills)) {
      scanned.files = new Set(result.value.skills.map((skill) => skill.file));
      scanned.at = Date.now();
    }
    return scanned.files;
  };

  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) {
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

  return [
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
      path: ROUTES.list,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return;
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
          writeJson(res, 422, { error: 'not a skill the current scan produced; refresh the list and retry' });
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
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'annot: routes');
}
