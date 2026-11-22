import { formatEditContext, type EditContext } from './context.ts';
import { EVALUATION_METRICS, evaluationMethodology } from './standards.ts';
import type { FlowDoc } from './types.ts';

const EMPTY_INTENT = '尚未提供。先询问用户希望改变什么，不要自行猜测或整篇重写。';

export function formatRewriteBrief(context: EditContext, intent: string): string {
  return [
    `# Skill 自然语言修改任务：${context.skill}`,
    '',
    '状态：待宿主执行；annot 尚未修改源文件。',
    '',
    '## 用户意图',
    cleanIntent(intent),
    '',
    '## 执行顺序',
    '1. 先读取目标 Skill 与下面的锚定上下文，确认修改只落在一个明确节点。',
    '2. 如果意图仍有歧义，只问一个最影响结果的问题；意图明确时直接做最小修改。',
    '3. 修改前先保留一份 flow 快照，用于修改后的锚点检查。',
    '4. 只修改目标行；不要顺手润色、重排或整篇重写。需要动范围外的内容时，先停下来说明原因。',
    '5. 修改后运行 `annot check <flow.json> --skill <SKILL.md> --json`，区分预期中的 edited 与非预期的 moved/broken。',
    '6. 重新标注并确认图仍能读取，返回实际 diff、check 结论和任何未解决风险。',
    '',
    '## 完成标准',
    '- 用户意图在目标节点内可验证地落实。',
    '- 范围外内容保持原样；标题层级没有变化。',
    '- 锚点检查没有非预期 broken；新增或删除节点时有明确说明。',
    '- 不把“图能渲染”或“结构分下降”当成 Skill 行为已经变好的证据。',
    '',
    '## 锚定上下文',
    formatEditContext(context).trim(),
  ].join('\n');
}

export function formatEvaluationBrief(doc: FlowDoc, sourceFile: string, intent: string, metricIds: string[] = []): string {
  const branchCount = doc.edges.filter((edge) => edge.kind === 'branch').length;
  const unresolved = doc.nodes.reduce(
    (count, node) => count + node.branches.filter((branch) => !branch.to).length,
    0,
  );
  const headings = [...new Set(doc.nodes.flatMap((node) => node.anchor.heading.slice(-1)))];
  const methodology = evaluationMethodology();
  const metrics = EVALUATION_METRICS.filter((metric) => metricIds.includes(metric.id));

  return [
    `# Skill 行为评估任务：${doc.skill}`,
    '',
    '状态：效果未测；以下只是待执行的对照试验计划，不是评估结论。',
    '',
    `源文件：${sourceFile}`,
    `图规模：${doc.stats.byType.stage} 个关键动作 / ${doc.nodes.length} 张卡片 / ${doc.edges.length} 条连接 / ${branchCount} 条已绑定分支 / ${unresolved} 个未绑定分支`,
    `主要小节：${headings.slice(0, 12).join('｜') || '（无标题）'}`,
    '',
    '## 评估目标',
    cleanEvaluationIntent(intent, metrics.length > 0),
    '',
    '## 选定方向',
    ...(metrics.length
      ? metrics.map((metric) => `- ${metric.label}：${metric.description}`)
      : ['- 未指定方向。宿主先根据 Skill 与自然语言目标提出 3–5 个可观察方向，经用户确认后再执行。']),
    '',
    '## 事实边界',
    '- `annot audit` 只说明原文到图的抽取是否容易核验，不能证明 Skill 执行效果更好。',
    '- 效果必须来自相同输入下的对照实验：一个基线运行，一个加载当前 Skill 的运行。',
    '- 没有执行环境或无法隔离 Skill 时必须明确写“未测”，不能生成推测分数。',
    '',
    '## 评估分层',
    ...methodology.stages.map((stage, index) =>
      `${index + 1}. **${stage.title}** — ${stage.question}\n   方法：${stage.method}\n   证据：${stage.evidence}`),
    '',
    '## 评估设计',
    '1. 先阅读 Skill 的 description 与原文，写出 3–5 个可观察场景：主路径、分支/边界、接近触发但不该触发的反例，以及一个普通任务反例。',
    '2. 每个场景固定 prompt、允许看到的材料、成功条件和 2–4 条具名断言；断言必须能判定为通过或失败。',
    '3. 为每个场景运行 baseline 与 skill 两个变体，使用隔离的新会话、相同模型和相同工具权限；禁止候选运行读取基线答案。',
    '4. 每个变体至少重复 2 次；记录每条断言的通过情况、输出路径、耗时、token/调用成本和运行差异。',
    '5. 汇总总体通过率与每个场景通过率、负例误触发率、成本比例和方差；结论必须同时写出样本量和局限。',
    '',
    '## 优化循环',
    '1. 先建立基线并定位失败簇；没有基线时停止，不先改 Skill。',
    '2. 用流程图和行号把失败映射到具体节点，再用 `annot context` 取精确范围。',
    '3. 每轮只验证一个假设，只改一个节点或一类约束；同时记录预期改善的指标与可能受损的指标。',
    '4. 修改后重跑全部场景，目标指标改善且负例没有回归才保留；否则回退。',
    '5. 每轮运行 `annot check`，并输出改动节点、失败前后证据、接受/回退结论。',
    '',
    '## 结果汇总（执行后填写）',
    '- 每个场景分别记录 baseline 与 skill 的通过数、样本数和通过率。',
    '- 记录 paired delta、负例误触发率、成本比、延迟和重复运行方差。',
    '- 没有完成的运行保留为“未测”，不要用推断值补齐。',
    '- 结论必须引用运行产物与断言名，禁止只给一个总分。',
    '',
    '## 可接入工具',
    '- `skill-eval-harness`：需要 with/without 配对、触发矩阵、holdout 与 lift-per-dollar 时优先接入。',
    '- `Promptfoo`：已有 YAML/CLI/CI 工作流，需要对比矩阵和确定性断言时接入。',
    '- `Inspect AI`：需要隔离工具环境和可复现的 Agent 任务评测时接入。',
    '- `NVIDIA SkillEvaluator` / `Alibaba skill-up`：需要完整的 Skill 质量门禁、语义重叠检测或证据驱动演进时评估接入。',
    '',
    '## 方法来源',
    ...methodology.sources.map((source) => `- ${source.title}: ${source.url}`),
    '',
    '## 建议产物',
    '- `evals.json`：场景、prompt、断言与反例。',
    '- `runs/`：baseline 与 skill 的隔离输出。',
    '- `benchmark.json`：逐场景分数、延迟、token、重复次数与局限。',
    '- `optimization-log.md`：失败 → 节点 → 假设 → 改动 → 回归结果。',
    '',
    '将评估产物放在 Skill 之外的临时目录或 `.annot/evals/<skill>/`。除非用户明确要求，不要为评估修改 Skill 正文。',
  ].join('\n');
}

function cleanEvaluationIntent(intent: string, hasMetrics: boolean): string {
  const text = intent.trim();
  if (text) return text;
  return hasMetrics
    ? '未提供额外自然语言描述。按选定指标设计评估，不扩展到无关目标。'
    : '未指定方向或自然语言描述。先生成保守的全量计划，覆盖触发、正确性、安全、成本和稳定性。';
}

function cleanIntent(intent: string): string {
  return intent.trim() || EMPTY_INTENT;
}