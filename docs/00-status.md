# 状态：M1 完成、M2 Host 已落地

> 写于 2026-11-16。给下一个接手的人（或下一个会话）看的第一份文件。
> 这里只写"现在是什么"，不写"为什么"。为什么在 `docs/02`。

## 一句话

`annot` 把一份 `SKILL.md` 读成带行锚点的流程图，输出单文件 HTML；改完文件用 `check` 判断图还对不对（exit 0/1）；用 `verify` 判断图画出来了没有（exit 0/1/2）；DSH 里有一个同源面板。

## 现在能跑的东西

```bash
node --test test/*.test.ts test/*.test.js   # 108 个测试，全绿
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

## 三个数字（真实跑出来的，不是估的）

| 指标 | 值 | 来源 |
|---|---|---|
| 整库 skill 数 / 零瑕疵数 | 76 / 16 | `annot audit ~/.agents/skills ~/.dsh/skills` |
| 最烂的 skill | `yapi-sync` 49.0 | 同上 |
| grill-method | 26 节点 / 25 边 / 3 个未绑定分支 | `annot annotate` 的 `forks` 行 |
| challenge | 13 节点 / 12 边 / 0 分支 | 同上 |

## 已知的洞（按严重度）

| # | 洞 | 影响 | 下一步 |
|---|---|---|---|
| 1 | **DSH 面板没有在浏览器里目视确认过** | 路由全部 200、插件 `applied`、`client.js` 过了 vm 测试；但"点侧边栏能不能看到图"没人看过 | **先看 `GET /api/annot/selfcheck`**：`reports` 为空 = bundle 没到页面；有 `apply-enter` 无 `seat-available` = 宿主没声明席位；有 `registered` = 注册成功，问题在往哪看 |
| 2 | 未绑定分支 3 个（grill-method 的 `守住/改良/替换`） | 图的右半边是断的；`audit` 已在计入 | `segment()` 里 `slashArms(m[2])` 没接；需要把表格首列的取值也当分支 |
| 3 | audit 权重没有校准数据 | `×10/×5/×2/×1/×20` 是拍的 | 只当排序用，别再对外讲"评分" |
| 4 | `flow.json` 没有 JSON Schema | 第三方不能独立校验 | 从 `src/types.ts` 生成一份 |
| 5 | npm 的 `annot` 名字被占 | 不能 `npm i annot` | 发 scoped 包 |
| 6 | 只有 `master` 分支、无 remote | 别人拿不到 | 建 GitHub 仓库 + push |

## 目录里有什么

```
src/         引擎（零依赖，零构建，Node 24 直接跑 .ts）
  parse → flow → drift → audit → context → search → render → visual → browser
  fsx        原子写入（临时文件 + fsync + 空文件拒绝 + rename）
  manifest   annotation.json：相对路径 + 源 sha + 产物 sha256
plugin/      DSH 宿主壳（JS，无构建）
  index.js   五个只读路由，每个 exec 一次 CLI
  client.js  侧边栏行 + 主区页面，经 __ModuleLoader__ 注册
test/        105 个测试，含 26 个插件测试、7 个搜索测试、10 个 CLI 测试、8 个产物链路测试
sandbox/     隔离验收脚本，不碰真实 ~/.agents
tools/       人眼工具：inspect（表）/ explain（反查）/ probe-panel（打 GUI）
docs/        01 形态调研 / 02 决策与里程碑 / 03 借用能力对照
```

## 两条不能破的约定

1. **跳过的检查不算通过。** `verify` 找不到浏览器返回 2，报告里写"跳过渲染检查"，测试断言它绝不打印 `✓`。CI 里 2 必须让人看一眼。
2. **二进制产物不能走 utf8 原子写入。** 截图必须走 `atomicWriteBytes(..., 'base64')`。曾经因为这点把 PNG 写成了 base64 文本，文件大小看起来完全正常。

## 接下来该做什么（如果只做一件）

把 `docs/02` §6 的实验做掉：手写 grill-method 的 `flow.json`（25–35 个带锚点节点），试 3 条自然语言修改指令。判据是"≥2/3 只需小改，锚点错位 >30% 即失败"。

这是整个产品最不确定的一环：**如果自然语言改不动这张图，`annot` 就只是个更好看的 `cat`。**
