/**
 * The three artifacts annot owns. SKILL.md is the only source of truth;
 * flow.json is a derived projection that carries an anchored copy of the
 * source text, so a stale projection can always be relocated or reported
 * instead of silently re-guessed.
 */

export type NodeType = 'stage' | 'decision' | 'gate' | 'artifact' | 'external';

/**
 * Who performs a step. Orthogonal to {@link NodeType}: a gate can be checked by
 * a person or by a command, and a step can be done by the reader or by a tool.
 *
 * The type answers "what kind of thing is this", the lane answers "who does it".
 * A 34-step skill where `git fetch`, `MCP get_order` and "判断分支是否落后" all
 * sit in one column is unreadable for exactly this reason: two of the three are
 * not work the reader does.
 */
export type Lane = 'reader' | 'tool' | 'model' | 'output';

export interface Anchor {
  /** Heading path the node was lifted from, outermost first. Empty for preamble. */
  heading: string[];
  /** 1-based inclusive line range inside SKILL.md. */
  start: number;
  end: number;
  /** sha256 of the exact lines joined with \n — the only staleness judge. */
  sha: string;
}

export interface Branch {
  /** Guard text as written by the author, e.g. "hold / amend / replace". */
  when: string;
  /** Resolved target node id, when the extractor or a human could name one. */
  to?: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  label: string;
  /**
   * Second line of the card: the artifact, condition or target the step
   * produces. Absent when the source gives nothing short enough to be a line.
   */
  subtitle?: string;
  /** Who performs this step. Defaults to `reader`. */
  lane: Lane;
  /**
   * Chapter path the node sits in, already trimmed to the branch that names a
   * phase (`Phase 1：分支对比`). Absent when the skill declares no phases.
   */
  phase?: string;
  /** Body of the node as shown in the UI; trimmed source text. */
  text: string;
  /** Exact source lines, used to relocate the anchor after an edit. */
  raw: string;
  anchor: Anchor;
  branches: Branch[];
  /**
   * Which classification rule fired, as a fixed constant per rule.
   *
   * This is NOT a probability: `decideRule` returns 0.65 for every paragraph, so
   * thirteen nodes reading "65%" means "thirteen paragraphs", not "the model was
   * 65% sure thirteen times". The UI therefore labels it 规则 rather than 置信度.
   */
  confidence: number;
  /** The rule that produced this node, so the score above can be explained. */
  rule?: string;
  /** Human override reason, set when a sidecar annotation produced this node. */
  source?: 'extractor' | 'sidecar';
  /** Soft markers surfaced in the UI: low confidence, unresolved branch, etc. */
  flags: NodeFlag[];
}

export type NodeFlag =
  | 'low-confidence'
  | 'unresolved-branch'
  | 'stale'
  | 'relocated'
  | 'broken'
  | 'dropped-by-sidecar';

export interface FlowEdge {
  from: string;
  to: string;
  /** Undefined for the plain sequential edge. */
  when?: string;
  kind: 'sequence' | 'branch';
}

export interface FlowDoc {
  skill: string;
  description: string;
  source: {
    file: string;
    sha: string;
    lines: number;
    generated_at: string;
  };
  schema_version: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
  sections: Array<{ id: string; title: string; level: number; start: number }>;
  /**
   * Phase columns, outermost first, derived from headings that name a phase.
   *
   * `release-checklist` writes `Phase 1：分支对比` / `Phase 2` / `Phase 3` and the
   * layout ignored all three, because depth came only from sequence edges. The
   * phase list is the structure the author already declared.
   */
  phases: Array<{ id: string; label: string; nodes: number }>;
  stats: {
    byType: Record<NodeType, number>;
    byLane: Record<Lane, number>;
    lowConfidence: number;
    stale: number;
    maxDepth: number;
  };
}

/** What a human may write in the sidecar to correct the machine's reading. */
export interface SidecarNodePatch {
  /** Match an extracted node by its line span. */
  anchor?: { start: number; end?: number };
  /** Match by label prefix, for humans who think in names. */
  label?: string;
  type?: NodeType;
  /** Replace the auto label. */
  rename?: string;
  /** Drop this unit from the graph. */
  ignore?: boolean;
  /** Force confidence to 1: "yes, this is really a gate". */
  confirm?: boolean;
  /** Hand-authored edges, by target label or line start. */
  then?: Array<{ when?: string; toLabel?: string; toStart?: number }>;
  branches?: Branch[];
}

export interface Sidecar {
  skill: string;
  /** Free-form note shown in the UI header. */
  note?: string;
  nodes?: SidecarNodePatch[];
}

export interface DriftReport {
  skill: string;
  ok: boolean;
  stale: Array<{
    id: string;
    label: string;
    /**
     * `moved`   the same text now sits elsewhere and the anchor followed it;
     * `edited`  the anchor is still where it was, but its text changed in place;
     * `broken`  the text is gone and nothing nearby resembles it.
     *
     * `edited` exists because without it every successful edit reported
     * `broken`, which made `annot check` scream after exactly the operation it
     * is supposed to verify — and a check that always fails is not a check.
     */
    reason: 'moved' | 'edited' | 'broken';
    from: number;
    to?: number;
  }>;
}
