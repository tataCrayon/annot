# annot 产品需求

## 产品定义

annot 为 Agent Skill 提供可复核的流程视图。它从 `SKILL.md` 提取带行号与内容哈希的节点，生成流程图、结构审计、Skill 规范检查、受控修改任务和分层配对评估计划；Skill 原文仍是唯一事实源，网页不直接写源文件。

## 需求版本

### v0.1：共享引擎与宿主入口

- **UC-A1 标注 Skill**：给定 `SKILL.md`，生成带源码锚点的 `flow.json` 与离线 HTML。
- **UC-A2 检查漂移**：给定已有图与源文件，报告节点移动、原地改写或锚点失效。
- **UC-A3 审计结构**：扫描指定 Skill 根目录，按可解释的结构缺陷排序。
- **UC-A4 提供局部改写依据**：为所选节点返回精确原文、行范围、邻接上下文和改写约束。
- **UC-A5 多入口共用引擎**：命令行与宿主插件调用相同的抽取、布局和审计代码。

### v0.2：Codex 与本地网页

- **UC-A6 Codex 插件**：提供 Agent Plugin manifest 和 annot 工作流 Skill；在 Codex 本地执行环境中调用已安装的 annot CLI。
- **UC-A7 本地网页**：用户显式启动 annot web 命令后，在浏览器浏览 Skill 库、搜索 Skill、查看流程图和整库审计。
- **UC-A8 节点详情**：网页显示所选节点的来源行号与原文，并能复制 annot 生成的改写上下文。
- **UC-A9 本地访问**：网页服务仅监听 loopback；读取范围限于明确配置的 Skill 根目录和当前扫描结果；不写 Skill 源文件。
- **UC-A10 离线产物**：每个 Skill 的单文件 HTML 可独立打开，无需启动网页服务。

### v0.3：常见 AI 工具目录自动扫描

- **UC-A11 默认扫描范围**：`annot web` 省略 roots 时，扫描当前项目和用户目录下共享 Agents、Claude Code、Codex compatibility、Cursor、GitHub Copilot、Gemini CLI legacy、OpenCode、DSH、ZCode 的 Skill 目录，共 18 个候选根。
- **UC-A12 官方与兼容标识**：Codex 官方共享根显示为 `.agents/skills`；`.codex/skills` 标为 compatibility。Gemini CLI 根保留扫描但标为 legacy。
- **UC-A13 配置根覆盖**：用户级 Codex 兼容根尊重 `CODEX_HOME`，Claude 根尊重 `CLAUDE_CONFIG_DIR`。显式传入 roots 时完全替代默认集合。
- **UC-A14 有界递归**：每个候选根只在自己内部递归到第 5 层，支持 `skills/category/name/SKILL.md`；目录一旦含 `SKILL.md` 就作为 Skill 读取并停止向下。使用 realpath 与 visited 集合阻止符号链接循环。
- **UC-A15 扫描状态可见**：缺失、非目录或不可读的根保留在 `skipped` 状态，并在网页「当前范围」中列出；一个不可读子目录不能遮住同根的其他可读 Skill。
- **UC-A16 同名去重**：按 annot 自定的 rank 采用最低值；项目优先于用户，共享 Agents 优先于同层宿主镜像。rank 相同时按路径字典序稳定选择。
- **UC-A17 读取边界**：只读取上述封闭候选根或用户显式给出的 roots，不遍历任意磁盘，不按文件名猜目录，不提供 Skill 源文件写接口。

### v0.4：自然语言修改与效果评估

