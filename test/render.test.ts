/**
 * A blank page is the silent failure mode of a single-file report: the markup
 * is complete, the script throws on line 3, and the user sees an empty canvas
 * with no error. Compiling the script is not enough, so this test runs it
 * against a minimal DOM and fails on any exception.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import { buildFlowFromAnalysis, parseAnalysisProposal } from '../src/analysis.ts';
import { layoutNodes, renderHtml } from '../src/render.ts';
import type { Layout } from '../src/render.ts';

const here = dirname(fileURLToPath(import.meta.url));

interface StubElement {
  tagName: string;
  attrs: Record<string, string>;
  children: StubElement[];
  textContent: string;
  innerHTML: string;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
  appendChild: (child: StubElement) => StubElement;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  addEventListener: (event: string, handler: () => void) => void;
  querySelector: () => StubElement | null;
  querySelectorAll: () => StubElement[];
}

function makeElement(tagName = 'div'): StubElement {
  const classes = new Set<string>();
  const walk = (node: StubElement): StubElement[] => [node, ...node.children.flatMap(walk)];
  const matches = (node: StubElement, selector: string): boolean => {
    if (!selector.startsWith('.')) return node.tagName === selector;
    const name = selector.slice(1);
    const attrClass = (node.attrs.class ?? '').split(/\s+/);
    return node.classList.contains(name) || attrClass.includes(name);
  };

  const element: StubElement = {
    tagName,
    attrs: {},
    children: [],
    textContent: '',
    innerHTML: '',
    classList: {
      add: (c) => void classes.add(c),
      remove: (c) => void classes.delete(c),
      contains: (c) => classes.has(c),
    },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    setAttribute(k, v) {
      element.attrs[k] = v;
    },
    getAttribute(k) {
      return element.attrs[k] ?? null;
    },
    addEventListener() {},
    style: {},
    querySelector: (selector = '.node') => walk(element).find((n) => n !== element && matches(n, selector)) ?? null,
    querySelectorAll: (selector = '.node') => walk(element).filter((n) => n !== element && matches(n, selector)),
  };
  return element;
}

/** The two JSON payloads the page expects, plus a DOM just large enough. */
async function runClient(source?: string): Promise<{ svg: StubElement; panel: StubElement; layout: Layout }> {
  const text = source ?? await readFile(join(here, 'fixtures', 'grill-method.md'), 'utf8');
  const doc = buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' });
  const html = renderHtml(doc);

  const payload = /<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  const layout = /<script id="flow-layout" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  const client = /<script>\n([\s\S]*?)\n<\/script>/.exec(html);
  assert.ok(payload && layout && client, 'page is missing one of its three scripts');

  const nodes = new Map<string, StubElement>();
  const svg = makeElement('svg');
  const canvas = makeElement('div');
  // `event.target.closest('.node')` decides whether a canvas click cleared the
  // selection; the stub needs the method even when nothing is closest.
  canvas.addEventListener = function (this: StubElement, type: string, listener: (event: { target: unknown }) => void) {
    if (type === 'click') (this as unknown as { onClick?: unknown }).onClick = listener;
  } as StubElement['addEventListener'];
  const panel = makeElement('div');
  const todos = makeElement('div');

  nodes.set('flow-data', makeElement('script'));
  nodes.get('flow-data')!.textContent = payload[1];
  nodes.set('flow-layout', makeElement('script'));
  nodes.get('flow-layout')!.textContent = layout[1];
  nodes.set('canvas', canvas);
  nodes.set('detail', makeElement('aside'));
  nodes.set('panel', panel);
  nodes.set('todos', todos);
  // The toolbar is part of the page the client expects. A stub DOM that omits it
  // cannot tell "the script threw" from "the page has no toolbar", so every
  // control the client binds has to exist here too.
  for (const id of ['find', 'hits', 'trace', 'zoom-in', 'zoom-out', 'zoom-reset']) {
    nodes.set(id, makeElement('div'));
  }

  const document = {
    // The client decides whether to pre-select the first card by looking at the
    // body class (`is-embedded`), which the real page always has.
    body: { classList: { contains: () => false } },
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElementNS: (_ns: string, tag: string) => (tag === 'svg' ? svg : makeElement(tag)),
    createElement: (tag: string) => makeElement(tag),
    // The chip snake measures `.action-chain`; the page always has one, so the
    // stub must too or "no script threw" would be untested on that path.
    querySelector: (selector: string) => (selector === '.action-chain' ? makeElement('ol') : null),
    querySelectorAll: () => [],
    // The client binds keyboard shortcuts on the document; a stub without this
    // throws before the first card is drawn, and the failure reads as "the
    // renderer is broken" when it is the test that is incomplete.
    addEventListener() {},
  };
  const context = vm.createContext({
    document,
    console,
    window: { parent: { postMessage() {} }, addEventListener() {}, requestAnimationFrame() {} },
    JSON,
    Math,
    String,
    Number,
    Object,
    Array,
    Set,
    Map,
    // Zoom reads the container size to keep the scroll position; a headless
    // context has no layout, so the numbers only have to be numbers.
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  });
  new vm.Script(client[1], { filename: 'annot-client.js' }).runInContext(context);
  return { svg, panel, layout: JSON.parse(layout[1]) as Layout };
}

