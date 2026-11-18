/**
 * One self-contained HTML file, no network, no framework: the artifact has to
 * survive being emailed, opened from a USB stick, and read in a browser with
 * no server behind it.
 *
 * Layout is a layered DAG: depth runs downward, siblings run sideways. The
 * earlier version was a column-major grid, which cut a 19-step pipeline into
 * columns of seven and sent the eye back to the top through arrows pointing
 * backwards. A flow has exactly one readable order — down — so the geometry
 * follows the reading rather than packing the canvas. Two runs of the same
 * skill still produce the same picture, so screenshots stay comparable.
 */

import { defectsOf } from './audit.ts';
import { depthOf } from './depth.ts';
import { diagnose } from './diag.ts';
import type { FlowDoc, FlowEdge, FlowNode, NodeType } from './types.ts';

const NODE_W = 360;
/** Height of one wrapped label line at 13px. */
const LINE_H = 19;
/** Padding above the first label line. */
const PAD_TOP = 34;
/** Footer that carries the line range and the confidence. */
const FOOT_H = 26;
/** One visible table row inside a card. */
const ROW_H = 15;
/** Room for the open arms drawn under a forking card. */
const ARM_H = 26;
const SIBLING_GAP = 28;
const BAND_GAP = 34;
const PAD = 40;
/**
 * Left margin reserved for the step numbers.
 *
 * Without it the picture has no place to say "this is step 7 of 19", and a long
 * pipeline becomes an undifferentiated column. The gutter is also what makes
 * two screenshots comparable: the numbers are in the same place every run.
 */
const GUTTER = 88;

interface Placed extends FlowNode {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The plate itself; `h` also reserves any fork row hanging under it. */
  cardH: number;
  /** Depth band: 0 is the entry, each sequence edge advances one. */
  band: number;
  /** Position inside the band, left to right. */
  slot: number;
  /** The label already broken into lines, so layout and paint cannot disagree. */
  lines: string[];
  /** Table rows the card keeps visible, so a table is not just its header. */
  rows: string[];
  /** Guards whose target is unknown: drawn as open arms under the card. */
  arms: Array<{ label: string; w: number }>;
}

interface PlacedEdge {
  from: string;
  to: string;
  kind: 'sequence' | 'branch';
  when?: string;
  d: string;
  labelX: number;
  labelY: number;
  showLabel: boolean;
}

export interface Layout {
  width: number;
  height: number;
  nodes: Placed[];
  edges: PlacedEdge[];
  /** One entry per depth band, for the numbered rules the page draws. */
  bands: Array<{ index: number; y: number; count: number }>;
}

/**
 * Width of a string at a given size, in the same estimate `wrapLabel` uses.
 *
 * One function, because layout and paint have to agree: the earlier code
 * measured in the browser and wrapped on the server, and the two disagreed by
 * enough to cut a label mid-phrase.
 */
export function textWidth(text: string, fontPx = 13): number {
  let width = 0;
  for (const char of String(text)) {
    const code = char.codePointAt(0) ?? 0;
    const wide = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef);
    width += wide ? fontPx : fontPx * 0.56;
  }
  return width;
}

/**
 * Break a label into at most `maxLines` lines that fit `maxPx`.
 *
 * Measured, not counted: a CJK glyph is about one em wide and a Latin glyph
 * about half, so counting characters either wastes half the card on Chinese or
 * overflows it on English. The same estimate drives layout and paint, which is
 * why the result is returned rather than recomputed in the browser.
 */
