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
const LINE_H = 21;
/** Padding above the first label line. */
const PAD_TOP = 42;
/** Footer that carries the line range and the confidence. */
const FOOT_H = 32;
/** One visible table row inside a card. */
const ROW_H = 17;
/** One subtitle line: smaller than a label line, so the two read as two ranks. */
const SUB_H = 19;
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
const ARM_H = 28;
const SIBLING_GAP = 28;
const BAND_GAP = 34;
const PAD = 40;
/** Space between the three columns of the column layout. */
const COLUMN_GAP = 64;
/** Minimum paper visible between an orthogonal connector and a card. */
const ROUTE_CLEARANCE = 14;
/** Card and phase band corner radii; geometry stays unchanged. */
const CARD_RADIUS = 16;
/** Breathing room between card text and its visible frame. */
const CARD_PAD_X = 16;
const CARD_TYPE_BASELINE = 22;
const CARD_LABEL_TOP = 42;
const PHASE_RADIUS = 12;
/** The phase label gets its own strip above the cards, never their first line. */
const PHASE_LABEL_GAP = 28;
/**
 * Paper below the last card of a phase run.
 *
 * The band has to stop before the next one starts: it is drawn from
 * `top.y - PHASE_LABEL_GAP` to `bottom.y + bottom.h + PHASE_BOTTOM_PAD`, and
 * consecutive bands are only `BAND_GAP` apart. At 12 the two rectangles
 * overlapped by 6px (12 + 28 − 34), which showed as two tinted washes crossing
 * at every chapter boundary. 4 leaves a 2px seam.
 */
const PHASE_BOTTOM_PAD = 4;
/**
 * The strip above the first row that names the columns and says what they hold.
 *
 * Title, note and rule still need three separate baselines — but not 100px of
 * paper. A two-line legend reads in one glance; the third line was only air,
 * and in the workbench it pushed the first card below the fold.
 */
const COLUMN_HEADER_H = 74;
const COLUMN_HEADER_TITLE_Y = 20;
const COLUMN_HEADER_NOTE_Y = 40;
const COLUMN_HEADER_RULE_Y = 56;
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
  col: StructuralColumn;
  /**
   * `attached` for a note drawn against the card it explains, `global` for a
   * Skill-wide note, `loose` for an unbound one, `null` for executable cards.
   */
  home: NoteHome | null;
  /** For an attached note: the id of the card it explains. */
  explains?: string;
  /** For an attached note: the relation, so the card can name it. */
  relation?: string;
  /**
   * How far the painted plate is pushed in from the left edge of this box.
   *
   * A note's box is as wide as the card it hangs under, because that is the
   * column; only its plate steps in, which is what makes it read as a remark
   * rather than a peer. Keeping `x`/`w` on the column means every card in a
   * column still starts at one x, and overlap checks stay simple.
   */
  inset?: number;
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

interface PlacedAssociation {
  from: string;
  to: string;
  relation: 'supports' | 'constrains' | 'informs' | 'explains-output';
  evidence: 'explicit-reference' | 'same-section' | 'nearest-structural';
  confidence: number;
  d: string;
  labelX: number;
  labelY: number;
}

