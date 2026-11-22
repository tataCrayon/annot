import type {
  AssociationRelation,
  FlowAssociation,
  FlowNode,
  NoteRole,
  SidecarNodePatch,
} from './types.ts';

const STRUCTURAL_TYPES = new Set(['stage', 'decision', 'gate', 'artifact', 'external']);
const GENERIC_HEADINGS = /^(流程|步骤|说明|正文|content|process|steps?|context)$/i;
const GLOBAL_HEADING = /(核心|原则|理念|信念|背景|概述|总览|定位|目的|为什么|适用|principle|philosophy|overview|background|purpose|scope|when to use)/i;

const ROLE_RULES: Array<[NoteRole, RegExp]> = [
  ['reference', /(?:references\/|参考文档|参见|详见|链接|https?:|\breference\b|\bmanual\b|\.md\b)/i],
  ['trigger', /(触发|何时使用|适用|use when|when to use|activation)/i],
  ['definition', /(定义|指的是|是什么|definition|means|concept)/i],
  ['risk', /(风险|失败|踩坑|回退|限制|禁止|fallback|risk|failure|guardrail)/i],
  ['example', /(例如|比如|示例|示例：|for example|example|e\.g\.)/i],
  ['rationale', /(为什么|因为|原因|目的在|why|rationale)/i],
  ['principle', /(原则|理念|信念|核心|规范不是|必须始终|principle|philosophy|core belief)/i],
];

type ManualAssociation = SidecarNodePatch;

/** Infer note role and attach each local explanation to a defensible target. */
export function associateNotes(
  nodes: FlowNode[],
  manual = new Map<string, ManualAssociation>(),
): FlowAssociation[] {
  const targets = nodes.filter((node) => STRUCTURAL_TYPES.has(node.type));
  const associations: FlowAssociation[] = [];
  for (const note of nodes.filter((node) => node.type === 'note')) {
    note.noteRole = noteRoleOf(note);
    const fixed = manual.get(note.id);
    if (fixed?.associationScope === 'skill') {
      markSkillWide(note);
      continue;
    }
    if (fixed?.associationScope === 'unbound') {
      markUnbound(note);
      continue;
    }
    const manualTarget = fixed ? findManualTarget(fixed, targets) : undefined;
    if (manualTarget) {
      note.associationScope = 'node';
      associations.push(association(note, manualTarget, 'same-section', fixed?.associatesWith?.relation, 1));
      continue;
    }
    if (fixed) {
      markUnbound(note);
      continue;
    }
    if (isGlobalNote(note, targets)) {
      markSkillWide(note);
      continue;
    }
    const target = chooseTarget(note, targets);
    if (!target) {
      markUnbound(note);
      continue;
    }
    note.associationScope = 'node';
    associations.push(target.association);
  }
  return associations;
}

function noteRoleOf(note: FlowNode): NoteRole {
  const heading = note.anchor.heading.at(-1) ?? '';
  const evidence = `${heading}\n${note.label}\n${note.text}`;
  return ROLE_RULES.find(([, pattern]) => pattern.test(evidence))?.[0] ?? 'context';
}

function isGlobalNote(note: FlowNode, targets: FlowNode[]): boolean {
  const heading = note.anchor.heading.at(-1) ?? '';
  if (note.anchor.heading.length === 1 &&
    (note.noteRole === 'principle' || note.noteRole === 'rationale') &&
    !targets.some((target) => sameHeading(note, target))) {
    return true;
  }
  if (GLOBAL_HEADING.test(heading)) return true;
  if (/^(?:核心信念|核心原则|基本原则|适用范围|何时使用|skill\s*overview)/i.test(note.label)) return true;
  return /(适用于整个\s*skill|whole skill|全局原则|global principle|skill-wide)/i.test(note.text);
}

function chooseTarget(note: FlowNode, targets: FlowNode[]): { association: FlowAssociation } | undefined {
  const explicit = explicitTarget(note, targets);
  if (explicit) {
    return { association: association(note, explicit.target, 'explicit-reference', undefined, explicit.confidence) };
  }
  const sameSection = targets
    .filter((target) => sameHeading(note, target) && distance(note, target) <= 24)
    .sort((left, right) => targetPriority(note, left) - targetPriority(note, right) ||
      leadInPriority(note, left) - leadInPriority(note, right) ||
      distance(note, left) - distance(note, right));
  if (sameSection[0]) {
    return { association: association(note, sameSection[0], 'same-section', undefined, 0.72) };
  }
  const nearby = targets
    .filter((target) => sharedHeadingDepth(note, target) > 0 && distance(note, target) <= 12)
    .sort((left, right) => distance(note, left) - distance(note, right));
  if (nearby[0]) {
    return { association: association(note, nearby[0], 'nearest-structural', undefined, 0.58) };
  }
  return undefined;
}

