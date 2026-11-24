import { readFile } from 'node:fs/promises';

import { auditFlow, type SkillAudit } from './audit.ts';
import { discoverSkills, type RootSpec } from './discover.ts';
import { buildFlow } from './flow.ts';
import { parseSkill } from './parse.ts';
import { reviewSkill, type SkillStandardReport, type StandardCheck } from './standards.ts';

export type ReportSeverity = 'fail' | 'warn';
export type IssueKind = 'standard' | 'extraction';

export interface LibraryIssue {
  id: string;
  skill: string;
  file: string;
  severity: ReportSeverity;
  kind: IssueKind;
  group: string;
  title: string;
  detail: string;
  evidence?: string;
  /**
   * The standard check that produced this issue, when there is one.
   *
   * Without it the report could say "this skill is blocked" but the panel had
   * no way to ask for the repair of *that* check — it could only fall back to a
   * whole-Skill task. Extraction issues keep it undefined because they have no
   * standard check to re-run.
   */
  check?: string;
  /** 1-based source lines, when the check located them. */
  lines?: Array<{ start: number; end: number }>;
}

export interface LibrarySkillReport {
  skill: string;
  file: string;
  readiness: SkillStandardReport['readiness'];
  checks: SkillStandardReport['summary'];
  audit: SkillAudit;
  issues: LibraryIssue[];
  evaluationStatus: 'unmeasured';
}

export interface LibraryReport {
  schemaVersion: 1;
  generatedAt: string;
  roots: string[];
  summary: {
    skills: number;
    ready: number;
    review: number;
    blocked: number;
    fail: number;
    warn: number;
    issues: number;
    orphanNotes: number;
    unmeasuredSkills: number;
  };
  skills: LibrarySkillReport[];
  issues: LibraryIssue[];
  skipped: Array<{ root: string; reason: string }>;
  boundary: string;
}

function standardIssue(skill: string, file: string, check: StandardCheck): LibraryIssue {
  return {
    id: `standard:${skill}:${check.id}`,
    skill,
    file,
    severity: check.status === 'fail' ? 'fail' : 'warn',
    kind: 'standard',
    group: check.group,
    title: check.title,
    detail: check.detail,
    evidence: check.evidence,
    check: check.id,
    lines: check.lines,
  };
}

function extractionIssues(skill: string, file: string, audit: SkillAudit): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  const add = (id: string, count: number, title: string, detail: string, severity: ReportSeverity = 'warn') => {
    if (count <= 0) return;
    issues.push({ id: `extraction:${skill}:${id}`, skill, file, severity, kind: 'extraction', group: 'extraction', title, detail: `${count} ${detail}` });
  };
  add('empty-text', audit.emptyText, '删除抽取中的空卡片', '张卡片没有正文，通常来自表格或代码围栏被错误切开。', 'fail');
  add('junk-labels', audit.junkLabels, '修正分隔线或标点标签', '个标签只有标点或 Markdown 装饰，不能表达动作。', 'fail');
  add('unresolved-branches', audit.unresolvedBranches, '补齐未落地的分支', '个分支没有目标；请确认目标动作，或明确它是终止条件。');
  add('low-confidence', audit.lowConfidence, '复核低置信动作', '张卡片来自低置信抽取，需要结合上下文重新分类或合并。');
  return issues;
}

export async function buildLibraryReport(roots: RootSpec[]): Promise<LibraryReport> {
  const { skills, skipped } = await discoverSkills(roots);
  const reports: LibrarySkillReport[] = [];
  for (const ref of skills) {
    let source: string;
    try {
      source = await readFile(ref.file, 'utf8');
    } catch {
      skipped.push({ root: ref.file, reason: 'unreadable' });
      continue;
    }
    const parsed = parseSkill(source);
    const doc = buildFlow(parsed, source, { sourceFile: 'SKILL.md' });
    const audit: SkillAudit = { skill: ref.name, file: ref.file, ...auditFlow(doc, parsed.totalLines) };
    const review = await reviewSkill(source, ref.file);
    const standard = review.checks.filter((check) => check.status !== 'pass').map((check) => standardIssue(ref.name, ref.file, check));
    const extraction = extractionIssues(ref.name, ref.file, audit);
    const issues = [...standard, ...extraction];
    reports.push({ skill: ref.name, file: ref.file, readiness: review.readiness, checks: review.summary, audit, issues, evaluationStatus: 'unmeasured' });
  }
  const rank = { blocked: 0, review: 1, ready: 2 } as const;
  reports.sort((a, b) => rank[a.readiness] - rank[b.readiness] || b.issues.length - a.issues.length || a.skill.localeCompare(b.skill));
  const issues = reports.flatMap((report) => report.issues);
  const count = (severity: ReportSeverity) => issues.filter((issue) => issue.severity === severity).length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    roots: roots.map((root) => root.path),
    summary: {
      skills: reports.length,
      ready: reports.filter((report) => report.readiness === 'ready').length,
      review: reports.filter((report) => report.readiness === 'review').length,
      blocked: reports.filter((report) => report.readiness === 'blocked').length,
      fail: count('fail'),
      warn: count('warn'),
      issues: issues.length,
      orphanNotes: reports.reduce((total, report) => total + report.audit.orphanNotes, 0),
      unmeasuredSkills: reports.length,
    },
    skills: reports,
    issues,
    skipped,
    boundary: '报告覆盖可发现性、静态规范与抽取结构；行为效果必须通过带/不带 Skill 的对照运行验证，当前未运行的结果不会计分。',
  };
}

