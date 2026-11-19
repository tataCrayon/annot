# 进度存档：annot（Skill 流程可视化 / 评估 / 自然语言调整）

> 2026-11-19 存档。用途：换到别的工具（Claude Code / Codex / Cursor 等）继续这个任务。
> 本文件与 `CONTEXT.md`、`MAP.md` 三件套自足：读完这三份就能接手，不需要旧聊天记录。
> 项目根：`D:\Projects\flp\vibeskill`。当前 HEAD：`f0faf62`。工作树干净。

---

## 一句话

`annot` 把一份 `SKILL.md` 读成带**行锚点**的流程图，输出单文件 HTML；改完文件用 `check` 判断图还对不对；用 `verify` 在真浏览器里判断图画出来了没有；DSH 里有同源面板。现在图是三列管道：左列核心流程、中列门禁/外部调用、右列产物。

## 起点：用户最初要解决什么

> 「针对'Skill做得对不对、怎么调整'这个核心痛点」
> 「我期望可以做一个工具，能可视化Skill流程，这样方便使用自然语言进行调整Skill，能够评估、优化我们的Skill」
> 「首先，第一，我们需要确认我们工具的形态，是不是做成插件什么的或者什么别的小工具？行业目前是怎么做的？」

三个维度：① 可视化核心流程 ② 评估 ③ 用自然语言调整。
形态已定稿（`docs/02`）：**一套引擎 + 多个宿主壳**——零依赖 core + DSH cordis 插件 + Claude Code skill/MCP + CLI。**「常驻」= 能力嵌在宿主里，不是守护进程。**

## 最新目标（本轮已交付）

用户贴了一张三列管道草图：「大概做成这样的怎么样？ 具体动效和展示效果可以参考 /archify」。
已交付并提交 `f0faf62`。关键取舍：**列不是全局一条轨道，而是每行只画它真有的列**——因为实测 `release-checklist` 25 行里 17 行没有侧卡，整页轨道会留 12 行连续空白。

## 当前停驻点

**没有未完成的中间态。** 代码、测试、文档三者一致，全部已提交，工作树干净。
换工具后**不需要"修完什么再继续"**，直接选下一个任务项（见下）。

## 换工具第一步（照这个顺序做，别自己发明）

```bash
cd D:\Projects\flp\vibeskill

# 1. 确认基线：应当是 157 条全绿（104 TS + 53 JS）。这一条就够了：
npm test

# 2. 确认隔离验收：7 段、17 条断言
bash sandbox/run.sh

# 3. 重新生成沙箱产物（sandbox/ 被 git 忽略，换机器/换工具后可能不存在）
node sandbox/all-skills.mjs

# 4. 真浏览器渲染验收 + 截图
node src/cli.ts verify "sandbox/work/all/release-checklist/release-checklist.html" --shot "sandbox/work/all/shots"

# 5. 交互验收（悬停跟迹 / 缩放 / 查找，17 条断言）
node sandbox/ui-check.mjs "D:\Projects\flp\vibeskill\sandbox\work\all\release-checklist\release-checklist.html"
```

