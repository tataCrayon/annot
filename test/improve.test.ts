import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildEditContext, formatEditContext } from '../src/context.ts';
import { buildFlow } from '../src/flow.ts';
import { formatEvaluationBrief, formatRewriteBrief } from '../src/improve.ts';
import { parseSkill } from '../src/parse.ts';

async function fixture() {
  const source = await readFile(new URL('./fixtures/branch-table.md', import.meta.url), 'utf8');
  return {
    source,
    doc: buildFlow(parseSkill(source, { file: 'SKILL.md' }), source, { sourceFile: 'SKILL.md' }),
  };
}

test('rewrite brief binds intent to one source range and requires a before/after check', async () => {
  const { doc } = await fixture();
  const context = buildEditContext(doc, doc.nodes[0].id);
  assert.ok(context);

  const brief = formatRewriteBrief(context, '先检查未提交改动，再决定是否继续。');

  assert.match(brief, /状态：待宿主执行；annot 尚未修改源文件/);
  assert.match(brief, /先检查未提交改动，再决定是否继续/);
  assert.match(brief, new RegExp(`第 ${context.target.start}–${context.target.end} 行`));
  assert.match(brief, /Review the proposed method/);
  assert.match(brief, /修改前先保留一份 flow 快照/);
  assert.match(brief, /annot check <flow\.json> --skill <SKILL\.md> --json/);
  assert.match(brief, /结构分下降/);
  assert.ok(brief.includes(formatEditContext(context).trim()));
});

test('an empty rewrite intent tells the host to ask before editing', async () => {
  const { doc } = await fixture();
  const context = buildEditContext(doc, doc.nodes[1].id)!;

  const brief = formatRewriteBrief(context, '   ');

  assert.match(brief, /先询问用户希望改变什么/);
  assert.match(brief, /不要自行猜测或整篇重写/);
});

test('evaluation brief is a paired experiment plan, never a fabricated effect score', async () => {
  const { doc } = await fixture();

  const brief = formatEvaluationBrief(doc, 'SKILL.md', '验证触发准确性与执行成本');

  assert.match(brief, /状态：效果未测/);
  assert.match(brief, /`annot audit` 只说明原文到图的抽取是否容易核验/);
  assert.match(brief, /baseline 与 skill 两个变体/);
  assert.match(brief, /相同模型和相同工具权限/);
  assert.match(brief, /## 评估分层/);
  assert.match(brief, /触发与选择/);
  assert.match(brief, /配对因果/);
  assert.match(brief, /skill-eval-harness/);
  assert.match(brief, /接近触发但不该触发的反例/);
  assert.match(brief, /至少重复 2 次/);
  assert.match(brief, /目标指标改善且负例没有回归才保留/);
  assert.match(brief, /没有完成的运行保留为“未测”/);
  assert.match(brief, /3 条已绑定分支 \/ 0 个未绑定分支/);
  assert.doesNotMatch(brief, /最终得分[:：]\s*\d/);
});
test('evaluation directions are optional and can stand without an intent', async () => {
  const { doc } = await fixture();

  const focused = formatEvaluationBrief(doc, 'SKILL.md', '', ['selection', 'efficiency']);
  assert.match(focused, /未提供额外自然语言描述/);
  assert.match(focused, /触发与选择：该触发时选中/);
  assert.match(focused, /成本效率：token、工具调用/);

  const open = formatEvaluationBrief(doc, 'SKILL.md', '');
  assert.match(open, /未指定方向或自然语言描述/);
  assert.match(open, /覆盖触发、正确性、安全、成本和稳定性/);
});
