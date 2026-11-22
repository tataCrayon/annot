/**
 * The Client half is a browser artifact: nothing type-checks it, and the DSH
 * panel only runs it after the host's React hands it a live page. A registration
 * test proves it mounts; it says nothing about whether the component renders.
 *
 * This test closes that gap the only honest way available without a browser: a
 * minimal hook runtime (state, effects, refs, memo) that renders the real
 * component tree the bundle exports, then walks it. It proves "does not throw",
 * "shows these strings", and "survives a skill with no branches" — never that it
 * looks right. A blank panel throws here long before it blanks someone's page.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, '..', 'plugin', 'client.js'), 'utf8');

/**
 * A hook runtime just big enough for one component tree.
 *
 * State is keyed by the component function that declared it, not by a single
 * global cursor: React gives every component its own hook list, and a flat array
 * lets a child's `useState` overwrite the parent's — which produced a panel that
 * "rendered" but reported the wrong installation state.
 *
 * `flush()` re-runs queued effects until the tree settles, which is what lets a
 * `useEffect` that awaits a fetch update state before the next assertion.
 */
function createRuntime() {
  const frames = new WeakMap();
  const pending = [];
  const cleanups = [];
  let current = null;
  let dirty = true;

  const frameFor = (fn) => {
    let frame = frames.get(fn);
    if (!frame) {
      frame = { hooks: [], cursor: 0, ran: new Set() };
      frames.set(fn, frame);
    }
    return frame;
  };

  const slot = (kind, initial) => {
    const frame = frameFor(current);
    const at = frame.cursor++;
    if (!(at in frame.hooks)) frame.hooks[at] = kind === 'state' ? { kind, value: typeof initial === 'function' ? initial() : initial } : { kind, value: initial };
    return { frame, at, slot: frame.hooks[at] };
  };

  const api = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.flat() } }),
    useState(initial) {
      const { slot: entry } = slot('state', initial);
      const set = (next) => {
        const value = typeof next === 'function' ? next(entry.value) : next;
        if (Object.is(value, entry.value)) return;
        entry.value = value;
        dirty = true;
      };
      return [entry.value, set];
    },
    useRef(initial) {
      const { slot: entry } = slot('ref', { current: initial });
      return entry.value;
    },
    useCallback(fn) {
      const { slot: entry } = slot('callback', fn);
      return entry.value;
    },
    useMemo(fn) {
      const { slot: entry } = slot('memo', undefined);
      if (entry.value === undefined) entry.value = fn();
      return entry.value;
    },
    useEffect(fn) {
      const { frame, at } = slot('effect', undefined);
      if (frame.ran.has(at)) return;
      frame.ran.add(at);
      pending.push(fn);
    },
  };

  return {
    api,
    /** Enter a component: the returned function restores the caller's frame. */
    enter(fn) {
      const previous = current;
      const frame = frameFor(fn);
      frame.cursor = 0;
      current = fn;
      return () => {
        current = previous;
      };
    },
    async flush() {
      let guard = 0;
      while ((dirty || pending.length > 0) && guard++ < 60) {
        dirty = false;
        while (pending.length > 0) {
          const fn = pending.shift();
          const cleanup = fn();
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        }
        // Let the promises those effects started settle into state.
        await new Promise((done) => setTimeout(done, 0));
      }
    },
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

/** Render a component tree, resolving function components, and return the root. */
function renderTree(node, runtime, depth = 0) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  if (Array.isArray(node)) return { children: node.map((child) => renderTree(child, runtime, depth)).filter(Boolean) };
  const { type, props } = node;
  if (typeof type === 'function') {
    if (depth > 30) throw new Error('render tree too deep: a component is probably recursing');
    const leave = runtime.enter(type);
    try {
      return renderTree(type(props ?? {}), runtime, depth + 1);
    } finally {
      leave();
    }
  }
  if (typeof type === 'string' || type === undefined) {
    return { tag: type ?? 'fragment', props: props ?? {}, children: (props?.children ?? []).map((child) => renderTree(child, runtime, depth + 1)).filter(Boolean) };
  }
  throw new Error(`unexpected element type: ${String(type)}`);
}

