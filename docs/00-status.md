# 状态：共享引擎、DSH 插件、Codex 插件与本地网页

> 写于 2026-11-19。给下一个接手的人（或下一个会话）看的第一份文件。
> 这里只写"现在是什么"，不写"为什么"。为什么在 `docs/02`。

## 一句话

`annot` 把一份 `SKILL.md` 读成带行锚点的流程图，输出单文件 HTML；改完文件用 `check` 判断图还对不对（exit 0/1）；用 `verify` 判断图画出来了没有（exit 0/1/2）。同一套引擎提供 CLI、DSH 面板、Codex Skill-only 插件、ZCode Skill 插件和可选的本地网页工作台。

## 现在能跑的东西

```bash
node --test test/*.test.ts test/*.test.js   # 240 个测试，全绿
bash sandbox/run.sh                          # 7 段隔离验收，17 条断言，全绿
node src/cli.ts annotate <skill-dir> --out <dir>
node src/cli.ts search <词> -- <root...>
node src/cli.ts check <flow.json>
node src/cli.ts verify <flow.json> --shot <dir>
node src/cli.ts web [root...] --port 8787   # 单独启动 loopback 网页，Ctrl+C 停止
node sandbox/m3-experiment.ts                # M3 验收实验，见下
```

| 命令 | 退出码含义 |
|---|---|
| `check` | 0 全部同步 / 1 有漂移 |
| `verify` | 0 通过 / 1 有问题 / **2 跳过（无浏览器）** |

## 真实数字（跑出来的，不是估的）

| 指标 | 值 | 来源 |
|---|---|---|
| 整库 skill 数 / 零瑕疵数 | 77 / 18 | `annot audit ~/.agents/skills ~/.dsh/skills` |
| 最烂的 skill | `feishu-task-creator` 21.0 | 同上 |
| 未绑定分支总数 | 22（分布在 7 个 skill） | 同上；修规则前是 75 / 27 个 |
| grill-method | 26 节点 / 25 边 / 3 个未绑定分支 | 行内枚举没有结果表目标证据 |
| 分支规则 fixture | 结果表首列 3 个分支 / 3 条精确标题边 | `test/fixtures/branch-table.md`，四视口通过 |
| 分支图布局 | 结果分支同层显示；不补造跨分支顺序边 | `test/layout.test.ts` |
| challenge | 13 节点 / 12 边 / 0 分支 | 同上 |
| 面板链路 | `composed.registered: true`，rev `9b0a9bca464d` | `GET /api/annot/selfcheck` |
| 面板是否被打开过 | **是**，用户在 desktop profile 里点开了 Annot 行并出图 | 用户截图 + `dom-after-mount` 上报 |

**关于"面板到底有没有出现"：** 这条路走完了。宿主侧：包被编进模块图、bundle 能按 rev 取到、`apply-enter` 与 `seat-available` 在页面重载时连续出现过三次。页面侧：`dom-after-mount`（+1.5 s）报 `panelButtons: 6, ourIcons: 1`，侧边栏文本是 `新会话 Ctrl + N 插件 自动化任务 Annot 更多 工作区 …`——Annot 行落在 `自动化任务` 与 `更多` 之间，紧贴 `工作区` 上方。用户随后自己点开、并贴了 `agent-dev-standards` 的整窗截图。

**这也解释了"为什么一开始找不到"：** `panelList` 和 `工作区` 共用同一个 `.scrollArea`（`SidebarRoot.tsx:416-417` 那段 `<nav aria-label="全局面板">`），所以面板行会随工作区一起滚走；用户最初那张 767×330 的裁图正好从 `工作区` 开始，把这一行切在了外面。

## 面板的可观测性（这是这一轮真正补上的东西）

面板"没出现"有三种完全不同的原因，而在宿主侧它们长得一模一样。`GET /api/annot/selfcheck` 一次把它们分开：

| 你看到的 | 含义 |
|---|---|
| `composed.registered: false` | 这个包没被编进 `__DSH_BOOT__` 的模块图 |
| `reports: []` | 编进去了，但浏览器半边从没执行 |
| 有 `apply-enter`、无 `seat-available` | 执行了，但宿主没声明 `sidebar.panellist` 这个席位 |
| 有 `registered` | 注册成功 |
| 有 `panel-mounted` | **有人真的打开过这个面板**，链路全通 |

