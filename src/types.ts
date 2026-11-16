/**
 * The three artifacts annot owns. SKILL.md is the only source of truth;
 * flow.json is a derived projection that carries an anchored copy of the
 * source text, so a stale projection can always be relocated or reported
 * instead of silently re-guessed.
 */

export type NodeType = 'stage' | 'decision' | 'gate' | 'artifact' | 'external';

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
  /** Body of the node as shown in the UI; trimmed source text. */
  text: string;
  /** Exact source lines, used to relocate the anchor after an edit. */
  raw: string;
  anchor: Anchor;
  branches: Branch[];
  /** How sure the extractor is that this unit really is this type, 0..1. */
  confidence: number;
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
  stats: {
    byType: Record<NodeType, number>;
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
  stale: Array<{ id: string; label: string; reason: 'moved' | 'broken'; from: number; to?: number }>;
}
