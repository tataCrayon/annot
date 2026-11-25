# AI-first Skill analysis and evaluation

## Decision

Meaning comes from AI. Code does not decide whether prose is an action, gate, decision, artifact, explanation, or branch.

The deterministic layer remains responsible for:

- numbering Markdown lines and recovering structural anchors;
- verifying the proposal's source hash and exact quote for every node;
- checking ids, enums, references, and association consistency;
- refusing an edge that could not have been earned: a gate in the trunk, a branch from a non-decision, a decision with one way out;
- computing layout, rendering, hashes, drift, and browser checks.

This boundary keeps AI flexible without allowing it to invent source evidence.

## Edges are claims, not defaults

A `sequence` edge means one of two things: the previous step's output is the next step's input, or the same state machine moves on (the source says 之后 / 再 / 下一步 / 进入). Two cards being adjacent in the document is not a reason to connect them. The prompt used to say "connect in reading order", and 44 real analyses produced 348 sequence edges of which 234 crossed a heading and 127 touched a gate — every numbered list became a pipeline.

The prompt now states the rule; `buildFlowFromAnalysis` enforces the part that can be judged without rereading the prose, and `src/shape.ts` reports the rest:

| Check | Enforced by | Failure |
|---|---|---|
| gate is an endpoint of any edge | validator | rejected |
| `branch` leaves something that is not a `decision` | validator | rejected |
| `decision` has fewer than two ways out | validator | rejected |
| a cross-chapter `sequence` edge has no `reason` (rule chapters exempt) | validator | rejected |
| gates outnumber executable steps by more than 1.5× (floor of 4) | validator | rejected |
| ≥4 executable cards in a row with no artifact, judgment or gate | `diagnose` | `endless-action-run` (info, warn at 6) |
| a `sequence` edge leaves an `artifact` | `diagnose` | `artifact-does-not-continue` |
| a `sequence` edge jumps between two non-rule `##` sections without a `reason` | `diagnose` | `cross-section-sequence` |
| a `sequence` edge jumps sections and quotes the connective | `diagnose` | `cross-section-justified` (info) |
| an executable card has no edge at all | `diagnose` | `isolated-action` |
| a gate with no binding to what it constrains | validator | bound by `src/constraints.ts`, and marked as a guess when it had to be |

The soft findings never block a build — a genuinely linear short skill is allowed to be linear — but they enter the `annotate` report, the artifact's shape rail, `annot audit`, and the readability score.

## Who owns a rule

A `gate` is not in the trunk, so the one thing the page has to know is which cards it governs. That answer belongs to the analysis, not to a heuristic: `references: [node id]` on the gate wins outright. When it is absent, `src/constraints.ts` tries, in order, an exact citation of a node id or label, a quoted heading, shared `topics`, then document position — and the card says the binding was inferred. `topics` is how the model does semantic segmentation (3–5 tags in its own words); the deterministic layer has no tokenizer, and an n-gram guess at Chinese words produced labels like `共同术语：稿每 / 字带 / 底稿每`.

A rule chapter's card (`## 硬信念`, `## 红线`, `## 验证清单`) constrains the whole Skill rather than particular steps, so it carries `associationScope: "skill"` and is drawn on the global-rule rail instead of pretending to sit beside a step. A chapter holding six or more rule cards is folded behind its first card with an expand toggle; folding is a view — every card keeps its layout position, so `annot verify` still proves each anchor is drawable.

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
