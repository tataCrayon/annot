import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { DEFAULT_RANKS, discoverSkills } from '../src/discover.ts';
import { parseSkill } from '../src/parse.ts';
import { startWebServer, webRoots } from '../src/web.ts';

const servers: Array<{ close: () => Promise<void> }> = [];
const workspaces: string[] = [];
const fixture = new URL('./fixtures/branch-table.md', import.meta.url);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A minimal but valid analysis for the branch-table fixture.
 *
 * The workbench only draws a graph that came from an AI analysis, so every test
 * that wants a canvas has to supply one. Kept in one place so the quotes cannot
 * drift from the fixture. */
async function writeAnalysis(analysisDir: string) {
  const source = await readFile(join(analysisDir, '..', 'skills', 'branch-table', 'SKILL.md'), 'utf8');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const at = (needle: string) => {
    const index = lines.findIndex((line) => line.includes(needle));
    if (index < 0) throw new Error(`analysis helper: ${needle} is not in the fixture`);
    return { start: index + 1, end: index + 1, quote: lines[index] };
  };
  const proposal = {
    schema_version: 1,
    skill: 'branch-table',
    source_sha: parseSkill(source).sha,
    nodes: [
      { id: 'n-review', type: 'stage', label: 'Review the proposed method', ...at('Review the proposed method') },
      { id: 'n-keep', type: 'stage', label: 'Continue with the current method', ...at('Continue with the current method.') },
    ],
    // The fixture puts the two cards in different chapters, and a sequence that
    // leaves its chapter has to quote what links them.
    edges: [{ from: 'n-review', to: 'n-keep', kind: 'sequence', reason: 'the outcome table routes here' }],
  };
  await writeFile(join(analysisDir, 'branch-table.analysis.json'), JSON.stringify(proposal), 'utf8');
}

async function app() {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-web-'));
  workspaces.push(workspace);
  const root = join(workspace, 'skills');
  const analysisDir = join(workspace, 'analyses');
  const snapshotDir = join(workspace, 'snapshots');
  const reportDir = join(workspace, 'reports');
  await mkdir(join(root, 'branch-table'), { recursive: true });
  await mkdir(analysisDir, { recursive: true });
  await cp(fixture, join(root, 'branch-table', 'SKILL.md'));
  await writeAnalysis(analysisDir);
  const taskDir = join(workspace, 'tasks');
  const server = await startWebServer({ roots: [{ path: root, rank: 1, label: 'fixture skills' }], port: 0, analysisDir, snapshotDir, reportDir, taskDir });
  servers.push(server);
  return { base: server.url, root, analysisDir, snapshotDir, reportDir, taskDir };
}

async function json(base: string, path: string) {
  const response = await fetch(new URL(path, base));
  return { response, body: await response.json() as Record<string, any> };
}

test('default web roots cover common agent configuration directories', () => {
  const project = join('/workspace', 'sample');
  const home = join('/home', 'reviewer');
  const roots = webRoots(project, home, {});
  const labels = roots.map((root) => root.label);

  assert.deepEqual(labels, [
    'project · shared Agents (Codex official)',
    'project · Claude Code',
    'project · Codex compatibility',
    'project · Cursor',
    'project · GitHub Copilot',
    'project · Gemini CLI legacy',
    'project · OpenCode',
    'project · DSH',
    'project · ZCode',
    'user · shared Agents (Codex official)',
    'user · Claude Code',
    'user · Codex compatibility',
    'user · Cursor',
    'user · GitHub Copilot',
    'user · Gemini CLI legacy',
    'user · OpenCode',
    'user · DSH',
    'user · ZCode',
  ]);
  assert.ok(roots.findIndex((root) => root.label.startsWith('project · shared Agents')) < roots.findIndex((root) => root.label.startsWith('user · shared Agents')));
  assert.equal(new Set(roots.map((root) => root.path)).size, roots.length);
});