`reports` 里出现的三条已实测填过：`registered: true`、`apply-enter` 与 `seat-available` 在三次页面重载中各出现一次。合成上报（探针、终端里的 curl）带 `probe: true`，selfcheck 把它们单独计进 `probes`，绝不混进 `reports`——否则"有人真的看过面板"这个信号谁都能伪造。

`composed` 直读宿主的 `clientModules` 服务，并给出确切的 bundle URL（形如 `plugins/??annot-dsh/client.js&rev=<hash>`，rev 由 client.js 的 mtime/ctime/size 算出）。

## 这一轮改了什么：图本身（2026-11-18）

第一条用户反馈是"流程有点奇怪 / 显示不了核心流程 / 评估也看不到 / 可读性差 / UI 差"。前两条不是 UI 问题，是几何问题：

| 症状 | 真因 | 改法 |
|---|---|---|
| 读不出流程 | 布局是**列优先网格**：19 步被切成三列七行，读序到列底要回顶部，箭头往回指 | 改成**分层 DAG**：深度 = 最长顺序路径，深度向下、同级向右；连线只走直线或四段折线，不再用贝塞尔 |
| 看不出第几步 | 画布上没有任何序号 | 左侧 88px 号牌槽，每条深度带一个 `01`…`19` 和一条细线，截图可引用 |
| 卡片像一堆等价便签 | 六种粉彩填充，全部同权 | 白卡 + 1px 墨线 + 3px 顶线表示类型；只有"未落地分支数"和"低置信点"用锈色，其余一律墨色 |
| 标题被切成半句 | 每字形 12.5/7px 的近似估算，且布局与绘制各算一次 | `wrapLabel()` 在**布局期**就把标签折成 `n.lines`，绘制直接消费；卡片宽度 360px，最多三行，超出以 `…` 结尾 |
| 没有评估界面 | 侧栏只有图例和待办 | 侧栏顶部是 **0–100 结构分** 与逐条扣分理由（未落地分支 −6/个、低置信 −4/个、空正文、标点标题），与 `audit` 同源于 `flow.json` |

视觉系统换成 Hallmark 的 terrazzo：off-white 纸面、墨线、锈色是唯一信号、零圆角（`--radius-card: 0`）、Syne / Onest / JetBrains Mono。`sloplint --genre modern-minimal` 报 0 FAIL / 0 REFLEX / 0 WARN。

**新增的测试：`test/layout.test.ts`（7 → 9 条）。** 它守的是列网格那版**全部通过**的东西之外的部分：确定性、每个后继都在前驱下方且恰好一条带、同带不重叠、不出画布、长标签会折行、超三行以省略号收尾、空文档仍有画布；外加两条：未落地分支必须画成臂且不超出卡片宽度、表格节点必须保留行而不是只剩表头。

## 这一轮补上的三件事（2026-11-18 第二轮）

第一轮的分层 DAG 只是把卡片摆对了，图仍然看不出"这里分叉"和"这张表的规则是什么"。

| 症状 | 真因 | 改法 |
|---|---|---|
| 三个分支只在角落有一个数字 | `branches` 里有 `when`，但没有任何形状承载它；未落地 = 无目标节点 = 无连线 | 卡片下方排**橙色小臂**（最多 4 条，按卡片宽度均分，超出以计数收尾），高度用 `h` 与 `cardH` 分开，布局期就留出 26px |
| 「八项必填」「三道门」看不见内容 | 表格节点整段折成一个 `artifact @55%` 卡片，label 只取表头 | `tableRows()` 在布局期把表格正文按行切成最多 6 行、每行 15px，其余折成「…还有 N 行」 |
| 同一个 skill 读出两个不能比较的数 | `audit` 与图右侧各有一套权重、方向相反（一个越高越差、一个越高越好） | 只保留 `defectsOf()` 一个缺陷向量；右侧分数恒等于 `100 − 审计分`，扣分理由与权重逐条对应 |
| `stats.maxDepth` 报 2，画布却画 19 条带 | `maxDepth` 取的是 `anchor.heading.length`，是标题层级 | 抽出 `src/depth.ts`，`maxDepth` = 最长顺序路径的深度，与布局共用同一实现 |

