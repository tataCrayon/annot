/**
 * A blank page is the silent failure mode of a single-file report: the markup
 * is complete, the script throws on line 3, and the user sees an empty canvas
 * with no error. Compiling the script is not enough, so this test runs it
 * against a minimal DOM and fails on any exception.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import { renderHtml } from '../src/render.ts';
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
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElementNS: (_ns: string, tag: string) => (tag === 'svg' ? svg : makeElement(tag)),
    createElement: (tag: string) => makeElement(tag),
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
    assert.equal(card.attrs.width, String(placed.w));
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
  assert.match(html, /pane\.scrollIntoView\(\{ block: 'start'/);
  assert.match(html, /--overview-inset: 48px/);
  assert.match(html, /\.action-overview-inner \{ margin: 0 var\(--overview-inset\); padding-bottom: var\(--space-6\); \}/);
  assert.match(html, /@media \(max-width: 1080px\) \{\s+:root \{ --overview-inset: 40px; \}/);
  assert.equal(buttons.length, doc.stats.byType.stage);
  assert.ok(buttons.length > 0, 'the action overview is empty on an actionable skill');
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
