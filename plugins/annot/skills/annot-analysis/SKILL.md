---
name: annot-analysis
description: AI-first semantic analysis of an Agent Skill into an evidence-linked action graph. Use when a user asks to analyze, visualize, redraw, classify, diagnose, or optimize a SKILL.md flow; run annot ai-prompt, reason over the whole document, and submit the resulting JSON to annot annotate --analysis.
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

## Semantic rules

- The trunk is yours to define. Every executable step must have a node: when the Skill is organised as `Step 1…N`, `Phase 1…N` or numbered sections, those steps are the spine and may not be replaced by one overview paragraph. A section heading is not a node by itself; build a `stage` from the heading's body text when it describes an action.
- `edges` is the spine. Connect the steps in reading order as `sequence` unless the source says otherwise. An analysis with more than one executable node and no edges is rejected: the layout would have to guess the order, which is the guessing this path exists to remove.
- Rule-dense passages (铁律, 红线, 禁止项) are usually `gate` cards beside the action they constrain; they are not numbered steps. Do not promote a paragraph to `stage` because it contains prohibitions, and do not split one constraint into a dozen cards — one node may span a whole rule block.
- A `stage` states an action the reader, model, or tool must perform.
- A `decision` changes the path based on evidence.
- A `gate` states a condition that must hold or an action that must not be taken.
- An `artifact` is a deliverable or output.
- An `external` node invokes a tool, command, API, MCP server, or another agent.
- A `note` explains, justifies, defines, warns, illustrates, or references execution without pretending to be an action.

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