test('a folded rule chapter is drawn once and hidden behind its anchor card', async () => {
  // The fold is a view, not a deletion: every card still gets a group so the
  // render check can prove its anchor is drawable, and the page hides the tail.
  // Without this test the two halves could drift — the layout stops drawing the
  // tail, or the client forgets to hide it — and both look like a correct graph.
  const lines = ['# Fold', '', '## 红线', ''];
  for (let index = 1; index <= 6; index += 1) lines.push(`${index}. 红线 ${index}：必须守住。`);
  lines.push('', '## 流程', '', '做这件事。', '');
  const source = lines.join(String.fromCharCode(10));
  const sha = parseSkill(source).sha;
  const nodes = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `n-rule-${index}`,
      type: 'gate' as const,
      label: `红线 ${index + 1}`,
      start: 5 + index,
      end: 5 + index,
      quote: `${index + 1}. 红线 ${index + 1}：必须守住。`,
      associationScope: 'skill' as const,
    })),
    { id: 'n-work', type: 'stage' as const, label: '做这件事', start: 14, end: 14, quote: '做这件事。' },
    { id: 'n-more', type: 'stage' as const, label: '再做一件事', start: 14, end: 14, quote: '做这件事。' },
    { id: 'n-third', type: 'stage' as const, label: '第三件事', start: 14, end: 14, quote: '做这件事。' },
    { id: 'n-fourth', type: 'stage' as const, label: '第四件事', start: 14, end: 14, quote: '做这件事。' },
  ];
  const doc = buildFlowFromAnalysis(source, parseAnalysisProposal(JSON.stringify({
    schema_version: 1,
    skill: 'unnamed-skill',
    source_sha: sha,
    nodes,
    edges: [
      { from: 'n-work', to: 'n-more', kind: 'sequence' },
      { from: 'n-more', to: 'n-third', kind: 'sequence' },
      { from: 'n-third', to: 'n-fourth', kind: 'sequence' },
    ],
  })));
  const layout = layoutNodes(doc);
  assert.equal(layout.nodes.length, doc.nodes.length, 'the layout dropped a folded card');
  assert.equal(layout.folded.length, 1);
  assert.deepEqual(layout.nodes.filter((node) => node.foldedHidden).map((node) => node.id).sort(), layout.folded[0].ids.slice().sort());
  assert.equal(layout.nodes.find((node) => node.id === layout.folded[0].anchorId)?.foldedHidden, false, 'the anchor is hidden');
});
test('the client script runs without throwing and paints nodes', async () => {
  const { svg, panel } = await runClient();
  assert.ok(svg.children.length > 0, 'nothing was appended to the canvas');
  assert.ok(panel.innerHTML.length > 0, 'the detail panel was never filled');
});

test('a node group is emitted for every graph node', async () => {
  const { svg, layout } = await runClient();
  const groups = svg.children.filter((child) => child.tagName === 'g');
  assert.ok(groups.length >= 20, `only ${groups.length} node groups painted`);
  const sized = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const group of groups) {
    const card = group.children.find((c) => c.tagName === 'rect' && c.attrs.class === 'card');
    assert.ok(card, 'node group has no card');
    // The card takes its size from the layout, not from a constant in the
    // painter: a hard-coded width here is how a card and its label drift apart.
    const placed = sized.get(group.attrs['data-id']);
    assert.ok(placed, `${group.attrs['data-id']} is not in the layout`);
    // A note's plate steps in from its box; every other card fills it.
    assert.equal(card.attrs.width, String(placed.w - (placed.inset ?? 0)));
    // `h` reserves the fork row as well, so the plate is `cardH` and the group
    // is taller only when an open arm hangs under it.
    assert.equal(card.attrs.height, String(placed.cardH));
    assert.equal(card.attrs.rx, '16');
    assert.equal(card.attrs.ry, '16');
    // Height grows with the number of label lines, so a fixed height would
    // clip the third line of a long label.
    assert.ok(Number(card.attrs.height) > 62, `card height ${card.attrs.height} cannot hold two label lines`);
  }
});

