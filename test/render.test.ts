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
async function runClient(): Promise<{ svg: StubElement; panel: StubElement }> {
  const text = await readFile(join(here, 'fixtures', 'grill-method.md'), 'utf8');
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

  const document = {
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElementNS: (_ns: string, tag: string) => (tag === 'svg' ? svg : makeElement(tag)),
    createElement: (tag: string) => makeElement(tag),
    querySelectorAll: () => [],
  };
  const context = vm.createContext({ document, console, JSON, Math, String, Number, Object, Array, Set, Map });
  new vm.Script(client[1], { filename: 'annot-client.js' }).runInContext(context);
  return { svg, panel };
}

test('the client script runs without throwing and paints nodes', async () => {
  const { svg, panel } = await runClient();
  assert.ok(svg.children.length > 0, 'nothing was appended to the canvas');
  assert.ok(panel.innerHTML.length > 0, 'the detail panel was never filled');
});

test('a node group is emitted for every graph node', async () => {
  const { svg } = await runClient();
  const groups = svg.children.filter((child) => child.tagName === 'g');
  assert.ok(groups.length >= 20, `only ${groups.length} node groups painted`);
  for (const group of groups) {
    const rect = group.children.find((c) => c.tagName === 'rect');
    assert.ok(rect, 'node group has no card');
    assert.equal(rect.attrs.width, '244');
  }
});

test('the unfinished-work panel names the nodes a human must confirm', async () => {
  const { panel } = await runClient();
  assert.match(panel.innerHTML, /<h2>节点<\/h2>/);
  assert.match(panel.innerHTML, /锚点/);
});
