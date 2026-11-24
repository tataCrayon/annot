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
      { id: 'n-stop', type: 'decision', label: 'Stop when evidence is missing', start: 11, end: 11, quote: '2. If evidence is missing, stop.', confidence: 0.92 },
      { id: 'n-write', type: 'artifact', label: 'Write the report', start: 12, end: 12, quote: '3. Write the report.', lane: 'output', confidence: 0.93 },
      { id: 'n-rule', type: 'note', label: 'Preserve evidence', start: 16, end: 16, quote: 'Preserve evidence.', noteRole: 'principle', associationScope: 'skill', confidence: 0.9 },
    ],
    edges: [
      { from: 'n-read', to: 'n-stop', kind: 'sequence' },
      { from: 'n-stop', to: 'n-write', kind: 'sequence' },
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
  assert.deepEqual(doc.edges.map((edge) => edge.kind), ['sequence', 'sequence']);
  assert.equal(doc.stats.maxDepth, 3);
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
