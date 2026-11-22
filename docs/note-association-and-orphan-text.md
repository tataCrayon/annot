# 说明关联与孤立文本率

## 结论

“说明应该服务动作”方向正确，但不能要求每段说明都绑定一个动作。合理的说明至少应满足以下一种关系：

- 支撑某个关键动作
- 约束某个门禁
- 帮助某个判断
- 解释某个产物
- 明确标注为适用于整个 Skill 的全局原则
- 被标记为未绑定，等待人工确认

因此系统把说明分成三类：

| 范围 | 含义 | 是否计入孤立 |
|---|---|---|
| `node` | 已关联到动作、门禁、判断、外部调用或产物 | 否 |
| `skill` | 全局原则、适用范围、背景或核心信念 | 否 |
| `unbound` | 当前没有可证实目标 | 是 |

## 关系模型

执行主线仍只包含动作、判断、门禁、调用和产物。说明关系是独立的非执行关系：

```text
说明 --支持动作--> 关键动作
说明 --约束门禁--> 门禁
说明 --辅助判断--> 判断
说明 --解释产物--> 产物
说明 --全局说明--> 整个 Skill
说明 --无目标--> 孤立说明
```

关系不会改变流程深度，也不会让说明冒充动作。

## 说明角色

说明节点增加语义角色：

- 原则 `principle`
- 理由 `rationale`
- 定义 `definition`
- 触发条件 `trigger`
- 背景 `context`
- 风险 `risk`
- 示例 `example`
- 参考 `reference`

结构类型与语义角色分开，避免把“风险说明”等细分类别膨胀成大量顶层节点类型。

## 关联规则

### 高置信关系

- 方法原文明确提到目标标题或名称。
- 人工 sidecar 指定 `associatesWith`。

### 结构关系

- 说明和目标位于同一标题路径，且距离不超过 24 行；引用类说明优先关联本节动作，风险类说明优先关联本节门禁。
- 只共享更浅层标题时，距离不超过 12 行。

无法满足这些条件的说明不会被强行连线。

## 孤立文本率

```text
孤立文本率 = 无节点目标且无全局范围的说明数 / 说明总数
```

解释：

- 它不是 Skill 效果分。
- 它是 Skill 结构和可追踪性的导航指标。
- 全局原则不记为孤立。
- 人工可以在 sidecar 里用 `associationScope: "skill"` 标为全局、用 `"unbound"` 放入待确认队列，或通过 `associatesWith` 绑定具体目标。
- 高比例提示可能有问题，不直接证明执行失败。

建议解释：

| 孤立率 | 建议 |
|---:|---|
| 0% | 没有发现结构孤岛 |
| 1–25% | 人工抽查说明是否属于全局原则 |
| 26–50% | 优先检查无目标段落与章节边界 |
| >50% | 很可能存在说明散落、流程缺失或抽取切分问题 |

阈值是审查优先级，不用于自动判定 Skill 好坏。

## 为什么要独立建模

Agent Skills 使用渐进披露：`SKILL.md` 应承载执行所需信息，详细资料进入按需读取的 references。说明本身有价值，但如果既不在执行路径上、也不能说明作用于整个 Skill，就很难判断它在执行时是否会参与决策。

需求工程中的 bidirectional traceability 也强调来源与目标之间的可追踪关系。这里的“孤立说明率”借鉴的是 traceability 审计思路，不复制任何具体标准算法。

## 参考

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills: Best practices for skill creators](https://agentskills.io/skill-creation/best-practices)
- [Agent Skills: Evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills)
- [OpenAI: Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills)
- [ISO/IEC/IEEE 29148 requirements engineering](https://standards.ieee.org/ieee/29148/6937/)
