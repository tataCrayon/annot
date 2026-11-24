/**
 * AI-first analysis boundary.
 *
 * The model decides meaning: which prose is an action, gate, decision,
 * artifact, note, or branch. Code only verifies that every claim points to
 * exact source lines, that ids are internally consistent, and that the result
 * can be rendered. This module deliberately contains no action vocabulary,
 * gate vocabulary, or note-role heuristics.
 */

import { computeFlowPhases, computeFlowStats } from './flow.ts';
import { linesSha, parseSkill, readable, sha256, slugify, type ParsedSkill, type RawLine } from './parse.ts';
import type {
  AssociationRelation,
  AssociationScope,
  FlowAssociation,
  FlowDoc,
  FlowEdge,
  FlowNode,
  Lane,
  NodeFlag,
  NodeType,
  NoteRole,
} from './types.ts';

const NODE_TYPES = new Set<NodeType>(['stage', 'decision', 'gate', 'artifact', 'external', 'note']);
const LANES = new Set<Lane>(['reader', 'tool', 'model', 'output']);
const NOTE_ROLES = new Set<NoteRole>(['principle', 'rationale', 'definition', 'trigger', 'context', 'risk', 'example', 'reference']);
const SCOPES = new Set<AssociationScope>(['node', 'skill', 'unbound']);
const RELATIONS = new Set<AssociationRelation>(['supports', 'constrains', 'informs', 'explains-output']);
const EDGE_KINDS = new Set<FlowEdge['kind']>(['sequence', 'branch']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface AnalysisNodeProposal {
  id: string;
  type: NodeType;
  label: string;
  subtitle?: string;
  start: number;
  end: number;
  quote: string;
  lane?: Lane;
  phase?: string;
  noteRole?: NoteRole;
  associationScope?: AssociationScope;
  confidence?: number;
  reason?: string;
  openBranches?: string[];
}

export interface AnalysisAssociationProposal {
  from: string;
  to: string;
  relation: AssociationRelation;
  confidence?: number;
  rationale?: string;
}

export interface AnalysisProposal {
  schema_version: 1;
  skill: string;
  source_sha: string;
  summary?: string;
  nodes: AnalysisNodeProposal[];
  edges: FlowEdge[];
  associations?: AnalysisAssociationProposal[];
}

export interface BuildAnalysisOptions {
  sourceFile?: string;
  now?: () => string;
  /** Where the proposal came from, so a stale one can name the file to replace. */
  analysisPath?: string;
}

export class AnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisValidationError';
  }
}

/**
 * The analysis on disk describes a different file than the one being read.
 *
 * This is the ordinary consequence of editing a Skill, not a corrupt input: the
 * hash in the analysis is the whole point of the anchor contract, so the fix is
 * always "read the new file and analyse it again", never "trust the old one".
 * It gets its own class because every caller has to answer with that instruction
 * instead of a validation message a reader can only interpret as "I typed
 * something wrong".
 */
export class StaleAnalysisError extends Error {
  detail: { analysisPath: string; proposalSha: string; currentSha: string; skill: string };

  constructor(message: string, detail: { analysisPath: string; proposalSha: string; currentSha: string; skill: string }) {
    super(message);
    this.name = 'StaleAnalysisError';
    this.detail = detail;
  }
}

/**
 * Quote a path only when it needs it, so the copyable command stays readable.
 * Backslashes are left alone: a double-quoted Windows path is a valid literal
 * on every shell the host might use, and escaping them would corrupt it.
 */
