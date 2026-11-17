/**
 * Search is the tier that decides whether a reviewer ever finds a skill, so the
 * two properties that make it trustworthy are asserted here rather than left to
 * inspection:
 *
 *   - every token must match somewhere (AND, not OR), because an OR search that
 *     returns forty skills is indistinguishable from no search at all;
 *   - the default tier must not read the body, because a body hit is a hit the
 *     host would never have offered — matching one silently would let the tool
 *     claim knowledge the model does not have.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_RANKS, type RootSpec } from '../src/discover.ts';
import { formatSearch, searchSkills } from '../src/search.ts';

const SKILLS = {
  'audit-slim': `---
name: audit-slim
description: 工作流审计瘦身：把常驻资产摊表，按触发证据分级。
---

# Audit

## Audit & Slim

正文里提到一次 tidying 这个词。
`,
  'agent-dev-standards': `---
name: agent-dev-standards
description: 规范地创建与审查 Agent：契约、边界、工具白名单。
---

# Agent

## 契约

这一行故意不含那个关键词。
`,
  'report-writer': `---
name: report-writer
description: 写周报。
---

# Report

## 正文

这一段提到 审计 这个词，但只在正文里。
`,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'annot-search-'));
  for (const [name, text] of Object.entries(SKILLS)) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), text, 'utf8');
  }
  const roots: RootSpec[] = [{ path: root, rank: DEFAULT_RANKS.custom, label: 'fixture' }];
  return { root, roots };
}

test('a token must match every part of the query, not any of it', async () => {
  const { root, roots } = await fixture();
  try {
    const both = await searchSkills(roots, '审计 Agent');
    // No skill carries both words in its metadata tier.
    assert.deepEqual(both.matches.map((m) => m.name), []);

    const one = await searchSkills(roots, '审计');
    assert.deepEqual(one.matches.map((m) => m.name), ['audit-slim'], 'a body-only match leaked into the metadata tier');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the body is only searched when asked', async () => {
  const { root, roots } = await fixture();
  try {
    const shallow = await searchSkills(roots, '审计');
    assert.equal(shallow.body, false);
    assert.equal(shallow.matches.some((m) => m.name === 'report-writer'), false);

    const deep = await searchSkills(roots, '审计', { body: true });
    assert.equal(deep.body, true);
    assert.deepEqual(deep.matches.map((m) => m.name).sort(), ['audit-slim', 'report-writer']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a name hit outranks a description hit', async () => {
  const { root, roots } = await fixture();
  try {
    const result = await searchSkills(roots, 'agent');
    const byName = result.matches.find((m) => m.name === 'agent-dev-standards');
    assert.ok(byName, 'the name match disappeared');
    assert.equal(byName.hits[0].field, 'name');
    for (const other of result.matches) {
      if (other.name === 'agent-dev-standards') continue;
      assert.ok(byName.score >= other.score, 'a name match ranked below a weaker match');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an empty query returns nothing instead of everything', async () => {
  const { root, roots } = await fixture();
  try {
    for (const query of ['', '   ', '---']) {
      const result = await searchSkills(roots, query);
      assert.deepEqual(result.matches, [], `"${query}" returned matches`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hits carry a line number when they have one, and none when they do not', async () => {
  const { root, roots } = await fixture();
  try {
    const result = await searchSkills(roots, '契约');
    const match = result.matches[0];
    assert.ok(match, 'heading search found nothing');
    const heading = match.hits.find((hit) => hit.field === 'heading');
    assert.ok(heading, 'no heading hit');
    assert.equal(heading.line, 8, 'heading hits must point at a real line');

    const nameHit = match.hits.find((hit) => hit.field === 'name');
    if (nameHit) assert.equal(nameHit.line, undefined, 'a name hit has no line and must not invent one');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the report states which tier it searched', async () => {
  const { root, roots } = await fixture();
  try {
    const shallow = await searchSkills(roots, '审计');
    assert.match(formatSearch(shallow), /名称·描述·标题/);
    assert.doesNotMatch(formatSearch(shallow), /正文/);

    const deep = await searchSkills(roots, '审计', { body: true });
    assert.match(formatSearch(deep), /名称·描述·标题·正文/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unreadable root is reported, never silently empty', async () => {
  const { root, roots } = await fixture();
  try {
    const missing: RootSpec[] = [...roots, { path: join(root, 'nope'), rank: DEFAULT_RANKS.custom + 1, label: 'missing' }];
    const result = await searchSkills(missing, '审计');
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /unreadable|not a directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
