# Annot

**给任意 skill 做标注。** 侧边栏出现一个 Annot 面板，左边选 skill，右边看它被读成了什么。

这个插件是 `annot` 的宿主外壳，不是第二套实现：面板里每一次点击都调用同一个 CLI，所以面板和命令行不可能给出不同的图。

---

## 它回答三个问题

| 你想知道 | 面板怎么答 |
|---|---|
| 这个 skill 到底在教什么流程？ | 每个方块是一段**连续原文**，角标 `L12–18` 是它的行范围，右侧显示原文与所属小节 |
| 我改完 SKILL.md，图还对吗？ | 顶栏显示生成时的 `sha` 前 10 位与读取时刻；点「刷新」重新读取。命令行 `annot check` 给出 0/1 |
| 我的库里哪些 skill 被读错了？ | 「审计」页给出加权分数，**最差的排最前**，点一行直接打开它 |

> 已知限制：面板里的图是**每次打开时重新抽取**的，不缓存，也不做逐节点漂移比对——所以它告诉你"这份图对应哪个 sha"，但不会把改过的节点标红。「改了就红」目前只有 `annot check` 能做。

---

## 面板

侧边栏一块，答三层"找":

- **列表**：宿主读到的每个 skill，按 name 排序。
- **搜索**：输入即搜，`name / 描述 / 标题` 三个字段。点一次右上角按钮切到 **正文**，会多搜全文——命中更多、也更慢，所以默认关。
- **打开**：点一个名字，主区出图。

搜索底部会写明这一屏是"76 个 skill"还是"3 个匹配（名称·描述·标题）"。**"没有匹配"和"没有 skill"必须长得不一样**，否则看的人会以为某个 skill 丢了。

- **流程图**：方块按类型着色（阶段 / 判定 / 门禁 / 产物 / 外部调用），顶部有图例；实线是文中顺序，橙色虚线是作者写明的分支（`→`、`✅/❌`、`守住 / 改良 / 替换`）。方块右上角的黄色角标 = 未绑定分支数；橙色圆点 = 这个节点本身置信度低于 60%。方块可用 Tab 聚焦、回车打开。
- **审计**：分数越高说明抽取结果越差；`低置信` 是低于 60% 的节点数，`未绑定` 是分支没落到具体方块，`空标签` 是标签为空。点一行直接打开那个 skill。
- **右侧详情**：类型、置信度、锚点、行哈希、小节、分支、原文。
- **自然语言改**：选中一个节点后点「生成改写上下文」，拿到这段的**精确行范围 + 原文 + 约束**，一键复制给你的 agent。面板自己不改文件、不调模型——改由你自己的 agent 做，`annot check` 判定改对没改对。

> 为什么面板不直接改：它没有模型，也不该有。真正稀缺的是"到底改哪几行、改的时候不能动什么"，这部分由 CLI 精确给出；剩下那步本来就是你 agent 的强项。

---

## 路由

八条路由（`report` 是写，只收页面自己的自述），全部限制在 loopback：

| 路由 | 作用 |
|---|---|
| `GET api/annot/status` | CLI 是否可用，扫描哪些根目录 |
| `GET api/annot/selfcheck` | 浏览器半边声明了什么、入口文件在不在、页面报告过什么 |
| `POST api/annot/selfcheck/report` | 页面自述（`apply-enter` / `seat-available` / `registered` / `register-failed` / `panel-mounted`） |
| `GET api/annot/list[?fresh=1]` | 按宿主同样的 rank 规则列 skill；`fresh=1` 丢弃扫描缓存 |
| `GET api/annot/search?q=<text>[&body=1]` | 搜 skill。默认只搜 **name / 描述 / 标题**；`body=1` 才搜正文 |
| `GET api/annot/flow?path=<SKILL.md>` | 抽取一张图（含服务端算好的布局） |
| `GET api/annot/audit?limit=<n>` | 整库审计（`total`/`clean` 是全库的，只有表格被截断） |

`selfcheck` 回答的是"面板为什么不出现"这个最难查的问题。四种状态分得开：

- `reports` 为空 → **浏览器半边根本没加载**（bundle 没到页面）。查 `dsh.client` 声明与 `exports["./client"]`。
- 有 `apply-enter` 没有 `seat-available` → 加载了，但宿主没声明 `sidebar.panellist` 这个席位。
- 有 `seat-available` 和 `registered` → 注册成功了，问题在"用户往哪看"。
- 有 `panel-mounted` → **有人真的打开过这个面板**，链路全通。

`composed` 字段来自宿主的 `clientModules` 服务：`registered: true` 表示这个包已经编进 `__DSH_BOOT__` 的模块图，并给出它确切的 bundle URL 与 rev。`registered: false` 且 `client.platform === 'web'` 才是真正的"编不进去"。

```bash
curl -s http://127.0.0.1:<port>/api/annot/selfcheck
```

`annotate` 写进用户 skill 树的那条路**不在路由里**：一个能重写 skill 产物的 web 路由权限远大于一个只读面板。唯一的写是写到面板自己的临时目录（`/tmp/annot-panel/…`），因为出图必须先有 flow.json。

`?path=` 只接受**当前扫描结果里出现过的** `SKILL.md`；任意路径会退化成文件读取原语。`context` 路由同样先过这道检查。

---

## 配置

在 profile 的 `cordis.patch.yml` 里改这一行即可（默认值如下）：

```yaml
- id: annot
  name: 'annot-dsh'
  config:
    cli: annot              # annot 可执行文件；没装就指向仓库里的 src/cli.ts
    cliNodeArgs: []         # 用 node 直接跑 .ts 时填 ["<repo>/src/cli.ts"]
    home: null              # 默认从 DSH_HOME 推断
    cwd: null               # 默认 process.cwd()
```

依赖：一个可运行的 `annot`。面板起不来时它会明说"还没装好"，而不是空白。

---

## 已知限制

- 只读。在面板里改 skill、改 sidecar 都还没有。
- 每次打开一个 skill 会跑一次 `annotate`（写临时目录）。26 个节点的 skill 约 200ms；点击后第一次可能更慢，因为要先做一次全库扫描（缓存 10 秒，点「刷新」可强制丢弃）。
- 布局是服务端算好的确定性网格，不是交互式拖拽图；图大了要在画布里平移。
- 不做逐节点漂移比对：面板显示这份图对应的源文件 sha，但不会把改动过的节点标红。那需要 `annot check`。
