import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { buildFlow } from './flow.ts';
import { parseSkill } from './parse.ts';

export type StandardStatus = 'pass' | 'warn' | 'fail';
export type StandardGroupId = 'discovery' | 'structure' | 'resources' | 'maintenance';
export type SkillReadiness = 'ready' | 'review' | 'blocked';

export interface StandardCheck {
  id: string;
  group: StandardGroupId;
  title: string;
  status: StandardStatus;
  detail: string;
  evidence?: string;
  nodeTargets?: Array<{ id: string; label: string; start: number; end: number }>;
  /**
   * What to change, written so a host agent can execute it without guessing.
   *
   * A diagnosis that only says "this is wrong" leaves the reader to re-derive
   * the fix, and re-deriving is where a repair drifts away from the check that
   * flagged it. The remedy lives next to the check for the same reason the
   * defect weights live in one place: so both cannot disagree.
   */
  remedy?: string;
  /** 1-based inclusive source lines the fix touches, when the check located them. */
  lines?: Array<{ start: number; end: number }>;
}

export interface StandardGroup {
  id: StandardGroupId;
  title: string;
  note: string;
  checks: StandardCheck[];
}

export interface EvaluationStage {
  id: string;
  title: string;
  question: string;
  method: string;
  evidence: string;
}

export interface EvaluationTool {
  name: string;
  url: string;
  fit: string;
}

export interface EvaluationMetric {
  id: string;
  label: string;
  description: string;
}

export interface EvaluationMethodology {
  boundary: string;
  stages: EvaluationStage[];
  metrics: EvaluationMetric[];
  tools: EvaluationTool[];
  sources: Array<{ title: string; url: string }>;
}

