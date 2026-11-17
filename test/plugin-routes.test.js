/**
 * The shell's contract is "the panel and the CLI cannot disagree". That claim is
 * only worth anything if the route really drives the CLI, so this test mounts
 * the plugin with the repository's own `src/cli.ts` and calls the routes for
 * real — no stub, no fake process.
 *
 * The fixture is a throwaway skill tree so the run never reads the user's real
 * library.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROUTES, apply } from '../plugin/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, '..', 'src', 'cli.ts');

function mount(config) {
  const routes = [];
  const ctx = {
    logger: { warn() {} },
    effect(factory) {
      factory();
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
  };
  apply(ctx, config);
  return routes;
}

function fakeReq(url, options = {}) {
  return {
    url,
    method: 'GET',
    headers: { host: '127.0.0.1:51251', 'sec-fetch-site': 'same-origin', ...(options.headers ?? {}) },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

async function call(route, url) {
  const res = {
    status: 0,
    body: undefined,
    writeHead(status) {
      res.status = status;
      return res;
    },
    end(text) {
      res.body = text === undefined ? undefined : JSON.parse(text);
    },
  };
  await route.handler(fakeReq(url), res);
  return res;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'annot-plugin-'));
  const skill = join(root, 'home', '.agents', 'skills', 'demo');
  await mkdir(skill, { recursive: true });
  await writeFile(
    join(skill, 'SKILL.md'),
    [
      '---',
      'name: demo',
      'description: A fixture skill with one fork.',
      '---',
      '',
      '# Demo',
      '',
      '## 步骤',
      '',
      '1. 先看输入',
      '2. 如果命中，则走 A；否则走 B',
      '3. 产出结论',
      '',
    ].join('\n'),
    'utf8',
  );
  return { root, skill };
}

test('the routes drive the real CLI and return its document', async () => {
  const { root } = await fixture();
  try {
    const routes = mount({ cli: CLI, home: join(root, 'home'), cwd: root });
    const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));

    const status = await call(byPath[ROUTES.status], ROUTES.status);
    assert.equal(status.body.installed, true, `status said the CLI is missing: ${JSON.stringify(status.body)}`);

    const list = await call(byPath[ROUTES.list], ROUTES.list);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.ok(Array.isArray(list.body.skills), 'list must return skills');
    const demo = list.body.skills.find((s) => s.name === 'demo');
    assert.ok(demo, `demo not discovered: ${JSON.stringify(list.body.skills)}`);

    const flow = await call(byPath[ROUTES.flow], `${ROUTES.flow}?path=${encodeURIComponent(demo.file)}`);
    assert.equal(flow.status, 200, JSON.stringify(flow.body));
    assert.equal(flow.body.doc.skill, 'demo');
    // A tight ordered list is one unit by design (consecutive lines with no
    // blank separator belong together); the fork inside it is what matters.
    assert.ok(flow.body.doc.nodes.length >= 1, 'the fixture should yield at least one node');
    assert.ok(
      flow.body.doc.nodes.some((n) => n.branches.length > 0),
      `the fixture's fork was not extracted: ${JSON.stringify(flow.body.doc.nodes.map((n) => n.label))}`,
    );
    assert.ok(flow.body.layout && flow.body.layout.nodes.length === flow.body.doc.nodes.length, 'layout must cover every node');
    for (const node of flow.body.layout.nodes) {
      assert.equal(typeof node.x, 'number');
      assert.equal(typeof node.y, 'number');
    }

    // Search through the route, because the panel's only discovery path is this
    // call: a route that works but ranks nothing is the same as no search.
    const hit = await call(byPath[ROUTES.search], `${ROUTES.search}?q=demo`);
    assert.equal(hit.status, 200, JSON.stringify(hit.body));
    assert.deepEqual(hit.body.matches.map((m) => m.name), ['demo']);
    assert.equal(hit.body.body, false, 'the default tier must not read the body');

    const deep = await call(byPath[ROUTES.search], `${ROUTES.search}?q=命中&body=1`);
    assert.equal(deep.status, 200, JSON.stringify(deep.body));
    assert.equal(deep.body.body, true);
    assert.deepEqual(deep.body.matches.map((m) => m.name), ['demo'], 'a body-only match must be findable in deep mode');

    const miss = await call(byPath[ROUTES.search], `${ROUTES.search}?q=zzz-nothing`);
    assert.equal(miss.status, 200);
    assert.deepEqual(miss.body.matches, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the flow route refuses a path that no scan produced', async () => {
  const { root } = await fixture();
  try {
    const routes = mount({ cli: CLI, home: join(root, 'home'), cwd: root });
    const route = routes.find((r) => r.path === ROUTES.flow);

    const outside = await call(route, `${ROUTES.flow}?path=${encodeURIComponent('/etc/passwd')}`);
    assert.equal(outside.status, 422, `an unscanned path must not be read: ${JSON.stringify(outside.body)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit over the fixture returns a ranked table', async () => {
  const { root } = await fixture();
  try {
    const routes = mount({ cli: CLI, home: join(root, 'home'), cwd: root });
    const route = routes.find((r) => r.path === ROUTES.audit);
    const res = await call(route, `${ROUTES.audit}?limit=5`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.total >= 1, true);
    for (let i = 1; i < res.body.audits.length; i++) {
      assert.ok(res.body.audits[i - 1].score >= res.body.audits[i].score, 'audit must be worst-first');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
