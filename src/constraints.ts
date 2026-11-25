/**
 * Which card a rule governs.
 *
 * The model had no answer to this question, and the picture said so. All 107
 * shipped gates across the 44 analyses had zero `constrains` associations, so
 * the page could only keep them alive by drawing them "beside the action" —
 * meaning whatever action happened to share their row. For 74 of them that was
 * no action at all: `account-research` opened with a 门禁 card floating alone over
 * an empty row while the workbench header read "0 已关联".
 *
 * Two things fix that, in this order of authority:
 *
 * 1. **The analysis says it outright** — a gate carries `references: [node ids]`.
 *    This module never overrides it. A model that read the prose knows that
 *    `判决必须落地` governs the step that produces a verdict, and knows it without
 *    being told how to segment Chinese.
 * 2. **A deterministic guess fills the gap** when an older proposal has no
 *    `references`, in this order: an exact citation (`见 STEP 3`), a quoted
 *    heading, shared `topics`, then plain document position.
 *
 * The topic term used to be extracted here with character n-grams and inverse
 * frequency. That is a tokenizer built out of substring matching, and on this
 * library it produced both kinds of error: `共同术语：稿每 / 字带 / 底稿每` (a
 * three-way tie between overlapping fragments) and `按原文位置就近挂到 L23`
 * (no signal at all). Segmentation is a semantic judgement, so it belongs to the
 * host model; `topics` is where it lands. What remains here is arithmetic and
 * structure — no vocabulary of its own.
 *
 * Nothing in this module decides whether a card is a gate, or what it is about.
 */

import type { AssociationRelation, FlowAssociation, FlowNode } from './types.ts';

/**
 * Cards a rule can govern. An artifact counts: a rule such as "DDL 给可执行完整 SQL"
 * is about the DDL artifact, and binding it to the step that writes the file
 * would be a weaker statement than the source makes. Notes do not count: a note
 * explains, so a rule cannot be said to constrain it.
 */
const EXECUTABLE: ReadonlySet<FlowNode['type']> = new Set(['stage', 'decision', 'external', 'artifact']);

/**
 * A section whose title says "this block is rules".
 *
 * Deliberately narrow: `规范` / `标准` / `清单` look like rule words but head
 * ordinary steps ("按规范执行"), and treating them as rule sections scoped whole
 * capabilities to nothing. The words below are the only ones that introduce
 * standing conditions and nothing else.
 */
const RULE_SECTION = /规则|门禁|约束|红线|铁律|原则|信念|不可协商/;

interface Section {
  id: string;
  title: string;
  level: number;
  start: number;
}

export interface ConstraintBinding {
  /** The gate's id. */
  from: string;
  /** The card it governs. */
  to: string;
  relation: AssociationRelation;
  confidence: number;
  /** One line the reader can check against the source. */
  evidence: string;
}

/** The `##`/`#` section a line falls in. Same level-≤2 rule the page draws with. */
function sectionAt(sections: Section[], line: number): Section | undefined {
  let current: Section | undefined;
  for (const section of sections) {
    if (section.level <= 2 && section.start <= line) current = section;
  }
  return current;
}

/** Topics, normalised so `DDL` and `ddl` are the same topic. */
function topicsOf(node: FlowNode): string[] {
  return (node.topics ?? []).map((topic) => topic.trim().toLowerCase()).filter(Boolean);
}

/**
 * How much a shared topic says.
 *
 * A topic on every card of a procedural Skill (`流程`, `skill`) distinguishes
 * nothing; a topic on three cards distinguishes a lot. This is inverse document
 * frequency over the *model's* topics, so the weights describe this document and
 * nothing else — no corpus, no stopword list, no guess about what a word means.
 */
function topicWeights(byCard: Map<string, string[]>): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const topics of byCard.values()) {
    for (const topic of topics) frequency.set(topic, (frequency.get(topic) ?? 0) + 1);
  }
  const total = byCard.size;
  const weights = new Map<string, number>();
  for (const [topic, count] of frequency) weights.set(topic, Math.log((total + 1) / (count + 1)));
  return weights;
}