export interface Layout {
  width: number;
  height: number;
  nodes: Placed[];
  edges: PlacedEdge[];
  associations: PlacedAssociation[];
  /** One entry per depth band, for the numbered rules the page draws. */
  bands: Array<{ index: number; y: number; count: number }>;
  /** The columns that actually carry a card, in compressed drawing order. */
  columns: Array<{ key: StructuralColumn; label: string; x: number; w: number }>;
  /** Headers for the columns that actually carry a card. */
  columnHeaders: Array<{
    key: StructuralColumn;
    label: string;
    /** One line saying what belongs in this column, so the lanes need no legend. */
    note: string;
    x: number;
    w: number;
    used: boolean;
    count: number;
  }>;
  /**
   * Horizontal bands inside the action column, one per `lane`. Empty unless at
   * least two lanes carry a card, so a one-lane document keeps its old canvas.
   */
  laneRuns: Array<{
    lane: Lane;
    label: string;
    x: number;
    w: number;
    y: number;
    h: number;
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
    if (label.trim() !== '') out.push(clipToWidth(label, width - CARD_PAD_X * 2, 11));
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
 * Depth of every node from its longest dependency path.
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
 * The sketch groups the six types into three lanes because that is what the
 * reader is actually asking: "what action do I take, what constrains or explains
 * it, and what comes out". Only action-backed stages enter the main chain; a
 * gate, decision, external call or note is context beside that action.
 */
/**
 * Every type has exactly one column, and the mapping never degrades.
 *
 * There used to be a fallback: a gate or decision that shared a row with no
 * step was drawn in the action column "because there is nothing to sit beside".
 * On a Skill that opens with rules (account-research starts with 19 gates), that
 * put 22 cards in a lane whose header said "关键动作 2" and pushed the 45 real
 * context cards off to the right of an empty row. A lane that says what it holds
 * has to hold exactly that; the only exception is a document with no actions at
 * all, where the context lane *is* the reading surface (see `columnLayout`).
 */
function columnOf(node: FlowNode): StructuralColumn {
  if (node.type === 'artifact') return 'artifact';
  if (node.type === 'stage') return 'core';
  // A command belongs to whoever runs it. An `external` or `gate` card whose
  // lane is `tool` is a command, and drawing it in the context column hid the
  // one thing the reader has to know about it. `output` stays with the results.
  if (node.lane === 'tool' && node.type !== 'note') return 'core';
  return 'side';
}

/** Where a note card belongs, given what the association pass decided about it. */
function noteHomeOf(node: FlowNode, targetId: string | undefined): NoteHome {
  if (node.associationScope === 'skill') return 'global';
  if (!targetId) return 'loose';
  return 'attached';
}

/**
 * Which structural column a card is drawn in.
 *
 * `scope` is not part of the flow: it is the rail that holds notes applying to
 * the whole Skill (or to nothing the extractor could verify), kept separate so
 * they never stand where an executable step stands.
 */
type StructuralColumn = 'core' | 'side' | 'artifact' | 'scope';

/**
 * What a note card is — not where it is drawn.
 *
 * Notes used to be a third lane ("判断 · 门禁 · 调用 · 说明"), which made a
 * 27-note skill look like 27 rules: every explanation got the same weight as a
 * gate. A note explains exactly one thing, so it is drawn against the card it
 * explains. The one exception is a note the reviewer marked as applying to the
 * whole Skill; that has no single neighbour and gets its own rail.
 */
type NoteHome = 'attached' | 'global' | 'loose';

interface StructuralRow {
  core?: FlowNode;
  /** Decision / gate / external cards, in source order. */
  side: FlowNode[];
  artifacts: FlowNode[];
  band: number;
}

/** A note and the card it hangs under, if it has one. */
interface RowNote {
  node: FlowNode;
  /** The card the note explains; absent for a global or unbound note. */
  targetId?: string;
  /** The owner's structural column, used when the owner is not in this row. */
  col: StructuralColumn;
}

/** One key action and everything the source attaches to it. */
interface Row extends StructuralRow {
  /** Notes filed into this row; each carries the column of its owner. */
  notes: RowNote[];
}

/**
 * One row per core step, with its side cards and the notes that explain them.
 *
 * The row is found by walking source order and remembering the last core card,
 * NOT by picking the nearest core card by line number. Nearest-by-line was
 * measured first: on `release-checklist` it produced an edge from row 25 to row
 * 1. "The last core card above me in the document" produced zero backwards
 * edges on all four real skills, and every edge lands either on its own row
 * (core → its gate) or the next one (core → next core).
 *
 * A note is filed into the row of the card it explains, which is the whole
 * point: the pair is drawn on one row, in one column, so "this gate comes with
 * that rule" is visible instead of something the reader has to trace. Filing it
 * into the owner's row — rather than opening a row that repeats the owner —
 * also keeps every card drawn exactly once; a card painted twice fails
 * `annot verify`, and rightly so: two positions for one anchor is a lie.
 *
 * A note with no owner (applies to the whole Skill, or nothing it could be
 * verified against) goes to the `scope` rail instead of the context column: it
 * is not a rule beside one step, and standing it next to a gate would claim an
 * attachment the source never made.
 */
function rowsOf(doc: FlowDoc): Row[] {
  const rows: Row[] = [];
  let current: Row | undefined;
  const empty = (core?: FlowNode): Row => ({ core, side: [], artifacts: [], notes: [], band: 0 });

  // A note is placed by what it explains, so the association pass has to run
  // first — it is the only thing that knows a note's target.
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const targetOf = new Map<string, FlowNode>();
  for (const association of doc.associations ?? []) {
    const to = byId.get(association.to);
    if (to) targetOf.set(association.from, to);
  }

  const rowOf = new Map<string, Row>();
  // A note can name a card that appears later in the file (`explicit-reference`
  // allows it). Those wait until the walk is over; skipping them would silently
  // drop a card the page promises to draw.
  const deferred: Array<{ node: FlowNode; target: FlowNode }> = [];

  for (const node of doc.nodes) {
    if (node.type === 'note') {
      const target = targetOf.get(node.id);
      if (target && node.associationScope === 'node') {
        const owner = rowOf.get(target.id);
        if (!owner) {
          deferred.push({ node, target });
          continue;
        }
        owner.notes.push({ node, targetId: target.id, col: columnOf(target) });
        continue;
      }
      // Skill-wide and unbound notes have no owner. They go on the scope rail,
      // in the row where the source puts them, so the rail still reads top-down.
      if (!current) {
        current = empty();
        rows.push(current);
      }
      current.notes.push({ node, col: 'scope' });
      continue;
    }

    const column = columnOf(node);
    if (column === 'core') {
      // Every core step opens a row, even when a side card has already opened
      // one: the core card is the row's spine and is never displaced.
      current = empty(node);
      rows.push(current);
      rowOf.set(node.id, current);
      continue;
    }
    if (!current) {
      // Side cards before the first step still need a row of their own; dropping
      // them would silently lose a card the page promises to draw.
      current = empty();
      rows.push(current);
    }
    if (column === 'side') current.side.push(node);
    else current.artifacts.push(node);
    rowOf.set(node.id, current);
  }

  for (const { node, target } of deferred) {
    const owner = rowOf.get(target.id);
    if (owner) {
      owner.notes.push({ node, targetId: target.id, col: columnOf(target) });
      continue;
    }
    if (!current) {
      current = empty();
      rows.push(current);
    }
    current.notes.push({ node, col: 'scope' });
  }
  return rows;
}

/** The card's own height, from its text — shared by both layouts. */
function cardGeometry(node: FlowNode, width: number) {
  const lines = wrapLabel(node.label, width - CARD_PAD_X * 2);
  // A second line the author already separated: the artifact, the expectation,
  // the target. Without it the card is one truncated sentence and the command
  // underneath stays invisible.
  const subLines = node.subtitle ? wrapLabel(node.subtitle, width - CARD_PAD_X * 2, 1) : [];
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
 * Column definitions stay independent of x. A document often has gates and
 * artifacts but no core steps; reserving an empty core column pushed every real
 * card off the first screen. `columnLayout` assigns x from the columns the
 * document actually uses.
 *
 * `scope` is not a flow column. It is the rail for notes that apply to the whole
 * Skill (or to nothing the extractor could verify): an explanation that belongs
 * to no single step standing beside a gate would claim an attachment the source
 * never made, so it gets its own track at the far right.
 */
const COLUMN = {
  core: { w: 440, label: '关键动作', note: '按原文顺序执行、有动作证据的事' },
  side: { w: 250, label: '判断 · 门禁 · 调用', note: '约束与依据，挂在所属动作的右边' },
  artifact: { w: 220, label: '产物', note: '动作产生的结果或交付物' },
  scope: { w: 240, label: '全局 · 孤立说明', note: '不跟某一步走的说明，单独一条轨道' },
} as const;

/**
 * An attached note steps in from its owner's left edge and keeps the owner's
 * right edge, so the two plates form one block.
 *
 * A note is not a fourth kind of card. It is a comment on one card, and drawing
 * it in the owner's column, directly below that card, is what makes "this gate
 * comes with that rule" true at a glance instead of something to trace.
 */
/** How far a note's plate is pushed in from its column's left edge. */
const NOTE_INSET = 56;
/**
 * Space between a card and the notes hanging under it.
 *
 * Tighter than SIBLING_GAP, but not by much: 12px was a hairline once the graph
 * was fitted to a pane (roughly 7px on screen at 60%), and a step plus its note
 * then read as one fused block — the note's inset alone was not enough to say
 * "this is a remark on the card above". 22 keeps that step-in cue while leaving
 * a visible strip of paper between the two plates.
 */
const NOTE_GAP = 22;
/** Paper above and below the cards of one lane, so the two bands read apart. */
const LANE_PAD = 14;

type ColumnKey = keyof typeof COLUMN;

function columnLayout(used: Set<ColumnKey>, contextOnly: boolean): {
  byKey: Map<ColumnKey, { x: number; w: number }>;
  width: number;
} {
  const byKey = new Map<ColumnKey, { x: number; w: number }>();
  let x = PAD + GUTTER;
  for (const key of Object.keys(COLUMN) as ColumnKey[]) {
    if (!used.has(key)) continue;
    // A document with no key actions is mostly context. In that case the
    // context lane is the primary reading surface instead of a 210px sidebar.
    const w = contextOnly && key === 'side' ? 420 : contextOnly && key === 'artifact' ? 250 : COLUMN[key].w;
    byKey.set(key, { x, w });
    x += w + COLUMN_GAP;
  }
  const width = Math.max(x - COLUMN_GAP + PAD, PAD * 2 + GUTTER);
  return { byKey, width };
}

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
  // Branch edges used to force `layoutStack`, which lost the lanes on exactly
  // the skills that have the most context to place. What a branch changes is
  // depth, not the column map, so only a document with nothing to put beside a
  // step falls back to the stack.
  const hasSide = doc.nodes.some((n) => columnOf(n) !== 'core');
  return hasSide ? layoutColumns(doc) : layoutStack(doc);
}

interface Cell {
  node: FlowNode;
  column: ColumnKey;
  note: boolean;
  /** For an attached note: the card it hangs under. */
  targetId?: string;
}

/**
 * Where a context card is drawn when the document has no actions at all.
 *
 * A Skill that is only rules and outputs has no trunk to hang a sidebar on, so
 * the context lane becomes the reading surface: it is drawn wide, first, and the
 * note attached to it rides the same column. This is the one case where a
 * non-stage card stands in the action column, and it is decided by the whole
 * document rather than by one row, so the header and the cards cannot disagree.
 */
function fallbackContextColumn(doc: FlowDoc): 'core' | undefined {
  return doc.nodes.some((node) => node.type === 'stage') ? undefined : 'core';
}

function layoutColumns(doc: FlowDoc): Layout {
  const rows = rowsOf(doc);
  const hasActions = doc.nodes.some((node) => node.type === 'stage');
  const used = new Set<ColumnKey>();
  if (hasActions) used.add('core');
  if (rows.some((row) => row.core && row.side.length > 0)) used.add('side');
  if (!hasActions && rows.some((row) => row.side.length > 0)) used.add('core');
  if (doc.nodes.some((node) => node.type === 'artifact')) used.add('artifact');
  if (rows.some((row) => row.notes.some((note) => note.col === 'scope'))) used.add('scope');
  const contextColumn = fallbackContextColumn(doc) ?? 'side';
  const column = columnLayout(used, !hasActions);
  const incoming = new Map<string, string[]>();
  for (const edge of doc.edges) {
    const sources = incoming.get(edge.to) ?? [];
    sources.push(edge.from);
    incoming.set(edge.to, sources);
  }
  /** Why each note is here, so the card can name its relation to its owner. */
  const relationOf = new Map<string, string>();
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
  for (const association of doc.associations ?? []) {
    if (nodeById.has(association.to)) relationOf.set(association.from, association.relation);
  }

  const placed: Placed[] = [];
  const bands_: Layout['bands'] = [];
  const bandSpans = new Map<number, { y: number; h: number }>();
  let cursorY = PAD + COLUMN_HEADER_H;

  rows.forEach((row, index) => {
    const cells: Cell[] = [];
    if (row.core) cells.push({ node: row.core, column: 'core', note: false });
    // Context keeps its own column even before the first action. It used to be
    // promoted into the action column "because there is nothing to sit beside",
    // which on a Skill that opens with rules put 22 gate and note cards under a
    // header reading 关键动作 2 and left the real context lane empty beside them.
    for (const node of row.side) cells.push({ node, column: contextColumn, note: false });
    for (const node of row.artifacts) cells.push({ node, column: 'artifact', note: false });
    // Notes come after the cards they hang under. Their own source order still
    // decides which note sits first, but a note is never painted above its owner:
    // that would put the explanation before the thing it explains.
    for (const note of row.notes) {
      const column = contextColumn === 'core' && (note.col === 'side' || note.col === 'core') ? 'core' : note.col;
      cells.push({ node: note.node, column, note: true, targetId: note.targetId });
    }
    // Source order, not column order. A row is one moment in the document, and a
    // gate can depend on the artifact above it: sorting by column would put the
    // artifact under the gate and draw that dependency backwards. Notes stay
    // after their owner regardless, because placement clamps them below it.
    cells.sort((left, right) => left.node.anchor.start - right.node.anchor.start);

    const columnBottoms = new Map<string, number>();
    /** Every card placed so far, so an edge never orders a card above its source. */
    const bottoms = new Map<string, { y: number; h: number }>();
    const geometries = new Map<string, { width: number; x: number; y: number; geo: ReturnType<typeof cardGeometry> }>();
    const geometryOf = (cell: Cell, priorY: number) => {
      const columnW = column.byKey.get(cell.column)?.w ?? COLUMN[cell.column].w;
      const inset = cell.note && cell.column !== 'scope' ? NOTE_INSET : 0;
      // A note occupies the card above it minus an inset on the left: the same
      // footprint, one step in. That step is what says "this is a remark about
      // the card above, not another step".
      return {
        width: columnW,
        inset,
        x: column.byKey.get(cell.column)?.x ?? PAD + GUTTER,
        y: priorY,
        geo: cardGeometry(cell.node, Math.max(160, columnW - inset)),
      };
    };
    /** Place a card after everything already in its column and after its sources. */
    const place = (cell: Cell) => {
      const prior = columnBottoms.get(cell.column);
      const layout = geometryOf(cell, prior === undefined ? cursorY : prior + SIBLING_GAP);
      for (const sourceId of incoming.get(cell.node.id) ?? []) {
        const source = bottoms.get(sourceId);
        if (source) layout.y = Math.max(layout.y, source.y + source.h + SIBLING_GAP);
      }
      geometries.set(cell.node.id, layout);
      bottoms.set(cell.node.id, { y: layout.y, h: layout.geo.h });
      columnBottoms.set(cell.column, layout.y + layout.geo.h);
    };
    /**
     * Place a note directly under the card it explains.
     *
     * NOTE_GAP, not SIBLING_GAP: the tighter gap is the only cue that the note
     * belongs to one card rather than standing on its own. When the owner is not
     * the bottom-most card of its column the note drops to the column bottom
     * instead — it must not cover a card that comes after it in the source.
     */
    const hang = (cell: Cell) => {
      const owner = cell.targetId ? bottoms.get(cell.targetId) : undefined;
      const bottom = columnBottoms.get(cell.column);
      const under = owner ? owner.y + owner.h + NOTE_GAP : cursorY;
      const y = bottom === undefined ? under : Math.max(under, bottom + NOTE_GAP);
      const layout = geometryOf(cell, y);
      geometries.set(cell.node.id, layout);
      bottoms.set(cell.node.id, { y: layout.y, h: layout.geo.h });
      columnBottoms.set(cell.column, layout.y + layout.geo.h);
    };

    // Cards first, in source order; each note is placed the moment its owner is,
    // so the pair is adjacent by construction. A note whose owner is not in this
    // row (or has none) is placed after the cards, at the bottom of its column.
    const cards = cells.filter((cell) => !cell.note);
    const notesUnder = new Map<string, Cell[]>();
    const orphanNotes: Cell[] = [];
    for (const cell of cells) {
      if (!cell.note) continue;
      if (!cell.targetId) {
        orphanNotes.push(cell);
        continue;
      }
      const list = notesUnder.get(cell.targetId) ?? [];
      list.push(cell);
      notesUnder.set(cell.targetId, list);
    }
    for (const card of cards) {
      place(card);
      for (const note of notesUnder.get(card.node.id) ?? []) hang(note);
    }
    for (const note of orphanNotes) hang(note);
    // A note that named a card in another row would otherwise be dropped; the
    // page promises to draw every node, so it lands at the bottom of its column.
    for (const [targetId, notes] of notesUnder) {
      if (cards.some((card) => card.node.id === targetId)) continue;
      for (const note of notes) hang(note);
    }

    for (const cell of cells) {
      const layout = geometries.get(cell.node.id);
      if (!layout) continue;
      const node: Placed = {
        ...cell.node,
        ...layout.geo,
        band: index,
        slot: 0,
        col: cell.column,
        home: cell.note ? (cell.targetId ? 'attached' : noteHomeOf(cell.node, undefined)) : null,
        explains: cell.note ? cell.targetId : undefined,
        relation: cell.note ? relationOf.get(cell.node.id) : undefined,
        x: layout.x,
        y: layout.y,
        w: layout.width,
        inset: layout.inset,
      };
      placed.push(node);
    }
    const rowH = Math.max(64, ...placed.filter((node) => node.band === index).map((node) => node.y + node.h - cursorY));

    bands_.push({ index, y: cursorY, count: cells.length });
    bandSpans.set(index, { y: cursorY, h: rowH });
    cursorY += rowH + BAND_GAP;
  });

  const canvasHeight = Math.max(PAD + COLUMN_HEADER_H, cursorY - BAND_GAP + PAD);
  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges: PlacedEdge[] = [];
  for (const edge of doc.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b || a === b) continue;
    const isBranch = edge.kind === 'branch';
    const route = routeBetween(a, b, placed, layoutBounds(column.width, canvasHeight), edges.length);
    edges.push({ ...edge, d: route.d, labelX: route.labelX, labelY: route.labelY, showLabel: isBranch });
  }

  // Headers and rails follow the same compressed columns as the cards. Naming a
  // lane that holds no card makes a narrow canvas look broken and forces the
  // reader to scroll past an empty promise.
  const columns = (Object.keys(COLUMN) as ColumnKey[])
    .filter((key) => used.has(key))
    .map((key) => ({
      key,
      label: COLUMN[key].label,
      x: column.byKey.get(key)?.x ?? PAD + GUTTER,
      w: column.byKey.get(key)?.w ?? COLUMN[key].w,
    }));

  return {
    width: column.width,
    height: canvasHeight,
    nodes: placed,
    edges,
    associations: routeAssociations(doc.associations ?? [], new Map(placed.map((node) => [node.id, node])), layoutBounds(column.width, canvasHeight), edges.length),
    bands: bands_,
    columns,
    columnHeaders: (Object.keys(COLUMN) as ColumnKey[]).filter((key) => used.has(key)).map((key) => ({
      key,
      label: key === 'core' && !hasActions ? '主要上下文' : COLUMN[key].label,
      note: key === 'core' && !hasActions ? '判断、门禁、调用按原文顺序展开' : COLUMN[key].note,
      x: column.byKey.get(key)?.x ?? PAD + GUTTER,
      w: column.byKey.get(key)?.w ?? COLUMN[key].w,
      used: true,
      // The count is read off the canvas, not derived from a type rule: a header
      // that says 2 while 22 cards stand under it was the visible symptom of the
      // column fallback. Notes are counted under the card they explain, so a
      // lane of 5 gates does not read 32 because 27 rules hang beneath them.
      count: key === 'core' && !hasActions
        ? placed.filter((p) => p.col === 'core').length
        : placed.filter((p) => p.col === key && !(p.home === 'attached')).length,
    })),
    laneRuns: laneRuns(placed, column.byKey.get('core')),
    phaseRuns: phaseRuns(placed, bandSpans),
  };
}

/**
 * The action column, split into the lanes that perform the work.
 *
 * `lane` has been in the schema since the first release, described as driving
 * the swimlane, and until now it only reached the corner of a card. A release
 * checklist drew `git fetch` and "decide whether the branch is behind" at the
 * same level — the one distinction that decides whether the reader's job is to
 * type or to think.
 *
 * A card is already filed into the action column by its lane (see `columnOf`),
 * so the band only has to enclose the contiguous run of cards a lane produced.
 * One lane filling the whole column is a border around everything, which is a
 * rule that says nothing, so a single-lane document draws none.
 */
const LANE_ORDER: Lane[] = ['tool', 'model', 'reader'];
const LANE_LABEL: Record<Lane, string> = { reader: '你来做', tool: '命令 / 工具', model: '模型判断', output: '产物' };

function laneRuns(placed: Placed[], column: { x: number; w: number } | undefined): Layout['laneRuns'] {
  if (!column || placed.length === 0) return [];
  // Notes ride their owner and share its lane, so they are inside the band
  // anyway; counting them out of the label keeps "命令 / 工具 4" reading as four
  // commands rather than four commands plus their remarks.
  const inLane = placed.filter((node) => node.col === 'core' && node.type !== 'note');
  const used = LANE_ORDER.filter((lane) => inLane.some((node) => node.lane === lane));
  if (used.length < 2) return [];
  // A lane may come back after another one (a command, a judgement, another
  // command). One bounding box would then swallow the lane in between, so each
  // contiguous stretch is its own band, in drawing order.
  const ordered = [...inLane].sort((left, right) => left.y - right.y || left.x - right.x);
  const runs: Layout['laneRuns'] = [];
  for (const node of ordered) {
    const last = runs.at(-1);
    if (last && last.lane === node.lane) {
      last.h = node.y + node.h - last.y + LANE_PAD;
      last.count += 1;
      continue;
    }
    runs.push({
      lane: node.lane,
      label: LANE_LABEL[node.lane],
      x: column.x,
      w: column.w,
      y: node.y - LANE_PAD,
      h: node.h + LANE_PAD * 2,
      count: 1,
    });
  }
  return runs;
}

interface RoutePoint { x: number; y: number }
interface RouteBounds { left: number; right: number; top: number; bottom: number }
interface RoutedEdge { d: string; labelX: number; labelY: number }

function layoutBounds(width: number, height: number): RouteBounds {
  return { left: PAD / 2, right: width - PAD / 2, top: PAD / 2, bottom: height - PAD / 2 };
}

/**
 * The preferred route follows the reading direction: down the trunk, across a
 * row, or one turn in the band gap. Collision handling is separate so ordinary
 * edges stay short and straight.
 */
function preferredRoute(a: Placed, b: Placed): RoutePoint[] {
  if (a.col === b.col) {
    return [
      { x: a.x + a.w / 2, y: a.y + a.h },
      { x: b.x + b.w / 2, y: b.y },
    ];
  }

  const right = a.x < b.x;
  const x1 = right ? a.x + a.w : a.x;
  const x2 = right ? b.x : b.x + b.w;
  const overlapStart = Math.max(a.y, b.y);
  const overlapEnd = Math.min(a.y + a.h, b.y + b.h);
  if (overlapEnd > overlapStart) {
    const y = overlapStart + (overlapEnd - overlapStart) / 2;
    return [{ x: x1, y }, { x: x2, y }];
  }
  // Leave into the middle of the column gutter. Running vertically along a
  // card's right or left edge makes a long association look like part of every
  // card border in that column.
  const channel = x1 + (x2 - x1) / 2;
  return [
    { x: x1, y: a.y + a.h / 2 },
    { x: channel, y: a.y + a.h / 2 },
    { x: channel, y: b.y + b.h / 2 },
    { x: x2, y: b.y + b.h / 2 },
  ];
}

function routeAssociations(
  associations: FlowDoc['associations'],
  byId: Map<string, Placed>,
  bounds: RouteBounds,
  laneStart: number,
): PlacedAssociation[] {
  const placed: PlacedAssociation[] = [];
  for (const association of associations) {
    const from = byId.get(association.from);
    const to = byId.get(association.to);
    if (!from || !to || from.id === to.id) continue;
    const route = routeBetween(from, to, [...byId.values()], bounds, laneStart + placed.length);
    placed.push({ ...association, d: route.d, labelX: route.labelX, labelY: route.labelY });
  }
  return placed;
}

function compactRoute(points: RoutePoint[]): RoutePoint[] {
  const compact: RoutePoint[] = [];
  for (const point of points) {
    const last = compact.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) compact.push(point);
  }
  for (let index = 1; index < compact.length - 1;) {
    const previous = compact[index - 1];
    const point = compact[index];
    const next = compact[index + 1];
    const sameX = previous.x === point.x && point.x === next.x;
    const sameY = previous.y === point.y && point.y === next.y;
    if (sameX || sameY) compact.splice(index, 1);
    else index += 1;
  }
  return compact;
}

