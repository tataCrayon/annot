/**
 * The DSH shell is JavaScript with no build step, so nothing type-checks it: a
 * typo in a route handler surfaces only when a user opens the panel. These
 * tests mount the real `apply()` against a fake context and call the real
 * handlers with fake request/response objects, so the shell is exercised the
 * same way the host will exercise it.
 *
 * Two properties matter most and are asserted directly:
 *   - every route refuses non-loopback callers, because they read a user's
 *     files through a CLI;
 *   - `?path=` only accepts a file a fresh scan produced, so the route cannot
 *     be turned into an arbitrary file-read primitive.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROUTES, apply } from '../plugin/index.js';

/** Mount the plugin and return its routes, without a real Cordis runtime. */
function mount(config = {}) {
  const routes = [];
  const disposers = [];
  let effectName;
  const ctx = {
    logger: { warn() {} },
    effect(factory, name) {
      effectName = name;
      const dispose = factory();
      if (typeof dispose === 'function') disposers.push(dispose);
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
  };
  apply(ctx, config);
  return { routes, effectName, disposers };
}

function fakeReq(url, options = {}) {
  // The report route reads the request body as a stream, so the fake carries
  // `on('data'|'end')` rather than a string property.
  const body = options.body ?? '';
  return {
    url,
    method: options.method ?? 'GET',
    headers: { host: '127.0.0.1:51251', 'sec-fetch-site': 'same-origin', ...(options.headers ?? {}) },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    on(event, listener) {
      if (event === 'data' && body !== '') listener(Buffer.from(body, 'utf8'));
      if (event === 'end') listener();
      return this;
    },
    destroy() {},
  };
}

function fakeRes() {
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
  return res;
}

async function call(route, req) {
  const res = fakeRes();
  await route.handler(req, res);
  return res;
}

test('applying registers every documented route under one effect', () => {
  const { routes, effectName } = mount();
  assert.deepEqual(routes.map((r) => r.path).sort(), Object.values(ROUTES).sort());
  assert.equal(routes.length, 8, 'status, selfcheck, report, list, search, flow, context, audit');
  assert.match(effectName, /annot/i, 'the effect must be named so a failing mount is traceable');
});

test('the selfcheck route reports the client declaration and what the page said', async () => {
  const { routes } = mount();
  const route = routes.find((r) => r.path === ROUTES.selfcheck);
  const res = await call(route, fakeReq(route.path));
  assert.equal(res.status, 200);
  // The bundle exists and is non-empty, or the panel cannot possibly appear.
  assert.equal(res.body.package, 'annot-dsh');
  assert.equal(res.body.client.platform, 'web');
  assert.equal(res.body.client.exists, true, `client entry missing: ${res.body.client.entry}`);
  assert.ok(res.body.client.bytes > 0);
  assert.deepEqual(res.body.reports, []);
});

test('the report route accepts a loopback POST and files it', async () => {
  const { routes } = mount();
  const report = routes.find((r) => r.path === ROUTES.report);
  const check = routes.find((r) => r.path === ROUTES.selfcheck);

  const posted = await call(report, fakeReq(ROUTES.report, { method: 'POST', body: '{"event":"apply-enter"}' }));
  assert.equal(posted.status, 200);

  const res = await call(check, fakeReq(ROUTES.selfcheck));
  assert.equal(res.body.reports.length, 1);
  assert.equal(res.body.reports[0].event, 'apply-enter');
  assert.equal(typeof res.body.reports[0].receivedAt, 'string');
});

test('the report route refuses a wrong method, a foreign caller, and a non-JSON body', async () => {
  const { routes } = mount();
  const report = routes.find((r) => r.path === ROUTES.report);

  // Loopback first, then method: the order the other routes use, so a wrong
  // method never becomes a way to learn whether a caller is trusted.
  const get = await call(report, fakeReq(ROUTES.report, { method: 'GET' }));
  assert.equal(get.status, 405);

  const lan = await call(report, fakeReq(ROUTES.report, { method: 'POST', remoteAddress: '10.0.0.7' }));
  assert.equal(lan.status, 403, 'a LAN caller must not be able to forge an observation');

  const crossSite = await call(report, fakeReq(ROUTES.report, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(crossSite.status, 403, 'another site must not be able to forge an observation');

  const bad = await call(report, fakeReq(ROUTES.report, { method: 'POST', body: 'not json' }));
  assert.equal(bad.status, 400);

  const empty = await call(report, fakeReq(ROUTES.report, { method: 'POST', body: '' }));
  assert.equal(empty.status, 400);
});

test('every route refuses a non-loopback caller', async () => {
  const { routes } = mount();
  for (const route of routes) {
    const res = await call(route, fakeReq(route.path, { remoteAddress: '10.0.0.7' }));
    assert.equal(res.status, 403, `${route.path} served a LAN caller`);
  }
});

test('a forwarded request is refused even from a loopback socket', async () => {
  const { routes } = mount();
  const res = await call(routes[0], fakeReq(routes[0].path, { headers: { 'x-forwarded-for': '10.0.0.7' } }));
  assert.equal(res.status, 403, 'X-Forwarded-For must never count as evidence for loopback');
});

test('a cross-site fetch is refused', async () => {
  const { routes } = mount();
  const res = await call(routes[0], fakeReq(routes[0].path, { headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(res.status, 403);
});

test('a foreign Origin is refused, a same-origin one is not', async () => {
  const { routes } = mount();
  const route = routes.find((r) => r.path === ROUTES.status);

  const foreign = await call(route, fakeReq(route.path, { headers: { origin: 'http://evil.example' } }));
  assert.equal(foreign.status, 403);

  const same = await call(route, fakeReq(route.path, { headers: { origin: 'http://127.0.0.1:51251' } }));
  assert.equal(same.status, 200);
});

test('a non-GET method is rejected with 405', async () => {
  const { routes } = mount();
  const res = await call(routes[0], fakeReq(routes[0].path, { method: 'POST' }));
  assert.equal(res.status, 405);
});

test('status reports the roots it will scan and whether the CLI exists', async () => {
  const { routes } = mount({ cli: 'definitely-not-a-real-annot-binary' });
  const route = routes.find((r) => r.path === ROUTES.status);
  const res = await call(route, fakeReq(route.path));
  assert.equal(res.status, 200);
  assert.equal(res.body.installed, false, 'a missing CLI must be visible, not thrown');
  assert.equal(res.body.cli, 'definitely-not-a-real-annot-binary');
  assert.equal(Array.isArray(res.body.roots), true);
  assert.equal(res.body.roots.length > 0, true);
});

test('flow requires a path and does not accept an empty one', async () => {
  const { routes } = mount();
  const route = routes.find((r) => r.path === ROUTES.flow);

  const missing = await call(route, fakeReq(route.path));
  assert.equal(missing.status, 400);

  const blank = await call(route, fakeReq(`${route.path}?path=%20`));
  assert.equal(blank.status, 400);
});

test('search requires a query and never treats an empty one as "everything"', async () => {
  const { routes } = mount({ cli: 'definitely-not-a-real-annot-binary' });
  const route = routes.find((r) => r.path === ROUTES.search);

  const missing = await call(route, fakeReq(route.path));
  assert.equal(missing.status, 400);

  const blank = await call(route, fakeReq(`${route.path}?q=%20%20`));
  assert.equal(blank.status, 400);
});

test('a missing CLI is a 503 with a reason, never a silent empty list', async () => {
  const { routes } = mount({ cli: 'definitely-not-a-real-annot-binary' });
  const route = routes.find((r) => r.path === ROUTES.list);
  const res = await call(route, fakeReq(route.path));
  assert.equal(res.status, 503);
  assert.match(res.body.error, /cannot run|not found|ENOENT/i);
});

test('context requires both a skill and a node, and refuses a skill no scan produced', async () => {
  const { routes } = mount();
  const route = routes.find((r) => r.path === ROUTES.context);

  const noSkill = await call(route, fakeReq(route.path));
  assert.equal(noSkill.status, 400);

  const noNode = await call(route, fakeReq(`${route.path}?path=${encodeURIComponent('/nowhere/SKILL.md')}`));
  assert.equal(noNode.status, 400, 'a node id is required; there is nothing to slice without one');
  assert.match(noNode.body.error, /node/);

  // The path guard runs before any CLI call, so a path outside the scan cannot
  // be used to make the panel read arbitrary markdown.
  const unknown = await call(route, fakeReq(`${route.path}?path=${encodeURIComponent('/nowhere/SKILL.md')}&node=n-a`));
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.retryable, true);
});
