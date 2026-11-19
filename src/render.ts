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
import type { FlowDoc, FlowEdge, FlowNode, Lane, NodeType } from './types.ts';

const NODE_W = 360;
/** Height of one wrapped label line at 13px. */
const LINE_H = 19;
/** Padding above the first label line. */
const PAD_TOP = 34;
/** Footer that carries the line range and the confidence. */
const FOOT_H = 26;
/** One visible table row inside a card. */
const ROW_H = 15;
/** One subtitle line: smaller than a label line, so the two read as two ranks. */
const SUB_H = 17;
/**
 * The canvas width the page is designed for.
 *
 * At a 1440 viewport the graph pane is 981px; this is the widest canvas that
 * still fits it without a horizontal scrollbar once the gutter and padding are
 * taken out. NODE_W is the floor: below it a card is too narrow to read.
 */
const MIN_CANVAS = 900;
/** A card wider than this stops being a card and starts being a paragraph. */
const NODE_W_MAX = 620;
/** Room for the open arms drawn under a forking card. */
const ARM_H = 26;
const SIBLING_GAP = 28;
const BAND_GAP = 34;
const PAD = 40;
/** Space between the three columns of the column layout. */
const COLUMN_GAP = 26;
/** The strip above the first row that names the columns and says what they hold. */
const COLUMN_HEADER_H = 46;
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
  /** Which column the card is drawn in; the stack layout puts every card in `core`. */
  col: 'core' | 'side' | 'artifact';
  /** The label already broken into lines, so layout and paint cannot disagree. */
  lines: string[];
  /** The subtitle, wrapped to one line or elided. */
  subLines: string[];
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
  /**
   * The columns that actually carry a card, in drawing order.
   *
   * Empty for the single-column layout. The header row names all three; this is
   * what the rails and the phase rectangles are drawn from, so an empty column
   * never gets a rail it cannot fill.
   */
  columns: Array<{ key: 'core' | 'side' | 'artifact'; label: string; x: number; w: number }>;
  /** All three column headers, with whether each one carries a card. */
  columnHeaders: Array<{
    key: 'core' | 'side' | 'artifact';
    label: string;
    /** One line saying what belongs in this column, so the lanes need no legend. */
    note: string;
    x: number;
    w: number;
    used: boolean;
    count: number;
  }>;
  /**
   * Runs of consecutive bands that share a declared phase — or, failing that,
   * the nearest heading that covers at least two cards.
   *
   * `release-checklist` writes `Phase 1：分支对比` / `Phase 2` / `Phase 3` and the
   * picture showed none of it, because depth came only from sequence edges. The
   * same mechanism names the other chapters: ten named groups reading down the
   * page instead of thirty-four anonymous rows.
   */
  phaseRuns: Array<{ label: string; y: number; h: number; nodes: number; strong: boolean }>;
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
function tableRows(raw: string, max = 6, width = NODE_W): string[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const data = lines.filter((l) => !/^\|?[\s:|-]+\|?$/.test(l));
  const out: string[] = [];
  for (const line of data.slice(1, max + 1)) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/[*`]/g, ''));
    if (cells.length === 0) continue;
    const first = cells[0] ?? '';
    const rest = cells.slice(1).filter(Boolean).join(' · ');
    const label = rest ? `${first}  ${rest}` : first;
    if (label.trim() !== '') out.push(clipToWidth(label, width - 40, 11));
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
function layoutArms(guards: string[], cardW = NODE_W): Array<{ label: string; w: number }> {
  const kept = guards.slice(0, 4);
  if (kept.length === 0) return [];
  const gap = 8;
  const box = (cardW - gap * (kept.length - 1)) / kept.length;
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
 * Which of the three columns a node is drawn in.
 *
 * The sketch groups the five types into three lanes because that is what the
 * reader is actually asking: "what do I do, what decides or calls out, and what
 * comes out". A gate and an external call share a column on purpose — both are
 * things that happen *beside* the main step, not steps in the chain.
 */
function columnOf(type: NodeType): 'core' | 'side' | 'artifact' {
  if (type === 'artifact') return 'artifact';
  if (type === 'gate' || type === 'external') return 'side';
  return 'core';
}

/** One core step and everything the source attaches to it. */
interface Row {
  /** The step itself; absent only for cards that precede the first step. */
  core?: FlowNode;
  /** Gate / external cards, in source order. */
  side: FlowNode[];
  /** Artifact cards, in source order. */
  artifacts: FlowNode[];
  /** Index of the phase run this row belongs to. */
  band: number;
}

/**
 * One row per core step, with its side cards attached.
 *
 * The row is found by walking source order and remembering the last core card,
 * NOT by picking the nearest core card by line number. Nearest-by-line was
 * measured first: on `release-checklist` it produced an edge from row 25 to row
 * 1. "The last core card above me in the document" produced zero backwards
 * edges on all four real skills, and every edge lands either on its own row
 * (core → its gate) or the next one (core → next core).
 */
function rowsOf(doc: FlowDoc): Row[] {
  const rows: Row[] = [];
  let current: Row | undefined;
  for (const node of doc.nodes) {
    const column = columnOf(node.type);
    if (column === 'core') {
      // Every core step opens a row, even when a side card has already opened
      // one: the core card is the row's spine and is never displaced.
      current = { core: node, side: [], artifacts: [], band: 0 };
      rows.push(current);
      continue;
    }
    if (!current) {
      // Side cards before the first step still need a row of their own; dropping
      // them would silently lose a card the page promises to draw.
      current = { core: undefined, side: [], artifacts: [], band: 0 };
      rows.push(current);
    }
    if (column === 'side') current.side.push(node);
    else current.artifacts.push(node);
  }
  return rows;
}

/** The card's own height, from its text — shared by both layouts. */
function cardGeometry(node: FlowNode, width: number) {
  const lines = wrapLabel(node.label, width - 28);
  // A second line the author already separated: the artifact, the expectation,
  // the target. Without it the card is one truncated sentence and the command
  // underneath stays invisible.
  const subLines = node.subtitle ? wrapLabel(node.subtitle, width - 28, 1) : [];
  // A table is a rule, not a title: show its rows so the card carries the
  // requirement instead of hiding it behind the header. Rows are clipped to the
  // card they are drawn in — a row measured against the old 360px width
  // overflows every 165px side card.
  const rows = isTable(node.raw) ? tableRows(node.raw, 6, width) : [];
  const arms = layoutArms(node.branches.filter((b) => !b.to).map((b) => b.when), width);
  const cardH = PAD_TOP + lines.length * LINE_H + subLines.length * SUB_H + rows.length * ROW_H + FOOT_H;
  return { lines, subLines, rows, arms, cardH, h: cardH + (arms.length ? ARM_H : 0) };
}

/**
 * The three columns, as absolute x positions.
 *
 * They are absolute rather than per-row so the main path is one straight
 * vertical trunk: a column that walks left and right at every band boundary is
 * unreadable no matter how correct each card is.
 */
const COLUMN = {
  core: { x: PAD + GUTTER, w: 420, label: '核心流程', note: '你要按顺序做的事' },
  side: { x: PAD + GUTTER + 420 + COLUMN_GAP, w: 170, label: '门禁 · 外部调用', note: '这一步靠什么判断 / 调用谁' },
  artifact: { x: PAD + GUTTER + 420 + COLUMN_GAP + 170 + COLUMN_GAP, w: 170, label: '产物', note: '这一步交出什么' },
} as const;

const COLUMN_CANVAS = COLUMN.artifact.x + COLUMN.artifact.w + PAD;

/**
 * Depth runs downward, siblings run sideways — now with side cards beside the
 * step they belong to.
 *
 * The previous layout gave every node its own band, so a 34-node skill was 34
 * anonymous rows and a gate sat between two steps it had nothing to do with.
 * Here the main path is one row per core step and the gates, external calls and
 * artifacts sit on the same row, in their own column: the picture says "this
 * step is checked by this gate", which is what the source says.
 *
 * A document with no side cards keeps the old single-column layout: three
 * columns would leave two thirds of the canvas empty for nothing.
 */
export function layoutNodes(doc: FlowDoc): Layout {
  const hasSide = doc.nodes.some((n) => columnOf(n.type) !== 'core');
  return hasSide ? layoutColumns(doc) : layoutStack(doc);
}

function layoutColumns(doc: FlowDoc): Layout {
  const rows = rowsOf(doc);

  const placed: Placed[] = [];
  const bands_: Layout['bands'] = [];
  const bandSpans = new Map<number, { y: number; h: number }>();
  let cursorY = PAD + COLUMN_HEADER_H;

  rows.forEach((row, index) => {
    const cells: Array<{ node: FlowNode; column: keyof typeof COLUMN }> = [];
    if (row.core) cells.push({ node: row.core, column: 'core' });
    for (const node of row.side) cells.push({ node, column: 'side' });
    for (const node of row.artifacts) cells.push({ node, column: 'artifact' });

    // A row is as tall as its tallest cell; a second card in the same column
    // stacks under the first, so those two heights add instead of max.
    const columnHeights = new Map<string, number>();
    const geometries = new Map<string, ReturnType<typeof cardGeometry>>();
    for (const cell of cells) {
      const geo = cardGeometry(cell.node, COLUMN[cell.column].w);
      geometries.set(cell.node.id, geo);
      const stacked = columnHeights.get(cell.column) ?? 0;
      columnHeights.set(cell.column, stacked + geo.h + (stacked > 0 ? SIBLING_GAP : 0));
    }
    const rowH = Math.max(64, ...columnHeights.values());

    // Each column stacks downward from the same top edge, so two cards in the
    // same row never overlap and a lone card is never centred against a stack.
    const offsets = new Map<string, number>();
    for (const [column, height] of columnHeights) {
      offsets.set(column, (rowH - height) / 2);
    }
    for (const cell of cells) {
      const geo = geometries.get(cell.node.id);
      if (!geo) continue;
      const offset = offsets.get(cell.column) ?? 0;
      offsets.set(cell.column, offset + geo.h + SIBLING_GAP);
      placed.push({
        ...cell.node,
        ...geo,
        band: index,
        slot: 0,
        col: cell.column,
        x: COLUMN[cell.column].x,
        y: cursorY + offset,
        w: COLUMN[cell.column].w,
      });
    }

    bands_.push({ index, y: cursorY, count: cells.length });
    bandSpans.set(index, { y: cursorY, h: rowH });
    cursorY += rowH + BAND_GAP;
  });

  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges: PlacedEdge[] = [];
  for (const edge of doc.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b || a === b) continue;
    const isBranch = edge.kind === 'branch';
    const route = routeBetween(a, b);
    edges.push({ ...edge, d: route.d, labelX: route.labelX, labelY: route.labelY, showLabel: isBranch });
  }

  // Only the columns that carry a card are drawn: an empty rail is a promise the
  // document does not keep. The header row still names all three, so the reader
  // knows what the other lanes would have held.
  const used = new Set(placed.map((p) => p.col));
  const columns = (Object.keys(COLUMN) as Array<keyof typeof COLUMN>)
    .filter((key) => used.has(key))
    .map((key) => ({ key, label: COLUMN[key].label, x: COLUMN[key].x, w: COLUMN[key].w }));

  return {
    width: COLUMN_CANVAS,
    height: Math.max(PAD + COLUMN_HEADER_H, cursorY - BAND_GAP + PAD),
    nodes: placed,
    edges,
    bands: bands_,
    columns,
    columnHeaders: (Object.keys(COLUMN) as Array<keyof typeof COLUMN>).map((key) => ({
      key,
      label: COLUMN[key].label,
      note: COLUMN[key].note,
      x: COLUMN[key].x,
      w: COLUMN[key].w,
      used: used.has(key),
      count: placed.filter((p) => p.col === key).length,
    })),
    phaseRuns: phaseRuns(placed, bandSpans),
  };
}

/**
 * Two plates in a column layout: down, right, or round the corner.
 *
 * Every edge the extractor produces lands on its own row or the next one (see
 * `rowsOf`), so four shapes cover all of them. A destination above the source
 * would need a connector travelling up the page, so it is drawn as a plain
 * drop and flagged in the geometry rather than looping around the canvas.
 */
function routeBetween(a: Placed, b: Placed): { d: string; labelX: number; labelY: number } {
  const sameColumn = a.col === b.col;
  const below = b.y >= a.y + a.h - 1;
  const midY = below ? a.y + a.h + (b.y - (a.y + a.h)) / 2 : a.y + a.h / 2;

  if (sameColumn) {
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    return { d: `M ${x1} ${y1} L ${x2} ${y2}`, labelX: x1, labelY: (y1 + y2) / 2 };
  }

  const aRight = a.x < b.x;
  const x1 = aRight ? a.x + a.w : a.x;
  const x2 = aRight ? b.x : b.x + b.w;

  // Same row: a straight horizontal rule between the two plates, which is what
  // "this step is checked by that gate" should look like.
  if (!below && !(b.y + b.h <= a.y)) {
    const y = Math.max(a.y, b.y) + Math.min(a.h, b.h) / 2;
    return { d: `M ${x1} ${y} L ${x2} ${y}`, labelX: (x1 + x2) / 2, labelY: y - 6 };
  }

  // Different rows: leave the bottom of the source, turn once in the gap, enter
  // the destination from its top.
  const y1 = a.y + a.h;
  const y2 = b.y;
  const xm = x1 + (x2 - x1) / 2;
  void midY;
  return {
    d: `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
    labelX: (x1 + x2) / 2,
    labelY: midY - 6,
  };
}

