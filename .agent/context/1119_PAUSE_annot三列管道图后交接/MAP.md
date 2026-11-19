# 导航图：代码地图、命令速查、验证路径

> 任务项 ≥6，所以单独一份。新接手的 AI 用这一份定位"改哪里"。

---

## 1. 代码地图（`src/`，零依赖，Node 直接跑 `.ts`）

```
parse.ts      SKILL.md → 段落/表格/代码块/列表 + heading 栈
   ↓
flow.ts       Unit → FlowNode（16 条分类规则）+ 顺序边 + 分支抽取 + lane + phase + subtitle
   ↓
depth.ts      顺序边最长路径 → 每个节点的深度（= 行号）
   ↓
render.ts     Layout（三列/单列、边路由、phaseRuns、columnHeaders）+ 单文件 HTML + CLIENT_JS
   ↓
visual.ts     真 Chrome CDP 四视口验收（PROBE 探针）
```

旁路：

| 文件 | 职责 |
|---|---|
| `types.ts` | `NodeType` / `Lane` / `NodeFlag` / `FlowNode` / `FlowDoc` / `FlowEdge` 的唯一定义 |
| `drift.ts` | `check`：`moved` / `edited` / `relocated` / `broken` 四档 |
| `audit.ts` | `defectsOf()` 唯一缺陷向量 + 全库排序 |
| `diag.ts` | 形状诊断 5 类：`forks-not-drawn` / `single-column` / `stage-dominated` / `labels-truncated` / `over-split` |
| `context.ts` | 输出"该改哪几行 + 约束"，交给用户自己的 agent |
| `search.ts` | 两层搜索（元数据层 / 正文层，宿主也是分两层读的） |
| `discover.ts` | 扫 skill 目录 |
| `manifest.ts` | `annotation.json`：相对路径 + 源 sha + 产物 sha256 |
| `fsx.ts` | 原子写入（临时文件 + fsync + 空文件拒绝 + rename） |
| `browser.ts` | 找 Chrome/Chromium/Edge，CDP 连接 |
| `index.ts` | 库入口 |
| `cli.ts` | 9 个命令：`annotate` / `check` / `list` / `search` / `audit` / `context` / `render` / `verify` / `version` |

---

## 2. 改布局时先读这几段（`src/render.ts`）

| 符号 | 作用 | 改它会影响 |
|---|---|---|
| `columnOf(type)` | 节点类型 → 三列之一 | 列分配；改这里等于改整个布局的语义 |
| `rowsOf(doc)` | 源顺序 → 行（侧卡挂到前一个核心步骤） | **行规则。branch 边出现时必须重推** |
| `cardGeometry(node, w)` | 单卡的行数/副标题/表格行/臂高 | 所有卡片高度、`verify` 的溢出检查 |
| `COLUMN` 常量 | 420 / 170 / 170 + 间距 26 | 画布宽度 980、侧卡是否撑破 |
| `routeBetween(a, b)` | 同列直落 / 同行直连 / 跨行肘接 | 33 条边的形状 |
| `layoutColumns(doc)` | 主布局 | 表头、导轨、列计数 |
| `layoutStack(doc)` | 无侧卡时退回单列 | 纯步骤文档（如 `challenge` 的线性段） |
| `phaseRuns(placed, spans)` | 阶段带（强/弱） | 7 条带的 y/h/节点数 |
| `renderHtml(doc)` | 产物 + 右侧评估栏 | 整个 HTML 骨架 |
| `CLIENT_JS` | 悬停跟迹 / 缩放 / 查找 / 选中面板 | `sandbox/ui-check.mjs` 的 17 条 |

**几何常量**：`NODE_W=360`、`MIN_CANVAS=900`、`NODE_W_MAX=620`、`LINE_H=19`、`PAD_TOP=34`、`FOOT_H=26`、`ROW_H=15`、`SUB_H=17`、`ARM_H=26`、`SIBLING_GAP=28`、`BAND_GAP=34`、`PAD=40`、`GUTTER=88`、`COLUMN_GAP=26`、`COLUMN_HEADER_H=46`。

---

## 3. 命令速查

```bash
# 抽取 + 出图 + 看报告
node src/cli.ts annotate "D:\Users\zigang.wang\.agents\skills\release-checklist\SKILL.md" --out .sandbox\rc

# 改完 skill 后判断图还对不对（exit 0 同步 / 1 漂移）
node src/cli.ts check ".sandbox\rc\release-checklist\release-checklist.flow.json"

# 只重画（不重新抽取）
node src/cli.ts render ".sandbox\rc\release-checklist\release-checklist.flow.json"

# 真浏览器验收（exit 0 通过 / 1 有问题 / 2 跳过）
node src/cli.ts verify ".sandbox\rc\release-checklist\release-checklist.flow.json" --shot ".sandbox\shots"

# 全库审计
node src/cli.ts audit "D:\Users\zigang.wang\.agents\skills"

# 搜索
node src/cli.ts search "分支" -- "D:\Users\zigang.wang\.agents\skills"
```

