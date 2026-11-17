/**
 * Search is progressive disclosure made literal.
 *
 * A host loads only `name` + `description` for every skill on every turn; the
 * body is fetched only after the model already decided to open that skill. So a
 * query that matches the metadata tier is a materially cheaper hit than one
 * buried in the body — and a body-only hit is often one the reader would never
 * have reached without already knowing the answer.
 *
 * Hence two tiers, and the cheap one is the default:
 *   `metadata` (default)  name · description · headings
 *   `body`                also full text, opt-in
 *
 * Matching is deterministic substring over normalized text. No stemming, no
 * fuzzy distance, no model: the same query returns the same list, which is the
 * only property that makes a search result safe to put in front of a reviewer.
 */

import { readFile } from 'node:fs/promises';

import { discoverSkills, type RootSpec, type SkillRef } from './discover.ts';
import { parseSkill } from './parse.ts';

export type HitField = 'name' | 'description' | 'heading' | 'body';

export interface SkillHit {
  field: HitField;
  /** 1-based line in SKILL.md, when the field has one. */
  line?: number;
  text: string;
}

export interface SkillMatch {
  name: string;
  dir: string;
  file: string;
  rank: number;
  description: string;
  score: number;
  hits: SkillHit[];
}

export interface SearchOptions {
  /** Also search the body. Off by default: metadata is what the host loads. */
  body?: boolean;
  /** Cap on hits returned per skill, so one long file cannot fill the list. */
  maxHits?: number;
}

/** Where a token matched, and therefore what that match is worth. */
const WEIGHTS: Record<HitField, number> = { name: 50, description: 20, heading: 12, body: 6 };

export async function searchSkills(
  roots: RootSpec[],
  query: string,
  options: SearchOptions = {},
): Promise<{ matches: SkillMatch[]; skipped: Array<{ root: string; reason: string }>; query: string; body: boolean }> {
  const tokens = tokenize(query);
  const scanned = await discoverSkills(roots);
  const skipped = [...scanned.skipped];
  const matches: SkillMatch[] = [];

  if (tokens.length === 0) {
    return { matches: [], skipped, query, body: Boolean(options.body) };
  }

  for (const ref of scanned.skills) {
    let text: string;
    try {
      text = await readFile(ref.file, 'utf8');
    } catch {
      skipped.push({ root: ref.file, reason: 'unreadable' });
      continue;
    }

    const match = matchSkill(ref, text, tokens, options);
    if (match) matches.push(match);
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { matches, skipped, query, body: Boolean(options.body) };
}

function matchSkill(ref: SkillRef, text: string, tokens: string[], options: SearchOptions): SkillMatch | undefined {
  const maxHits = options.maxHits ?? 3;
  const parsed = parseSkill(text);
  const name = normalize(ref.name);
  const description = normalize(parsed.description);
  const headings = parsed.sections
    .map((section) => ({ title: section.title, line: section.startLine }))
    .filter((heading) => heading.title.trim() !== '');
  const bodyLines = options.body ? text.replace(/\r\n?/g, '\n').split('\n') : [];

  const hits: SkillHit[] = [];
  let score = 0;
  // Every token must land somewhere, otherwise "audit skill" would return every
  // skill that mentions any one of the words — the classic useless search.
  for (const token of tokens) {
    let best = 0;
    const fieldHits: SkillHit[] = [];

    if (name.includes(token)) {
      best = Math.max(best, WEIGHTS.name + (name === token ? 50 : 0) + (name.startsWith(token) ? 20 : 0));
      fieldHits.push({ field: 'name', text: ref.name });
    }

    if (description.includes(token)) {
      best = Math.max(best, WEIGHTS.description);
      fieldHits.push({ field: 'description', text: parsed.description });
    }

    for (const heading of headings) {
      if (!normalize(heading.title).includes(token)) continue;
      best = Math.max(best, WEIGHTS.heading);
      fieldHits.push({ field: 'heading', line: heading.line, text: heading.title });
      break;
    }

    for (const [index, line] of bodyLines.entries()) {
      if (!normalize(line).includes(token)) continue;
      best = Math.max(best, WEIGHTS.body);
      fieldHits.push({ field: 'body', line: index + 1, text: line.trim().slice(0, 160) });
      break;
    }

    if (best === 0) return undefined;
    score += best;

    for (const hit of fieldHits) {
      if (hits.length >= maxHits) break;
      const duplicate = hits.some((h) => h.field === hit.field && h.line === hit.line && h.text === hit.text);
      if (!duplicate) hits.push(hit);
    }
  }

  return {
    name: ref.name,
    dir: ref.dir,
    file: ref.file,
    rank: ref.rank,
    description: parsed.description,
    score,
    hits,
  };
}

/** Lowercase, strip punctuation, collapse whitespace. Keeps CJK characters. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A query is split on whitespace and punctuation. CJK has no word separator, so
 * a phrase like `技能 审计` is two tokens while `技能审计` stays one — which is
 * the intended reading in both cases.
 */
function tokenize(query: string): string[] {
  return normalize(query).split(' ').filter((token) => token !== '');
}

export function formatSearch(result: { matches: SkillMatch[]; query: string; body: boolean; skipped: Array<{ root: string; reason: string }> }): string {
  const out: string[] = [];
  const tier = result.body ? '名称·描述·标题·正文' : '名称·描述·标题';
  out.push(`${result.matches.length} 个匹配（${tier}）：${result.query || '(空查询)'}\n`);

  if (result.matches.length === 0) {
    out.push('没有匹配。加 --body 可搜索正文。\n');
    return out.join('');
  }

  const width = Math.min(28, Math.max(...result.matches.map((m) => m.name.length)));
  for (const match of result.matches) {
    out.push(`${String(match.score).padStart(4)}  ${match.name.padEnd(width)}  ${truncate(match.description, 46)}`);
    for (const hit of match.hits) {
      const where = hit.line === undefined ? hit.field : `${hit.field}:${hit.line}`;
      out.push(`      ${where.padEnd(15)} ${truncate(hit.text, 64)}`);
    }
  }
  return out.join('\n') + '\n';
}

function truncate(text: string, width: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > width ? `${single.slice(0, width - 1)}…` : single;
}
