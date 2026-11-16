/**
 * The manifest is the one file no test ever imported, and it had already drifted:
 * five real modules (`context`, `fsx`, `manifest`, `browser`, `visual`) were
 * missing from `exports`, so `import 'annot/visual'` failed for anyone outside
 * this repo while every in-repo import worked. These assertions are cheap and
 * they catch exactly that class of mistake.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const cli = readFileSync(resolve(root, 'src', 'cli.ts'), 'utf8');

test('every declared export points at a file that exists', () => {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    assert.equal(typeof target, 'string', `${subpath} must be a plain path while the package ships raw .ts`);
    assert.ok(target.startsWith('./'), `${subpath} must be relative`);
    assert.doesNotThrow(
      () => readFileSync(resolve(root, target.slice(2)), 'utf8'),
      `${subpath} -> ${target} does not exist`,
    );
  }
});

test('the modules a reader would import are all exported', () => {
  // Named explicitly: a missing key here is the bug, so the list may not be
  // derived from `exports` itself.
  const required = ['./parse', './flow', './drift', './audit', './context', './manifest', './render', './visual', './browser'];
  for (const subpath of required) {
    assert.ok(pkg.exports[subpath], `exports is missing ${subpath}`);
  }
});

test('the bin exists and is executable as a script', () => {
  assert.ok(pkg.bin?.annot, 'no annot bin declared');
  const target = resolve(root, pkg.bin.annot);
  const text = readFileSync(target, 'utf8');
  assert.match(text, /^#!\/usr\/bin\/env node/, 'the bin needs a shebang or it cannot be executed as annot');
});

test('the version printed by the CLI is the version in the manifest', () => {
  const match = /write\(['"`]annot (\d+\.\d+\.\d+)/.exec(cli);
  assert.ok(match, 'could not find the version string in src/cli.ts');
  assert.equal(match[1], pkg.version, `cli.ts says ${match[1]}, package.json says ${pkg.version}`);
});

test('the package ships every directory its entry points live in', () => {
  // `files` filters a published tarball; a module outside it is exported but
  // absent after `npm pack`.
  const covered = (path) => pkg.files.some((entry) => path === entry || path.startsWith(`${entry}/`));
  for (const target of Object.values(pkg.exports)) {
    assert.ok(covered(target.slice(2)), `${target} is exported but not covered by files: ${JSON.stringify(pkg.files)}`);
  }
});

test('the sandbox and probe directories are never publishable', () => {
  for (const entry of pkg.files) {
    assert.ok(!/^(sandbox|\.sandbox|\.probe|out|tmp|data)\b/.test(entry), `files must not include ${entry}`);
  }
});