test('discovery stops symbolic-link cycles inside a root', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-symlink-'));
  workspaces.push(workspace);
  const root = join(workspace, 'skills');
  const skillDir = join(root, 'category', 'looped');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: looped-skill\n---\n# Looped\n', 'utf8');
  try {
    await symlink(root, join(root, 'category', 'back-to-root'), 'junction');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('creating symbolic links is not permitted on this host');
      return;
    }
    throw error;
  }

  const result = await discoverSkills([{ path: root, rank: DEFAULT_RANKS.custom, label: 'fixture' }]);

  assert.deepEqual(result.skills.map((skill) => skill.name), ['looped-skill']);
  assert.equal(result.skipped.length, 0);
});
test('discovery finds Skills below category directories within an explicit root', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-nested-'));
  workspaces.push(workspace);
  const root = join(workspace, 'skills');
  await mkdir(join(root, 'direct'), { recursive: true });
  await mkdir(join(root, 'design', 'nested'), { recursive: true });
  await writeFile(join(root, 'direct', 'SKILL.md'), '---\nname: direct-skill\n---\n# Direct\n', 'utf8');
  await writeFile(join(root, 'design', 'nested', 'SKILL.md'), '---\nname: nested-skill\n---\n# Nested\n', 'utf8');

  const result = await discoverSkills([{ path: root, rank: DEFAULT_RANKS.custom, label: 'fixture' }]);

  assert.deepEqual(result.skills.map((skill) => skill.name), ['direct-skill', 'nested-skill']);
  assert.match(result.skills[1].file, /design[\\/]nested[\\/]SKILL\.md$/);
  assert.equal(result.skipped.length, 0);
});

test('default web roots honor Codex and Claude home overrides', () => {
  const codexHome = join('/custom', 'codex');
  const claudeHome = join('/custom', 'claude');
  const roots = webRoots(join('/workspace', 'sample'), join('/home', 'reviewer'), {
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeHome,
  });

  assert.equal(roots.find((root) => root.label === 'user · Codex compatibility')?.path, join(codexHome, 'skills'));
  assert.equal(roots.find((root) => root.label === 'user · Claude Code')?.path, join(claudeHome, 'skills'));
});

test('web status leaves unconfigured common roots visible and explains them', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-web-roots-'));
  workspaces.push(workspace);
  const roots = webRoots(join(workspace, 'project'), join(workspace, 'home'), {});
  const server = await startWebServer({ roots, port: 0 });
  servers.push(server);
  const status = await json(server.url, '/api/status');

  assert.equal(status.body.roots.length, 18);
  assert.equal(status.body.skipped.length, 18);
});

test('web roots can be configured, persisted, and reset from the page API', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'annot-web-config-'));
  workspaces.push(workspace);
  const firstRoot = join(workspace, 'first');
  const secondRoot = join(workspace, 'second');
  const configPath = join(workspace, '.annot', 'web-roots.json');
  await mkdir(join(firstRoot, 'first-skill'), { recursive: true });
  await mkdir(join(secondRoot, 'second-skill'), { recursive: true });
  await writeFile(join(firstRoot, 'first-skill', 'SKILL.md'), '---\nname: first-skill\n---\n# First\n', 'utf8');
  await writeFile(join(secondRoot, 'second-skill', 'SKILL.md'), '---\nname: second-skill\n---\n# Second\n', 'utf8');
  const defaults = [
    { path: firstRoot, rank: 1, label: 'first' },
    { path: secondRoot, rank: 2, label: 'second' },
  ];
  const server = await startWebServer({ roots: [defaults[0]], defaultRoots: defaults, rootConfigPath: configPath, port: 0 });
  servers.push(server);

  const update = await fetch(new URL('/api/roots', server.url), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths: [secondRoot] }),
  });
  const updated = await update.json() as Record<string, any>;
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  const skills = await json(server.url, '/api/skills');
  const reset = await fetch(new URL('/api/roots', server.url), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset: true }),
  });
  const restored = await reset.json() as Record<string, any>;

  assert.equal(update.status, 200);
  assert.deepEqual(updated.roots.map((root: { path: string }) => root.path), [secondRoot]);
  assert.deepEqual(saved.paths, [secondRoot]);
  assert.deepEqual(skills.body.skills.map((skill: { name: string }) => skill.name), ['second-skill']);
  assert.equal(reset.status, 200);
  assert.deepEqual(restored.roots.map((root: { path: string }) => root.path), [firstRoot, secondRoot]);
});

