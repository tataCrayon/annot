/**
 * Turning units into a graph is the one place annot guesses, so every guess
 * carries a confidence and a rule name. A human overrides the guess through
 * the sidecar; annot never learns from the override, it only obeys it.
 */

import { maxDepthOf } from './depth.ts';
import { kindOf, linesSha, readable, type ParsedSkill, type RawLine, type Unit } from './parse.ts';
import { associateNotes } from './associations.ts';
import type {
  Branch,
  FlowDoc,
  FlowEdge,
  FlowNode,
  Lane,
  NodeFlag,
  NodeType,
  Sidecar,
  SidecarNodePatch,
} from './types.ts';

interface Rule {
  type: NodeType;
  confidence: number;
  why: string;
}

const GATE_WORDS = /禁止|不得|红线|门禁|铁律|必须|绝不允许|never|must not|do not|refuse to|stop and/gi;
const DECISION_WORDS = /如果|若|否则|取决于|分支|选择|判定|判断|裁决|分支条件|if\b|when\b|else\b|depends on|choice|branch/gi;
const ARTIFACT_WORDS = /输出|产物|模板|格式|报告|卡片|artifact|output|template|format|report/gi;
const EXTERNAL_WORDS = /工具|调用|spawn|subagent|web_?search|web_?fetch|bash|read\b|write\b|grep|glob|mcp|api\b/gi;
/**
 * Hard boundaries are nodes in their own right. Before this pattern, ordinary
 * paragraphs lost the "gate versus instruction" race simply because they used
 * one strong phrase instead of repeating two generic words.
 */
const HARD_GATE_WORDS = /一律拒绝|只允许|互相?不通用|代替不了|会\s*403|极易误判|先确认|必须同时|绝不允许|禁止|不得|must not|refuse to|stop and/i;
/** A result line gives the output shape; it is evidence, not the action that produced it. */
const OUTPUT_LEAD = /^(?:脚本)?输出\s*[:：]|^返回\s*[:：]|^结果\s*[:：]|^rows\s*=|^status\s*(?:!=|==|=)|^error\s*(?:!=|==|=)/i;
/**
 * The leading verb is the evidence that a stage is an action, not a fact.
 * Chinese words need no `\b`: JavaScript defines that boundary around ASCII
 * word characters, so `读取` followed by more Chinese could never match.
 */
const ACTION_LEAD = /^(?:(?:请|先|再|然后|随后|接着|最后|立即|务必|优先|尝试|开始|继续|按|依照|根据|从|向|对|把|将|用|通过|基于|针对|一句话|沿[^，,。；;\n]{0,20}|逐项)\s*)*(?:(?:选择|读取|获取|列出|列|查看|查询|核实|检查|核对|确认|验证|创建|新建|生成|提交|调用|运行|执行|保存|记录|返回|输出|拒绝|停止|加载|改写|比较|对比|合并|安装|打开|连接|请求|发送|提取|扫描|分析|审查|评审|评估|定位|处理|更新|复制|分类|归类|整理|拆分|判定|判断|判决|同步|拉取|推送|部署|回滚|修复|设置|配置|使用|编写|写|修改|改|删除|移除|标记|标注|汇总|填写|划定|收集|询问|咨询|决定|解析|渲染|上传|下载|发布|注册|登录|授权|鉴权|迁移|导入|导出|排序|过滤|匹配|构建|编译|测试|拉起|重启|说清|发问)|(?:(?:read|write|check|create|update|run|execute|fetch|pull|push|deploy|review|scan|search|generate|compare|validate|verify|inspect|list|load|save|use|open|call|request)(?=\b|\s|$)))/i;
/** A permission paired with a hard responsibility limit is still a gate. */
const CONDITIONAL_GATE = /(?:但|同时)必须[^。！？\n]{0,100}(?:不能|不得|禁止|拒绝)/i;
/** Normative acceptance and size limits constrain an action even without a deny verb. */
const EXPLICIT_CONSTRAINT = /(?:必须[^。！？\n]{0,80}(?:可回答|可证伪|可验证|可执行|满足|至少|至多|保持|避免)|(?:控制在|限制在|保持在)\s*\d+\s*(?:行|字|句|步|个|秒|分钟)(?:以内|内|以下)?)/i;
const ORDERED_ITEM = /^\s*\d+[.)]\s+/;
/** Short leading labels such as `只读：` are useful metadata, but the gate itself should start with its rule. */
const GATE_LEAD = /^(?:安全红线|红线|限制|注意|只读)\s*[:：]\s*(?=只允许|仅允许|禁止|不得|拒绝|必须|保持|确认)/i;
const BRANCH_ARM = /^\s*(?:[-*+]|\d+[.)])?\s*(?:✅|❌|🔧|🔁|🧪|→|⇒|=>)\s*/u;
// No `\b` after the CJK half: JS word boundaries are ASCII-based, so `\b如果`
// never matches and every Chinese conditional was silently ignored.
const BRANCH_COND = /^\s*(?:[-*+]|\d+[.)])?\s*(?:if\b|when\b|如果|若|当)/i;
const INLINE_ELSE = /[:：]\s*(.+?)\s*[;；]\s*(?:否则|else)\s*(.+?)\s*$/i;
const PINNED_MARKER = /<!--\s*sf:([a-z0-9_-]+)\s*-->/i;
const TABLE_DATA_ROW = /^\s*\|/;
const OUTCOME_HEADER = /^(?:结果|结论|判决|裁决|选择|决定|分支|result|outcome|verdict|choice|decision|branch)$/i;
/** A fenced block's first line is a language tag, never a step name. */
const CODE_TAG = /^(?:bash|sh|shell|zsh|fish|json|jsonc|javascript|js|typescript|ts|tsx|jsx|python|py|yaml|yml|toml|sql|http|text|txt|markdown|md|diff|xml|html|css|go|java|rust|rb|php|console|powershell|ps1|bat|cmd|ini|conf|env|dockerfile|makefile|mermaid|csv|graphql|proto|nix|lua|perl|r|swift|kotlin|scala|dart|elixir|erlang|haskell|clj|vim|tex)$/i;
/** Steps the model itself performs, rather than the reader or a command. */
const MODEL_WORDS = /让模型|模型自己|由模型|LLM|让 AI|AI 自己|自行判断|自主判断/i;
/** A heading that names a stage of the pipeline rather than a topic. */
const PHASE_HEADING = /^(?:phase|阶段|步骤|step|part|第\s*[一二三四五六七八九十\d]+\s*(?:阶|步|段|部分))(?:\s|[:：]|$)/i;
/**
 * How much of the source a label may keep before the extractor cuts it.
 *
 * The card wraps a label to three lines of 360px at 13px, which is about 83 CJK
 * characters — so the old ceiling of 48 cut every long step a full line early.
 * Measured on `release-checklist`, 18 of 34 labels ended in an ellipsis at 48.
 */
