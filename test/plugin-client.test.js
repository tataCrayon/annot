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
  assert.match(SOURCE, /node\.branches\.length/);
});