function segmentHitsCard(from: RoutePoint, to: RoutePoint, card: Placed): boolean {
  const left = card.x - ROUTE_CLEARANCE;
  const right = card.x + card.w + ROUTE_CLEARANCE;
  const top = card.y - ROUTE_CLEARANCE;
  const bottom = card.y + card.h + ROUTE_CLEARANCE;
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  return maxX > left && minX < right && maxY > top && minY < bottom;
}

function routeHits(points: RoutePoint[], cards: Placed[], a: Placed, b: Placed): number {
  let hits = 0;
  for (let index = 1; index < points.length; index += 1) {
    for (const card of cards) {
      if (card.id !== a.id && card.id !== b.id && segmentHitsCard(points[index - 1], points[index], card)) hits += 1;
    }
  }
  return hits;
}

function directBlockers(points: RoutePoint[], cards: Placed[], a: Placed, b: Placed): Placed[] {
  return cards.filter((card) =>
    card.id !== a.id && card.id !== b.id &&
    points.slice(1).some((point, index) => segmentHitsCard(points[index], point, card)),
  );
}

function routeOutside(points: RoutePoint[], bounds: RouteBounds): number {
  return points.filter((point) =>
    point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom,
  ).length;
}

function detourRoute(a: Placed, b: Placed, blockers: Placed[], above: boolean, lane: number): RoutePoint[] {
  const right = a.x + a.w / 2 <= b.x + b.w / 2;
  const direction = right ? 1 : -1;
  const startX = right ? a.x + a.w : a.x;
  const endX = right ? b.x : b.x + b.w;
  const channel = ROUTE_CLEARANCE + 4 + (lane % 3) * 4;
  const startChannel = startX + direction * channel;
  const endChannel = endX - direction * channel;
  const corridor = above
    ? Math.min(...blockers.map((card) => card.y)) - channel
    : Math.max(...blockers.map((card) => card.y + card.h)) + channel;
  const startY = a.y + a.h / 2;
  const endY = b.y + b.h / 2;
  return [
    { x: startX, y: startY },
    { x: startChannel, y: startY },
    { x: startChannel, y: corridor },
    { x: endChannel, y: corridor },
    { x: endChannel, y: endY },
    { x: endX, y: endY },
  ];
}

/** Center lines of the white gutters between drawn columns. */
function columnChannels(cards: Placed[], lane: number): number[] {
  const intervals = [...new Map(cards.map((card) => [`${card.x}:${card.w}`, { x: card.x, w: card.w }])).values()]
    .sort((left, right) => left.x - right.x);
  const channels: number[] = [];
  for (let index = 1; index < intervals.length; index += 1) {
    const left = intervals[index - 1];
    const right = intervals[index];
    const gap = right.x - (left.x + left.w);
    if (gap <= ROUTE_CLEARANCE * 2) continue;
    const center = left.x + left.w + gap / 2;
    const spread = Math.min(8, (gap - ROUTE_CLEARANCE * 2) / 4);
    channels.push(center + (((lane % 3) - 1) * spread));
  }
  return [...new Set(channels.map((value) => Math.round(value * 2) / 2))];
}

