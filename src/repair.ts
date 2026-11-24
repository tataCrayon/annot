/**
 * Diagnosis → repair task.
 *
 * The reviewer can already say what is wrong and where. What it could not do is
 * hand that finding to the host in a form the host can execute: the panel only
 * offered an *evaluation* task, so a blocked skill had no path back to "fixed".
 * The user's report was exactly that — "存在阻断项" on screen, and no button
 * that produces the fix.
 *
 * This module closes the loop without writing anything. It turns the failing
 * checks into a bounded task: the exact lines, the exact current bytes, one
 * remedy per check, and a pass condition that is re-checkable by the same
 * command that produced the finding. The host edits; `annot review` decides.
 *
 * Two rules are load-bearing:
 *
 * 1. Never invent a location. A check that did not locate its lines says so and
 *    asks the host to locate them first; guessing "the description is around
 *    line 3" is how a repair lands on the wrong paragraph.
 * 2. Never let "make the check pass" become "delete the evidence". Every task
 *    states that shrinking the Skill until the finding disappears is a failure,
 *    because a checklist that rewards deletion will get deletion.
 */

import type { SkillStandardReport, StandardCheck } from './standards.ts';

export type RepairArtifact = 'skill' | 'sidecar' | 'references' | 'folder';

/**
 * Where each check's fix lives. Kept as data rather than a comment so the task
 * and the UI can both say "this one is a sidecar edit, not a rewrite".
 */
const ARTIFACT_BY_CHECK: Record<string, RepairArtifact> = {
  'note-coverage': 'sidecar',
  'references-exist': 'references',
  'reference-depth': 'references',
  'folder-name': 'folder',
};

const ARTIFACT_LABEL: Record<RepairArtifact, string> = {
  skill: 'SKILL.md',
  sidecar: 'annot.sidecar.json（不改 SKILL.md）',
  references: 'references/ 下的文件与入口链接',
  folder: 'Skill 目录名',
};

export interface RepairTarget {
  skill: string;
  file: string;
  /** sha256 of the source the report was computed from. */
  sha: string;
  check: StandardCheck;
  artifact: RepairArtifact;
  /** Exact current bytes for the lines the check located, 1-based. */
  excerpt: Array<{ n: number; text: string }>;
}

export interface RepairPlan {
  skill: string;
  file: string;
  sha: string;
  readiness: SkillStandardReport['readiness'];
  targets: RepairTarget[];
  /** Failing checks with no remedy text; listed so they cannot be silently dropped. */
  unfixable: StandardCheck[];
  /** Passing checks, so the host knows what must not regress. */
  keepPassing: StandardCheck[];
  /**
   * Extra instructions the reader pasted or typed when asking for the task.
   *
   * It is quoted verbatim and bounded: it steers what the host should
   * prioritise, it never widens the scope of what may be edited.
   */
  note?: string;
  /**
   * The proposal file the workbench reads, when the caller knows it.
   *
   * A repair edits the bytes every anchor was hashed from, so the analysis is
   * stale the moment the first check flips to pass. Naming the file to
   * overwrite is the difference between "the graph is wrong now" and "the graph
   * will be right again after one command".
   */
  analysisPath?: string;
}

export interface RepairOptions {
  /** Only these check ids. Unknown ids are rejected by the caller, not ignored. */
  checkIds?: string[];
  /** Free-text instructions from the reader, echoed into the task. */
  note?: string;
}

/**
 * Which requested ids produced no work.
 *
 * Today every failing check carries a remedy, so this is normally empty — but
 * the filter lives here (not in the CLI) so a future check that lands without
 * one cannot be dropped silently: the caller enumerates it and can say so.
 */
export function unresolvedCheckIds(report: SkillStandardReport, plan: RepairPlan, checkIds: string[] = []): string[] {
  const known = new Set(report.checks.map((check) => check.id));
  const handled = new Set([...plan.targets.map((target) => target.check.id), ...plan.unfixable.map((check) => check.id)]);
  return checkIds.filter((id) => !handled.has(id) && known.has(id));
}