/**
 * The old one-row-per-node layout, kept for documents with no side cards.
 *
 * Depth runs downward, siblings run sideways. The column-major grid it replaced
 * cut a 19-step pipeline into columns of seven, so reading order went down then
 * back to the top, through arrows that pointed backwards.
 */
function layoutStack(doc: FlowDoc): Layout {
  const depth = depthOfDoc(doc);

  const bands = new Map<number, FlowNode[]>();
  for (const node of doc.nodes) {
    const band = depth.get(node.id) ?? 0;
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band)?.push(node);
  }

  const ordered = [...bands.keys()].sort((a, b) => a - b);
  const widestCount = Math.max(1, ...ordered.map((b) => bands.get(b)?.length ?? 0));
  const strip = (count: number, cardW: number): number =>
    count * cardW + Math.max(0, count - 1) * SIBLING_GAP;

  // The canvas never gets narrower than one comfortable card, and it uses the
  // width it is given: at 1440 the pane is 981px and a 528px graph left 454px
  // empty at every scroll position. The extra room goes to the card, not to
  // padding — a wider card wraps a long label into fewer lines.
  const width = Math.max(strip(widestCount, NODE_W) + PAD * 2 + GUTTER, MIN_CANVAS);
  const cardW = Math.min(
    NODE_W_MAX,
    Math.max(NODE_W, Math.floor((width - PAD * 2 - GUTTER - (widestCount - 1) * SIBLING_GAP) / widestCount)),
  );
  const widestCardWidth = strip(widestCount, cardW);

  const placed: Placed[] = [];
  const bands_: Layout['bands'] = [];
  /** The vertical extent of each band, so a phase run can bracket its members. */
  const bandSpans = new Map<number, { y: number; h: number }>();
  let cursorY = PAD;

  for (const band of ordered) {
    const members = [...(bands.get(band) ?? [])].sort((a, b) => a.anchor.start - b.anchor.start);
    const bandW = strip(members.length, cardW);
    const geometries = members.map((node) => cardGeometry(node, cardW));
    const bandH = Math.max(...geometries.map((g) => g.h));
    const left = PAD + GUTTER + (widestCardWidth - bandW) / 2;
    bands_.push({ index: band, y: cursorY, count: members.length });
    bandSpans.set(band, { y: cursorY, h: bandH });

    geometries.forEach((geometry, slot) => {
      placed.push({
        ...members[slot],
        ...geometry,
        band,
        slot,
        col: columnOf(members[slot].type),
        x: left + slot * (cardW + SIBLING_GAP),
        y: cursorY + (bandH - geometry.h) / 2,
        w: cardW,
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
    const route = routeBetween(a, b);
    edges.push({ ...edge, d: route.d, labelX: route.labelX, labelY: route.labelY, showLabel: edge.kind === 'branch' });
  }

  return {
    width,
    height: Math.max(PAD, cursorY - BAND_GAP + PAD),
    nodes: placed,
    edges,
    bands: bands_,
    columns: [],
    columnHeaders: [],
    phaseRuns: phaseRuns(placed, bandSpans),
  };
}

/**
 * The chapter bands, as rectangles over the bands they actually cover.
 *
 * Only *consecutive* bands join a run: `release-checklist` puts its phase
 * headings in source order, so Phase 1 / 2 / 3 land in three contiguous runs.
 * A label that reappears after another one produces two runs rather than one
 * rectangle swallowing what sits between them.
 *
 * A run holding a single card is dropped. Measured on four real skills, 44 of
 * 88 heading runs were singletons, and bracketing those produced more borders
 * than structure.
 */
/**
 * The chapter bands, as rectangles over the bands they actually cover.
 *
 * Only *consecutive* bands join a run: `release-checklist` puts its phase
 * headings in source order, so Phase 1 / 2 / 3 land in three contiguous runs.
 * A label that reappears after another one produces two runs rather than one
 * rectangle swallowing what sits between them.
 *
 * A run holding a single card is dropped. Measured on four real skills, 44 of
 * 88 heading runs were singletons, and bracketing those produced more borders
 * than structure.
 */
function phaseRuns(
  placed: Placed[],
  spans: Map<number, { y: number; h: number }>,
): Layout['phaseRuns'] {
  const runs: Layout['phaseRuns'] = [];
  const bandsSorted = [...spans.keys()].sort((a, b) => a - b);
  const labelOfBand = new Map<number, { label: string; strong: boolean }>();
  const shared = sharedHeadings(placed);

  // A declared phase wins over a mere heading: the author said "this is a stage".
  for (const node of placed) {
    const label = node.phase ?? nearestHeading(node, shared);
    if (!label) continue;
    const current = labelOfBand.get(node.band);
    const strong = Boolean(node.phase);
    if (!current || (strong && !current.strong)) labelOfBand.set(node.band, { label, strong });
  }

  let current: { label: string; strong: boolean; first: number; last: number; nodes: number } | undefined;
  const flush = (): void => {
    if (!current) return;
    if (current.nodes >= 2) {
      const top = spans.get(current.first);
      const bottom = spans.get(current.last);
      if (top && bottom) {
        runs.push({
          label: current.label,
          y: top.y - 10,
          h: bottom.y + bottom.h - top.y + 20,
          nodes: current.nodes,
          strong: current.strong,
        });
      }
    }
    current = undefined;
  };

  for (const band of bandsSorted) {
    const members = placed.filter((p) => p.band === band);
    const named = labelOfBand.get(band);
    if (!named) {
      flush();
      continue;
    }
    if (current && current.label === named.label) {
      current.last = band;
      current.nodes += members.length;
      continue;
    }
    flush();
    current = { label: named.label, strong: named.strong, first: band, last: band, nodes: members.length };
  }
  flush();
  return runs;
}

/**
 * Heading paths that cover at least two cards.
 *
 * `release-checklist` has fifteen heading levels over thirty-four cards; the
 * deepest one often holds exactly one card, which brackets nothing. Walking up
 * until the group is shared is what turns fifteen labels into ten bands.
 */
function sharedHeadings(placed: Placed[]): Set<string> {
  const counts = new Map<string, number>();
  for (const node of placed) {
    const path = node.anchor.heading ?? [];
    for (let i = path.length; i > 0; i--) {
      const key = path.slice(0, i).join(' › ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const shared = new Set<string>();
  for (const [key, count] of counts) if (count >= 2) shared.add(key);
  return shared;
}

function nearestHeading(node: FlowNode, shared: Set<string>): string | undefined {
  const path = node.anchor.heading ?? [];
  for (let i = path.length; i > 0; i--) {
    if (!shared.has(path.slice(0, i).join(' › '))) continue;
    const label = path[i - 1].trim();
    if (label) return label;
  }
  return undefined;
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
    --phase-soft: #efece2; --phase-rule: #c9c2b2;
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
  #stage { min-width: 0; }
  /* The tool strip: find, zoom, and the trace readout. It is chrome, so it is
     hairline-thin and sits above the canvas instead of floating over the graph —
     an overlay would hide the top row of cards exactly where a reader starts. */
  #tools {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 8px 32px; border-bottom: 1px solid var(--rule); background: var(--plate);
    position: sticky; top: 0; z-index: 2;
  }
  #tools label { font-size: 11.5px; color: var(--muted); }
  #tools input[type="search"] {
    font-family: var(--font-body); font-size: 12.5px; color: var(--ink);
    background: var(--paper); border: 1px solid var(--rule); padding: 3px 8px; width: 180px;
  }
  #tools input[type="search"]:focus { border-color: var(--rule-ink); outline: none; }
  #tools button {
    font-family: var(--font-mono); font-size: 12px; color: var(--ink-2);
    background: var(--paper); border: 1px solid var(--rule); padding: 3px 9px; cursor: pointer;
    min-width: 30px;
  }
  #tools button:hover { border-color: var(--rule-ink); }
  #tools button:disabled { color: var(--rule); cursor: default; border-color: var(--rule); }
  #tools .count { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  #trace { font-size: 11.5px; color: var(--muted); margin-left: auto; font-variant-numeric: tabular-nums; }
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
  /* The lane key is words, not swatches: a lane is a role, and a role has no
     colour. Two keys on the page, because type and lane answer two questions. */
  .legend.lanes { display: grid; gap: 4px; }
  .legend.lanes span { white-space: normal; color: var(--muted); }
  .legend.lanes strong { color: var(--ink-2); font-weight: 500; margin-right: 4px; }

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
  /* Tracing: while one card is under the pointer, the cards on its path stay at
     full ink and everything else drops to a wash. Opacity, not colour: the type
     ink is the card's meaning and must not change while reading. */
  svg.tracing .node:not(.hot) { opacity: .28; }
  svg.tracing .node.hot rect.card { stroke-width: 2; }
  svg.tracing .edge:not(.hot) { opacity: .18; }
  svg.tracing .edge.hot { stroke-width: 2; stroke-dasharray: none; }
  /* A search hit keeps the accent rule, so it is legible through the wash a
     trace puts on the rest of the page. */
  .node.hit rect.card { stroke: var(--accent); stroke-width: 1.5; }
  .node.sel-hit rect.card { stroke-width: 3; }
  .edge { fill: none; stroke: var(--rule-ink); stroke-width: 1.2; }
  .edge.branch { stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 4 3; }
  .edge-label { fill: var(--accent-2); font-family: var(--font-body); font-size: 10.5px; paint-order: stroke; stroke: var(--paper); stroke-width: 3px; stroke-linejoin: round; }
  .stepnum { fill: var(--muted); font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
  .steprule { stroke: var(--rule); stroke-width: 1; }
  /* A column rail is a hairline, not a border: the columns are a reading aid and
     must not compete with the phase rectangles that carry real structure. */
  .rail { stroke: var(--rule); stroke-width: 1; stroke-dasharray: 2 5; }
  .rail-head { stroke: var(--rule-ink); stroke-width: 1; }
  .column-label { fill: var(--ink); font-family: var(--font-body); font-weight: 500; letter-spacing: .02em; }
  .column-label.unused { fill: var(--muted); font-weight: 400; }
  .column-note { fill: var(--muted); font-family: var(--font-body); }
  .column-note.unused { fill: var(--rule); }
  /* A phase band is the structure the author declared, drawn behind the cards.
     It carries no type ink: the type is the card's business, the phase is the
     page's. A label sits at the band's top-left, on the band itself. */
  rect.phase { fill: var(--phase-soft); stroke: var(--phase-rule); stroke-width: 1; }
  rect.phase.weak { fill: none; stroke-dasharray: 3 4; }
  .phase-label { fill: var(--ink-2); font-family: var(--font-body); font-size: 11px; letter-spacing: .02em; }
  .phase-label.weak { fill: var(--muted); }
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
    <div id="stage">
      <div id="tools">
        <label for="find">查找</label>
        <input id="find" type="search" placeholder="标签 / id / 行号" autocomplete="off" spellcheck="false" />
        <span class="count" id="hits"></span>
        <button id="zoom-out" type="button" title="缩小（-）" aria-label="缩小">−</button>
        <button id="zoom-reset" type="button" title="回到 100%（0）">100%</button>
        <button id="zoom-in" type="button" title="放大（+）" aria-label="放大">+</button>
        <span id="trace">悬停一格看它的上下游</span>
      </div>
      <div id="canvas"></div>
    </div>
    <aside id="detail">
      <h2>评估</h2>
      <div class="score"><b>${scored.total}</b><span>/ 100 抽取可读度</span></div>
      <p class="why">${scored.verdict}</p>
      <p class="muted" style="margin:8px 0 0">这个数只反映抽取有没有明显缺陷（未落地分支、低置信、空正文、切得太碎），<strong>不评价 skill 本身写得好不好</strong>。与 <code>annot audit</code> 同一组权重：审计分 = 100 − 本分。</p>
      ${scored.reasons.length ? `<div class="why"><ul>${scored.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      <h2>形状</h2>
      ${shapeHtml}
      <h2>怎么读</h2>
      <p class="muted" style="margin:0">左列是<strong>你要按顺序做的事</strong>，同一行的右两列是这一步<strong>靠什么判断</strong>、<strong>交出什么</strong>。一条竖线只连相邻两步，橙色虚线是文件里写明的分支。灰色底带是文件里<strong>自己声明的阶段</strong>（<code>Phase 1</code> / <code>阶段二</code> 这类小节）；虚线框是普通章节，只在它至少罩住两格时才画。每条带右上角的数字是它含的格子数。格子右下角写着<strong>谁做这件事</strong>。点开格子看它的行号与原文。</p>
      <h2>类型</h2>
      <div class="legend">${legend()}</div>
      <h2>谁做</h2>
      <div class="legend lanes">${laneKey()}</div>
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

/**
 * The lane key.
 *
 * Type and lane are different questions — "what kind of thing is this" versus
 * "who does it" — so the page needs two keys, not a merged one. The lane has no
 * colour of its own: it is a word in the card's corner, not a second palette.
 */
function laneKey(): string {
  const lanes: Array<[Lane, string]> = [
    ['reader', '你'], ['tool', '工具'], ['model', '模型'], ['output', '产物'],
  ];
  return lanes
    .map(([lane, word]) => `<span><strong>${word}</strong> ${laneNote(lane)}</span>`)
    .join('');
}

function laneNote(lane: Lane): string {
  switch (lane) {
    case 'reader':
      return '读者自己做';
    case 'tool':
      return '命令 / 接口执行';
    case 'model':
      return '模型自行判断';
    case 'output':
      return '产出的文件或数据';
  }
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
const LANE = {reader:'你（读者）', tool:'工具/命令', model:'模型', output:'产物'};
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
/* The same CJK-aware estimate the layout uses, so a footer clipped here cannot
   disagree with the card width the server measured. */
function textWidthIn(text, fontPx) {
  let width = 0;
  for (const char of String(text)) {
    const code = char.codePointAt(0) || 0;
    const wide = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef);
    width += wide ? fontPx : fontPx * 0.56;
  }
  return width;
}
function clipToWidth(text, maxPx, fontPx) {
  if (textWidthIn(text, fontPx) <= maxPx) return text;
  let out = '';
  for (const char of String(text)) {
    if (textWidthIn(out + char + '…', fontPx) > maxPx) break;
    out += char;
  }
  return out + '…';
}
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const svg = svgEl('svg', { width: layout.width, height: layout.height, viewBox: '0 0 ' + layout.width + ' ' + layout.height, role: 'img', 'aria-label': doc.skill + ' 的流程' });

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

/* The chapter bands sit *behind* everything: they group cards without hiding a
   connector. A band is a wash, so the step rules and edges stay legible on top
   of it; only the label is painted last, so it is never crossed out by a line. */
for (const run of (layout.phaseRuns || [])) {
  const weak = run.strong ? '' : ' weak';
  svg.appendChild(svgEl('rect', { class: 'phase' + weak, x: 20, y: run.y, width: layout.width - 40, height: run.h }));
}

/* The column rails come before the rules so a hairline never cuts through a
   header. An empty column draws no rail: a lane that holds nothing is a promise
   the document does not keep, and the header still names it. */
for (const column of (layout.columns || [])) {
  svg.appendChild(svgEl('line', { class: 'rail', x1: column.x + column.w + 13, y1: 34, x2: column.x + column.w + 13, y2: layout.height - 26 }));
}
if ((layout.columnHeaders || []).length) {
  svg.appendChild(svgEl('line', { class: 'rail-head', x1: 26, y1: 30, x2: layout.width - 26, y2: 30 }));
  for (const head of layout.columnHeaders) {
    // The header carries its own count: "门禁 · 外部调用 6" answers "is this lane
    // part of the flow or just a category I invented" without a legend.
    svg.appendChild(svgText(head.x, 20, head.label + '  ' + head.count, {
      class: 'column-label' + (head.used ? '' : ' unused'),
      'font-size': 11.5,
    }));
    svg.appendChild(svgText(head.x, 36, head.used ? head.note : '本文件没有这一类', {
      class: 'column-note' + (head.used ? '' : ' unused'),
      'font-size': 10.5,
    }));
  }
}

for (const band of (layout.bands || [])) {
  svg.appendChild(svgEl('line', { class: 'steprule', x1: 26, y1: band.y - 7, x2: layout.width - 26, y2: band.y - 7 }));
  svg.appendChild(svgText(26, band.y + 4, String(band.index + 1).padStart(2, '0'), { class: 'stepnum' }));
}

for (const e of layout.edges) {
  const isBranch = e.kind === 'branch';
  const path = svgEl('path', { d: e.d, class: 'edge' + (isBranch ? ' branch' : ''), 'data-from': e.from, 'data-to': e.to, 'marker-end': 'url(#' + (isBranch ? 'arrow-hot' : 'arrow') + ')' });
  svg.appendChild(path);
  if (isBranch && e.showLabel && e.when) {
    svg.appendChild(svgText(e.labelX, e.labelY, clip(e.when, 22), { class:'edge-label', 'text-anchor':'middle' }));
  }
}

for (const run of (layout.phaseRuns || [])) {
  const weak = run.strong ? '' : ' weak';
  // Right-aligned, because the left gutter already carries the step numbers: a
  // label at x=30 sits on top of "01".
  svg.appendChild(svgText(layout.width - 30, run.y + 15, run.label + ' · ' + run.nodes, {
    class: 'phase-label' + weak,
    'text-anchor': 'end',
  }));
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

  // The second line the author already separated: the expectation, the target,
  // the artifact. It is smaller and lighter than the label so the two ranks
  // read as title-then-detail rather than two competing sentences.
  const subTop = 34 + (n.lines || []).length * 19 + 1;
  (n.subLines || []).forEach(function (line, i) {
    g.appendChild(svgText(12, subTop + i * 17, line, { 'font-size':11.5, style: 'fill: var(--ink-2)' }));
  });

  // A table's rows sit under its header. Without them the card is a title with
  // the rule inside a tooltip, which is how "八项必填" became invisible.
  const rowTop = subTop + (n.subLines || []).length * 17 - 1;
  (n.rows || []).forEach(function (row, i) {
    g.appendChild(svgText(12, rowTop + i * 15, row, { 'font-size':11, style: 'fill: var(--ink-2)' }));
  });

  // The card footer carries the anchor and the rule. In a 165px side card the
  // full "L24–26 · 55% · code-with-calls" is 173px wide and splits the box, so
  // the footer is clipped to the card it is drawn in.
  const foot = 'L' + n.anchor.start + '–' + n.anchor.end + ' · ' + Math.round(n.confidence * 100) + '%' +
    (n.rule ? ' · ' + n.rule : '');
  g.appendChild(svgText(12, cardH - 10, clipToWidth(foot, n.w - 24, 10.5), { 'font-size':10.5, style: 'fill: var(--muted); font-family: var(--font-mono)' }));

  // The lane answers "who does this", the type answers "what kind of thing is
  // it". Two ranks in the same row: type left, lane right.
  if (n.lane) {
    g.appendChild(svgText(n.w - 12, 17, LANE[n.lane] || n.lane, {
      'font-size':10.5, 'text-anchor':'end', style: 'fill: var(--muted); letter-spacing:.02em',
    }));
  }

  const openBranches = n.branches.filter(function (b) { return !b.to; }).length;
  if (openBranches) {
    g.appendChild(svgText(n.w - 12, cardH - 10, openBranches + ' 未落地', {
      'font-size':10.5, 'text-anchor':'end', style: 'fill: var(--accent); font-family: var(--font-mono)',
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
  g.addEventListener('mouseenter', function () { trace(n.id); });
  g.addEventListener('mouseleave', function () { trace(null); });
  g.setAttribute('tabindex', '0');
  g.setAttribute('role', 'button');
  g.addEventListener('focus', function () { trace(n.id); });
  g.addEventListener('blur', function () { trace(null); });
  svg.appendChild(g);
}
document.getElementById('canvas').appendChild(svg);
renderTodos();

/* ---- Tracing: what does this card come from, and what does it lead to? ----
   The graph is 34 cards tall, so a reader who finds step 19 has no way to know
   which two gates belong to it. Hovering keeps the card and its immediate
   neighbours at full ink and washes out everything else.

   Immediate neighbours, not the transitive closure: the main path is one chain,
   so "everything downstream of step 1" is the other thirty-three cards, which
   is the same as no highlight at all. Measured on release-checklist, the closure
   from its first row is 33 of 34 — the direct set is 4. */
const OUT = new Map();
const IN = new Map();
for (const e of layout.edges) {
  if (!OUT.has(e.from)) OUT.set(e.from, []);
  if (!IN.has(e.to)) IN.set(e.to, []);
  OUT.get(e.from).push(e.to);
  IN.get(e.to).push(e.from);
}

function trace(id) {
  for (const g of svg.querySelectorAll('.node.hot, .node.dim')) g.classList.remove('hot', 'dim');
  for (const edge of svg.querySelectorAll('.edge.hot')) edge.classList.remove('hot');
  const readout = document.getElementById('trace');

  if (!id) {
    svg.classList.remove('tracing');
    readout.textContent = '悬停一格看它的上下游';
    return;
  }

  const directUp = IN.get(id) || [];
  const directDown = OUT.get(id) || [];
  const hot = new Set([id, ...directUp, ...directDown]);
  svg.classList.add('tracing');
  for (const g of svg.querySelectorAll('.node')) {
    g.classList.add(hot.has(g.getAttribute('data-id')) ? 'hot' : 'dim');
  }
  for (const edge of svg.querySelectorAll('.edge')) {
    if (hot.has(edge.getAttribute('data-from')) && hot.has(edge.getAttribute('data-to'))) edge.classList.add('hot');
  }

  const node = layout.nodes.find(function (n) { return n.id === id; });
  const label = function (nid) {
    const found = layout.nodes.find(function (n) { return n.id === nid; });
    return found ? clipToWidth(found.label, 96, 11) : nid;
  };
  const parts = [];
  if (directUp.length) parts.push('从「' + directUp.map(label).join('」「') + '」来');
  if (directDown.length) parts.push('到「' + directDown.map(label).join('」「') + '」');
  readout.textContent = (node ? 'L' + node.anchor.start + '–' + node.anchor.end + ' · ' : '') + (parts.join(' · ') || '此格不与任何格子相连');
}

/* ---- Zoom: the canvas reports its own size, so scaling the element is the
   whole change; the pane keeps its scroll position around the pointer. ---- */
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.25, 1.5, 2];
let zoom = 3;

function applyZoom(next, anchor) {
  zoom = Math.max(0, Math.min(ZOOMS.length - 1, next));
  const scale = ZOOMS[zoom];
  const pane = document.getElementById('canvas');
  const before = anchor || { x: pane.clientWidth / 2, y: pane.clientHeight / 2 };
  const graphX = (pane.scrollLeft + before.x) / (svg.getAttribute('width') / layout.width || 1);
  const graphY = (pane.scrollTop + before.y) / (svg.getAttribute('height') / layout.height || 1);

  svg.setAttribute('width', Math.round(layout.width * scale));
  svg.setAttribute('height', Math.round(layout.height * scale));
  pane.scrollLeft = graphX * scale - before.x;
  pane.scrollTop = graphY * scale - before.y;

  document.getElementById('zoom-reset').textContent = Math.round(scale * 100) + '%';
  document.getElementById('zoom-in').disabled = zoom === ZOOMS.length - 1;
  document.getElementById('zoom-out').disabled = zoom === 0;
}

document.getElementById('zoom-in').addEventListener('click', function () { applyZoom(zoom + 1); });
document.getElementById('zoom-out').addEventListener('click', function () { applyZoom(zoom - 1); });
document.getElementById('zoom-reset').addEventListener('click', function () {
  const pane = document.getElementById('canvas');
  applyZoom(3);
  pane.scrollTop = 0;
});
/* Ctrl+wheel zooms at the pointer; a plain wheel still scrolls the page, which
   is what a reader expects when a diagram is 4 screens tall. */
document.getElementById('canvas').addEventListener('wheel', function (event) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const box = svg.getBoundingClientRect();
  applyZoom(zoom + (event.deltaY < 0 ? 1 : -1), {
    x: event.clientX - box.left,
    y: event.clientY - box.top,
  });
}, { passive: false });

document.addEventListener('keydown', function (event) {
  if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); applyZoom(zoom + 1); }
  else if (event.key === '-') { event.preventDefault(); applyZoom(zoom - 1); }
  else if (event.key === '0') { event.preventDefault(); applyZoom(3); }
  else if (event.key === '/') { event.preventDefault(); document.getElementById('find').focus(); }
});

/* ---- Find: 34 cards is past what a reader will scan, so the label, the id and
   the line number all have to be searchable, and Enter walks the hits. ---- */
const find = document.getElementById('find');
const hits = document.getElementById('hits');
let matched = [];
let matchAt = -1;

function search() {
  const term = find.value.trim().toLowerCase();
  for (const g of svg.querySelectorAll('.node.hit')) g.classList.remove('hit');
  matched = [];
  matchAt = -1;
  if (!term) {
    hits.textContent = '';
    return;
  }
  for (const g of svg.querySelectorAll('.node')) {
    const id = g.getAttribute('data-id');
    const node = layout.nodes.find(function (n) { return n.id === id; });
    if (!node) continue;
    const haystack = (node.label + ' ' + node.id + ' ' + (node.subtitle || '') + ' ' + node.anchor.start + ' ' + node.anchor.end + ' ' + (node.phase || '')).toLowerCase();
    if (haystack.indexOf(term) !== -1) {
      g.classList.add('hit');
      matched.push(g);
    }
  }
  hits.textContent = matched.length ? matched.length + ' 处' : '没有匹配';
  if (matched.length) jump(0);
}

function jump(index) {
  if (!matched.length) return;
  matchAt = (index + matched.length) % matched.length;
  if (matchAt === 0) for (const g of matched) g.classList.remove('sel-hit');
  matched[matchAt].classList.add('sel-hit');
  const node = layout.nodes.find(function (n) { return n.id === matched[matchAt].getAttribute('data-id'); });
  const pane = document.getElementById('canvas');
  if (node) {
    const scale = svg.getAttribute('height') / layout.height || 1;
    pane.scrollTop = node.y * scale - pane.clientHeight / 2;
    pane.scrollLeft = 0;
  }
  hits.textContent = matched.length + ' 处 · 第 ' + (matchAt + 1) + ' 个';
}

find.addEventListener('input', search);
find.addEventListener('keydown', function (event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    jump(matchAt + (event.shiftKey ? -1 : 1));
  } else if (event.key === 'Escape') {
    find.value = '';
    search();
    find.blur();
  }
});

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
      '<dt>谁做</dt><dd>' + (LANE[n.lane] || n.lane) + '</dd>' +
      '<dt>规则</dt><dd><code>' + escapeHtml(n.rule || '(none)') + '</code> · 常数 ' + Math.round(n.confidence * 100) + '%</dd>' +
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
