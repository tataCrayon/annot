#!/usr/bin/env node
/**
 * CLI surface. Every command is a pure function of the files it is given, so
 * the two host shells (DSH plugin, Claude Code skill/MCP) can call the same
 * code paths instead of re-implementing them.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { auditRoots, formatAudit } from './audit.ts';
import { buildEditContext, formatEditContext } from './context.ts';
import { diagnose, formatDiagnosis } from './diag.ts';
import { detectDrift } from './drift.ts';
import { atomicWriteAll, atomicWrite } from './fsx.ts';
import { MANIFEST_NAME, buildManifest, manifestContent, resolveSkillPath } from './manifest.ts';
import { formatRenderReport, renderCheck } from './visual.ts';
import { discoverSkills, DEFAULT_RANKS, type RootSpec } from './discover.ts';
import { buildFlow } from './flow.ts';
import { parseSkill, slugify } from './parse.ts';
import { layoutNodes, renderHtml } from './render.ts';
import { formatSearch, searchSkills } from './search.ts';
import type { FlowDoc, Sidecar } from './types.ts';

const USAGE = `annot — annotate any agent skill

Usage
  annot annotate <skill-dir|SKILL.md> [--out <dir>] [--sidecar <json>] [--json]
  annot check <flow.json> [--skill <SKILL.md>] [--json]
  annot list <root...> [--json]
  annot search <query...> <root...> [--body] [--json]
  annot audit <root...> [--limit <n>] [--json]
  annot context <flow.json> <node-id> [--json]
  annot render <flow.json> [--out <file>]
  annot verify <flow.json|html> [--json] [--shot <dir>]

Options
  --out <dir|file>   where to write (default: .annot/ next to SKILL.md)
  --sidecar <json>   human calibration file (annot.sidecar.json)
  --skill <path>     SKILL.md to compare a flow against (check)
  --limit <n>        how many rows audit prints (default: 20)
  --body             search also matches body text (default: name/description/headings)
  --json             machine-readable output on stdout
  -h, --help
`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }

  switch (command) {
    case 'annotate':
      return annotate(rest);
    case 'check':
      return check(rest);
    case 'list':
      return list(rest);
    case 'search':
      return search(rest);
    case 'audit':
      return audit(rest);
    case 'context':
      return context(rest);
    case 'render':
      return render(rest);
    case 'verify':
      return verify(rest);
    case 'version':
      process.stdout.write('annot 0.1.0\n');
      return 0;
    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

function parse(argv: string[], known: string[]): { values: Record<string, string | boolean>; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      out: { type: 'string' },
      sidecar: { type: 'string' },
      skill: { type: 'string' },
      limit: { type: 'string' },
      shot: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      ...Object.fromEntries(known.map((k) => [k, { type: 'boolean' }])),
    },
  });
  return { values: values as Record<string, string | boolean>, positionals };
}

async function annotate(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, []);
  const target = positionals[0];
  if (!target) {
    process.stderr.write('annotate needs a skill directory or SKILL.md path\n');
    return 1;
  }

  const file = target.endsWith('.md') ? resolve(target) : join(resolve(target), 'SKILL.md');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    process.stderr.write(`cannot read ${file}\n`);
    return 1;
  }

  const sidecar = await loadSidecar(values.sidecar as string | undefined, dirname(file));
  const skill = parseSkill(text);
  const options = { sidecar, sourceFile: basename(file) };
  const doc = buildFlow(skill, text, options);

  const outDir = resolveOut(values.out as string | undefined, dirname(file), skill.name);
  await mkdir(outDir, { recursive: true });

  const flowPath = join(outDir, `${slugify(skill.name)}.flow.json`);
  const htmlPath = join(outDir, `${slugify(skill.name)}.html`);

  // Both artifacts or neither: a flow.json without its html (or an html built
  // from a half-written flow) is worse than a stale pair, because it looks new.
  const written = await atomicWriteAll([
    { path: flowPath, content: flowContent(doc) },
    { path: htmlPath, content: renderHtml(doc) },
  ]);

  const manifest = buildManifest({
    skill: doc.skill,
    sourceFile: file,
    sourceSha: doc.source.sha,
    sourceLines: doc.source.lines,
    outDir,
    artifacts: written,
    now: options.now,
  });
  await atomicWrite(join(outDir, MANIFEST_NAME), manifestContent(manifest));

  if (values.json) {
    // The whole document plus the computed layout is included so a host shell
    // can draw the graph from one call: recomputing the layout in the browser
    // would be a second implementation that could disagree with the artifact.
    process.stdout.write(`${JSON.stringify({ skill: doc.skill, artifacts: written, manifest: join(outDir, MANIFEST_NAME), stats: doc.stats, nodes: doc.nodes.length, edges: doc.edges.length, doc, layout: layoutNodes(doc) })}\n`);
  } else {
    process.stdout.write(report(doc));
    process.stdout.write(`\n  flow  ${flowPath}\n  html  ${htmlPath}\n`);
  }
  return 0;
}

async function check(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, []);
  const flowPath = positionals[0];
  if (!flowPath) {
    process.stderr.write('check needs a flow.json path\n');
    return 1;
  }

  const doc = JSON.parse(await readFile(resolve(flowPath), 'utf8')) as FlowDoc;
  const skillPath = (values.skill as string | undefined) ?? (await resolveSkillPath(flowPath, doc.source.file));
  let text: string;
  try {
    text = await readFile(resolve(skillPath), 'utf8');
  } catch {
    process.stderr.write(`cannot read skill source ${resolve(skillPath)}\n`);
    return 1;
  }

  const result = detectDrift(doc, text);
  const relocated = result.nodes.filter((n) => n.flags.includes('relocated')).length;

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ skill: result.skill, ok: result.ok, stale: result.stale, relocated })}\n`);
  } else if (result.ok) {
    process.stdout.write(`✓ ${result.skill}: ${doc.nodes.length} nodes in sync with ${skillPath}\n`);
  } else {
    process.stdout.write(`✗ ${result.skill}: ${result.stale.length} anchor(s) drifted in ${skillPath}\n`);
    for (const s of result.stale) {
      const where =
        s.reason === 'moved' ? `moved ${s.from} → ${s.to}`
        : s.reason === 'edited' ? `edited in place at ${s.from}`
        : `broken at ${s.from}`;
      process.stdout.write(`   - ${s.id} (${s.label}): ${where}\n`);
    }
  }
  return result.ok ? 0 : 1;
}

async function list(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, []);
  if (positionals.length === 0) {
    process.stderr.write('list needs at least one root directory\n');
    return 1;
  }
  const roots: RootSpec[] = positionals.map((p, i) => ({ path: p, rank: DEFAULT_RANKS.custom + i, label: p }));
  const { skills, skipped } = await discoverSkills(roots);

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ skills, skipped })}\n`);
  } else {
    for (const s of skills) process.stdout.write(`${s.name}\t${s.file}\n`);
    for (const s of skipped) process.stderr.write(`skipped ${s.root}: ${s.reason}\n`);
  }
  return 0;
}

/**
 * `search <query...> [roots...]` splits on `--`: everything before it is the
 * query, everything after is a root. Without `--`, roots are recognized by
 * looking like a directory that exists, and the rest is the query — otherwise a
 * bare `annot search audit` would be impossible to write.
 */
