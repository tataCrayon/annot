---
name: annot-analysis
description: AI-first semantic analysis of an Agent Skill into an evidence-linked action graph. Use when a user asks to analyze, visualize, redraw, classify, diagnose, or optimize a SKILL.md flow; run annot ai-prompt, reason over the whole document, and submit the resulting JSON to annot annotate --analysis.
---

# Annot Analysis

You own the semantic analysis. Do not classify prose by scanning for a fixed word list, regex vocabulary, or a single trigger word. Read the whole Skill, understand its intended execution, and judge each unit in context.

The annot CLI owns only source anchors, schema validation, graph assembly, layout, and rendering. It does not decide what a paragraph means on this path.

## Workflow

1. Run `annot ai-prompt <skill-dir-or-SKILL.md> --out <scratch>/analysis-task.md`.
2. Read the generated task and the full `SKILL.md`. Read referenced files only when they materially change the semantics.
3. Produce one JSON analysis proposal in the required shape.
4. Save it outside the user's Skill directory at `.annot/analyses/<skill>.analysis.json`; the local webpage reads this cache automatically.
5. Run `annot annotate <skill> --analysis .annot/analyses/<skill>.analysis.json --out .annot/<skill>-graph`.
6. If validation fails, correct the proposal from the named node or line range. Never weaken source evidence to make it pass.

## Semantic rules

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
- Every note needs `noteRole` and `associationScope`.
- Use `node` only when an association exists, `skill` for a defensible whole-Skill principle, and `unbound` when no target can be supported.
- Association relations are `supports`, `constrains`, `informs`, and `explains-output`.

## Final response

Report the generated flow/HTML paths, source sha, node/edge counts, note coverage, and any validation failures. Distinguish AI inference from source evidence. A rendered graph is not proof that the Skill is effective.