export interface SkillStandardReport {
  schema_version: 1;
  skill: string;
  file: string;
  /** sha256 of the reviewed source, so a generated task can be pinned to it. */
  source_sha: string;
  readiness: SkillReadiness;
  summary: Record<StandardStatus, number>;
  descriptionChars: number;
  sourceLines: number;
  groups: StandardGroup[];
  checks: StandardCheck[];
  evaluation: EvaluationMethodology;
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRIGGER_CUE = /(触发|适用于|用于|何时使用|use\s+when|when\s+to\s+use|use\s+for|for\s+.+\s+when)/i;
const BROAD_SCOPE = /(任何任务|所有任务|一切任务|任何情况|万能|anything|everything|any\s+task)/i;
const PLACEHOLDER = /\[TODO:[^\]]*\]/i;
const ABSOLUTE_PATH = /(?:^|[\s`'"(])(?:[A-Za-z]:\\|\/Users\/|\/home\/)/m;
const LOCAL_PREFIX = /^(?:\.\/)?(references|scripts|assets)\//;

const GROUP_META: Record<StandardGroupId, { title: string; note: string }> = {
  discovery: { title: '发现与选择', note: '名称和 Description 决定宿主何时加载这份 Skill。' },
  structure: { title: '正文与执行', note: '正文只保留执行所需信息，并保持清晰、可操作。' },
  resources: { title: '渐进披露', note: '本地引用必须可达，详细资料从入口按需加载。' },
  maintenance: { title: '维护性', note: '阻止未完成占位、不可移植路径和目录命名漂移。' },
};

const GROUP_ORDER: StandardGroupId[] = ['discovery', 'structure', 'resources', 'maintenance'];

export const EVALUATION_METRICS: EvaluationMetric[] = [
  { id: 'selection', label: '触发与选择', description: '该触发时选中，不该触发时避开。' },
  { id: 'completion', label: '任务完成', description: '主流程、边界和分支能够完整执行。' },
  { id: 'quality', label: '产出质量', description: '最终文件、回答或操作满足明确验收条件。' },
  { id: 'recovery', label: '错误恢复', description: '工具失败、信息缺失时能停下或安全降级。' },
  { id: 'safety', label: '安全与副作用', description: '权限、写入和外部操作没有越界。' },
  { id: 'efficiency', label: '成本效率', description: 'token、工具调用和模型调用成本可接受。' },
  { id: 'latency', label: '响应延迟', description: '执行时间和关键阶段耗时在目标内。' },
  { id: 'stability', label: '一致性', description: '重复运行结果稳定，方差和失败率可控。' },
];

export function resolveSkillFile(target: string): string {
  const absolute = resolve(target);
  return target.toLowerCase().endsWith('.md') ? absolute : join(absolute, 'SKILL.md');
}

export async function reviewSkillFile(target: string): Promise<SkillStandardReport> {
  const file = resolveSkillFile(target);
  return reviewSkill(await readFile(file, 'utf8'), file);
}

/** The reviewed source and its report, for callers that need to quote bytes. */
export async function reviewSkillSource(target: string): Promise<{ report: SkillStandardReport; source: string }> {
  const file = resolveSkillFile(target);
  const source = await readFile(file, 'utf8');
  return { report: await reviewSkill(source, file), source };
}

export async function reviewSkill(source: string, file: string): Promise<SkillStandardReport> {
  const parsed = parseSkill(source);
  const flow = buildFlow(parsed, source, { sourceFile: basename(file) });
  const description = parsed.description.trim();
  const name = (parsed.frontmatter.name ?? '').trim();
  const sourceLines = countLines(source);
  const lines = normalizeLines(source);
  const fields = frontmatterFields(lines);
  const references = await inspectReferences(source, file, lines);
  const checks = buildChecks({ name, description, source, sourceLines, lines, fields, references, parsed, flow, file });
  const summary = countStatuses(checks);
  const readiness = summary.fail > 0 ? 'blocked' : summary.warn > 0 ? 'review' : 'ready';
  const groups = GROUP_ORDER.map((id) => ({
    id,
    ...GROUP_META[id],
    checks: checks.filter((check) => check.group === id),
  }));

  return {
    schema_version: 1,
    skill: parsed.name,
    file,
    source_sha: parsed.sha,
    readiness,
    summary,
    descriptionChars: description.length,
    sourceLines,
    groups,
    checks,
    evaluation: evaluationMethodology(),
  };
}

interface CheckInput {
  name: string;
  description: string;
  source: string;
  sourceLines: number;
  lines: string[];
  fields: Map<string, LineRange>;
  references: ReferenceResult[];
  parsed: ReturnType<typeof parseSkill>;
  flow: ReturnType<typeof buildFlow>;
  file: string;
}

function buildChecks(input: CheckInput): StandardCheck[] {
  return [
    nameCheck(input.name, input.fields.get('name')),
    descriptionCheck(input.description, input.fields.get('description')),
    triggerCheck(input.description, input.fields.get('description')),
    scopeCheck(input.description, input.fields.get('description')),
    bodyCheck(input.parsed, input.fields.get('description')),
    headingCheck(input.parsed, input.lines),
    lineBudgetCheck(input.sourceLines),
    progressiveCheck(input.sourceLines, input.source, input.references),
    noteCoverageCheck(input.flow.stats.noteCoverage, input.flow.nodes),
    referenceCheck(input.references),
    referenceDepthCheck(input.references),
    placeholderCheck(input.lines),
    folderCheck(input.name, input.file, input.fields.get('name')),
    portabilityCheck(input.lines),
  ];
}

function nameCheck(name: string, range: LineRange | undefined): StandardCheck {
  const valid = Boolean(name) && name.length <= 64 && NAME_PATTERN.test(name);
  return check('name', 'discovery', '名称符合 Agent Skills 规范', valid ? 'pass' : 'fail',
    valid ? '名称为小写字母、数字和连字符，长度不超过 64。' : 'name 必填，只能使用小写字母、数字和连字符，且长度不超过 64。',
    name || '缺失', {
      remedies: valid ? [] : [
        '把 frontmatter 的 name 改成小写字母、数字、连字符组成的短语（例如 `code-review`），长度不超过 64，且不以连字符开头或结尾。',
        '同时把目录名改成与 name 完全一致；目录名与 name 不一致会另起一条建议项。',
      ],
      lines: range,
    });
}

function descriptionCheck(description: string, range: LineRange | undefined): StandardCheck {
  // The Agent Skills specification constrains `description` to non-empty and
  // ≤1024 characters; it says nothing about angle brackets. Claude Code only
  // escapes `<`/`>` when rendering the description, and reserves `<`/`>` for
  // `name`. Reporting a spec violation here blocked a real skill (hallmark,
  // whose description legitimately writes `` `/hallmark redesign <path>` ``),
  // so the finding is a warning about rendering, not a blocker.
  const problem = !description
    ? 'description 不能为空。'
    : description.length > 1024
      ? `description 有 ${description.length} 个字符，超过 1024。`
      : PLACEHOLDER.test(description)
        ? 'description 仍包含 TODO 占位符。'
        : /[<>]/.test(description)
          ? 'description 含尖括号；规范允许，但宿主展示时会转义成 &lt; / &gt;，占位符可能读不出来。'
          : '';
  const status: StandardStatus = !description || description.length > 1024 || PLACEHOLDER.test(description) ? 'fail' : /[<>]/.test(description) ? 'warn' : 'pass';
  return check('description', 'discovery', 'Description 满足规范', status,
    problem || 'description 非空、未超过长度限制，也没有占位符。', `${description.length}/1024 字符`, {
      remedies: status === 'pass' ? [] : descriptionRemedies(status, description),
      lines: range,
    });
}

function descriptionRemedies(status: StandardStatus, description: string): string[] {
  if (!description) return ['在 frontmatter 写 description：先说做什么，再写「何时使用/触发场景」，可加入关键词帮助宿主选中。'];
  if (description.length > 1024) return [`把 description 压到 1024 字符以内（当前 ${description.length}），把示例细节移到正文或 references/。`];
  if (PLACEHOLDER.test(description)) return ['删除 frontmatter 里的 [TODO: …] 占位符，改写成实际的触发场景；未想清楚的触发条件不要留在 description。'];
  return [
    '把 description 里的尖括号占位符改成具体写法：`<path>` 这类参数直接给一个真实示例，或改用中文说明「目标页面路径」。',
    '若尖括号是有意保留的命令签名，请在任务结果里注明「已知会转义」，并把该项标为已接受，而不是算作修复。',
  ];
}

function triggerCheck(description: string, range: LineRange | undefined): StandardCheck {
  const match = TRIGGER_CUE.test(description);
  return check('description-trigger', 'discovery', 'Description 说明何时使用', match ? 'pass' : 'warn',
    match ? '能够看到触发或适用场景。' : '建议明确写出“何时使用”或“触发场景”，提高自动选择准确率。', undefined, {
      remedies: match ? [] : ['在 description 末尾追加一句触发说明，形如「Use when the user asks to <具体请求>」或「用于：<具体场景>」，只写真实会出现的请求。'],
      lines: range,
    });
}

function scopeCheck(description: string, range: LineRange | undefined): StandardCheck {
  const broad = BROAD_SCOPE.test(description);
  return check('description-scope', 'discovery', 'Description 边界足够具体', broad ? 'warn' : 'pass',
    broad ? '描述出现“任何任务/所有情况”等宽泛措辞，可能吸引无关请求。' : '没有发现明显的过度宽泛措辞。', undefined, {
      remedies: broad ? ['删掉「任何任务/所有情况」这类全称措辞，改成明确的对象或场景；若确需覆盖多场景，列出场景而不是用「任何」。'] : [],
      lines: range,
    });
}

function bodyCheck(parsed: ReturnType<typeof parseSkill>, range: LineRange | undefined): StandardCheck {
  const units = parsed.sections.reduce((count, section) => count + section.units.length, 0);
  return check('body', 'structure', '正文包含可执行指导', units > 0 ? 'pass' : 'fail',
    units > 0 ? `解析到 ${units} 个正文单元。` : 'Markdown 正文为空，只有 frontmatter 无法指导执行。', undefined, {
      remedies: units > 0 ? [] : ['在 frontmatter 之后写正文：至少包含一段可执行步骤，说明读者/宿主按什么顺序做什么，以及产出什么。'],
      lines: units > 0 ? undefined : range,
    });
}

function headingCheck(parsed: ReturnType<typeof parseSkill>, lines: string[]): StandardCheck {
  const headings = parsed.sections.filter((section) => section.level > 0).length;
  return check('headings', 'structure', '正文结构可扫描', headings > 0 ? 'pass' : 'warn',
    headings > 0 ? `发现 ${headings} 个 Markdown 标题。` : '没有 Markdown 标题，长正文会难以扫描和定位。', undefined, {
      remedies: headings > 0 ? [] : ['给正文加 2–5 个 Markdown 标题，按执行顺序分段（例如「准备」「执行」「验收」）；不要只加一个总标题。'],
      lines: headings > 0 ? undefined : lineRanges(lines, (line) => line.trim() !== '' && line.trim() !== '---').slice(0, 1),
    });
}

function lineBudgetCheck(sourceLines: number): StandardCheck {
  return check('line-budget', 'structure', '入口文件保持在合理长度', sourceLines <= 500 ? 'pass' : 'warn',
    sourceLines <= 500 ? 'SKILL.md 不超过 500 行建议值。' : 'SKILL.md 超过 500 行建议值，考虑把条件细节移入 references/。',
    `${sourceLines} 行`, {
      remedies: sourceLines <= 500 ? [] : [
        `把低频细节（示例、长表格、完整 schema）移到 references/ 下，入口只留决策步骤，目标 ≤500 行（当前 ${sourceLines}）。`,
        '拆分时入口必须留下指向新文件的 Markdown 链接，否则内容等于被删掉。',
      ],
    });
}

function progressiveCheck(sourceLines: number, source: string, references: ReferenceResult[]): StandardCheck {
  const mentionsResources = /(?:references|scripts|assets)\//.test(source);
  const shouldDisclose = sourceLines > 200 && references.length === 0 && !mentionsResources;
  return check('progressive-disclosure', 'structure', '详细内容按需披露', shouldDisclose ? 'warn' : 'pass',
    shouldDisclose ? '正文较长但没有 references/scripts/assets 引用，可能把所有条件内容都常驻加载。' : '入口篇幅与本地资源引用搭配合理。',
    `${sourceLines} 行 · ${references.length} 个本地链接`, {
      remedies: shouldDisclose ? [`把 ${sourceLines} 行里可延迟加载的部分移到 references/，并在入口加一条 ` + '`[详细规则](references/rules.md)`' + ' 形式的链接。'] : [],
    });
}

function noteCoverageCheck(
  coverage: ReturnType<typeof buildFlow>['stats']['noteCoverage'],
  nodes: ReturnType<typeof buildFlow>['nodes'],
): StandardCheck {
  const rate = Math.round(coverage.orphanTextRate * 100);
  const status: StandardStatus = coverage.unbound > 0 ? 'warn' : 'pass';
  const result = check('note-coverage', 'structure', '说明能追溯到动作、门禁、判断或产物', status,
    coverage.total === 0
      ? '没有说明节点需要关联。'
      : coverage.unbound > 0
        ? `${coverage.unbound} 条说明没有找到可证实的目标；请确认它们是全局原则，还是确实孤立。`
        : '所有说明都已关联到结构节点或明确为全局说明。',
    `${coverage.total} 条 · ${coverage.associated} 已关联 · ${coverage.global} 全局 · ${coverage.unbound} 孤立 · ${rate}% 孤立率`);
  result.nodeTargets = nodes
    .filter((node) => node.type === 'note' && (node.associationScope === 'unbound' || node.flags.includes('orphan-note')))
    .map((node) => ({ id: node.id, label: node.label, start: node.anchor.start, end: node.anchor.end }));
  result.remedy = coverage.unbound > 0
    ? '对每条孤立说明二选一：能落地的，在 annot.sidecar.json 用 associatesWith 指到它真正约束的动作/门禁/判断/产物；确实作用于整个 Skill 的，用 associationScope: "skill" 标为全局。不要为了清零把一个说明硬绑到不相干的节点。'
    : undefined;
  result.lines = result.nodeTargets.map((target) => ({ start: target.start, end: target.end }));
  return result;
}

function referenceCheck(references: ReferenceResult[]): StandardCheck {
  const missing = references.filter((reference) => !reference.exists);
  return check('references-exist', 'resources', '本地引用全部可达', missing.length ? 'fail' : 'pass',
    missing.length ? `存在 ${missing.length} 个失效引用。` : references.length ? '所有声明的本地文件都存在。' : '没有声明本地资源引用。',
    missing.map((reference) => reference.path).join('、') || undefined, {
      remedies: missing.length ? [
        `补齐缺失文件 ${missing.map((reference) => reference.path).join('、')}；若不需要，删掉链接里失效的那一部分。`,
        '补齐时只写 Skill 真正需要的内容，不要为过检造空文件。',
      ] : [],
      lines: missing.flatMap((reference) => reference.lines),
    });
}

function referenceDepthCheck(references: ReferenceResult[]): StandardCheck {
  const deep = references.filter((reference) => reference.path.split('/').length > 2);
  return check('reference-depth', 'resources', '引用保持浅层加载', deep.length ? 'warn' : 'pass',
    deep.length ? '存在超过一层目录的引用，建议减少嵌套阅读链。' : '本地引用没有深层嵌套。',
    deep.map((reference) => reference.path).join('、') || undefined, {
      remedies: deep.length ? ['把深层引用上提到 references/ 一层，或让入口直接指向最终文件，减少一次跳转。'] : [],
      lines: deep.flatMap((reference) => reference.lines),
    });
}

function placeholderCheck(lines: string[]): StandardCheck {
  const hits = lineRanges(lines, (line) => PLACEHOLDER.test(line));
  return check('unfinished-placeholder', 'maintenance', '没有未完成占位符', hits.length ? 'fail' : 'pass',
    hits.length ? `发现 ${hits.length} 处 [TODO: …] 占位符，发布前必须完成或删除。` : '没有发现未完成占位符。', undefined, {
      remedies: hits.length ? ['把每处 [TODO: …] 改成实际内容；暂时无法确定就删掉整句，不要留占位符过检。'] : [],
      lines: hits,
    });
}

function folderCheck(name: string, file: string, range: LineRange | undefined): StandardCheck {
  const folder = basename(dirname(file));
  const matches = !name || folder === name;
  return check('folder-name', 'maintenance', '目录名与 Skill 名称一致', matches ? 'pass' : 'warn',
    matches ? '目录名与 frontmatter name 一致。' : `目录名 ${folder} 与 name ${name} 不一致，可能增加维护歧义。`, undefined, {
      remedies: matches ? [] : [
        `把目录改名为 ${name || '(frontmatter name)'}，或把 name 改成 ${folder}；两边必须逐字一致。`,
        '目录改名会改变 Skill 的安装路径，先确认宿主里的安装方式再动。',
      ],
      lines: matches ? undefined : range,
    });
}

function portabilityCheck(lines: string[]): StandardCheck {
  const hits = lineRanges(lines, (line) => ABSOLUTE_PATH.test(line));
  return check('portable-paths', 'maintenance', '没有本机绝对路径', hits.length ? 'warn' : 'pass',
    hits.length ? `正文有 ${hits.length} 处本机绝对路径，迁移到其他机器或宿主时可能失效。` : '没有发现用户或盘符绝对路径。', undefined, {
      remedies: hits.length ? ['把本机绝对路径改成相对 Skill 根目录的引用（references/…、scripts/…），或写成「<工作区>/…」这样的占位说明。'] : [],
      lines: hits,
    });
}

function check(
  id: string,
  group: StandardGroupId,
  title: string,
  status: StandardStatus,
  detail: string,
  evidence?: string,
  extra: { remedies?: string[]; lines?: LineRange | LineRange[] | undefined } = {},
): StandardCheck {
  const result: StandardCheck = { id, group, title, status, detail, evidence };
  const remedies = (extra.remedies ?? []).filter(Boolean);
  if (remedies.length) result.remedy = remedies.join('\n');
  const lines = (Array.isArray(extra.lines) ? extra.lines : extra.lines ? [extra.lines] : []).filter((line) => line.start > 0);
  if (lines.length) result.lines = lines;
  return result;
}

interface LineRange {
  start: number;
  end: number;
}

interface ReferenceResult {
  path: string;
  exists: boolean;
  /** Where the link was written, so a broken link can be repaired in place. */
  lines: LineRange[];
}

async function inspectReferences(source: string, file: string, lines = normalizeLines(source)): Promise<ReferenceResult[]> {
  const references = localReferences(source);
  const root = dirname(file);
  return Promise.all(references.map(async (path) => ({
    path,
    exists: await fileExists(join(root, path)),
    lines: lineRanges(lines, (line) => line.includes(`](${path})`) || line.includes(`](${path}#`)),
  })));
}

