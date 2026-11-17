/**
 * Renders the artifact in a real browser and returns a verdict, not a picture.
 *
 * The questions a screenshot cannot answer, and this can:
 *   - did every node card get drawn exactly once, and inside its own box?
 *   - does the page fit the viewport, or does the user have to scroll sideways?
 *   - did the page reach out to the network (it must not)?
 *   - did any script throw after the first frame?
 *
 * Exit code is the contract: 0 pass, 1 fail, 2 skipped (no browser available).
 * A skipped run is never reported as a pass — "I could not look" and "it looks
 * fine" are different claims.
 */

import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserUnavailable, findBrowser, openBrowser, type Browser } from './browser.ts';
import { atomicWriteBytes } from './fsx.ts';
import type { FlowDoc } from './types.ts';

export interface ViewportCheck {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  /** No horizontal scrollbar on the document itself. */
  fitsHorizontally: boolean;
  /** Graph larger than the visible canvas, i.e. the user must pan. Informational. */
  graphFitsCanvas: boolean;
  canvasWidth: number;
  graphWidth: number;
  nodesDrawn: number;
  /** Cards whose label box overflows the card. */
  overflowed: string[];
  /** Cards painted outside the SVG bounds. */
  outside: string[];
}

export interface RenderReport {
  status: 'pass' | 'fail' | 'skipped';
  artifact: string;
  viewports: ViewportCheck[];
  /** Requests the page made that were not the document itself. */
  network: string[];
  /** Uncaught exceptions and console errors. */
  problems: string[];
  reason?: string;
}

export const VIEWPORTS: Array<[number, number]> = [
  [1440, 900],
  [1600, 1000],
  [1920, 1080],
];

/**
 * Runs in the page. Kept as one string rather than several evaluates so the
 * measurements all describe the same layout pass.
 */
const PROBE = `(() => {
  const doc = document.documentElement;
  const svg = document.querySelector('svg');
  const cards = Array.from(document.querySelectorAll('g.node'));
  const seen = new Map();
  const overflowed = [];
  const outside = [];

  const bounds = svg ? svg.getBoundingClientRect() : null;

  for (const g of cards) {
    const id = g.getAttribute('data-id') || '';
    seen.set(id, (seen.get(id) || 0) + 1);

    const rect = g.querySelector('rect');
    const texts = Array.from(g.querySelectorAll('text'));
    if (!rect) continue;

    const box = rect.getBBox();
    const rendered = g.getBoundingClientRect();
    if (bounds && (rendered.left < bounds.left - 1 || rendered.right > bounds.right + 1 ||
                   rendered.top < bounds.top - 1 || rendered.bottom > bounds.bottom + 1)) {
      outside.push(id);
    }

    const cardWidth = Number(rect.getAttribute('width'));
    for (const t of texts) {
      const tb = t.getBBox();
      if (tb.width > cardWidth - 4) { overflowed.push(id); break; }
    }
  }

  const duplicated = [];
  for (const [id, count] of seen) if (count > 1) duplicated.push(id);

  const canvas = document.getElementById('canvas');

  return {
    scrollWidth: doc.scrollWidth,
    scrollHeight: doc.scrollHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    canvasWidth: canvas ? canvas.clientWidth : 0,
    graphWidth: bounds ? Math.round(bounds.width) : 0,
    nodesDrawn: cards.length,
    uniqueNodes: seen.size,
    duplicated,
    overflowed,
    outside,
  };
})()`;

