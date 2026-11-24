import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
  AnalysisValidationError,
  StaleAnalysisError,
  buildAnalysisPrompt,
  buildEvaluationPrompt,
  buildFlowFromAnalysis,
  parseAnalysisProposal,
  type AnalysisProposal,
} from '../src/analysis.ts';
import { parseSkill } from '../src/parse.ts';

const run = promisify(execFile);
const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts');

const SOURCE = [
  '---',
  'name: analysis-demo',
  'description: Demonstrate AI-owned semantic analysis.',
  '---',
  '',
  '# Analysis demo',
  '',
  '## Flow',
  '',
  '1. Read the source file.',
  '2. If evidence is missing, stop.',
  '3. Write the report.',
  '',
  '## Principle',
  '',
  'Preserve evidence.',
  '',
].join('\n');

function proposal(): AnalysisProposal {
  const sha = parseSkill(SOURCE).sha;
  return {
    schema_version: 1,
    skill: 'analysis-demo',
    source_sha: sha,
    nodes: [
      { id: 'n-read', type: 'stage', label: 'Read the source file', start: 10, end: 10, quote: '1. Read the source file.', confidence: 0.95, reason: 'Direct action.' },
      // The source names one exit ("stop") and no target for the other arm, so
      // the second way out is declared as open rather than invented. A decision
      // with a single exit is rejected outright now; this fixture has to be a
      // real fork or it is not a decision.
      { id: 'n-stop', type: 'decision', label: 'Stop when evidence is missing', start: 11, end: 11, quote: '2. If evidence is missing, stop.', openBranches: ['证据齐备，继续'], confidence: 0.92 },
      { id: 'n-write', type: 'artifact', label: 'Write the report', start: 12, end: 12, quote: '3. Write the report.', lane: 'output', confidence: 0.93 },
      { id: 'n-rule', type: 'note', label: 'Preserve evidence', start: 16, end: 16, quote: 'Preserve evidence.', noteRole: 'principle', associationScope: 'skill', confidence: 0.9 },
    ],
    edges: [
      { from: 'n-read', to: 'n-stop', kind: 'sequence' },
      // "If evidence is missing, stop" is the condition that reaches the report,
      // not a plain "and then". Drawing it as sequence was the flattened-fork
      // shape the prompt now forbids.
      { from: 'n-stop', to: 'n-write', kind: 'branch', when: '证据齐备，继续' },
    ],
  };
}

test('the analysis prompt delegates semantics to AI and carries exact source anchors', () => {
  const prompt = buildAnalysisPrompt(SOURCE, 'SKILL.md');

  assert.match(prompt, /不要用关键词表、动词表或正则规则/);
  assert.match(prompt, /0010 \| 1\. Read the source file\./);
  assert.match(prompt, new RegExp(parseSkill(SOURCE).sha));
  assert.match(prompt, /quote.*逐字一致/);
});

test('the analysis prompt makes an edge earn itself instead of defaulting to reading order', () => {
  const prompt = buildAnalysisPrompt(SOURCE, 'SKILL.md');

  // The old rule was "connect the steps in reading order". It turned every
  // numbered list into a pipeline: 44 real analyses shipped 348 sequence edges,
  // 234 of them jumping a heading. The replacement has to state the two reasons
  // an edge is allowed to exist, or the model will fall back to the default.
  assert.match(prompt, /连边必须挣来/);
  assert.match(prompt, /产出传递/);
  assert.match(prompt, /状态推进/);
  assert.doesNotMatch(prompt, /默认按阅读顺序连/);

  // Each of the five rules the user asked for, pinned by the words that make it
  // checkable rather than by position in the prompt.
  assert.match(prompt, /没有产出的纯动作不得续到无关动作/);
  assert.match(prompt, /判断 \/ 路由 \/ 按需加载建 `decision`/);
  assert.match(prompt, /只有一条出边的判断，等于把分叉压平/);
  assert.match(prompt, /门禁永不进主链|`gate` 永不进主链/);
  assert.match(prompt, /constrains/);
  assert.match(prompt, /不许跨小节直接连 `sequence`/);
  assert.match(prompt, /有交付物的动作以 `artifact` 收尾/);
});

test('an AI proposal becomes a flow without invoking the keyword classifier', () => {
  const doc = buildFlowFromAnalysis(SOURCE, proposal(), {
    sourceFile: 'SKILL.md',
    now: () => '2026-11-20T00:00:00.000Z',
  });

  assert.equal(doc.source.method, 'ai');
  assert.equal(doc.nodes.length, 4);
  assert.equal(doc.nodes[0].source, 'analysis');
  assert.equal(doc.nodes[0].type, 'stage');
  assert.equal(doc.nodes[0].label, 'Read the source file');
  assert.equal(doc.nodes[0].raw, '1. Read the source file.');
  assert.equal(doc.nodes[3].associationScope, 'skill');
  assert.deepEqual(doc.edges.map((edge) => edge.kind), ['sequence', 'branch']);
  assert.equal(doc.edges[1].when, '证据齐备，继续');
  assert.equal(doc.stats.maxDepth, 3);
});