function shellQuote(path: string): string {
  return /[\s"']/.test(path) ? `"${path}"` : path;
}

export interface BuildAnalysisPromptOptions {
  /**
   * Absolute path the proposal must be saved to. The workbench serves proposals
   * from its own `--analysis-dir`, so a task that only names the conventional
   * relative path sends the host to a file the page never looks at — the graph
   * then stays empty even though the analysis was written.
   */
  analysisPath?: string;
}

/**
 * Where a Skill's proposal lives, relative to whatever `.annot` root the caller
 * uses. One function so the CLI, the workbench and the prompt text cannot drift
 * into three different filenames for the same document.
 */
export function proposalFileName(skill: string): string {
  return `${slugify(skill)}.analysis.json`;
}

/** Ask a host model to perform semantic analysis and return only validated JSON. */
export function buildAnalysisPrompt(source: string, sourceFile = 'SKILL.md', options: BuildAnalysisPromptOptions = {}): string {
  const skill = parseSkill(source);
  const analysisPath = options.analysisPath ?? `.annot/analyses/${slugify(skill.name)}.analysis.json`;
  const graphDir = `.annot/${slugify(skill.name)}-graph`;
  return [
    '# Agent Skill 语义分析任务',
    '',
    `源文件：${sourceFile}`,
    `源文件 sha256：${skill.sha}`,
    '',
    '请完整阅读下面的 Skill，理解它真正要求读者完成什么。不要用关键词表、动词表或正则规则给段落分类；根据上下文、先后关系、约束语义和执行目的判断。',
    '',
    '## 输出',
    '只输出一个 JSON 对象，不要解释，不要 Markdown 代码围栏。对象必须符合：',
    '',
    '```json',
    JSON.stringify({
      schema_version: 1,
      skill: skill.name,
      source_sha: skill.sha,
      summary: '一句话概括这个 Skill 的职责',
      nodes: [{
        id: 'n-example',
        type: 'stage',
        label: '用动作语言概括这一段真正要求做什么',
        start: 12,
        end: 14,
        quote: '第 12–14 行的完全原文',
        lane: 'reader',
        confidence: 0.9,
        reason: '为什么这是动作而不是说明',
      }],
      edges: [{ from: 'n-example', to: 'n-next', kind: 'sequence' }],
      associations: [{
        from: 'n-note',
        to: 'n-example',
        relation: 'supports',
        confidence: 0.85,
        rationale: '这段说明如何影响目标动作',
      }],
    }, null, 2),
    '```',
    '',
    '## 节点契约',
    '- `type` 只能是 `stage | decision | gate | artifact | external | note`。',
    '- `stage` 是有动作证据的读者步骤；`decision` 是条件或分流；`gate` 是必须满足或禁止越过的约束；`artifact` 是输出或交付物；`external` 是工具、命令或外部系统调用；`note` 是服务执行但不能冒充动作的解释。',
    '- `start`、`end` 是 1-based 闭区间。`quote` 必须与这些行逐字一致，否则提案无效。',
    '- `id` 使用小写字母、数字、连字符或下划线，且在本文档内唯一。',
    '- `label` 写关键 Action，不要原样复制长段落。不能证明是动作的内容标为 `note`。',
    '- `lane` 只能是 `reader | tool | model | output`，它决定卡片画在哪个泳道。',
    '- `confidence` 表示你对语义判断的把握，不是关键词命中率。',
    '',
    '## 主干契约（图的骨架由你决定）',
    '- **每一个可执行步骤都必须有节点**：Skill 用 `Step 1…N`、`Phase 1…N` 或编号小节组织流程时，这些步骤就是主干，不能用一段概览文字代替它们。',
    '- 章节标题本身不是节点；只有当标题后的正文确实描述一个动作时，才为「标题 + 正文」建一个 `stage`，`start` 指向正文行。',
    '- `edges` 是主干：默认按阅读顺序连 `sequence`。缺少边，布局就只能猜顺序。',
    '- 规则密集的段落（铁律、红线、禁止项）多数是 `gate`，它们挂在所属动作旁边，**不**构成动作编号；不要因为一段话里禁止词多就把它升级成步骤。',
    '- 同一件事的多个约束合并成一个 `gate` 节点（`start`/`end` 覆盖该段），不要逐句拆成十几张卡。',
    '',
    '## 泳道契约',
    '- `reader`：读者自己要做的判断、检查、编辑、决策。',
    '- `tool`：读者要执行的命令、脚本、API、MCP 调用；代码块里的可执行命令属于这里。',
    '- `model`：Skill 明确交给模型/AI 自行完成的推理或生成。',
    '- `output`：产出的文件、报告、表格；这类通常也是 `artifact`。',
    '- 泳道要按真实执行者判断：命令就是命令，即使它写在 `stage` 段落里；判断就是判断，即使它写在 bash 块旁边。',
    '',
    '## 边与说明契约',
    '- `edges` 只放真实执行关系；`sequence` 表示先后，`branch` 表示有来源证据的条件分支，并必须写 `when`。',
    '- 没有明确目标的分支写入源节点的 `openBranches`，不要编造目标。',
    '- `note` 还必须给出 `noteRole`：`principle | rationale | definition | trigger | context | risk | example | reference`。',
    '- `associationScope` 只能是 `node | skill | unbound`。明确作用于整个 Skill 的原则或适用范围可标为 `skill`；无法证明目标时标为 `unbound`。',
    '- `associations.relation` 只能是 `supports | constrains | informs | explains-output`。',
    '- 不要把说明当作执行步骤，也不要为了连图而伪造边。',
    '',
    '## 交付步骤',
    `1. 把 JSON 写到 ${analysisPath}；工作台在这个路径读取已验证提案，目录不存在时先建。`,
    `2. 运行 \`annot annotate ${shellQuote(sourceFile)} --analysis ${shellQuote(analysisPath)} --out ${shellQuote(graphDir)}\`；它验证引文并生成 \`flow.json\` + \`html\`。`,
    '3. 画图靠的就是这一个文件：网页不会用别的提案顶替它，写到别处等于没分析。',
    '4. 汇报 flow/HTML 路径、验证失败项和仍不确定的语义。不要修改原 Skill。',
    '5. 只输出 JSON；没有分析时 annot 不画图，所以这份 JSON 就是图的唯一来源。',
    '',
    '## 源文件（行号只用于定位证据）',
    '```text',
    numberLines(source),
    '```',
  ].join('\n');
}

/** Ask a host model to design an evaluation from the Skill rather than a template. */
export function buildEvaluationPrompt(source: string, sourceFile = 'SKILL.md', intent = '', metricIds: string[] = []): string {
  return [
    '# Agent Skill 评估设计任务',
    '',
    `源文件：${sourceFile}`,
    `用户目标：${intent.trim() || '未指定。请在阅读 Skill 后提出最关键的 3–5 个可观察目标，再继续设计。'}`,
    `关注方向：${metricIds.length ? metricIds.join(', ') : '未指定，请根据 Skill 的目的选择。'}`,
    '',
    '先理解 Skill 要改变的真实行为，再设计评估。不要用关键词命中作为成功标准。',
    '',
    '## 必须覆盖',
    '1. 应触发的显式、隐式和带噪上下文场景。',
    '2. 不应触发或相邻 Skill 冲突的负例。',
    '3. 主流程、分支、边界、工具失败和需要停止的场景。',
    '4. 每个场景的 prompt、材料、预期结果和可判定断言。',
    '5. with-skill 与 without-skill 的隔离配对运行，相同模型和工具权限。',
    '6. 正确性、触发、成本、延迟和重复稳定性；没有运行证据的项目标为 unmeasured。',
    '',
    '## 输出',
    '输出可执行的 `evals.json` 与运行计划。运行完成后另写结果报告，引用真实产物、断言名、样本数和 paired delta；没有运行就明确写“未测”。',
    '把评估产物写到源 Skill 之外的临时目录或 `.annot/evals/`；除非用户明确要求，不要修改原 Skill。',
    '',
    '## 源文件',
    '```text',
    numberLines(source),
    '```',
  ].join('\n');
}

export function parseAnalysisProposal(raw: string): AnalysisProposal {
  const text = stripJsonFence(raw);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AnalysisValidationError(`analysis is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateProposal(value);
}

/** Convert an AI proposal into the renderer contract without semantic reclassification. */
export function buildFlowFromAnalysis(
  source: string,
  proposal: AnalysisProposal,
  options: BuildAnalysisOptions = {},
): FlowDoc {
  const skill = parseSkill(source);
  if (proposal.schema_version !== 1) throw new AnalysisValidationError('analysis schema_version must be 1');
  if (proposal.source_sha !== skill.sha) {
    throw new StaleAnalysisError(
      `source hash mismatch: proposal ${proposal.source_sha.slice(0, 12)}, current ${skill.sha.slice(0, 12)}`,
      { analysisPath: options.analysisPath ?? '', proposalSha: proposal.source_sha, currentSha: skill.sha, skill: skill.name },
    );
  }
  if (proposal.skill !== skill.name) {
    throw new AnalysisValidationError(`skill name mismatch: proposal ${proposal.skill}, current ${skill.name}`);
  }

  const sourceLines = splitSource(source);
  const edgeSources = new Map<string, FlowEdge[]>();
  for (const edge of proposal.edges) {
    const list = edgeSources.get(edge.from) ?? [];
    list.push(edge);
    edgeSources.set(edge.from, list);
  }
  const associationsByNote = new Map<string, AnalysisAssociationProposal[]>();
  for (const association of proposal.associations ?? []) {
    const list = associationsByNote.get(association.from) ?? [];
    list.push(association);
    associationsByNote.set(association.from, list);
  }
  for (const input of proposal.nodes.filter((node) => node.type === 'note')) {
    const links = associationsByNote.get(input.id) ?? [];
    if (input.associationScope === 'node' && links.length === 0) {
      throw new AnalysisValidationError(`${input.id}: associationScope is node but no association targets it`);
    }
    if ((input.associationScope === 'skill' || input.associationScope === 'unbound') && links.length > 0) {
      throw new AnalysisValidationError(`${input.id}: ${input.associationScope} scope cannot also have node associations`);
    }
  }

  const nodes: FlowNode[] = proposal.nodes.map((input) => {
    if (input.end > sourceLines.length) {
      throw new AnalysisValidationError(`${input.id}: lines ${input.start}-${input.end} exceed the ${sourceLines.length}-line source`);
    }
    const rawLines = sourceLines.slice(input.start - 1, input.end);
    const raw = rawLines.map((line) => line.text).join('\n');
    if (raw !== input.quote) {
      throw new AnalysisValidationError(`${input.id}: quote does not exactly match lines ${input.start}-${input.end}; expected ${JSON.stringify(raw)}`);
    }
    const flags: NodeFlag[] = [];
    const confidence = input.confidence ?? 0.8;
    if (input.type !== 'note' && confidence < 0.6) flags.push('low-confidence');
    const associationScope = input.type === 'note'
      ? input.associationScope ?? ((associationsByNote.get(input.id)?.length ?? 0) > 0 ? 'node' : 'unbound')
      : undefined;
    if (associationScope === 'unbound') flags.push('orphan-note');

    const branches = (edgeSources.get(input.id) ?? [])
      .filter((edge) => edge.kind === 'branch')
      .map((edge) => ({ when: edge.when ?? '条件分支', to: edge.to }));
    for (const when of input.openBranches ?? []) branches.push({ when });
    if (branches.some((branch) => !branch.to)) flags.push('unresolved-branch');

    return {
      id: input.id,
      type: input.type,
      label: input.label,
      subtitle: input.subtitle,
      lane: input.lane ?? inferLane(input.type),
      phase: input.phase,
      text: rawLines.map((line) => readable(line.text)).filter(Boolean).join(' ').slice(0, 400),
      raw,
      anchor: {
        heading: headingAt(skill, input.start),
        start: input.start,
        end: input.end,
        sha: linesSha(rawLines),
      },
      branches,
      confidence,
      rule: `ai-analysis${input.reason ? `: ${input.reason}` : ''}`,
      source: 'analysis',
      noteRole: input.type === 'note' ? input.noteRole : undefined,
      associationScope,
      flags,
    };
  });

  const associations: FlowAssociation[] = (proposal.associations ?? []).map((item) => ({
    from: item.from,
    to: item.to,
    relation: item.relation,
    evidence: 'ai-analysis',
    confidence: item.confidence ?? 0.8,
    rationale: item.rationale,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // A proposal without edges is a bag of cards: the layout has no order to draw
  // and falls back to source order, which is exactly the guessing this path
  // exists to remove. The analysis owns the graph, so it must say what follows
  // what.
  const executable = nodes.filter((node) => node.type !== 'note');
  if (proposal.edges.length === 0 && executable.length > 1) {
    throw new AnalysisValidationError('edges is empty: an analysis with more than one executable node must state the sequence, not leave the order to the layout');
  }
  for (const association of associations) {
    if (nodeById.get(association.from)?.type !== 'note') {
      throw new AnalysisValidationError(`${association.from}: associations must originate from a note`);
    }
    if (nodeById.get(association.to)?.type === 'note') {
      throw new AnalysisValidationError(`${association.to}: an association target must be executable structure, not another note`);
    }
  }

  return {
    skill: skill.name,
    description: skill.description,
    source: {
      file: options.sourceFile ?? 'SKILL.md',
      sha: skill.sha,
      lines: skill.totalLines,
      generated_at: (options.now ?? (() => new Date().toISOString()))(),
      method: 'ai',
      analysis_sha: sha256(JSON.stringify(proposal)),
    },
    schema_version: 1,
    nodes,
    edges: proposal.edges.map((edge) => ({ ...edge })),
    associations,
    sections: skill.sections.map((section, index) => ({
      id: `s${index}`,
      title: section.title,
      level: section.level,
      start: section.startLine,
    })),
    phases: computeFlowPhases(nodes),
    stats: computeFlowStats(nodes, proposal.edges, associations),
  };
}

function validateProposal(value: unknown): AnalysisProposal {
  if (!isRecord(value)) throw new AnalysisValidationError('analysis must be a JSON object');
  if (value.schema_version !== 1) throw new AnalysisValidationError('analysis schema_version must be 1');
  const skill = requireString(value.skill, 'skill');
  const sourceSha = requireString(value.source_sha, 'source_sha');
  if (!/^[0-9a-f]{64}$/.test(sourceSha)) throw new AnalysisValidationError('source_sha must be a 64-character lowercase sha256');
  const nodesRaw = requireArray(value.nodes, 'nodes');
  if (nodesRaw.length === 0) throw new AnalysisValidationError('nodes must contain at least one item');
  const ids = new Set<string>();
  const nodes = nodesRaw.map((item, index) => {
    if (!isRecord(item)) throw new AnalysisValidationError(`nodes[${index}] must be an object`);
    const node = validateNode(item, index);
    if (!ID_PATTERN.test(node.id)) throw new AnalysisValidationError(`nodes[${index}].id must match ${ID_PATTERN}`);
    if (ids.has(node.id)) throw new AnalysisValidationError(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    return node;
  });

  const edgesRaw = requireArray(value.edges, 'edges');
  const edges = edgesRaw.map((item, index) => {
    if (!isRecord(item)) throw new AnalysisValidationError(`edges[${index}] must be an object`);
    const from = requireString(item.from, `edges[${index}].from`);
    const to = requireString(item.to, `edges[${index}].to`);
    const kind = requireString(item.kind, `edges[${index}].kind`) as FlowEdge['kind'];
    if (!ids.has(from) || !ids.has(to)) throw new AnalysisValidationError(`edges[${index}] references an unknown node`);
    if (!EDGE_KINDS.has(kind)) throw new AnalysisValidationError(`edges[${index}].kind is invalid`);
    if (kind === 'branch' && (typeof item.when !== 'string' || !item.when.trim())) {
      throw new AnalysisValidationError(`edges[${index}] is a branch and needs when`);
    }
    return { from, to, kind, when: typeof item.when === 'string' ? item.when : undefined };
  });

  const associationsRaw = value.associations === undefined ? [] : requireArray(value.associations, 'associations');
  const associations = associationsRaw.map((item, index) => {
    if (!isRecord(item)) throw new AnalysisValidationError(`associations[${index}] must be an object`);
    const from = requireString(item.from, `associations[${index}].from`);
    const to = requireString(item.to, `associations[${index}].to`);
    if (!ids.has(from) || !ids.has(to)) throw new AnalysisValidationError(`associations[${index}] references an unknown node`);
    if (nodes.find((node) => node.id === from)?.type !== 'note') {
      throw new AnalysisValidationError(`associations[${index}].from must be a note`);
    }
    const relation = requireString(item.relation, `associations[${index}].relation`) as AssociationRelation;
    if (!RELATIONS.has(relation)) throw new AnalysisValidationError(`associations[${index}].relation is invalid`);
    return {
      from,
      to,
      relation,
      confidence: optionalNumber(item.confidence, 0.8, `associations[${index}].confidence`),
      rationale: optionalString(item.rationale),
    };
  });

  return {
    schema_version: 1,
    skill,
    source_sha: sourceSha,
    summary: optionalString(value.summary),
    nodes,
    edges,
    associations,
  };
}

function validateNode(value: Record<string, unknown>, index: number): AnalysisNodeProposal {
  const id = requireString(value.id, `nodes[${index}].id`);
  const type = requireString(value.type, `nodes[${index}].type`) as NodeType;
  if (!NODE_TYPES.has(type)) throw new AnalysisValidationError(`nodes[${index}].type is invalid`);
  const label = requireString(value.label, `nodes[${index}].label`);
  const start = requireInt(value.start, `nodes[${index}].start`);
  const end = requireInt(value.end, `nodes[${index}].end`);
  if (start < 1 || end < start) throw new AnalysisValidationError(`nodes[${index}] range is invalid`);
  const quote = requireString(value.quote, `nodes[${index}].quote`);
  const lane = value.lane === undefined ? undefined : requireString(value.lane, `nodes[${index}].lane`) as Lane;
  if (lane && !LANES.has(lane)) throw new AnalysisValidationError(`nodes[${index}].lane is invalid`);
  const noteRole = value.noteRole === undefined ? undefined : requireString(value.noteRole, `nodes[${index}].noteRole`) as NoteRole;
  if (noteRole && !NOTE_ROLES.has(noteRole)) throw new AnalysisValidationError(`nodes[${index}].noteRole is invalid`);
  const associationScope = value.associationScope === undefined
    ? undefined
    : requireString(value.associationScope, `nodes[${index}].associationScope`) as AssociationScope;
  if (associationScope && !SCOPES.has(associationScope)) throw new AnalysisValidationError(`nodes[${index}].associationScope is invalid`);
  if (type === 'note' && !noteRole) throw new AnalysisValidationError(`nodes[${index}] is a note and needs noteRole`);
  if (type !== 'note' && noteRole) throw new AnalysisValidationError(`nodes[${index}] is not a note but has noteRole`);
  return {
    id,
    type,
    label,
    subtitle: optionalString(value.subtitle),
    start,
    end,
    quote,
    lane,
    phase: optionalString(value.phase),
    noteRole,
    associationScope,
    confidence: optionalNumber(value.confidence, 0.8, `nodes[${index}].confidence`),
    reason: optionalString(value.reason),
    openBranches: optionalStringArray(value.openBranches, `nodes[${index}].openBranches`),
  };
}

function splitSource(source: string): RawLine[] {
  return source.replace(/\r\n?/g, '\n').split('\n').map((text, index) => ({ n: index + 1, text }));
}

function headingAt(skill: ParsedSkill, line: number): string[] {
  let heading: string[] = [];
  for (const section of skill.sections) {
    if (section.startLine <= line && section.heading.length > 0) heading = section.heading;
  }
  return heading;
}

function inferLane(type: NodeType): Lane {
  if (type === 'external') return 'tool';
  if (type === 'artifact') return 'output';
  return 'reader';
}

function numberLines(source: string): string {
  return source.replace(/\r\n?/g, '\n').split('\n').map((line, index) => `${String(index + 1).padStart(4, '0')} | ${line}`).join('\n');
}

function stripJsonFence(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('```')) return text;
  const lines = text.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.trim() === '```') lines.pop();
  return lines.join('\n').trim();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AnalysisValidationError(`${field} must be a non-empty string`);
  return value;
}

function requireInt(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new AnalysisValidationError(`${field} must be an integer`);
  return value as number;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new AnalysisValidationError(`${field} must be an array`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new AnalysisValidationError(`${field} must be a number between 0 and 1`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new AnalysisValidationError(`${field} must be an array of non-empty strings`);
  }
  return value as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
