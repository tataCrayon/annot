# 形态定稿：一套引擎，两个常驻壳（DSH 插件 + Claude Code MCP）

> 输入约束（用户确认）：对外发布 / 开源；日常 DSH + Claude Code 双宿主；要「可开关的常驻能力」，支持实时搜索、查看、修改 Skill。
> 本文回答"怎么做"，并给出可执行的分层、数据契约、常驻开关机制、里程碑与放弃条件。
> **本轮未能复核的外部事实已显式标注**（受机器内存 pressure 限制，web_fetch 被护栏拦截两次）。

---

## 0. 判决卡（grill-method Mode A）

```
⚖️ 方法判决
- 被审方法：把工具做成一个常驻本地 Web 应用，DSH 与 Claude Code 各自想办法接进去。
- 攻击 1（假设）：假设两个宿主都能挂一个常驻面板。为假——DSH 是插件树，可以渲染面板；
  Claude Code 没有任意插件 UI 槽位，只有 skills / hooks / MCP / statusline。
  单壳方案注定在 Claude Code 上降级成"另一个浏览器标签页"。
- 攻击 2（失败模式）：常驻进程 + 文件监听 + LLM 抽取，最常坏在"进程活着但索引是旧的"，
  用户看到的是过期流程图，改完以为生效了其实没有。最早信号是 flow.json 的
  content_hash 与 SKILL.md 不匹配。
- 攻击 3（更优替代）：不要让宿主适配工具，让工具适配宿主——引擎是纯库，
  两个宿主各自在进程内嵌入它，状态全部落盘。零额外进程。
- 判决：🔧 改良（原方法方向对，但"一个常驻 app"改成"一个引擎 + 两个宿主内嵌壳"）
- 采用方法：core library（无宿主依赖）+ DSH cordis 插件壳 + Claude Code skill/MCP 壳 +
  CLI。常驻=嵌在宿主进程里常驻，不是另起一个进程。
- 幸存理由：DSH 侧零额外内存（插件本来就在进程内），Claude Code 侧不需要守护进程；
  两边共享同一份 flow.json 契约，漂移面只有适配层。
```

---

## 1. 为什么不是"一个 app"

| 方案 | DSH 侧 | Claude Code 侧 | 额外常驻进程 | 开源分发 | 判决 |
|---|---|---|---|---|---|
| A. 独立本地 Web app | 浏览器另开一页 | 浏览器另开一页 | 要（1 个） | 简单 | ❌ 两边都降级成"又一个标签页"，常驻感假 |
| B. DSH 插件为主，CC 用 skill 包装 | 原生面板 | 无 UI | 否 | 插件市场 + skills.sh | ❌ 一半能力缺失 |
| **C. 引擎 + 两个宿主内嵌壳** | **原生面板** | **MCP 工具 + 可选本地 UI** | **否** | **npm 包 + 插件市场 + skills.sh + MCP 注册表** | **✅ 推荐** |
| D. 单一 MCP server 当万能壳 | 面板走 MCP Apps iframe | 同 | 是（1 个） | 单一入口 | 🔶 备选，DSH 侧白丢了原生能力 |

选 C。**核心判断：常驻不是"多跑一个进程"，而是"嵌在已经在跑的那个进程里"。**

D 保留为阶段 3 的**可选通道**：如果后续发现第三方宿主想接入，再把同一引擎包一层 MCP Apps server 发布——那时它只是分发形态，不是架构前提。

---

## 2. 分层与仓库结构

**M1 实际落地的结构**（零构建、单包，不做 monorepo——见本节末尾的偏离说明）：

```
vibeskill/                    # 仓库名待建：annot
├── src/
│   ├── types.ts              # 三文件契约（FlowDoc / Anchor / Sidecar）
│   ├── parse.ts              # SKILL.md → sections + units，保留 1-based 绝对行号
│   ├── flow.ts               # units → flow.json：分段、分类、标签、分支
│   ├── drift.ts              # 行哈希判定 moved / broken / relocated
│   ├── audit.ts              # 整库加权体检，回答"哪个 skill 抽得不好"
│   ├── render.ts             # flow.json → 单文件自包含 HTML（无网络无依赖）
│   ├── discover.ts           # 多 root 发现 + 同名按 rank 去重
│   ├── cli.ts                # annotate | check | list | audit | render
│   └── index.ts              # 库入口
├── test/                     # node --test，21 个测试
│   ├── fixtures/             # grill-method（真实流程型）、router-shape（路由型）
│   ├── annot.test.ts         # 锚点、分段、漂移、sidecar、HTML 自包含
│   ├── render.test.ts        # 客户端脚本在最小 DOM 里真跑一遍
│   ├── shapes.test.ts        # 两种形态共用一套 schema
│   └── audit.test.ts         # 排序契约（最差的排最前）
├── tools/                    # 人眼看抽取结果：inspect.ts / explain.ts
├── sandbox/run.sh            # 隔离验收：假 HOME + 篡改验证 + 沙箱外零改动
├── docs/
├── README.md
├── LICENSE                   # MIT
└── package.json              # "annot"，bin 同名，exports 直指 .ts
```