## M3 验收实验：3/3 通过

判据是 `docs/02` §8 提前写死的：手写 3 条自然语言改写指令，patch 只需微调即可接受 ≥2/3 才算过；锚点错位 >30% 直接判失败。

`node sandbox/m3-experiment.ts` 实测（fixture 26 节点 / 141 行）：

| # | 指令 | 落点 | 锚点结果 |
|---|---|---|---|
| 1 | 把 VERDICT 拆成守住/改良/替换三行并各写适用条件 | L61–64，1 行变 4 行 | 13 个 relocated，0 丢失 |
| 2 | 把 COMMIT 改短并加"判决卡不超过 10 行" | L62 | 0 relocated，0 丢失 |
| 3 | 在 ATTACK 后补"一次只问一个问题" | L60 | 1 relocated，0 丢失 |

**接受的判据不是"看着像"，是两条可判定的：** 编辑区重建后的节点 `raw` 必须逐字等于改写文本；且重新 `detectDrift` 后 `broken` 必须为 0。`moved`/`edited` 是机制正常工作，不算失败。

**这一轮修掉的两个真 bug（都是实验逼出来的，不是想出来的）：**

1. `segment()` 的 Shape A 要求**每一行**都是 `LABEL — text`，于是给 VERDICT 加了一个续行，整条四步流水线塌成一张卡片。改成"续行归上一段"，续行成为该段的正文。
2. 每一次成功的就地改写都被报成 `broken`——因为漂移检测只有 `moved` 和 `broken` 两档，原地改文本既没移动也没找到相似匹配。新增 `edited` 档（窗口内词重叠 ≥0.4 判为就地改写）。**修之前，"验证改写是否干净"这个检查在它唯一该通过的场景下必然失败。**

顺带修掉：`drift` 在改写 `node.anchor` 之后才读 `from`，导致日志打印 `moved 65 → 65`。

## 布局诊断：让"画出来了但不是流程"能被发现

`verify` 只能证明页面渲染成功（不溢出、节点齐全、零网络），证明不了**画的是流程**。实测三份真实 skill 全部 `bands == nodes`、`widest == 1`、`branch` 边为 0，而三视口检查全绿——没有任何断言会失败。

`src/diag.ts` 补上这一层，输出五类发现（前两类是 `warn`，后三类是 `info`，都不阻断构建）：

| code | 触发条件 | 实测触发 |
|---|---|---|
| `forks-not-drawn` | 声明了分支但 `branch` 边为 0 | grill-method：`文件里写了 3 个分支，一条都没连到目标` |
| `single-column` | ≥8 节点、每条带只有一张卡、且无 decision | agent-dev-standards：`19 个节点排成 19 条单卡带` |
| `stage-dominated` | ≥6 节点且 stage 占比 ≥80% | — |
| `labels-truncated` | 标签以 `…` 结尾 | 两份都是 7 个 |
| `over-split` | 每行切出 >1 个节点 | — |

两处消费：`annot annotate` 的报告尾部（`!` 是 warn、`·` 是 info），以及产物右侧的「形状」栏。诊断读的是 `flow.json` 本身，不改任何产物字节。

**面板与产物画同一张卡。** 之前面板把 `node.h` 当卡片高度、只画 `lines`，而产物在 `cardH` 处收边、下面还有分行和分支臂——同一份 `flow.json` 在两个 shell 里画出两张不同的图。现在面板消费同一份 `cardH` / `rows` / `arms`，`test/plugin-client.test.js` 加一条断言钉住这三样。

## 这一轮：卡片改说作者已经写下的东西（2026-11-19）

上一轮把几何修对了，用户看完仍然说"看不出核心流程"。这次逐条量了卡片上到底写了什么，找到了四个真原因：

