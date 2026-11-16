/**
 * Dev-only probe: print a flow doc as a table so a human can judge whether the
 * extractor read the skill correctly. Not part of the shipped CLI surface.
 *
 *   node tools/inspect.ts <flow.json> [--branches]
 *
 * The `id` column matters: node ids are what `annot context` and the sidecar
 * take, and they are derived from labels — so a label change silently renames
 * the id, which is exactly the kind of thing a reviewer needs to see.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { FlowDoc } from '../src/types.ts';

const args = process.argv.slice(2);
const showBranches = args.includes('--branches');
const path = resolve(args.find((a) => !a.startsWith('--')) ?? '');
const doc = JSON.parse(await readFile(path, 'utf8')) as FlowDoc;

const width = Math.min(52, Math.max(...doc.nodes.map((n) => n.label.length)));
const idWidth = Math.min(30, Math.max(...doc.nodes.map((n) => n.id.length)));
const unresolved = doc.edges.filter((e) => e.kind === 'branch').length;

process.stdout.write(`${doc.skill}  nodes=${doc.nodes.length} edges=${doc.edges.length} branch-edges=${unresolved}\n`);
process.stdout.write(
  `${'line'.padStart(7)}  ${'type'.padEnd(9)}  ${'conf'.padStart(4)}  ${'id'.padEnd(idWidth)}  label\n`,
);

for (const node of doc.nodes) {
  const flags = node.flags.length ? ` [${node.flags.join(',')}]` : '';
  const span = node.anchor.start === node.anchor.end ? `${node.anchor.start}` : `${node.anchor.start}-${node.anchor.end}`;
  const label = node.label.length > width ? `${node.label.slice(0, width - 1)}…` : node.label;
  process.stdout.write(
    `${span.padStart(7)}  ${node.type.padEnd(9)}  ${String(Math.round(node.confidence * 100)).padStart(3)}%  ` +
      `${node.id.padEnd(idWidth)}  ${label}${flags}\n`,
  );

  if (node.raw.split('\n').every((line) => /^\s*(```|~~~)/.test(line) || line.trim() === '')) {
    process.stdout.write(`         !! raw is only fence lines: ${JSON.stringify(node.raw)}\n`);
  }

  if (showBranches) {
    for (const branch of node.branches) {
      const target = branch.to ? `→ ${branch.to}` : '→ (unresolved)';
      process.stdout.write(`         branch  ${JSON.stringify(branch.when)} ${target}\n`);
    }
  }
}

const orphans = doc.nodes.filter((n) => !doc.edges.some((e) => e.from === n.id || e.to === n.id));
if (orphans.length > 0) {
  process.stdout.write(`\n${orphans.length} node(s) with no edge: ${orphans.map((n) => n.id).join(', ')}\n`);
}