async function search(argv: string[]): Promise<number> {
  // `--` is split off the raw argv, not out of `positionals`: node's parseArgs
  // consumes the separator itself, so looking for it afterwards finds nothing
  // and every word after it silently becomes part of the query.
  const separator = argv.indexOf('--');
  const head = separator >= 0 ? argv.slice(0, separator) : argv;
  const tail = separator >= 0 ? argv.slice(separator + 1) : [];
  const { values, positionals } = parse(head, ['body']);

  const { existsSync } = await import('node:fs');
  const looksLikeRoot = (p: string) => p.includes('/') || p.includes('\\') || existsSync(p);
  const queryParts = separator >= 0 ? positionals : positionals.filter((p) => !looksLikeRoot(p));
  const rootParts = separator >= 0 ? tail : positionals.filter(looksLikeRoot);

  const query = queryParts.join(' ').trim();
  if (query === '') {
    process.stderr.write('search needs a query, e.g. `annot search audit -- ~/.agents/skills`\n');
    return 1;
  }
  if (rootParts.length === 0) {
    process.stderr.write('search needs at least one root directory\n');
    return 1;
  }

  const roots: RootSpec[] = rootParts.map((p, i) => ({ path: p, rank: DEFAULT_RANKS.custom + i, label: p }));
  const result = await searchSkills(roots, query, { body: Boolean(values.body) });

  if (values.json) {
    // `--json` must be honoured even at zero matches: a caller that asked for
    // machine output cannot be handed a human sentence instead.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(formatSearch(result));
    for (const s of result.skipped) process.stderr.write(`skipped ${s.root}: ${s.reason}\n`);
  }
  return 0;
}

async function audit(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, []);
  if (positionals.length === 0) {
    process.stderr.write('audit needs at least one root directory\n');
    return 1;
  }
  const roots: RootSpec[] = positionals.map((p, i) => ({ path: p, rank: DEFAULT_RANKS.custom + i, label: p }));
  const { audits, skipped } = await auditRoots(roots);

  if (values.json) {
    // `limit` slices the table a human reads; JSON is the complete result,
    // because a caller that asked for JSON is the one doing the slicing.
    process.stdout.write(`${JSON.stringify({ total: audits.length, clean: audits.filter((a) => a.score === 0).length, audits, skipped })}\n`);
  } else {
    process.stdout.write(formatAudit(audits, Number(values.limit ?? 20)));
    for (const s of skipped) process.stderr.write(`skipped ${s.root}: ${s.reason}\n`);
  }
  return 0;
}