| 症状 | 真因 | 改法 | 实测 |
|---|---|---|---|
| 卡片标题是 `bash` / `json` / `markdown` | `buildLabel()` 取 `cells[0]`，而围栏块的第一行是语言标记 | `CODE_TAG` 白名单过滤 + `meaningful()` 要求含字母或数字（JSON 的 `{`、表格的 `|---|` 都不合格）+ 去掉行内的 `#` | 四份真实 skill 的 6 个围栏卡片全部变成真命令 |
| 47% 的标题以 `…` 结尾 | `LABEL_MAX = 48`，而卡片能放三行 ≈83 个汉字 | 抬到 72（`release-checklist` 18 → 9 个截断） | 卡片可见字数 21% → 37% |
| 34 张卡排成 34 条匿名横带，作者写的 `Phase 1/2/3` 在图上一个字都没有 | `layoutNodes()` 从不读 `anchor.heading`；深度只来自顺序边 | 新增 `phases[]` 与 `layout.phaseRuns`：先把声明式阶段（`Phase N` / `阶段N` / `第N步`）连成**强**带，其余按"至少罩住两张卡的最近标题"连成**弱**带（虚线）；单卡带一律不画 | `release-checklist` 34 卡 → 8 条带（3 强 5 弱）；`grill-method` 7 条；`challenge` 3 条 |
| "每一步都是我做" | 没有"谁做"这个维度，`git fetch` 和"判断分支是否落后"同一列 | 新增 `lane: reader \| tool \| model \| output`，卡片右上角写、侧栏加一份图例、`annotate` 报告新增 `by lane` 行 | `release-checklist` 你 26 · 工具 4 · 模型 1 · 产物 3 |
| 4 个节点"低于 60% 置信度"像是模型没把握 | `confidence` 是规则常数：`paragraph` 恒 0.65，13 个节点读数一样 | 保留字段不改语义，新增 `rule` 字段写明是哪条规则，UI 改称「规则」并显示 `paragraph · 常数 65%` | `agent-dev-standards` 的 13×0.65 现在自解释 |
| 画布 528px 宽，1440 窗口的图区 981px，右侧 454px 全空 | 宽度只按 `NODE_W × 最宽带` 算 | `MIN_CANVAS = 900`、`NODE_W_MAX = 620`：剩余宽度还给卡片而不是内边距 | 528 → 900px，`grill-method` 高度 3605 → 3402 |

**同时补了 `subtitle`（卡片第二行）**，但刻意做得窄：只在两种作者已经隔开的形状上触发——shell 行的尾注释、以冒号收尾的引导句。列表的第二条**不**当副标题：那是并列步骤，升格会让图谎报一个作者没写的关系（`test/card.test.ts` 有一条断言钉住）。

**新增 `test/card.test.ts`（10 条）**，守的就是上面这几条：围栏块不以语言标记命名、JSON 块不以 `{` 命名、每张卡都有 lane、声明式阶段变成 phase、没有阶段声明时不编造、引导句带出副标题、列表不编造副标题、`rule` 与常数可解释、真实 fixture 的 lane 覆盖率恒等于节点数。

## 这一轮：三列管道图 + 悬停跟迹（2026-11-19）

用户的诉求是"能不能像这张草图一样"：左列核心流程、中列门禁/外部调用、右列产物，一行的三张卡横向对齐。做之前先量了四件事，每一件都改变了做法：

| 量的事 | 数 | 结论 |
|---|---|---|
| 侧卡在主路径上的分布 | `release-checklist` 25 行里 17 行没有侧卡，最长连续 12 行空 | **整页三列会留下一大段空轨道**，所以列不是全局的：每一行只画它真有的列，表头仍列出三列并写清"本文件没有这一类" |
| 侧卡能不能不交叉地挂到主路径 | 4 份真实 skill 全部 **0 处倒挂** | 行的归属规则用"源文件顺序上最近的那个核心步骤"，**不是**按行号距离最近 |
| 按行号距离最近的代价 | `release-checklist` 出现一条 **row 25 → row 1** 的边 | 这条规则被实测否掉，写进了 `rowsOf()` 的注释 |
| 三列被挤到多窄才够 | 981px 图区 → 核心 420 / 两侧 170 | 侧卡 165px 时页脚 `L24–26 · 55% · code-with-calls` 宽 173px，撑破卡片；改成按卡宽裁剪后 `verify` 才过 |

