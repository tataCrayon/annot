# 状态：M1 完成、M2 可用（面板已确认真实渲染）

> 写于 2026-11-18。给下一个接手的人（或下一个会话）看的第一份文件。
> 这里只写"现在是什么"，不写"为什么"。为什么在 `docs/02`。

## 一句话

`annot` 把一份 `SKILL.md` 读成带行锚点的流程图，输出单文件 HTML；改完文件用 `check` 判断图还对不对（exit 0/1）；用 `verify` 判断图画出来了没有（exit 0/1/2）；DSH 里有一个同源面板，能在图上看、能搜、能把"该改哪几行"交给你自己的 agent。

## 现在能跑的东西

```bash
node --test test/*.test.ts test/*.test.js   # 121 个测试，全绿
bash sandbox/run.sh                          # 7 段隔离验收，17 条断言，全绿
node src/cli.ts annotate <skill-dir> --out <dir>
node src/cli.ts search <词> -- <root...>
node src/cli.ts check <flow.json>
node src/cli.ts verify <flow.json> --shot <dir>
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

## 面板的可观测性（这是这一轮真正补上的东西）

面板"没出现"有三种完全不同的原因，而在宿主侧它们长得一模一样。`GET /api/annot/selfcheck` 一次把它们分开：

| 你看到的 | 含义 |
|---|---|
| `composed.registered: false` | 这个包没被编进 `__DSH_BOOT__` 的模块图 |
| `reports: []` | 编进去了，但浏览器半边从没执行 |
| 有 `apply-enter`、无 `seat-available` | 执行了，但宿主没声明 `sidebar.panellist` 这个席位 |
| 有 `registered` | 注册成功 |
| 有 `panel-mounted` | **有人真的打开过这个面板**，链路全通 |

`composed` 直读宿主的 `clientModules` 服务，并给出确切的 bundle URL（形如 `plugins/??annot-dsh/client.js&rev=<hash>`，rev 由 client.js 的 mtime/ctime/size 算出）。

## 已知的洞（按严重度）

| # | 洞 | 影响 | 下一步 |
|---|---|---|---|
| 1 | 未绑定分支 3 个（grill-method 的 `守住/改良/替换`） | 图的右半边是断的；`audit` 已在计入 | 把表格首列的取值也当分支枚举 |
| 2 | 面板不缓存、不做逐节点漂移比对 | 它告诉你"这份图对应哪个 sha"，但不会把改过的节点标红 | 「改了就红」目前只有 `annot check` 能做 |
| 3 | audit 权重没有校准数据 | `×10/×5/×2/×1/×20` 是拍的 | 只当排序用，别对外讲"评分" |
| 4 | 低置信节点未裁决 | grill-method 3 个 55%、challenge 2 个 55% | 逐个人工确认后写 sidecar |
| 5 | npm 的 `annot` 名字被占 | 不能 `npm i annot` | 发 scoped 包 |
| 6 | 只有 `master` 分支、无 remote | 别人拿不到 | 建 GitHub 仓库 + push |
| 7 | 未做 M3（自然语言 patch 评测） | 「用自然语言改」只有上下文交接，没有产出 diff 的评测 | 见下 |

## 目录里有什么

```
src/         引擎（零依赖，零构建，Node 24 直接跑 .ts）
  parse → flow → drift → audit → context → search → render → visual → browser
  fsx        原子写入（临时文件 + fsync + 空文件拒绝 + rename）
  manifest   annotation.json：相对路径 + 源 sha + 产物 sha256
schema/      flow.schema.json（2020-12），6 条契约测试保证它和写出方不脱节
plugin/      DSH 宿主壳（JS，无构建）
  index.js   8 条路由，除自述与临时目录外只读
  client.js  侧边栏行 + 主区页面，经 __ModuleLoader__ 注册
test/        121 个测试，含 30 个插件测试、6 个面板渲染测试、6 个 schema 契约测试
sandbox/     隔离验收脚本，不碰真实 ~/.agents
tools/       人眼工具：inspect（表）/ explain（反查）/ probe-panel（打 GUI）
docs/        01 形态调研 / 02 决策与里程碑 / 03 借用能力对照
```

## 三条不能破的约定

1. **跳过的检查不算通过。** `verify` 找不到浏览器返回 2，报告里写"跳过渲染检查"，测试断言它绝不打印 `✓`。CI 里 2 必须让人看一眼。
2. **二进制产物不能走 utf8 原子写入。** 截图必须走 `atomicWriteBytes(..., 'base64')`。曾经因为这点把 PNG 写成了 base64 文本，文件大小看起来完全正常。
3. **面板不自己实现布局或抽取。** 每一次点击都 exec 同一个 CLI，所以面板和命令行不可能给出不同的图。

## 接下来该做什么（如果只做一件）

把 `docs/02` §6 的实验做掉：手写 grill-method 的 `flow.json`（25–35 个带锚点节点），试 3 条自然语言修改指令。判据是"≥2/3 只需小改，锚点错位 >30% 即失败"。

这是整个产品最不确定的一环：**如果自然语言改不动这张图，`annot` 就只是个更好看的 `cat`。** 现在 `context` 路由 + 面板的「生成改写上下文」已经把这一步的门槛降到"复制、粘贴给 agent"，但还没测过改完的结果。
