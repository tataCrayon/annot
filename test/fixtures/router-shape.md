---
name: router-demo
version: 1.0.0
description: "A router-shaped skill: a mode table plus a relay order, used by the sandbox to prove that table-driven dispatch is read as a decision, not as a blob of text."
---

# Router Demo（四路分派）

> **为什么要合并**：原来几个 skill 各自的语义边界是清楚的，但多条长描述同时常驻、触发词大量交叉，模型看到几条都在争同一句话。合并后**入口只有一条描述**，正文按 mode 加载——判定成本从"比对 N 条描述"降到"看一张表"。

## 第一步：判定 mode（先做这一步，不要跳过）

按**被审对象**选，不按用户的措辞选：

| Mode | 被审对象 | 典型触发 | 加载 |
|---|---|---|---|
| **requirement** | 需求：做什么、边界在哪 | "追问我"、"需求澄清" | `references/mode-requirement.md` |
| **method** | 方法：这条路线是最优的吗 | "这个做法最优吗"、"有没有更好的做法" | `references/mode-method.md` |
| **idea** | 想法：值不值得做、有没有人做过 | "这个想法靠谱吗"、"有没有人做过" | `references/mode-idea.md` |
| **decision** | 决策：这个具体决策对不对 | "这个决策对吗"、"质疑一下这个决策" | `references/mode-decision.md` |

**四路接力顺序**（同一件事走完全程时）：

```
idea（要不要做 / 有没有人做过）
  → requirement（做什么 / 边界在哪）
    → method（怎么做最优）
      → decision（执行中每个非平凡决策对不对）
```

## 第二步：加载对应 reference

- 只加载**一个** mode 的 reference，不要四个一起读
- reference 里的触发条件、执行流程、红线、常见借口，全部**以原文为准**
- 原文中提到的其他 skill 名，现在都指向本 skill 的对应 mode

## 消歧（什么时候用错了 mode）

| 症状 | 改用什么 |
|---|---|
| 用 requirement 问出了"这么做是不是最优" | 换成 method |
| 用 method 问出了"这个需求该不该做" | 换成 idea 或 requirement |
| 用 decision 但只是自己在自问自答 | 换成 method 的自问自答模式 |

## 加载约束

`references/mode-decision.md` 要求 spawn 子 Agent，因此**不要在 Agent 的 `skills:` frontmatter 中添加本 skill**——Agent 里只用前三个 mode。