**几何**：`COLUMN` 是常量（420 / 170 / 170，间距 26），所以主路径是一根直的竖脊；一行的高度是这一行最高的那张卡，同列第二张卡向下叠；表头 `核心流程 25 · 门禁 · 外部调用 6 · 产物 3` 自带计数和一句解释，空列写"本文件没有这一类"。

`release-checklist`：**34 节点 / 26 行 / 980×3711（4.1 屏）**，原来是 900×4244（4.7 屏）；`grill-method` 3392 → 2882；`agent-dev-standards` 2428 → 2119。列分配 `核心 25 / 门禁 6 / 产物 3`。

**边的形状**（`routeBetween`）：同列直落、同行直连、跨行肘接。实测 `release-checklist` 的 33 条边只有三种形状，没有一条需要绕过画布。

**交互**（`/archify` 的 `motion-governed` 原则：静态必须自身完整）：
- **悬停跟迹**：只点亮**直接**上下游，不点整条链。先按传递闭包做过，实测第 1 行能点亮 33/34——等于没点亮。
- **缩放**：6 档（60%–200%），`+` `-` `0` 快捷键，`Ctrl+滚轮`在指针处缩放并保持滚动位置；普通滚轮仍是翻页。
- **查找**：标签 / id / 行号 / 阶段名都可搜，Enter 逐个跳，命中卡片描边用强调色。
- 底栏实时写"这一格从哪来、到哪去"。

**新增 `test/layout.test.ts` 三条**（列是真的列、一步与下一步恰好相邻一行、任意两卡不重叠），加上"没有侧卡的文件退回单列"一条。`sandbox/ui-check.mjs` 是一条真浏览器交互验收：17 条断言，覆盖悬停开/关、hot 与 dim 的分区、缩放档位与按钮文案、查找命中与清空——**光有源码不算交互存在**。

`node --test test/*.test.ts test/*.test.js` = **177 条全绿**；`bash sandbox/run.sh` 7 段 17 条全绿；五份真实 skill（`release-checklist` / `agent-dev-standards` / `challenge` / `archery-query` / `grill-method`）四视口 `annot verify` 全绿。

## 已知的洞（按严重度）

| # | 洞 | 影响 | 下一步 |
|---|---|---|---|
| 1 | **五份样本没有结果表分支证据** | `grill-method` 有 3 个行内枚举分支，但没有以「守住 / 改良 / 替换」为首列的结果表；不能据此连到目标 | `test/fixtures/branch-table.md` 验证规则和 DAG 布局；等待真实 Skill 出现首列值与后续标题精确匹配的证据，不放宽规则 |
| 2 | 表格的语义丢了类型 | 「八项必填」「三道门」现在能看见行，但类型仍是 `artifact @55%`——它们其实是 gate | 表格按首列表头词判定 gate/artifact |
| 3 | `confidence` 是规则桶，不是置信度 | 已改称「规则」并显示规则名，但底层数值仍是拍的常数；整库 71.8% 节点是兜底的 `stage` | 要么给每个规则单独标定，要么把数值换成"规则命中了几条证据" |
| 4 | 面板不缓存、不做逐节点漂移比对 | 它告诉你"这份图对应哪个 sha"，但不会把改过的节点标红 | 「改了就红」目前只有 `annot check` 能做 |
| 5 | 缺陷权重没有校准数据 | `×10/×5/×2/×1/×20` 是拍的（现在只有一处，改一次两边都动） | 只当排序用，别对外讲"评分" |
| 6 | 常驻规则被画成步骤 | 24%~35% 的卡片是"一直成立"的约束（`禁止凭记忆断言`），不是"此刻执行"的步骤；按小节名判定只能覆盖 3/34，按关键词判定 8/34 里有一半是真步骤 | 需要一条能区分的判据，否则会把真步骤降级成脚注 |
| 7 | 侧列大多时候是空的 | 三列只在一行真有侧卡时才画，但 `release-checklist` 25 行里只有 8 行有；整页看下去，右两条轨道断断续续 | 要么把"常驻规则"这类侧卡上调（和 #6 是同一个判据），要么改成"每个阶段一组三列"而不是整页一条轨道 |
| 8 | npm 的 `annot` 名字被占 | 不能 `npm i annot` | 发 scoped 包 |
| 9 | 只有 `master` 分支、无 remote | 别人拿不到 | 建 GitHub 仓库 + push |
| 10 | eval 执行层尚未实现 | 已能生成配对评估与优化计划，但 baseline/Skill 运行、断言执行和 benchmark 汇总仍交给宿主或外部 harness | 接入 harness 后，把运行产物回填到统一报告 |
| 11 | Codex 新 Agent 尚未在新会话中调用 | `annot@annot-local` 已安装、启用并刷新为三个 Skill 加 Agent 的缓存；当前进程仍可能保留启动时的能力清单 | 重启 Codex 后在新会话发起一次分析与一次评估，记录实际调用 |
| 12 | ZCode 插件尚未在宿主 UI 安装 | manifest 已通过 ZCode 0.17.3 校验，本地 market 与三个 Skill 已生成；用户尚未完成市场添加和安装 | 在 ZCode 添加 `D:\Projects\flp\vibeskill\plugins`，安装 Annot 后新建任务试跑 |