**Node 版本**：**≥ 22.18**。`package.json` 的 `engines` 写的 `>=22.18`；本机实测 `npm test` 在 v24.18.0 下 157 条全绿，**不需要额外 flag**（Node 24 原生剥类型）。
本机 PATH 上是 `D:\DevEnv\node-v24.18.0-win-x64\node.exe`（v24.18.0）；DSH 自带 `D:\Users\zigang.wang\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0）。两个都行。

## 任务项清单（换工具后从这里挑一个）

- [x] 形态调研与定稿（`docs/01`、`docs/02`）
- [x] 抽取引擎：`parse → flow → depth → drift → audit → context → search`
- [x] 带行锚点的 `flow.json` + JSON Schema 2020-12 + 6 条契约测试
- [x] 单文件 HTML 产物（零网络请求，`verify` 断言）
- [x] `verify`：真 Chrome CDP、四视口、exit 0/1/2（2 = 跳过，绝不算通过）
- [x] DSH 插件壳：8 条路由 + 侧边栏行 + 主区页面 + selfcheck
- [x] 卡片改说作者已写下的结构（阶段成带、谁做标角、副标题、规则名）
- [x] 三列管道图 + 悬停跟迹 + 缩放 + 查找（`f0faf62`）
- [ ] **让 `branch` 边在真实数据里真的出现**（见下「下一步」）
- [ ] Claude Code 壳（`cc-plugin/`：skills + hooks + `.mcp.json`）——**一行都还没写**
- [ ] M0 风险核实：Claude Code 能否渲染 MCP Apps UI（`docs/02:336` 标着「未核实，M0 必查」）
- [ ] M4：trace 反投影 + eval 引擎（`docs/02` §8）
- [ ] 发 scoped npm 包（`annot` 名字被占）；建 GitHub remote（当前只有 `master`、无 remote）

## 下一步（如果只做一件）

**让分叉在真实数据里真的出现。**
现在五份真实 skill 全是 `forks 0`、`branch 边 0`——图是编号清单，不是流程。
`release-checklist` 原文有 15 行条件句（`若…` / `否则…` / `失效`），抽取器一条都没认。

具体做法（`docs/00-status.md` 末尾也写了）：给节点补一条"分支落点来自哪张表的首列"的抽取规则，把 `grill-method` 的 `守住/改良/替换` 变成三个可连目标。
**验收判据**：`annotate` 报告的 `forks` 行里 `bound` 从 0 变成 3，且 `bands` 少于 `nodes`。

⚠️ **这一步会和当前三列布局冲突**：列模型假定"侧卡挂在它前面那个核心步骤上"（实测 0 倒挂，只对线性图成立）。一旦 `branch` 边出现，两条分支指向不同后续，侧卡归属不再唯一，`src/render.ts` 的 `rowsOf()` 行规则必须重新推导。**动布局之前先读 CONTEXT.md 的「布局」章节。**

## 边界与约束（不要越界）

- **不做的**：❌ 独立 Electron/Web 应用 ❌ 自造 trace 协议 ❌ 自建 eval 引擎 ❌ 只做插件形态 ❌ 常驻守护进程 ❌ skill 的增删改（只读+建议，改动交给用户自己的 agent） ❌ 未核实的 MCP Apps 通道 ❌ v1 加第三个宿主
- **不改外部的**：`D:\Users\zigang.wang\.agents\skills\**` 是用户真实的 skill 库，annot 只读它。要看效果请复制到 `sandbox/` 或用 `--out` 指到别处。`bash sandbox/run.sh` 有一段专门断言"沙箱外没有任何文件被改动"。
- **提交口径**：commit 必须以 `AI: ` 开头，只写功能变动，禁对话口吻。git hook 在 `D:/Users/zigang.wang/.agents/git-hooks`。**禁止 `--no-verify`、禁止 `GIT_COMMIT_SKIP_AI_GATE=1`。**
- **三条不能破的约定**（`docs/00-status.md` 有原文）：
  1. 跳过的检查不算通过（`verify` exit 2 必须让人看一眼）
  2. 二进制产物不能走 utf8 原子写入（截图必须 `atomicWriteBytes(..., 'base64')`）
  3. 面板不自己实现布局或抽取（每次点击都 exec 同一个 CLI）

## 验收标准

改动算完成，必须同时满足：
1. `node --test test/*.test.ts test/*.test.js` 全绿，且**新增能力有对应断言**（不是只跑通）
2. 五份真实 skill 四视口 `verify` 全绿：`release-checklist` / `agent-dev-standards` / `challenge` / `archery-query`(frontmatter 里叫 `archetypes`) / `grill-method`
3. 动到产物或交互时，`sandbox/ui-check.mjs` 17 条仍全绿
4. `bash sandbox/run.sh` 7 段全绿
5. 文档三处同步：`docs/00-status.md`（状态与洞）、`docs/03-prior-art...`（借了什么没借什么）、`README.md`（测试数与读图说明）

## 已知的洞（接手时别当它们是 bug 新发现的）

| # | 洞 | 现状 |
|---|---|---|
| 1 | 真实输入从没产生过分叉带 | 五份 skill 全 `branch 边 0`；这是下一步 |
| 2 | 表格语义丢类型 | 「八项必填」画成行，但类型仍是 `artifact @55%`，其实该是 gate |
| 3 | `confidence` 是规则桶不是概率 | 已改称「规则」并显示规则名，底层仍是拍的常数 |
| 4 | 面板不做逐节点漂移比对 | 只报"对应哪个 sha"，「改了就红」只有 `annot check` 能做 |
| 5 | 缺陷权重没校准 | `×10/×5/×2/×1/×20` 是拍的，只当排序用 |
| 6 | 常驻规则被画成步骤 | 24%~35% 的卡是"一直成立"的约束，不是"此刻执行"的步骤；无可靠判据 |
| 7 | 侧列大多时候是空的 | `release-checklist` 25 行里只有 8 行有侧卡 |
| 8 | npm `annot` 名字被占 | 需发 scoped 包 |
| 9 | 只有 `master`、无 remote | 别人拿不到 |
| 10 | M4 未开始 | 只能判断"图读得准不准"，不能判断"skill 写得好不好" |

## 面板现在能不能用（别重复踩）

- 装法已通：desktop profile 的 `package.json` 里有 `"annot-dsh": "link:D:/Projects/flp/vibeskill/plugin"`，且 `cordis.patch.yml` 的插件列表含 `annot-dsh`。
- 真机状态：`GET /api/annot/selfcheck` 返回 `composed.registered: true`，侧边栏行存在（落在「自动化任务」与「更多」之间）。
- **但本会话没能在页面里再点开它**（GUI 是 401-gated，且用户当时在看别的）。所以「面板的列头/导轨/跟迹是否和产物一致」**只有源码断言，没有真机截图**。换工具后如果宿主换了，这条要重新验。
- 断面板问题先读 `docs/00-status.md` 的「面板的可观测性」表：`composed.registered: false` / `reports: []` / 有 `apply-enter` 无 `seat-available` / 有 `registered` / 有 `panel-mounted` 是五种不同故障。

## 环境备忘

- 浏览器：`C:\Program Files\Google\Chrome\Application\chrome.exe`（`verify` 自动探测，也可 `ANNOT_CHROME` 指定）
- `web_search` 在本机**长期 402 Insufficient Balance**，联网调研走 `sandbox/search.mjs`（Bing RSS）或 `sandbox/search-gh.mjs`（GitHub API）
- `sandbox/` 与 `.probe/` 被 git 忽略，**不会随仓库迁移**；换机器后要重跑 `node sandbox/all-skills.mjs` 才能有图可看
- PowerShell 里别用 `node -e` 内联正则/JSON（引号会被吃掉），一律写 `sandbox/*.mjs` 文件