test('analysis rejects a gate drawn into the trunk, and says what to do instead', () => {
  const invalid = proposal();
  invalid.nodes.push({
    id: 'n-gate', type: 'gate', label: 'Never guess', start: 16, end: 16,
    quote: 'Preserve evidence.', lane: 'reader', confidence: 0.9,
  });
  invalid.edges.push({ from: 'n-read', to: 'n-gate', kind: 'sequence' });

  // A prompt asked for this and 40 shipped analyses broke it 127 times. The
  // validator is the half that cannot be ignored.
  assert.throws(
    () => buildFlowFromAnalysis(SOURCE, invalid),
    (error: unknown) => error instanceof AnalysisValidationError
      && /gate is a constraint beside an action, not a step/.test(error.message)
      && /constrains/.test(error.message),
  );
});

test('analysis rejects a decision with one way out', () => {
  const invalid = proposal();
  invalid.nodes[1].openBranches = [];
  invalid.edges = [
    { from: 'n-read', to: 'n-stop', kind: 'sequence' },
    { from: 'n-stop', to: 'n-write', kind: 'sequence' },
  ];

  assert.throws(
    () => buildFlowFromAnalysis(SOURCE, invalid),
    (error: unknown) => error instanceof AnalysisValidationError
      && /fewer than two ways out/.test(error.message)
      && /make it a stage/.test(error.message),
  );
});

test('analysis rejects a branch drawn from something that is not a decision', () => {
  const invalid = proposal();
  invalid.edges = [{ from: 'n-read', to: 'n-write', kind: 'branch', when: '证据齐备' }];

  assert.throws(
    () => buildFlowFromAnalysis(SOURCE, invalid),
    (error: unknown) => error instanceof AnalysisValidationError && /only a decision can branch/.test(error.message),
  );
});

test('analysis rejects a quote that does not match its source range', () => {
  const invalid = proposal();
  invalid.nodes[0].quote = 'A paraphrase instead of source.';

  assert.throws(
    () => buildFlowFromAnalysis(SOURCE, invalid),
    (error: unknown) => error instanceof AnalysisValidationError && /quote does not exactly match/.test(error.message),
  );
});

test('analysis rejects a proposal made against a different source revision', () => {
  const invalid = proposal();
  invalid.source_sha = '0'.repeat(64);

  // A stale proposal is not a typo the reader can fix: it is the normal result
  // of editing the Skill. It gets its own type so callers answer with "analyse
  // it again" and name the file to replace, not with a validation message.
  assert.throws(
    () => buildFlowFromAnalysis(SOURCE, invalid, { analysisPath: '.annot/analyses/x.analysis.json' }),
    (error: unknown) => {
      if (!(error instanceof StaleAnalysisError) || !/source hash mismatch/.test(error.message)) return false;
      return error.detail.analysisPath === '.annot/analyses/x.analysis.json'
        && error.detail.currentSha === parseSkill(SOURCE).sha
        && error.detail.proposalSha === '0'.repeat(64);
    },
  );
});

test('analysis refuses a node-scoped note without a target', () => {
  const invalid = proposal();
  invalid.nodes[3].associationScope = 'node';

  assert.throws(
    () => buildFlowFromAnalysis(SOURCE, invalid),
    (error: unknown) => error instanceof AnalysisValidationError && /no association targets/.test(error.message),
  );
});

test('analysis JSON can be copied from a model code fence', () => {
  const parsed = parseAnalysisProposal(['```json', JSON.stringify(proposal()), '```', ''].join('\n'));

  assert.equal(parsed.nodes[1].type, 'decision');
});

test('evaluation prompt asks AI to derive scenarios from behavior', () => {
  const prompt = buildEvaluationPrompt(SOURCE, 'SKILL.md', 'Check recovery', ['recovery']);

  assert.match(prompt, /先理解 Skill 要改变的真实行为/);
  assert.match(prompt, /without-skill/);
  assert.match(prompt, /没有运行就明确写“未测”/);
  assert.match(prompt, /0011 \| 2\. If evidence is missing, stop\./);
});

test('annotate accepts a validated AI proposal through the CLI', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'annot-ai-analysis-'));
  try {
    const skillDir = join(temp, 'skill');
    const outDir = join(temp, 'out');
    const analysisPath = join(temp, 'analysis.json');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), SOURCE, 'utf8');
    await writeFile(analysisPath, JSON.stringify(proposal()), 'utf8');

    const { stdout } = await run(process.execPath, [CLI, 'annotate', skillDir, '--analysis', analysisPath, '--out', outDir, '--json']);
    const result = JSON.parse(stdout);
    const flow = JSON.parse(await readFile(join(outDir, 'analysis-demo.flow.json'), 'utf8'));

    assert.equal(result.doc.source.method, 'ai');
    assert.equal(flow.nodes.length, 4);
    assert.equal(flow.nodes[0].source, 'analysis');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
