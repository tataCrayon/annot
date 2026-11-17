/**
 * The Client half cannot be type-checked or imported: it is a browser artifact
 * that only runs after `window.__ModuleLoader__` hands it the host's React. So
 * the test shims exactly that surface and runs the factory, which is the same
 * code path the page takes.
 *
 * What this proves: the module registers under the package name, declares the
 * `slots` service, exports a well-formed `apply`, and registers both seats.
 * What it does not prove: that the page renders, because that needs the host
 * and a live session — the panel itself is verified by opening it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, '..', 'plugin', 'client.js'), 'utf8');

/** Minimal React: the factory only calls createElement while rendering. */
const React = {
  createElement: (...args) => ({ type: args[0], props: args[1] }),
  useState: (value) => [value, () => {}],
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useEffect: () => undefined,
};

function loadModule() {
  let registered;
  const context = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          registered = definition;
        },
      },
    },
    document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'plugin/client.js' });
  assert.ok(registered, 'the module never called window.__ModuleLoader__.load');
  return registered;
}

function mount() {
  const definition = loadModule();
  const module = definition.factory((name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected host module: ${name}`);
  });
  const registrations = [];
  let effectName;
  const ctx = {
    slots: {
      inject(owner, callback) {
        callback();
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    effect(factory, name) {
      effectName = name;
      factory();
    },
  };
  module.apply(ctx);
  return { definition, module, registrations, effectName };
}

test('the module registers under the package name the patch mounts', () => {
  const { definition } = mount();
  assert.equal(definition.id, 'annot-dsh', 'the factory id must equal the package name or the host cannot resolve it');
});

test('the module declares the slots service it uses', () => {
  const { module } = mount();
  // The array is created inside the vm realm, so compare its contents rather
  // than its (different) Array prototype.
  assert.equal(JSON.stringify(Array.from(module.inject)), '["slots"]');
});

test('apply registers a sidebar row and a main page, and names its effect', () => {
  const { registrations, effectName } = mount();
  assert.equal(registrations.length, 2);

  const row = registrations.find((r) => r.options.name === 'sidebar.panellist');
  const page = registrations.find((r) => r.options.name === 'main');
  assert.ok(row, 'no sidebar row registered');
  assert.ok(page, 'no main page registered');
  assert.equal(row.options.id, page.options.key, 'row id and page key must match or clicking the row opens nothing');
  assert.equal(typeof row.options.label, 'function', 'the row label is a function so it can be translated');
  assert.equal(row.options.label(), 'Annot');

  for (const registration of registrations) {
    assert.equal(typeof registration.component, 'function', `${registration.options.name} has no component`);
  }
  assert.match(effectName, /annot/i);
});

test('every host route is documented-relative, never root-absolute', () => {
  // The GUI is served with <base href="./">, so a leading slash escapes a
  // sub-path deployment and the request never reaches the plugin's route.
  const routes = [...SOURCE.matchAll(/^\s{6}(\w+): '(api\/annot\/[^']+)',$/gm)].map((m) => m[2]);
  assert.ok(routes.length >= 4, `expected four route constants, found ${routes.length}`);
  for (const route of routes) {
    assert.ok(!route.startsWith('/'), `${route} is root-absolute`);
    assert.match(route, /^api\/annot\//);
  }
});

test('the panel never assumes a node has branches or headings', () => {
  // Defensive shape: a doc from an older schema may lack either array, and the
  // detail pane must not throw on it. The accesses are guarded by `|| []`.
  assert.match(SOURCE, /node\.anchor\.heading \|\| \[\]/);
  assert.match(SOURCE, /Array\.isArray\(node\.branches\)/);
});

test('no CSS shorthand uses `inherit` as a font family', () => {
  // `font: 13px/1.5 inherit` is invalid: CSS-wide keywords may not appear as a
  // family inside the shorthand, so the parser drops the WHOLE declaration and
  // the panel silently inherits the wrong metrics. Only standalone
  // `font-family: inherit` or explicit sizes are allowed.
  const shorthands = [...SOURCE.matchAll(/font:\s*([^;'"`]+)/g)].map((m) => m[1].trim());
  for (const value of shorthands) {
    assert.doesNotMatch(value, /\binherit\b/, `invalid font shorthand: font: ${value}`);
  }
});

test('every theme variable the panel references is a --dsw-alias token', () => {
  // A literal color in host chrome breaks dark theme; a non-token variable does
  // not exist at all. The node palette is artwork and uses literals on purpose,
  // so this only checks what is written as a `var(...)`.
  const vars = [...SOURCE.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
  assert.ok(vars.length >= 5, 'the panel should be using theme tokens');
  for (const name of vars) {
    assert.match(name, /^--dsw-alias-/, `${name} is not a host theme token`);
  }
});

test('the panel draws a low-confidence marker, not only the branch badge', () => {
  // DETAIL.md promises an amber dot below 60%; the HTML artifact draws one. A
  // panel that only shows unbound branches silently hides half the signal.
  assert.match(SOURCE, /node\.confidence\s*<\s*0\.6/);
  assert.match(SOURCE, /['"]data-role['"]:\s*['"]low-confidence['"]/);
});

test('apply reports a registration failure instead of disappearing', () => {
  // A panel that never appears is indistinguishable from a bundle that is not
  // installed. The console line is the only diagnosable evidence.
  assert.match(SOURCE, /catch\s*\(error\)\s*\{[\s\S]{0,200}console\.warn\([^)]*annot/i);
});

test('the sidebar row does not collide with order 40', () => {
  // Another installed bundle already uses 40; equal order sorts unpredictably.
  const order = /order:\s*(\d+)/.exec(SOURCE);
  assert.ok(order, 'the row declares no order');
  assert.notEqual(Number(order[1]), 40);
});

test('a superseded response can never overwrite a newer one', () => {
  // The specific bug: clear the search box, and a slow in-flight search
  // repopulates results — breaking the "empty box means everything" promise.
  assert.match(SOURCE, /tickets/, 'no request ticket state');
  assert.match(SOURCE, /stale\('search',\s*ticket\)/, 'search does not check its ticket before applying');
  assert.match(SOURCE, /stale\('flow',\s*ticket\)/, 'flow does not check its ticket before applying');
});

test('the panel shows where a graph came from', () => {
  // Without the source hash, "is this graph current?" is unanswerable in the UI.
  assert.match(SOURCE, /doc\.source\.sha\.slice\(0,\s*10\)/);
  assert.match(SOURCE, /doc\.source\.generated_at/);
});

test('search results carry the skill description', () => {
  // 76 skills whose only visible difference is the folder name is not a list a
  // human can choose from.
  assert.match(SOURCE, /m\.description/);
});
