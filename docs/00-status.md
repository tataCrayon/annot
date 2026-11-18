# 状态：M1 完成、M2 面板可查、M3 实验通过（3/3）、图能画出分支臂与表格行

> 写于 2026-11-18。给下一个接手的人（或下一个会话）看的第一份文件。
> 这里只写"现在是什么"，不写"为什么"。为什么在 `docs/02`。

## 一句话

`annot` 把一份 `SKILL.md` 读成带行锚点的流程图，输出单文件 HTML；改完文件用 `check` 判断图还对不对（exit 0/1）；用 `verify` 判断图画出来了没有（exit 0/1/2）；DSH 里有一个同源面板，能在图上看、能搜、能把"该改哪几行"交给你自己的 agent；`context` + 一次编辑 + `check` 这条闭环已用 3 条自然语言指令实测通过。

## 现在能跑的东西

```bash
node --test test/*.test.ts test/*.test.js   # 139 个测试，全绿
bash sandbox/run.sh                          # 7 段隔离验收，17 条断言，全绿
node src/cli.ts annotate <skill-dir> --out <dir>
node src/cli.ts search <词> -- <root...>
node src/cli.ts check <flow.json>
node src/cli.ts verify <flow.json> --shot <dir>
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
| grill-method | 26 节点 / 25 边 / 3 个未绑定分支 | `annot annotate` 的 `forks` 行 |
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

## 已知的洞（按严重度）

| # | 洞 | 影响 | 下一步 |
|---|---|---|---|
| 1 | **真实输入从没产生过分叉带** | 三份真实 skill 实测 `bands = nodes`、`widest = 1`、`branch 边 = 0`：图目前是竖排编号清单，扇出那段几何在真实数据上一次没跑过 | 分支臂已画出来，但"两条分支各自流向不同后续"仍不成立；需要抽取器真的产出 `branch` 边（最佳匹配阈值 0.5 对中文短句太严） |
| 2 | 表格的语义丢了类型 | 「八项必填」「三道门」现在能看见行，但类型仍是 `artifact @55%`——它们其实是 gate | 表格按首列表头词判定 gate/artifact |
| 3 | `confidence` 是规则桶，不是置信度 | `agent-dev-standards` 里 13 个节点恰好 0.65（`paragraph` 一律 0.65）；整库 71.8% 节点是兜底的 `stage` | 要么改名"分类来源"，要么给每个规则单独标定 |
| 4 | 面板不缓存、不做逐节点漂移比对 | 它告诉你"这份图对应哪个 sha"，但不会把改过的节点标红 | 「改了就红」目前只有 `annot check` 能做 |
| 5 | 缺陷权重没有校准数据 | `×10/×5/×2/×1/×20` 是拍的（现在只有一处，改一次两边都动） | 只当排序用，别对外讲"评分" |
| 6 | npm 的 `annot` 名字被占 | 不能 `npm i annot` | 发 scoped 包 |
| 7 | 只有 `master` 分支、无 remote | 别人拿不到 | 建 GitHub 仓库 + push |
| 8 | M4（trace 反投影 + eval）未开始 | 只能判断"图读得准不准"，不能判断"这个 skill 写得好不好" | 见 `docs/02` §8 |

## 目录里有什么

```
src/         引擎（零依赖，零构建，Node 24 直接跑 .ts）
  parse → flow → depth → drift → audit → context → search → render → visual → browser
  fsx        原子写入（临时文件 + fsync + 空文件拒绝 + rename）
  manifest   annotation.json：相对路径 + 源 sha + 产物 sha256
schema/      flow.schema.json（2020-12），6 条契约测试保证它和写出方不脱节
plugin/      DSH 宿主壳（JS，无构建）
  index.js   8 条路由，除自述与临时目录外只读
  client.js  侧边栏行 + 主区页面，经 __ModuleLoader__ 注册
test/        139 个测试，含 30 个插件测试、6 个面板渲染测试、6 个 schema 契约测试、9 个布局测试、4 个分数一致性测试
sandbox/     隔离验收脚本，不碰真实 ~/.agents；m3-experiment.ts 是 M3 验收实验
tools/       人眼工具：inspect（表）/ explain（反查）/ probe-panel（打 GUI）
docs/        01 形态调研 / 02 决策与里程碑 / 03 借用能力对照
```

## 三条不能破的约定

1. **跳过的检查不算通过。** `verify` 找不到浏览器返回 2，报告里写"跳过渲染检查"，测试断言它绝不打印 `✓`。CI 里 2 必须让人看一眼。
2. **二进制产物不能走 utf8 原子写入。** 截图必须走 `atomicWriteBytes(..., 'base64')`。曾经因为这点把 PNG 写成了 base64 文本，文件大小看起来完全正常。
3. **面板不自己实现布局或抽取。** 每一次点击都 exec 同一个 CLI，所以面板和命令行不可能给出不同的图。

## 接下来该做什么（如果只做一件）

**让分叉在真实数据里真的出现。** M3 已证明"改得动"，但图本身还是 19 条单卡带、0 条 `branch` 边——读者看到的是一份编号清单，不是流程。`bestMatch()` 的词重叠阈值 0.5 对中文短句（"守住"/"改良"/"替换"）几乎不可能命中，而这三个词又恰恰是 `grill-method` 唯一的真分支。

具体做法：给节点补一个"分支落点来自哪张表的首列"的抽取规则，把 `守住/改良/替换` 变成三个可连的目标；判据是 `annotate` 的 `forks` 行里 `bound` 从 0 变成 3、`bands` 少于 `nodes`。

这是整个产品最不确定的一环的第二半：**图能画出分支臂只说明"我知道这里断了"，不能说明"我能画出分支"。**