**目标结构（M2 起，仍然有效）**：

```
annot/
├── packages/
│   ├── core/                 # 纯 TS，零宿主依赖，零框架 ← 现有 src/ 迁入
│   │   ├── parse/ flow/ drift/ audit/ render/ discover/
│   │   ├── trace/            # 各宿主 transcript → 统一事件流     （M4）
│   │   ├── patch/            # 自然语言 + 锚点 → unified diff      （M3）
│   │   ├── eval/             # 读/写 benchmark manifest（转接，不自研）
│   │   └── index/            # 增量索引：文件哈希 → 脏标记 → 局部重建（M2）
│   ├── cli/                  # `annot annotate | check | list | audit | render | serve | mcp`
│   ├── dsh-plugin/           # cordis bundle：host 半 + client 半    （M2）
│   ├── cc-plugin/            # Claude Code：skills/ + hooks/ + .mcp.json
│   └── ui/                   # 共享组件（图谱/时间线/diff 三联）
├── docs/
├── evals/                    # 本工具自己的 eval（吃自己的狗粮）
└── examples/                 # grill-method / challenge 双 fixture
```

**关键约束：`core` 不得 import 任何 React、任何 DSH、任何 MCP SDK。** 一旦 core 依赖宿主，双壳就退化成两个项目。

**为什么 M1 没上 monorepo**：pnp 之前的经验是"先证明引擎值得存在，再拆包"。M1 只有一个消费方（CLI）时，`packages/core` + `packages/cli` 只是两层 `index.ts` 转发，换不来任何隔离收益；而**约束已经用另一种方式守住了**——`src/` 里没有一处 import React/DSH/MCP，这条可以用 grep 一行验证，比目录结构更难被悄悄破坏。M2 加插件壳时再拆，届时 `src/` 整体平移为 `packages/core/src/`，导入路径不变。

---

## 3. 数据契约（三个文件，全部进 git）

### 3.1 `flow.json` —— 派生品，但必须入库

SKILL.md 是唯一真源，flow.json 是它的**语义投影 + 缓存**。入库的理由：可 diff、可 review、可做 golden fixture、避免每次渲染都调 LLM。

```jsonc
{
  "skill": "grill-method",
  "source": { "file": "SKILL.md", "sha256": "…", "parsed_at": "2026-11-12T…" },
  "schema_version": 1,
  "nodes": [
    {
      "id": "n_attack",
      "type": "stage",            // stage | decision | gate | artifact | external_call
      "label": "四方向拷问",
      "anchor": {                  // ★ 全系统最重要的字段
        "heading_path": ["拷问循环"],
        "line_start": 65, "line_end": 72,
        "content_hash": "…"        // 这 8 行的哈希，锚点失效的唯一判据
      }
    }
  ],
  "edges": [
    { "from": "n_verdict", "to": "n_commit", "when": "hold|amend|replace" }
  ]
}
```

**锚点是产品的地基。** 没有 `content_hash`，"用自然语言改第 3 步"就退化成整篇重写——不可 diff、不可回滚、不可评审，整个卖点消失。锚点失效时**必须显式报 stale，不得静默重解析**。

### 3.2 `trace.ndjson` —— 只追加的事件流

```jsonc
{"ts":"…","session":"…","event":"skill.loaded","skill":"challenge","mode":"method"}
{"ts":"…","session":"…","event":"tool.call","tool":"read","args_hash":"…"}
{"ts":"…","session":"…","event":"node.visit","skill":"grill-method","node":"n_attack"}
{"ts":"…","session":"…","event":"artifact.emit","kind":"verdict_card","ok":true}
```