export async function renderCheck(htmlPath: string, doc: FlowDoc, options: { shotDir?: string } = {}): Promise<RenderReport> {
  if (!findBrowser()) {
    return {
      status: 'skipped',
      artifact: resolve(htmlPath),
      viewports: [],
      network: [],
      problems: [],
      reason: 'no Chrome/Chromium/Edge found (set ANNOT_CHROME to point at one)',
    };
  }

  let browser: Browser | undefined;
  const report: RenderReport = { status: 'pass', artifact: resolve(htmlPath), viewports: [], network: [], problems: [] };

  try {
    browser = await openBrowser();
    await browser.navigate(pathToFileURL(resolve(htmlPath)).href);
    report.problems = browser.problems();
    report.network = browser.requests();

    for (const [width, height] of VIEWPORTS) {
      browser.reset();
      await browser.setViewport(width, height);

      const probe = await browser.evaluate<{
        scrollWidth: number;
        scrollHeight: number;
        innerWidth: number;
        innerHeight: number;
        canvasWidth: number;
        graphWidth: number;
        nodesDrawn: number;
        uniqueNodes: number;
        duplicated: string[];
        overflowed: string[];
        outside: string[];
      }>(PROBE);

      const check: ViewportCheck = {
        width,
        height,
        scrollWidth: probe.scrollWidth,
        scrollHeight: probe.scrollHeight,
        fitsHorizontally: probe.scrollWidth <= probe.innerWidth + 1,
        graphFitsCanvas: probe.graphWidth <= probe.canvasWidth + 1,
        canvasWidth: probe.canvasWidth,
        graphWidth: probe.graphWidth,
        nodesDrawn: probe.nodesDrawn,
        overflowed: probe.overflowed,
        outside: probe.outside,
      };
      report.viewports.push(check);

      // A node drawn twice, a card with text spilling out, or a card outside the
      // canvas are all defects that only show up at some widths.
      if (probe.duplicated.length > 0) report.problems.push(`${width}x${height}: node drawn twice (${probe.duplicated.join(', ')})`);
      if (probe.overflowed.length > 0) report.problems.push(`${width}x${height}: label overflows its card (${probe.overflowed.slice(0, 5).join(', ')})`);
      if (probe.outside.length > 0) report.problems.push(`${width}x${height}: card outside the canvas (${probe.outside.slice(0, 5).join(', ')})`);
      if (probe.nodesDrawn !== doc.nodes.length) {
        report.problems.push(`${width}x${height}: drew ${probe.nodesDrawn} nodes, expected ${doc.nodes.length}`);
      }
      for (const extra of browser.problems()) report.problems.push(`${width}x${height}: ${extra}`);

      if (options.shotDir) await capture(browser, options.shotDir, width, height);
    }
  } catch (error) {
    if (error instanceof BrowserUnavailable) {
      return { ...report, status: 'skipped', reason: error.message };
    }
    return { ...report, status: 'fail', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await browser?.close();
  }

  if (report.network.length > 0) report.problems.push(`page made ${report.network.length} network request(s): ${report.network.slice(0, 3).join(', ')}`);
  const broke = report.problems.length > 0 || report.viewports.some((v) => !v.fitsHorizontally);
  report.status = broke ? 'fail' : 'pass';
  return report;
}

async function capture(browser: Browser, dir: string, width: number, height: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  const png = await browser.screenshot();
  // The screenshot is evidence, not a deliverable: it is written through the
  // same atomic path so a truncated PNG can never look like a rendered page.
  await atomicWriteBytes(join(dir, `${width}x${height}.png`), png, 'base64');
}

export function formatRenderReport(report: RenderReport): string {
  const lines: string[] = [];
  const name = report.artifact.split(/[\\/]/).pop() ?? report.artifact;

  if (report.status === 'skipped') {
    lines.push(`~ ${name}: 跳过渲染检查 — ${report.reason ?? 'no browser'}`);
    return `${lines.join('\n')}\n`;
  }

  const head = report.status === 'pass' ? '✓' : '✗';
  lines.push(`${head} ${name}: ${report.viewports.length} 个视口`);
  for (const v of report.viewports) {
    const fit = v.fitsHorizontally ? 'no-hscroll' : `HSCROLL ${v.scrollWidth}>${v.width}`;
    const graph = v.graphFitsCanvas ? 'graph fits' : `graph ${v.graphWidth}>${v.canvasWidth} (pans)`;
    lines.push(
      `   ${String(v.width).padStart(4)}×${String(v.height).padEnd(4)}  ${fit}  ${graph}  ${v.nodesDrawn} nodes`,
    );
  }
  if (report.problems.length > 0) {
    lines.push('   problems:');
    for (const p of report.problems.slice(0, 12)) lines.push(`     - ${p}`);
    if (report.problems.length > 12) lines.push(`     … ${report.problems.length - 12} more`);
  }
  return `${lines.join('\n')}\n`;
}