test('the detail panel opens on the first sourced action and shows its source lines', async () => {
  const { panel } = await runClient();
  assert.match(panel.innerHTML, /<h2>关键动作 1<\/h2>/);
  assert.match(panel.innerHTML, /原文/);
  assert.match(panel.innerHTML, /行哈希/);
});

test('the page exposes every key action before the graph scrolls', async () => {
  const text = await readFile(join(here, 'fixtures', 'grill-method.md'), 'utf8');
  const doc = buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' });
  const html = renderHtml(doc);
  const buttons = [...html.matchAll(/class="action-jump"/g)];
  assert.match(html, /class="action-overview-kicker">SKILL ACTION FLOW</);
  assert.match(html, /<h2[^>]*>这个 Skill 按什么顺序执行？<\/h2>/);
  assert.match(html, /class="action-jump-copy"><strong>/);
  assert.match(html, /class="action-jump-index"[^>]*>01</);
  assert.match(html, /class="action-overview-copy"/);
  assert.match(html, /class="action-overview-count">\d+ 个关键动作</);
  assert.match(html, /\.action-overview-head \{\s+display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(html, /\.action-chain::before \{/);
  // An embedded graph must scroll only its own canvas: scrollIntoView walks up to
  // the parent document and moves the workbench pane instead of the diagram.
  assert.doesNotMatch(html, /scrollIntoView/);
  assert.match(html, /pane\.scrollTop = Math\.max\(0, target\);/);
  assert.match(html, /--overview-inset: 48px/);
  assert.match(html, /\.action-overview-inner \{ margin: 0 var\(--overview-inset\); padding-bottom: var\(--space-6\); \}/);
  assert.match(html, /@media \(max-width: 1080px\) \{\s+:root \{ --overview-inset: 40px; \}/);
  assert.equal(buttons.length, doc.stats.byType.stage);
  assert.ok(buttons.length > 0, 'the action overview is empty on an actionable skill');
});

test('the graph opens at the reading scale and can zoom out to 20%', () => {
  const text = readFileSync(join(here, 'fixtures', 'grill-method.md'), 'utf8');
  const html = renderHtml(buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' }));
  // The workbench pane is ~1500px wide; a 900px graph at 100% leaves two thirds
  // of it as paper. 60% is the default, 20% is the floor, and "reset" means the
  // default rather than a magnification step the reader never asked for.
  assert.match(html, /const ZOOMS = \[0\.2, [^\]]*2\];/);
  assert.match(html, /const DEFAULT_ZOOM = 4; \/\/ 0\.6/);
  assert.match(html, /applyZoom\(DEFAULT_ZOOM\);\n  pane\.scrollTop = 0;/);
  assert.doesNotMatch(html, /let zoom = 3;/);
});

test('the detail panel numbers a sourced action as a key action', async () => {
  const { panel } = await runClient('# S\n\n读取输入\n');
  assert.match(panel.innerHTML, /<h2>关键动作 1<\/h2>/);
});
test('the standalone graph shows the Skill description verbatim', async () => {
  const source = await readFile(join(here, 'fixtures', 'skill-with-frontmatter.md'), 'utf8');
  const doc = buildFlow(parseSkill(source), source, { sourceFile: 'SKILL.md' });
  const html = renderHtml(doc);
  assert.match(html, /<p class="claim">A demo description used by the parser tests\.<\/p>/);
});
test('card copy keeps a consistent inset and source metadata gets a separate footer', async () => {
  const { svg, layout } = await runClient();
  const sized = new Map(layout.nodes.map((node) => [node.id, node]));
  const groups = svg.children.filter((child) => child.tagName === 'g');
  for (const group of groups) {
    const placed = sized.get(group.attrs['data-id']);
    assert.ok(placed);
    const footerRule = group.children.find((child) =>
      child.tagName === 'line' && child.attrs.y1 === String(placed.cardH - 32));
    assert.ok(footerRule, `${group.attrs['data-id']} has no separated footer strip`);
    const insetText = group.children.find((child) =>
      child.tagName === 'text' && child.attrs.x === '16');
    assert.ok(insetText, `${group.attrs['data-id']} has no text at the shared left inset`);
  }
});

test('zoom uses inline geometry after the first interaction', async () => {
  const source = await readFile(join(here, 'fixtures', 'grill-method.md'), 'utf8');
  const doc = buildFlow(parseSkill(source), source, { sourceFile: 'SKILL.md' });
  const html = renderHtml(doc, { embedded: true });
  assert.match(html, /svg\.style\.width = targetWidth/);
  assert.match(html, /svg\.style\.maxWidth = 'none'/);
  assert.match(html, /pane\.scrollTop = 0;\s+pane\.scrollLeft = 0;/s);
});
