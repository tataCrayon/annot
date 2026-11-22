# annot Codex 插件与本地网页

## 1. Proposal

**用户故事**：作为使用 Codex、DSH 或普通浏览器的 Skill 作者，我想用同一份 annot 引擎查看 Skill 流程、发现结构问题并拿到精确改写上下文，这样我能在自己的 Agent 中有依据地调整 Skill。

**为什么**：目前有 CLI、DSH 面板和可离线打开的单 Skill HTML，但没有 Codex 插件包，也没有可浏览 Skill 库的独立网页入口。当前布局验收也没有真实落地的分叉边。

**成功标准**：Codex 能通过插件内 Skill 调用 annot CLI；用户可显式启动本地网页后浏览、搜索和审计本地 Skill；所有入口显示同一套带锚点的图；访问只绑定 loopback，Skill 原文不被网页修改。

**边界**：继续只读 Skill 原文；不做 CRUD、LLM 改写、远程托管或新建第二套抽取/布局；保留 DSH 外壳；不依赖 Codex 嵌入 MCP Apps UI。

**方案取舍**：

| 选项 | 做法 | 取舍 |
|---|---|---|
| ①（推荐）共享 CLI/Core + Codex skill-only 插件 + 显式启动的 loopback 网页 | Codex 插件声明 desktop local execution 并调用已安装 CLI；网页由 Node 内置 HTTP 服务提供列表/API，流程 HTML 由现有 renderer 生成 | 不增加 MCP SDK 或构建系统；网页不会自行读取任意路径；需先安装 CLI，并主动启动网页 |
| ② Codex 插件内置本地 MCP server + 可选 MCP App | MCP server 直接返回图与 UI | 多一套协议/依赖和打包路径；公开提交本地 MCP 还有额外准入条件；当前不需要这些能力 |
| ③ 只给每份 Skill 生成离线 HTML | 双击单文件看图 | 已经存在，不能满足搜索和整库审计 |

**当前决定**：用户明确要求在 DSH 插件之外适配 Codex，并提供可单独运行的网页；按此范围实现。UI demo 作为流程参考，浏览器目视验收状态见 `docs/00-status.md`。

## 2. Spec Delta

### ADDED：v0.2 Codex 与本地网页入口

- **UC-A6 Codex 插件**：提供 Codex 可安装的插件 manifest 与一个聚焦 Skill，指导 Codex 使用 annot CLI 进行 annotate、check、search、audit 和 context；插件不引入第二套业务实现。
- **UC-A7 本地网页**：用户显式运行 `node src/cli.ts web` 后，可在浏览器查看 Skill 库、搜索 Skill、打开图、浏览审计结果并复制节点改写上下文。
- **UC-A8 回到原文**：图节点显示来源行号、原文与源哈希；刷新会重新读取源。
- **UC-A9 本地访问边界**：服务只绑定 `127.0.0.1`，路径必须来自本次发现的 Skill 清单；跨站请求和任意文件路径被拒绝；页面不写 Skill 源文件。
- **UC-A10 单 Skill 离线产物**：现有 annotate 输出仍可独立保存并双击打开；不要求本地服务器常驻。

### MODIFIED：宿主形态决策

架构从 DSH + Claude Code 计划调整为 DSH + Codex 插件 + 可选本地网页。Codex 集成先采用本地执行 Skill；是否需要 MCP tools/UI 留待有明确交互需求时再立项。

## 3. Design

### 用户流程

```text
Codex 插件：提问 → 插件 Skill 选定 CLI 命令 → 返回图/审计/改写上下文
本地网页：显式启动服务 → 打开 loopback 页面 → 搜索/选择 Skill → 查看图与审计 → 复制上下文
离线图：annot annotate → 双击单文件 HTML
```

### 代码边界

| 区域 | 职责 |
|---|---|
| `src/` | 现有唯一解析、抽取、布局、审计、锚点和渲染实现；新增本地网页 server/handler |
| `web/` | 无外部网络依赖的本地网页壳；使用同一 API 与渲染出的图 |
| `plugins/annot/` | portable root `plugin.json`、根目录 `skills/annot/SKILL.md`；Codex 自动发现 `skills/`，manifest 声明 desktop local execution；不含复制的抽取器 |
| `.agents/plugins/marketplace.json` | 本地 Codex marketplace 清单，指向 `plugins/annot/` |
| `plugin/` | 保持 DSH bundle 入口，继续调用 annot CLI |

### 本地网页 API 草案

- `GET /api/status`：返回绑定地址、扫描根目录、Skill 数和跳过的目录。
- `GET /api/skills`：当前根目录发现结果。
- `GET /api/search?q=`：元数据/正文搜索。
- `GET /api/flow?name=`：只接受当前扫描到的 Skill 名，返回 doc 与服务端布局。
- `GET /api/graph?name=`：返回现有 renderer 生成的 HTML 图。
- `GET /api/audit`：整库审计。
- `GET /api/context?name=&node=`：返回精确节点改写上下文。