function explicitTarget(note: FlowNode, targets: FlowNode[]): { target: FlowNode; confidence: number } | undefined {
  // A target's own section heading is not evidence that the note references it.
  // Including the note's heading made every table inside a shared section look
  // like an explicit cross-reference.
  const haystack = normalize(`${note.label} ${note.text}`);
  const candidates = targets.flatMap((target) => {
    const phrases = [target.anchor.heading.at(-1) ?? '', target.label]
      .map(normalize)
      .filter((phrase) => phrase.length >= 3 && !GENERIC_HEADINGS.test(phrase));
    const hit = phrases.some((phrase) => haystack.includes(phrase));
    return hit ? [{ target, confidence: 0.86 - Math.min(0.2, distance(note, target) / 200) }] : [];
  });
  return candidates.sort((left, right) => right.confidence - left.confidence)[0];
}

function targetPriority(note: FlowNode, target: FlowNode): number {
  if (note.noteRole === 'reference' || note.noteRole === 'rationale' || note.noteRole === 'principle') {
    if (target.type === 'stage') return 0;
    if (target.type === 'artifact') return 1;
    if (target.type === 'gate') return 2;
  }
  if (note.noteRole === 'risk' || note.noteRole === 'trigger') {
    if (target.type === 'gate') return 0;
    if (target.type === 'decision') return 1;
    if (target.type === 'stage') return 2;
  }
  return 3;
}

/** A colon ends a lead-in. When two structural nodes are equally close, the
 * block that follows is usually the one the lead-in introduces. */
function leadInPriority(note: FlowNode, target: FlowNode): number {
  if (!/(?::|：)\s*$/.test(note.text.trim())) return 0;
  return target.anchor.start > note.anchor.end ? 0 : 1;
}

function findManualTarget(
  manual: ManualAssociation,
  targets: FlowNode[],
): FlowNode | undefined {
  const association = manual.associatesWith;
  if (!association) return undefined;
  if (association.toStart !== undefined) return targets.find((target) => target.anchor.start === association.toStart);
  if (association.toLabel) {
    const expected = normalize(association.toLabel);
    return targets.find((target) => normalize(target.label).includes(expected));
  }
  return undefined;
}

function association(
  note: FlowNode,
  target: FlowNode,
  evidence: FlowAssociation['evidence'],
  relation: AssociationRelation | undefined,
  confidence: number,
): FlowAssociation {
  return {
    from: note.id,
    to: target.id,
    relation: relation ?? relationFor(target),
    evidence,
    confidence,
  };
}

function relationFor(target: FlowNode): AssociationRelation {
  if (target.type === 'gate') return 'constrains';
  if (target.type === 'decision') return 'informs';
  if (target.type === 'artifact') return 'explains-output';
  return 'supports';
}

function sameHeading(left: FlowNode, right: FlowNode): boolean {
  return left.anchor.heading.join('\u0000') === right.anchor.heading.join('\u0000');
}

function sharedHeadingDepth(left: FlowNode, right: FlowNode): number {
  let depth = 0;
  while (left.anchor.heading[depth] && right.anchor.heading[depth] &&
    normalize(left.anchor.heading[depth]) === normalize(right.anchor.heading[depth])) {
    depth += 1;
  }
  return depth;
}

function distance(left: FlowNode, right: FlowNode): number {
  if (left.anchor.end < right.anchor.start) return right.anchor.start - left.anchor.end;
  if (right.anchor.end < left.anchor.start) return left.anchor.start - right.anchor.end;
  return 0;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[`*_#|()[\]{}:：,，。.;；!?！？\s-]+/g, '');
}

function markSkillWide(note: FlowNode): void {
  note.associationScope = 'skill';
  note.flags = note.flags.filter((flag) => flag !== 'orphan-note');
}

function markUnbound(note: FlowNode): void {
  note.associationScope = 'unbound';
  if (!note.flags.includes('orphan-note')) note.flags.push('orphan-note');
}
