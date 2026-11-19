# 推理上下文：已验证的事实、排除的方案、决策依据

> 这一份是"热状态"的固化。新接手的 AI 读完 `TASK.md` 之后必须读这一份，否则会重走已经走完的弯路。

---

## 1. 已验证事实（附确认方式）

### 1.1 抽取与数据

| 事实 | 确认方式 |
|---|---|
| 整库 **77 个 skill**，**18 个零瑕疵**，最烂是 `feishu-task-creator` 21.0 | `node src/cli.ts audit ~/.agents/skills`（2026-11-19 重跑） |
| `D:\Users\zigang.wang\.dsh\skills` **不存在** | `Test-Path` → `False`；audit 对它打印 `skipped … unreadable` 并走 stderr。**所以"77"是 `.agents/skills` 一棵树的数**，而该目录下有 83 个子目录——差 6 个是没 frontmatter / 不是合法 skill 的 |
| 节点类型分布（78 skill / 1726 节点）：`stage` 1248 (72.3%) · `artifact` 275 (15.9%) · `gate` 79 (4.6%) · `external` 69 (4.0%) · `decision` 55 (3.2%) | `sandbox/node-kinds.mjs` |
| 泳道分布：`reader` 1344 (77.9%) · `output` 275 (15.9%) · `tool` 74 (4.3%) · `model` 33 (1.9%) | 同上 |
| **类型 × 泳道只有 9/20 组合出现**，`artifact` 100% 落在 `output`、`external` 100% 落在 `tool`，且 **1219/1726 = 70.6% 是同一格 `stage × reader`** | 同上。**这解释了为什么三列布局几乎总能画出来** |
| `classify()` 共 **16 条规则**（`src/flow.ts:232`），只有 13 条在真实库里触发过；**从未触发**：`table-of-choices`、`table-of-attack-vectors`、`pinned-marker` | 同上 |
| `confidence` 是**规则常数，不是概率**：`paragraph` 恒 0.65 | `src/flow.ts` 里每条规则映射一个固定 score，`confidence` 的 doc-comment 已改写 |

### 1.2 五份真实样本的当前读数（换代时拿这个对齐）

| skill | 节点 | 边 | bands(行) | canvas | forks |
|---|---|---|---|---|---|
| `release-checklist` | 34 | 33 | 26 | 980×3711（4.1 屏@900） | 0 |
| `agent-dev-standards` | 19 | 18 | — | 2119 高 | 0 |
| `challenge` | 13 | 12 | — | — | 0 |
| `archery-query` | 11 | 10 | — | — | 0 |
| `grill-method`（fixture，磁盘上没有这个 skill） | 26 | 25 | 19 | 980×2931（3.3 屏@900） | **3（全部未落地）** |

`release-checklist` 列分配：`核心 25 / 门禁 6 / 产物 3`；面板行、旁注、副标题 `8/34`；标签截断 `9/34`。

### 1.3 三列布局的四组量测（决定了设计）

| 量的事 | 数 | 结论 |
|---|---|---|
| 侧卡在主路径上的分布 | `release-checklist` 25 行里 **17 行没侧卡**，最长连续 **12 行**空 | 整页一条三列轨道是骗人的 → **每行只画它真有的列** |
| 侧卡能否不交叉地挂到主路径 | 4 份真实 skill 全部 **0 处倒挂** | 行 = 源文件顺序上最近的核心步骤 |
| 换成"按行号距离最近" | `release-checklist` 出现翻转边 **row 25 → row 1** | **该规则已被实测否掉**，理由写在 `rowsOf()` 注释里。别再用 |
| 三列被挤到多窄才够 | 981px 图区 → 核心 420 / 两侧 170 | 侧卡 165px 时页脚 `L24–26 · 55% · code-with-calls` 宽 **173px**，撑破卡片；页脚与表格行改成**按卡宽裁剪**后 `verify` 才过 |

补充量测（`sandbox/band-adaptive.mjs` / `edge-shapes.mjs` / `row-rule.mjs`）：
- 「永远三列」vs「按行自适应」：`release-checklist` 3868 vs **3659**，`grill-method` 3091 vs **2882**，`agent-dev-standards` 2271 vs **2119** —— 自适应既更矮也更诚实。
- 连接线形状：33 条边只出现三种（同列直落 / 同行直连 / 跨行肘接），**没有一条需要绕行通道**。
- 侧卡跨阶段边：`release-checklist` 11 条留在带内 vs **5 条跨带** —— 所以连接线必须容忍跨带，不能假设同带。

### 1.4 面板与宿主

