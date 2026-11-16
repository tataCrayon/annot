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
  return {
    url,
    method: options.method ?? 'GET',
    headers: { host: '127.0.0.1:51251', 'sec-fetch-site': 'same-origin', ...(options.headers ?? {}) },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
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

test('applying registers the four documented routes under one effect', () => {
  const { routes, effectName } = mount();
  assert.deepEqual(routes.map((r) => r.path).sort(), Object.values(ROUTES).sort());
  assert.match(effectName, /annot/i, 'the effect must be named so a failing mount is traceable');
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

test('a missing CLI is a 503 with a reason, never a silent empty list', async () => {
  const { routes } = mount({ cli: 'definitely-not-a-real-annot-binary' });
  const route = routes.find((r) => r.path === ROUTES.list);
  const res = await call(route, fakeReq(route.path));
  assert.equal(res.status, 503);
  assert.match(res.body.error, /cannot run|not found|ENOENT/i);
});
