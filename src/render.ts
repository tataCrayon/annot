/**
 * One self-contained HTML file, no network, no framework: the artifact has to
 * survive being emailed, opened from a USB stick, and read in a browser with
 * no server behind it.
 *
 * Layout is a deterministic column-major grid rather than a layered DAG: real
 * skills are mostly one long pipeline, and a layered DAG turns that into a
 * 26-column strip nobody can read. Two runs of the same skill always produce
 * the same picture, so screenshots are comparable.
 */

import type { FlowDoc, FlowNode, NodeType } from './types.ts';

const COLORS: Record<NodeType, { fill: string; stroke: string; text: string }> = {
  stage: { fill: '#eef2ff', stroke: '#6366f1', text: '#1e1b4b' },
  decision: { fill: '#fff7ed', stroke: '#f97316', text: '#431407' },
  gate: { fill: '#fef2f2', stroke: '#dc2626', text: '#450a0a' },
  artifact: { fill: '#ecfdf5', stroke: '#059669', text: '#022c22' },
  external: { fill: '#f0f9ff', stroke: '#0284c7', text: '#082f49' },
};

const NODE_W = 244;
const NODE_H = 62;
const COL_GAP = 78;
const ROW_GAP = 26;
const PAD = 34;

interface Placed extends FlowNode {
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
  row: number;
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

interface Layout {
  width: number;
  height: number;
  nodes: Placed[];
  edges: PlacedEdge[];
}

export function layoutNodes(doc: FlowDoc): Layout {
  const total = doc.nodes.length;
  const rowsPerColumn = Math.max(3, Math.min(7, Math.ceil(total / Math.max(1, Math.ceil(total / 7)))));
  const placed: Placed[] = doc.nodes.map((node, i) => {
    const col = Math.floor(i / rowsPerColumn);
    const row = i % rowsPerColumn;
    return {
      ...node,
      col,
      row,
      x: PAD + col * (NODE_W + COL_GAP),
      y: PAD + row * (NODE_H + ROW_GAP),
      w: NODE_W,
      h: NODE_H,
    };
  });

  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges: PlacedEdge[] = [];

  for (const edge of doc.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;

    const sequentialVertical = edge.kind === 'sequence' && a.col === b.col && b.row === a.row + 1;
    if (sequentialVertical) {
      const x = a.x + a.w / 2;
      edges.push({
        ...edge,
        d: `M ${x} ${a.y + a.h} L ${x} ${b.y}`,
        labelX: x,
        labelY: (a.y + a.h + b.y) / 2,
        showLabel: false,
      });
      continue;
    }

    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    edges.push({
      ...edge,
      d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: (y1 + y2) / 2 - 7,
      showLabel: edge.kind === 'branch',
    });
  }

  const cols = Math.max(1, Math.ceil(total / rowsPerColumn));
  return {
    width: PAD * 2 + cols * NODE_W + (cols - 1) * COL_GAP,
    height: PAD * 2 + Math.min(total, rowsPerColumn) * (NODE_H + ROW_GAP) - ROW_GAP,
    nodes: placed,
    edges,
  };
}

export function renderHtml(doc: FlowDoc, options: { title?: string } = {}): string {
  const layout = layoutNodes(doc);
  const title = options.title ?? `${doc.skill} · annot`;
  const payload = safeJson(doc);
  const layoutPayload = safeJson(layout);
  const unresolved = doc.nodes.reduce((n, node) => n + node.branches.filter((b) => !b.to).length, 0);
  const toConfirm = doc.stats.lowConfidence;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; color:var(--ink); background:var(--bg); }
  header { display:flex; gap:14px; align-items:baseline; flex-wrap:wrap; padding:14px 22px; background:#fff; border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0; font-weight:650; letter-spacing:-0.01em; }
  .pill { font-size:11.5px; padding:2px 9px; border-radius:999px; border:1px solid var(--line); color:var(--muted); background:#fff; white-space:nowrap; }
  .pill b { color:var(--ink); font-weight:650; }
  .pill.warn { border-color:#fcd34d; background:#fffbeb; color:#92400e; }
  main { display:grid; grid-template-columns: minmax(0,1fr) 384px; height:calc(100vh - 60px); }
  #canvas { overflow:auto; background: radial-gradient(circle at 1px 1px,#dbe2ea 1px,transparent 0) 0 0/22px 22px, var(--bg); }
  #detail { border-left:1px solid var(--line); background:#fff; overflow:auto; padding:16px 20px 40px; }
  svg { display:block; }
  .node { cursor:pointer; }
  .node rect { transition: filter .12s ease, stroke-width .12s ease; }
  .node:hover rect.card { filter: drop-shadow(0 2px 8px rgba(15,23,42,.16)); stroke-width:2.4; }
  .node.sel rect.card { stroke-width:3; filter: drop-shadow(0 3px 10px rgba(15,23,42,.22)); }
  .node text { pointer-events:none; }
  .edge { fill:none; stroke:#cbd5e1; stroke-width:1.7; }
  .edge.branch { stroke:#f97316; stroke-width:1.6; stroke-dasharray:5 4; }
  .edge-label { fill:#c2410c; font-size:10px; paint-order:stroke; stroke:#fff; stroke-width:3px; stroke-linejoin:round; }
  h2 { font-size:11.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin:18px 0 7px; font-weight:650; }
  h2:first-child { margin-top:0; }
  .kv { display:grid; grid-template-columns: 74px 1fr; gap:5px 10px; font-size:12.5px; margin:0 0 4px; }
  .kv dt { color:var(--muted); }
  .kv dd { margin:0; word-break:break-word; }
  pre.body { white-space:pre-wrap; background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:10px; font:11.5px/1.55 ui-monospace,Consolas,monospace; max-height:260px; overflow:auto; margin:0; }
  code { font-family: ui-monospace,Consolas,monospace; font-size:11.5px; }
  ul { margin:0; padding-left:18px; font-size:12.5px; }
  li { margin:2px 0; }
  .empty, .muted { color:var(--muted); font-size:12.5px; }
  .tag { display:inline-block; font-size:11px; padding:1px 8px; border-radius:999px; background:#f1f5f9; color:#475569; margin:0 4px 4px 0; border:1px solid transparent; }
  .tag.warn { background:#fef3c7; color:#92400e; }
  .tag.bad { background:#fee2e2; color:#991b1b; }
  .tag.ok { background:#ecfdf5; color:#065f46; }
</style>
</head>
<body>
<header>
  <h1>${esc(doc.skill)}</h1>
  <span class="pill"><b>${doc.nodes.length}</b> 节点</span>
  <span class="pill"><b>${doc.edges.length}</b> 边</span>
  <span class="pill ${unresolved ? 'warn' : ''}"><b>${unresolved}</b> 分支未绑定</span>
  <span class="pill ${toConfirm ? 'warn' : ''}"><b>${toConfirm}</b> 待确认</span>
  <span class="pill">${esc(doc.source.file)} · ${doc.source.lines} 行 · <b>${esc(doc.source.sha.slice(0, 10))}</b></span>
</header>
<main>
  <div id="canvas"></div>
  <aside id="detail">
    <h2>图例</h2>
    <div>${legend()}</div>
    <h2>怎么读</h2>
    <p class="muted" style="margin:0">每个方块是 SKILL.md 里一段连续的原文，角标 <code>L12–18</code> 是它的锚点。点击方块查看原文、分支与置信度。<br/>
    实线 = 文中顺序；橙色虚线 = 作者写明的分支（<code>→</code>、<code>✅/❌</code>、<code>守住 / 改良 / 替换</code>）。</p>
    <h2>待处理</h2>
    <div id="todos"></div>
    <div id="panel"></div>
  </aside>
</main>
<script id="flow-data" type="application/json">${payload}</script>
<script id="flow-layout" type="application/json">${layoutPayload}</script>
<script>
${CLIENT_JS}
</script>
</body>
</html>`;
}

function legend(): string {
  return (Object.keys(COLORS) as NodeType[]).map((t) => `<span class="tag" style="background:${COLORS[t].fill};color:${COLORS[t].text};border-color:${COLORS[t].stroke}">${labelOf(t)}</span>`).join('');
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
const COLORS = {
  stage:{fill:'#eef2ff',stroke:'#6366f1',text:'#1e1b4b'},
  decision:{fill:'#fff7ed',stroke:'#f97316',text:'#431407'},
  gate:{fill:'#fef2f2',stroke:'#dc2626',text:'#450a0a'},
  artifact:{fill:'#ecfdf5',stroke:'#059669',text:'#022c22'},
  external:{fill:'#f0f9ff',stroke:'#0284c7',text:'#082f49'}
};
const LABEL = {stage:'阶段',decision:'判定',gate:'门禁',artifact:'产物',external:'外部调用'};

function svgEl(name, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const k in (attrs || {})) node.setAttribute(k, String(attrs[k]));
  return node;
}
function svgText(x, y, str, attrs) {
  const t = svgEl('text', Object.assign({ x:x, y:y, 'font-size':12, fill:'#0f172a' }, attrs || {}));
  t.textContent = str;
  return t;
}
function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/**
 * A label is drawn at 12.5px in a 244px card. A CJK glyph is about one em wide
 * and a Latin glyph about half, so clipping by character count alone either
 * wastes half the card on Chinese text or overflows it on English. Budget by
 * estimated width instead, and let the full text live in the detail panel.
 */
function fitLabel(s, maxPx) {
  var width = 0;
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    var w = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef) ? 12.5 : 7;
    if (width + w > maxPx - 20) return out + '…';
    width += w;
    out += s[i];
  }
  return out;
}
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const svg = svgEl('svg', { width: layout.width, height: layout.height, viewBox: '0 0 ' + layout.width + ' ' + layout.height });
const defs = svgEl('defs');
[[ 'arrow', '#cbd5e1' ], [ 'arrow-hot', '#f97316' ]].forEach(function (pair) {
  const marker = svgEl('marker', { id: pair[0], viewBox:'0 0 10 10', refX:9, refY:5, markerWidth:7, markerHeight:7, orient:'auto-start-reverse' });
  marker.appendChild(svgEl('path', { d:'M 0 0 L 10 5 L 0 10 z', fill: pair[1] }));
  defs.appendChild(marker);
});
svg.appendChild(defs);

for (const e of layout.edges) {
  const isBranch = e.kind === 'branch';
  svg.appendChild(svgEl('path', {
    d: e.d,
    class: 'edge' + (isBranch ? ' branch' : ''),
    'marker-end': 'url(#' + (isBranch ? 'arrow-hot' : 'arrow') + ')'
  }));
  if (isBranch && e.showLabel && e.when) {
    svg.appendChild(svgText(e.labelX, e.labelY, clip(e.when, 20), { class:'edge-label', 'text-anchor':'middle' }));
  }
}

for (const n of layout.nodes) {
  const c = COLORS[n.type] || COLORS.stage;
  const g = svgEl('g', { class:'node', 'data-id': n.id, transform: 'translate(' + n.x + ',' + n.y + ')' });
  g.appendChild(svgEl('rect', { class:'card', width:n.w, height:n.h, rx:10, fill:c.fill, stroke:c.stroke, 'stroke-width':1.6 }));

  const tag = svgText(11, 15, LABEL[n.type], { 'font-size':9.5, fill:c.stroke, 'font-weight':700, 'letter-spacing':'.04em' });
  g.appendChild(tag);
  g.appendChild(svgText(11, 33, fitLabel(n.label, n.w), { 'font-size':12.5, 'font-weight':600, fill:c.text }));
  g.appendChild(svgText(11, 50, 'L' + n.anchor.start + '–' + n.anchor.end + ' · ' + Math.round(n.confidence * 100) + '%', { 'font-size':9.5, fill:'#64748b' }));

  const openBranches = n.branches.filter(function (b) { return !b.to; }).length;
  if (openBranches) {
    g.appendChild(svgEl('circle', { cx: n.w - 44, cy: 12, r: 8.5, fill:'#fef3c7', stroke:'#f59e0b', 'stroke-width':1.2 }));
    g.appendChild(svgText(n.w - 44, 15.5, String(openBranches), { 'font-size':9.5, fill:'#92400e', 'text-anchor':'middle', 'font-weight':700 }));
  }
  if (n.flags.indexOf('low-confidence') >= 0) {
    g.appendChild(svgEl('circle', { cx: n.w - 14, cy: 12, r: 3.6, fill:'#f59e0b' }));
  }
  g.addEventListener('click', function () { select(n, g); });
  svg.appendChild(g);
}
document.getElementById('canvas').appendChild(svg);
renderTodos();

function renderTodos() {
  const open = doc.nodes.filter(function (n) { return n.branches.some(function (b) { return !b.to; }) || n.flags.indexOf('low-confidence') >= 0; });
  if (!open.length) {
    document.getElementById('todos').innerHTML = '<p class="tag ok">全部已确认</p>';
    return;
  }
  document.getElementById('todos').innerHTML =
    '<p class="muted" style="margin:0 0 6px">' + open.length + ' 个节点需要人工确认。在 <code>annot.sidecar.json</code> 里补一条即可固化。</p>' +
    open.map(function (n) {
      const why = n.branches.filter(function (b) { return !b.to; }).map(function (b) { return b.when; }).join(' / ');
      return '<div style="margin:0 0 6px"><code>' + escapeHtml(n.id) + '</code> ' +
        '<span class="tag warn">' + (why ? '分支：' + escapeHtml(clip(why, 34)) : '低置信度') + '</span></div>';
    }).join('');
}

function select(n, g) {
  const selected = svg.querySelectorAll('.node.sel');
  for (let i = 0; i < selected.length; i++) selected[i].classList.remove('sel');
  g.classList.add('sel');

  const flags = n.flags.map(function (f) {
    return '<span class="tag ' + (f === 'stale' || f === 'broken' ? 'bad' : 'warn') + '">' + f + '</span>';
  }).join('');

  const branches = n.branches.length
    ? n.branches.map(function (b) {
        return '<li><code>' + escapeHtml(b.when) + '</code>' +
          (b.to ? ' → <code>' + escapeHtml(b.to) + '</code>' : ' <span class="tag warn">未绑定</span>') + '</li>';
      }).join('')
    : '<li class="muted">无</li>';

  document.getElementById('panel').innerHTML =
    '<h2>节点</h2>' +
    '<dl class="kv">' +
      '<dt>id</dt><dd><code>' + escapeHtml(n.id) + '</code></dd>' +
      '<dt>类型</dt><dd>' + LABEL[n.type] + '</dd>' +
      '<dt>置信度</dt><dd>' + Math.round(n.confidence * 100) + '%（' + escapeHtml(n.source) + '）</dd>' +
      '<dt>锚点</dt><dd><code>' + escapeHtml(doc.source.file) + ':' + n.anchor.start + '–' + n.anchor.end + '</code></dd>' +
      '<dt>行哈希</dt><dd><code>' + escapeHtml(n.anchor.sha.slice(0, 12)) + '</code></dd>' +
      '<dt>小节</dt><dd>' + escapeHtml((n.anchor.heading || []).join(' › ') || '(前言)') + '</dd>' +
      (flags ? '<dt>标记</dt><dd>' + flags + '</dd>' : '') +
    '</dl>' +
    '<h2>分支</h2><ul>' + branches + '</ul>' +
    '<h2>原文</h2><pre class="body">' + escapeHtml(n.raw) + '</pre>';
}

const firstGroup = layout.nodes.length ? svg.querySelector('.node') : null;
if (firstGroup) select(layout.nodes[0], firstGroup);
`;