/** Candidate orthogonal paths through real column gutters and horizontal slabs. */
function gutterRoutes(a: Placed, b: Placed, cards: Placed[], bounds: RouteBounds, lane: number): RoutePoint[][] {
  const right = a.x < b.x;
  const startX = right ? a.x + a.w : a.x;
  const endX = right ? b.x : b.x + b.w;
  const betweenStart = Math.min(startX, endX);
  const betweenEnd = Math.max(startX, endX);
  const channels = columnChannels(cards, lane)
    .filter((x) => x > betweenStart + ROUTE_CLEARANCE && x < betweenEnd - ROUTE_CLEARANCE)
    .sort((left, rightValue) => right ? left - rightValue : rightValue - left);
  if (channels.length === 0) return [];

  const startY = a.y + a.h / 2;
  const endY = b.y + b.h / 2;
  const betweenCards = cards.filter((card) =>
    card.id !== a.id && card.id !== b.id &&
    card.x + card.w > betweenStart && card.x < betweenEnd,
  );
  const ys = new Set([startY, endY]);
  for (const card of betweenCards) {
    ys.add(card.y - ROUTE_CLEARANCE - lane % 3 * 4);
    ys.add(card.y + card.h + ROUTE_CLEARANCE + lane % 3 * 4);
  }

  const startChannel = channels[0];
  const endChannel = channels.at(-1) ?? startChannel;
  const routes: RoutePoint[][] = [];
  for (const corridorY of ys) {
    if (corridorY <= bounds.top || corridorY >= bounds.bottom) continue;
    routes.push(startChannel === endChannel
      ? [
          { x: startX, y: startY },
          { x: startChannel, y: startY },
          { x: startChannel, y: endY },
          { x: endX, y: endY },
        ]
      : [
          { x: startX, y: startY },
          { x: startChannel, y: startY },
          { x: startChannel, y: corridorY },
          { x: endChannel, y: corridorY },
          { x: endChannel, y: endY },
          { x: endX, y: endY },
        ]);
  }
  return routes;
}

function pathData(points: RoutePoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function routeLabel(points: RoutePoint[]): { x: number; y: number } {
  let best = { x: points[0].x, y: points[0].y, length: -1, horizontal: false };
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (length > best.length) {
      best = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, length, horizontal: from.y === to.y };
    }
  }
  return best.horizontal ? { x: best.x, y: best.y - 6 } : { x: best.x + 6, y: best.y };
}

function routeResult(points: RoutePoint[]): RoutedEdge {
  const clean = compactRoute(points);
  const label = routeLabel(clean);
  return { d: pathData(clean), labelX: label.x, labelY: label.y };
}

/**
 * Orthogonal connectors never pass through a third card. When the direct route
 * is blocked, the edge leaves through the nearest column gutter and takes the
 * closest clear corridor above or below the obstruction.
 */
export function routeBetween(
  a: Placed,
  b: Placed,
  cards: Placed[] = [a, b],
  bounds: RouteBounds = layoutBounds(MIN_CANVAS, Number.MAX_SAFE_INTEGER),
  lane = 0,
): RoutedEdge {
  const direct = compactRoute(preferredRoute(a, b));
  if (routeHits(direct, cards, a, b) === 0) return routeResult(direct);
  const blockers = directBlockers(direct, cards, a, b);
  const candidates = [
    direct,
    ...Array.from({ length: 3 }, (_, offset) => detourRoute(a, b, blockers, true, lane + offset)),
    ...Array.from({ length: 3 }, (_, offset) => detourRoute(a, b, blockers, false, lane + offset)),
    ...gutterRoutes(a, b, cards, bounds, lane),
  ];
  candidates.sort((left, right) => {
    const leftHits = routeHits(left, cards, a, b);
    const rightHits = routeHits(right, cards, a, b);
    if (leftHits !== rightHits) return leftHits - rightHits;
    const leftOutside = routeOutside(left, bounds);
    const rightOutside = routeOutside(right, bounds);
    if (leftOutside !== rightOutside) return leftOutside - rightOutside;
    if (left.length !== right.length) return left.length - right.length;
    return pathData(left).length - pathData(right).length;
  });
  return routeResult(candidates[0]);
}

/**
 * A layered DAG layout for linear documents and documents with branch edges.
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
        col: columnOf(members[slot]),
        x: left + slot * (cardW + SIBLING_GAP),
        y: cursorY + (bandH - geometry.h) / 2,
        w: cardW,
      });
    });

    cursorY += bandH + BAND_GAP;
  }

  const canvasHeight = Math.max(PAD, cursorY - BAND_GAP + PAD);
  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges: PlacedEdge[] = [];

  for (const edge of doc.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b || a === b) continue;
    const route = routeBetween(a, b, placed, layoutBounds(width, canvasHeight), edges.length);
    edges.push({ ...edge, d: route.d, labelX: route.labelX, labelY: route.labelY, showLabel: edge.kind === 'branch' });
  }

  return {
    width,
    height: canvasHeight,
    nodes: placed,
    edges,
    associations: routeAssociations(doc.associations ?? [], new Map(placed.map((node) => [node.id, node])), layoutBounds(width, canvasHeight), edges.length),
    bands: bands_,
    columns: [],
    columnHeaders: [],
    // A straight pipeline still splits by lane: "run this command, then decide"
    // is the distinction the reader needs even when there is no context column
    // to put beside it. Widths vary per band here, so the band spans the widest
    // card the lane produced.
    laneRuns: laneRuns(placed, {
      x: Math.min(...placed.map((node) => node.x)),
      w: Math.max(...placed.map((node) => node.x + node.w)) - Math.min(...placed.map((node) => node.x)),
    }),
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
          y: top.y - PHASE_LABEL_GAP,
          h: bottom.y + bottom.h - top.y + PHASE_LABEL_GAP + PHASE_BOTTOM_PAD,
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

export function renderHtml(doc: FlowDoc, options: { title?: string; embedded?: boolean } = {}): string {
  const layout = layoutNodes(doc);
  const title = options.title ?? `${doc.skill} · annot`;
  const embeddedClass = options.embedded ? ' class="is-embedded"' : '';
  const payload = safeJson(doc);
  const layoutPayload = safeJson(layout);
  const unresolved = doc.nodes.reduce((n, node) => n + node.branches.filter((b) => !b.to).length, 0);
  const toConfirm = doc.stats.lowConfidence;
  const orphanNotes = doc.stats.noteCoverage?.unbound ?? 0;
  const noteCoverage = doc.stats.noteCoverage?.coverageRate ?? 1;
  const stageCount = doc.stats.byType.stage;
  const noteCount = doc.stats.byType.note ?? 0;
  const scored = scoreOf(doc);
  const shape = diagnose(doc);
  // A rendering can pass every viewport check and still not be a flow: three
  // real skills drew one card per band, zero branch edges, and passed. The rail
  // states the shape so a reader is not asked to infer it from the picture.
  const shapeHtml = shape.findings.length
    ? `<ul class="plain">${shape.findings.map((f) => `<li class="${f.severity === 'warn' ? 'warn' : ''}">${esc(f.message)}</li>`).join('')}</ul>`
    : '<p class="muted" style="margin:0">没有形状上的异常：既有判定节点，也有横向铺开的分叉。</p>';
  const actionDisplayLabel = (label: string) => label.replace(
    /^([A-Z][A-Z0-9_]*(?:\s+[A-Z][A-Z0-9_]*)*)\s*[—–-]\s*/,
    (_match, lead: string) => `${lead.charAt(0)}${lead.slice(1).toLowerCase()}：`,
  );
  const actionNodes = doc.nodes.filter((node) => node.type === 'stage');
  const actionOverviewHtml = actionNodes.length
    ? `<section class="action-overview" aria-labelledby="action-overview-title">
  <div class="wrap action-overview-grid">
    <div class="action-overview-inner">
      <header class="action-overview-head">
        <div class="action-overview-copy">
          <p class="action-overview-kicker">SKILL ACTION FLOW</p>
          <h2 id="action-overview-title">这个 Skill 按什么顺序执行？</h2>
          <p>从原文抽取可追踪的关键动作。点击任一步骤，会定位到对应节点与锚定原文。</p>
        </div>
        <div class="action-overview-status" aria-label="${actionNodes.length} 个关键动作，均可定位">
          <span>执行链</span>
          <strong class="action-overview-count">${actionNodes.length} 个关键动作</strong>
        </div>
      </header>
      <ol class="action-chain" aria-label="按时序排列的关键动作">
        ${actionNodes.map((node, index) => `<li class="action-step" data-rank="${String(index + 1).padStart(2, '0')}"><button class="action-jump" type="button" data-node-id="${esc(node.id)}"><span class="action-jump-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span class="action-jump-copy"><strong>${esc(actionDisplayLabel(node.label))}</strong><small>定位原文与节点</small></span><span class="action-jump-arrow" aria-hidden="true">↗</span></button></li>`).join('\n        ')}
      </ol>
    </div>
  </div>
</section>`
    : `<section class="action-overview is-empty" aria-label="关键动作摘要">
  <div class="wrap action-overview-grid">
    <div class="action-overview-inner">
      <header class="action-overview-head">
        <div class="action-overview-copy">
          <p class="action-overview-kicker">SKILL ACTION FLOW</p>
          <h2>这个 Skill 里有可执行动作吗？</h2>
          <p>原文里还没有找到足够明确的动作证据。先核对判断、门禁与产物是否被误写成说明。</p>
        </div>
      </header>
      <p class="action-empty">右侧仍保留判断、门禁、调用、说明与产物，便于核对抽取是否漏掉操作。</p>
    </div>
  </div>
