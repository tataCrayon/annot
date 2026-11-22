---
name: annot
description: Inspect, audit, improve, and evaluate Agent Skills using the installed annot CLI. Use when a user asks to visualize a Skill flow, change a Skill with natural language, assess whether a Skill actually works, or optimize it from evaluation failures.
---

# Annot Skill review

Use AI for semantic analysis. The installed `annot` command owns source anchoring, validation, layout, and rendering; it must not be treated as the semantic authority when an AI analysis proposal is available.

Load `annot-analysis` when the task is to explain or visualize a Skill flow. Load `annot-evaluation` when the task is to test, grade, diagnose, or optimize behavior. This router file should not duplicate either workflow.

The CLI requires Node.js 22.18 or newer. To expose it from a source checkout without publishing a package, run `npm link` in the annot repository and confirm with `annot version`. When working inside the checkout, `node src/cli.ts <command>` is also available.

To open the persistent local workbench, run `annot workbench open`. The command reuses a healthy workbench on port 8787 or starts one in the background and opens the default browser. Use `annot workbench status` to inspect it and `annot workbench stop` to stop the managed server. For foreground debugging, `annot web [skill-root...] --port 8787` is still available; press Ctrl+C in that terminal to stop it.

The webpage loads validated AI proposals from `.annot/analyses/<skill>.analysis.json` by default and labels the result `AI semantic analysis`. If no proposal exists, it labels the compatibility view `rules draft`. Use `annot web ... --analysis-dir <dir>` to override the proposal cache.

When roots are omitted, `annot web` scans 16 closed candidates: project and user Skill directories for shared Agents, Claude Code, Codex compatibility, Cursor, GitHub Copilot, Gemini CLI legacy, OpenCode, and DSH. The shared `.agents/skills` roots are the Codex official locations; `.codex/skills` and Gemini directories are compatibility entries. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` override their user roots. Explicit roots replace the default set.

Discovery searches at most five directory levels below each root, so categorized paths such as `skills/design/review/SKILL.md` are included. A directory containing `SKILL.md` is treated as a Skill and is not searched further. Missing roots remain visible as skipped; the command never scans arbitrary disk locations.

The local webpage can create a bounded rewrite task or a paired evaluation-and-optimization plan. It posts `{ name, node?, mode, intent }` to `POST /api/brief`; the response is task text with `writesSource: false`. The webpage itself never edits a Skill.

## Choose a command

- Find Skills: `annot list <root...> --json`
- Search names, descriptions, and headings: `annot search <query> --json -- <root...>`
- Search full text when requested: `annot search <query> --body --json -- <root...>`
- Review a library: `annot audit <root...> --json`
- Create an AI analysis task: `annot ai-prompt <SKILL.md-or-directory> --out <scratch-directory>/analysis-task.md`
- Render a validated AI proposal: `annot annotate <SKILL.md-or-directory> --analysis <proposal.json> --out <scratch-directory> --json`
- Create an AI evaluation task: `annot ai-evaluate <SKILL.md-or-directory> --intent <goal> --metrics <ids> --out <scratch-directory>/evaluation-task.md`
- Open, inspect, or stop the reusable webpage: `annot workbench open|status|stop`
- Check an existing graph: `annot check <flow.json> --skill <SKILL.md> --json`
- Get bounded edit context: `annot context <flow.json> <node-id>`

On Windows, quote paths containing spaces. Use an explicit scratch directory for `annotate`; its default output is beside the source and would add files to the Skill tree.

## Review rules

1. Read the command result and identify the exact Skill path before describing it.
2. When a graph is requested, first load `annot-analysis`, create an evidence-linked AI proposal, then render it with `annot annotate --analysis` into a temporary output directory. Read the resulting `.flow.json` and use node labels, `anchor.heading`, line ranges, and hashes as evidence. If the user needs the visual artifact, provide the generated `.html` path.
3. Report `forks`, `bound`, and `unresolved` separately. Only a result-table first-column value that exactly matches a later heading is an automatic branch target. Do not turn inline enumerations or similar wording into edges.
4. Explain audit scores as extraction signals, not as a quality rating of the Skill itself.
5. For a rewrite request, first locate the exact node with `annot context` or the local webpage. If the user explicitly asks to apply the edit, save a flow snapshot before editing, modify only the anchored range, then run `annot check` and report the actual diff and any moved or broken anchors. Without explicit edit authorization, return the bounded task and stop before writing.
6. For an effect evaluation request, load `annot-evaluation`. Use a paired plan with baseline and Skill variants under the same model, tools, inputs and isolation. Include main-path, branch/boundary and negative-trigger cases, named pass/fail assertions, and at least two repeats.
7. Treat `annot audit` as extraction readability only. Never turn its score into a Skill effect score. If baseline or candidate runs are missing, report the result as “untested”, not pass or fail.
8. For optimization, map a failure cluster to source nodes, change one node or constraint per round, run the full scenario set, and keep the change only when the target improves without negative-example regression. Log failure, node, hypothesis, change, evidence and accept/revert decision.
9. If `annot` is unavailable, say so and direct the user to install the package from its checkout with `npm link`; do not silently substitute another parser.