- desktop profile 的 `package.json`：`"annot-dsh": "link:D:/Projects/flp/vibeskill/plugin"`，`cordis.patch.yml` 插件列表含 `annot-dsh`。
- `GET /api/annot/selfcheck` 曾返回 `composed.registered: true`，rev 形如 `b2fba533bea0`；侧边栏行落在「自动化任务」与「更多」之间。
- **本会话没有 `panel-mounted` 上报**，也没能再点开面板（GUI `http://127.0.0.1:62157` 的 `/` 是 `401 dsh web authentication required`，但 `/api/annot/*` 免鉴权 200）。
- 结论：**"面板里的三列画得对不对"只有源码断言，没有真机截图。**

### 1.5 工具链

| 项 | 值 |
|---|---|
| Node | PATH 上 `D:\DevEnv\node-v24.18.0-win-x64\node.exe` v24.18.0；DSH 自带 v24.21.0 |
| `npm test` | **157 条全绿**（104 TS + 53 JS），实测不需要 `--experimental-strip-types` |
| `bash sandbox/run.sh` | 7 段 17 条全绿 |
| `sandbox/ui-check.mjs` | 17 条全绿（hot 2 / dim 32、缩放档位、查找命中与清空） |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| git | `D:\DevSoft\Git\cmd\git.exe`；bash `D:\DevSoft\Git\bin\bash.exe` |
| commit 门禁 | `core.hooksPath = D:/Users/zigang.wang/.agents/git-hooks`，消息必须 `AI: ` 开头 |

---

## 2. 已排除的方案（附排除原因，**别重试**）

| 方案 | 为什么排除 |
|---|---|
| **整页一条三列轨道**（草图最直观的读法） | 实测 17/25 行为空、连续 12 行空，且 `release-checklist` 的 `Phase 1/2/3`、`grill-method` 的 `何时触发` / `Mode A` 三整个阶段里 **0 张侧卡**。空轨道比不画更误导 |
| **按行号距离最近决定侧卡归属** | 产生 row 25 → row 1 的倒挂边（见 1.3） |
| **悬停点亮整条上下游链** | 传递闭包实测：第 1 行能点亮 **33/34** 张卡，等于没点亮。改成只点亮**直接邻居**（实测 hot 2 / dim 32） |
| **复用 archify 的 node `type` 枚举** | 它是 `frontend/backend/database/cloud/security/messagebus/external`，与 annot 的 `stage/decision/gate/artifact/external` 语义正交，复用会毁掉分类 |
| **照抄 archify 的 `col`（作者显式指定列）** | annot 的输入是别人的 `SKILL.md`，作者没写过列号。改成**从 `NodeType` 派生**（stage/decision→核心、gate/external→门禁、artifact→产物）。**借了判断，没借机制** |
| **archify 的自动播放 trace（Live 模式）** | 每次打开都在动会打断读图；只借"静态优先 + 读者控制"的原则 |
| **`meta.views` 人工策展章节** | annot 的阶段带来自文档本身，不是人工故事线，没有独立策展数据 |
| **Electron / 独立 Web 应用** | 用户明确要"插件或别的什么小工具"，且 DSH 侧零额外内存是卖点 |
| **自建 eval 引擎 / 自造 trace 协议** | M4 之前都属于过度设计，见 `docs/02` |
| **把 skill CRUD 做进 annot** | 边界：只读 + 出建议，改动交给用户自己的 agent（`annot context` 输出精确行范围与约束） |
| **`web_search` 做调研** | 本机长期 `HTTP 402 Insufficient Balance`。改走 `sandbox/search.mjs` / `sandbox/search-gh.mjs` |

---

## 3. 关键决策（附依据）

1. **一套引擎 + 多壳**（`docs/02`）：core 零依赖零构建，DSH cordis 插件 + Claude Code skill/MCP + CLI 三个入口共用同一份抽取。依据：Claude Code 没有任意插件 UI 槽位，只有 skills/hooks/MCP/statusline，单壳方案在 Claude Code 上必然降级成"另一个浏览器标签页"。
2. **一套分数**：`defectsOf()` 是唯一缺陷向量，artifact 的"分"= `100 − audit score`。依据：曾经有两套独立权重，同一个画面给出两个不可比的数。
3. **图的三层正交维度**：`NodeType`(5) / `Lane`(4) / `NodeFlag`(6 状态，不是种类)。依据：类型答"这是什么"，泳道答"谁做"，两者不能合并。
4. **布局：分层 DAG，深度 = 顺序边的最长路径**。依据：曾经的列优先网格把 19 步流水线切成 7 列，阅读顺序向下再回到顶部，箭头指向后方。
5. **阶段是一等公民**：`Phase N` / `阶段N` / `第N步` 连成**强带**，其余按"至少罩住 2 张卡的最近标题"连成**弱带**（虚线），**单卡带一律不画**。依据：实测 4 份真实 skill 里 88 个标题 run 中 44 个是单卡，全画会边框比结构多。
6. **面板消费同一份 `cardH` / `rows` / `arms` / `phaseRuns` / `columnHeaders`**。依据：曾经面板把 `node.h` 当卡片高度，同一份 `flow.json` 在两个 shell 里画出两张不同的图。`test/plugin-client.test.js` 钉住了这一条。

