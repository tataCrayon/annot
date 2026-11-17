/**
 * `verify` is the only command whose verdict depends on a real browser, so its
 * tests are split by what they actually prove:
 *
 *   - the report formatting is pure and always testable;
 *   - the rendering checks run against the real artifact when a browser exists,
 *     and are SKIPPED (not passed) when one does not. A test suite that goes
 *     green because it could not look is worse than no test.
 *
 * The broken-page case is built by corrupting a real render, because that is
 * the only way to be sure the checks are looking at this page and not at a
 * hardcoded success.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findBrowser } from '../src/browser.ts';
import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';
import { renderHtml } from '../src/render.ts';
import type { FlowDoc } from '../src/types.ts';
import { VIEWPORTS, formatRenderReport, renderCheck, type RenderReport } from '../src/visual.ts';

const here = dirname(fileURLToPath(import.meta.url));
const browserless = !findBrowser();

async function fixtureDoc(): Promise<FlowDoc> {
  const text = await readFile(join(here, 'fixtures', 'router-shape.md'), 'utf8');
  return buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' });
}

async function writePage(dir: string, doc: FlowDoc, html?: string): Promise<string> {
  const path = join(dir, 'page.html');
  await writeFile(path, html ?? renderHtml(doc), 'utf8');
  return path;
}

test('the report names every viewport and never rounds a failure into a pass', () => {
  const report: RenderReport = {
    status: 'fail',
    artifact: '/tmp/x/challenge.html',
    viewports: [
      { width: 1440, height: 900, scrollWidth: 1500, scrollHeight: 900, fitsHorizontally: false, graphFitsCanvas: true, canvasWidth: 1056, graphWidth: 900, nodesDrawn: 13, overflowed: [], outside: [] },
      { width: 1920, height: 1080, scrollWidth: 1920, scrollHeight: 1080, fitsHorizontally: true, graphFitsCanvas: true, canvasWidth: 1536, graphWidth: 900, nodesDrawn: 13, overflowed: ['n-a'], outside: [] },
    ],
    network: [],
    problems: ['1440x900: label overflows its card (n-a)'],
  };

  const text = formatRenderReport(report);
  assert.match(text, /^✗ challenge\.html: 2 个视口/);
  assert.match(text, /HSCROLL 1500>1440/);
  assert.match(text, /graph fits/);
  assert.match(text, /problems:/);
});

test('a skipped run is printed as skipped, not as success', () => {
  const text = formatRenderReport({
    status: 'skipped',
    artifact: '/tmp/x/a.html',
    viewports: [],
    network: [],
    problems: [],
    reason: 'no browser',
  });
  assert.match(text, /^~ /);
  assert.match(text, /跳过渲染检查/);
  assert.doesNotMatch(text, /^✓/);
});

test('the checked viewports are the documented set', () => {
  assert.deepEqual(VIEWPORTS, [[1440, 900], [1600, 1000], [1920, 1080]]);
});

test('a real render passes every viewport', { skip: browserless && 'no Chrome/Chromium/Edge on this machine' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annot-visual-'));
  try {
    const doc = await fixtureDoc();
    const html = await writePage(dir, doc);
    const report = await renderCheck(html, doc);

    assert.notEqual(report.status, 'skipped', 'a browser was found, so this must actually run');
    assert.deepEqual(report.problems, [], `unexpected problems: ${report.problems.join(' | ')}`);
    assert.equal(report.viewports.length, VIEWPORTS.length);
    assert.equal(report.network.length, 0, `page fetched over the network: ${report.network.join(', ')}`);
    for (const v of report.viewports) {
      assert.equal(v.nodesDrawn, doc.nodes.length, `${v.width}: drew ${v.nodesDrawn}/${doc.nodes.length}`);
      assert.ok(v.fitsHorizontally, `${v.width}: document scrolls horizontally (${v.scrollWidth})`);
      assert.deepEqual(v.overflowed, []);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a page whose script never runs is a failure, not a pass', { skip: browserless && 'no browser' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annot-visual-'));
  try {
    const doc = await fixtureDoc();
    // Strip the inline client script: the canvas stays empty, which is exactly
    // the failure mode a screenshot alone would have called "a blank page".
    const broken = renderHtml(doc).replace(/<script>[\s\S]*?<\/script>/, '');
    const html = await writePage(dir, doc, broken);
    const report = await renderCheck(html, doc);

    assert.equal(report.status, 'fail');
    assert.ok(report.problems.some((p) => /drew 0 nodes, expected/.test(p)), `problems: ${report.problems.join(' | ')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a page that phones home fails the offline contract', { skip: browserless && 'no browser' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annot-visual-'));
  try {
    const doc = await fixtureDoc();
    const leaked = renderHtml(doc).replace('<body>', '<body>\n<img src="http://127.0.0.1:9/leak.png" alt="" />');
    const html = await writePage(dir, doc, leaked);
    const report = await renderCheck(html, doc);

    assert.equal(report.status, 'fail');
    assert.ok(report.network.some((u) => u.includes('leak.png')), `network: ${report.network.join(', ')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--shot writes one decodable PNG per viewport, named by its size', { skip: browserless && 'no browser' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annot-visual-'));
  const shots = join(dir, 'shots');
  try {
    const doc = await fixtureDoc();
    const html = await writePage(dir, doc);
    const report = await renderCheck(html, doc, { shotDir: shots });
    assert.equal(report.status, 'pass', `render failed: ${report.problems.join(' | ')}`);

    for (const [width, height] of VIEWPORTS) {
      const path = join(shots, `${width}x${height}.png`);
      const bytes = await readFile(path);
      assert.ok(bytes.length > 0, `${width}x${height}.png is empty`);

      // A PNG written through the utf8 path is base64 text that looks like a
      // plausible file size and is not a PNG at all. The magic is the only
      // honest proof, so it is asserted rather than the byte count.
      assert.equal(
        bytes.subarray(0, 8).toString('latin1'),
        '\x89PNG\r\n\x1a\n',
        `${width}x${height}.png does not start with the PNG signature`,
      );
      // IHDR carries the dimensions: bytes 16..24, big-endian, after the 8-byte
      // signature and the 8-byte length+type header.
      assert.equal(bytes.readUInt32BE(16), width, `${width}x${height}.png is ${bytes.readUInt32BE(16)}px wide`);
      assert.equal(bytes.readUInt32BE(20), height, `${width}x${height}.png is ${bytes.readUInt32BE(20)}px tall`);
    }

    const written = (await readdir(shots)).sort();
    assert.deepEqual(written, VIEWPORTS.map(([w, h]) => `${w}x${h}.png`).sort(), 'shot dir has exactly one file per viewport');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