test('web UI serves local assets and reports its configured roots', async () => {
  const { base, root } = await app();
  const page = await fetch(base);
  const html = await page.text();
  const script = await (await fetch(new URL('/app.js', base))).text();
  const css = await (await fetch(new URL('/app.css', base))).text();
  const status = await json(base, '/api/status');

  assert.equal(page.status, 200);
  assert.match(html, /Skill 图谱工作台/);
  assert.match(html, /src="\/app\.js"/);
  assert.match(html, /Skill description/);
  assert.match(html, /AI 重建动作图/);
  assert.match(html, /自然语言修改/);
  // Evaluation is a whole-Skill action, so its entry sits with the graph tabs
  // rather than inside the per-card drawer.
  assert.match(html, /id="evaluate-skill"[^>]*>设计 Skill 评估</);
  assert.doesNotMatch(html, /评估与优化/);
  assert.match(html, /网页只读 · 宿主执行/);
  assert.match(html, /data-app-view="library"/);
  assert.match(html, /id="system-skill-list"/);
  assert.match(script, /api\/system-skills/);
  assert.match(script, /sourceQuery/);
  assert.match(html, /data-app-view="report"/);
  assert.match(html, /data-app-view="versions"/);
  assert.match(html, /id="report-workspace"/);
  assert.match(html, /id="versions-workspace"/);
  assert.match(script, /api\/library-report/);
  assert.match(script, /api\/snapshots/);
  assert.match(script, /function setAppView/);
  assert.match(html, /id="download-report-json"/);
  assert.match(script, /libraryReportMarkdown/);
  assert.match(script, /querySelectorAll\('\.workspace-choice'\)/);
  assert.doesNotMatch(script, /querySelectorAll\('\[data-app-view\]'\)/);
  assert.match(css, /\.workspace-nav \{/);
  assert.match(html, /id="source-disclosure"[\s\S]*id="root-form"/);
  assert.match(html, /id="root-form"[\s\S]*id="skill-search"/);
  assert.match(html, /id="brief-dialog"[\s\S]*id="brief-dialog-text"/);
  assert.equal((html.match(/id="result-summary"/g) ?? []).length, 1);
  assert.match(script, /data-brief-form/);
  assert.match(script, /api\/roots/);
  assert.match(script, /submitRoots/);
  assert.match(script, /data-toggle-all-metrics/);
  // The picker is in two places and one of them is a dialog created per open,
  // so 全选/清空 must be delegated from document. Scoping it to `#node-detail`
  // is exactly the bug where the button did nothing in the evaluation dialog.
  assert.match(script, /document\.addEventListener\('click', \(event\) => \{\s*const selectAllMetrics = event\.target\.closest\?\.\('\[data-toggle-all-metrics\]'\)/);
  assert.match(script, /document\.addEventListener\('change', \(event\) => \{\s*if \(!\(event\.target instanceof HTMLInputElement\) \|\| event\.target\.name !== 'metric'\) return;/);
  assert.match(script, /dialog\.showModal\(\)/);
  assert.match(css, /\.brief-dialog \{[\s\S]*width: min\(1080px, calc\(100vw - 48px\)\)/);
  assert.match(script, /class="brief-output" data-brief-output hidden/);
  assert.match(script, /skill-description'\)\.textContent = doc\.description/);
  assert.match(script, /rewrite-skill/);
  assert.match(script, /analyze-skill/);
  assert.match(script, /showAnalysisTask/);
  assert.match(script, /AI 评估任务已生成 · 效果未测/);
  assert.match(html, /规范与评估/);
  assert.match(script, /api\/review/);
  assert.match(script, /standards-tab'\)\.addEventListener\('click'/);
  assert.match(script, /state\.evaluationMetrics = Array\.isArray/);
  assert.match(script, /name="metric"/);
  assert.match(html, /<main id="main-content"[\s\S]*<\/main>\s*<aside id="node-drawer"/);
  assert.doesNotMatch(html, /drawer-backdrop/);
  assert.match(script, /body\.classList\.add\('panel-open'\)/);
  // The drawer is a read-out of the card the reader clicked in the graph, not a
  // second searchable index of the document: the list and its filter are gone,
  // and the detail still carries both host-task forms.
  assert.doesNotMatch(html, /id="node-search"/);
  assert.doesNotMatch(html, /id="node-list"/);
  assert.match(html, /<aside id="node-drawer"[\s\S]*id="node-detail"[\s\S]*<\/aside>/);
  assert.match(script, /event\.data\?\.type !== 'annot-node-selected'/);
  assert.match(script, /state\.selectedNodeId/);
  assert.match(script, /taskPanelMarkup\('rewrite', node\.id\)/);
  // The evaluation form is no longer injected into the drawer: it belongs to the
  // whole Skill and gets its own dialog from the entry beside the graph tabs.
  assert.doesNotMatch(script, /taskPanelMarkup\('evaluate'\)/);
  assert.match(script, /function showEvaluationTask/);
  assert.match(script, /type: 'annot-select-node'/);
  assert.doesNotMatch(html, /https?:\/\//);
  // A diagnosis without a repair path is what the user reported: "存在阻断项"
  // on screen and no button that produces the fix. Two entry points, because
  // the reader arrives from two places: the Skill-wide bar under the sheet, or
  // one failed check. A third copy in the header and the aside made the same
  // task look like three different ones, and is explicitly not coming back.
  assert.match(html, /id="standards-repair"/);
  assert.match(html, /id="standards-repair-note"/);
  assert.doesNotMatch(html, /id="standards-summary-repair"/);
  assert.doesNotMatch(html, /id="standards-repair-aside"/);
  assert.doesNotMatch(script, /standards-summary-repair|standards-repair-aside/);
  assert.match(script, /data-repair-check/);
  assert.match(script, /mode: 'repair'/);
  assert.match(script, /function generateRepairTask/);
  // A repair usually starts from something already on the clipboard — an issue,
  // a review note — so the form offers a paste button into the intent field.
  assert.match(script, /function showRepairTask/);
  assert.match(script, /data-paste-intent/);
  assert.match(script, /navigator\.clipboard\.readText/);
  assert.match(css, /\.intent-field \{ display: grid; gap: 8px; \}/);
  assert.match(script, /issue\.check \? `生成「\$\{issue\.title\}」修复任务`/);
  assert.match(css, /\.standards-repair-bar \{/);
  assert.doesNotMatch(css, /readiness-stack|\.repair-cta/);
  assert.deepEqual(status.body.roots.map((item: { path: string }) => item.path), [root]);
  assert.deepEqual(status.body.defaultRoots.map((item: { path: string }) => item.path), [root]);
  assert.equal(status.body.evaluationMetrics.length, 8);
  assert.match(status.body.instanceId, /^[0-9a-f-]{36}$/);
  assert.equal(typeof status.body.pid, 'number');
});

test('skills, search, flow, graph, audit and context all use the discovered fixture', async () => {
  const { base } = await app();
  const skills = await json(base, '/api/skills');
  const search = await json(base, '/api/search?q=Branch');
  const flow = await json(base, '/api/flow?name=branch-table');
  const audit = await json(base, '/api/audit');
  const review = await json(base, '/api/review?name=branch-table');
  const graph = await fetch(new URL('/api/graph?name=branch-table', base));
  const context = await json(base, `/api/context?name=branch-table&node=${flow.body.doc.nodes[0].id}`);

  assert.equal(skills.body.skills.length, 1);
  assert.equal(skills.body.skills[0].name, 'branch-table');
  assert.equal(search.body.matches[0].name, 'branch-table');
  assert.equal(flow.body.doc.description, 'A table whose first column names mutually exclusive outcomes.');
  // A branch edge is a claim about the source, so it comes from the analysis like
  // every other edge; the fixture's analysis is two sequential steps.
  assert.equal(flow.body.doc.source.method, 'ai');
  assert.equal(flow.body.doc.edges.filter((edge: { kind: string }) => edge.kind === 'sequence').length, 1);
  assert.equal(flow.body.layout.nodes.length, flow.body.doc.nodes.length);
  assert.equal(audit.body.audits.length, 1);
  assert.equal(review.body.skill, 'branch-table');
  assert.equal(review.body.evaluation.stages.length, 5);
  assert.ok(review.body.checks.some((check: { id: string }) => check.id === 'description'));
  assert.match(await graph.text(), /branch-table/);
  assert.equal(graph.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(context.body.original, /Review the proposed method/);
  assert.equal(context.body.source.sha, flow.body.doc.source.sha);
});

test('annot system skills are exposed separately and remain inspectable without entering the user library', async () => {
  const { base } = await app();
  const system = await json(base, '/api/system-skills');
  const user = await json(base, '/api/skills');
  assert.equal(system.response.status, 200);
  assert.equal(system.body.skills.length, 3);
  assert.equal(system.body.skills.find((skill: { name: string }) => skill.name === 'annot')?.role, 'primary');
  assert.ok(system.body.skills.every((skill: { source: string }) => skill.source === 'system'));
  assert.ok(!user.body.skills.some((skill: { name: string }) => skill.name === 'annot'));
  // The system skills ship with no analysis, and the workbench refuses to invent
  // one: the answer is a 409 that names the missing file, plus the task route that
  // produces it. Static review still works, because it does not claim a graph.
  const flow = await json(base, '/api/flow?name=annot&source=system');
  const review = await json(base, '/api/review?name=annot&source=system');
  const graph = await json(base, '/api/graph?name=annot&source=system');
  const brief = await fetch(new URL('/api/brief', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'annot', source: 'system', mode: 'analyze', intent: '' }),
  });
  assert.equal(flow.response.status, 409);
  assert.equal(flow.body.analyze, true);
  assert.match(flow.body.analysisPath, /annot\.analysis\.json$/);
  assert.equal(review.response.status, 200);
  assert.equal(review.body.skill, 'annot');
  assert.equal(graph.response.status, 409);
  assert.equal(brief.status, 200);
  assert.equal((await brief.json() as Record<string, any>).writesSource, false);
});
test('whole-library report, snapshots and host optimization task share one read-only pipeline', async () => {
  const { base, root, reportDir } = await app();
  const report = await json(base, '/api/library-report');
  assert.equal(report.response.status, 200);
  assert.equal(report.body.summary.skills, 1);
  assert.equal(report.body.skills[0].evaluationStatus, 'unmeasured');
  assert.match(report.body.boundary, /当前未运行/);

  const first = await fetch(new URL('/api/snapshots', base), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'before' }),
  });
  const firstBody = await first.json() as Record<string, any>;
  assert.equal(first.status, 201);
  assert.match(firstBody.snapshot.id, /^[0-9TZ-]+-[0-9a-f-]{8}$/);
  assert.ok(firstBody.snapshot.path.startsWith(root.split('skills')[0]));

  const skillFile = join(root, 'branch-table', 'SKILL.md');
  await writeFile(skillFile, (await readFile(skillFile, 'utf8')) + '\n\nSnapshot change.\n', 'utf8');
  const second = await fetch(new URL('/api/snapshots', base), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'after' }),
  });
  const secondBody = await second.json() as Record<string, any>;
  assert.equal(second.status, 201);
  const diff = await json(base, `/api/snapshots/diff?from=${firstBody.snapshot.id}&to=${secondBody.snapshot.id}`);
  assert.deepEqual(diff.body.changed, ['branch-table']);
  const snapshots = await json(base, '/api/snapshots');
  assert.equal(snapshots.body.snapshots.length, 2);

  const task = await fetch(new URL('/api/library-report/task', base), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'optimize' }),
  });
  const taskBody = await task.json() as Record<string, any>;
  assert.equal(task.status, 200);
  assert.equal(taskBody.writesSource, false);
  assert.match(taskBody.brief, /先检查 Git 工作区/);
  assert.match(taskBody.brief, /行为效果：未测/);
  assert.ok(taskBody.reportPath.startsWith(reportDir));
  assert.ok(taskBody.markdownPath.startsWith(reportDir));
  assert.match(await readFile(taskBody.markdownPath, 'utf8'), /# annot Skill 库评估报告/);
  const persisted = JSON.parse(await readFile(taskBody.reportPath, 'utf8'));
  assert.equal(persisted.report.summary.skills, 1);
});
test('web flow prefers a valid cached AI analysis over the rules draft', async () => {
  const { base, root, analysisDir } = await app();
  const source = await readFile(join(root, 'branch-table', 'SKILL.md'), 'utf8');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const quote = lines[10];
  const proposal = {
    schema_version: 1,
    skill: 'branch-table',
    source_sha: parseSkill(source).sha,
    nodes: [{ id: 'n-review', type: 'stage', label: 'Review the proposed method', start: 11, end: 11, quote, confidence: 0.95 }],
    edges: [],
  };
  await writeFile(join(analysisDir, 'branch-table.analysis.json'), JSON.stringify(proposal), 'utf8');

  const flow = await json(base, '/api/flow?name=branch-table');

  assert.equal(flow.response.status, 200);
  assert.equal(flow.body.doc.source.method, 'ai');
  assert.equal(flow.body.doc.nodes.length, 1);
  assert.equal(flow.body.doc.nodes[0].label, 'Review the proposed method');
});

test('a Skill without an analysis gets no graph, only the task that produces one', async () => {
  const { base, analysisDir } = await app();
  // Removing the cache is the state of every Skill before its first analysis.
  await rm(join(analysisDir, 'branch-table.analysis.json'));
  const flow = await json(base, '/api/flow?name=branch-table');
  assert.equal(flow.response.status, 409);
  assert.equal(flow.body.reason, 'no-analysis');
  assert.equal(flow.body.analyze, true);
  assert.match(flow.body.analysisPath, /branch-table\.analysis\.json$/);

  // The graph document is refused too: an iframe that rendered a draft would be
  // indistinguishable from one that rendered an analysis.
  const graph = await json(base, '/api/graph?name=branch-table');
  assert.equal(graph.response.status, 409);

  // Rewrite needs a card, and a card only exists after an analysis.
  const rewrite = await fetch(new URL('/api/brief', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'rewrite', node: 'n-review', intent: 'x' }),
  });
  assert.equal(rewrite.status, 409);
  // The analysis task itself is still produced: that is the way out of the state.
  const analyze = await fetch(new URL('/api/brief', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'analyze' }),
  });
  assert.equal(analyze.status, 200);
  assert.match((await analyze.json() as Record<string, any>).brief, /annot annotate/);

  // Static standards review never claimed a graph, so it keeps working.
  const review = await json(base, '/api/review?name=branch-table');
  assert.equal(review.response.status, 200);
});