export function formatLibraryOptimizationPrompt(report: LibraryReport, snapshot: { id: string; path: string }, reportPath: string): string {
  const urgent = report.issues.filter((issue) => issue.severity === 'fail').slice(0, 24);
  const warning = report.issues.filter((issue) => issue.severity === 'warn').slice(0, 24);
  const line = (issue: LibraryIssue) => {
    const where = issue.lines?.length ? `（L${issue.lines.map((item) => (item.start === item.end ? item.start : `${item.start}–${item.end}`)).join('、L')}）` : '';
    const fix = issue.check ? ` → 单项修复：\`annot repair ${issue.file} --check ${issue.check}\`` : '';
    return `- [${issue.severity}] ${issue.skill} · ${issue.title} — ${issue.detail}${issue.evidence ? `（${issue.evidence}）` : ''}${where}${fix}`;
  };
  return [
    '# annot 整库评估与优化任务', '',
    `生成时间：${report.generatedAt}`,
    `版本快照：${snapshot.id}`,
    `快照文件：${snapshot.path}`,
    `报告文件：${reportPath}`,
    '',
    '## 当前基线',
    `- Skill：${report.summary.skills}，静态通过：${report.summary.ready}，建议复核：${report.summary.review}，阻断：${report.summary.blocked}`,
    `- 问题：${report.summary.issues}（阻断 ${report.summary.fail} / 建议 ${report.summary.warn}）`,
    `- 孤立说明：${report.summary.orphanNotes}`,
    `- 行为效果：未测（${report.summary.unmeasuredSkills} 个 Skill）`,
    '',
    '## 必须遵守',
    '- 先读取报告和涉及的全部 SKILL.md，再做判断；不要只按关键词或正则直接改写。',
    '- 先检查 Git 工作区与未提交改动，不得覆盖用户无关修改。',
    '- 先修 fail，再修 warn；合并同一 Skill 的重复问题，避免把说明硬绑到错误动作。',
    '- 工作台是只读的：由当前宿主执行文件修改，完成后刷新整库报告。',
    '- 没有运行带 Skill / 不带 Skill 的对照测试时，明确写“未测”，不得生成效果分。',
    '',
    '## 阻断问题',
    ...(urgent.length ? urgent.map(line) : ['- 无']),
    '',
    '## 建议问题',
    ...(warning.length ? warning.map(line) : ['- 无']),
    '',
    '## 执行顺序',
    '1. 阅读报告：`' + reportPath + '`。',
    '2. 按 Skill 分批修改；每批先解释问题、目标动作、门禁与预期产出。',
    '3. 单项修复用 `annot repair <SKILL.md> --check <id>`：它会带出精确行号、当前原文和该项的验收条件；整库批量也先用它拿到逐项任务，再逐项执行。',
    '4. 对每个被改 Skill 运行 `annot review <SKILL.md>`，确认目标项变成 pass 且没有新增 fail/warn；涉及动作图时再运行 `annot annotate` 与 `annot verify`。',
    '5. 对高风险 Skill 建立行为 eval：至少包含应触发、不应触发、边界和失败恢复案例。',
    '6. 汇总“已修复 / 未修复 / 未测”三类结果，并给出下一轮报告所需命令。',
    '',
    '## 完成标准',
    '- 所有改动有明确来源和验收证据。',
    '- 静态阻断项清零；剩余建议项解释原因。',
    '- 行为效果有真实运行证据，或清楚标记未测。',
    '- 新报告可用于和快照 `' + snapshot.id + '` 对比。',
  ].join('\n');
}
export function formatLibraryMarkdown(report: LibraryReport): string {
  const esc = (value: string | undefined) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const rows = report.skills.map((skill) => {
    const readiness = skill.readiness === 'blocked' ? '阻断' : skill.readiness === 'review' ? '需复核' : '静态通过';
    return `| ${esc(skill.skill)} | ${readiness} | ${skill.issues.length} | ${skill.audit.nodes} | ${skill.audit.orphanNotes} |`;
  });
  const issues = report.issues.map((issue) => {
    const severity = issue.severity === 'fail' ? '阻断' : '建议';
    return `- **${severity} · ${esc(issue.skill)} · ${esc(issue.title)}**：${esc(issue.detail)}`;
  });
  return [
    '# annot Skill 库评估报告', '',
    `生成时间：${report.generatedAt}`,
    `扫描目录：${report.roots.length}`,
    '',
    '## 摘要', '',
    `- Skill：${report.summary.skills}`,
    `- 静态通过：${report.summary.ready}`,
    `- 建议复核：${report.summary.review}`,
    `- 阻断：${report.summary.blocked}`,
    `- 问题：${report.summary.issues}（阻断 ${report.summary.fail} / 建议 ${report.summary.warn}）`,
    `- 孤立说明：${report.summary.orphanNotes}`,
    `- 行为效果：未测（${report.summary.unmeasuredSkills} 个 Skill）`,
    '',
    '## 边界', '', report.boundary, '',
    '## 按修复优先级', '',
    '| Skill | 状态 | 问题数 | 卡片数 | 孤立说明 |',
    '|---|---:|---:|---:|---:|',
    ...rows, '',
    '## 全部问题', '',
    ...issues, '',
  ].join('\n');
}