## 目录里有什么

```
src/         引擎（零依赖，零构建，Node 24 直接跑 .ts）
  parse → flow → depth → drift → audit → context → search → render → visual → browser → web
  fsx        原子写入（临时文件 + fsync + 空文件拒绝 + rename）
  manifest   annotation.json：相对路径 + 源 sha + 产物 sha256
schema/      flow.schema.json（2020-12），6 条契约测试保证它和写出方不脱节
plugin/      DSH 宿主壳（JS，无构建）
  index.js   8 条路由，除自述与临时目录外只读
  client.js  侧边栏行 + 主区页面，经 __ModuleLoader__ 注册
plugins/     Codex Skill/Agent 插件、ZCode Skill 插件与两套本地 marketplace 清单
web/         独立本地工作台静态资源，由 `annot web` 提供
test/        242 个测试，覆盖 core、统一工作台守护进程、DSH、Codex manifest 与 Agent、ZCode manifest 与 Skill 同步、本地网页、AI 分析提案、评估任务、可配置扫描根、说明关联与浏览器渲染
sandbox/     隔离验收脚本，不碰真实 ~/.agents；m3-experiment.ts 是 M3 验收实验
tools/       人眼工具：inspect（表）/ explain（反查）/ probe-panel（打 GUI）
docs/        01 形态调研 / 02 决策与里程碑 / 03 借用能力对照
```

## 三条不能破的约定

1. **跳过的检查不算通过。** `verify` 找不到浏览器返回 2，报告里写"跳过渲染检查"，测试断言它绝不打印 `✓`。CI 里 2 必须让人看一眼。
2. **二进制产物不能走 utf8 原子写入。** 截图必须走 `atomicWriteBytes(..., 'base64')`。曾经因为这点把 PNG 写成了 base64 文本，文件大小看起来完全正常。
3. **面板不自己实现布局或抽取。** 每一次点击都 exec 同一个 CLI，所以面板和命令行不可能给出不同的图。

## 分支识别与布局

只有结果类表格的**首列**能提供自动分支目标；分支值必须与后续章节标题完全一致。行内枚举、其他列里的值和模糊词重叠都不构成落点证据。没有精确目标的分支保留为未绑定状态。

`test/fixtures/branch-table.md` 覆盖 3 个结果和 3 条边，并断言互斥结果不被自动串成顺序步骤。出现已绑定分支边时使用分层 DAG 布局；没有分支边的文档继续使用线性三列布局或单列布局。现有 `grill-method` fixture 只有行内「守住 / 改良 / 替换」，因此仍显示 3 个未绑定分支、0 条 branch 边；五份现有样本也没有因此得到伪造的目标。

## 说明关联与孤立文本率

说明节点带 `noteRole`，区分为原则、理由、定义、触发、背景、风险、示例和参考。`associations` 是独立的非执行关系，可把说明连到动作（`supports`）、门禁（`constrains`）、判断（`informs`）或产物（`explains-output`），不改变 `maxDepth`。