- **UC-A18 生成修改任务**：选择源码节点并输入自然语言意图后，生成绑定 Skill、节点、原文、行范围、哈希和禁止事项的宿主任务。
- **UC-A19 修改后验收**：任务要求宿主保存 flow 快照，只修改目标行，运行 `annot check`，并同时报告实际 diff 和锚点结果。
- **UC-A20 生成配对评估计划**：为 Skill 生成 baseline 与加载 Skill 的对照方案，要求主路径、分支/边界、误触发反例、具名断言、相同执行条件和至少两次重复。
- **UC-A21 优化回环**：评估计划把失败映射到源码节点，要求每轮只验证一个假设，全量回归后按“目标改善且负例不回退”接受或回退。
- **UC-A22 结果诚实性**：没有真实运行产物时只显示“效果未测”；结构审计分不得作为 Skill 行为效果分。
- **UC-A23 任务交接边界**：`POST /api/brief` 只返回受长度限制的任务文本并声明 `writesSource: false`；模型执行和源文件修改由 Codex/DSH 宿主或外部 harness 完成。

### v0.5：Skill 规范检查与评估方法整合

- **UC-A24 规范检查**：按 Agent Skills 规范检查 frontmatter、名称、Description、正文结构、渐进披露、本地链接和维护性；阻断项与建议项分开显示。
- **UC-A25 全入口一致**：`annot review`、网页“规范与评估”页签和 JSON 导出读取同一个确定性检查器。
- **UC-A26 分层评估方法**：固定规范校验、触发与选择、行为与产物、配对因果、成本与稳定性五层；静态规范检查不得被表述为行为效果。
- **UC-A27 工具适配建议**：评估任务说明何时接入 `skill-eval-harness`、Promptfoo、Inspect AI、NVIDIA SkillEvaluator 或 Alibaba skill-up，不复制这些执行引擎。

### v0.6：说明作用与可追踪性

- **UC-A28 说明角色**：说明节点区分原则、理由、定义、触发条件、背景、风险、示例和参考；结构类型不因语义角色膨胀。
- **UC-A29 非执行关联**：说明通过 `supports / constrains / informs / explains-output` 关联动作、门禁、判断或产物；关联边不改变执行主线深度。
- **UC-A30 全局与孤立分离**：无法绑定单个节点但明确适用于整个 Skill 的说明标为全局；既无节点目标也无全局范围的说明进入待确认队列。
- **UC-A31 说明覆盖指标**：流程统计和整库审计同时给出说明总数、已关联数、全局数、孤立数和孤立文本率，工作台与插件共享同一结果。
- **UC-A32 人工校准**：sidecar 可用 `associatesWith` 指定目标，用 `associationScope` 强制标为 `skill` 或 `unbound`；人工关联置信度为 1，并保留证据。
- **UC-A33 指标边界**：孤立文本率只衡量静态可追踪性，不单独代表触发准确率、输出质量或 Skill 效果；行为效果仍由配对评估和真实运行证据判断。

### v0.7：AI-first 分析与评估

- **UC-A34 AI 语义分析**：节点类型、Action 标签、执行边、分支、门禁、产物、说明角色和关联目标由 AI 阅读整份 Skill 后判断，不使用固定关键词表代替语义理解。
- **UC-A35 确定性证据边界**：CLI 负责生成带行号的 AI 任务，并验证源文件 sha256、逐字引文、行范围、唯一 id、边目标、说明关系和范围一致性。
- **UC-A36 AI 分析提案**：`annot ai-prompt` 生成分析任务；宿主 AI 输出 `analysis.json`；`annot annotate --analysis` 将提案转换为 `flow.json` 和 HTML，并在 `source.method` 记录 `ai`。
- **UC-A37 AI 评估 Skill**：`annot ai-evaluate` 和 `annot-evaluation` 从 Skill 的真实目的推导触发、行为、负例、隔离配对和成本场景；没有运行证据时只输出计划并标记 `unmeasured`。
- **UC-A38 插件内路由**：Codex/DSH 插件提供 `annot`、`annot-analysis`、`annot-evaluation` 三个 Skill；主 Skill 只负责选择工作流和报告结果。
- **UC-A39 兼容迁移**：不带 `--analysis` 的规则抽取保留为历史回归和迁移路径，输出标记为 `source.method: "rules"`，不再是语义分析的默认权威。

### v0.8：可配置范围与 Agent 对话入口