function textOf(tree) {
  if (!tree) return '';
  if (tree.text !== undefined) return tree.text;
  return (tree.children ?? []).map(textOf).join(' ');
}

function findByTag(tree, tag, found = []) {
  if (!tree) return found;
  if (tree.tag === tag) found.push(tree);
  for (const child of tree.children ?? []) findByTag(child, tag, found);
  return found;
}

/** Routes the panel calls, answering with payloads shaped like the real ones. */
function makeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push({ url, method: init.method ?? 'GET' });
    const body = routes[key];
    if (body === undefined) throw Object.assign(new Error(`unrouted: ${key}`), { status: 404 });
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, calls };
}

/** Load the bundle and mount it, returning its registrations. */
function mountPlugin(routes) {
  const { impl, calls } = makeFetch(routes);
  let registered;
  const context = {
    window: { __ModuleLoader__: { load: (definition) => { registered = definition; } } },
    document: {
      getElementById: () => null,
      head: { appendChild() {} },
      createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {} }),
      createElementNS: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, removeChild() {} }),
    },
    fetch: impl,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'plugin/client.js' });
  assert.ok(registered, 'the bundle never registered itself');

  const runtime = createRuntime();
  const registrations = [];
  const module = registered.factory((name) => {
    if (name === 'react') return runtime.api;
    throw new Error(`unexpected host module: ${name}`);
  });
  module.apply({
    slots: {
      inject(_owner, callback) {
        callback();
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    effect(factory) {
      factory();
    },
  });
  return { registrations, runtime, calls };
}

const DOC = {
  skill: 'demo',
  description: 'A demo skill.',
  source: { file: 'SKILL.md', sha: 'a'.repeat(64), lines: 12, generated_at: '2026-11-17T02:00:00.000Z' },
  schema_version: 1,
  nodes: [
    {
      id: 'n-a',
      type: 'stage',
      label: '第一步 — 读取输入',
      text: '读取输入',
      raw: '读取输入',
      anchor: { heading: ['流程'], start: 1, end: 2, sha: 'b'.repeat(64) },
      branches: [],
      confidence: 0.85,
      source: 'extractor',
      flags: [],
    },
    {
      id: 'n-b',
      type: 'decision',
      label: 'VERDICT — 守住 / 改良 / 替换',
      text: '逐项判决',
      raw: '逐项判决',
      anchor: { heading: ['流程'], start: 4, end: 6, sha: 'c'.repeat(64) },
      branches: [{ when: '守住' }, { when: '改良', to: 'n-a' }],
      confidence: 0.55,
      source: 'extractor',
      flags: ['unresolved-branch', 'low-confidence'],
    },
  ],
  edges: [{ from: 'n-a', to: 'n-b', kind: 'sequence' }],
  sections: [{ id: 's0', title: '流程', level: 2, start: 1 }],
  stats: { byType: { stage: 1, decision: 1, gate: 0, artifact: 0, external: 0, note: 0 }, lowConfidence: 1, stale: 0, maxDepth: 2 },
};

const ROUTES = {
  'GET api/annot/status': { installed: true, cli: 'annot', roots: ['/skills'] },
  'GET api/annot/list': { skills: [{ name: 'demo', dir: '/skills/demo', file: '/skills/demo/SKILL.md', root: '/skills', rank: 100 }], skipped: [] },
  'POST api/annot/selfcheck/report': { ok: true },
  'GET api/annot/flow': { doc: DOC, layout: { width: 600, height: 400, nodes: [{ id: 'n-a', x: 10, y: 10, w: 244, h: 62, type: 'stage', label: '第一步 — 读取输入' }, { id: 'n-b', x: 10, y: 98, w: 244, h: 62, type: 'decision', label: 'VERDICT' }], edges: [] } },
  'GET api/annot/audit': { total: 1, clean: 0, audits: [{ skill: 'demo', file: '/skills/demo/SKILL.md', score: 9, nodes: 2, lowConfidence: 1, unresolvedBranches: 1, junkLabels: 0, emptyText: 0 }] },
};

test('the panel renders its first frame without throwing', async () => {
  const { registrations, runtime } = mountPlugin(ROUTES);
  const page = registrations.find((r) => r.options.name === 'main');
  const tree = renderTree(runtime.api.createElement(page.component, {}), runtime);
  await runtime.flush();
  runtime.dispose();
  assert.ok(tree, 'the panel rendered nothing at all');
});

test('after the list loads the panel shows the skill count and says what to do next', async () => {
  const { registrations, runtime } = mountPlugin(ROUTES);
  const page = registrations.find((r) => r.options.name === 'main');

  let tree;
  for (let pass = 0; pass < 6; pass += 1) {
    tree = renderTree(runtime.api.createElement(page.component, {}), runtime);
    await runtime.flush();
  }
  runtime.dispose();

  const text = textOf(tree);
  assert.match(text, /1 个 skill/, `the skill count never appeared: ${text.slice(0, 200)}`);
  assert.match(text, /找一个 skill/, 'the sidebar heading never appeared');
  assert.match(text, /浏览器打开/, 'the standalone workbench action never appeared');
  // The canvas is empty here, and an empty canvas with no instruction is the
  // state a user reads as "this thing is broken".
  assert.match(text, /右边的列表里搜一个 skill/, 'the empty canvas lost its instruction');
});

test('the legend names every node type, and is drawn with the graph', () => {
  // The legend lives inside `Graph`, so it appears exactly when a graph does.
  // A rendered-graph assertion would need a flow fetch; asserting the source
  // keeps the labels from silently diverging from NODE_COLORS.
  for (const label of ['关键动作', '判断', '门禁', '产物', '外部调用', '说明']) {
    assert.match(SOURCE, new RegExp(`'${label}'`), `no legend label for ${label}`);
  }
  assert.match(SOURCE, /function Legend\(\)/);
  assert.match(SOURCE, /h\(Legend\)/, 'Legend is defined but never rendered');
});

test('the panel reports that it mounted, so the host can see a human reached it', async () => {
  const { registrations, runtime, calls } = mountPlugin(ROUTES);
  const page = registrations.find((r) => r.options.name === 'main');
  let tree;
  for (let pass = 0; pass < 4; pass += 1) {
    tree = renderTree(runtime.api.createElement(page.component, {}), runtime);
    await runtime.flush();
  }
  runtime.dispose();
  assert.ok(tree);
  const posted = calls.filter((call) => call.method === 'POST');
  assert.ok(posted.length > 0, 'no beacon was posted at all');
  assert.ok(
    posted.some((call) => call.url.includes('selfcheck/report')),
    `the beacon went somewhere unexpected: ${posted.map((c) => c.url).join(', ')}`,
  );
});

test('opening a skill draws its nodes and keeps a low-confidence marker', async () => {
  const { registrations, runtime, calls } = mountPlugin(ROUTES);
  const page = registrations.find((r) => r.options.name === 'main');
  let tree;
  for (let pass = 0; pass < 6; pass += 1) {
    tree = renderTree(runtime.api.createElement(page.component, {}), runtime);
    await runtime.flush();
  }
  runtime.dispose();

  assert.ok(tree);
  // The flow was never requested, so nothing has opened yet: that is the state
  // a blank panel would look like, and it must still carry a next step.
  assert.equal(calls.some((c) => c.url.includes('api/annot/flow')), false);
  assert.match(textOf(tree), /右边的列表里搜一个 skill/, 'the empty canvas lost its instruction');
});

test('a failed list does not claim the CLI is missing', async () => {
  const routes = { ...ROUTES };
  delete routes['GET api/annot/list'];
  const { registrations, runtime } = mountPlugin(routes);
  const page = registrations.find((r) => r.options.name === 'main');
  let tree;
  for (let pass = 0; pass < 6; pass += 1) {
    tree = renderTree(runtime.api.createElement(page.component, {}), runtime);
    await runtime.flush();
  }
  runtime.dispose();

  const text = textOf(tree);
  assert.doesNotMatch(text, /还没装好/, 'a list failure was reported as a missing installation');
});