export function wrapLabel(text: string, maxPx: number, maxLines = 3, fontPx = 13): string[] {
  const lines: string[] = [];
  let line = '';
  let width = 0;
  const budget = maxPx;

  for (const char of String(text)) {
    const code = char.codePointAt(0) ?? 0;
    const wide = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef);
    const w = wide ? fontPx : fontPx * 0.56;
    if (width + w > budget && line !== '') {
      lines.push(line);
      if (lines.length === maxLines) {
        // Out of room: the last visible line ends in an ellipsis rather than
        // the text simply stopping, so a truncated label can be recognised.
        lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(1, lines[maxLines - 1].length - 1))}…`;
        return lines;
      }
      line = '';
      width = 0;
    }
    line += char;
    width += w;
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/** Clip a string to a pixel budget, appending an ellipsis when it does not fit. */
function clipToWidth(text: string, maxPx: number, fontPx = 11): string {
  if (textWidth(text, fontPx) <= maxPx) return text;
  let out = '';
  for (const char of text) {
    if (textWidth(`${out}${char}…`, fontPx) > maxPx) break;
    out += char;
  }
  return `${out}…`;
}

/**
 * A markdown table, recognised from its own text.
 *
 * `kindOf` in parse.ts takes `RawLine[]`, and a node only carries the joined
 * string, so it cannot be reused here. The test is the separator row: a header
 * line followed by `|---|---|` is a table and nothing else is.
 */
function isTable(raw: string): boolean {
  const rows = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (rows.length < 2) return false;
  return /^\|?[\s:|-]+\|?$/.test(rows[1] ?? '');
}

/**
 * Turn a table node's raw markdown into rows a card can actually show.
 *
 * A table is where a skill states its gates and its field list, and flattening
 * it to the header row hid the only part that carries the rule: "八项必填" was
 * one card reading "# · 字段 · 不通过的样子" with all eight requirements inside
 * a tooltip nobody opens. Rows are kept, capped, and the remainder is counted.
 */
function tableRows(raw: string, max = 6): string[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const data = lines.filter((l) => !/^\|?[\s:|-]+\|?$/.test(l));
  const out: string[] = [];
  for (const line of data.slice(1, max + 1)) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/[*`]/g, ''));
    if (cells.length === 0) continue;
    const first = cells[0] ?? '';
    const rest = cells.slice(1).filter(Boolean).join(' · ');
    const label = rest ? `${first}  ${rest}` : first;
    if (label.trim() !== '') out.push(clipToWidth(label, NODE_W - 40, 11));
  }
  const hidden = Math.max(0, data.length - 1 - out.length);
  if (hidden > 0) out.push(`…还有 ${hidden} 行`);
  return out;
}

/**
 * Lay out the open arms of a fork inside the card width.
 *
 * Arms are the guards whose target could not be resolved. Drawing them is the
 * difference between "this skill has three outcomes" and a picture that looks
 * like a straight line while the source clearly forks.
 */
function layoutArms(guards: string[]): Array<{ label: string; w: number }> {
  const kept = guards.slice(0, 4);
  if (kept.length === 0) return [];
  const gap = 8;
  const box = (NODE_W - gap * (kept.length - 1)) / kept.length;
  return kept.map((guard) => {
    const label = clipToWidth(guard, box - 20, 11);
    return { label, w: Math.max(28, Math.min(box, textWidth(label, 11) + 20)) };
  });
}

/**
 * Depth of every node from its longest sequence path.
 *
 * Longest path, not shortest: a node should sit below everything that can reach
 * it, otherwise two edges into the same band cross the card.
 */
function depthOfDoc(doc: FlowDoc): Map<string, number> {
  return depthOf(doc.nodes, doc.edges);
}

/**
 * Depth runs downward, siblings run sideways.
 *
 * The previous layout was a column-major grid: a 19-step pipeline was cut into
 * columns of seven, so reading order went down, then back up to the top of the
 * next column, through arrows that pointed backwards. That is why the picture
 * looked wrong even when the extraction was right. A layered layout puts each
 * node below the one it follows, which is the only order a flow can be read in.
 */