静态网页使用同源 API，不引第三方 CDN。服务启动时可配置端口与根目录；省略 roots 时使用 `discover.ts` 的封闭默认集合。启动失败明确报错，不静默改用非 loopback 地址。

### 默认扫描范围

默认集合包含 18 个候选根：当前项目与用户目录各有一份共享 Agents、Claude Code、Codex compatibility、Cursor、GitHub Copilot、Gemini CLI legacy、OpenCode、DSH、ZCode。Codex 官方的用户 Skill 根是 `~/.agents/skills`；`.codex/skills` 与 Gemini 目录保留为兼容项。用户级 Codex、Claude 根分别尊重 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`。

每个根内部最多递归 5 层，支持分类子目录；发现 `SKILL.md` 后将该目录视为 Skill 并停止下降。realpath 与 visited 集合阻止符号链接循环。缺失根仍出现在状态接口和网页「当前范围」中。显式传入 roots 时，用显式集合完全替代默认集合。

### UX demo 信息架构

- 左侧：根目录状态、搜索、Skill 列表。
- 主区：流程图与审计两个视图，图来自现有 renderer。
- 节点详情：选中后显示类型、来源行号、所属阶段、原文与「复制改写上下文」。
- 页面状态：空库、加载中、扫描失败、正常列表、无搜索结果、图载入失败、审计结果。

## 4. Tasks

1. [x] 按用户选择将分支目标限制为结果表首列与后续标题精确匹配；为该规则提供三分支 fixture。
2. [x] 完成本地网页信息架构与视觉 mock，并按用户要求实现可单独启动的网页。
3. [x] 实现 Codex Skill-only manifest、CLI web 命令、loopback server、网页壳和访问边界断言。
4. [x] 完成 Node 全量测试、隔离沙箱、五份样本四视口、分支 fixture 四视口与本地服务 API 冒烟。
5. [x] 同步 README、状态页、原始宿主决策说明和插件 Skill。
6. [x] 默认扫描常见 AI 工具目录，并覆盖配置根、递归子目录、缺失根和符号链接循环测试。

### 测试用例清单

| ID | Given | When | Then | 覆盖点 |
|---|---|---|---|---|
| TC-A6-01 | Codex 插件已安装且本机 `annot` CLI 在 PATH 上 | 用户要求审视一个 Skill | 插件 Skill 指导调用 CLI，不另行抽取 | manifest 与 Skill 有断言；Codex 桌面实际安装待验 |
| TC-A7-01 | 本机配置了一个可读 Skill 根目录 | 用户启动 web 命令并打开地址 | 列表包含该根下 Skill，展示扫描状态 | 正常流程 |
| TC-A7-02 | 空或不可读根目录 | 网页加载列表 | 显示空态或具体错误，不伪装成零 Skill | 空/错误 |
| TC-A7-05 | `annot web` 未传 roots | 服务启动并请求状态 | 返回 18 个默认候选根；Codex、Gemini 的兼容/legacy 状态清楚，ZCode 根可用 | 默认范围 |
| TC-A7-06 | 设置 `CODEX_HOME` 或 `CLAUDE_CONFIG_DIR` | 生成默认 roots | 用户配置根覆盖对应默认位置 | 环境覆盖 |
| TC-A7-07 | 分类子目录里有 Skill，或根内存在符号链接循环 | 扫描该根 | 能找到嵌套 Skill；循环终止；结果确定且不遮住可读项 | 递归与循环 |
| TC-A7-03 | 页面中有多个 Skill | 用户输入搜索词并打开结果 | 只显示匹配项；图的 node、edge、layout 来自 annot 引擎 | 搜索/共用引擎 |
| TC-A7-04 | 已打开图 | 用户选择节点并复制改写上下文 | 上下文带精确锚点与原文；源文件未改变 | 可追溯/只读 |
| TC-A9-01 | 网页服务已启动 | 请求来自非 loopback、跨站，或路径不在扫描清单 | 请求被拒绝，不返回目标文件内容 | 安全边界 |
| TC-A9-02 | Web UI 正常运行 | 页面加载和交互 | 不访问外部网络，键盘可操作，无页面横向滚动 | 离线/a11y |

## 5. Sign-off

实现范围已由用户指令确认。分支规则按用户选择使用现有原文证据：`grill-method` 保持 3 个未绑定分支；独立 fixture 验证结果表首列与后续同名标题的 3 条边。默认扫描范围为封闭的 18 个常见 AI 工具根，并使用有界递归、符号链接循环防护与稳定 rank 去重。Codex 桌面安装、ZCode 测试市场安装与网页目视验收仍是状态页记录的运行验证项。