test('an analysis written for an older revision is reported as stale, not as bad input', async () => {
  const { base, root, analysisDir } = await app();
  // Editing the Skill after analysing it is the ordinary case, not a malformed
  // request. Before this, the hash mismatch fell through the generic handler and
  // the page said "invalid request", which points at the client for no reason.
  const source = await readFile(join(root, 'branch-table', 'SKILL.md'), 'utf8');
  const currentSha = parseSkill(source).sha;
  const staleSha = currentSha === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
  // The proposal itself is well-formed — only the body it described has changed.
  const analysisPath = join(analysisDir, 'branch-table.analysis.json');
  const proposal = JSON.parse(await readFile(analysisPath, 'utf8'));
  await writeFile(analysisPath, JSON.stringify({ ...proposal, source_sha: staleSha }), 'utf8');

  const flow = await json(base, '/api/flow?name=branch-table');
  assert.equal(flow.response.status, 409);
  assert.equal(flow.body.reason, 'stale-analysis');
  assert.equal(flow.body.proposalSha, staleSha);
  assert.equal(flow.body.currentSha, currentSha);
  assert.equal(flow.body.analyze, true);
  assert.match(flow.body.analysisPath, /branch-table\.analysis\.json$/);

  const graph = await json(base, '/api/graph?name=branch-table');
  assert.equal(graph.response.status, 409);
  assert.equal(graph.body.reason, 'stale-analysis');
  assert.equal(graph.body.currentSha, currentSha);

  // The exit is still offered: an analysis task regenerates the same file.
  const analyze = await fetch(new URL('/api/brief', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'analyze' }),
  });
  assert.equal(analyze.status, 200);

  // And a rewrite card cannot be built from anchors that may no longer exist.
  // The brief routes answer with their own sentence shape, but they must name
  // the same file to replace rather than reporting a malformed request.
  const rewrite = await fetch(new URL('/api/brief', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'rewrite', node: 'n-review', intent: 'x' }),
  });
  assert.equal(rewrite.status, 409);
  const staleBrief = await rewrite.json() as Record<string, any>;
  assert.match(staleBrief.error, /older version of this Skill/);
  assert.match(staleBrief.error, /branch-table\.analysis\.json$/);
});