无法落到单个节点、但明确作用于整个 Skill 的说明标为 `skill`；既无节点目标也无全局范围的说明标为 `unbound` 并进入待确认清单。`annot.sidecar.json` 可用 `associatesWith` 指定目标，也可用 `associationScope: "skill" | "unbound"` 人工校正。

孤立文本率 = 孤立说明数 / 说明总数。这是静态可追踪性信号，不是 Skill 行为效果分。2026-11-20 按本地网页默认候选根实测：75 个 Skill、942 条说明，779 条关联、70 条全局、93 条孤立，整体孤立率 9.9%；其中 42 个 Skill 为 0%，23 个在 1–25%，9 个在 26–50%，1 个高于 50%。

## AI-first 分析与评估

语义分析不再由 CLI 的动作词、门禁词和产物词表决定。`annot ai-prompt` 输出带逐行源码、源 hash 和 JSON 契约的分析任务；宿主 AI 判断节点类型、Action、边、分支、门禁、产物和说明关系；`annot annotate --analysis` 验证每段逐字引文和引用关系后生成图。

插件同时提供 `annot-analysis` 和 `annot-evaluation` 两个 Skill。前者负责语义建图，后者负责从真实行为推导评估场景并执行隔离配对。主 `annot` Skill 只做路由。

网页默认从 `.annot/analyses/<skill>.analysis.json` 加载已验证 AI 提案，并在标题区显示 `AI 语义分析`；没有提案时才回退到明确标注的 `规则草案`。`--analysis-dir` 可以覆盖缓存目录。网页中的“AI 重建动作图”和“评估与优化”都会生成宿主 AI 任务，不再生成关键词抽取说明。

### 连线与缩放回归

- 三列间距从 26px 增加到 64px，跨列关系只通过列间通道转弯，不再沿整列卡片边框向下。
- 边线使用 `vector-effect: non-scaling-stroke`，执行线 2px、说明关联 1.6px；60% 缩放时线宽不再同比变细。
- 重置缩放同时归零水平和垂直滚动，避免图从左侧被裁掉。
- 新增 `edge-audit`：对当前 75 个 Skill 的 1443 条执行与说明关系检查，非端点卡片碰撞为 0。

### 规范证据与任务输出回归

- 标准检查的 `note-coverage` 返回孤立说明的节点 ID、标签和源码行范围；网页显示“定位 N 条孤立说明”，点击后切回动作图、打开卡片栏并筛选 `unbound`。
- 动作摘要桌面左右内缩 48px、窄屏 32px；`annot verify` 在真实浏览器中检查标题、说明、动作区和数量标签的保护间距。
- 评估指标提供“全选/清空”开关，手动勾选会同步按钮状态；8 个指标可一次全部选中。
- 分析、修改、评估任务生成后自动打开原生 `dialog`。桌面弹窗宽度上限 1080px、高度上限 86vh，移动端保留 8px 外边距；复制和关闭均位于弹窗内。

旧规则抽取仍保留，用于历史 fixture、迁移和回归；其 `source.method` 为 `rules`，只代表规则草案。AI 路径为 `source.method: ai` 并记录 `analysis_sha`。完整的确定性/非确定性边界见 `docs/ai-first-analysis.md`。

## Codex 插件与本地网页

Codex 包位于 `plugins/annot/`，portable 根 `plugin.json` 与 `skills/annot/SKILL.md` 按固定目录布局打包；manifest 声明 `requires_local_executor`。项目 marketplace 在 `.agents/plugins/marketplace.json`，当前 Codex 已安装并启用 `annot@annot-local`。`agents/annot-reviewer.md` 提供独立 Skill Reviewer Agent，仍通过同一组 `annot-analysis`、`annot-evaluation` 和 `annot` Skill 回到宿主对话执行。插件使用 `annot` CLI，不带第二套抽取代码。CLI 包名 `annot` 当前无法从 npm registry 安装；源码工作区可用 `npm link` 暴露本地命令。

