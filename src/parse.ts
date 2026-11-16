/**
 * SKILL.md is markdown, not a program: this parser only recovers structure
 * (frontmatter, headings, contiguous units) and never guesses semantics.
 * Every unit keeps 1-based absolute line numbers so downstream anchors can
 * point back into the exact bytes a human will edit.
 */

import { createHash } from 'node:crypto';

export interface RawLine {
  n: number;
  text: string;
}

export type UnitKind = 'paragraph' | 'list' | 'table' | 'code' | 'quote';

export interface Unit {
  kind: UnitKind;
  heading: string[];
  lines: RawLine[];
}

export interface Section {
  title: string;
  level: number;
  /** Heading path, outermost first. Preamble sections carry an empty path. */
  heading: string[];
  startLine: number;
  units: Unit[];
}

export interface ParsedSkill {
  name: string;
  description: string;
  frontmatter: Record<string, string>;
  sections: Section[];
  totalLines: number;
  sha: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
const QUOTE = /^\s*>\s?/;

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash of a line range exactly as it will be re-read after an edit. */
export function linesSha(lines: RawLine[]): string {
  return sha256(lines.map((l) => l.text).join('\n'));
}

export function parseSkill(text: string): ParsedSkill {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: RawLine[] = raw.map((t, i) => ({ n: i + 1, text: t }));

  const { frontmatter, bodyStart } = parseFrontmatter(lines);
  const body = lines.slice(bodyStart);
  const sections = splitSections(body);

  const name = frontmatter.name ?? deriveName(frontmatter, sections);
  const description = frontmatter.description ?? '';

  return {
    name,
    description,
    frontmatter,
    sections,
    totalLines: lines.length,
    sha: sha256(raw.join('\n')),
  };
}

function deriveName(frontmatter: Record<string, string>, sections: Section[]): string {
  if (frontmatter.slug) return frontmatter.slug;
  const h1 = sections.find((s) => s.level === 1);
  return h1 ? slugify(h1.title) : 'unnamed-skill';
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'skill';
}

interface FrontmatterResult {
  frontmatter: Record<string, string>;
  bodyStart: number;
}

function parseFrontmatter(lines: RawLine[]): FrontmatterResult {
  if (lines.length === 0 || lines[0].text.trim() !== '---') {
    return { frontmatter: {}, bodyStart: 0 };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].text.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { frontmatter: {}, bodyStart: 0 };

  const data: Record<string, string> = {};
  let key: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (key) data[key] = buffer.join(' ').trim();
    key = null;
    buffer = [];
  };

  for (let i = 1; i < end; i++) {
    const line = lines[i].text;
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (pair) {
      flush();
      const [, k, v] = pair;
      if (v === '' || v === '|' || v === '>' || v === '|-' || v === '>-') {
        key = k;
        buffer = [];
      } else {
        data[k] = unquote(v);
      }
      continue;
    }
    if (key && line.trim() !== '') buffer.push(line.trim());
  }
  flush();

  return { frontmatter: data, bodyStart: end + 1 };
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function splitSections(body: RawLine[]): Section[] {
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];

  let current: Section = {
    title: '(preamble)',
    level: 0,
    heading: [],
    startLine: body.length ? body[0].n : 1,
    units: [],
  };
  let buffer: RawLine[] = [];
  let inFence = false;
  let fenceMarker = '';

  const flushUnit = () => {
    const trimmed = trimBlank(buffer);
    buffer = [];
    // Markdown scaffolding (`---`, `***`, a lone `|`) carries no meaning of its
    // own; turning it into a graph node is pure noise, so it never leaves here.
    if (trimmed.length === 0 || isScaffolding(trimmed)) return;
    current.units.push({ kind: kindOf(trimmed), heading: current.heading, lines: trimmed });
  };

  for (const line of body) {
    const fence = FENCE.exec(line.text);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (fence[1] === fenceMarker) {
        inFence = false;
      }
      buffer.push(line);
      continue;
    }

