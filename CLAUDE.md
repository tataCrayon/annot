# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`annot` turns a `SKILL.md` into a source-anchored action graph (`flow.json` + single-file HTML), detects when the source has drifted from the graph, audits a whole Skill library, and produces bounded optimization/evaluation tasks for host agents (Codex, DSH, ZCode, Claude Code, Cursor, …).

The one selling point every change must preserve: **every node is anchored to exact lines of `SKILL.md` and carries a sha256 of those lines.** Line numbers may drift; the hash is the only staleness judge. Anything that weakens this should not be merged.

## Commands

Requires Node ≥ 22.18 (native TypeScript type-stripping). No build step, no runtime dependencies — `node src/cli.ts` runs exactly what ships.

```bash
npm test                                    # full suite (node --test test/*.test.ts test/*.test.js)
node --test test/layout.test.ts             # single file; add --test-name-pattern "..." to narrow
bash sandbox/run.sh                         # 7-step isolated acceptance run (fake HOME, proves nothing outside sandbox/work is touched)
npm link && annot workbench open            # full workbench against real Skill roots
```

CLI (all commands are pure functions of their input files):

```bash
annot annotate <skill-dir> [--analysis <json>] [--out <dir>] [--sidecar <json>]
annot check <flow.json> [--skill <SKILL.md>]   # exit 0 in sync / 1 drifted
annot verify <flow.json|html> --shot <dir>     # exit 0 ok / 1 fail / 2 skipped (no browser)
annot audit <root...> --limit 15               # weighted "which Skills extract badly"
annot review <skill-dir>                       # standards checks (discovery/structure/resources/maintenance)
annot repair <skill-dir>                       # bounded fix task from failing checks
annot context <flow.json> <node-id>            # exact lines + constraints for an agent to rewrite
annot web [root...] --port 8787                # loopback-only workbench
annot workbench open|status|stop               # status also reports build vs currentBuild
```

**After changing code, run `annot workbench open`.** The workbench is a background daemon: a browser reload does not reload it. It stamps its code (`build`) and `workbench open` restarts a managed daemon whose stamp no longer matches what is on disk — so "the fix did not work" is either a stale process (check `annot workbench status`) or a real bug, never a caching mystery.

Dev probes (not shipped surface): `node tools/inspect.ts <flow.json> [--branches]`, `tools/explain.ts`, `sandbox/*.mjs`.

## Architecture

One engine, several shells. `src/` has **zero** imports of React, DSH, or any MCP SDK — the shells all shell out to the same CLI so they cannot disagree about what the graph is.

```
SKILL.md
  → parse.ts      sections + units, 1-based absolute line numbers, line hashes
  → flow.ts       units → FlowDoc (rule-based extraction: type, lane, label, branches, confidence)
  → depth.ts      longest-sequence-path depth, drives layered DAG layout
  → render.ts     layoutNodes() + renderHtml(): single self-contained HTML (largest module, ~2.3k lines)
  → drift.ts      anchor sha → moved / edited / broken
```

- `types.ts` is the contract: `FlowDoc`, `FlowNode` (with `Anchor`, `Branch`, `lane`, `noteRole`, `associationScope`), `FlowEdge`, `Sidecar`. `schema/flow.schema.json` and `schema/analysis.schema.json` mirror it and are locked by `test/schema.test.js` — change a field and you must change the schema.
- `analysis.ts` is the **AI-first** path: `buildAnalysisPrompt` emits per-line source + a JSON contract, the host model proposes nodes/edges/branches, and `parseAnalysisProposal` / `buildFlowFromAnalysis` validate that every quote points at real lines and every id is consistent. This module deliberately contains **no** action/gate/note vocabulary — only `flow.ts` (the legacy rules draft) does. The web UI labels graphs `AI 语义分析` vs `规则草案` accordingly.
- `associations.ts` links explanatory notes to nodes (`supports`/`constrains`/`informs`/`explains-output`); these edges never change `maxDepth`.
- `audit.ts` is weighted extraction-defect scoring; `standards.ts` is library-independent standards checks (discovery/structure/resources/maintenance) plus evaluation metrics. The two are deliberately separate: structural score ≠ behavioral score.
- `library-report.ts` + `versions.ts` build the cross-library report, content-hash snapshots and diffs.
- `repair.ts` / `context.ts` / `improve.ts` emit bounded task text for a host agent — by design `annot` never calls a model itself.
- `web.ts` serves `web/` (plain HTML/CSS/JS, no framework) over an HTTP server bound to 127.0.0.1 only; `workbench.ts` daemonises it (pid/port record in `.annot/workbench.json`).
- `fsx.ts` is the only writer: temp file + fsync + empty-file rejection + atomic rename. Binary artifacts (screenshots) must use `atomicWriteBytes(..., 'base64')`.