网页以 `node src/cli.ts web [root...] --port 8787` 或 `npm run web -- [root...]` 启动，只监听 `127.0.0.1`。省略 roots 时，`defaultRoots()` 扫描 18 个封闭候选根：当前项目与用户目录各有一份共享 Agents、Claude Code、Codex compatibility、Cursor、GitHub Copilot、Gemini CLI legacy、OpenCode、DSH、ZCode。Codex 官方共享根是 `.agents/skills`；`.codex/skills` 与 Gemini 目录作为兼容/legacy 项保留。`CODEX_HOME` 与 `CLAUDE_CONFIG_DIR` 会覆盖默认用户配置根，显式 roots 完全替代默认范围。

左侧 Skill 库已合并信息层级：「扫描目录」置顶，可勾选常见工具根、追加自定义路径、应用后立即重扫，并可用「恢复默认」撤销。选择写入 `.annot/web-roots.json`，服务重启后继续生效；配置路径可用 `--root-config` 隔离。该写入只保存扫描范围，仍不写任何 Skill 源文件。主工作台与 QA 工作台使用不同配置文件，避免多实例互相覆盖。
工作台顶部提供三个独立入口：

- **Skill 库**：浏览单个 Skill、动作图、卡片上下文和自然语言任务。
- **整库评估**：`GET /api/library-report` 一次汇总全部 Skill 的静态规范、资源引用、孤立说明和抽取结构问题；报告可按阻断/建议筛选，并导出 Markdown/JSON。未执行行为 eval 的 Skill 全部标为 `unmeasured`。
- **版本管理**：`POST /api/snapshots` 将 Skill 路径、内容 hash 与原文保存到 `.annot/snapshots/`；`GET /api/snapshots/diff` 比较新增、修改和移除项。相同内容指纹在时间线中合并显示，但仍保留捕获次数；恢复动作只生成宿主任务。

`POST /api/library-report/task` 在生成整库优化任务前自动创建基线快照，把机器可读报告写入 `.annot/reports/`，再返回包含快照、报告路径、阻断/建议问题和验收要求的 Markdown 任务。任务由 Codex、DSH 或 ZCode 宿主执行，工作台仍不直接修改 Skill。

## 统一工作台入口

`annot workbench open` 把“打开网页”收敛成一个宿主无关命令：先探测 `/api/status` 的实例 ID，健康实例直接复用；没有实例时后台启动 `annot web`，把 PID、端口和实例 ID 写入 `.annot/workbench.json`，日志写入 `.annot/workbench-<port>.log`。`status` 报告运行与受管状态，`stop` 只终止实例 ID 匹配的进程。Codex Agent/Skill 与 ZCode `open-workbench` 命令调用这一入口；DSH 原生面板增加 POST 路由和“浏览器打开”按钮，启动仍复用同一个 CLI。

每个根内部最多递归 5 层，支持分类子目录；发现 `SKILL.md` 后停止下降。realpath 与 visited 集合阻止符号链接循环。缺失目录保留为 skipped 状态供页面解释，一个不可读子目录不会遮住同根的其他可读 Skill。

本轮本地服务 HTTP 冒烟覆盖了列表、搜索、流程图、三条分支边、节点上下文、图 HTML、审计，以及修改/评估任务生成；自动测试覆盖 18 个候选根、环境变量覆盖、分类子目录、符号链接循环、缺失根透明展示、跨站、任意路径、写请求拒绝和 16 KiB 请求体上限。

`POST /api/brief` 支持两种模式：`rewrite` 绑定一个节点并生成精确修改任务；`evaluate` 生成 baseline 与 Skill 的配对试验和优化回退规则。两者都只返回文本并声明 `writesSource: false`。页面在没有真实运行结果时显示“效果未测”，结构审计分不再被暗示为效果分。

## 接下来该做什么（如果只做一件）

重启 Codex 桌面端一次，确认新缓存中的 `Annot Skill Reviewer` Agent 和三个 Skill 都能在新会话中被发现；再在新会话里发起一次真实的 Skill 分析与一次评估任务，记录调用结果。DSH 下次启动会从本地 junction 加载当前 panel，需要在宿主内确认 Annot 行与改写上下文仍然可见。ZCode 测试市场 `dev-vibeskill-9378cedf` 等待在宿主中手动添加、安装并试跑。其余待办见本文件「已知的洞」。