/** Numbers the rule points at: `STEP 3`, `第 2 步`, `四层`, `9 步`. */
function referencedNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/(?:step|phase|第)\s*([0-9]+)/gi)) numbers.add(Number(match[1]));
  const chinese: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  for (const match of text.matchAll(/([一二三四五六七八九十])\s*(?:层|步|条|项|段|种)/g)) numbers.add(chinese[match[1]]);
  return numbers;
}

/**
 * The citation markers a line of prose uses to point at another line.
 *
 * Only explicit forms: `#3`, `见 STEP 3`, `按 2 步`. A bare `STEP 0 SCOPE`
 * quoted inside a rule's prose is a mention of the step's name, not an arrow
 * back to it, so a `STEP N` followed by a title does not count. Without this
 * restraint `七条硬信念` — which lists `9 步` — bound itself to Step 1.
 */
function citationsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/[#＃]\s*([0-9]+)/g)) found.push(match[1]);
  for (const match of text.matchAll(/(?:见|按|依|参照|遵循|符合|满足|对照)\s*(?:第\s*)?([0-9]+)\s*(?:步|层|条|段|项|阶段)/g)) found.push(match[1]);
  for (const match of text.matchAll(/(?:step|phase|阶段)\s*([0-9]+)(?!\s*[A-Za-z])/gi)) found.push(match[1]);
  const chinese: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  for (const match of text.matchAll(/(?:见|按|符合|满足|遵循)([一二三四五六七八九十])\s*(?:层|步|条|段|项)/g)) found.push(String(chinese[match[1]]));
  return found;
}

/**
 * Does the rule speak for the whole Skill?
 *
 * A gate whose own section is `## 硬信念` / `## 红线` / `## 验证清单` is not a
 * remark on the next card: it is the author's standing condition on everything
 * the Skill does. Binding it to whichever step happens to follow is exactly the
 * "rule beside a step it does not govern" mistake this module exists to remove,
 * so it is reported as unowned and the caller marks the gate itself Skill-wide.
 *
 * No minimum heading length here: `硬信念`, `红线`, `铁律` are three characters and
 * are the strongest versions of this signal.
 */
function speaksForWhole(gate: FlowNode): boolean {
  const heading = gate.anchor.heading.at(-1) ?? '';
  return RULE_SECTION.test(heading);
}

/** Does the rule quote this card's heading? */
function namesCard(rule: string, card: FlowNode): boolean {
  const heading = card.anchor.heading.at(-1) ?? '';
  // Six characters is the point where an exact mention stops being an accident:
  // `硬信念（7 条，违反即报告作废）` is a name, `规则` is a word.
  return heading.length >= 6 && rule.includes(heading);
}

/** Does the rule cite this card by its step number? */
function citesCard(rule: string, card: FlowNode): boolean {
  const heading = card.anchor.heading.at(-1) ?? '';
  const cited = new Set(citationsIn(rule));
  for (const number of cited) {
    if (referencedNumbers(heading).has(Number(number))) return true;
  }
  return false;
}

/** Distance in lines between a gate and a card, whichever is above. */
function distance(gate: FlowNode, card: FlowNode): number {
  return gate.anchor.start >= card.anchor.end
    ? gate.anchor.start - card.anchor.end
    : card.anchor.start - gate.anchor.end;
}

/** Nearest card in the document, preferring the one above on a tie. */
function nearestCard(gate: FlowNode, targets: FlowNode[]): FlowNode | undefined {
  return [...targets].sort((left, right) => {
    const byDistance = distance(gate, left) - distance(gate, right);
    if (byDistance !== 0) return byDistance;
    return right.anchor.start <= gate.anchor.start ? -1 : 1;
  })[0];
}

/**
 * Bind every gate to the card it governs.
 *
 * Returns one binding per gate that has a defensible owner. A gate with no
 * executable card anywhere is left out on purpose: nothing to govern.
 */
