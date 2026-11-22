import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'plugins', 'annot', 'plugin.json'), 'utf8'));
const marketplace = JSON.parse(readFileSync(resolve(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
const skillPath = resolve(root, 'plugins', 'annot', 'skills', 'annot', 'SKILL.md');
const analysisSkillPath = resolve(root, 'plugins', 'annot', 'skills', 'annot-analysis', 'SKILL.md');
const evaluationSkillPath = resolve(root, 'plugins', 'annot', 'skills', 'annot-evaluation', 'SKILL.md');
const agentInterfacePath = resolve(root, 'plugins', 'annot', 'agents', 'openai.yaml');
const agentPromptPath = resolve(root, 'plugins', 'annot', 'agents', 'annot-reviewer.md');

test('Codex plugin declares the portable Skill package and desktop execution requirement', () => {
  assert.equal(manifest.name, 'annot');
  assert.equal(manifest.extensions['com.openai'].requires_local_executor, true);
  assert.equal(marketplace.plugins[0].source.path, './plugins/annot');
  assert.equal(marketplace.plugins[0].name, manifest.name);
  assert.match(readFileSync(skillPath, 'utf8'), /^---\nname: annot\n/m);
});

test('Codex plugin ships separate AI analysis and evaluation Skills', () => {
  assert.match(readFileSync(analysisSkillPath, 'utf8'), /^---\nname: annot-analysis\n/m);
  assert.match(readFileSync(evaluationSkillPath, 'utf8'), /^---\nname: annot-evaluation\n/m);
  assert.match(readFileSync(skillPath, 'utf8'), /Load `annot-analysis`/);
  assert.match(readFileSync(skillPath, 'utf8'), /Load `annot-evaluation`/);
});

test('Codex plugin exposes a standalone Skill reviewer Agent without duplicating the engine', () => {
  assert.match(readFileSync(agentInterfacePath, 'utf8'), /display_name: "Annot Skill Reviewer"/);
  const prompt = readFileSync(agentPromptPath, 'utf8');
  assert.match(prompt, /load `annot-analysis`/);
  assert.match(prompt, /load `annot-evaluation`/);
  assert.match(prompt, /continue analysis or editing in this conversation/);
  assert.match(prompt, /Do not create a second parser/);
});