test('a task can be written to disk and comes back with the command that runs it', async () => {
  const { base, root, taskDir } = await app();
  const response = await fetch(new URL('/api/tasks', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'evaluate', intent: '评估成本', metrics: ['efficiency'] }),
  });
  const body = await response.json() as Record<string, any>;
  assert.equal(response.status, 201);
  assert.equal(body.writesSource, false);
  assert.match(body.file, /branch-table\.evaluate\.md$/);
  assert.match(body.command, /claude -p/);
  assert.equal(typeof body.claudeFound, 'boolean');
  const written = await readFile(body.file, 'utf8');
  assert.match(written, /评估成本/);
  assert.match(written, /源哈希/);

  // The source Skill is untouched by the handoff, which is the entire boundary.
  const source = await readFile(join(root, 'branch-table', 'SKILL.md'), 'utf8');
  assert.match(source, /A table whose first column names mutually exclusive outcomes/);

  const bad = await fetch(new URL('/api/tasks', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'rewrite', node: 'n-missing', intent: '' }),
  });
  assert.equal(bad.status, 409);
});

test('brief routes generate AI analysis, evaluation, and bounded rewrite tasks without writing source', async () => {
  const { base, root, analysisDir } = await app();
  const sourcePath = join(root, 'branch-table', 'SKILL.md');
  const before = await readFile(sourcePath, 'utf8');
  const flow = await json(base, '/api/flow?name=branch-table');
  const node = flow.body.doc.nodes[0].id;

  const rewrite = await fetch(new URL('/api/brief', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', node, mode: 'rewrite', intent: '先检查未提交改动，再继续。' }),
  });
  const rewriteBody = await rewrite.json() as Record<string, any>;
  const evaluate = await fetch(new URL('/api/brief', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'evaluate', intent: '评估触发准确性和运行成本。', metrics: ['selection', 'efficiency'] }),
  });
  const evaluateBody = await evaluate.json() as Record<string, any>;
  const analyze = await fetch(new URL('/api/brief', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'analyze' }),
  });
  const analyzeBody = await analyze.json() as Record<string, any>;
  const openEvaluation = await fetch(new URL('/api/brief', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'evaluate' }),
  });
  const openEvaluationBody = await openEvaluation.json() as Record<string, any>;
  const after = await readFile(sourcePath, 'utf8');

  assert.equal(rewrite.status, 200);
  assert.equal(rewriteBody.mode, 'rewrite');
  assert.equal(rewriteBody.writesSource, false);
  assert.match(rewriteBody.brief, /先检查未提交改动，再继续/);
  assert.match(rewriteBody.brief, /Review the proposed method/);
  assert.match(rewriteBody.brief, /annot check/);
  assert.equal(evaluate.status, 200);
  assert.equal(evaluateBody.mode, 'evaluate');
  assert.equal(evaluateBody.writesSource, false);
  assert.deepEqual(evaluateBody.metrics, ['selection', 'efficiency']);
  assert.equal(evaluateBody.method, 'ai');
  assert.match(evaluateBody.brief, /先理解 Skill 要改变的真实行为/);
  assert.match(evaluateBody.brief, /without-skill/);
  assert.equal(analyze.status, 200);
  assert.equal(analyzeBody.method, 'ai');
  assert.match(analyzeBody.brief, /不要用关键词表、动词表或正则规则/);
  assert.match(analyzeBody.brief, /quote.*逐字一致/);
  // The task must name the file this server actually reads. A brief that points
  // at `.annot/<skill>/analyses/...` produces a real analysis the page never
  // loads, which looks exactly like a broken graph.
  const proposalPath = join(analysisDir, 'branch-table.analysis.json').replace(/\\/g, '\\\\');
  assert.match(analyzeBody.brief, new RegExp(proposalPath));
  // A second, nested `analyses` directory is the failure this pins: it reads as
  // "the graph is broken" when in fact the host wrote a correct analysis to a
  // path nobody loads.
  assert.doesNotMatch(analyzeBody.brief, /skills\\branch-table\\analyses/);
  assert.equal(openEvaluation.status, 200);
  assert.match(openEvaluationBody.brief, /用户目标：未指定/);
  assert.match(evaluateBody.brief, /没有运行就明确写“未测”/);
  assert.match(evaluateBody.brief, /应触发.*隐式.*带噪上下文/s);
  assert.match(evaluateBody.brief, /不应触发或相邻 Skill 冲突的负例/);
  assert.equal(after, before);
});