function localReferences(source: string): string[] {
  const found = new Set<string>();
  // Only real Markdown links are hard evidence that this Skill owns a local
  // file. Inline examples such as `references/schema.md` are common in generic
  // skills and must not make an unrelated Skill look broken.
  for (const match of source.matchAll(/!?\[[^\]]*]\(([^)\s]+)/g)) {
    const path = cleanReference(match[1]);
    if (path && LOCAL_PREFIX.test(path) && !/[*<>$]/.test(path)) found.add(path);
  }
  return [...found].sort();
}

function cleanReference(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '').replace(/[?#].*$/, '').replace(/^\.\//, '');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function countLines(source: string): number {
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return normalized ? normalized.split('\n').length : 1;
}

/** The source as addressable lines, 1-based by index, matching the parser. */
function normalizeLines(source: string): string[] {
  return source.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Where each frontmatter field sits, 1-based inclusive.
 *
 * A repair task is only actionable if it can say "line 3" instead of "the
 * description". `parseSkill` flattens multi-line values into one string and
 * drops their positions, so the positions are recovered here from the same
 * fence rule the parser uses.
 */
function frontmatterFields(lines: string[]): Map<string, LineRange> {
  const fields = new Map<string, LineRange>();
  if (lines[0]?.trim() !== '---') return fields;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return fields;

  let current: { key: string; start: number; end: number } | null = null;
  const close = () => {
    if (current) fields.set(current.key, { start: current.start, end: current.end });
    current = null;
  };
  for (let i = 1; i < end; i++) {
    const pair = /^([A-Za-z0-9_-]+)\s*:/.exec(lines[i]);
    if (pair) {
      close();
      current = { key: pair[1], start: i + 1, end: i + 1 };
      continue;
    }
    // Continuation lines (an indented block, a wrapped value) belong to the
    // field above them; a blank line does not end the field, the next key does.
    if (current && lines[i].trim() !== '') current.end = i + 1;
  }
  close();
  return fields;
}

/** 1-based inclusive ranges of every line matching `test`. */
function lineRanges(lines: string[], test: (line: string) => boolean): LineRange[] {
  const ranges: LineRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!test(lines[i])) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.end === i) last.end = i + 1;
    else ranges.push({ start: i + 1, end: i + 1 });
  }
  return ranges;
}