    if (!inFence) {
      const heading = HEADING.exec(line.text);
      if (heading) {
        flushUnit();
        if (current.units.length > 0 || sections.length === 0) sections.push(current);
        const level = heading[1].length;
        const title = heading[2].trim();
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, title });
        current = {
          title,
          level,
          heading: stack.map((s) => s.title),
          startLine: line.n,
          units: [],
        };
        continue;
      }
    }

    if (!inFence && line.text.trim() === '') {
      flushUnit();
      continue;
    }

    if (!inFence && !LIST_ITEM.test(line.text) && !TABLE_ROW.test(line.text) && !QUOTE.test(line.text)) {
      const lastKind = kindOf(buffer);
      if (lastKind === 'code' || buffer.length === 0) {
        buffer.push(line);
        continue;
      }
    }

    buffer.push(line);
  }

  flushUnit();
  if (current.units.length > 0 || sections.length === 0) sections.push(current);

  const merged = sections.map((s) => ({ ...s, units: mergeLeadIns(s.units) }));
  return merged.filter((s) => s.units.length > 0 || s.level > 0);
}

/**
 * "硬触发（用户主动要求）：" followed by a list is one idea, not two. Splitting
 * it produces a dangling caption node that says nothing on its own, so the
 * caption is folded into the list it introduces.
 *
 * The caption and the list are separated by blank lines, so folding them means
 * the merged unit is no longer contiguous with the source. Those gaps are
 * rebuilt here as blank lines: an anchor whose hash does not cover the exact
 * byte range would report drift on a file nobody touched.
 */
function mergeLeadIns(units: Unit[]): Unit[] {
  const out: Unit[] = [];
  for (const unit of units) {
    const prev = out[out.length - 1];
    const isCaption =
      prev &&
      kindOf(prev.lines) === 'paragraph' &&
      kindOf(unit.lines) === 'list' &&
      /[:：]\s*$/.test(prev.lines[prev.lines.length - 1].text.trim()) &&
      prev.lines.every((l) => l.text.trim().length < 120);

    if (isCaption) {
      out[out.length - 1] = {
        kind: 'list',
        heading: prev.heading,
        lines: [...prev.lines, ...gapLines(prev.lines, unit.lines), ...unit.lines],
      };
      continue;
    }
    out.push(unit);
  }
  return out;
}

/** The blank separator between two adjacent units, restored for contiguity. */
function gapLines(before: RawLine[], after: RawLine[]): RawLine[] {
  const from = before[before.length - 1].n + 1;
  const to = after[0].n;
  const gap: RawLine[] = [];
  for (let n = from; n < to; n++) gap.push({ n, text: '' });
  return gap;
}

function trimBlank(lines: RawLine[]): RawLine[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].text.trim() === '') start++;
  while (end > start && lines[end - 1].text.trim() === '') end--;
  return lines.slice(start, end);
}

const RULE_ONLY = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const PIPE_ONLY = /^\s*\|?(?:\s*[-:]+\s*\|)+\s*[-:]+\s*\|?\s*$/;
const BARE_PIPE = /^\s*\|\s*$/;

/** Lines whose only content is markdown furniture, not instruction. */
export function isScaffolding(lines: RawLine[]): boolean {
  const meaningful = lines.filter((l) => l.text.trim() !== '');
  if (meaningful.length === 0) return true;
  if (meaningful.every((l) => RULE_ONLY.test(l.text.trim()) || PIPE_ONLY.test(l.text.trim()) || BARE_PIPE.test(l.text.trim()))) {
    return true;
  }
  // A fence with nothing inside it is punctuation, not a step.
  const fences = meaningful.filter((l) => FENCE.test(l.text)).length;
  return fences === meaningful.length;
}

export function kindOf(lines: RawLine[]): UnitKind {
  if (lines.length === 0) return 'paragraph';
  const first = lines[0].text;
  if (FENCE.test(first)) return 'code';
  if (TABLE_ROW.test(first)) return 'table';
  if (QUOTE.test(first)) return 'quote';
  if (LIST_ITEM.test(first)) return 'list';
  return 'paragraph';
}

/** Strip markdown noise so a label reads like a phrase, not like source. */
export function readable(text: string): string {
  return text
    .replace(FENCE, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
