import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');

test('the UI contract defines one spacing and radius scale', async () => {
  const [spec, css, renderer] = await Promise.all([
    readFile(join(root, 'docs', 'ui-design-system.md'), 'utf8'),
    readFile(join(root, 'web', 'app.css'), 'utf8'),
    readFile(join(root, 'src', 'render.ts'), 'utf8'),
  ]);

  for (const token of ['--space-1: 4px', '--space-4: 16px', '--space-5: 24px', '--space-6: 32px']) {
    assert.ok(css.includes(token), `workbench is missing ${token}`);
    assert.ok(renderer.includes(token), `graph renderer is missing ${token}`);
  }
  assert.match(spec, /文本到卡片边界的最小距离为 16px/);
  assert.match(spec, /时序轨每行至少 56px/);
  assert.match(spec, /缩放必须改变 SVG 的实际渲染尺寸/);
});

test('the three-pane shell and tab rhythm use named spacing tokens', async () => {
  const css = await readFile(join(root, 'web', 'app.css'), 'utf8');
  const html = await readFile(join(root, 'web', 'index.html'), 'utf8');

  assert.match(css, /body\.panel-open \.workspace \{ grid-template-columns: 304px minmax\(0, 1fr\) clamp\(340px, 29vw, 420px\); \}/);
  assert.match(css, /\.view-tabs \{[^}]*gap: var\(--space-1\);[^}]*padding: var\(--space-1\);/s);
  assert.match(css, /\.skill-command-board \{[^}]*gap: var\(--gap-component\);/s);
  assert.match(html, /<main id="main-content"[\s\S]*<\/main>[\s\S]*<aside id="node-drawer"/);
});

test('graph action sequence reserves room between labels and the timeline', async () => {
  const renderer = await readFile(join(root, 'src', 'render.ts'), 'utf8');

  assert.match(renderer, /\.action-chain::before \{/s);
  assert.match(renderer, /\.action-jump \{[^}]*grid-template-columns: 40px minmax\(0, 1fr\) 18px;/s);
  assert.match(renderer, /\.action-jump-copy strong \{[^}]*white-space: normal;/s);
  assert.match(renderer, /COLUMN_HEADER_H = 100/);
  assert.match(renderer, /COLUMN_GAP = 64/);
  assert.match(renderer, /\.edge, \.association \{ vector-effect: non-scaling-stroke; \}/);
});

test('card footers reserve separate widths for source metadata and status', async () => {
  const [renderer, plugin] = await Promise.all([
    readFile(join(root, 'src', 'render.ts'), 'utf8'),
    readFile(join(root, 'plugin', 'client.js'), 'utf8'),
  ]);

  assert.match(renderer, /const footMaxWidth = n\.w -[^;]*rightStatusWidth \+ 16/s);
  assert.match(renderer, /const rightStatus = clipToWidth\(statusParts\.join/);
  assert.match(plugin, /metaText\.length > 11/);
  assert.match(plugin, /rightStatus\.length > 8/);
});