</section>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(doc.skill)} 的流程：${stageCount} 个关键动作、${noteCount} 条说明、${doc.edges.length} 条连接、${unresolved} 个未落地的分支，每个格子绑定它在原文里的行号。" />
<style>
  /* Hallmark · v2.0.0 · shape: app screen · theme: terrazzo (off-white) · deal: 2/3, seed annot-skill-flow-graph-3288 */
  /* Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V4 · weakest: E, the numbered gutter and the score rail are the page's two new measurements and both must agree with the graph */
  :root {
    --paper: #f6f4ef; --plate: #fffefb; --ink: #1a1815; --ink-2: #3c3833;
    --muted: #6b655c; --rule: #d9d3c7; --rule-ink: #1a1815;
    --accent: #a34a1c; --accent-soft: #f2e4d8; --accent-2: #7a3512;
    --tag-warn-rule: #d8bda8; --tag-ok-rule: #a9c6b6;
    --focus: #a34a1c;
    --stage: #3b36a8; --stage-soft: #f1efff; --decision: #9a5b06; --gate: #a8201a; --artifact: #14603f; --external: #12557a; --note: #655f70;
    --phase-soft: #efece2; --phase-rule: #c9c2b2;
    --font-display: "Syne", "Segoe UI", "Microsoft YaHei", ui-sans-serif, sans-serif;
    --font-body: "Onest", "Segoe UI", "Microsoft YaHei", ui-sans-serif, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
    --dur-micro: 120ms; --toolbar-height: 48px;
    --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
    --space-5: 24px; --space-6: 32px; --gap-card: 24px; --control-height: 44px;
    --overview-inset: 48px;
    --radius-small: 6px; --radius-control: 10px; --radius-surface: 16px;
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
  .facts { display: flex; flex-wrap: wrap; gap: 12px 0; justify-content: flex-end; text-align: right; }
  .facts div { padding: 0 20px; border-left: 1px solid var(--rule); }
  .facts div:first-child { border-left: 0; }
  .facts b { display: block; font-family: var(--font-mono); font-weight: 500; font-size: 24px; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .facts span { font-size: 12px; color: var(--muted); }
  .facts .bad b { color: var(--accent); }
  .action-overview { border-bottom: 1px solid var(--rule); background: var(--plate); }
  .action-overview-grid { padding: 0; }
  .action-overview-inner { margin: 0 var(--overview-inset); padding-bottom: var(--space-6); }
  .action-overview-head {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
    gap: var(--space-5); padding: var(--space-5) 0 var(--space-4); border-bottom: 1px solid var(--rule);
  }
  .action-overview-copy { min-width: 0; max-width: 72ch; }
  .action-overview-kicker {
    margin: 0 0 var(--space-2); color: var(--stage); font-family: var(--font-mono);
    font-size: 10px; font-weight: 600; letter-spacing: .14em; line-height: 1.4;
  }
  .action-overview-head h2 {
    margin: 0; font-family: var(--font-body); font-size: clamp(18px, 2.2vw, 23px);
    font-weight: 700; letter-spacing: -.02em; line-height: 1.35;
  }
  .action-overview-head p { max-width: 68ch; margin: var(--space-2) 0 0; font-size: 12.5px; line-height: 1.65; color: var(--muted); }
  .action-overview-status {
    min-width: 126px; display: grid; gap: 3px; justify-self: end; align-self: center;
    padding: var(--space-3) var(--space-4); border: 1px solid var(--rule);
    border-radius: var(--radius-control); background: var(--stage-soft);
  }
  .action-overview-status > span { color: var(--muted); font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; }
  .action-overview-count { display: block; color: var(--stage); font-family: var(--font-body); font-size: 12.5px; font-weight: 650; white-space: nowrap; }
  .action-chain {
    position: relative; list-style: none; display: grid; gap: 0;
    margin: var(--space-5) 0 0; padding: 0;
  }
  .action-chain::before {
    content: ''; position: absolute; z-index: 0; top: 26px; bottom: 26px; left: 19px;
    width: 1px; background: var(--rule);
  }
  .action-step { position: relative; min-width: 0; }
  .action-jump {
    position: relative; z-index: 1; width: 100%; min-height: 60px; display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 18px; gap: var(--space-3); align-items: center;
    padding: var(--space-2) var(--space-3) var(--space-2) 0; color: var(--ink); text-align: left;
    font-family: var(--font-body); background: transparent; border: 0; border-bottom: 1px solid var(--rule);
    border-radius: var(--radius-control); cursor: pointer;
  }
  .action-step:last-child .action-jump { border-bottom-color: transparent; }
  .action-jump:hover, .action-jump[aria-current="step"] { background: var(--stage-soft); }
  .action-jump:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .action-jump-index {
    width: 32px; height: 32px; display: grid; place-items: center; justify-self: center;
    border: 1px solid var(--rule); border-radius: 50%; background: var(--plate);
    color: var(--stage); font-family: var(--font-mono); font-size: 10.5px; font-variant-numeric: tabular-nums;
  }
  .action-jump:hover .action-jump-index, .action-jump[aria-current="step"] .action-jump-index { border-color: var(--stage); background: var(--plate); }
  .action-jump-copy { min-width: 0; display: block; }
  .action-jump-copy strong { display: block; min-width: 0; font-size: 13px; font-weight: 550; line-height: 1.55; white-space: normal; overflow-wrap: anywhere; }
  .action-jump-copy small { display: block; margin-top: 2px; color: var(--muted); font-size: 10.5px; line-height: 1.45; }
  .action-jump-arrow { color: var(--stage); font-family: var(--font-mono); font-size: 13px; opacity: 0; transform: translateX(-4px); transition: opacity var(--dur-micro), transform var(--dur-micro); }
  .action-jump:hover .action-jump-arrow, .action-jump:focus-visible .action-jump-arrow, .action-jump[aria-current="step"] .action-jump-arrow { opacity: 1; transform: translateX(0); }
  .action-empty { margin: var(--space-5) 0 0; font-size: 12.5px; color: var(--muted); }
  .action-overview.is-empty .action-overview-head { border-bottom: 0; padding-bottom: 0; }
  .action-overview.is-empty .action-overview-head p { margin: 0; }

  .split { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 0; align-items: start; }
  #stage { min-width: 0; }
  /* The tool strip: find, zoom, and the trace readout. It is chrome, so it is
     hairline-thin and sits above the canvas instead of floating over the graph —
     an overlay would hide the top row of cards exactly where a reader starts. */
  #tools {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 9px 24px; border-bottom: 1px solid var(--rule); background: var(--plate);
    position: sticky; top: 0; z-index: 2;
  }
  .tool-cluster { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1); border: 1px solid var(--rule); border-radius: var(--radius-control); background: var(--paper); }
  .search-cluster { flex: 0 1 340px; }
  #tools label { padding-left: 4px; font-size: 11.5px; color: var(--muted); }
  #tools input[type="search"] {
    min-width: 0; flex: 1; font-family: var(--font-body); font-size: 12.5px; color: var(--ink);
    background: transparent; border: 0; padding: 4px 6px; width: 180px;
  }
  #tools input[type="search"]:focus { outline: none; }
  .tool-cluster:focus-within { border-color: var(--rule-ink); }
  #tools button {
    font-family: var(--font-mono); font-size: 12px; color: var(--ink-2);
    background: var(--plate); border: 1px solid var(--rule); border-radius: 6px; padding: 5px 9px; cursor: pointer;
    min-width: 34px;
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

  /* The workbench supplies the page title and provenance once. In embedded
     mode the graph keeps its tools and canvas while the duplicated masthead
     and score rail give their width back to the flow. */
  body.is-embedded .masthead,
  body.is-embedded #detail { display: none; }
  body.is-embedded .wrap { max-width: none; padding: 0; }
  body.is-embedded .split { display: block; }
  /* The canvas is the graph's own scroller: without a height bound it grows to
     the full diagram, so the *page* scrolls and a chip click cannot bring a card
     into view. Bounding it to the viewport (minus the action chips and toolbar)
     is what makes revealNode's scrollTop mean something inside the workbench. */
  body.is-embedded #canvas { height: calc(100vh - var(--toolbar-height) - 168px); min-height: 360px; }
  body.is-embedded #tools { padding: 6px 20px; }
  /* In the workbench the action list is a jump bar, not a second cover page.
     The stand-alone page keeps the headline because it is the page's subject;
     embedded, that headline would cost ~150px of the pane the reader came for,
     so the same steps collapse into one scrollable row of chips. */
  body.is-embedded .action-overview-inner { padding-bottom: var(--space-2); }
  body.is-embedded .action-overview-head { display: block; padding: 0; border-bottom: 0; }
  body.is-embedded .action-overview-kicker,
  body.is-embedded .action-overview-head h2,
  body.is-embedded .action-overview-head p,
  body.is-embedded .action-overview-status { display: none; }
  /* A snake, not a scrolling strip: chips fill a row left→right, the next row
     right→left, and so on, so the eye walks one continuous path and no action is
     hidden behind a scrollbar. CSS cannot see where a flex row ends, so the
     script groups chips by their measured top edge and wraps each group in an
     action-row element: even rows read left→right, odd rows are ordered
     backwards and pushed flush right. That places the end of one row directly
     above the start of the next, which is the whole point of the shape. */
  body.is-embedded .action-chain {
    display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0 0 2px;
    overflow: visible;
  }
  body.is-embedded .action-chain::before { display: none; }
  body.is-embedded .action-row { flex: 0 0 100%; display: flex; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
  body.is-embedded .action-row.is-reversed { justify-content: flex-end; }
  body.is-embedded .action-step { flex: 0 0 auto; max-width: 300px; }
  body.is-embedded .action-jump {
    width: auto; min-height: 32px; gap: var(--space-2);
    padding: 3px 10px 3px 3px;
    grid-template-columns: 22px minmax(0, 1fr);
    border: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    border-radius: 999px; background: var(--plate);
  }
  body.is-embedded .action-step:last-child .action-jump { border-bottom-color: var(--rule); }
  body.is-embedded .action-jump-index {
    width: 22px; height: 22px; border: 0; background: var(--stage-soft); font-size: 9.5px;
  }
  body.is-embedded .action-jump-copy small,
  body.is-embedded .action-jump-arrow { display: none; }
  body.is-embedded .action-jump-copy strong {
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; line-height: 1.4;
  }
  body.is-embedded .action-empty { margin: var(--space-1) 0 0; }
  /* In the workbench the graph should use the available pane instead of
     forcing a horizontal hunt for the artifact lane. Mobile iframes keep the
     intrinsic width so text does not shrink below a readable size. */
  @media (min-width: 760px) {
    body.is-embedded svg { width: 100%; height: auto; }
  }
  @media (min-width: 1081px) {
    body:not(.is-embedded) svg { width: 100%; max-width: 100%; height: auto; }
  }

  /* The rail stays put while a 19-step column scrolls past it: the score and
     the pending list are what you consult while reading, not after. */
  #detail {
    border-left: 2px solid var(--rule-ink); background: var(--plate);
    padding: 24px 24px 60px; position: sticky; top: var(--toolbar-height); max-height: calc(100vh - var(--toolbar-height)); overflow-y: auto;
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
  .legend .legend-association i { width: 14px; height: 0; border-top: 1px dashed var(--note); background: transparent; vertical-align: middle; }
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
    padding: 12px; border-radius: var(--radius-control); font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6;
    max-height: 260px; overflow: auto; margin: 0;
  }
  ul.plain { margin: 0; padding-left: 16px; font-size: 12.5px; }
  ul.plain li { margin: 4px 0; }

  .tag { display: inline-block; font-size: 11.5px; padding: 2px 8px; background: var(--paper); color: var(--ink-2); border: 1px solid var(--rule); border-radius: var(--radius-small); }
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
  .edge, .association { vector-effect: non-scaling-stroke; }
  .edge { fill: none; stroke: var(--rule-ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; shape-rendering: geometricPrecision; }
  .edge.branch { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 4; }
  .association { fill: none; stroke: var(--note); stroke-width: 1.6; stroke-dasharray: 4 5; stroke-linecap: round; opacity: .9; }
  .association.hot { stroke: var(--signal-dark); stroke-width: 1.8; stroke-dasharray: none; opacity: 1; }
  /* A note's tie to its owner: one hairline, no arrowhead. The pair already
     reads as one block; this only says which card the block belongs to. */
  .note-connector { fill: none; stroke: var(--note); stroke-width: 1.2; stroke-dasharray: 2 3; opacity: .55; }
  .note-connector.hot { opacity: 1; stroke-width: 1.6; }
  .association-label { fill: var(--muted); font-family: var(--font-mono); font-size: 9px; paint-order: stroke; stroke: var(--paper); stroke-width: 3px; stroke-linejoin: round; }
  .edge-label { fill: var(--accent-2); font-family: var(--font-body); font-size: 11px; paint-order: stroke; stroke: var(--paper); stroke-width: 4px; stroke-linejoin: round; }
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
  .phase-label { fill: var(--ink-2); font-family: var(--font-body); font-size: 11.5px; letter-spacing: .02em; }
  .phase-label.weak { fill: var(--muted); }
  /* A swimlane is a lane of the action column, not a phase: no fill, one dashed
     rule, and its name in the lane's own corner. Drawing it as a wash would make
     it compete with the phase band that carries the author's declared structure. */
  rect.lane { fill: none; stroke: var(--rule); stroke-width: 1; stroke-dasharray: 4 5; }
  /* The label lives in the step-number gutter, so it must not run off the left
     edge: the gutter is 88px and the label is anchored to its right. */
  .lane-label { fill: var(--muted); font-family: var(--font-mono); letter-spacing: .04em; }
  ::selection { background: var(--accent-soft); }

  @media (max-width: 1080px) {
    :root { --overview-inset: 40px; }
    .split { grid-template-columns: minmax(0, 1fr); }
    #detail { position: static; max-height: none; border-left: 0; border-top: 2px solid var(--rule-ink); }
    .masthead .wrap { grid-template-columns: minmax(0, 1fr); }
    .facts { text-align: left; }
    .facts div:first-child { padding-left: 0; }
    .action-overview-head { gap: var(--space-4); }
  }
  @media (max-width: 620px) {
    .masthead .wrap { padding-right: 16px; padding-left: 16px; }
    .facts div { padding-right: 12px; padding-left: 12px; }
    .facts div:first-child { padding-left: 0; }
  }
  @media (max-width: 480px) {
    .action-overview-head { grid-template-columns: minmax(0, 1fr); align-items: start; padding-top: var(--space-5); }
    .action-overview-status { justify-self: start; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>
</head>
<body${embeddedClass}>
<header class="masthead">
  <div class="wrap">
    <div>
      <h1>${esc(doc.skill)}</h1>
      <p class="claim">${esc(doc.description || `${stageCount} 个关键动作，自上而下按原文顺序排列；判断、门禁、产物与说明在动作旁边提供依据和结果。`)}</p>
      <dl class="provenance">
        <div><dt>文件</dt><dd>${esc(doc.source.file)}</dd></div>
        <div><dt>行数</dt><dd>${doc.source.lines}</dd></div>
        <div><dt>哈希</dt><dd>${esc(doc.source.sha.slice(0, 10))}</dd></div>
        <div><dt>方法</dt><dd>${doc.source.method === 'ai' ? 'AI 语义分析' : '规则草案'}</dd></div>
        <div><dt>生成</dt><dd>${esc(doc.source.generated_at.slice(0, 16).replace('T', ' '))}</dd></div>
      </dl>
    </div>
    <div class="facts">
      <div><b>${stageCount}</b><span>关键动作</span></div>
      <div><b>${noteCount}</b><span>说明</span></div>
      <div><b>${doc.edges.length}</b><span>连接</span></div>
      <div class="${orphanNotes ? 'bad' : ''}"><b>${Math.round(noteCoverage * 100)}%</b><span>说明覆盖</span></div>
      <div class="${unresolved ? 'bad' : ''}"><b>${unresolved}</b><span>分支未落地</span></div>
      <div class="${toConfirm ? 'bad' : ''}"><b>${toConfirm}</b><span>待人工确认</span></div>
    </div>
  </div>
</header>
${actionOverviewHtml}
<div class="wrap">
  <div class="split">
    <div id="stage">
      <div id="tools">
        <div class="tool-cluster search-cluster">
          <label for="find">查找</label>
          <input id="find" type="search" placeholder="关键动作 / 说明 / 行号" autocomplete="off" spellcheck="false" />
          <span class="count" id="hits"></span>
        </div>
        <div class="tool-cluster zoom-cluster" aria-label="图谱缩放">
          <button id="zoom-out" type="button" title="缩小（-）" aria-label="缩小">−</button>
          <button id="zoom-reset" type="button" title="回到 100%（0）">100%</button>
          <button id="zoom-in" type="button" title="放大（+）" aria-label="放大">+</button>
        </div>
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
      <p class="muted" style="margin:0">左列只放<strong>关键动作</strong>：节点文字必须直接描述“做什么”。同一行的中列是<strong>判断、门禁、外部调用与说明</strong>，右列是<strong>产物</strong>；它们提供依据和结果，不参与动作编号。竖线连接相邻的流程节点，橙色虚线是文件里写明的分支。灰色底带是文件自己声明的阶段（<code>Phase 1</code> / <code>阶段二</code> 这类小节）；虚线框是普通章节，只在它至少罩住两格时才画。点开格子看类型、行号与原文。</p>
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
    artifact: 'var(--artifact)', external: 'var(--external)', note: 'var(--note)',
  };
  return [
    ...(Object.keys(color) as NodeType[]).map((t) =>
      `<span><i style="background:${color[t]}"></i>${labelOf(t)}</span>`),
    '<span class="legend-association"><i></i>说明关联</span>',
  ].join('');
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
      return '关键动作';
    case 'decision':
      return '判断';
    case 'gate':
      return '门禁';
    case 'artifact':
      return '产物';
    case 'external':
      return '外部调用';
    case 'note':
      return '说明';
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
const LABEL = {stage:'关键动作',decision:'判断',gate:'门禁',artifact:'产物',external:'外部调用',note:'说明'};
const LANE = {reader:'你（读者）', tool:'工具/命令', model:'模型', output:'产物'};
const NOTE_ROLE = {principle:'原则',rationale:'理由',definition:'定义',trigger:'触发',context:'背景',risk:'风险',example:'示例',reference:'参考'};
const RELATION_LABEL = {supports:'支持动作',constrains:'约束门禁',informs:'辅助判断','explains-output':'解释产物'};
/* The type reaches the SVG as a CSS variable so all colour lives in :root. */
const TYPE_VAR = {stage:'--stage',decision:'--decision',gate:'--gate',artifact:'--artifact',external:'--external',note:'--note'};

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
[['arrow', '--rule-ink'], ['arrow-hot', '--accent'], ['arrow-association', '--note']].forEach(function (pair) {
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
  svg.appendChild(svgEl('rect', { class: 'phase' + weak, x: 20, y: run.y, width: layout.width - 40, height: run.h, rx: ${PHASE_RADIUS}, ry: ${PHASE_RADIUS} }));
}

/* The swimlanes inside the action column come after the phase wash and before
   any card, so a lane edge never cuts a plate. A lane only exists when two of
   them carry cards; when it does, its name is what makes the band readable
   without a legend. */
for (const lane of (layout.laneRuns || [])) {
  svg.appendChild(svgEl('rect', { class: 'lane', x: lane.x - 14, y: lane.y, width: lane.w + 28, height: lane.h, rx: 10, ry: 10 }));
  // Left of the band, in the step-number gutter: the band's own top edge is
  // where the previous card's footer ends, and a label there would sit on it.
  svg.appendChild(svgText(lane.x - 22, lane.y + 12, lane.label + ' · ' + lane.count, {
    class: 'lane-label',
    'font-size': 10.5,
    'text-anchor': 'end',
  }));
}

/* The column rails come before the rules so a hairline never cuts through a
   header. An empty column draws no rail: a lane that holds nothing is a promise
   the document does not keep, and the header still names it. */
for (const column of (layout.columns || [])) {
  svg.appendChild(svgEl('line', { class: 'rail', x1: column.x + column.w + 13, y1: 34, x2: column.x + column.w + 13, y2: layout.height - 26 }));
}
if ((layout.columnHeaders || []).length) {
  svg.appendChild(svgEl('line', { class: 'rail-head', x1: 26, y1: ${COLUMN_HEADER_RULE_Y}, x2: layout.width - 26, y2: ${COLUMN_HEADER_RULE_Y} }));
  for (const head of layout.columnHeaders) {
    // The header carries its own count: "门禁 · 外部调用 6" answers "is this lane
    // part of the flow or just a category I invented" without a legend.
    svg.appendChild(svgText(head.x, ${COLUMN_HEADER_TITLE_Y}, head.label + '  ' + head.count, {
      class: 'column-label' + (head.used ? '' : ' unused'),
      'font-size': 11.5,
    }));
    svg.appendChild(svgText(head.x, ${COLUMN_HEADER_NOTE_Y}, head.used ? head.note : '本文件没有这一类', {
      class: 'column-note' + (head.used ? '' : ' unused'),
      'font-size': 10.5,
    }));
  }
}

const actionRanks = new Map(layout.nodes.filter(function (n) { return n.type === 'stage'; }).map(function (n, i) { return [n.id, i]; }));
const bandActions = new Map(layout.nodes.filter(function (n) { return n.type === 'stage'; }).map(function (n) { return [n.band, n.id]; }));
for (const band of (layout.bands || [])) {
  svg.appendChild(svgEl('line', { class: 'steprule', x1: 26, y1: band.y - 11, x2: layout.width - 26, y2: band.y - 11 }));
  const actionId = bandActions.get(band.index);
  if (actionId) svg.appendChild(svgText(26, band.y + 4, String((actionRanks.get(actionId) || 0) + 1).padStart(2, '0'), { class: 'stepnum' }));
}

for (const association of (layout.associations || [])) {
  // An attached note is drawn under its owner, in the owner's column, with a
  // connector between the two cards. A dashed line across the page would say the
  // same thing twice and cut through every card in between, so it is drawn only
  // when the pair is not already adjacent.
  const from = layout.nodes.find(function (n) { return n.id === association.from; });
  if (from && from.home === 'attached') continue;
  const path = svgEl('path', {
    d: association.d,
    class: 'association',
    'data-from': association.from,
    'data-to': association.to,
    'data-relation': association.relation,
    'marker-end': 'url(#arrow-association)',
  });
  const title = svgEl('title');
  title.textContent = RELATION_LABEL[association.relation] + ' · ' + association.evidence;
  path.appendChild(title);
  svg.appendChild(path);
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
  svg.appendChild(svgText(layout.width - 30, run.y + 16, run.label + ' · ' + run.nodes, {
    class: 'phase-label' + weak,
    'text-anchor': 'end',
  }));
}

/* A note hangs off its owner: a hairline down the owner's left edge into the
   note's left edge. Without it the step-in reads as an indentation for no
   reason; with it the note is visibly attached to exactly one card. */
const placedById = new Map();
for (const n of layout.nodes) placedById.set(n.id, n);
for (const n of layout.nodes) {
  if (!n.explains) continue;
  const owner = placedById.get(n.explains);
  if (!owner) continue;
  const fromY = owner.y + owner.h;
  const toY = n.y - 1;
  if (toY <= fromY) continue;
  const x = n.x + 7;
  svg.appendChild(svgEl('path', {
    d: 'M ' + x + ' ' + fromY + ' L ' + x + ' ' + (toY - 5) + ' L ' + (n.x + n.inset - 1) + ' ' + (toY - 5),
    class: 'note-connector',
    'data-from': owner.id,
    'data-to': n.id,
  }));
}

layout.nodes.forEach(function (n, nodeIndex) {
  const tint = 'fill: var(' + (TYPE_VAR[n.type] || '--stage') + ')';
  const cardH = n.cardH || n.h;
  // A note's box is its owner's column; the plate is what steps in.
  const inset = n.inset || 0;
  const w = n.w - inset;
  const g = svgEl('g', { class:'node' + (n.home === 'attached' ? ' note-attached' : n.home ? ' note-' + n.home : ''), 'data-id': n.id, transform: 'translate(' + (n.x + inset) + ',' + n.y + ')' });

  // The plate: paper-white card, 1px ink rule, and a 3px rule on the top edge
  // carrying the node's type. Fill is not the signal — the type is.
  const plateClipId = 'node-plate-' + nodeIndex;
  const plateClip = svgEl('clipPath', { id: plateClipId });
  plateClip.appendChild(svgEl('rect', { width:w, height:cardH, rx:${CARD_RADIUS}, ry:${CARD_RADIUS} }));
  defs.appendChild(plateClip);
  g.appendChild(svgEl('rect', { class:'card', width:w, height:cardH, rx:${CARD_RADIUS}, ry:${CARD_RADIUS}, fill:'var(--plate)', stroke:'var(--rule-ink)', 'stroke-width':1.1 }));
  g.appendChild(svgEl('rect', { width:w, height:4, 'clip-path':'url(#' + plateClipId + ')', style: tint }));

  const relLabel = n.relation ? RELATION_LABEL[n.relation] : '';
  // A stacked graph has no owner column, so a note there names its role instead
  // of a relation: "说明 · 原则" still answers what kind of remark this is.
  const roleName = NOTE_ROLE[n.noteRole] || '';
  const roleLabel = n.type === 'note'
    ? (n.home === 'attached' ? (relLabel ? '说明 · ' + relLabel : '说明')
      : n.home === 'global' ? '说明 · 全局'
        : n.home === 'loose' ? '说明 · 孤立'
          : roleName ? '说明 · ' + roleName : '说明')
    : LABEL[n.type];
  g.appendChild(svgText(${CARD_PAD_X}, ${CARD_TYPE_BASELINE}, roleLabel, { 'font-size':10.5, 'letter-spacing':'.03em', style: tint }));

  (n.lines || [clip(n.label, 40)]).forEach(function (line, i) {
    g.appendChild(svgText(${CARD_PAD_X}, ${CARD_LABEL_TOP} + i * ${LINE_H}, line, { 'font-size':13, style: 'fill: var(--rule-ink)' }));
  });

  // The subtitle and table rows keep the same left edge as the title. A separate
  // footer strip gives source metadata breathing room instead of pinning it to
  // the card border.
  const subTop = ${CARD_LABEL_TOP} + (n.lines || []).length * ${LINE_H} + 2;
  (n.subLines || []).forEach(function (line, i) {
    g.appendChild(svgText(${CARD_PAD_X}, subTop + i * ${SUB_H}, line, { 'font-size':11.5, style: 'fill: var(--ink-2)' }));
  });
  const rowTop = subTop + (n.subLines || []).length * ${SUB_H} - 1;
  (n.rows || []).forEach(function (row, i) {
    g.appendChild(svgText(${CARD_PAD_X}, rowTop + i * ${ROW_H}, row, { 'font-size':11, style: 'fill: var(--ink-2)' }));
  });

  g.appendChild(svgEl('line', { x1:1, y1:cardH - ${FOOT_H}, x2:w - 1, y2:cardH - ${FOOT_H}, style:'stroke: var(--rule); stroke-width:1' }));
  const openBranches = n.branches.filter(function (b) { return !b.to; }).length;
  const statusParts = [openBranches ? openBranches + ' 未落地' : '', n.flags.includes('low-confidence') ? '低置信' : ''].filter(Boolean);
  const rightStatus = clipToWidth(statusParts.join(' · '), (w - ${CARD_PAD_X * 2}) * 0.43, 10.5);
  const rightStatusWidth = rightStatus ? textWidthIn(rightStatus, 10.5) : 0;
  const footMaxWidth = w - ${CARD_PAD_X * 2} - (rightStatus ? rightStatusWidth + 16 : 0);
  const foot = 'L' + n.anchor.start + '–' + n.anchor.end + ' · ' + Math.round(n.confidence * 100) + '%' +
    (n.rule ? ' · ' + n.rule : '');
  g.appendChild(svgText(${CARD_PAD_X}, cardH - 11, clipToWidth(foot, footMaxWidth, 10.5), { 'font-size':10.5, style: 'fill: var(--muted); font-family: var(--font-mono)' }));

  if (n.lane) {
    g.appendChild(svgText(w - ${CARD_PAD_X}, ${CARD_TYPE_BASELINE}, LANE[n.lane] || n.lane, {
      'font-size':10.5, 'text-anchor':'end', style: 'fill: var(--muted); letter-spacing:.02em',
    }));
  }

  if (rightStatus) {
    g.appendChild(svgText(w - ${CARD_PAD_X}, cardH - 11, rightStatus, {
      'font-size':10.5, 'text-anchor':'end', style: 'fill: var(--muted); font-family: var(--font-mono)',
    }));
  }

  // An open arm is a fork whose target the extractor could not name. It stays
  // attached to the card and is marked with a dashed stub, so "this step has
  // three outcomes" is visible even when none of the three lands anywhere.
  let armX = 6;
  (n.arms || []).forEach(function (arm) {
    g.appendChild(svgEl('rect', { class:'arm', x:armX, y:cardH + 6, width:arm.w, height:18, rx:5, ry:5, fill:'var(--accent-soft)', stroke:'var(--accent)', 'stroke-width':1 }));
    g.appendChild(svgText(armX + arm.w / 2, cardH + 19, arm.label, { 'font-size':11, 'text-anchor':'middle', style: 'fill: var(--accent-2)' }));
    armX += arm.w + 8;
  });
  if ((n.arms || []).length) {
    g.appendChild(svgText(w - 12, cardH + 19, '未落地 ' + n.arms.length, { 'font-size':10.5, 'text-anchor':'end', style: 'fill: var(--accent); font-family: var(--font-mono)' }));
  }

  g.addEventListener('click', function (event) {
    event.stopPropagation();
    select(n, g, true);
  });
  g.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    select(n, g, true);
  });
  g.setAttribute('tabindex', '0');
  g.setAttribute('role', 'button');
  // No mouseenter/mouseleave: the trace belongs to the *selected* card, so that
  // moving the pointer away does not erase the reading. Hover only previews a
  // card that is not selected yet.
  g.addEventListener('mouseenter', function () {
    if (selectedId !== n.id) trace(n.id);
  });
  // Leaving a hovered card goes back to the pinned selection instead of clearing
  // the picture: moving the pointer should not erase the trace the reader chose.
  g.addEventListener('mouseleave', function () {
    if (selectedId === n.id) return;
    if (selectedId) trace(selectedId);
    else trace(null);
  });
  g.addEventListener('focus', function () {
    if (selectedId !== n.id) trace(n.id);
  });
  svg.appendChild(g);
});
document.getElementById('canvas').appendChild(svg);
renderTodos();

/* Clicking the paper clears the selection — and with it the pinned trace. The
   canvas is the only place that counts as "away"; a click on the toolbar or the
   detail rail is the reader working with the card they just picked. */
document.getElementById('canvas').addEventListener('click', function (event) {
  if (event.target.closest && event.target.closest('.node')) return;
  const selected = svg.querySelectorAll('.node.sel');
  for (let i = 0; i < selected.length; i++) selected[i].classList.remove('sel');
  selectedId = null;
  trace(null);
  if (window.parent !== window) window.parent.postMessage({ type: 'annot-node-cleared' }, '*');
});

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
for (const e of [...layout.edges, ...(layout.associations || [])]) {
  if (!OUT.has(e.from)) OUT.set(e.from, []);
  if (!IN.has(e.to)) IN.set(e.to, []);
  OUT.get(e.from).push(e.to);
  IN.get(e.to).push(e.from);
}

/** The card the trace is pinned to; null means the reader has not picked one. */
let selectedId = null;

function trace(id) {
  for (const g of svg.querySelectorAll('.node.hot, .node.dim')) g.classList.remove('hot', 'dim');
  for (const edge of svg.querySelectorAll('.edge.hot, .association.hot, .note-connector.hot')) edge.classList.remove('hot');
  const readout = document.getElementById('trace');

  if (!id) {
    svg.classList.remove('tracing');
    readout.textContent = '悬停一格看它的上下游';
    return;
  }

  // A note is tied to its owner by the hairline, not by an association path (that
  // path is drawn only for notes with no owner). Both directions are wired here
  // so hovering a note lights the card it explains and vice versa.
  const ownerOfNote = new Map();
  const notesOfOwner = new Map();
  for (const n of layout.nodes) {
    if (!n.explains) continue;
    ownerOfNote.set(n.id, n.explains);
    if (!notesOfOwner.has(n.explains)) notesOfOwner.set(n.explains, []);
    notesOfOwner.get(n.explains).push(n.id);
  }

  const directUp = [...(IN.get(id) || []), ...(ownerOfNote.has(id) ? [ownerOfNote.get(id)] : [])];
  const directDown = [...(OUT.get(id) || []), ...(notesOfOwner.get(id) || [])];
  const hot = new Set([id, ...directUp, ...directDown]);
  svg.classList.add('tracing');
  for (const g of svg.querySelectorAll('.node')) {
    g.classList.add(hot.has(g.getAttribute('data-id')) ? 'hot' : 'dim');
  }
  for (const edge of svg.querySelectorAll('.edge, .association, .note-connector')) {
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
   whole change; the pane keeps its scroll position around the pointer.
   In the workbench the pane is ~1500px wide and a 900px graph at 100% leaves two
   thirds of it as paper, so the page opens at 60% — the smallest step that still
   keeps 13px labels legible — and never goes below 20%. Zoom is the reader's
   tool, not a default they have to correct first. ---- */
const ZOOMS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2];
const DEFAULT_ZOOM = 4; // 0.6
let zoom = DEFAULT_ZOOM;

function applyZoom(next, anchor) {
  zoom = Math.max(0, Math.min(ZOOMS.length - 1, next));
  const scale = ZOOMS[zoom];
  const pane = document.getElementById('canvas');
  const before = anchor || { x: pane.clientWidth / 2, y: pane.clientHeight / 2 };
  const box = svg.getBoundingClientRect();
  const currentScale = box.width / layout.width || 1;
  const graphX = (pane.scrollLeft + before.x) / currentScale;
  const graphY = (pane.scrollTop + before.y) / currentScale;
  const embedded = document.body.classList.contains('is-embedded');
  const fitWidth = embedded && pane.clientWidth >= 760 ? pane.clientWidth : layout.width;
  const targetWidth = Math.round(fitWidth * scale);
  const targetHeight = Math.round(layout.height * (targetWidth / layout.width));

  // The responsive CSS fits the graph before the first interaction. Once the
  // reader zooms, inline geometry takes over so the toolbar controls actually
  // change the rendered size instead of being overridden by max-width: 100%.
  svg.style.width = targetWidth + 'px';
  svg.style.height = targetHeight + 'px';
  svg.style.maxWidth = 'none';
  svg.setAttribute('width', targetWidth);
  svg.setAttribute('height', targetHeight);
  pane.scrollLeft = graphX * (targetWidth / layout.width) - before.x;
  pane.scrollTop = graphY * (targetHeight / layout.height) - before.y;

  document.getElementById('zoom-reset').textContent = Math.round(scale * 100) + '%';
  document.getElementById('zoom-in').disabled = zoom === ZOOMS.length - 1;
  document.getElementById('zoom-out').disabled = zoom === 0;
}

document.getElementById('zoom-in').addEventListener('click', function () { applyZoom(zoom + 1); });
document.getElementById('zoom-out').addEventListener('click', function () { applyZoom(zoom - 1); });
document.getElementById('zoom-reset').addEventListener('click', function () {
  const pane = document.getElementById('canvas');
  // Reset goes back to the default reading scale (60%), not to 100%: 100% is a
  // magnification step in this pane, and returning to it would undo the fit.
  applyZoom(DEFAULT_ZOOM);
  pane.scrollTop = 0;
  pane.scrollLeft = 0;
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

window.addEventListener('resize', function () {
  window.requestAnimationFrame(function () { applyZoom(zoom); });
});

/* Open at the reading scale. The responsive CSS fits the SVG to the pane before
   the first interaction, which is why the default label said 100% while the page
   claimed 60% — the constant was set but never applied. */
window.requestAnimationFrame(function () { applyZoom(DEFAULT_ZOOM); });

document.addEventListener('keydown', function (event) {
  if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); applyZoom(zoom + 1); }
  else if (event.key === '-') { event.preventDefault(); applyZoom(zoom - 1); }
  else if (event.key === '0') { event.preventDefault(); applyZoom(DEFAULT_ZOOM); }
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
  const open = doc.nodes.filter(function (n) {
    return n.branches.some(function (b) { return !b.to; }) || n.flags.indexOf('low-confidence') !== -1 || n.flags.indexOf('orphan-note') !== -1;
  });
  if (!open.length) {
    document.getElementById('todos').innerHTML = '<p class="tag ok">全部已确认</p>';
    return;
  }
  document.getElementById('todos').innerHTML =
    '<p class="muted" style="margin:0 0 8px">' + open.length + ' 个格子需要人工确认。在 <code>annot.sidecar.json</code> 里补一条即可固化。</p>' +
    open.map(function (n) {
      const why = n.branches.filter(function (b) { return !b.to; }).map(function (b) { return b.when; }).join(' / ');
      const reason = n.flags.indexOf('orphan-note') !== -1 ? '孤立说明' : why ? clip(why, 34) : '规则置信度 ' + Math.round(n.confidence * 100) + '%';
      return '<div style="margin:0 0 6px"><code>' + escapeHtml(n.id) + '</code> ' +
        '<span class="tag warn">' + escapeHtml(reason) + '</span></div>';
    }).join('');
}

function select(n, g, notifyParent) {
  const selected = svg.querySelectorAll('.node.sel');
  for (let i = 0; i < selected.length; i++) selected[i].classList.remove('sel');
  g.classList.add('sel');
  // Pin the trace to the selection: the pointer can leave, the reading stays.
  selectedId = n.id;
  trace(n.id);
  if (notifyParent && window.parent !== window) window.parent.postMessage({ type: 'annot-node-selected', id: n.id }, '*');

  const flags = n.flags.map(function (f) {
    return '<span class="tag ' + (f === 'stale' || f === 'broken' ? 'warn' : '') + '">' + f + '</span>';
  }).join(' ');

  const branches = n.branches.length
    ? n.branches.map(function (b) {
        return '<li><code>' + escapeHtml(b.when) + '</code>' +
          (b.to ? ' → <code>' + escapeHtml(b.to) + '</code>' : ' <span class="tag warn">未落地</span>') + '</li>';
      }).join('')
    : '<li class="muted">无</li>';

  const actionIndex = n.type === 'stage' ? layout.nodes.filter(function (candidate) { return candidate.type === 'stage'; }).findIndex(function (candidate) { return candidate.id === n.id; }) : -1;
  document.getElementById('panel').innerHTML =
    '<h2>' + (actionIndex >= 0 ? '关键动作 ' + (actionIndex + 1) : LABEL[n.type]) + '</h2>' +
    '<dl class="kv">' +
      '<dt>id</dt><dd><code>' + escapeHtml(n.id) + '</code></dd>' +
      '<dt>类型</dt><dd>' + LABEL[n.type] + '</dd>' +
      '<dt>谁做</dt><dd>' + (LANE[n.lane] || n.lane) + '</dd>' +
      '<dt>' + (doc.source.method === 'ai' ? '判断' : '规则') + '</dt><dd><code>' + escapeHtml(n.rule || '(none)') + '</code> · ' + Math.round(n.confidence * 100) + '%</dd>' +
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

/**
 * Do not use the browser's element-scroll helper here.
 *
 * The embedded graph is an iframe; scrolling one of its elements into view walks
 * up to the parent document and moves the workbench's own pane, which is how
 * clicking step 02 made the page jump while the graph stayed put. Everything is
 * scrolled by setting the canvas' own scrollTop, and the canvas is already on
 * screen because the reader clicked a chip in it.
 */
function revealNode(id, notify) {
  const node = layout.nodes.find(function (candidate) { return candidate.id === id; });
  if (!node) return;
  const groups = svg.querySelectorAll('.node');
  let group = null;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].getAttribute('data-id') === id) { group = groups[i]; break; }
  }
  if (!group) return;
  select(node, group, notify !== false);
  const buttons = document.querySelectorAll('.action-jump');
  for (let i = 0; i < buttons.length; i++) {
    const active = buttons[i].getAttribute('data-node-id') === id;
    if (active) buttons[i].setAttribute('aria-current', 'step');
    else buttons[i].removeAttribute('aria-current');
  }
  const pane = document.getElementById('canvas');
  if (!pane) return;
  // Center the card in the viewport instead of pinning it to the top edge: the
  // chip list is right above the canvas, so a card at scrollTop 0 sits under it.
  const scale = Number(svg.getAttribute('height')) / layout.height || 1;
  const target = node.y * scale + (node.h * scale) / 2 - pane.clientHeight / 2;
  pane.scrollTop = Math.max(0, target);
  pane.scrollLeft = 0;
}

const actionButtons = document.querySelectorAll('.action-jump');
for (let i = 0; i < actionButtons.length; i++) {
  actionButtons[i].addEventListener('click', function () {
    revealNode(actionButtons[i].getAttribute('data-node-id'));
  });
}

/* The chip row is a snake: row 1 reads left→right, row 2 right→left, and so on,
   so the next step always starts where the previous one ended instead of jumping
   back to the left margin on every wrap.
   Flexbox cannot express "reverse this row" — row-reverse reverses the whole
   container — so the script reverses the DOM order of every odd row and lets the
   auto margin right-align it. Chip widths are untouched, which keeps the wrap
   points stable while the reorder runs. Rows are found by their measured top
   edge, which is the only thing that knows where the browser actually wrapped. */
const actionChain = document.querySelector('.action-chain');
function snakeChips() {
  if (!actionChain || !document.body.classList.contains('is-embedded')) return;
  const steps = Array.prototype.slice.call(actionChain.querySelectorAll('.action-step'))
    .sort(function (a, b) { return Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank')); });
  if (steps.length < 2) return;
  // Unwrap first: measuring a previous run's rows would just re-measure itself.
  for (const row of Array.prototype.slice.call(actionChain.querySelectorAll('.action-row'))) row.remove();
  const probe = document.createElement('div');
  probe.className = 'action-row';
  actionChain.appendChild(probe);
  for (const step of steps) probe.appendChild(step);
  // Where the browser actually wrapped is the only source of truth for a row
  // break, so group by measured top edge while everything is in one flex line.
  const rows = [];
  let top = null;
  for (const step of steps) {
    if (top === null || Math.abs(step.offsetTop - top) > 1) {
      rows.push([]);
      top = step.offsetTop;
    }
    rows[rows.length - 1].push(step);
  }
  actionChain.removeChild(probe);
  // Even rows read left→right; odd rows are reversed and flush right, so the
  // step after the last chip of a row starts directly beneath it rather than
  // jumping back to the left margin.
  rows.forEach(function (row, index) {
    const line = document.createElement('div');
    line.className = 'action-row' + (index % 2 === 1 ? ' is-reversed' : '');
    for (let i = 0; i < row.length; i++) {
      line.appendChild(index % 2 === 1 ? row[row.length - 1 - i] : row[i]);
    }
    actionChain.appendChild(line);
  });
}
snakeChips();
window.addEventListener('resize', function () {
  window.requestAnimationFrame(snakeChips);
});

/* Embedded in the workbench, the graph is the picker for the right-hand
   drawer. The host asks for a card to be selected when the reader arrives from
   a standards finding instead of from the canvas; the notify flag stays false
   so the message does not bounce straight back to the host. */
window.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'annot-select-node' || typeof event.data.id !== 'string') return;
  revealNode(event.data.id, false);
});

const firstNode = layout.nodes.find(function (n) { return n.type === 'stage'; }) || layout.nodes[0];
/* Select the group that *is* that node. This used to take the first node group in
   the document regardless of which one firstNode named, so the highlighted card
   and the detail panel could describe two different steps — and the pinned trace
   lit the wrong subgraph. Nothing is selected when the reader arrives from the
   workbench, which lets the host decide whether to open a card at all; when it
   does select one, the first card is what it asks for. */
if (firstNode && !document.body.classList.contains('is-embedded')) {
  const firstGroup = Array.prototype.find.call(svg.querySelectorAll('.node'), function (g) {
    return g.getAttribute('data-id') === firstNode.id;
  });
  if (firstGroup) select(firstNode, firstGroup, false);
}
`;