test('repair brief turns failing checks into a bounded task without writing source', async () => {
  const { base, root } = await app();
  const sourcePath = join(root, 'branch-table', 'SKILL.md');
  const before = await readFile(sourcePath, 'utf8');
  const review = await json(base, '/api/review?name=branch-table');
  const failing = review.body.checks.filter((check: { status: string }) => check.status !== 'pass');
  assert.ok(failing.length > 0, 'the fixture must have something to repair');

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(new URL('/api/brief', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'branch-table', mode: 'repair', ...body }),
    });
    return { response, body: await response.json() as Record<string, any> };
  };

  const all = await post({});
  assert.equal(all.response.status, 200);
  assert.equal(all.body.mode, 'repair');
  assert.equal(all.body.writesSource, false);
  assert.equal(all.body.source_sha, review.body.source_sha);
  assert.deepEqual(all.body.targets.map((item: { id: string }) => item.id), failing.map((check: { id: string }) => check.id));
  assert.match(all.body.brief, /没有修改任何 Skill 文件/);
  assert.match(all.body.brief, /不能为了过检而删除内容/);

  const single = await post({ checks: ['description-trigger'] });
  assert.equal(single.response.status, 200);
  assert.deepEqual(single.body.targets.map((item: { id: string }) => item.id), ['description-trigger']);
  assert.match(single.body.brief, /description-trigger/);
  assert.match(single.body.brief, /L4/);
  assert.match(single.body.brief, /Use when the user asks/);

  const unknown = await post({ checks: ['not-a-check'] });
  const passing = await post({ checks: ['name'] });
  const badShape = await post({ checks: 'description-trigger' });
  assert.equal(unknown.response.status, 400);
  assert.equal(passing.response.status, 409);
  assert.equal(badShape.response.status, 400);
  assert.equal(await readFile(sourcePath, 'utf8'), before);

  // The reader's pasted instructions travel with the request and are quoted
  // into the task, not dropped on the floor.
  const noted = await post({ checks: ['description-trigger'], intent: '先只修触发词' });
  assert.equal(noted.response.status, 200);
  assert.equal(noted.body.note, '先只修触发词');
  assert.match(noted.body.brief, /读者补充说明（原样引用）/);
  assert.match(noted.body.brief, /先只修触发词/);
});