Shells:

| Path | Role |
|---|---|
| `plugin/` (`annot-dsh`) | DSH cordis bundle: `index.js` host routes under `/api/annot/*` (each execs the CLI), `client.js` sidebar row + main pane registered via `__ModuleLoader__`. Contains no engine logic and no layout code. |
| `plugins/annot/` | Codex Skill-only plugin: 3 skills (`annot` router, `annot-analysis`, `annot-evaluation`) + `annot-reviewer` agent. |
| `plugins/annot-zcode/` | ZCode plugin: same 3 skills, `open-workbench` command, local marketplace in `plugins/marketplace.json`. |
| `web/` | Standalone workbench static assets. |
| `bin/annot.ts` | Stable `annot` executable (Windows junction workaround). |

## Invariants (breaking these fails tests or the sandbox)

1. **Skipped ≠ passed.** `verify` without a browser exits `2` and the report says the render check was skipped; no test may print `✓` for it.
2. **Panel contains no layout or extraction logic.** Every click execs the same CLI.
3. **Only `decision` / `gate` nodes grow branches.** Rule words like `禁止…` are constraints, not forks; conditional sentences (`如果文件不存在，则询问用户`) describe a step, not a branch. For a table, only an outcome-style header in the **first column** with values exactly matching later headings yields bound branch targets; everything else stays `unresolved-branch` on purpose.
4. **Layout math is server-side and deterministic.** `wrapLabel()` folds labels during layout and drawing consumes `n.lines`; don't re-measure in the client.
5. **No second layout implementation, no optional dependency that only "looks runnable".**
6. **Docs stay in sync:** change a `flow.json` field → change `schema/*.json`; change a route → change `plugin/docs/DETAIL.md` and the README route table.

When changing extraction rules (`src/flow.ts` — the most fragile place), record `annot audit` numbers before and after: total Skills, zero-defect count, unresolved-branch count. Judge by those three numbers, not by one graph looking right.

## Testing conventions

`node --test` with `assert/strict`. Tests are behavioural and written as prose about the failure they catch. Notable ones:

- `test/layout.test.ts` — determinism, successors below predecessors, no overlap, no out-of-canvas, label wrapping/ellipsis, branch arms.
- `test/render.test.ts` — runs the emitted client script in a minimal DOM.
- `test/panel-render.test.js` — renders the real DSH component tree through a hand-written hook runtime; catches "registered but draws nothing".
- `test/plugin-host.test.js` / `plugin-client.test.js` / `plugin-routes.test.js` — route input validation, loopback fence, CSRF, `?path=` restricted to freshly-scanned files.
- `test/package.test.js` — every `exports` entry exists, is covered by `files`, bin has a shebang, CLI version matches `package.json`.
- Fixtures in `test/fixtures/` (`grill-method.md`, `branch-table.md`, `router-shape.md`, …) are golden inputs; don't edit them to make new tests pass.

Fix a bug by adding the test that fails first.

## Commit messages

A git hook rejects anything not starting with `AI: `, and rejects conversational/process phrasing (`我帮你`, `好的`, `按你的要求`, `如下`). Write only the functional change, optionally a short bullet list. Never bypass with `--no-verify` or `GIT_COMMIT_SKIP_AI_GATE=1`.

## Where the current state lives

`docs/00-status.md` is the first file to read for "what works now" and holds the severity-ordered **known holes** list. Rationale/prior art: `docs/02-form-decision-one-engine-two-shells.md`, `docs/03-prior-art-and-borrowed-capabilities.md`, AI boundary: `docs/ai-first-analysis.md`, UI contract: `docs/ui-design-system.md`. `.agent/` and `.annot/` are gitignored local scratch.
