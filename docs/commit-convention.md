# Commit 消息规范（由 git hook 硬门禁）

每个 commit message 必须满足两条，否则被 `~/.agents/git-hooks/commit-msg` 拒绝：

1. **首行以 `AI: ` 开头**（正文行不受限）。
2. **只写功能变动**，不写对话口吻、不写过程汇报。

## 被拒的典型写法

| ❌ 被拒 | 原因 |
|---|---|
| `fix: 修复登录` | 缺 `AI: ` 前缀 |
| `AI: 我帮你把登录改了` | 对话口吻「我帮你」 |
| `AI: 好的，已按你的要求调整` | 「好的」「按要求」 |
| `AI: 按你的反馈重构了 xxx` | 过程汇报 |
| `AI: 如下修改` | 「如下」 |

## 通过的正确写法

```
AI: 登录接口增加失败重试与退避

- 重试 3 次，指数退避 200/400/800ms
- 401 不重试，直接抛出
```

```
AI: annot 增加 audit 子命令

批量抽取整个 skill 库，按抽取瑕疵加权排序输出，
用于回答"哪个 skill 渲染得不对"。
```

## 铁律

被拦就**改消息**。禁止 `--no-verify`，禁止 `GIT_COMMIT_SKIP_AI_GATE=1`。

```bash
# 改上一条
git commit --amend

# 改更早的（交互式 rebase 后 reword）
git rebase -i HEAD~3
```
