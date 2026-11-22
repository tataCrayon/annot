---
name: action-semantics
description: A fixture for action-oriented node labels and semantic node types.
---

# Action Semantics

## 环境边界

两个互不通用的站点：UAT 与生产。选错站点会返回登录页。

> 报「session 过期」前先确认 `--env` 选的是哪个站点。

## 安全红线

1. **只读**：只允许 `SELECT` / `SHOW` / `EXPLAIN` / `DESC` / `DESCRIBE`。任何 INSERT/UPDATE/DDL 与多语句一律拒绝。
2. **session 由用户提供**：禁止提交进 git、skill 或笔记。

## 用法

```bash
S=<sessionid>

# 列实例
python archery.py --env uat instances

# 只读查询
python archery.py --env uat sql "SELECT id FROM t_permission"
```

脚本输出：`cols: [...]`、每行、`rows=N error=None`。`status != 0` 时打印 `[FAIL]`。

## CSRF / Cookie 流程

```text
GET /sqlquery/ 带 Cookie sessionid → 响应 Set-Cookie: csrftoken
POST /query/ 必须同时带 X-CSRFToken 与 cookie jar
```

表单字段 `csrfmiddlewaretoken` 代替不了 cookie 的 `csrftoken`；换了 Client 实例会 403。

## 操作步骤

1. 读取输入文件并确认字段完整。
2. 比较 UAT 与生产数据。
3. 生成差异报告。