退出码口径：`check` 0/1；`verify` **0/1/2，2 是"跳过"，永远不算通过**。

---

## 4. 验证路径（改完必须全跑，缺一条不算完成）

| # | 命令 | 期望 | 耗时 |
|---|---|---|---|
| 1 | `npm test` | 157 全绿 | ~6s |
| 2 | `bash sandbox/run.sh` | 7 段 17 条全绿 | ~30s |
| 3 | `node sandbox/all-skills.mjs` | 五份 skill 各 4 视口 `✓` | ~40s |
| 4 | `node sandbox/ui-check.mjs <release-checklist.html>` | 17/17 | ~10s |
| 5 | 目视：`sandbox/work/all/release-checklist/release-checklist.html` | 三列对齐、表头有计数、悬停有跟迹 | 人工 |

单份快速回归（实测条数）：
```bash
node --test "test\layout.test.ts"        # 12 条，几何不变式：列是真列、无回头边、无重叠、退回单列
node --test "test\card.test.ts"          # 10 条，卡片契约：围栏标签/JSON 键/lane/phase/subtitle/rule
node --test "test\plugin-client.test.js" # 14 条，面板与产物同源（cardH/rows/arms/subLines/phaseRuns/columnHeaders）
node --test "test\score.test.ts"         # 4 条，一套分数：audit ≡ defects，rail = 100 − audit
node --test "test\render.test.ts"        # 3 条，客户端脚本在桩 DOM 里能跑通并画卡
node --test "test\visual.test.ts"        # 7 条，四视口口径 + 跳过不算通过
node --test "test\schema.test.js"        # 6 条，schema 与写出方不脱节
```

全量分布（157 = 104 TS + 53 JS）：

| TS（104） | 条 | | JS（53） | 条 |
|---|---|---|---|---|
| annot | 14 | | plugin-host | 15 |
| layout | 12 | | plugin-client | 14 |
| cli | 10 | | package | 6 |
| card | 10 | | panel-render | 6 |
| context | 8 | | schema | 6 |
| manifest | 8 | | plugin-routes | 3 |
| search | 7 | | tools | 3 |
| visual | 7 | | | |
| audit / fsx | 6 / 6 | | | |
| shapes | 5 | | | |
| diag / score | 4 / 4 | | | |
| render | 3 | | | |

---

## 5. 沙箱脚本速查（`sandbox/`，被 git 忽略，换机器要重生成）

**这是本项目最有价值的方法论资产**：每个"到底该怎么画"的判断都先写一个量测脚本，再改代码。别跳过这一步直接用眼睛调。

| 脚本 | 量什么 |
|---|---|
| `all-skills.mjs` | 五份 skill 的 annotate → render → verify 一遍，打印读数 |
| `ui-check.mjs` | 交互 17 条断言（悬停/缩放/查找） |
| `node-kinds.mjs` | 类型×泳道交叉表 |
| `band-adaptive.mjs` | 永远三列 vs 按行自适应的画布高度对比 |
| `row-rule.mjs` | 验证"侧卡挂到前一个核心步骤"这条行规则 |
| `edge-shapes.mjs` | (列→列) × (行差) 交叉表 |
| `band-edges.mjs` | 侧卡边是否跨出阶段带 |
| `column-feasible.mjs` | 981px 图区里各列宽度的可行分配 |
| `overflow-detail.mjs` | 哪张卡的哪段文字真的溢出了（逐个 `getBBox`） |
| `out-of-bounds.mjs` | 哪张卡出了画布 |
| `tallshot.mjs` | 整页长截图（1020×3800） |
| `layout-info.mjs` | 从产物 HTML 里读 layout JSON，打印画布/行数/阶段带 |
| `search.mjs` / `search-gh.mjs` | `web_search` 402 时的替代调研通道 |
| `run.sh` | 隔离验收（7 段 17 条），含"沙箱外无改动"断言 |

---

## 6. 依赖关系（改 A 必须同时看 B）

```
src/flow.ts ──→ src/types.ts        （新增字段两边同步）
   │
   ├──→ schema/flow.schema.json     （test/schema.test.js 6 条会抓漏）
   │
   └──→ src/render.ts ──→ src/visual.ts （PROBE 依赖 DOM 结构）
                │
                └──→ plugin/client.js  （必须画同一张卡，test/plugin-client.test.js 钉住）
                              │
                              └──→ plugin/index.js 路由
                                        │
                                        └──→ src/cli.ts （路由不自己实现，只 exec CLI）
```

**结论**：动 `FlowNode` 的字段 → 至少改 5 个文件（types / flow / render / schema / plugin client），并跑全量测试。
