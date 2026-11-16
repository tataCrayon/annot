/**
 * The agent-facing half of "edit a skill in natural language".
 *
 * Annot deliberately does not call a model. The host agent *is* the model, and
 * it already has the natural-language instruction. What it lacks is the exact
 * bytes to touch — so this command hands over a bounded, anchor-addressed slice
 * of the source plus the rules for editing it, and nothing else. That keeps the
 * loop honest: the agent edits lines it can see, and `annot check` proves it did
 * not disturb a neighbour.
 */

import type { FlowDoc, FlowNode } from './types.ts';

export interface EditContext {
  skill: string;
  /** The whole numbered source, so the model can see what it is inside of. */
  source: { lines: number; sha: string };
  /** The node to change. */
  target: {
    id: string;
    type: string;
    label: string;
    heading: string[];
    start: number;
    end: number;
    sha: string;
  };
  /** Exact original text of that range, 1-based inclusive, newline-joined. */
  original: string;
  /** Neighbouring nodes, so a rewrite can match the author's voice. */
  before?: { id: string; label: string; start: number; end: number };
  after?: { id: string; label: string; start: number; end: number };
  /** Other nodes living under the same heading, most relevant for style. */
  siblings: Array<{ id: string; label: string; start: number; end: number }>;
  rules: string[];
}

export function buildEditContext(doc: FlowDoc, nodeId: string): EditContext | undefined {
  const index = doc.nodes.findIndex((n) => n.id === nodeId);
  if (index === -1) return undefined;
  const target = doc.nodes[index];

  const siblings = doc.nodes
    .filter((n) => n.id !== target.id && sameHeading(n, target))
    .slice(0, 6)
    .map(trim);

  return {
    skill: doc.skill,
    source: { lines: doc.source.lines, sha: doc.source.sha },
    target: {
      id: target.id,
      type: target.type,
      label: target.label,
      heading: target.anchor.heading,
      start: target.anchor.start,
      end: target.anchor.end,
      sha: target.anchor.sha,
    },
    original: target.raw,
    before: doc.nodes[index - 1] ? trim(doc.nodes[index - 1]) : undefined,
    after: doc.nodes[index + 1] ? trim(doc.nodes[index + 1]) : undefined,
    siblings,
    rules: editRules(target),
  };
}

function sameHeading(a: FlowNode, b: FlowNode): boolean {
  return a.anchor.heading.join(' › ') === b.anchor.heading.join(' › ');
}

function trim(n: FlowNode): { id: string; label: string; start: number; end: number } {
  return { id: n.id, label: n.label, start: n.anchor.start, end: n.anchor.end };
}

/**
 * These rules exist because each one corresponds to a failure that makes the
 * resulting graph wrong: adding lines moves every later anchor, adding a
 * heading re-parents everything under it, and padding the range with a blank
 * line silently swallows whatever followed.
 */
function editRules(target: FlowNode): string[] {
  const rules = [
    `只改第 ${target.anchor.start}–${target.anchor.end} 行（1-based，含首尾）。`,
    '保持行数不变，或在末尾增减行——不要在范围内插入前置空行，否则会吞掉下一个单元。',
    '不要改动本范围之外的任何行；若确实需要，另起一次修改并说明原因。',
    '不要新增或删除 markdown 标题（#），那会改变节点的父子归属。',
  ];
  if (target.type === 'gate') {
    rules.push('这是门禁节点：保留命令式语气与"必须/禁止"这类硬约束词，不要改写成建议。');
  }
  if (target.type === 'decision') {
    rules.push('这是判定节点：分支必须穷尽且互斥，用 `A / B / C` 或 `如果…否则…` 明确写出来。');
  }
  if (target.branches.length > 0) {
    rules.push(`本节点已声明分支：${target.branches.map((b) => b.when).join(' / ')}——改动时同步更新，或显式说明为何删掉某个分支。`);
  }
  return rules;
}

export function formatEditContext(ctx: EditContext): string {
  const out: string[] = [];
  out.push(`# 目标：${ctx.skill} / ${ctx.target.id}`);
  out.push('');
  out.push(`小节：${ctx.target.heading.join(' › ') || '(前言)'}`);
  out.push(`类型：${ctx.target.type}    锚点：${ctx.target.start}–${ctx.target.end}    行哈希：${ctx.target.sha.slice(0, 12)}`);
  out.push('');
  out.push('## 原文（请在此基础上改）');
  out.push('```');
  out.push(ctx.original);
  out.push('```');
  out.push('');
  if (ctx.before) out.push(`上文节点：L${ctx.before.start}–${ctx.before.end} ${ctx.before.label}`);
  if (ctx.after) out.push(`下文节点：L${ctx.after.start}–${ctx.after.end} ${ctx.after.label}`);
  if (ctx.before || ctx.after) out.push('');
  if (ctx.siblings.length > 0) {
    out.push('## 同小节的其它节点（对齐语气用）');
    for (const s of ctx.siblings) out.push(`- L${s.start}–${s.end}  ${s.label}`);
    out.push('');
  }
  out.push('## 约束');
  for (const r of ctx.rules) out.push(`- ${r}`);
  out.push('');
  out.push('改完运行 `annot check` 验证锚点；若报 moved 请确认位移来自你的改动，若报 broken 说明目标行已被改掉。');
  return `${out.join('\n')}\n`;
}
