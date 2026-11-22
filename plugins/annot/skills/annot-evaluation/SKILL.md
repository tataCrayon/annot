---
name: annot-evaluation
description: AI-driven evaluation and optimization design for Agent Skills. Use when a user asks whether a Skill works, how to test it, what to measure, why it fails, or how to optimize it; derive scenarios from the Skill's semantics and require real baseline/candidate evidence before assigning results.
---

# Annot Evaluation

Evaluate behavior, not document appearance. Read the Skill and linked resources, infer the behavior it is meant to cause, then design tests that can distinguish that behavior from a competent model doing the task without the Skill.

Run `annot ai-evaluate <skill-dir-or-SKILL.md> --intent <goal> --metrics <ids> --out <scratch>/evaluation-task.md` to obtain the task shell when useful. The AI still owns scenario selection, assertions, failure analysis, and optimization hypotheses.

## Evaluation order

1. **Trigger**: test explicit, implicit, noisy-context, adjacent-Skill, and negative requests. Require a no-trigger output for negative cases.
2. **Behavior**: exercise the main path, each branch, boundary conditions, missing information, tool failure, and stop conditions.
3. **Output**: define observable assertions for files, structured data, required decisions, prohibited actions, and recovery behavior.
4. **Causal comparison**: run `without_skill` and `with_skill` in isolated sessions with the same model, tools, inputs, timeout, and permissions.
5. **Economics and stability**: record tokens, model/tool calls, latency, failures, and repeated-run variance.

## Method rules

- Read execution traces, not only final answers. Look for ignored instructions, wasted steps, over-triggering, and unnecessary context cost.
- Start with 2–3 scenarios, then expand after seeing the first run.
- Every assertion must be pass/fail observable; subjective qualities need a named rubric and examples.
- Repeat each variant at least twice. Keep prompt, files, environment, and tool policy identical.
- Never let the candidate run see the baseline output or its grade.
- Do not treat section count, isolation rate, or graph quality as behavior performance.
- Without an isolated run, report `unmeasured`; do not estimate a score from the document.

## Optimization loop

Map a failure cluster to exact source anchors. State one hypothesis, change one instruction or constraint, rerun the full scenario set, and keep the change only when the target improves without negative-example regression. Record failure evidence, source node, hypothesis, diff, before/after assertions, cost, and accept/revert decision.

## Outputs

- `evals/evals.json`: scenarios, prompts, files, expected behavior, and assertions.
- `runs/`: isolated baseline and candidate traces.
- `benchmark.json`: assertion outcomes, paired deltas, cost, latency, repeats, and limitations.
- `optimization-log.md`: failure → node → hypothesis → change → regression result.

Put evaluation artifacts in a scratch directory or `.annot/evals/<skill>/`; do not modify the Skill unless the user asks to apply an optimization.