export function buildRepairPlan(report: SkillStandardReport, source: string, options: RepairOptions = {}): RepairPlan {
  const wanted = options.checkIds?.filter(Boolean) ?? [];
  const failing = report.checks.filter((check) => check.status !== 'pass');
  const selected = wanted.length ? failing.filter((check) => wanted.includes(check.id)) : failing;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  const targets: RepairTarget[] = [];
  const unfixable: StandardCheck[] = [];
  for (const check of selected) {
    if (!check.remedy) {
      unfixable.push(check);
      continue;
    }
    targets.push({
      skill: report.skill,
      file: report.file,
      sha: report.source_sha,
      check,
      artifact: ARTIFACT_BY_CHECK[check.id] ?? 'skill',
      excerpt: excerptOf(lines, check),
    });
  }

  return {
    skill: report.skill,
    file: report.file,
    sha: report.source_sha,
    readiness: report.readiness,
    targets,
    unfixable,
    keepPassing: report.checks.filter((check) => check.status === 'pass' && !wanted.length),
    note: options.note?.trim() || undefined,
    analysisPath: options.analysisPath,
  };
}

/** The bytes a repair would touch, read from the source rather than from a label. */
function excerptOf(lines: string[], check: StandardCheck): Array<{ n: number; text: string }> {
  if (!check.lines?.length) return [];
  const out: Array<{ n: number; text: string }> = [];
  const seen = new Set<number>();
  for (const range of check.lines) {
    for (let n = range.start; n <= range.end; n++) {
      if (n < 1 || n > lines.length || seen.has(n)) continue;
      seen.add(n);
      out.push({ n, text: lines[n - 1] });
    }
  }
  return out.sort((a, b) => a.n - b.n);
}

function formatRange(check: StandardCheck): string {
  if (!check.lines?.length) return '位置未定位';
  return `L${check.lines.map((line) => (line.start === line.end ? String(line.start) : `${line.start}–${line.end}`)).join('、L')}`;
}