function countStatuses(checks: StandardCheck[]): Record<StandardStatus, number> {
  const summary: Record<StandardStatus, number> = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) summary[check.status] += 1;
  return summary;
}

export function evaluationMethodology(): EvaluationMethodology {
  return {
    boundary: '规范检查和方法规划不等同于效果验证。真实效果必须来自隔离运行、可判定断言和 baseline 对照。',
    metrics: EVALUATION_METRICS.map((metric) => ({ ...metric })),
    stages: [
      { id: 'review', title: '规范校验', question: '宿主是否可能正确发现并加载它？', method: '校验 frontmatter、命名、Description、正文结构、引用和渐进披露。', evidence: '规范检查报告；这是静态证据。' },
      { id: 'selection', title: '触发与选择', question: '该触发时能选中，不该触发时能避开吗？', method: '覆盖显式、隐式、带噪上下文、负例和相邻 Skill 冲突矩阵。', evidence: '选择准确率、误触发率和冲突样本。' },
      { id: 'behavior', title: '行为与产物', question: '选中后是否按 Skill 完成任务？', method: '为每个场景写成功条件、确定性断言、过程断言和必要的 rubric。', evidence: 'JSONL 轨迹、可判定断言、产物检查。' },
      { id: 'causal', title: '配对因果', question: '提升来自 Skill，还是模型本来就会？', method: '同模型、同权限、隔离上下文，对比 with_skill 与 without_skill；划分 tune/holdout/holdback。', evidence: 'paired delta、重复运行和 held-out 结果。' },
      { id: 'economics', title: '成本与稳定性', question: '改善是否值得 token、延迟和调用成本？', method: '记录 token、工具调用、耗时、方差与失败率，并在 CI 中设回归门槛。', evidence: '成本比、延迟、方差与回退条件。' },
    ],
    tools: [
      { name: 'skill-eval-harness', url: 'https://github.com/adewale/skill-eval-harness', fit: '配对变体、触发矩阵、holdout 与 lift-per-dollar。' },
      { name: 'Promptfoo', url: 'https://github.com/promptfoo/promptfoo', fit: 'YAML 测试矩阵、确定性断言与 CI 回归。' },
      { name: 'Inspect AI', url: 'https://github.com/UKGovernmentBEIS/inspect_ai', fit: '隔离工具环境和可复现的 Agent 任务评测。' },
      { name: 'NVIDIA SkillEvaluator', url: 'https://github.com/NVIDIA/SkillEvaluator', fit: '多层级质量门禁、语义重叠和行为影响评估。' },
      { name: 'Alibaba skill-up', url: 'https://github.com/alibaba/skill-up', fit: 'Skill 与环境评估、证据驱动演进。' },
    ],
    sources: [
      { title: 'Agent Skills 规范', url: 'https://agentskills.io/specification' },
      { title: 'Agent Skills 输出质量评估', url: 'https://agentskills.io/skill-creation/evaluating-skills' },
      { title: 'OpenAI：系统化测试 Agent Skills', url: 'https://developers.openai.com/blog/eval-skills' },
      { title: 'Tessl：Skill review 边界', url: 'https://docs.tessl.io/improving-your-skills/reviewing-skills' },
    ],
  };
}