export function bindConstraints(nodes: FlowNode[], sections: Section[]): ConstraintBinding[] {
  const gates = nodes.filter((node) => node.type === 'gate');
  const targets = nodes.filter((node) => EXECUTABLE.has(node.type));
  if (gates.length === 0 || targets.length === 0) return [];

  const topicsByCard = new Map(targets.map((card) => [card.id, topicsOf(card)]));
  const weights = topicWeights(topicsByCard);
  const bindings: ConstraintBinding[] = [];

  for (const gate of gates) {
    const rule = `${gate.label} ${gate.text}`;

    // 0. A rule section's card speaks for the Skill, not for a neighbour. This
    //    has to come first: a `## 硬信念` card sits next to the first step in the
    //    document, and "nearest card" would bind it to that step every time.
    if (speaksForWhole(gate)) continue;

    // 1. The rule points at a card: by quoted heading, or by an explicit
    //    citation. A gate that quotes its own heading is a section in card form,
    //    not a reference to itself, so a self-match is dropped.
    const named = targets.filter((card) => card.id !== gate.id && (namesCard(rule, card) || citesCard(rule, card)));
    if (named.length > 0) {
      const target = [...named].sort((left, right) => distance(gate, left) - distance(gate, right))[0];
      bindings.push({
        from: gate.id,
        to: target.id,
        relation: 'constrains',
        confidence: 0.85,
        evidence: `规则点名了「${target.anchor.heading.at(-1) ?? target.id}」`,
      });
      continue;
    }

    // 2. Shared topics. Both sides are the model's own words, so the score is a
    //    fact about agreement, not a guess about language.
    const gateTopics = new Set(topicsOf(gate));
    let best: { card: FlowNode; score: number; shared: string[] } | undefined;
    if (gateTopics.size > 0) {
      for (const card of targets) {
        let score = 0;
        const shared: string[] = [];
        for (const topic of topicsByCard.get(card.id) ?? []) {
          if (!gateTopics.has(topic)) continue;
          const weight = weights.get(topic) ?? 0;
          if (weight <= 0) continue;
          score += weight;
          shared.push(topic);
        }
        if (score === 0) continue;
        // Position anchors the tie: a rule and the step it governs are usually
        // written next to each other, so the closer card wins a topic tie.
        const closer = best === undefined || score > best.score
          || (score === best.score && distance(gate, card) < distance(gate, best.card));
        if (closer) best = { card, score, shared };
      }
    }
    if (best) {
      bindings.push({
        from: gate.id,
        to: best.card.id,
        relation: 'constrains',
        confidence: 0.75,
        evidence: `共享主题：${best.shared.join(' / ')}`,
      });
      continue;
    }

    // 3. Nothing in the words connects them. The rule was still written next to
    //    this card, and that is evidence — weaker than topics, not nothing.
    const nearest = nearestCard(gate, targets);
    if (!nearest) continue;
    bindings.push({
      from: gate.id,
      to: nearest.id,
      relation: 'constrains',
      confidence: gateTopics.size > 0 ? 0.55 : 0.5,
      evidence: `按原文位置就近挂到 L${nearest.anchor.start}（这张门禁没有 topics，建议重新分析）`,
    });
  }
  return bindings;
}

/**
 * Give every gate an owner, keeping the analysis's own answer when it gave one.
 *
 * The analysis's `references` is authoritative and is applied by the caller
 * before this runs; this only fills the gates left over. A gate that speaks for
 * the whole Skill is skipped — the caller marks it `associationScope: 'skill'`.
 */
export function attachConstraints(
  nodes: FlowNode[],
  sections: Section[],
  associations: FlowAssociation[],
): FlowAssociation[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const scoped = new Set(nodes.filter((node) => node.type === 'gate' && node.associationScope === 'skill').map((node) => node.id));
  const bound = new Set(
    associations
      .filter((association) => byId.get(association.from)?.type === 'gate')
      .map((association) => association.from),
  );
  const missing = nodes.filter((node) => node.type === 'gate' && !bound.has(node.id) && !scoped.has(node.id));
  if (missing.length === 0) return associations;

  // Bind against the whole document, not just the gates that need an owner: the
  // owner is one of the executable cards, and passing only the gates would leave
  // every one of them with no candidate target.
  const added = bindConstraints(nodes, sections)
    .filter((binding) => missing.some((gate) => gate.id === binding.from))
    .map((binding): FlowAssociation => ({
      from: binding.from,
      to: binding.to,
      relation: binding.relation,
      evidence: 'same-section',
      confidence: binding.confidence,
      rationale: binding.evidence,
    }));
  return [...associations, ...added];
}
