# 贡献指南

`annot` 是一个小工具，它只有一条卖点值得守住：**图上的每个方块都能指回源文件的若干行，并且那几行的哈希说了算。** 任何改动如果削弱这条，就不该合。

## 开始前

```bash
node --test test/*.test.ts test/*.test.js   # 301 个测试
bash sandbox/run.sh                          # 7 段隔离验收，不碰真实 ~/.agents
```

要求 Node ≥ 22.18（原生 TypeScript 类型剥离）。**没有构建步骤，没有运行时依赖**，这不是省事，是刻意的：`node src/cli.ts` 跑的就是发布出去的东西。

## 提交前必须过的四关

1. **测试全绿**，包括为这次改动新加的那条。修 bug 先写一条会红的测试，再修。
2. **沙箱全绿**。`sandbox/run.sh` 在 `sandbox/work/` 里造一份假 skill 库，最后一段会验证"沙箱之外一个字节都没动"。如果你的改动要写文件，这条会先抓住你。
3. **不破坏两条硬约定**：
   - 跳过的检查不算通过。`verify` 找不到浏览器返回 `2`，报告写"跳过渲染检查"。任何让 `2` 看起来像成功的变化都不接受。
   - 二进制产物不走 utf8 原子写入。截图必须走 `atomicWriteBytes(..., 'base64')`。曾经把 PNG 写成 base64 文本，文件大小看着完全正常。
4. **文档与代码同步**。改了 `flow.json` 的字段就改 `schema/flow.schema.json`（`test/schema.test.js` 会盯住字段与枚举）；改了路由就改 `plugin/docs/DETAIL.md` 与 README 的路由表。

## 改抽取规则（`src/flow.ts`）时

这是全项目最容易悄悄变坏的地方。改之前先跑：

```bash
node src/cli.ts audit ~/.agents/skills ~/.dsh/skills
```

记下三个数字：skill 总数、零瑕疵数、未绑定分支总数。改完再跑一次，把你的变化写进 commit message。**判断抽取好坏靠的是这三个数字，不是某一次看着顺眼。**

两条已知的失败模式：

- **把规则当成分支**。`禁止…` 是作者在设限，不是在分叉。曾经 18 条 yapi 铁律被读成 18 个分支，全库 75 条未绑定分支里 53 条是这类噪音。
- **把条件句当成分支**。`如果文件不存在，则询问用户` 是在描述这个步骤的行为，不是在给图分叉。只有 `decision` / `gate` 节点才该长出分支。

## 改面板（`plugin/`）时

面板是外壳，不是第二套实现。**面板里不许出现布局算法或抽取逻辑**——每一次点击都应该 exec 同一个 CLI，否则两边迟早给出不同的图，而这个 bug 只有用户能发现。

面板有三层测试，别只跑第一层：

| 层 | 文件 | 抓什么 |
|---|---|---|
| 源码契约 | `test/plugin-client.test.js` | 注册 id、`inject` 声明、路由不带前导斜杠、没有 `font:` 简写里塞 `inherit` |
| 宿主路由 | `test/plugin-host.test.js` | 每条路由的入参校验、loopback 围栏、跨站伪造 |
| 真渲染 | `test/panel-render.test.js` | 用最小 hook 运行时把组件树真的画一遍；首帧不抛、列得出 skill、挂载会上报 |

第三层是最有价值的：它抓的是"注册成功了但画不出来"，这个状态在宿主侧完全静默。

## commit message

由 git hook 硬门禁：必须以 `AI: ` 开头，只写功能变动，不写对话口吻与过程汇报。被拦就改消息，**不要用 `--no-verify` 或 `GIT_COMMIT_SKIP_AI_GATE=1` 绕过**。

## 什么不该合

- 让面板自己调模型。面板没有 key，也不该有；改由用户自己的 agent 做，`context` 命令负责给出"改哪几行"。这条把爆炸半径锁在行级。
- 引入第二个布局实现（比如在浏览器里重算坐标）。服务端算好的布局是唯一的。
- 把 `flow.json` 的 `anchor.sha` 换成"行号对得上就算没变"。行号会漂，哈希不会。
- 加一个"看起来像能跑"的可选依赖。零依赖是发布体积与可移植性的来源。

## 问题与想法

先看 [`docs/00-status.md`](docs/00-status.md) 的"已知的洞"——那里列着当前最该做的事，按严重度排。产品形态为什么不这样做，在 [`docs/02`](docs/02-form-decision-one-engine-two-shells.md)；哪些能力是借的，在 [`docs/03`](docs/03-prior-art-and-borrowed-capabilities.md)。