- **UC-A40 扫描范围配置**：本地网页的「扫描目录」位于 Skill 库顶部，可勾选常见 AI 工具目录、追加自定义路径并在保存后立即重扫；必要时可恢复默认。
- **UC-A41 配置持久化**：网页把选择写入 `.annot/web-roots.json`，服务重启后继续使用；`--root-config` 允许主工作台与测试实例使用独立配置，配置文件不包含 Skill 内容。
- **UC-A42 Agent 投影**：Codex 插件提供独立 Skill Reviewer Agent，DSH 面板与 ZCode 插件继续把节点上下文交回当前会话；各宿主只负责定位、路由和证据，由宿主 Agent 完成语义分析、修改与评估执行。
- **UC-A43 回到会话**：网页与插件不内置第二个模型，不创建浏览器写 Skill 的接口；自然语言修改和配对评估都以受控任务离开工作台，回到 Codex、DSH 或 ZCode 会话验收。
- **UC-A44 统一工作台入口**：`annot workbench open` 幂等启动或复用本地工作台并打开浏览器；Codex、ZCode 通过同一 CLI 调用，DSH 通过受 loopback 保护的 POST 路由打开独立网页，同时保留原生面板。
- **UC-A45 受管进程**：工作台记录 PID、端口和实例 ID；`status` 与 `stop` 只操作配置目录中记录的同一实例，不终止其他占用该端口的服务。
- **UC-A46 规范证据跳转**：规范检查指出孤立说明时，返回对应节点 ID 与源码范围；网页可一键切到动作图并选中第一条孤立说明，右侧抽屉随即显示它的锚定原文。
- **UC-A47 评估任务输出**：评估指标支持全选/清空；分析、修改、评估任务生成后在原生大弹窗中展示完整文本，并保留复制与关闭动作。
- **UC-A48 摘要安全区**：关键动作摘要与四周边界保持受检内缩，桌面 48px、窄屏至少 32px；真实浏览器验收会阻止间距退化。
### v0.9：整库评估与版本管理

- **UC-A49 工作区拆分**：顶部主导航把「Skill 库」「整库评估」「版本管理」拆成三个独立入口，切换时不共享错误视口或滚动位置。
- **UC-A50 整库评估报告**：一次扫描汇总所有 Skill 的静态规范、资源引用、孤立说明和抽取结构问题，按阻断与建议分级，并可导出 Markdown/JSON。
- **UC-A51 整库优化任务**：生成任务前自动创建基线快照，并把完整报告写入 `.annot/reports/`；任务交给 Codex、DSH 或 ZCode 宿主执行，未运行的行为效果保持 `unmeasured`。
- **UC-A52 本地版本管理**：快照保存每个 Skill 的路径、内容 hash 与原文；相同内容指纹在历史中合并显示，任意两次快照可比对新增、修改和移除项。
- **UC-A53 恢复任务而非直接回滚**：网页可生成基于目标快照的恢复任务，但不在浏览器内直接覆盖 Skill；宿主必须先检查未提交改动与冲突。
- **UC-A54 annot 系统 Skill**：工作台左侧单独展示插件自带的 `annot`、`annot-analysis` 与 `annot-evaluation`，以独立 `source=system` 路径读取动作图、规范检查和宿主任务，不进入用户 Skill 库统计。

## 边界

- annot 不调用模型，不自动改写 Skill，也不创建、编辑或删除 Skill。
- annot CLI 不内置模型；语义分析和评估由宿主 Skill 或外部 harness 执行，CLI 只验证结构化结果与证据。
- annot 可以生成配对的评估与优化计划，但不自研模型执行或 eval 引擎，也不在缺少运行结果时生成效果分。
- 节点、边和布局结论必须可追溯至原文或明确的 sidecar 标注。
- 说明关联是可解释的推断，必须显示证据和置信度；不确定时允许标为孤立，不能为了连线而伪造目标。
- 宿主入口可以不同，但流程抽取与图布局只有一份实现。
