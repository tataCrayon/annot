# AI-first Skill analysis and evaluation

## Decision

Meaning comes from AI. Code does not decide whether prose is an action, gate, decision, artifact, explanation, or branch.

The deterministic layer remains responsible for:

- numbering Markdown lines and recovering structural anchors;
- verifying the proposal's source hash and exact quote for every node;
- checking ids, enums, references, and association consistency;
- computing layout, rendering, hashes, drift, and browser checks.

This boundary keeps AI flexible without allowing it to invent source evidence.

## Analysis flow

```text
SKILL.md
  │
  ├─ annot ai-prompt ──> analysis task with numbered source + JSON contract
  │                           │
  │                           ▼
  │                     host AI reasoning
  │                           │
  │                           ▼
  │                     analysis.json
  │                           │
  └─ annot annotate --analysis analysis.json
                              │
                              ▼
                 validate anchors and references
                              │
                              ▼
                     flow.json + HTML graph
```

Run:

```bash
annot analyze path/to/my-skill
#    task: .annot/my-skill/analysis-task.md
#    proposal: .annot/analyses/my-skill.analysis.json

# The host AI writes .annot/analyses/my-skill.analysis.json
annot annotate path/to/my-skill \
  --analysis .annot/analyses/my-skill.analysis.json \
  --out .annot/my-skill-graph
```

The proposal carries source line ranges and exact quotes. `annot annotate --analysis` rejects a changed source hash, unmatched quote, duplicate id, unknown edge target, invalid note relation, or note scope that contradicts its associations. It does not re-run keyword rules over the AI output.

## Evaluation flow

Run:

```bash
annot ai-evaluate path/to/my-skill \
  --intent "验证恢复和触发准确性" \
  --metrics selection,recovery \
  --out .agent/my-skill.evaluation-task.md
```

The `annot-evaluation` Skill tells the host AI to derive scenarios from the Skill's purpose, create negative and edge cases, run isolated `without_skill` / `with_skill` comparisons, and record pass/fail assertions. Document structure and graph quality are not behavior scores.

## Host Skills

The Codex plugin ships:

- `annot-analysis`: semantic classification and source-linked graph proposal.
- `annot-evaluation`: scenario design, causal comparison, grading, and optimization loop.
- `annot`: routing and command reference.

The standalone webpage can generate both tasks but remains read-only. Codex or DSH executes the Skill, produces analysis/evaluation artifacts, and hands validated results back to annot.

## Compatibility path

`annot annotate` without `--analysis` still runs the original deterministic rule engine for regression fixtures and migration. Its output is a **rules draft**, not the product's semantic authority. Production analysis should use `--analysis`; `source.method` records either `rules` or `ai`.

Structural parsing uses regular expressions for Markdown syntax such as headings, fences, lists, and tables. Semantic word tables are not part of the AI analysis path.
