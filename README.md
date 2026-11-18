# annot

**给任意 Skill 做标注。** 把一份 `SKILL.md` 变成带源码锚点的流程图，能看、能审、能被自然语言改。

> 状态：v0.1（可用。`annotate` / `check` / `list` / `search` / `audit` / `context` / `verify` / `render` 八个命令，132 个测试 + 7 段沙箱验收全绿）

---

## 为什么不是又一个"Skill 可视化"

现有的 Skill 可视化工具（见 [skillscope](https://github.com/silvesterdivas/skillscope)）从 markdown 里**猜** triggers 和 branches。猜出来的图不可复现、不可 diff、改完不知道哪里变了。

annot 的差别只有一件事：**每个节点都锚死在 SKILL.md 的具体行上，并且记住那几行的哈希。**

```
node.anchor = { heading: [...], start: 65, end: 72, sha: "a3f1…" }
```

这让三件以前做不到的事成为可能：

1. **判断"这个 skill 对吗"**：图上的每个框都能点回原文，不用再猜是哪个段落教的。
2. **判断"我改对了吗"**：`annot check` 拿新文件重新算哈希，报"哪几个节点漂移了、移到哪一行"。没改的节点一定不报——这是它可信的唯一理由。
3. **用自然语言改**：锚点给定行范围，改一句话就只动那几行，不会整篇重写。

---

## 快速开始

```bash
# 标注一个 skill（默认写到 <skill>/.annot/<name>/）
node src/cli.ts annotate path/to/my-skill

# 得到两个文件
#   .annot/my-skill/my-skill.flow.json   ← 数据，可进 git
#   .annot/my-skill/my-skill.html        ← 单文件，双击即开，无网络无依赖

# 改完 SKILL.md 后检查锚点是否还成立
node src/cli.ts check path/to/my-skill/.annot/my-skill/my-skill.flow.json
```

`check` 的退出码就是结论：`0` 全部同步，`1` 有漂移（并逐条列出 `node id`、`moved 65 → 67` 或 `broken`）。

```bash
# 列出某个根目录下所有 skill（按 name 去重，低 rank 优先）
node src/cli.ts list ~/.agents/skills ./.agents/skills

# 批量体检：哪些 skill 抽得不好
node src/cli.ts audit ~/.agents/skills ./skills --limit 15

# 让 agent 改某个节点：交出精确行范围 + 原文 + 约束
node src/cli.ts context .annot/my-skill/my-skill.flow.json n-state
```

`audit` 是产品命令而不是开发工具——"我的哪个 skill 渲染得不对"本来就是这个工具要回答的问题。
它按加权分排序（空标签 ×10、空正文 ×5、未绑定分支 ×2、低置信 ×1、过拆密度），并把 0 分澄清单列出来：

```
36 个 skill，2 个零瑕疵

 score  nodes  low  unres  junk  skill
  13.0     19    1      6     0  comprehension-ledger
  10.0     77    4      3     0  spec-verifier
```

`context` 是"用自然语言改"这一环的接缝。annot 自己不调模型——**宿主 agent 就是模型**，它缺的不是理解力，而是"该动哪几个字节"。所以这里只交三样东西：精确到行的原文、前后邻居、以及防止图被改坏的硬约束（不改范围外、不动标题、不插前置空行）。

```
## 原文（请在此基础上改）
> Treat every method as guilty until proven deliberate and superior. …

## 约束
- 只改第 13–15 行（1-based，含首尾）。
- 不要改动本范围之外的任何行…
- 这是门禁节点：保留命令式语气与"必须/禁止"这类硬约束词，不要改写成建议。
```

---

## 它怎么读一个 Skill

四层，每层只做一件事，**全部确定性**——不调模型，所以同一份文件永远得到同一张图。

| 层 | 做什么 | 不做什么 |
|---|---|---|
| `parse` | 切 frontmatter、标题、连续单元；保留 1-based 绝对行号 | 不猜语义 |
| `segment` | 把围栏里的流水线（`STATE — …` / `A → B → C`）拆成一节点一行 | 不拆普通代码块 |
| `flow` | 给每个单元定类型（阶段/判定/门禁/产物/外部调用）+ 置信度 + 分支 | 不假装确定 |
| `drift` | 按行哈希判死/活，就近重定位，报 `moved`/`broken` | 不静默重解析 |

类型判定是有规则的猜测，所以每个节点都带 `confidence` 和 `flags`。低于 60% 的进"待确认"清单——**机器不确定的地方，图上看得见**。

---

## 校准：`annot.sidecar.json`

机器猜错时不用改代码，在 skill 目录放一个 sidecar：

```json
{
  "skill": "my-skill",
  "nodes": [
    { "anchor": { "start": 65 }, "type": "gate", "rename": "人工确认" },
    { "label": "附录", "ignore": true },
    { "anchor": { "start": 61 }, "branches": [{ "when": "守住" }, { "when": "改良" }, { "when": "替换" }] }
  ]
}
```

- `anchor.start` 或 `label` 二选一定位
- `ignore` 直接把它从图里去掉
- `confirm` 把置信度提到 1，标记为人工确认
- 覆盖会写进 `source: "sidecar"`，可追溯到"这是人改的，不是猜的"

---

## 隔离测试

本仓库自带一个**不碰你真实 `~/.agents`** 的沙箱：

```bash
bash sandbox/run.sh
```

它做七件事，任何一步失败就非 0 退出：

1. 在 `sandbox/work/` 造一个假 HOME 和假 skill 根（4 个 skill，含一个故意含糊的）
2. 用这个假根跑 `list` / `annotate` / `check` / `render`
3. 篡改被标注的 SKILL.md（插 3 行、删 1 个节点），验证 `check` 准确报出 `moved` 和 `broken`
4. 用真实浏览器跑 `verify`：干净页面必须过；**把客户端脚本删掉后必须失败**（否则整个检查可能一直在返回常量 pass）
5. 跑整库 `audit`，断言**最差的排第一**
6. 断言整个过程**没有写过沙箱以外的任何路径**（对比运行前后的文件清单）

想用自己的 skill 试，但不污染全局，也可以只指到假根：

```bash
node src/cli.ts annotate sandbox/work/skills/flow-demo --out sandbox/work/out
```

---

## 渲染验收：`annot verify`

"能编译"、"能跑"、"画出来了"是三件不同的事。截图只能证明第三件事的一小部分——它证明不了标签有没有溢出卡片、页面有没有偷偷发请求、脚本在第一帧之后有没有抛异常。

```bash
annot verify .annot/my-skill/my-skill.flow.json
```

退出码就是结论：`0` 通过，`1` 有问题，`2` **跳过**（本机没有浏览器——跳过绝不会被报成通过）。

它在真实的 Chrome/Chromium/Edge 里跑三个视口（1440×900 / 1600×1000 / 1920×1080），检查：

| 检查 | 为什么是它 |
|---|---|
| 每个视口的节点数 == `flow.json` 的节点数 | 脚本没执行时页面"看起来"正常，只是空的 |
| 同一个节点没有画两遍 | 重复 id 在图上表现为两个框，肉眼很难数出来 |
| 标签没有溢出卡片 | 360px 卡片 + 中文，溢出是常态 |
| 卡片没有画到画布外 | 布局算错时边缘的框会消失 |
| 文档没有横向滚动条 | 有横向滚动说明窗口尺寸被写死 |
| 页面没有发起任何网络请求 | 单文件自包含的唯一硬证据 |
| 没有未捕获异常 / console error | 编译通过不代表运行不炸 |

```
✓ grill-method.html: 3 个视口
   1440×900   no-hscroll  graph 1278>1056 (pans)  26 nodes
   1600×1000  no-hscroll  graph 1278>1216 (pans)  26 nodes
   1920×1080  no-hscroll  graph fits  26 nodes
```

`graph … (pans)` 是**信息不是错误**：26 个节点的图在 1440 宽里本来就要平移查看（画布本身是 `overflow:auto` 的）。真正会判失败的是文档级横向滚动、节点数不符、溢出、网络请求。

抓一张截图：`annot verify … --shot ./shots`，会按视口写出 `1440x900.png` 等三张。

零依赖：直接用 Node 内置的 `WebSocket` 讲 CDP，不装 Puppeteer。浏览器路径自动探测，也可以用 `ANNOT_CHROME` 指定。

---

`flow.json`（`schema_version: 1`）——入库、可 diff、可作为回归 fixture。

```jsonc
{
  "skill": "...",
  "source": { "file": "SKILL.md", "sha": "…", "lines": 141 },
  "nodes": [{ "id": "n-state", "type": "stage", "label": "…", "raw": "…",
              "anchor": { "heading": ["…"], "start": 59, "end": 59, "sha": "…" },
              "branches": [], "confidence": 0.85, "source": "extractor", "flags": [] }],
  "edges": [{ "from": "n-a", "to": "n-b", "kind": "sequence" }],
  "stats": { "byType": {}, "lowConfidence": 0, "stale": 0, "maxDepth": 3 }
}
```

`raw` 存原文，是为了**漂移时能重新定位**——只存哈希的话，行一动就只能报 `broken`。

---

## 命令

| 命令 | 作用 |
|---|---|
| `annot annotate <dir\|SKILL.md>` | 产出 `flow.json` + `html` + `annotation.json`（原子写入） |
| `annot check <flow.json>` | 对比当前 SKILL.md，报漂移；exit 0/1 |
| `annot list <root...>` | 列 skill，同名按 rank 去重 |
| `annot search <query...> -- <root...>` | 按名字/描述/标题找 skill，`--body` 加搜正文 |
| `annot audit <root...>` | 批量体检，按"抽得有多差"排序 |
| `annot context <flow.json> <node-id>` | 交出编辑所需的精确切片与约束 |
| `annot verify <flow.json\|html>` | 真浏览器验收；exit 0/1/2（2 = 跳过） |
| `annot render <flow.json>` | 只重渲染 HTML |

`annotate` 会额外写一个 `annotation.json`：记录源文件路径（**相对清单自身**，所以产物目录可以整个搬走）、生成时的源哈希、以及每个产物的字节数与 sha256。`check` 靠它精确找回源文件——早先版本靠 `../SKILL.md` 猜，用 `--out` 就一定猜错。

### 搜索分两层，因为宿主也是分两层读的

```bash
annot search 审计 -- ~/.agents/skills          # 默认：name · 描述 · 标题
annot search 审计 --body -- ~/.agents/skills   # 加搜正文
```

宿主每轮只把 `name` + `description` 摆给模型，正文要等模型**已经决定**打开才读。所以默认层命中的是"模型本来就能看到的信息"，而正文命中是"模型必须先知道答案才能看到的"——两层混在一起报，等于假装工具知道得比模型多。`--body` 是显式选择，报告里会写明这一屏搜的是哪一层。

查询按 **AND** 拆词：`审计 Agent` 只返回两个词都命中的 skill。改成 OR 的话，四十个结果和没有搜索是一样的。全部匹配逻辑是确定性字符串包含，不 stemming、不模糊距离、不调模型——同一个查询永远给同一份结果，这是搜索结果敢放到评审面前的前提。

---

## DSH 插件壳：`plugin/`

命令行之外，同一个引擎还有一块宿主内的面板。`plugin/` 是一个 DSH bundle：Host 半边注册路由，Client 半边在侧边栏注册一个 `Annot` 面板 + 主区页面。

```bash
# 本机安装（profile 里会多一行 bundle）
dsh plugin --profile <profile> add <repo>/plugin
# 或在 GUI 的 Plugins 页面点 Add plugin 选这个目录
```

装上之后：侧边栏出现 **Annot** → 搜索框打 `审计` → 点结果 → 右边看到同一张图、同一份锚点、同一份置信度。

它**不是第二套实现**：面板每一次点击都会 exec 一次同一个 `annot` 命令行，所以两边不可能给出不同的图。这是"一个引擎、多个外壳"能被验证的唯一形式。路由：

| 路由 | 作用 |
|---|---|
| `GET api/annot/status` | CLI 是否可用、扫描哪些根 |
| `GET api/annot/selfcheck` | 浏览器半边声明与自述（面板不出现时先看这个） |
| `POST api/annot/selfcheck/report` | 页面自述：`apply-enter` / `seat-available` / `registered` / `register-failed` / `panel-mounted` |
| `GET api/annot/list[?fresh=1]` | 按宿主同样的 rank 规则列 skill |
| `GET api/annot/search?q=<text>[&body=1]` | 搜 skill；默认不搜正文 |
| `GET api/annot/flow?path=<SKILL.md>` | 一张图（含服务端算好的布局） |
| `GET api/annot/context?path=<skill>&node=<id>` | 这个节点的精确行范围 + 原文 + 改写约束（面板里「生成改写上下文」用的就是它） |
| `GET api/annot/audit?limit=<n>` | 整库审计（总分是完整的，只有表格被截断） |

八条路由都限制在 loopback（含 `X-Forwarded-For` 一律拒绝、`sec-fetch-site: cross-site` 拒绝、foreign `Origin` 拒绝）。`?path=` 只接受**当前扫描结果里出现过的** `SKILL.md`——否则这个路由就退化成一个任意文件读取原语。`annotate` 写进用户 skill 树的那条路**不在路由里**；唯一的写是写到面板自己的临时目录，因为出图必须先有 flow.json。

`plugin/` 有 30 个测试 + 6 个面板渲染测试，包括"路由真的驱动了真 CLI"、"扫描范围外的路径必须 422"、"被取代的响应不能覆盖更新的"、"报告路由不接受跨站伪造"、"面板首帧不抛且列得出 skill"。

`selfcheck` 的存在理由：面板"没出现"有三种完全不同的原因，而它们在宿主侧长得一模一样。`reports` 为空 = bundle 没到页面；有 `apply-enter` 无 `seat-available` = 宿主没声明席位；有 `registered` = 注册成功；有 `panel-mounted` = 有人真的打开过。`composed` 字段直读宿主的 `clientModules` 注册表，给出这个包是否已编入 `__DSH_BOOT__` 以及确切的 bundle URL。

---

## 设计约束（故意不做的事）

- **不调模型**。一旦依赖模型，"图变了" 就再也分不清是"文件变了"还是"模型这次心情不同"。
- **不做 eval 引擎**。要用 [skill-eval-harness](https://github.com/adewale/skill-eval-harness) 那种配对因果增益，接它，别在这重写。
- **不做 skill CRUD**。DSH 已有 `@linxin666/dsh-client-ui-skill-explorer` 干这个。
- **不常驻进程**。CLI 是被调用的，不是被守护的。
- **不自己实现浏览器协议栈**。用 Node 内置 `WebSocket` 讲 CDP，不引入 Puppeteer/Playwright 那样的几百 MB 依赖——但也不假装"截图=验过"。

哪些能力是借的、哪些是原创的，逐条对照在 [`docs/03-prior-art-and-borrowed-capabilities.md`](docs/03-prior-art-and-borrowed-capabilities.md)。

---

## 开发

```bash
node --test test/*.test.ts test/*.test.js   # 132 个测试，当前 Node 24+ 原生跑 .ts，无需构建
bash sandbox/run.sh                          # 7 段隔离验收，不碰真实 ~/.agents
node tools/inspect.ts <flow.json> --branches # 人眼看抽取结果（行号/类型/置信度/id/分支）
node tools/explain.ts <SKILL.md>             # 从源文件反看抽取结果
node tools/probe-panel.ts                    # 打开运行中的 GUI，报告面板是否可见
node tools/slot-usage.ts                     # 谁占了哪个宿主槽位
node tools/panel-orders.ts                   # 侧边栏各面板的 order，重排前先看
```

要求 Node ≥ 22.18（原生 TypeScript 类型剥离）。无构建步骤、零运行时依赖。

`verify` 需要本机有 Chrome / Chromium / Edge 之一；找不到就返回 2（跳过），测试套件里相应的用例也会 skip 而不是假通过。

MIT.