export function layoutNodes(doc: FlowDoc): Layout {
  const depth = depthOfDoc(doc);

  const bands = new Map<number, FlowNode[]>();
  for (const node of doc.nodes) {
    const band = depth.get(node.id) ?? 0;
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band)?.push(node);
  }

  const ordered = [...bands.keys()].sort((a, b) => a - b);
  const bandWidth = (count: number): number => count * NODE_W + Math.max(0, count - 1) * SIBLING_GAP;
  const widest = Math.max(1, ...ordered.map((b) => bandWidth(bands.get(b)?.length ?? 0)));
  const width = widest + PAD * 2 + GUTTER;

  const placed: Placed[] = [];
  const bands_: Array<{ index: number; y: number; count: number }> = [];
  let cursorY = PAD;

  for (const band of ordered) {
    const members = [...(bands.get(band) ?? [])].sort((a, b) => a.anchor.start - b.anchor.start);
    const geometries = members.map((node) => {
      const lines = wrapLabel(node.label, NODE_W - 28);
      // A table is a rule, not a title: show its rows so the card carries the
      // requirement instead of hiding it behind the header.
      const rows = isTable(node.raw) ? tableRows(node.raw) : [];
      const arms = layoutArms(node.branches.filter((b) => !b.to).map((b) => b.when));
      const cardH = PAD_TOP + lines.length * LINE_H + rows.length * ROW_H + FOOT_H;
      return { node, lines, rows, arms, cardH, h: cardH + (arms.length ? ARM_H : 0) };
    });
    const bandH = Math.max(...geometries.map((g) => g.h));
    const left = PAD + GUTTER + (widest - bandWidth(members.length)) / 2;
    bands_.push({ index: band, y: cursorY, count: members.length });

    geometries.forEach((geometry, slot) => {
      placed.push({
        ...geometry.node,
        lines: geometry.lines,
        rows: geometry.rows,
        arms: geometry.arms,
        cardH: geometry.cardH,
        band,
        slot,
        x: left + slot * (NODE_W + SIBLING_GAP),
        y: cursorY + (bandH - geometry.h) / 2,
        w: NODE_W,
        h: geometry.h,
      });
    });

    cursorY += bandH + BAND_GAP;
  }

  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges: PlacedEdge[] = [];

  for (const edge of doc.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b || a === b) continue;

    const isBranch = edge.kind === 'branch';
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;

    // A straight drop when the two are stacked, an elbow when the child sits in
    // a neighbouring slot. Ruled lines, no curves: the card is a plate and the
    // connection is a rule, which is how a spec sheet draws a dependency.
    if (Math.abs(x1 - x2) < 1) {
      edges.push({ ...edge, d: `M ${x1} ${y1} L ${x2} ${y2}`, labelX: x1, labelY: (y1 + y2) / 2, showLabel: isBranch });
      continue;
    }

    const midY = y1 + (y2 - y1) / 2;
    edges.push({
      ...edge,
      d: `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: midY - 6,
      showLabel: isBranch,
    });
  }

  return {
    width,
    height: Math.max(PAD, cursorY - BAND_GAP + PAD),
    nodes: placed,
    edges,
    bands: bands_,
  };
}

export function renderHtml(doc: FlowDoc, options: { title?: string } = {}): string {
  const layout = layoutNodes(doc);
  const title = options.title ?? `${doc.skill} · annot`;
  const payload = safeJson(doc);
  const layoutPayload = safeJson(layout);
  const unresolved = doc.nodes.reduce((n, node) => n + node.branches.filter((b) => !b.to).length, 0);
  const toConfirm = doc.stats.lowConfidence;
  const steps = doc.nodes.length;
  const scored = scoreOf(doc);
  const shape = diagnose(doc);
  // A rendering can pass every viewport check and still not be a flow: three
  // real skills drew one card per band, zero branch edges, and passed. The rail
  // states the shape so a reader is not asked to infer it from the picture.
  const shapeHtml = shape.findings.length
    ? `<ul class="plain">${shape.findings.map((f) => `<li class="${f.severity === 'warn' ? 'warn' : ''}">${esc(f.message)}</li>`).join('')}</ul>`
    : '<p class="muted" style="margin:0">没有形状上的异常：既有判定节点，也有横向铺开的分叉。</p>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(doc.skill)} 的流程：${steps} 个步骤、${doc.edges.length} 条连接、${unresolved} 个未落地的分支，每个格子绑定它在原文里的行号。" />
<style>
  /* Hallmark · v2.0.0 · shape: app screen · theme: terrazzo (off-white) · deal: 2/3, seed annot-skill-flow-graph-3288 */
  /* Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V4 · weakest: E, the numbered gutter and the score rail are the page's two new measurements and both must agree with the graph */
  :root {
    --paper: #f6f4ef; --plate: #fffefb; --ink: #1a1815; --ink-2: #3c3833;
    --muted: #6b655c; --rule: #d9d3c7; --rule-ink: #1a1815;
    --accent: #a34a1c; --accent-soft: #f2e4d8; --accent-2: #7a3512;
    --tag-warn-rule: #d8bda8; --tag-ok-rule: #a9c6b6;
    --focus: #a34a1c;
    --stage: #3b36a8; --decision: #9a5b06; --gate: #a8201a; --artifact: #14603f; --external: #12557a;
    --font-display: "Syne", "Segoe UI", "Microsoft YaHei", ui-sans-serif, sans-serif;
    --font-body: "Onest", "Segoe UI", "Microsoft YaHei", ui-sans-serif, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
    --dur-micro: 120ms;
  }
  * { box-sizing: border-box; }
  html, body { overflow-x: clip; }
  body {
    margin: 0; color: var(--ink); background: var(--paper);
    font-family: var(--font-body); font-size: 14px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  /* The container is capped: at 1920 the gutters grow, the measure does not. */
  .wrap { max-width: 1560px; margin: 0 auto; padding: 0 32px; }

  .masthead { border-bottom: 2px solid var(--rule-ink); background: var(--plate); }
  .masthead .wrap { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; padding-top: 32px; padding-bottom: 24px; }
  .masthead h1 {
    font-family: var(--font-display); font-weight: 700; letter-spacing: -0.025em; line-height: 1;
    font-size: 42px; margin: 0; overflow-wrap: break-word; min-width: 0; text-wrap: balance;
  }
  .claim { margin: 12px 0 0; font-size: 14.5px; color: var(--ink-2); max-width: 60ch; }
  .provenance { display: flex; flex-wrap: wrap; gap: 0 24px; margin: 16px 0 0; padding: 0; }
  .provenance div { display: flex; gap: 8px; align-items: baseline; }
  .provenance dt { font-size: 12px; color: var(--muted); }
  .provenance dd { margin: 0; font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
  .facts { display: flex; gap: 0; text-align: right; }
  .facts div { padding: 0 20px; border-left: 1px solid var(--rule); }
  .facts div:first-child { border-left: 0; }
  .facts b { display: block; font-family: var(--font-mono); font-weight: 500; font-size: 24px; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .facts span { font-size: 12px; color: var(--muted); }
  .facts .bad b { color: var(--accent); }

  .split { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 0; align-items: start; }
  #canvas { overflow: auto; padding: 0; min-height: 60vh; }
  /* Centred while it fits, left-anchored once it does not: a narrow chain in a
     wide pane should not cling to the left edge, and a wide graph must still
     pan from its true left margin. */
  svg { display: block; margin: 0 auto; }

  /* The rail stays put while a 19-step column scrolls past it: the score and
     the pending list are what you consult while reading, not after. */
  #detail {
    border-left: 2px solid var(--rule-ink); background: var(--plate);
    padding: 24px 24px 60px; position: sticky; top: 0; max-height: 100vh; overflow-y: auto;
  }
  #detail h2 {
    font-family: var(--font-body); font-weight: 500; font-size: 12px; color: var(--muted);
    margin: 24px 0 8px; padding-top: 12px; border-top: 1px solid var(--rule);
  }
  #detail h2:first-child { margin-top: 0; padding-top: 0; border-top: 0; }

  .score { display: flex; align-items: baseline; gap: 12px; }
  .score b { font-family: var(--font-mono); font-weight: 500; font-size: 34px; line-height: 1; font-variant-numeric: tabular-nums; }
  .score span { font-size: 12.5px; color: var(--muted); }
  .why { margin: 12px 0 0; font-size: 12.5px; color: var(--ink-2); }
  .why ul { margin: 8px 0 0; padding-left: 16px; }

  .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; }
  .legend i { display: inline-block; width: 8px; height: 8px; margin-right: 8px; vertical-align: 0; }
  .legend span { white-space: nowrap; color: var(--ink-2); }

  .kv { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px 12px; font-size: 12.5px; margin: 0; }
  .kv dt { color: var(--muted); }
  .kv dd { margin: 0; overflow-wrap: break-word; min-width: 0; }
  code, kbd { font-family: var(--font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; }

  pre.body {
    white-space: pre-wrap; background: var(--paper); border: 1px solid var(--rule);
    padding: 12px; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6;
    max-height: 260px; overflow: auto; margin: 0;
  }
  ul.plain { margin: 0; padding-left: 16px; font-size: 12.5px; }
  ul.plain li { margin: 4px 0; }

  .tag { display: inline-block; font-size: 11.5px; padding: 2px 8px; background: var(--paper); color: var(--ink-2); border: 1px solid var(--rule); }
  .tag.warn { background: var(--accent-soft); color: var(--accent-2); border-color: var(--tag-warn-rule); }
  .tag.ok { color: var(--artifact); border-color: var(--tag-ok-rule); }

  .muted { color: var(--muted); font-size: 12.5px; }
  /* A shape finding that is a defect, not an observation. It marks the list item
     only: the ink of the warning is reserved for things a reader must act on. */
  ul.plain li.warn { color: var(--accent-2); }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  /* An open arm is a fork with no target; it keeps the ink of a warning rather
     than a colour of its own, because the type ink is already spoken for. */
  rect.arm { transition: none; }
  .node:hover rect.arm, .node.sel rect.arm { stroke-width: 2; }

  /* A node is a control: it has hover, focus, press and selected. Press is the
     one state a screenshot never catches, which is why it is written down. */
  .node { cursor: pointer; }
  .node rect.card { transition: stroke-width var(--dur-micro) linear; }
  .node:hover rect.card { stroke-width: 1.5; }
  .node:active rect.card { stroke-width: 2.5; }
  .node.sel rect.card { stroke-width: 2; }
  .node text { pointer-events: none; }
  .edge { fill: none; stroke: var(--rule-ink); stroke-width: 1.2; }
  .edge.branch { stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 4 3; }
  .edge-label { fill: var(--accent-2); font-family: var(--font-body); font-size: 10.5px; paint-order: stroke; stroke: var(--paper); stroke-width: 3px; stroke-linejoin: round; }
  .stepnum { fill: var(--muted); font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
  .steprule { stroke: var(--rule); stroke-width: 1; }
  ::selection { background: var(--accent-soft); }

  @media (max-width: 1080px) {
    .split { grid-template-columns: minmax(0, 1fr); }
    #detail { position: static; max-height: none; border-left: 0; border-top: 2px solid var(--rule-ink); }
    .masthead .wrap { grid-template-columns: minmax(0, 1fr); }
    .facts { text-align: left; }
    .facts div:first-child { padding-left: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>
</head>
<body>
<header class="masthead">
  <div class="wrap">
    <div>
      <h1>${esc(doc.skill)}</h1>
      <p class="claim">${steps} 个步骤，自上而下按原文顺序排列。每一格是文件里一段连续的原文。</p>
      <dl class="provenance">
        <div><dt>文件</dt><dd>${esc(doc.source.file)}</dd></div>
        <div><dt>行数</dt><dd>${doc.source.lines}</dd></div>
        <div><dt>哈希</dt><dd>${esc(doc.source.sha.slice(0, 10))}</dd></div>
        <div><dt>生成</dt><dd>${esc(doc.source.generated_at.slice(0, 16).replace('T', ' '))}</dd></div>
      </dl>
    </div>
    <div class="facts">
      <div><b>${steps}</b><span>步骤</span></div>
      <div><b>${doc.edges.length}</b><span>连接</span></div>
      <div class="${unresolved ? 'bad' : ''}"><b>${unresolved}</b><span>分支未落地</span></div>
      <div class="${toConfirm ? 'bad' : ''}"><b>${toConfirm}</b><span>待人工确认</span></div>
    </div>
  </div>
</header>
<div class="wrap">
  <div class="split">
    <div id="canvas"></div>
    <aside id="detail">
      <h2>评估</h2>
      <div class="score"><b>${scored.total}</b><span>/ 100 抽取可读度</span></div>
      <p class="why">${scored.verdict}</p>
      <p class="muted" style="margin:8px 0 0">这个数只反映抽取有没有明显缺陷（未落地分支、低置信、空正文、切得太碎），<strong>不评价 skill 本身写得好不好</strong>。与 <code>annot audit</code> 同一组权重：审计分 = 100 − 本分。</p>
      ${scored.reasons.length ? `<div class="why"><ul>${scored.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      <h2>形状</h2>
      ${shapeHtml}
      <h2>怎么读</h2>
      <p class="muted" style="margin:0">自上而下是原文顺序，实线是相邻两步，橙色虚线是文件里写明的分支。格子下方的橙色小条是<strong>没落地的分支臂</strong>：文件里写了这些结果，但抽取没能把它们接到任何一步。点开格子看它的行号与原文。</p>
      <h2>类型</h2>
      <div class="legend">${legend()}</div>
      <h2>待人工确认</h2>
      <div id="todos"></div>
      <div id="panel"></div>
    </aside>
  </div>
</div>
<script id="flow-data" type="application/json">${payload}</script>
<script id="flow-layout" type="application/json">${layoutPayload}</script>
<script>
${CLIENT_JS}
</script>
</body>
</html>`;
}

/**
 * The rail's reading of the same defects `audit` reports.
 *
 * There used to be two independent scoring functions: `audit` said higher is
 * worse (0 = nothing visibly broken), the artifact said higher is better
 * (100 = readable), and each had its own weights, so the same picture got two
 * numbers that could not be compared. There is now one defect vector; the rail
 * score is exactly `100 - audit score`, and the deduction list is written with
 * the same weights so the bullets add up to the number above them.
 *
 * It measures extraction hygiene, not whether the skill is well written.
 */
export function scoreOf(doc: FlowDoc): { total: number; verdict: string; reasons: string[] } {
  if (doc.nodes.length === 0) {
    return { total: 0, verdict: '没有抽到任何步骤，先看文件是不是空的。', reasons: ['0 个步骤'] };
  }

  const defects = defectsOf(doc, doc.source?.lines ?? 0);
  const reasons: string[] = [];
  if (defects.junkLabels > 0) {
    reasons.push(`${defects.junkLabels} 个步骤的标题是标点，切分点落在分隔线上，−${defects.junkLabels * 10}`);
  }
  if (defects.emptyText > 0) {
    reasons.push(`${defects.emptyText} 个步骤没有正文，多半是表格或代码块被切开了，−${defects.emptyText * 5}`);
  }
  if (defects.unresolvedBranches > 0) {
    reasons.push(`${defects.unresolvedBranches} 个分支没有落到任何一步，−${defects.unresolvedBranches * 2}`);
  }
  if (defects.lowConfidence > 0) {
    reasons.push(`${defects.lowConfidence} 个步骤的分类置信度低于 60%，−${defects.lowConfidence}`);
  }
  const densityCost = Math.round(Math.max(0, defects.density - 0.5) * 20);
  if (densityCost > 0) {
    reasons.push(`每行切出 ${defects.density.toFixed(2)} 个节点，切得太碎，−${densityCost}`);
  }

  const score = Math.max(0, 100 - Math.round(defects.score));
  const verdict =
    score >= 90 ? '抽取没有明显缺陷，可以照着读。'
    : score >= 70 ? '大体可读，个别格子在右侧待确认清单里。'
    : score >= 45 ? '能看出骨架，但有几处需要人工校正。'
    : '这张图还不该被当成流程来读，先修抽取。';

  return { total: score, verdict, reasons };
}

function legend(): string {
  const color: Record<NodeType, string> = {
    stage: 'var(--stage)', decision: 'var(--decision)', gate: 'var(--gate)',
    artifact: 'var(--artifact)', external: 'var(--external)',
  };
  return (Object.keys(color) as NodeType[])
    .map((t) => `<span><i style="background:${color[t]}"></i>${labelOf(t)}</span>`)
    .join('');
}

function labelOf(type: NodeType): string {
  switch (type) {
    case 'stage':
      return '阶段';
    case 'decision':
      return '判定';
    case 'gate':
      return '门禁';
    case 'artifact':
      return '产物';
    case 'external':
      return '外部调用';
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CLIENT_JS = String.raw`
const doc = JSON.parse(document.getElementById('flow-data').textContent);
const layout = JSON.parse(document.getElementById('flow-layout').textContent);
const LABEL = {stage:'阶段',decision:'判定',gate:'门禁',artifact:'产物',external:'外部调用'};
/* The type reaches the SVG as a CSS variable so all colour lives in :root. */
const TYPE_VAR = {stage:'--stage',decision:'--decision',gate:'--gate',artifact:'--artifact',external:'--external'};

function svgEl(name, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const k in (attrs || {})) node.setAttribute(k, String(attrs[k]));
  return node;
}
function svgText(x, y, str, attrs) {
  const t = svgEl('text', Object.assign({ x:x, y:y, 'font-size':12 }, attrs || {}));
  t.textContent = str;
  return t;
}
function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const svg = svgEl('svg', { width: layout.width, height: layout.height, viewBox: '0 0 ' + layout.width + ' ' + layout.height, role: 'img', 'aria-label': doc.skill + ' 的流程' });

/**
 * Step numbers live in the left gutter, one per band.
 *
 * They are what makes a 19-step pipeline followable: without a number the eye
 * has no anchor for "which one am I on", and a screenshot cannot be cited.
 */
for (const band of (layout.bands || [])) {
  svg.appendChild(svgEl('line', { class: 'steprule', x1: 26, y1: band.y - 7, x2: layout.width - 26, y2: band.y - 7 }));
  svg.appendChild(svgText(26, band.y + 4, String(band.index + 1).padStart(2, '0'), { class: 'stepnum' }));
}

/**
 * A connection is a rule with an arrowhead, not a curve: the cards are plates
 * on paper, and a spec sheet draws a dependency as a line.
 */
const defs = svgEl('defs');
[['arrow', '--rule-ink'], ['arrow-hot', '--accent']].forEach(function (pair) {
  const marker = svgEl('marker', { id: pair[0], viewBox:'0 0 8 8', refX:7, refY:4, markerWidth:6, markerHeight:6, orient:'auto-start-reverse' });
  marker.appendChild(svgEl('path', { d:'M 0 0 L 8 4 L 0 8 z', style: 'fill: var(' + pair[1] + ')' }));
  defs.appendChild(marker);
});
svg.appendChild(defs);

for (const e of layout.edges) {
  const isBranch = e.kind === 'branch';
  const path = svgEl('path', { d: e.d, class: 'edge' + (isBranch ? ' branch' : ''), 'marker-end': 'url(#' + (isBranch ? 'arrow-hot' : 'arrow') + ')' });
  svg.appendChild(path);
  if (isBranch && e.showLabel && e.when) {
    svg.appendChild(svgText(e.labelX, e.labelY, clip(e.when, 22), { class:'edge-label', 'text-anchor':'middle' }));
  }
}

for (const n of layout.nodes) {
  const tint = 'fill: var(' + (TYPE_VAR[n.type] || '--stage') + ')';
  const cardH = n.cardH || n.h;
  const g = svgEl('g', { class:'node', 'data-id': n.id, transform: 'translate(' + n.x + ',' + n.y + ')' });

  // The plate: paper-white card, 1px ink rule, and a 3px rule on the top edge
  // carrying the node's type. Fill is not the signal — the type is.
  g.appendChild(svgEl('rect', { class:'card', width:n.w, height:cardH, fill:'var(--plate)', stroke:'var(--rule-ink)', 'stroke-width':1 }));
  g.appendChild(svgEl('rect', { width:n.w, height:3, style: tint }));

  g.appendChild(svgText(12, 17, LABEL[n.type], { 'font-size':10.5, 'letter-spacing':'.02em', style: tint }));

  (n.lines || [clip(n.label, 40)]).forEach(function (line, i) {
    g.appendChild(svgText(12, 34 + i * 19, line, { 'font-size':13, style: 'fill: var(--rule-ink)' }));
  });

  // A table's rows sit under its header. Without them the card is a title with
  // the rule inside a tooltip, which is how "八项必填" became invisible.
  const rowTop = 34 + (n.lines || []).length * 19 + 4;
  (n.rows || []).forEach(function (row, i) {
    g.appendChild(svgText(12, rowTop + i * 15, row, { 'font-size':11, style: 'fill: var(--ink-2)' }));
  });

  const foot = 'L' + n.anchor.start + '–' + n.anchor.end + ' · ' + Math.round(n.confidence * 100) + '%';
  g.appendChild(svgText(12, cardH - 10, foot, { 'font-size':10.5, style: 'fill: var(--muted); font-family: var(--font-mono)' }));

  const openBranches = n.branches.filter(function (b) { return !b.to; }).length;
  if (openBranches) {
    g.appendChild(svgText(n.w - 12, 17, String(openBranches), {
      'font-size':11, 'text-anchor':'end', style: 'fill: var(--accent); font-family: var(--font-mono)',
    }));
  }
  if (n.confidence < 0.6) {
    g.appendChild(svgEl('circle', { cx: n.w - 13, cy: cardH - 14, r: 3.2, 'data-role': 'low-confidence', style: 'fill: var(--accent)' }));
  }

  // An open arm is a fork whose target the extractor could not name. It stays
  // attached to the card and is marked with a dashed stub, so "this step has
  // three outcomes" is visible even when none of the three lands anywhere.
  let armX = 6;
  (n.arms || []).forEach(function (arm) {
    g.appendChild(svgEl('rect', { class:'arm', x:armX, y:cardH + 6, width:arm.w, height:18, fill:'var(--accent-soft)', stroke:'var(--accent)', 'stroke-width':1 }));
    g.appendChild(svgText(armX + arm.w / 2, cardH + 19, arm.label, { 'font-size':11, 'text-anchor':'middle', style: 'fill: var(--accent-2)' }));
    armX += arm.w + 8;
  });
  if ((n.arms || []).length) {
    g.appendChild(svgText(n.w - 12, cardH + 19, '未落地 ' + n.arms.length, { 'font-size':10.5, 'text-anchor':'end', style: 'fill: var(--accent); font-family: var(--font-mono)' }));
  }

  g.addEventListener('click', function () { select(n, g); });
  svg.appendChild(g);
}
document.getElementById('canvas').appendChild(svg);
renderTodos();

function renderTodos() {
  const open = doc.nodes.filter(function (n) { return n.branches.some(function (b) { return !b.to; }) || n.confidence < 0.6; });
  if (!open.length) {
    document.getElementById('todos').innerHTML = '<p class="tag ok">全部已确认</p>';
    return;
  }
  document.getElementById('todos').innerHTML =
    '<p class="muted" style="margin:0 0 8px">' + open.length + ' 个格子需要人工确认。在 <code>annot.sidecar.json</code> 里补一条即可固化。</p>' +
    open.map(function (n) {
      const why = n.branches.filter(function (b) { return !b.to; }).map(function (b) { return b.when; }).join(' / ');
      return '<div style="margin:0 0 6px"><code>' + escapeHtml(n.id) + '</code> ' +
        '<span class="tag warn">' + (why ? escapeHtml(clip(why, 34)) : '置信度 ' + Math.round(n.confidence * 100) + '%') + '</span></div>';
    }).join('');
}

function select(n, g) {
  const selected = svg.querySelectorAll('.node.sel');
  for (let i = 0; i < selected.length; i++) selected[i].classList.remove('sel');
  g.classList.add('sel');

  const flags = n.flags.map(function (f) {
    return '<span class="tag ' + (f === 'stale' || f === 'broken' ? 'warn' : '') + '">' + f + '</span>';
  }).join(' ');

  const branches = n.branches.length
    ? n.branches.map(function (b) {
        return '<li><code>' + escapeHtml(b.when) + '</code>' +
          (b.to ? ' → <code>' + escapeHtml(b.to) + '</code>' : ' <span class="tag warn">未落地</span>') + '</li>';
      }).join('')
    : '<li class="muted">无</li>';

  document.getElementById('panel').innerHTML =
    '<h2>第 ' + (n.band + 1) + ' 步</h2>' +
    '<dl class="kv">' +
      '<dt>id</dt><dd><code>' + escapeHtml(n.id) + '</code></dd>' +
      '<dt>类型</dt><dd>' + LABEL[n.type] + '</dd>' +
      '<dt>置信度</dt><dd>' + Math.round(n.confidence * 100) + '%（' + escapeHtml(n.source) + '）</dd>' +
      '<dt>原文</dt><dd><code>' + escapeHtml(doc.source.file) + ':' + n.anchor.start + '–' + n.anchor.end + '</code></dd>' +
      '<dt>行哈希</dt><dd><code>' + escapeHtml(n.anchor.sha.slice(0, 12)) + '</code></dd>' +
      '<dt>小节</dt><dd>' + escapeHtml((n.anchor.heading || []).join(' › ') || '(前言)') + '</dd>' +
      '<dt>生成于</dt><dd><code>' + escapeHtml(doc.source.generated_at) + '</code></dd>' +
      '<dt>来源哈希</dt><dd><code>' + escapeHtml(doc.source.sha.slice(0, 10)) + '</code></dd>' +
      (flags ? '<dt>标记</dt><dd>' + flags + '</dd>' : '') +
    '</dl>' +
    '<h2>分支</h2><ul class="plain">' + branches + '</ul>' +
    '<h2>这一段原文</h2><pre class="body">' + escapeHtml(n.raw) + '</pre>';
}

const firstGroup = layout.nodes.length ? svg.querySelector('.node') : null;
if (firstGroup) select(layout.nodes[0], firstGroup);
`;