`node.visit` 是核心事件——没有它，trace 就只是 token 流水，看不出"走到哪一步、在哪一步死"。**如何产生 node.visit 是最大的技术风险，见 §6。**

### 3.3 `variant.json` —— 让"真变好"可证

```jsonc
{ "skill":"grill-method", "base_sha":"…", "candidate_sha":"…",
  "cases":[{"id":"eval1","reps":3,"with":0.94,"without":0.41,"lift":0.53}],
  "cost":{"tokens_with":76293,"tokens_without":30996,"lift_per_dollar_lift":0.53} }
```

格式对齐 [skill-eval-harness](https://github.com/adewale/skill-eval-harness) 的 manifest 思路，**不自己发明评分协议**。

---

## 4. 常驻与开关：具体机制

### 4.1 DSH 侧：cordis bundle，热开关 ~1s

已核实的两条事实（读自本机已安装的插件）：
- 插件通过 `package.json` 的 `dsh.bundle.patch` 声明 `cordis.patch.yml`，`dsh plugin add` 时自动挂载（[dsh-better-sidebar/cordis.patch.yml](file:///D:/Users/zigang.wang/.dsh/profiles/web/node_modules/dsh-better-sidebar/cordis.patch.yml) 第 39-42 行）。
- 插件开关写入 profile 的 `cordis.patch.yml`（`- id: … disabled: true|false`），**HMR 约 1s 重新组装，无需重启**；这是 dshmarket 的现成机制。

所以"可开关的常驻能力"在 DSH 上是**免费拿到的**：
```yaml
- insert:
    - id: skillflow
      name: 'skillflow-dsh'
      config: { watch: true, indexOnBoot: 'lazy' }   # 开关粒度到功能，不止整插件
```

**必须做到"懒索引"**：插件常驻 ≠ 全量扫描常驻。启动只读索引头，面板打开才解析。理由见 §7 的内存约束。

### 4.2 Claude Code 侧：没有面板，只有三种接入点

> ⚠️ **待复核**：以下基于 Claude Code 现有的 skills / hooks / MCP / statusline 能力面。本轮 web_fetch 被内存护栏拦截，未能复核 MCP Apps UI 渲染在 Claude Code 中的支持状态。**M0 的第一件事就是花 30 分钟核实这一条**，它决定阶段 3 的取舍。

| 能力 | Claude Code 接入方式 | 实时性 |
|---|---|---|
| 搜索 / 查看 flow | `skillflow` skill 调用 CLI，或 MCP 工具 `skillflow://flow/{name}` | 按需（够用） |
| 采集 trace | `PostToolUse` / `Stop` hook 追加 NDJSON | 准实时 |
| 图形界面 | MCP server 起本地 HTTP 服务（`skillflow serve`），浏览器打开 | 实时（用户主动开） |
| 常驻感 | MCP server 生命周期绑定会话 | 会话内常驻 |

一句话：**Claude Code 上"常驻"= 会话内常驻 + 按需开图，不承诺后台常驻。** 这个取舍要写进 README，不要假装两边对等。

---

## 5. 实时 vs 正确：索引设计

常驻系统最常死于"看起来在跑，其实读到的是旧数据"。三条硬规则：

1. **单一失效判据**：`SKILL.md` 的 sha256。变了 → 该 skill 的 flow 标记 stale → 只重算这一条。**不做全量重建。**
2. **写入去抖 + 代次号**：文件监听 300ms 去抖，每次重建带 `generation`；面板显示 `generation`，让"图是旧的"肉眼可见。
3. **降级必须可见**：LLM 抽取失败/超时 → 退回 L1 大纲图并在图上打 `degraded` 角标。**静默回退是这类工具的头号信任杀手。**

---

## 6. 最大技术风险：trace 到流程节点的映射

这是整个产品的命门，也是所有竞品（skillscope 只读静态、harness 只评结果）都没解决的问题。

对照一下：skillscope 从 markdown 猜 triggers/branches，本质是**语义猜测**，不可靠。trace 是**事实**，但事实是 `tool.call` 级别的，跟"第 3 步"没有天然对应。

三条可行路线，按可靠性排序：

| 路线 | 做法 | 可靠性 | 侵入性 |
|---|---|---|---|
| R1 锚点回指 | Skill 在关键步骤显式输出 `<!-- sf:n_attack -->`，hook/工具调用时记录 | 高 | 要求改 skill（可自动化批量加） |
| R2 LLM 事后对齐 | 拿 trace + flow.json 让模型判定"这条 trace 走了哪些节点" | 中，需 eval 校准 | 零 |
| R3 顺序启发式 | 按产物/工具序列匹配阶段 | 低 | 零 |

**建议 R1 为主、R2 兜底。** 但 R1 有代价：给 37 个 skill 自动插入锚点注释 = 大规模文件改动，用户会抗拒。

→ **最便宜的验证（≤1 天，优先做）**：只拿 grill-method 一个 skill，手工加 5 个锚点，跑 3 次真实会话，看 R1 能还原多少比例的路径。若 R1 还原率 <70%，说明"执行态流程图"这个卖点不成立，产品应退回"静态结构图 + eval 面板"，砍掉 trace 反投影。

这条验证必须排在所有编码之前。

---

## 7. 现实约束（必须先说）

当前机器持续处于 **critical 内存压力**（可用物理 0–1.8 GB / 32 GB，负载 94–100%，本轮已被护栏拦截 12 次重活）。

对设计的三条直接影响：
1. **插件启动必须懒加载**，不能在 boot 时解析全部 skill。
2. **不做常驻守护进程**（已在 §1 判决中排除），否则等于在濒死机器上再加一个进程。
3. **实际编码要等内存缓解**；现在能做的只有设计与 fixture 手写。

---

## 8. 里程碑与退出条件

| 阶段 | 交付 | 退出条件（可判定） | 状态 |
|---|---|---|---|
| **M0** | 风险核实：CC 是否支持 MCP UI；R1 锚点还原率实测 | 两个数字写进文档，任意一个为负则调整方向 | 待做（M2 前必须） |
| **M1** | 产品名 `annot` + `core` + `cli`：SKILL.md → flow.json + 单文件 HTML | grill-method 与 challenge 双 fixture 通过；HTML 离线双击可用；漂移检测可证 | ✅ **已完成**（55 测试 + 7 段沙箱验收全绿） |
| **M2** | `dsh-plugin`：面板 + 懒索引 + 热开关 | 在真实 profile 里 `dsh plugin add` 后可开关；改 SKILL.md 面板 1s 内标 stale | 🟡 **Host 已完成并实测**（四路由 + 12 测试 + desktop profile 已装、`applied`）；**Client 面板写入但尚未在浏览器里看过渲染**；懒索引与 stale 标红未做 |
| **M3** | 自然语言 patch（只生成 diff，不落盘） | 3 条指令 ≥2 条产出可接受 patch（见下） | ✅ **实验已过 3/3**（`sandbox/m3-experiment.ts`）；但产物仍是"agent 自己改文件 + `check` 判定"，`patch/` 模块与 unified diff 生成仍未写 |
| **M4** | trace 反投影 + eval 面板（接 skill-eval-harness 格式） | 一次失败会话能定位到具体节点；variant.json 能出 lift | 未开始 |

**M1 的实际交付**（与本文档原设想一致，记录偏差）：

- 命名定为 `annot`——npm 名实测可用（`skillflow` / `skillmap` / `skillgraph` 也可用，但都描述"结果"而不是"手段"，而本产品的差异点是**标注**）。
- 七条命令已落地：`annotate` / `check` / `list` / `audit` / `context` / `verify` / `render`。原计划只有三条：
  - `audit` 是实施中长出来的——"对任意 skill 可标注"这句话只有跑过整个库才算数；
  - `context` 是"用自然语言改"的接缝，把爆炸半径缩到行级；
  - `verify` 是交付契约的补齐，把"我看了一眼没问题"换成退出码。
- 交付路径补了原子写入（`src/fsx.ts`）与 `annotation.json` 清单（`src/manifest.ts`）：写入失败不毁旧产物，`check` 不再靠 `../SKILL.md` 猜源文件。
- 零构建、零运行时依赖：Node 24 原生剥离 TypeScript，`node src/cli.ts` 直接跑，`node --test test/*.test.ts` 直接测。发布体积就是源码。
- 漂移检测的可信度由**一条测试**担保：未改动的 skill 必须 `check` 退出 0。这条测试在本轮抓到过一个真 bug（把隔行合并成单元后忘了补空行，导致所有人未改的文件都报漂移）。

**M3 的验收标准要提前写死**（抄上一轮的验证实验）：手写 3 条改写指令，patch 只需微调即可接受 ≥2/3 才算过；锚点错位 >30% 直接判失败。

**M3 实验结果（2026-11-18，`node sandbox/m3-experiment.ts`）：**

| # | 指令 | 落点 | 结果 |
|---|---|---|---|
| 1 | VERDICT 拆三行并各写适用条件 | L61–64（1 行 → 4 行） | 13 relocated / 0 broken → 接受 |
| 2 | COMMIT 加"判决卡不超过 10 行" | L62 | 0 relocated / 0 broken → 接受 |
| 3 | ATTACK 后补"一次只问一个问题" | L60 | 1 relocated / 0 broken → 接受 |

接受的判据是可判定的两条，不是"看着像"：编辑区重建后的节点 `raw` 必须逐字等于改写文本；重新 `detectDrift` 后 `broken` 必须为 0。

**这个实验暴露了两个真 bug，都已修：**

1. `segment()` 的 Shape A 要求每一行都匹配 `LABEL — text` 且匹配数 ≥ `inner.length - 1`，于是给 VERDICT 加一个续行就使整条四步流水线塌成一张卡片。改成续行归上一段后，同一份文件仍产出 26 节点，但结构不再脆弱。
2. 漂移检测只有 `moved` / `broken`，没有"原地改了文本"这一档，导致**每一次成功的改写都被报成 `broken`**——锚点检查在它唯一该通过的场景下必然失败。新增 `edited`（窗口内词重叠 ≥ 0.4），`check` 现在对原地改写退出 0。

**仍未做的是 `patch/` 模块**：`context` 交出该改哪几行，由宿主 agent 自己写文件，`check` 事后判定。原计划的"生成 unified diff 但不落盘"没有实现——实测表明少了它也能过判据，但也就没有可审查的 diff 留痕。

**开源节奏建议**：M2 结束就发布 v0.1（DSH 侧可用的最小闭环），不要等 M4——开源项目的反馈速度比自研完整度更值钱。若 M2 风险过高，M1 的 CLI 已可独立发布为 `annot@0.1`（"给任意 skill 出可审的流程图 + 漂移检查"），这本身就是完整可用的工具。

---

## 9. 明确不做

- ❌ 重做 skill CRUD（启用/禁用/新建/删除/回收站）——本机已装 [`@linxin666/dsh-client-ui-skill-explorer`](file:///D:/Users/zigang.wang/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skill-explorer/README.md)（v0.4.8），它已经有 Skills/Import/Create/Edit 四个 tab、按 source 分层、`.trash`、loopback 围栏。**我们的差异化是 flow + trace + eval + NL patch，不是又一个列表页。** 应读取它的约定（skill roots、source rank），不复刻实现。
- ❌ 自研 eval 引擎（接 harness）
- ❌ 后台守护进程（§1）
- ❌ 未验证就做 MCP Apps 通道（等 M0）
- ❌ 首个版本支持第三种宿主

---

## 10. 三个待决定问题（均已被用户指令关闭）

1. **产品名与仓库** → 定为 **`annot`**。用户授权自定名；npm 前缀实测可用，`bin` 名 `annot`，插件 id 用 `annot`（不与 `better-sidebar` 式的聚合包名冲突）。仓库名同 `annot`。
2. **trace 侵入度** → 改为**按需标注任意 skill**，不做 37 个的批量改造。落地方案：
   - **默认零侵入**：`annotate` 不写 SKILL.md 一个字节，锚点全部存在 `flow.json` 里（`anchor.heading/start/end/sha`），漂移靠行哈希判。
   - **可选增强（R1）**：确实需要精确 trace 回投时，才对**单个选中的** skill 加 `<!-- sf:n_attack -->` 这类行内标记；标记的作用只是给节点一个稳定 id，不改语义、不改正文。
   - **兜底（R2）**：没标记时用 LLM 事后对齐，准确性靠 eval 校准——所以 R1 是优化项，不是前置条件。
   - 这样"对任意需要的 skill 做标注"成立：默认路径对任何 `SKILL.md` 都work，增强路径按需开启。
3. **首发范围** → 先发 CLI（M1 已具备），DSH 插件壳走 M2。CC 侧先用"skill 调 CLI + 生成的 HTML"这一最薄形态顶上，不阻塞发布。

---

## 11. 实施记录：M1 里被现实修正的四个判断

这一节记录计划与实际的分歧，供 M2 引用——避免把"当时怎么想"当成"现在是什么"。

| 计划里的判断 | 实际情况 | 处理 |
|---|---|---|
| 只做 `annotate` 三命令就够 | 单看一个 skill 无法回答"我的库哪里坏了" | 增加 `audit`：整库加权排序，0 分即零瑕疵 |
| 围栏里的代码块整体当一个节点 | 作者的真实流水线正写在围栏里（`STATE — …`），整块吞掉等于丢掉全文唯一的结构 | 拆成一行一节点，各自单行锚点 |
| 单行 `A → B → C` 的链要拆 | 多行缩进箭头链（`→ requirement`）也是链，且首行没有箭头 | 支持三种形态：逐行 `LABEL — text`、多行箭头续行、单行整链 |
| 结构性行（`---`、`| --- |`）无害 | 会变成空标签空正文的节点，图上是个白框 | 在 parse 层就当 scaffold 丢掉，并用 `audit` 的 `junkLabels` 兜住漏网的 |

另外两条工程约束，M2 必须继承：

- **标签宽度按字形估算，不按字符数截断**。CJK 一字约 12.5px、拉丁约 7px，按字符数截会让中文截一半、英文溢出卡片。渲染端用 `fitLabel` 按像素预算裁。
- **渲染脚本必须有执行级测试**。只 `vm.Script` 编译不足以发现"脚本第一行就抛异常 → 整页空白"。`test/render.test.ts` 用一个最小 DOM 真跑一遍客户端脚本，并断言画出了节点。

### 11.1 M2 的实施记录（Host 已落地，Client 待目视）

| 计划里的判断 | 实际情况 | 处理 |
|---|---|---|
| 插件里应该有引擎代码（直接 import `src/*.ts`） | 宿主用的是它自己的 Node（`DeepSeek Harness.exe`），**不认 `.ts` 后缀**，`import '../src/flow.ts'` 在宿主里起不来 | 改成每个路由 exec 一次 CLI：面板和命令行共用同一个实现，不可能给出两张不同的图。这是"一个引擎"唯一可验证的形式 |
| `--json` 输出够用了 | `annotate --json` 原本只回摘要，面板还得再读一次文件才知道图长什么样 | 让 `--json` 带上 `doc` 与 `layout`：布局在服务端算，浏览器不重算（否则就是第二套布局实现） |
| `audit --json` 应该尊重 `--limit` | 尊重了的话面板的 `total`/`clean` 会变成"被截断后的总数"，和我刚修掉的 bug 一样 | `--json` 恒为完整结果，路由自己切片 |
| `?path=` 是个方便的文件参数 | 那样这条路由就是个任意文件读取原语 | 只接受**当前扫描结果里出现过的** `SKILL.md`；验证时用 `D:/etc/passwd` 实测 422 |
| `client.js` 无法测 | 它是浏览器产物，但只依赖 `window.__ModuleLoader__` 和 `require('react')` 两个注入点 | 用 `node:vm` 造这两样，跑真 factory：断言注册 id、两个席位、id/key 一致、路由不带前导斜杠 |

---

## 附：本轮事实核验表

| 结论 | 证据来源 | 状态 |
|---|---|---|
| DSH 插件可用 `dsh.bundle.patch` 自动挂载 | 本机 `dsh-better-sidebar/cordis.patch.yml` L39-42 | ✅ 已核实 |
| DSH 插件热开关写 `cordis.patch.yml`，~1s 生效 | 本机 `dshmarket/README.md` L65 | ✅ 已核实 |
| DSH 已有 skill 管理插件（CRUD 已占位） | 本机 `dsh-client-ui-skill-explorer` v0.4.8 + README | ✅ 已核实 |
| 插件路由需 loopback 围栏 | 同上 README §Security model L126-131 | ✅ 已核实 |
| MCP Apps / MCP-UI 可用作跨宿主 UI 通道 | [mcp-ui](https://github.com/MCP-UI-Org/mcp-ui) 5,261★、[ext-apps](https://github.com/modelcontextprotocol/ext-apps) 3,079★、[dsh-mcp-apps-host](https://github.com/oriliz/dsh-mcp-apps-host) 194★ | ✅ 已核实 |
| Claude Code 存在 plugin / hooks 机制 | [Plugins overview](https://code.claude.com/docs/en/plugins) | ✅ 已核实（hooks 细节本轮未复核） |
| **Claude Code 能否渲染 MCP Apps UI** | — | ❌ **未核实，M0 必查** |