export function formatStandardReport(report: SkillStandardReport): string {
  const label: Record<SkillReadiness, string> = { ready: '通过', review: '建议复核', blocked: '存在阻断项' };
  const lines = [
    `Skill 规范检查：${report.skill}`,
    `结论：${label[report.readiness]} · ${report.summary.pass} 通过 / ${report.summary.warn} 建议 / ${report.summary.fail} 阻断`,
    `文件：${report.file}`,
    `说明：这是静态规范检查，不评价 Skill 的实际行为效果。`,
    '',
  ];
  for (const group of report.groups) {
    lines.push(`## ${group.title}`);
    for (const item of group.checks) {
      lines.push(`- [${item.status.toUpperCase()}] ${item.title}：${item.detail}${item.lines?.length ? `（L${item.lines.map((line) => line.start === line.end ? line.start : `${line.start}–${line.end}`).join('、L')}）` : ''}`);
    }
    lines.push('');
  }
  const fixable = report.checks.filter((item) => item.status !== 'pass' && item.remedy);
  if (fixable.length) {
    lines.push('## 怎么修');
    for (const item of fixable) {
      const where = item.lines?.length ? `L${item.lines.map((line) => line.start === line.end ? line.start : `${line.start}–${line.end}`).join('、L')} ` : '';
      lines.push(`- ${where}${item.title}`);
      for (const step of item.remedy.split('\n')) lines.push(`  - ${step}`);
    }
    lines.push('');
    lines.push(`需要可直接交给宿主的修复任务：\`annot repair ${report.file}\`（加 \`--check <id>\` 只修一项）。`);
    lines.push('');
  }
  lines.push('## 评估方法');
  for (const stage of report.evaluation.stages) lines.push(`- ${stage.title}：${stage.question} ${stage.method}`);
  return `${lines.join('\n').trim()}\n`;
}
