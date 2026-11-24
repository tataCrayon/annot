---
name: annot-analysis
description: AI-first semantic analysis of an Agent Skill into an evidence-linked action graph. Use when a user asks to analyze, visualize, redraw, classify, diagnose, or optimize a SKILL.md flow; run annot ai-prompt, reason over the whole document, and submit the resulting JSON to annot annotate --analysis. Enforces earned edges: no gate in the trunk, no flattened decisions, no cross-section pipelines.
---

# Annot Analysis

You own the semantic analysis. Do not classify prose by scanning for a fixed word list, regex vocabulary, or a single trigger word. Read the whole Skill, understand its intended execution, and judge each unit in context.

The annot CLI owns only source anchors, schema validation, graph assembly, layout, and rendering. It does not decide what a paragraph means on this path.

## Workflow

1. Run `annot analyze <skill-dir-or-SKILL.md>`. It writes `.annot/<skill>/analysis-task.md` and prints the exact path the JSON must be saved to.
2. Read the generated task and the full `SKILL.md`. Read referenced files only when they materially change the semantics.
3. Produce one JSON analysis proposal in the required shape, and save it to the exact path the command printed. By default that is `.annot/analyses/<skill>.analysis.json` — the directory the workbench reads. Writing to `.annot/<skill>/analyses/...` produces a valid analysis nothing loads.
4. Run `annot annotate <skill> --analysis <that path> --out .annot/<skill>/graph`.
5. If validation fails, correct the proposal from the named node or line range. Never weaken source evidence to make it pass.

There is no rule-based fallback to reach for. `annot annotate` without `--analysis` refuses, and the webpage draws no graph, because a keyword draft cannot be distinguished from an analysis once it is on screen. `--rules` exists only for fixtures and migration.

## Edges must be earned

An arrow claims execution: **this produces what that consumes, or the same state machine moves on.** Two cards being adjacent in the document is not a reason to connect them.

- **Only two reasons justify a `sequence` edge**: output passing (the previous step's deliverable is the next step's input) and state progression (a next step in one state machine, stated in the source as 之后 / 再 / 下一步 / 进入 / 推进到). Everything else is a parallel card, not a next step.
- **A pure action cannot continue forever.** A run ends when a deliverable is consumed, or at a judgment, a gate, or an artifact. Without one of the two reasons above, do not chain an action to an unrelated one to make the graph look complete.
- **End a run with `artifact`.** A deliverable is where the actions stop; do not draw a `sequence` edge out of an `artifact`. What happens to the output afterwards is a different question.
- **Do not connect across `##` sections.** Capability A and capability B, rules and flow, flow and output format are parallel or referential. A cross-section sequence needs a connective written in the source, and the `reason` must quote it.
- **Judgement, routing and on-demand loading become `decision`, not `stage`.** "Judge which step we are at", "route by intent", "read X on demand" are forks. A decision needs at least two ways out: `branch` edges with `when` when the target is provable, `openBranches` when it is not. **A decision with a single exit is a flattened fork** — either give it its second arm or make it a `stage`.
- **A gate never enters the trunk.** It is neither end of a `sequence` or `branch` edge; the validator rejects it. Gates are drawn beside the action they constrain, in source order. To name which action a gate constrains, write a `note` with a `constrains` association.
- Rule-dense passages (铁律, 红线, 禁止项) are usually `gate` cards beside the action they constrain; they are not numbered steps. Do not promote a paragraph to `stage` because it contains prohibitions, and do not split one constraint into a dozen cards — one node may span a whole rule block.

These are checked, not merely requested. `annot annotate` rejects a gate in an edge, a branch from a non-decision, and a decision with one way out. `annotate` and the page also report the softer defects — long action runs, artifacts that continue, cross-section jumps — in the shape rail.

## Node types

- A `stage` states an action the reader, model, or tool must perform.
- A `decision` changes the path based on evidence.
- A `gate` states a condition that must hold or an action that must not be taken.
- An `artifact` is a deliverable or output.
- An `external` node invokes a tool, command, API, MCP server, or another agent.
- A `note` explains, justifies, defines, warns, illustrates, or references execution without pretending to be an action.

Every executable step still needs a node: when the Skill is organised as `Step 1…N`, `Phase 1…N` or numbered sections, those steps are the spine and may not be replaced by one overview paragraph. A section heading is not a node by itself; build a `stage` from the heading's body text when it describes an action.

Use action language in labels. Preserve the source's real ordering and dependencies. Do not infer a branch merely because the source lists alternatives. A branch needs a stated condition and a defensible target.

## Evidence contract

- Every node needs a unique id and an exact 1-based `[start, end]` range.
- `quote` must be the literal source text for that range.
- `source_sha` must match the current `SKILL.md`.
- Do not create a node for Markdown scaffolding or a heading alone.
- Do not turn an explanatory paragraph into a stage to make the graph look busier.
- Use `confidence` for semantic uncertainty, not for keyword agreement.
- `lane` decides the swimlane the card is drawn in, so it must follow who actually performs the work: `tool` for a command or API call even when it sits inside a prose step, `reader` for a judgement or edit, `model` only when the Skill explicitly hands the work to the model, `output` for a deliverable.
- Every note needs `noteRole` and `associationScope`.
- Use `node` only when an association exists, `skill` for a defensible whole-Skill principle, and `unbound` when no target can be supported.
- Association relations are `supports`, `constrains`, `informs`, and `explains-output`.

## Final response

Report the generated flow/HTML paths, source sha, node/edge counts, note coverage, and any validation failures. Distinguish AI inference from source evidence. A rendered graph is not proof that the Skill is effective.
