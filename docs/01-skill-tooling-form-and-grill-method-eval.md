# Skill 工具形态调研 + grill-method 评估

> 日期：2026-11-12｜方法：idea 模式（想法体检：FRAME → RECON → THEORY → STRESS → VERDICT）+ method 模式（方法拷问）
> 证据纪律：本文所有项目名 / star 数均为 2026-11-12 通过 GitHub API 实测读数；未能核实的项目已单独标注，不作为结论依据。

---

## 0. 一句话结论

**做，但形态不是「插件」，也不是「独立 GUI 应用」。**

推荐形态：**Skill 自身即产品（skill-first）→ 确定性脚本产出单文件 HTML → MCP Apps 作为可选交互通道 → 插件只作为第三阶段的打包分发壳**。

护城河不在「把 Skill 画成流程图」（这件事已经被证明没有壁垒），而在：

> **显式 flow schema（带源码锚点） → trace 反投影 → 自然语言生成可 diff 的 patch → 重跑同一组 eval 验证是否真变好**

这条闭环目前**没有检索到完整的开源实现**。

---

## 1. 行业实证：六种形态，各有可核实样本

| # | 形态 | 真实样本（star / 创建日） | 优点 | 硬伤 |
|---|---|---|---|---|
| 1 | 纯 Skill（SKILL.md + scripts） | [anthropics/skills](https://github.com/anthropics/skills) 193,332；[openai/skills](https://github.com/openai/skills) 28,704；[agentskills](https://github.com/agentskills/agentskills) 27,203（规范） | 分发零成本、跨宿主通用、被 agent 原生加载 | 无 UI、无状态、难评估 |
| 2 | 单文件 HTML 产物 | [skillscope](https://github.com/silvesterdivas/skillscope) 15（SKILL.md→交互流程图+0-100 评分，creation=pushed=2026-02-20 后无更新）；[archify](https://github.com/tt-a1i/archify) 95,735；[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) 92,238 | 零安装、可离线、可分享、可 PNG 导出 | 静态，读不到执行真相 |
| 3 | CLI / eval harness | [skill-eval-harness](https://github.com/adewale/skill-eval-harness) 79（paired with/without 因果增益、泄漏 lint、ablation、trigger matrix、cost telemetry）；[comet](https://github.com/rpamis/comet) 3,294（Rubric / Pass@k / Pass^k） | 确定性评分、可进 CI、可 diff 报告 | 没有可视化，学习曲线陡 |
| 4 | Claude Code plugin（marketplace 打包） | [okf-skills](https://github.com/scaccogatto/okf-skills) 449 的四通道之一；官方文档 [Plugins overview](https://code.claude.com/docs/en/plugins) | 一键装、可带 subagent/hook/MCP | **绑定单一宿主** |
| 5 | MCP server + 交互 UI（MCP Apps / MCP UI） | [MCP-UI-Org/mcp-ui](https://github.com/MCP-UI-Org/mcp-ui) 5,261；[modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) 3,079；[dsh-mcp-apps-host](https://github.com/oriliz/dsh-mcp-apps-host) 194（在 DSH 里把 MCP `_meta.ui` 渲染成沙箱 iframe 交互卡） | 聊天内原生交互、宿主无关、协议标准化 | 需要跑常驻进程；UI 能力受宿主限制 |
| 6 | 平台级可观测 | [Langfuse](https://github.com/langfuse/langfuse) 37,341（定位已写入 "prompt/skill management"，OTel 底座）；[Laminar](https://github.com/lmnr-ai/lmnr) 3,485；[claude-code-telemetry](https://github.com/KubeRocketCI/claude-code-telemetry)（按 skill 归集 token/cost） | 生产级、跨 agent、可长期留存 | 重、要部署、不是给"单 skill 调优"用的 |

### 关键观察（这三条决定了形态）

1. **「一套内容，多通道分发」已经是收敛的最佳实践。** okf-skills 一份内容发四种：Claude Code plugin（`/plugin marketplace add`）+ agentskills（`npx skills add`）+ GitHub Action（CI 校验，无 agent 也能跑）+ MCP server（给读不到文件的宿主）。**反过来推：只做插件 = 主动放弃另外三个通道，并把产品绑死在一个宿主的版本节奏上。** 你自己的 `docs/MULTI-TOOL-AUTHORITY.md` 已经为"多宿主归一"付过一次代价（junction 壳 + 33 对漂移），不该在新工具上再造一个宿主绑定点。

2. **「可视化」本身没有壁垒。** skillscope 用单 HTML 就把"SKILL.md → 流程图 + 评分"做完了，5 个月无更新、15 star。而 archify（95.7k）/ Understand-Anything（92.2k）证明的是：**把"生成图"做成 skill 比做成 app 更容易被采用**。你的会话里现在就有 `archify` 这个技能，这就是证据。

3. **「评估」已经被人做穿。** skill-eval-harness 的做法就是正解：单输出打分回答不了"这个 skill 有没有用"，只有 `(case, model, repetition)` 配对的 with/without 差值才是证据，再加泄漏 lint、ablation、trigger matrix、lift-per-dollar。自己再写一遍是重复劳动。

**→ 空白在 A↔C 的连接上**：现有项目要么只做静态图（skillscope），要么只做 eval（harness），要么只做 trace（Langfuse / OTel）。从**一次失败的 trace 反查回 SKILL.md 的具体小节** → 自然语言改写 → 生成 patch → **重跑同一组 eval 证明它真的变好了** —— 这条闭环是空的。

---

## 2. 对你调研资料的事实核验（重要，且不太好听）

用 GitHub API 按名字逐个检索，结果：

**未能核实（检索不到对应项目）**：Tuning Fork、Agent-Insight / witty-skill-insight、LangGraphics、Binex、LangConfig、pyagent-studio、OpenClaw Office。
- `tuning fork skill debugger` 只命中一个无关的 quant 交易 fork；`vibelens` 只命中 [CHATS-lab/VibeLens](https://github.com/CHATS-lab/VibeLens) 21 star（会话可视化，与描述一致但量级很小）。

**能核实**：Laminar 3,485｜Langfuse 37,341｜AutoGen 61,788｜Waldiez 131｜LangGraph 44,832｜VibeLens(CHATS-lab) 21。

**结论**：调研资料里**最贴题的那批工具，恰好是全部无法核实的**。这有两种解释——私有/内部产品，或记忆漂移。无论哪种，**都不能作为架构决策的事实基础**。按 idea 模式的红线："搜不到 ≠ 没人做"，但也绝不能把"据说它能做"当成"已有人做"。正确动作是把这批工具降级为「假设有人在做」，先自己验证需求（见 §6）。

---

## 3. 形态判决

### 🔧 改造 —— 方向成立，换形态

三阶段，每阶段独立可交付价值：

**阶段 1（估 1–2 周）：Skill + 单文件 HTML 产物**
- 交付 `skill-flow` skill：输入 SKILL.md → 输出 `flow.json`（显式 schema）+ `flow.html`（自包含、可离线双击）
- 确定性部分走脚本（Python，仓库已有 `scripts/check-links.py` 先例）；语义抽取用 LLM，但**结果落盘**，二次渲染不再调模型 → 可 diff、可 review、可进 git
- 无后端、无安装、无网络依赖

**阶段 2（+2 周）：trace 反投影 + 自然语言 patch**
- 读 transcript（Claude Code / DSH session 文件）→ 映射到 flow 节点 → 高亮真实路径、标出偏差与死路
- 自然语言指令 → 生成 SKILL.md 的 unified diff（**只生成，不落盘**）→ 人工确认
- 这一步才是"用自然语言调整 Skill"

**阶段 3：eval 闭环 + 多通道分发**
- 复用 skill-eval-harness 的 manifest 思路，**不自研 eval 引擎**
- 分发：`npx skills add` 式 / Claude Code plugin marketplace / MCP Apps 交互 UI

### 明确不做
- ❌ 独立 Electron / Web 后端应用（部署成本 > 收益，且用户本来就在 IDE 和聊天里）
- ❌ 自研 trace 采集协议（吃现成 transcript + OTel 就够）
- ❌ 自研 eval 引擎（先接 skill-eval-harness / comet，跑通再谈替换）
- ❌ 第一版就做插件（会把上面的通道全锁死）

---

## 4. 为什么形态必须这样：三个技术事实

**(1) Skill 不是程序，没有 AST —— 所以"可视化"必须先定义一个中间层**

保真度分三层：
- **L1 大纲**：标题 + 列表 + 表格 → 得到的是"节的树"，**不是流程图**。skillscope 声称的 triggers / branches 靠关键词猜测，不可靠。
- **L2 语义图**：让 LLM 抽出「状态 / 决策 / 门禁 / 产物 / 外部调用」→ 这才是流程图。
- **L3 执行图**：从 trace 得到真实路径，反投影到 L2 上高亮。

致命问题：如果 L2 每次渲染都重新让模型猜，**结果不可复现、不可 diff**，用户根本无法判断"我改了这句话，图变了没有"。所以必须有显式 `flow.json` 作为**缓存 + 契约**：SKILL.md 仍是唯一真源，flow.json 是派生物，配一个 drift 检查器（思路同你仓库的 `check-links.py`）。这是本工具相对 skillscope 的核心差异点，也是唯一值得写下来的设计决策。

**(2) 自然语言编辑必须落在"锚点"上**

"把第 3 步拆成两步"这类指令要能变成 patch，前提是 flow.json 每个节点都带：
```
source: { file, heading_path, line_start, line_end, content_hash }
```
没有锚点，自然语言改写只能整篇重写 → 不可 diff、不可回滚、不可 review。**锚点是这个工具最核心的数据结构，比任何 UI 都重要。**

**(3) 评估必须是配对因果，不是单次通过**

见 §5.3 —— 你自己的 grill-method benchmark 就是反面案例。

---

## 5. grill-method 评估

### 5.1 事实（先说最要紧的）

| 项 | 实测 |
|---|---|
| 仓库副本 | `skills/grill-method/SKILL.md`，108 行 / 5,549 字符，description 598 字符，**无 evals/** |
| 全局副本 | `~/.agents/skills/grill-method/` **已不存在** |
| 内容去向 | 并入 `~/.agents/skills/challenge/references/mode-method.md`（合并日期标注 2026-10-22） |
| 本会话技能目录 | 只有 `challenge`（mode 分派），**没有 `grill-method`** |
| 现存 eval | `challenge/evals/from-grill-method/`：1 iteration × 3 eval × 2 variant，9/9 PASS |

**→ 已经漂移了。** 仓库仍在把 grill-method 当独立 skill 卖，全局已经不在这个形态。受影响引用（至少 11 处）：
`README.md:37`、`README.zh-CN.md:55`、`AGENTS.md:52`、`DEPLOYMENT.md:18`、`DEPLOYMENT.md:105`、`DEPLOYMENT.md:118`、`rules/skill-routing.md:53`、`ai-coding-workflow-architecture.md:74`、`ai-coding-workflow-architecture.md:300`、`skills/idea-vetting/SKILL.md:55`、
`skills/workflow-migrator/references/migration-playbook.md:111`。

这正是你仓库 `docs/MULTI-TOOL-AUTHORITY.md` 记录过的"33 对漂移实体"复发：**仓库停在 V3.1 形态，全局已经演进到合并后的形态，两边描述能力的方式不一致**。更严重的后果是：仓库现在在教 AI 使用一个全局已不存在的技能名。

### 5.2 设计层面：三个可改进点

1. **description 598 字符 + 三向触发词交叉**（grill-me / DDD / idea-vetting 都在争"拷问/质疑"）。合并成 `challenge` 后用"按被审对象选 mode"一张表解决——这是正确演进。**仓库应该跟进，而不是继续维护独立版。**

2. **判决卡是全文最有价值的部分，但被当成了文档格式。** `⚖️ 方法判决` 的 4 个字段（被审方法 / 拷问记录 / 判决 / 采用方法）是**全文唯一有机器形状的产物**。建议升级成一等公民：加版本化 schema，让 Mode A 直接结构化输出
   ```json
   { "method": "...", "attacks": [{"vector":"assumption|tradeoff|failure|alternative","q":"...","a":"..."}],
     "verdict": "hold|amend|replace", "adopted": "...", "reason": "...", "override": null }
   ```
   一步做到两件事：让 grill-method 可被确定性 eval，同时 **成为 skill-flow 的第一个真实 fixture**。

3. **可判定的规则和不可判定的规则混在一起。** "一次一问""3 轮封顶"是可判定的（能写断言）；"≤10 行判决卡""必须给出推荐"在纯文本里无法自检 → 属于靠模型自觉的断言，应该转成确定性检查（regex / 字段存在性）。

### 5.3 评估层面：现有 benchmark 不足以证明它有用

`challenge/evals/from-grill-method/benchmark.json`：1 iteration、3 eval、2 variant、9/9 assertions PASS、`generated_at` 2026-09-14。

按 skill-eval-harness 的标准逐条对：

| 问题 | 后果 |
|---|---|
| 单 iteration、9/9 全 PASS | **零区分度**——只能证明"没跑偏"，不能证明"比 baseline 好" |
| 无 holdout、无重复运行 | 分不清"真变好"和"这次运气好"（你调研资料点名的坑，自己的 benchmark 也踩了） |
| 断言由 grader 读输出人工写 | 主观、不可复现；无字符串/regex/文件/JSON 字段类确定性断言 |
| 无泄漏 lint | eval1 的 prompt 里"直接开始吧"就是强提示信号，容易教模型作弊 |
| 只有 3 个 eval，其中 1 个是负例 | 正例仅 2 个，且都由作者自编 → **过拟合风险高** |
| 无 lift-per-dollar | token 是 baseline 的 1.6–2.5×，无法判断"值不值这个钱" |

### 5.4 判决：🔧 改造（按顺序做三件事）

1. **止血漂移（半天）**：仓库归档 `skills/grill-method`，11 处引用改指 `challenge`，跑 `scripts/check-links.py` 验证 exit 0。
   *理由：现在仓库与运行时的事实不一致，任何依赖它的自动化都是错的。*
2. **结构化判决卡（1 天）**：Mode A 同时产出 `verdict.json`（带源码锚点），作为 skill-flow 的 golden fixture。
3. **重做 eval（2 天）**：paired with/without、≥5 正例 + ≥2 负例、确定性断言（regex 检查判决卡 4 字段齐全）、3 次重复看稳定性、记录 lift-per-dollar。

**不要做**：再写一版更长的 SKILL.md。问题不在篇幅，在于产物不可验证。

### 5.5 顺带发现（对工具设计有直接影响）

**grill-method 是极好的第一个 fixture，因为它天然就是一张图：**

```
STATE ──→ ATTACK(×4 方向: 假设/权衡/失败模式/更优替代，可并行)
              │
              ▼
          VERDICT ──┬── ✅ hold    ──┐
                    ├── 🔧 amend   ──┼──→ COMMIT (采用方法 + 幸存理由)
                    └── 🔁 replace ──┘
              │                        ▲
              ├── override（用户否决，立即继续）──┘
              └── escalate（高风险 → DDD 新上下文审查者）
```

节点类型齐全（阶段 / 分支 / 门禁 / 产物 / 外部调用），分支条件是**可判定的枚举**（hold / amend / replace）。建议第一版 schema 用**双 fixture**验证：
- **流程型**：`grill-method`（4 阶段 + 3 判决 + 2 特殊边）
- **路由型**：`challenge` 的 mode 分派表（一张真值表，检验 schema 能否表达"按被审对象分流"）

两种都表达得了，schema 才算立住。

---

## 6. 最便宜的验证（≤1 天，先验证最危险的假设）

**最危险的假设不是"能不能画出图"，而是"把 SKILL.md 变成显式 flow.json 之后，用户真的会用自然语言去改它，而不是继续直接改 markdown"。**

实验（半天可完成）：
1. 手工把 grill-method 写成 `flow.json`（约 25–35 个节点，含锚点）
2. 手写 3 条自然语言修改指令，例如：
   - "把 ATTACK 的四方向拆成必须逐个回答，不许一次答完"
   - "把 3 轮封顶改成按风险分级：高风险 5 轮，低风险 1 轮"
   - "给 Mode A 加一条：判决为 replace 时必须写明回滚方式"
3. 看能否稳定生成你认可的 patch

- **通过信号**：3 条里 ≥2 条 patch 只需微调即可接受，且你能明确指出"锚点在哪、为什么对得上"。
- **放弃信号**：patch 每次整段重写、锚点错位 >30% → 这套抽象不成立，退回"只做 trace 反投影 + eval"，放弃流程可视化。

---

## 7. 开放问题（需要你定，决定阶段 2/3 的优先级）

1. **使用者边界**：只你自己 + 团队 3–5 人，还是要对外发布？→ 决定要不要做 plugin / MCP 通道 / CI。
2. **主宿主**：日常主要在 DSH，还是 Claude Code？→ 决定 trace 读取器先写哪个（两边 session 格式不通用，只写一个）。
3. **目标 skill 形态**：只处理「流程型 skill」（有明确阶段与门禁，如 grill-method、backendflow-*），还是也包括「知识型 skill」（如 mysql-guard 的连接大全）？→ 后者没有流程，强行可视化是噪音；如果知识型也要覆盖，产品重心会从"流程图"偏向"结构图 + 体检报告"。
