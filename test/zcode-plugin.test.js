import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = resolve(root, 'plugins', 'annot-zcode');
const manifestPath = resolve(pluginRoot, '.zcode-plugin', 'plugin.json');
const marketplacePath = resolve(root, 'plugins', 'marketplace.json');
const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

test('ZCode plugin uses the host manifest and ships the three annot skills', () => {
  assert.equal(manifest.name, 'annot-zcode');
  assert.equal(manifest.skills, 'skills');
  assert.equal(manifest.commands, 'commands');
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.extensions, undefined);

  for (const name of ['annot', 'annot-analysis', 'annot-evaluation']) {
    const canonical = readFileSync(resolve(root, 'plugins', 'annot', 'skills', name, 'SKILL.md'), 'utf8');
    const adapted = readFileSync(resolve(pluginRoot, 'skills', name, 'SKILL.md'), 'utf8');
    assert.equal(adapted, canonical, `${name} drifted from the canonical plugin skill`);
  }
  assert.match(readFileSync(resolve(pluginRoot, 'commands', 'open-workbench.md'), 'utf8'), /annot workbench open --json/);
});

test('ZCode development marketplace points at the matching local plugin source', () => {
  const entry = marketplace.plugins.find((plugin) => plugin.name === manifest.name);
  assert.ok(entry, 'annot-zcode is missing from plugins/marketplace.json');
  assert.equal(entry.source, './annot-zcode');
  assert.equal(entry.version, manifest.version);
  assert.equal(entry.displayName, 'Annot');
  assert.equal(entry.displayName_i18n['zh-CN'], 'Annot Skill 图谱');
});