---

## 4. 踩过的坑（省下重复排查）

### 4.1 抽取
- `segment()` 的 Shape A 曾要求**每一行**都是 `LABEL — text`，给 VERDICT 加一个续行就让整条四步流水线塌成一张卡。修法：续行归上一段。
- 围栏块的第一行是语言标记（`bash`/`json`/`markdown`），`buildLabel()` 取 `cells[0]` 就得到假标题。修法：`CODE_TAG` 白名单 + `meaningful()` 要求含字母数字。
- `drift` 曾在改写 `node.anchor` **之后**才读 `from`，日志打成 `moved 65 → 65`。

### 4.2 渲染 / 验证
- 阶段矩形"看不见"不是 bug：5/8 带是 `weak`（`fill:none`），强带实测 `rgb(239,236,226)`。
- 阶段标签曾在 `x=30`，压在步骤号 `01` 上 → 改成 `text-anchor:end` 在 `width-30`。
- `visual.ts` 的 `PROBE` 在 `g.node` 内查 `text` 宽度 > `cardWidth - 4` 就判溢出——**侧卡只有 170px，这个检查第一次就抓到了页脚溢出**，说明它有效。
- 客户端 `clipToWidth` 是我在 `CLIENT_JS` 里补的：服务端有同名函数，客户端没有 → `ReferenceError`，页面 0 节点、`verify` 全视口 `drew 0 nodes`。**加客户端代码后一定要跑 `verify`，不只跑 layout 单测。**

### 4.3 测试桩
- `test/render.test.ts` 的桩 DOM 必须包含客户端会 `getElementById` 的**每一个** id（`find`/`hits`/`trace`/`zoom-in`/`zoom-out`/`zoom-reset`）以及 `document.addEventListener`。缺一个就是 `TypeError: ... of null`，看起来像渲染器坏了，其实是测试不完整。
- `test/score.test.ts` 里 `maxDepth === layout.bands.length` 这条断言在三列布局后**必须改**：`maxDepth` 数的是**步数**，`bands` 数的是**行数**，侧卡与主步骤同行，两个数本来就不该相等。

### 4.4 工具/环境
- PowerShell 里 `node -e` 内联正则或 JSON 会被引号规则吃掉（`Unterminated regexp literal`、`管道元素中的"&"…无效`）→ **一律写 `sandbox/*.mjs` 文件**。
- `Get-Content`/`Out-File` 会把 UTF-8 变 BOM 或乱码 → 用 `read`/`write` 工具，不用 shell 重定向改文档。
- `pwsh | Select-Object -First N` 在管道提前关闭时会返回 `exit code 1`，不代表命令失败。

---

## 5. 关键文件导航（接手必读顺序）

| 文件 | 为什么读 |
|---|---|
| `docs/00-status.md` | **现状唯一真相源**：真实数字、已知的洞（10 条）、三条不能破的约定、下一步 |
| `docs/02-form-decision-one-engine-two-shells.md` | 形态定稿与取舍；§4.2 是 Claude Code 侧的接入点与"未核实"标记；§8 是 M4 |
| `docs/03-prior-art-and-borrowed-capabilities.md` | 抄了谁、没抄什么、为什么不抄（archify / Mermaid / LangGraph Studio 等） |
| `docs/01-...grill-method-eval.md` | 形态调研的原始材料 |
| `src/render.ts` | 布局与产物全在这里（`layoutNodes` / `rowsOf` / `columnOf` / `routeBetween` / `layoutColumns` / `layoutStack` / `phaseRuns` / `renderHtml` / `CLIENT_JS`） |
| `src/flow.ts` | 抽取：16 条分类规则、`buildLabel`/`buildSubtitle`/`laneOf`/`phaseOf`/`extractBranches` |
| `src/visual.ts` | `verify` 的 CDP 实现与 `PROBE` 断言 |
| `test/layout.test.ts` | 几何不变式的四条断言，改布局时先看它 |
| `plugin/client.js` | DSH 面板，必须和产物画同一张卡 |
| `schema/flow.schema.json` | `flow.json` 的 2020-12 契约，6 条测试保证和写出方不脱节 |
| `sandbox/ui-check.mjs` | 交互验收的唯一证据 |
| `CONTRIBUTING.md` | 抽取规则的两条失败模式与面板三层测试的写法 |
