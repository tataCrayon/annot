# annot 的能力来源对照：哪些是借的，哪些是自己的

> 日期：2026-11-13｜方法：把 annot 的每条能力摊开，逐条对到已核实的公开项目上。
> 证据纪律：只写本轮实际读过源码/文档的对照。star 数为 2026-11-12 GitHub API 实测读数。
> 目的：**先说清楚哪些不是我们的**，再说剩下的那一点是不是真的新的。

---

## 0. 一句话结论

**annot 的绝大多数工程能力都是借的，而且借得理直气壮。真正原创的只有一条**：

> **把「自然语言文档」投影成图时，每个节点绑定它那几行原文的行级 sha256，并据此把"文件变了"分类成 moved / relocated / broken。**

这条能力在上述所有项目里都没有对应物——原因很具体：**其它工具的上游是「人写的结构化 spec」（archify 的 JSON、Mermaid），而 annot 的上游是「人写的散文」（SKILL.md）**。spec 不会自己变，散文会。所以只有 annot 必须回答"这段文字还在这儿吗"。

---

## 1. 借来的能力（有明确出处）

### 1.1 单文件自包含 HTML：零网络、零框架、双击即开

| 项 | 内容 |
|---|---|
| **出处** | [archify](https://github.com/tt-a1i/archify)（95,735★）；[skillscope](https://github.com/silvesterdivas/skillscope)（15★） |
| **原文证据** | archify `SKILL.md:13` — "Create a self-contained, interactive HTML diagram from a small typed JSON specification."；`SKILL.md:133` 给出无 shell 时的离线兜底路径 |
| **annot 的对应物** | `src/render.ts` 头注释："has to survive being emailed, opened from a USB stick, and read in a browser with no server behind it" |
| **借了什么** | 整个形态判断：产物必须是**一个文件**，不是"起个服务"。这条直接决定了测试怎么写（`assert.doesNotMatch(html, /src="https?:/)`） |

### 1.2 手写 SVG + 确定性布局算法

| 项 | 内容 |
|---|---|
| **出处** | archify（`renderers/workflow/`、`layout contracts`、"stable compiler receipt"） |
| **原文证据** | `SKILL.md:28` — "run `validate workflow <candidate.json> --layout-json` and use the stable compiler receipt; solver internals are not authoring controls"；`references/delivery-contract.md:11` 的原子交付 |
| **annot 的对应物** | `layoutNodes()`：最长路径松弛分层 → 每列垂直居中 → 手写三次贝塞尔 `M … C …` |
| **借了什么** | "**布局必须是确定性的、可复算的**"这个要求。archify 用 `receipt` 表达同一件事；annot 用"两次 `layoutNodes()` 输出必须完全相等"的测试表达 |
| **没借到** | archify 有 layout compiler 与几何诊断（`via` / `channelX` / `labelAt` 这类可调控件）；annot 只有一种布局，没有诊断、没有修复回路 |

### 1.3 typed JSON spec → renderer → validate → deliver，用退出码当契约

| 项 | 内容 |
|---|---|
| **出处** | archify；[audit-slim](file:///D:/Users/zigang.wang/.agents/skills/audit-slim/SKILL.md) 的 DoD 纪律 |
| **原文证据** | archify `SKILL.md:35` — "A non-zero exit can never be described as success."；audit-slim `SKILL.md:44` — "任何工作流变更的 DoD 必须包含'巡检工具 exit 0'"、`SKILL.md:37` — "删文件前先查引用；删引用后再跑 L2 归零" |
| **annot 的对应物** | `annot check` 退出码 0/1；`sandbox/run.sh` 每一步都断言退出码；README 写"退出码就是结论" |
| **借了什么** | 把"我认为对了"换成"命令返回 0"。这条是整个测试策略的地基 |

### 1.4 版本化 schema 字段

| 项 | 内容 |
|---|---|
| **出处** | archify（`schema_version: 1 / 2` 并存，新流程用 2、老流程保留 1 的固定几何） |
| **annot 的对应物** | `flow.json` 的 `"schema_version": 1` |
| **借了什么** | 只借了字段名与"显式声明版本"的习惯。annot 目前只有 v1，**没有做过迁移**，所以这条是空转的——真出现 v2 时才有意义 |

### 1.5 多 root 发现 + source rank 去重（100/200/250/300/400/500/600）

| 项 | 内容 |
|---|---|
| **出处** | 本机 `@linxin666/dsh-client-ui-skill-explorer` v0.4.8（DSH 官方 skill 管理插件） |
| **原文证据** | 该包 README 的 "Skills 七来源分组"；官方 rank：project `.dsh/skills` 100 / project `.agents/skills` 200 / runtime 250 / custom 300 / user `~/.dsh/skills` 400 / user `~/.agents/skills` 500 / bundled 600 |
| **annot 的对应物** | `src/discover.ts` 的 `DEFAULT_RANKS`（**刻意略去 250**，因为 runtime 注册的 skill 没有目录可扫） |
| **借了什么** | 整张 rank 表。这不是"参考"，是**照抄**——理由是：annot 看到的 skill 必须就是宿主看到的那一个，否则同一名字两个文件会让人以为是 annot 抽错了 |
| **诚实标注** | 这是全项目**最直接的抄袭**，且是故意的。licence 层面无风险（数字与约定不是可版权对象），但归属必须写清楚 |

### 1.6 审计摊表：把资产列成一张按证据排序的表

| 项 | 内容 |
|---|---|
| **出处** | [audit-slim](file:///D:/Users/zigang.wang/.agents/skills/audit-slim/SKILL.md)（本机 skill） |
| **原文证据** | `SKILL.md:49-64` Step 1"把工作流摊成一张表"+ 两列（最近一次触发证据 / 本条在解决什么失败模式）；`SKILL.md:66-74` Step 2 Keep/Merge/Delete 分级 |
| **annot 的对应物** | `src/audit.ts`：整库扫描 → 加权打分 → **最差的排最前** → 澄清单列 |
| **借了什么** | **报表形状**：单表、有分数列、有判定列、不要求人读全文 |
| **明确的差异** | audit-slim 是**人的判断 rubric**（触发证据要人翻会话记录）；annot 是**确定性计算的指纹**（空标签/空正文/未绑定分支都是程序能判的）。前者能判"这条规则该不该留"，后者只能判"这张图有没有画歪" |

### 1.7 "不做 eval 引擎，去接别人的"

| 项 | 内容 |
|---|---|
| **出处** | [skill-eval-harness](https://github.com/adewale/skill-eval-harness)（79★） |
| **原文证据** | 配对 `with_skill` / `without_skill` 的因果增益、`evals/shared-benchmark.json`、tune/holdout/holdback 切分、泄漏检查、ablation、trigger matrix、lift-per-dollar |
| **annot 的对应物** | **没有**。README 的"设计约束"里明确写：不做 eval 引擎，要配对因果增益就接它 |
| **借了什么** | 只借了**边界判断**：这块别人已经做穿，再写一遍是重复劳动 |

### 1.8 一套内容、多通道分发

| 项 | 内容 |
|---|---|
| **出处** | [okf-skills](https://github.com/scaccogatto/okf-skills)（449★）：一仓库五形态——Claude Code plugin + marketplace、skills.sh 可发现、GitHub Action、MCP server、`claude --plugin-dir` 本地开发 |
| **annot 的对应物** | `docs/02` §1 的四形态对照表；最终选 "引擎 + 两个宿主壳" |
| **借了什么** | "只做插件 = 主动放弃另外三个通道并绑死一个宿主"这个判断 |

### 1.9 结果：「标注」这个隐喻本身也不新

| 项 | 内容 |
|---|---|
| **出处** | 旁注（marginalia）是印刷术以来的传统；工程上有 `git blame`、Vim 的 `:annotate`、编辑器的 inline annotation |
| **说明** | 产品名 `annot` 表达的是"给任意 skill 做标注"，**没有发明新概念**，是把一个老隐喻套到新对象（SKILL.md）上。这不是缺点，但不应被讲成创新 |

---

## 2. 独立设计、但与既有做法收敛的能力

这几条是我写的时候没抄，事后对照才发现殊途同归的。

### 2.1 `context` 命令 = 上下文工程（bounded blast radius）

annot 不调模型，而是交出「精确行范围 + 原文 + 邻居 + 硬约束」，让宿主 agent 去改。

事后对照到的同类做法：

| 已有做法 | 相同点 | 不同点 |
|---|---|---|
| archify 的"bounded reading path"（`SKILL.md:17`："Do not read the optional Viewer Runtime reference unless…"；`SKILL.md:46`："Do not read renderer source, validator source, tests, or benchmarks before the first candidate"） | 都是**故意限制模型能看到的东西**，用信息边界代替"请小心" | archify 约束的是**读**；annot 约束的是**写**（哪几行能动） |
| Aider 的 SEARCH/REPLACE 编辑块 | 都是"小范围精确替换"而非整文件重写 | Aider 要模型**自己引用**原文片段；annot 由工具**给出**片段与行号，模型不需要复述 |
| 常规 code edit 的 `apply_patch` | 都是行级定位 | 那些工具靠 diff 上下文（前后 3 行）定位；annot 靠**已存的锚点**定位，不需要模型重述上下文 |

**判断**：这条的**思想不新**（信息最小化是老原则），但"工具主动算出模型该改哪几行"这个形态，在 skill 工具这个细分里我没找到对应实现。

### 2.2 sidecar 外置覆盖文件

`annot.sidecar.json`：机器猜错时不动原文件，在旁边放一个可入库的覆盖表。

同龄物：`.editorconfig`、`.prettierrc`、`tsconfig.json` 的 `overrides`、ESLint 的 `/* eslint-disable */` 之外的 config 文件。都是"**源文件保持干净，人的意志放旁边**"。

**判断**：模式不新，选择是对的——因为 annot 的底线是"不改用户原 skill 也能工作"。

### 2.3 漂移分三档（moved / relocated / broken）

- `moved`：内容还在，行号变了（精确 sha 命中）
- `relocated`：内容还在但被编辑过（词集相似度 ≥0.62）
- `broken`：真没了

这个"精确 → 模糊 → 放弃"的三级降级，与 `git diff -M`（50% 相似度判 rename）、格式化工具的 idempotency 检查是同一族思路。**阈值 0.62 是我拍的，没有校准数据**——这点必须承认。

---

## 3. 唯一站得住的新东西

### 3.1 锚点 = 行范围 + 行级 sha256，且是唯一的失效判据

| 项 | 内容 |
|---|---|
| **数据结构** | `anchor: { heading, start, end, sha }`，`sha` 是该范围原文按 `\n` 连接后的 sha256 |
| **为什么别人没有** | archify / Mermaid 的上游是**人写的 spec**，spec 不会自己变；skillscope 是**一次性转换**，转完就不管了。只有 annot 面对"上游是散文、且天天被人编辑"的场景 |
| **带来的可判定结论** | `annot check` 退出 0 ⇔ 这张图仍忠于当前 SKILL.md。这是**唯一**能让"图准不准"变成 CI 门禁的机制 |
| **代价** | 每改一行，后面的所有锚点都要重算 → 所以必须有 `moved` 这一档，否则每次编辑都是满屏红 |

这条在 §1 的所有项目里都没有对应物。**这是 annot 存在的理由。**

### 3.2 audit：把"抽得准不准"变成数字

archify 有 validate（校验 spec 是否合法），skope 有 0-100 分（Frontmatter 20 / Structure 25 / Clarity 20 / Logic 15 / Best Practices 20）。两者**都在评 skill 的质量**。

annot 的 `audit` 评的是**另一件事**：*抽取器有没有读错这份文件*。空标签、空正文、未绑定分支——这些与"skill 写得好不好"无关，与"图可不可信"有关。

**判断**：这是一个新的度量对象，不是新的度量方法（加权打分是常识）。

### 3.3 三轮真实库审计驱动的规则收紧（过程本身可复现）

对 36 个真实 skill 跑 audit，分数从 47 分降到 14 分，其中修掉的是三个真 bug：

1. 输出模板里的 `⚠️ 受影响…` 被当成分支 → 模板是**输出形状**，不是控制流
2. `EXISTS / AMBIGUOUS / NOT_FOUND` 被当成分支 → 那是**枚举集合**，不是分叉
3. **`BRANCH_COND` 里 `\b` 让中文条件全部失效** —— `\b如果` 在 JS 里永远不成立

第 3 条是这轮最有价值的发现：**过去所有中文 skill 的"如果…否则…"分支，其实全被静默吞掉了**，而漏掉的恰好是 else 那一半。如果没有 audit 这个数字，这个 bug 会一直藏着——因为单看一张图，没人会觉得"少了几个分支"。

---

## 4. 诚实的位置：我们比人家弱在哪

写这份文档的目的是防止自我抬高，所以必须列清楚。**这一节在 2026-11-16 被更新过**：前两行曾经是"我们没有原子替换、没有多视口浏览器证据"，现在补上了，所以改成逐条打分。

| 维度 | 对手 | 我们 | 状态 |
|---|---|---|---|
| **交付严谨度** | archify：`deliver` 写私有一致性快照 → 校验 → **全部通过才替换目标**；失败保留上一个可信产物；receipt 带 spec 与 artifact 的 SHA-256 与字节数 | `src/fsx.ts`：同目录私有临时文件 → 写入 → **fsync** → 校验非空 → rename；成对产物先全部构建再统一 rename，任一失败删临时文件、原文件一个字节不动；`annotation.json` 里带每个产物的字节数与 sha256 | ✅ **已补**（仍弱一点：archify 的 receipt 是原子交付的副产物，annot 的清单是另一次写入——清单本身失败时产物已就位） |
| **视觉证据** | archify：4 个视口（1440×900 / 1600×1000 / 1920×1080 / 2048×1320）+ `scrollWidth <= innerWidth` 断言 + 明暗两套截图 + 机器回执 | `annot verify`：3 个视口 + 文档级 `scrollWidth <= innerWidth` 断言 + 节点数 / 重复 id / 标签溢出 / 画布外卡片 / **零网络请求** / 未捕获异常；退出码 0/1/2，跳过 ≠ 通过 | 🟡 **大半已补**（缺 2048×1320 与明暗两套；宁可少一个视口也不假装覆盖） |
| **三种说法分离** | archify 明确区分 deliver（确定性检查）/ visual-check（浏览器证据）/ 视觉评审（人的判断），并写 "Passing one claim never implies either of the others" | README 与 `formatRenderReport` 现在分开讲：`verify` 只声明"确定性检查 + 浏览器证据"，**不声明视觉评审**；`--shot` 截出来的图是证据，不是交付物 | 🟡 概念已对齐，但没有像 archify 那样写成契约文档 |
| **评估因果性** | skill-eval-harness：配对 with/without，只有差值算证据 | annot 的 flow.json **只是假设生成器**，不构成任何"变好了"的证据 | ❌ 不变，且**不应该**变——这是刻意的边界 |
| **审计权重** | audit-slim：五个自问 + 明确判定动词（叙述性提及保留 / 指挥性引用改） | annot 的权重（×10 / ×5 / ×2 / ×1 / ×20）是**拍的常数，零校准数据** | ❌ 未校准。唯一的辩护是它只用来排序，不用来判定"合格与否" |
| **模型可读性** | 都有 `references/`、typed schema、示例 | annot 有 fixture，但 `flow.json` 的 schema 没有写成 JSON Schema，第三方无法独立校验 | ❌ 未做 |

**如果只记一条**：交付契约这块已经追平到"不会毁掉上一次可信产物"的水平，剩下最大的实质差距在**审计权重没有任何校准数据**——那个数字会被人当真，但它现在只是排序工具。

---

## 5. 结论：怎么讲这个项目

**不能讲**的：
- ❌ "我们做了 skill 可视化" —— skillscope 5 个月前就做了，15★ 说明这条不成立
- ❌ "我们做了 skill 评估" —— harness 已经做穿
- ❌ "我们做了单文件 HTML 图" —— archify 95.7k★
- ❌ "我们发明了给文档做标注" —— 这是印刷术时代的东西

**能讲**的：
- ✅ "**SKILL.md 天天被人改，改完你的图还对不对？**" —— 锚点 + 行哈希 + 三档漂移，让这句话有确定答案
- ✅ "**你的 36 个 skill，哪几个 annot 读错了？**" —— audit 给数字，不给人感受
- ✅ "**改 skill 时，模型该动哪几行？**" —— context 把爆炸半径缩到行级
- ✅ "**这张图画出来了没有？**" —— verify 返回 0/1，截图不再是"我看了眼，没问题"

四条的共同点：**都不是"多给一个视图"，而是"给一个能返回 0/1 的判断"**。

这也解释了为什么 M1 不做插件 UI：插件 UI 是"多一个视图"，而 UI 加不进"图还对不对"这个判断。判断必须住在 CLI 里，才能被 CI、被 hook、被另一个 agent 调用。

---

## 附：本轮对照的证据清单

| 主张 | 证据 |
|---|---|
| archify 单文件自包含 HTML | `~/.agents/skills/archify/SKILL.md:13` |
| archify 用退出码当契约、禁止把非 0 说成成功 | 同上 `:35`、`:137` |
| archify 有 layout compiler 与 receipt | 同上 `:28`；`references/delivery-contract.md:11` |
| archify 原子交付 + 失败保留上一个可信产物 | `references/delivery-contract.md:11` |
| archify 三 claim 分离 | `references/delivery-contract.md:19-25` |
| archify 多视口浏览器证据 | `references/delivery-contract.md:36-43` |
| archify 限制模型阅读范围（bounded reading path） | `SKILL.md:17`、`:46` |
| audit-slim 摊表 + 两列证据 | `~/.agents/skills/audit-slim/SKILL.md:49-64` |
| audit-slim Keep/Merge/Delete 分级与"只依据证据" | 同上 `:66-74` |
| audit-slim "DoD 必须包含巡检工具 exit 0" | 同上 `:44` |
| audit-slim 五自问过滤器 | 同上 `:97-105` |
| DSH 官方 skill source rank 表 | `@linxin666/dsh-client-ui-skill-explorer` README（本机 v0.4.8） |
| skillscope 的 0-100 评分维度 | GitHub README（2026-11-12 读），Frontmatter 20 / Structure 25 / Clarity 20 / Logic 15 / Best Practices 20 |
| skill-eval-harness 的配对与切分 | GitHub README（2026-11-12 读） |
| **annot 的原子写入覆盖"失败不毁旧产物"** | `test/fsx.test.ts`「if one file in the pair is invalid, neither is installed」 |
| **annot 的多视口浏览器证据** | `test/visual.test.ts`「a real render passes every viewport」 |
| **annot 的"删掉脚本必须失败"** | 同文件「a page whose script never runs is a failure, not a pass」 |
| **annot 的零网络请求断言** | 同文件「a page that phones home fails the offline contract」 |
| **annot 无任何 React/DSH/MCP 依赖** | `grep -E "from '(react\|@deepseek-ai\|@modelcontextprotocol)" src/` → 无命中 |
| okf-skills 一仓库五形态 | GitHub README（2026-11-12 读） |
