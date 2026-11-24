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
  // Every full-height pane subtracts the same chrome token, so the drawer edge
  // cannot drift from the graph's top edge.
  assert.match(css, /--chrome-height: 104px;/);
  assert.match(css, /\.workspace \{ height: calc\(100vh - var\(--chrome-height\)\);/);
  assert.match(css, /\.library \{[^}]*height: calc\(100vh - var\(--chrome-height\)\);/s);
  assert.match(css, /\.node-drawer \{[^}]*height: calc\(100vh - var\(--chrome-height\)\);/s);
  assert.match(css, /\.view-tabs \{[^}]*gap: var\(--space-1\);[^}]*padding: 3px;/s);
  assert.match(css, /\.skill-command-board \{[^}]*gap: var\(--gap-component\);/s);
  assert.match(html, /<main id="main-content"[\s\S]*<\/main>[\s\S]*<aside id="node-drawer"/);
});

test('graph action sequence reserves room between labels and the timeline', async () => {
  const renderer = await readFile(join(root, 'src', 'render.ts'), 'utf8');

  assert.match(renderer, /\.action-chain::before \{/s);
  assert.match(renderer, /\.action-jump \{[^}]*grid-template-columns: 40px minmax\(0, 1fr\) 18px;/s);
  assert.match(renderer, /\.action-jump-copy strong \{[^}]*white-space: normal;/s);
  // Title, legend and rule need three baselines, but two lines of paper: 100px
  // of header pushed the first card of the workbench pane below the fold.
  assert.match(renderer, /COLUMN_HEADER_H = 74;/);
  assert.match(renderer, /COLUMN_GAP = 64/);
  assert.match(renderer, /\.edge, \.association \{ vector-effect: non-scaling-stroke; \}/);
});

test('the embedded graph lays its jump list out as a snake, never a scrollbar', async () => {
  const renderer = await readFile(join(root, 'src', 'render.ts'), 'utf8');

  // Stand-alone the action list is a cover page; embedded it is a nav strip.
  // It wraps instead of scrolling: a strip that scrolls hides half the steps
  // behind a scrollbar the reader has to discover.
  assert.match(renderer, /body\.is-embedded \.action-chain \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*overflow: visible;/s);
  assert.doesNotMatch(renderer, /body\.is-embedded \.action-chain \{[^}]*overflow-x: auto;/s);
  assert.match(renderer, /body\.is-embedded \.action-jump \{[^}]*border-radius: 999px;/s);
  assert.match(renderer, /body\.is-embedded \.action-jump-copy small,\s*body\.is-embedded \.action-jump-arrow \{ display: none; \}/s);
  assert.match(renderer, /body\.is-embedded \.action-jump-copy strong \{[^}]*text-overflow: ellipsis;/s);
  // Reversing a single flex row is not a CSS feature, so the client script does
  // it: odd rows are re-ordered backwards inside a right-aligned `.action-row`.
  assert.match(renderer, /function snakeChips\(\)/);
  assert.match(renderer, /body\.is-embedded \.action-row \{ flex: 0 0 100%; display: flex; flex-wrap: wrap;/);
  assert.match(renderer, /body\.is-embedded \.action-row\.is-reversed \{ justify-content: flex-end; \}/);
});

test('card footers reserve separate widths for source metadata and status', async () => {
  const [renderer, plugin] = await Promise.all([
    readFile(join(root, 'src', 'render.ts'), 'utf8'),
    readFile(join(root, 'plugin', 'client.js'), 'utf8'),
  ]);

  // The footer is measured against the painted plate, not the layout box: a note
  // box is its owner's column and only its plate steps in, so using `n.w` here
  // would let the footer run past a note's visible right edge.
  assert.match(renderer, /const footMaxWidth = w -[^;]*rightStatusWidth \+ 16/s);
  assert.match(renderer, /const rightStatus = clipToWidth\(statusParts\.join/);
  assert.match(plugin, /metaText\.length > 11/);
  assert.match(plugin, /rightStatus\.length > 8/);
});