export function formatRepairTask(plan: RepairPlan): string {
  const severity = (check: StandardCheck): string => (check.status === 'fail' ? '阻断' : '建议');
  const blocking = plan.targets.filter((target) => target.check.status === 'fail').length;
  const out: string[] = [];

  out.push(`# Skill 修复任务：${plan.skill}`);
  out.push('');
  out.push('状态：待宿主执行；annot 只生成了这份任务，**没有修改任何 Skill 文件**。');
  out.push('');
  out.push(`源文件：${plan.file}`);
  out.push(`源文件 sha256：${plan.sha}`);
  out.push(`检查结论：${plan.readiness === 'blocked' ? '存在阻断项' : plan.readiness === 'review' ? '建议复核' : '通过'}`);
  out.push(`本任务要修：${plan.targets.length} 项（阻断 ${blocking} / 建议 ${plan.targets.length - blocking}）`);
  out.push('');

  out.push('## 执行顺序');
  out.push('1. 先读源文件全文与本任务的每段摘录，确认摘录和当前文件逐字一致；不一致说明文件已变，先 `annot review` 重新生成任务，不要按旧行号改。');
  out.push('2. 先检查 Git 工作区与未提交改动；不得覆盖用户无关修改。');
  out.push('3. 先修阻断，再修建议；一次只改一项，改完当场验证，失败就回退这一项再继续。');
  out.push('4. 只改本任务列出的行和文件；范围外的措辞、标题层级、顺序一律不动。');
  out.push('5. 每项改完运行 `annot review ' + plan.file + '`，确认这一项从 fail/warn 变成 pass，且没有新增任何 fail/warn。');
  out.push('6. 返回实际 diff、每项的验证结果，以及无法修复的项目和原因。');
  out.push('');

  out.push('## 不能做的事');
  out.push('- 不能为了过检而删除内容、缩短正文、删掉链接或把说明改成空段。检查项清零不代表 Skill 变好；删掉证据等同于没修。');
  out.push('- 不能编造目标：需要指向某个动作/门禁/产物时，必须真的在文件里存在；找不到就写清「未找到」，不要硬绑。');
  out.push('- 不能顺手润色、重排、整篇重写，也不能改动本任务范围之外的 frontmatter 字段。');
  out.push('- 不能把「静态检查通过」讲成「Skill 效果变好」；效果仍需隔离对照运行，没有运行就写「未测」。');
  out.push('- 补充说明只改变优先级与取舍，不扩大可改动的范围；与上面任何一条冲突时，以上面的边界为准。');
  out.push('');

  if (plan.note) {
    // Verbatim and fenced: the reader's own words steer the repair, but they
    // are instructions to weigh, not a licence to edit files outside the plan.
    out.push('## 读者补充说明（原样引用）');
    out.push('```');
    for (const line of plan.note.split('\n')) out.push(line);
    out.push('```');
    out.push('- 先做与这段说明直接相关的项；与它无关的项照常按顺序修。');
    out.push('- 说明里要求的改动如果超出了本任务的检查项范围，先停下来写清为什么超出，不要自行扩大范围。');
    out.push('');
  }

  if (!plan.targets.length) {
    out.push('## 待修项');
    out.push('- 没有带修复指引的未通过项。');
    out.push('');
  }

  plan.targets.forEach((target, index) => {
    const { check } = target;
    out.push(`## ${index + 1}. [${severity(check)}] ${check.title}（\`${check.id}\`）`);
    out.push('');
    out.push(`- 现状：${check.detail}`);
    if (check.evidence) out.push(`- 证据：${check.evidence}`);
    out.push(`- 位置：${formatRange(check)} · 改动落在 ${ARTIFACT_LABEL[target.artifact]}`);
    out.push('');
    if (target.excerpt.length) {
      out.push('当前原文（逐字，含行号，请按此定位）：');
      out.push('```');
      for (const line of target.excerpt) out.push(`${String(line.n).padStart(4, ' ')} | ${line.text}`);
      out.push('```');
    } else {
      out.push('当前原文：**检查项没有定位到具体行。** 先运行 `annot review ' + plan.file + ' --json`，按该检查项的 `lines` 找到位置；找不到就把这一项报告为「未修复」并说明原因，不要猜行号。');
    }
    out.push('');
    out.push('怎么修：');
    for (const step of check.remedy?.split('\n') ?? []) out.push(`- ${step}`);
    out.push('');
    out.push(`这一项算修好：\`annot review\` 里 \`${check.id}\` 的状态为 pass，且其它检查项没有新增 fail/warn。`);
    out.push('');
  });

  if (plan.unfixable.length) {
    out.push('## 没有自动修复指引的项（不要跳过）');
    for (const check of plan.unfixable) out.push(`- [${severity(check)}] ${check.title}（\`${check.id}\`）：${check.detail}`);
    out.push('- 这些项需要人工判断：先说明它的影响，再提出具体改法并执行；判断不了就保留原状并在结果里标注「待人工确认」。');
    out.push('');
  }

  out.push('## 验收');
  out.push(`- \`annot review ${plan.file} --json\`：本任务列出的每一项都变成 pass。`);
  out.push('- 全库无新增 fail；原本通过的项目没有变成 fail/warn。');
  out.push('- 改动改变了源字节，所以修复之后的动作图必须重做，不能沿用旧的 flow.json：');
  if (plan.analysisPath) {
    out.push(`  1. \`annot analyze ${plan.file}\`，覆盖 \`${plan.analysisPath}\`（旧的锚点指向已经不存在的行，annot 会拒绝它，这是预期行为）。`);
    out.push(`  2. \`annot annotate ${plan.file} --analysis ${plan.analysisPath}\`，确认新图能生成、没有 broken 锚点。`);
  } else {
    out.push('  1. `annot analyze <skill>` 重新生成 AI 分析，覆盖原来的提案文件。');
    out.push('  2. `annot annotate <skill> --analysis <proposal.json>` 重建图，确认没有 broken 锚点。');
  }
  out.push('- 「检查项 pass」与「图能重新画出来」是两件事，结果里分开写：前者是本任务的验收，后者依赖第 1 步重做分析。');
  out.push('- 结果里同时给出：每项改前/改后摘录、验证输出、仍然未修的项目与原因。');
  out.push('');

  if (plan.keepPassing.length) {
    out.push('## 本次不应改动的检查项（保持通过）');
    for (const check of plan.keepPassing) out.push(`- \`${check.id}\` ${check.title}${check.evidence ? `（${check.evidence}）` : ''}`);
    out.push('');
  }

  out.push('## 边界');
  out.push('- 这份任务来自静态规范检查：它证明 Skill 更符合可加载/可追溯的要求，不证明行为效果更好。');
  out.push('- 行为效果需要 baseline 与 Skill 的隔离对照运行；没有运行结果时，效果一律写「未测」。');

  return `${out.join('\n')}\n`;
}

/** One-line summary for a panel or a log: what this task will touch. */
export function repairSummary(plan: RepairPlan): string {
  const counts = new Map<RepairArtifact, number>();
  for (const target of plan.targets) counts.set(target.artifact, (counts.get(target.artifact) ?? 0) + 1);
  if (!counts.size) return `${plan.skill}：没有可修复项`;
  const parts = [...counts.entries()].map(([artifact, count]) => `${ARTIFACT_LABEL[artifact]} ${count}`);
  return `${plan.skill}：${plan.targets.length} 项 —— ${parts.join('，')}`;
}