test('brief routes reject malformed, oversized, cross-site and unknown requests', async () => {
  const { base } = await app();
  const flow = await json(base, '/api/flow?name=branch-table');
  const node = flow.body.doc.nodes[0].id;
  const url = new URL('/api/brief', base);
  const nonJson = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  const tooLarge = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'evaluate', intent: 'x'.repeat(17000) }),
  });
  const unknownMetric = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', mode: 'evaluate', metrics: ['not-a-metric'] }),
  });
  const crossSite = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ name: 'branch-table', mode: 'evaluate' }),
  });
  const wrongMethod = await fetch(url);
  const unknownSkill = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'does-not-exist', mode: 'evaluate' }),
  });
  const unknownNode = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', node: 'does-not-exist', mode: 'rewrite' }),
  });
  const wrongMode = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'branch-table', node, mode: 'publish' }),
  });

  assert.equal(nonJson.status, 415);
  assert.equal(tooLarge.status, 413);
  assert.equal(unknownMetric.status, 400);
  assert.equal(crossSite.status, 403);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal(unknownSkill.status, 404);
  assert.equal(unknownNode.status, 404);
  assert.equal(wrongMode.status, 400);
});

test('the server rejects unknown skills, path input, cross-site requests and writes', async () => {
  const { base } = await app();
  const unknown = await fetch(new URL('/api/flow?name=..%2F..%2Fsecret', base));
  const crossSite = await fetch(new URL('/api/skills', base), { headers: { 'sec-fetch-site': 'cross-site' } });
  const forwarded = await fetch(new URL('/api/skills', base), { headers: { 'x-forwarded-for': '203.0.113.9' } });
  const wrongOrigin = await fetch(new URL('/api/skills', base), { headers: { origin: 'http://example.com' } });
  const write = await fetch(new URL('/api/skills', base), { method: 'POST' });

  assert.equal(unknown.status, 404);
  assert.equal(crossSite.status, 403);
  assert.equal(forwarded.status, 403);
  assert.equal(wrongOrigin.status, 403);
  assert.equal(write.status, 405);
});

test('the web server binds only to IPv4 loopback', async () => {
  const { base } = await app();
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
});