async function context(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, []);
  const [flowPath, nodeId] = positionals;
  if (!flowPath || !nodeId) {
    process.stderr.write('context needs <flow.json> <node-id>\n');
    return 1;
  }

  let doc: FlowDoc;
  try {
    doc = JSON.parse(await readFile(resolve(flowPath), 'utf8')) as FlowDoc;
  } catch {
    process.stderr.write(`cannot read ${resolve(flowPath)}\n`);
    return 1;
  }

  const ctx = buildEditContext(doc, nodeId);
  if (!ctx) {
    process.stderr.write(`no node '${nodeId}' in ${doc.skill}\n`);
    const near = doc.nodes.slice(0, 8).map((n) => `  ${n.id}  (${n.label.slice(0, 40)})`).join('\n');
    if (near) process.stderr.write(`available:\n${near}\n`);
    return 1;
  }

  process.stdout.write(values.json ? `${JSON.stringify(ctx)}\n` : formatEditContext(ctx));
  return 0;
}

async function verify(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, []);
  const target = positionals[0];
  if (!target) {
    process.stderr.write('verify needs a flow.json or html path\n');
    return 1;
  }

  // A declared-string option given without a value arrives as `true`. Resolving
  // that produces a TypeError several frames deep instead of telling the user
  // what they typed wrong. Checked before any I/O: a usage error should not
  // depend on whether the file happens to exist.
  const rawShot = values.shot;
  if (rawShot !== undefined && (typeof rawShot !== 'string' || rawShot === '')) {
    process.stderr.write('--shot needs a directory, e.g. `--shot shots`\n');
    return 1;
  }

  const resolved = resolve(target);
  const htmlPath = resolved.endsWith('.html') ? resolved : resolved.replace(/\.flow\.json$/, '.html');
  const flowPath = resolved.endsWith('.json') ? resolved : resolved.replace(/\.html$/, '.flow.json');

  let doc: FlowDoc;
  try {
    doc = JSON.parse(await readFile(flowPath, 'utf8')) as FlowDoc;
  } catch {
    process.stderr.write(`cannot read ${flowPath}\n`);
    return 1;
  }

  const shotDir = rawShot;
  const report = await renderCheck(htmlPath, doc, { shotDir: shotDir ? resolve(shotDir) : undefined });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(formatRenderReport(report));
  }

  // skipped is a distinct outcome: it must not read as success in CI.
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}

async function render(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, []);
  const flowPath = positionals[0];
  if (!flowPath) {
    process.stderr.write('render needs a flow.json path\n');
    return 1;
  }
  const doc = JSON.parse(await readFile(resolve(flowPath), 'utf8')) as FlowDoc;
  const out = (values.out as string | undefined) ?? resolve(flowPath).replace(/\.flow\.json$/, '.html');
  const artifact = await atomicWrite(resolve(out), renderHtml(doc));
  process.stdout.write(`${artifact.path}  ${artifact.bytes}B  ${artifact.sha256.slice(0, 12)}\n`);
  return 0;
}

async function loadSidecar(explicit: string | undefined, skillDir: string): Promise<Sidecar | undefined> {
  const candidates = explicit ? [resolve(explicit)] : [join(skillDir, 'annot.sidecar.json')];
  for (const path of candidates) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Sidecar;
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveOut(out: string | undefined, skillDir: string, name: string): string {
  if (out) return resolve(out);
  return join(skillDir, '.annot', name);
}

function flowContent(doc: FlowDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function report(doc: FlowDoc): string {
  const s = doc.stats;
  // Two different questions, and conflating them is how a reader ends up
  // thinking a skill with four declared forks has none: `forks` counts the
  // conditionals the author wrote, `bound` counts the ones whose other end
  // landed on a node. A skill can have forks and zero bound edges — that is
  // the "unresolved branch" state, not "no branches".
  const forks = doc.nodes.reduce((total, node) => total + node.branches.length, 0);
  const bound = doc.edges.filter((e) => e.kind === 'branch').length;
  const shape = diagnose(doc);
  const phases = doc.phases.length
    ? doc.phases.map((p) => `${p.label} (${p.nodes})`).join(' | ')
    : '(none declared)';
  const lines = [
    `annotated ${doc.skill}`,
    `  source      ${doc.source.file} (${doc.source.lines} lines, sha ${doc.source.sha.slice(0, 12)})`,
    `  nodes       ${doc.nodes.length}  edges ${doc.edges.length}  forks ${forks} (bound ${bound}, unresolved ${forks - bound})`,
    `  by type     stage ${s.byType.stage} · decision ${s.byType.decision} · gate ${s.byType.gate} · artifact ${s.byType.artifact} · external ${s.byType.external}`,
    // Who does the work. A skill where `git fetch` and "判断分支是否落后" share a
    // column reads as a list; the lane is what separates them.
    `  by lane     you ${s.byLane.reader} · tool ${s.byLane.tool} · model ${s.byLane.model} · output ${s.byLane.output}`,
    `  phases      ${phases}`,
    // The score beside a node is a constant of its rule, not a probability, so
    // the label says 规则 and names the rule rather than implying doubt.
    `  to confirm  ${s.lowConfidence} node(s) on a low score rule (< 60%)`,
    // The layout can be perfectly drawn and still not be a flow. These lines are
    // the only thing in the report that says so.
    formatDiagnosis(shape).trimEnd(),
  ];
  return `${lines.filter(Boolean).join('\n')}\n`;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