const LABEL_MAX = 72;
const SUBTITLE_MAX = 56;

export interface BuildOptions {
  sidecar?: Sidecar;
  sourceFile?: string;
  now?: () => string;
}

/** A unit, or one line of a pipeline the author wrote inside a fenced block. */
interface Segment {
  lines: RawLine[];
  type?: NodeType;
  label?: string;
  branches?: Branch[];
}

const PIPELINE_LINE = /^\s*([A-Z][A-Z0-9_/ ]{1,24}?)\s*(?:—|–|→|:|\s-\s)\s*(.+)$/;
const ARROW_CHAIN = /^\s*(.+?)\s*(?:→|⇒|=>)\s*(.+?)\s*$/;
const ARROW_CONTINUATION = /^\s*(?:→|⇒|=>)\s*(.+)$/;

/**
 * Authors habitually write their real pipeline inside a fenced block
 * (`STATE — …`, `IDEA → REQUIREMENT → …`). Rendering that as one opaque box
 * throws away the only structural truth the file contains, so those blocks are
 * expanded into one node per stage, each with its own single-line anchor.
 */
function segment(unit: Unit): Segment[] {
  if (kindOf(unit.lines) === 'list') {
    const actions = actionListSegments(unit);
    if (actions.length > 0) return actions;
  }

  const isCode = kindOf(unit.lines) === 'code';
  if (!isCode) return [{ lines: unit.lines }];

  const inner = unit.lines.filter((l) => !/^\s*(```|~~~)/.test(l.text) && l.text.trim() !== '');
  if (inner.length < 2) return [{ lines: unit.lines }];

  // Shape A: one `LABEL — text` per line, optionally followed by continuation
  // lines that belong to the line above.
  //
  // The earlier test required *every* line to match, which meant one added
  // bullet under `VERDICT — 逐项判决` collapsed a four-step pipeline into a
  // single card. A continuation line is indentation for the step above it, so
  // it joins that step's anchor instead of dissolving the split.
  const pipeline = inner.map((l) => PIPELINE_LINE.exec(l.text));
  if (pipeline.filter(Boolean).length >= 2) {
    const segments: Segment[] = [];
    for (const [i, line] of inner.entries()) {
      const m = pipeline[i];
      if (m) {
        segments.push({
          lines: [line],
          type: 'stage' as const,
          label: `${m[1]} — ${truncate(readable(m[2]), 60)}`,
        });
        continue;
      }
      const last = segments[segments.length - 1];
      if (last) last.lines.push(line);
      else segments.push({ lines: [line], type: 'stage' as const, label: readable(line.text) });
    }
    return segments;
  }

  // Shape B: a multi-line arrow chain, where continuation lines start with an
  // arrow. The arrow is indentation, not content: it is stripped before the
  // label is built, otherwise every stage reads as "→ …".
  const continuations = inner.filter((l) => ARROW_CONTINUATION.test(l.text)).length;
  if (continuations >= 2) {
    const numbered: Segment[] = [];
    for (const line of inner) {
      const stripped = line.text.replace(ARROW_CONTINUATION, '$1').replace(ARROW_CHAIN, '$1');
      const label = readable(stripped);
      if (!label) continue;
      numbered.push({
        lines: [{ n: line.n, text: line.text }],
        type: 'stage',
        label: `${numbered.length + 1}. ${truncate(label, 56)}`,
      });
    }
    if (numbered.length >= 2) return numbered;
  }

  // Shape C: a single line holding the whole chain.
  const chain = inner.length === 1 ? splitArrowChain(inner[0]) : [];
  if (chain.length >= 2) return chain;

  return [{ lines: unit.lines }];
}

/** `idea → requirement → method → decision` on one line is a pipeline too. */
function actionListSegments(unit: Unit): Segment[] {
  const items = listItemSegments(unit.lines);
  if (items.length < 2) return [];
  const ordered = items.every((item) => ORDERED_ITEM.test(item[0].text));
  if (!ordered) return [];
  const actionable = items.filter((lines) => hasActionEvidence(lines.map((line) => readable(line.text)).join(' ')));
  return actionable.length >= 2 && actionable.length / items.length >= 0.75
    ? items.map((lines) => ({ lines, type: 'stage' as const }))
    : [];
}

/** Group a list into contiguous item ranges, excluding an optional lead-in. */
function listItemSegments(lines: RawLine[]): RawLine[][] {
  const out: RawLine[][] = [];
  for (const line of lines) {
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line.text)) out.push([line]);
    else if (out.length > 0) out[out.length - 1].push(line);
  }
  return out.filter((item) => item[0] && item[0].text.trim() !== '');
}

function splitArrowChain(line: RawLine): Segment[] {
  const parts = line.text.split(/\s*(?:→|⇒|=>)\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  return parts.map((part, i) => ({
    lines: [{ n: line.n, text: part }],
    type: 'stage' as const,
    label: `${i + 1}. ${truncate(readable(part), 56)}`,
  }));
}

export function buildFlow(skill: ParsedSkill, rawText: string, options: BuildOptions = {}): FlowDoc {
  const nodes: FlowNode[] = [];
  const used = new Map<string, number>();
  const tableBranchSources = new Set<string>();
  const manualAssociations = new Map<string, SidecarNodePatch>();

  for (const section of skill.sections) {
    for (const unit of section.units) {
      for (const piece of segment(unit)) {
        // `segment()` returns pieces of one unit, so every derived fact below
        // describes the same source range the anchor does.
        const part: Unit = { kind: kindOf(piece.lines), heading: section.heading, lines: piece.lines };
        const rule = classifyDeclared(piece, part);
        const anchor = {
          heading: section.heading,
          start: piece.lines[0].n,
          end: piece.lines[piece.lines.length - 1].n,
          sha: linesSha(piece.lines),
        };
        const patch = matchSidecar(options.sidecar, part, anchor);
        if (patch?.ignore) continue;

        const type = patch?.type ?? rule.type;
        const autoLabel = normalizeStageActionLabel(
          part,
          type,
          piece.label ?? buildLabel(part, type),
        );
        const label = patch?.rename ?? autoLabel;
        const id = uniqueId(label, used);
        const text = piece.lines.map((l) => readable(l.text)).filter(Boolean).join(' ').slice(0, 400);
        const raw = piece.lines.map((l) => l.text).join('\n');
        const tableBranches = outcomeBranches(part);
        const branches = dedupeBranches([
          ...extractBranches(part, type, tableBranches),
          ...(piece.branches ?? []),
          ...(patch?.branches ?? []),
        ]);

        if (tableBranches.length > 0) tableBranchSources.add(id);

        nodes.push({
          id,
          type,
          label,
          // A human rename means a human knows what the card says; do not
          // second-guess it with a machine subtitle.
          subtitle: patch?.rename ? undefined : buildSubtitle(part, label),
          lane: laneOf(part, type),
          phase: phaseOf(section.heading),
          text,
          raw,
          anchor,
          branches,
          confidence: patch?.confirm ? 1 : patch?.type || patch?.rename ? Math.max(rule.confidence, 0.9) : rule.confidence,
          rule: rule.why,
          source: patch ? 'sidecar' : 'extractor',
          flags: [],
        });
        if (patch?.associatesWith || patch?.associationScope) {
          manualAssociations.set(id, {
            ...patch.associatesWith,
            associationScope: patch.associationScope,
          });
        }
      }
    }
  }

  const associations = associateNotes(nodes, manualAssociations);
  const edges = linkEdges(nodes);
  applyBranchTargets(nodes, edges, tableBranchSources);
  dropImplicitAlternativeSequences(nodes, edges, tableBranchSources);
  const stats = computeFlowStats(nodes, edges, associations);

  return {
    skill: skill.name,
    description: skill.description,
    source: {
      file: options.sourceFile ?? 'SKILL.md',
      sha: skill.sha,
      lines: skill.totalLines,
      generated_at: (options.now ?? (() => new Date().toISOString()))(),
      method: 'rules',
    },
    schema_version: 1,
    nodes,
    edges,
    associations,
    sections: skill.sections.map((s, i) => ({
      id: `s${i}`,
      title: s.title,
      level: s.level,
      start: s.startLine,
    })),
    phases: computeFlowPhases(nodes),
    stats,
  };
}

/**
 * A declared pipeline gives the split shape, but its labels still have to
 * describe an action. `OUTPUT — …` and `IDEA → REQUIREMENT` are structure,
 * not instructions to the reader, so the content after the marker decides the
 * node type.
 */
/**
 * A declared marker (STATE, ATTACK, VERDICT) names a slot in the author's
 * pipeline; the card should name the action performed in that slot. Only
 * action-backed bodies lose the marker, so other declarations keep their
 * source wording instead of gaining an invented verb.
 */
function normalizeStageActionLabel(unit: Unit, type: NodeType, fallback: string): string {
  if (type !== 'stage') return fallback;
  const first = unit.lines[0];
  const pipeline = first ? PIPELINE_LINE.exec(first.text) : null;
  if (!pipeline || !hasActionEvidence(pipeline[2])) return fallback;
  return truncate(normalizeLabel(pipeline[2], 'stage'), LABEL_MAX) || fallback;
}

function classifyDeclared(piece: Segment, part: Unit): Rule {
  if (!piece.type) return classify(part);
  const first = part.lines[0];
  if (!first) return classify(part);
  const pipeline = PIPELINE_LINE.exec(first.text);
  const cleaned = pipeline
    ? pipeline[2]
    : first.text
        .replace(ARROW_CONTINUATION, '$1')
        .replace(ARROW_CHAIN, '$1');
  const rule = classify({
    ...part,
    lines: [{ ...first, text: cleaned }, ...part.lines.slice(1)],
  });
  return rule.type === piece.type
    ? { ...rule, confidence: Math.max(rule.confidence, 0.82), why: 'declared-action' }
    : rule;
}

function classify(unit: Unit): Rule {
  const text = unit.lines.map((l) => l.text).join('\n');
  const kind = kindOf(unit.lines);

  if (PINNED_MARKER.test(text)) {
    const guess = kindOfAfterMarker(text);
    return { type: guess ?? 'stage', confidence: 0.95, why: 'pinned-marker' };
  }

  if (kind === 'code') {
    if (BRANCH_ARM.test(text) || /分支|决策|判决/.test(text)) {
      return { type: 'decision', confidence: 0.7, why: 'code-with-arms' };
    }
    const executable = unit.lines
      .map((line) => line.text)
      .filter((line) => line.trim() !== '' && !/^\s*#/.test(line) && !/^\s*(```|~~~)/.test(line))
      .join('\n');
    if (HARD_GATE_WORDS.test(executable)) return { type: 'gate', confidence: 0.8, why: 'code-gate' };
    if (count(EXTERNAL_WORDS, text) > 0) {
      return { type: 'external', confidence: 0.55, why: 'code-with-calls' };
    }
    return { type: 'artifact', confidence: 0.6, why: 'code-block' };
  }

  if (kind === 'table') {
    const headerRow = unit.lines[0].text;
    const header = headerRow.replace(/^\s*\|/, '').split('|').map((c) => c.trim().replace(/[*`]/g, '')).filter(Boolean);
    const rows = unit.lines.filter((l) => TABLE_DATA_ROW.test(l.text)).length;

    if (outcomeBranches(unit).length > 0) {
      return { type: 'decision', confidence: 0.8, why: 'table-of-outcomes' };
    }

    if (header.some((c) => /^(模式|mode|分支|branch)$/i.test(c))) {
      return { type: 'decision', confidence: 0.75, why: 'table-of-modes' };
    }
    if (header.some((c) => /判决|决定|选择|分支|决策|decision|verdict|choice|裁决/i.test(c))) {
      return { type: 'decision', confidence: 0.75, why: 'table-of-choices' };
    }
    if (header.some((c) => /^(阶段|步骤|step|stage|流程)$/i.test(c)) && rows >= 3) {
      return { type: 'stage', confidence: 0.8, why: 'table-of-stages' };
    }
    return { type: 'artifact', confidence: 0.55, why: 'reference-table' };
  }

  const gateHits = count(GATE_WORDS, text);
  const decisionHits = count(DECISION_WORDS, text);

  if (HARD_GATE_WORDS.test(text)) return { type: 'gate', confidence: 0.8, why: 'hard-gate' };
  if (CONDITIONAL_GATE.test(text)) return { type: 'gate', confidence: 0.78, why: 'conditional-gate' };
  if (EXPLICIT_CONSTRAINT.test(text)) return { type: 'gate', confidence: 0.78, why: 'explicit-constraint' };
  if (OUTPUT_LEAD.test(unit.lines[0]?.text.trim() ?? '')) {
    return { type: 'artifact', confidence: 0.8, why: 'output-line' };
  }
  if (gateHits >= 2) return { type: 'gate', confidence: 0.75, why: 'gate-words' };
  if (decisionHits >= 2 && decisionHits > gateHits) {
    return { type: 'decision', confidence: 0.7, why: 'decision-words' };
  }
  if (kind === 'list') {
    const items = listItemSegments(unit.lines);
    const actionItems = items.filter((lines) => hasActionEvidence(lines.map((line) => readable(line.text)).join(' ')));
    if (actionItems.length > 0) {
      return { type: 'stage', confidence: items.length > 12 ? 0.55 : 0.75, why: items.length > 12 ? 'long-action-list' : 'action-list' };
    }
  }
  if (hasActionEvidence(text)) return { type: 'stage', confidence: 0.7, why: 'action-evidence' };
  return { type: 'note', confidence: 0.55, why: 'non-action-context' };
}

function kindOfAfterMarker(text: string): NodeType | undefined {
  const m = /<!--\s*sf:[a-z0-9_-]+\s+(gate|decision|artifact|external|stage|note)\s*-->/i.exec(text);
  return (m?.[1] as NodeType | undefined) ?? undefined;
}

function count(re: RegExp, text: string): number {
  re.lastIndex = 0;
  const m = text.match(re);
  return m ? m.length : 0;
}

function buildLabel(unit: Unit, type: NodeType): string {
  const cells = unit.lines
    .filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l.text))
    .map((l) => readable(l.text).replace(/\s*\|\s*/g, ' · '))
    .filter(meaningful);

  if (kindOf(unit.lines) === 'table') {
    const header = cells[0] ?? type;
    return truncate(header, LABEL_MAX) || type;
  }

  // A fenced block's first line is the fence itself. Reading it as the label
  // produced cards titled "bash" and "json" — the language tag, not the step.
  // Six of 92 nodes in four real skills did this, and the whole command was
  // invisible underneath.
  const content = cells.filter((c) => !CODE_TAG.test(c));
  if (kindOf(unit.lines) === 'code' && type === 'external') {
    const commandLabel = describeCodeActions(unit);
    if (commandLabel) return truncate(commandLabel, LABEL_MAX);
  }

  const candidates = labelCandidates(unit, content);
  if (type === 'stage') {
    const action = candidates.find((candidate) => hasActionEvidence(candidate));
    if (action) return truncate(normalizeLabel(action, type), LABEL_MAX);
  }
  const first = candidates[0] ?? cells[0] ?? type;
  const best = candidates
    .map((candidate, index) => ({
      candidate: normalizeLabel(candidate, type),
      index,
      score: candidateScore(candidate, type),
    }))
    .filter((entry) => entry.candidate.length > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  let label = best?.candidate ?? stripHeadingMark(first);
  if (kindOf(unit.lines) === 'code' && type === 'gate' && /必须同时带$/.test(label)) {
    const detail = candidates[best.index + 1];
    if (detail) label += ` ${normalizeLabel(detail, 'gate')}`;
  }
  return truncate(label, LABEL_MAX) || type;
}

/** Sentence-sized candidates keep a useful action from disappearing inside a long paragraph. */
function labelCandidates(unit: Unit, content: string[]): string[] {
  if (kindOf(unit.lines) === 'code') return content;
  // A list is one source unit, but its first line names the contract a reader
  // should see first. Later bullets stay verbatim in the anchored raw text.
  const lines = kindOf(unit.lines) === 'list' ? content.slice(0, 1) : content;
  return lines.flatMap((line) => {
    const sentences = line.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [line];
    return sentences.map((sentence) => sentence.trim()).filter(Boolean);
  });
}

/**
 * A command block often starts with environment setup and comments. The setup
 * variable is not the action; the comments name the operations the block offers.
 */
function describeCodeActions(unit: Unit): string | undefined {
  const inner = unit.lines
    .map((line) => line.text.trim())
    .filter((line) => line !== '' && !/^(```|~~~)/.test(line));
  const comments = inner
    .filter((line) => /^#+\s*\S/.test(line))
    .map((line) => readable(line).replace(/^#+\s*/, '').trim())
    .filter((line) => line.length > 0 && !CODE_TAG.test(line));
  const uniqueComments = [...new Set(comments)];
  if (uniqueComments.length > 0) return uniqueComments.join(' / ');

  const command = inner.find((line) => !/^(?:[A-Z_][A-Z0-9_]*=|\S+\s*=)/.test(line));
  return command ? stripHeadingMark(readable(command)) : undefined;
}

function candidateScore(text: string, type: NodeType): number {
  const clean = stripHeadingMark(text).trim();
  let score = 0;
  if (type === 'stage' && hasActionEvidence(clean)) score += 12;
  else if (ACTION_LEAD.test(clean)) score += 3;
  if (HARD_GATE_WORDS.test(clean)) score += type === 'gate' ? 12 : 1;
  if (CONDITIONAL_GATE.test(clean)) score += type === 'gate' ? 10 : 1;
  if (OUTPUT_LEAD.test(clean)) score += type === 'artifact' ? 14 : -18;
  if (type === 'gate' && /先确认|只允许|一律拒绝|禁止|不得|代替不了|互不通用|会\s*403/i.test(clean)) score += 5;
  if (type === 'decision' && count(DECISION_WORDS, clean) > 0) score += 5;
  if (/^[#>*\s]*(?:背景|说明|概览|示例|注意)[:：]/.test(clean)) score -= 3;
  if (clean.length >= 6 && clean.length <= LABEL_MAX) score += 3;
  return score;
}

function hasActionEvidence(text: string): boolean {
  const clean = stripHeadingMark(readable(text)).replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim();
  if (ACTION_LEAD.test(clean)) return true;
  const conditional = /^(?:如果|若|当|在|完成|确认|收到|拿到|看到|发现)[^，,。；;]{0,40}[，,]\s*(.+)$/u.exec(clean);
  if (conditional && ACTION_LEAD.test(conditional[1].trim())) return true;
  const afterCondition = /^[^，,。；;]{1,36}(?:时|后)[，,]\s*(.+)$/u.exec(clean);
  return Boolean(afterCondition && ACTION_LEAD.test(afterCondition[1].trim()));
}

function normalizeLabel(text: string, type: NodeType): string {
  let label = stripHeadingMark(text).replace(/\s+/g, ' ').trim();
  if (type === 'artifact') label = label.replace(/^脚本输出\s*[:：]\s*/, '输出：');
  if (type === 'gate') label = label.replace(GATE_LEAD, '');
  if (type === 'stage') label = label.replace(/^(?:第\s*[一二三四五六七八九十\d]+\s*步|步骤\s*\d+)\s*(?:[:：—–-]\s*)?/i, '');
  label = label.replace(/^(?:所以|因此)\s*/, '');
  return label.replace(/[:：。；;]\s*$/, '').trim();
}

/**
 * Can this line become a card title at all?
 *
 * A fenced JSON block's first line is `{`; a table's second row is `|---|---|`.
 * Neither is a step, and both used to win the "first line" race.
 */
function meaningful(text: string): boolean {
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  if (/^\s*\|?[\s:|-]+\|?\s*$/.test(text)) return false;
  return true;
}

/** `# Title` inside a fenced markdown sample is the title, not an H1. */
function stripHeadingMark(text: string): string {
  return text.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * Second line of a card: the thing the step yields, when the source states it
 * next to the step.
 *
 * Deliberately narrow, because a fabricated subtitle is worse than an empty one.
 * It fires in exactly two shapes the author already wrote:
 *
 *   - a shell line whose trailing comment says what success looks like
 *     (`node gateway.js --status  # 有输出即为正常`);
 *   - an intro line ending in a colon, followed by the detail it introduces.
 *
 * A list's second bullet is NOT a subtitle: the bullets are parallel steps, and
 * promoting one of them to "detail of the first" would misreport the source.
 */
function buildSubtitle(unit: Unit, label: string): string | undefined {
  const kind = kindOf(unit.lines);

  if (kind === 'code') {
    const inner = unit.lines
      .map((l) => l.text)
      .filter((t) => !/^\s*(```|~~~)/.test(t) && t.trim() !== '');
    for (const line of inner) {
      const comment = /\s#+\s*(.+)$/.exec(line);
      if (comment) return truncate(readable(comment[1]), SUBTITLE_MAX);
    }
    return undefined;
  }

  if (kind === 'list' || kind === 'table') return undefined;

  const lines = unit.lines.map((l) => readable(l.text)).filter(meaningful);
  const intro = lines[0];
  const detail = lines[1];
  if (!intro || !detail) return undefined;
  if (!/[:：]$/.test(intro)) return undefined;
  if (detail.length < 4 || CODE_TAG.test(detail)) return undefined;
  const short = detail.length <= SUBTITLE_MAX ? detail : `${detail.slice(0, SUBTITLE_MAX - 1)}…`;
  return short === label ? undefined : short;
}

/**
 * Who does this step.
 *
 * Orthogonal to the type: a gate can be checked by a person or by a command.
 * The lane is what stops `git fetch` and "判断分支是否落后" from being drawn in
 * the same column, which is the single biggest reason a 34-step skill reads as
 * an undifferentiated list.
 */
function laneOf(unit: Unit, type: NodeType): Lane {
  if (type === 'artifact') return 'output';
  if (type === 'note') return 'reader';
  if (type === 'external') return 'tool';
  if (kindOf(unit.lines) === 'code') return 'tool';
  const text = unit.lines.map((l) => l.text).join('\n');
  if (MODEL_WORDS.test(text)) return 'model';
  return 'reader';
}

/**
 * The phase a heading declares, if it declares one.
 *
 * `release-checklist` writes `Phase 1：分支对比`, `Phase 2：UAT vs PROD 工单对齐`,
 * `Phase 3：生成 CheckList`. All three were discarded because layout depth came
 * only from sequence edges, so the picture showed a flat ladder where the
 * author had drawn three bands.
 */
function phaseOf(heading: string[]): string | undefined {
  for (let i = heading.length - 1; i >= 0; i--) {
    if (PHASE_HEADING.test(heading[i])) return truncate(heading[i].trim(), 28);
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Ids must be stable, short and ASCII: Chinese labels are common here, and a
 * UUID-length id made of CJK characters is unreadable in a diff and unusable
 * in a URL. Non-ASCII labels fall back to a short content hash.
 */
function uniqueId(label: string, used: Map<string, number>): string {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const base = ascii.length >= 2 ? `n-${ascii}` : `n-${shortHash(label)}`;
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

function shortHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Templates, examples and checklists are output *shapes*, not control flow.
 * Reading `⚠️ 受影响的调用方` out of an output template as a branch produces a
 * dozen edges that can never resolve, which then drowns the real ones.
 */
const TEMPLATE_HEADING = /模板|template|示例|example|输出|output|清单/i;

function extractBranches(unit: Unit, type: NodeType, tableBranches: Branch[]): Branch[] {
  if (type === 'note') return [];
  if (unit.heading.some((h) => TEMPLATE_HEADING.test(h))) return [];
  if (tableBranches.length > 0) return tableBranches;

  const isCode = kindOf(unit.lines) === 'code';
  const hasArms = unit.lines.some((l) => BRANCH_ARM.test(l.text));
  // A fenced block is normally a template, not control flow — but when the
  // template itself enumerates outcomes (a verdict card), those outcomes are
  // the branch set, and dropping them loses the only decision the skill makes.
  if (isCode && !hasArms) return [];

  // Only a decision (or a gate, which also forks) actually branches on an ✅/❌
  // bullet. In an ordinary stage those bullets are content, and treating them
  // as edges is how a graph grows fake unreachable nodes.
  //
  // The same restriction applies to conditional prose. `如果文件不存在，则向用户
  // 询问路径` inside a step describes how that step behaves; it does not fork the
  // graph. Only the step that *is* the decision can be forked by it.
  const forks = type === 'decision' || type === 'gate';

  const out: Branch[] = [];
  for (const line of unit.lines) {
    const cond = forks ? INLINE_ELSE.exec(line.text) : null;
    if (cond) {
      // `如果 X，则 A；否则 B` is two outcomes written as one sentence. Reading
      // it as a single branch loses the else-arm, which is the half people
      // actually get wrong.
      for (const arm of [cond[1], cond[2]]) {
        const when = readable(arm);
        if (when.length >= 2) out.push({ when: truncate(when, 80) });
      }
      continue;
    }
    const isArm = forks && BRANCH_ARM.test(line.text);
    const isCond = forks && BRANCH_COND.test(line.text);
    if (isArm || isCond) {
      const when = readable(line.text.replace(BRANCH_ARM, '').replace(BRANCH_COND, ''));
      if (when.length >= 2) out.push({ when: truncate(when, 80) });
      continue;
    }
    for (const arm of slashArms(line.text)) out.push({ when: arm });
  }
  // `禁止…` is a rule, not an outcome. A gate whose bullets are all prohibitions
  // is stating what must never happen, and drawing each one as a fork produces
  // eighteen edges that can never land — which is exactly the noise that made
  // the unresolved-branch count useless.
  return out.filter((b) => !RULE_TEXT.test(b.when));
}

function outcomeBranches(unit: Unit): Branch[] {
  if (kindOf(unit.lines) !== 'table') return [];
  if (unit.heading.some((h) => TEMPLATE_HEADING.test(h))) return [];

  const rows = unit.lines.filter((line) => TABLE_DATA_ROW.test(line.text)).map(tableCells);
  const header = rows[0]?.[0] ?? '';
  if (!OUTCOME_HEADER.test(header)) return [];

  const outcomes = rows.slice(1).filter((row) => !row.every(isDividerCell)).map((row) => row[0] ?? '');
  const values = [...new Set(outcomes.map(normalizeChoice).filter((value) => value.length > 0))];
  if (values.length < 2 || values.length > 6) return [];
  if (values.some((value) => value.length > 24)) return [];
  return values.map((when) => ({ when }));
}

function tableCells(line: RawLine): string[] {
  return line.text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
    .map((cell) => normalizeChoice(cell));
}

function isDividerCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell);
}

function normalizeChoice(text: string): string {
  return readable(text.replace(/[*_`]/g, '').trim());
}

/** Prohibitions and constraints: the author is forbidding, not forking. */
const RULE_TEXT = /^\s*(?:禁止|不得|严禁|绝不|不允许|不要|勿|never|must not|do not|refuse to)/i;

/**
 * `VERDICT — 逐项判决：守住 / 改良 / 替换` names its own outcomes inline.
 * Only a trailing short enumeration counts; "输入/输出" is not a branch set, and
 * neither is a table row or a template line with placeholders in it.
 */
function slashArms(text: string): string[] {
  // `1. **识别变更类型**：新增Skill / 修改Skill / …` is a step that lists its own
  // options, not the node forking. The list marker is the tell: a line that is
  // itself an item cannot also be the branch head.
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(text)) return [];

  const m = /[:：]\s*([^:：]{2,90})$/.exec(text.trim());
  if (!m) return [];
  const raw = m[1];
  if (/[|`（）()]/.test(raw)) return [];

  const arms = raw
    .split(/\s*\/\s*/)
    .map((a) => stripEmoji(a).replace(/[。.，,]$/, '').trim())
    .filter(Boolean);
  if (arms.length < 2 || arms.length > 6) return [];
  if (arms.some((a) => a.length > 16 || a.length < 1)) return [];
  if (!arms.every((a) => /^[\p{Script=Han}A-Za-z0-9 _-]+$/u.test(a))) return [];

  // `EXISTS / AMBIGUOUS / NOT_FOUND` is a set of allowed values, not a fork:
  // nothing downstream can receive an edge, so drawing it produces dead nodes.
  if (arms.every((a) => ENUM_VALUE.test(a))) return [];
  return arms;
}

/** SCREAMING_SNAKE tokens are identifiers; people do not name branches that way. */
const ENUM_VALUE = /^[A-Z][A-Z0-9_]*$/;

function stripEmoji(text: string): string {
  return text.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '');
}

function dedupeBranches(branches: Branch[]): Branch[] {
  const seen = new Set<string>();
  return branches.filter((b) => {
    const key = b.when.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function linkEdges(nodes: FlowNode[]): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const flow = nodes.filter((node) => node.type !== 'note');
  for (let i = 1; i < flow.length; i++) {
    edges.push({ from: flow[i - 1].id, to: flow[i].id, kind: 'sequence' });
  }
  return edges;
}

function dropImplicitAlternativeSequences(
  nodes: FlowNode[],
  edges: FlowEdge[],
  tableSources: Set<string>,
): void {
  const scopes = branchScopes(nodes, tableSources);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const retained = edges.filter((edge) => keepSequenceEdge(edge, nodeById, scopes));
  edges.splice(0, edges.length, ...retained);
}

function keepSequenceEdge(
  edge: FlowEdge,
  nodeById: Map<string, FlowNode>,
  scopes: BranchScope[],
): boolean {
  if (edge.kind !== 'sequence') return true;
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to) return true;
  const fromScope = scopeOf(from, scopes);
  const toScope = scopeOf(to, scopes);
  return !fromScope && !toScope ? true : fromScope !== undefined && fromScope === toScope;
}

/**
 * A branch is only worth drawing if it lands somewhere. Matching is token
 * overlap against sibling labels — deliberately dumb, because a wrong edge
 * that is flagged is better than a clever edge that is silently wrong.
 */
function applyBranchTargets(
  nodes: FlowNode[],
  edges: FlowEdge[],
  tableSources: Set<string>,
): void {
  for (const node of nodes) {
    for (const branch of node.branches) {
      const target = branch.to
        ? nodes.find((candidate) => candidate.id === branch.to)
        : tableSources.has(node.id) ? exactHeadingMatch(node, branch.when, nodes) : undefined;
      if (target) {
        branch.to = target.id;
        edges.push({ from: node.id, to: target.id, when: branch.when, kind: 'branch' });
      } else {
        pushFlag(node, 'unresolved-branch');
      }
    }
    // A note is the explicit "this prose did not instruct an action" result.
    // Treating that stable fallback as an unresolved flow node made every
    // explanatory paragraph inflate the audit and its inspector badge.
    if (node.type !== 'note' && node.confidence < 0.6) pushFlag(node, 'low-confidence');
  }
}

function exactHeadingMatch(source: FlowNode, when: string, nodes: FlowNode[]): FlowNode | undefined {
  return nodes.find((candidate) =>
    candidate.anchor.start > source.anchor.start &&
    candidate.anchor.heading.some((heading) => normalizeChoice(heading) === normalizeChoice(when)),
  );
}

interface BranchScope {
  id: string;
  sourceStart: number;
  path: string[];
}

function branchScopes(nodes: FlowNode[], tableSources: Set<string>): BranchScope[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => tableSources.has(node.id)).flatMap((source) =>
    source.branches.flatMap((branch) => {
      const target = branch.to ? nodeById.get(branch.to) : undefined;
      if (!target) return [];
      const index = target.anchor.heading.findIndex((heading) => normalizeChoice(heading) === normalizeChoice(branch.when));
      return index < 0 ? [] : [{ id: `${source.id}:${branch.when}`, sourceStart: source.anchor.start, path: target.anchor.heading.slice(0, index + 1) }];
    }),
  );
}

function scopeOf(node: FlowNode, scopes: BranchScope[]): string | undefined {
  return scopes
    .filter((scope) => node.anchor.start > scope.sourceStart && startsWithPath(node.anchor.heading, scope.path))
    .sort((left, right) => right.path.length - left.path.length)[0]?.id;
}

function startsWithPath(path: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => normalizeChoice(path[index] ?? '') === normalizeChoice(part));
}

function pushFlag(node: FlowNode, flag: NodeFlag): void {
  if (!node.flags.includes(flag)) node.flags.push(flag);
}

export function computeFlowStats(
  nodes: FlowNode[],
  edges: FlowEdge[],
  associations: FlowDoc['associations'],
): FlowDoc['stats'] {
  const byType = { stage: 0, decision: 0, gate: 0, artifact: 0, external: 0, note: 0 } as Record<NodeType, number>;
  for (const n of nodes) byType[n.type]++;
  const byLane = { reader: 0, tool: 0, model: 0, output: 0 } as Record<Lane, number>;
  for (const n of nodes) byLane[n.lane]++;
  const notes = nodes.filter((node) => node.type === 'note');
  const associatedIds = new Set(associations.map((association) => association.from));
  const associated = notes.filter((node) => associatedIds.has(node.id)).length;
  const global = notes.filter((node) => node.associationScope === 'skill').length;
  const unbound = notes.filter((node) => node.associationScope === 'unbound').length;
  return {
    byType,
    byLane,
    lowConfidence: nodes.filter((n) => n.flags.includes('low-confidence')).length,
    stale: nodes.filter((n) => n.flags.includes('stale')).length,
    // Flow depth, not heading depth. It used to be `anchor.heading.length`, so a
    // 19-step pipeline reported 2 while the canvas drew 19 bands.
    maxDepth: maxDepthOf(nodes, edges),
    noteCoverage: {
      total: notes.length,
      associated,
      global,
      unbound,
      coverageRate: notes.length ? (associated + global) / notes.length : 1,
      orphanTextRate: notes.length ? unbound / notes.length : 0,
    },
  };
}

/**
 * The declared phases, in source order, with how many nodes each holds.
 *
 * Built from the nodes rather than the sections so a phase with no nodes never
 * becomes an empty column on the canvas.
 */
export function computeFlowPhases(nodes: FlowNode[]): FlowDoc['phases'] {
  const seen = new Map<string, number>();
  for (const node of nodes) {
    if (!node.phase) continue;
    seen.set(node.phase, (seen.get(node.phase) ?? 0) + 1);
  }
  return [...seen.entries()].map(([label, count], i) => ({ id: `p${i}`, label, nodes: count }));
}

function matchSidecar(
  sidecar: Sidecar | undefined,
  unit: Unit,
  anchor: { start: number; end: number },
): SidecarNodePatch | undefined {
  if (!sidecar?.nodes?.length) return undefined;
  const start = unit.lines[0].n;
  return sidecar.nodes.find((p) => {
    if (p.anchor && p.anchor.start === start) return true;
    if (p.label) {
      const first = readable(unit.lines[0].text);
      return first.startsWith(p.label) || first.includes(p.label);
    }
    return false;
  });
}
