/**
 * Dev-only probe: show how one SKILL.md is segmented, with the raw text of each
 * unit, so a fixture that extracts wrongly can be diagnosed in one look.
 *
 *   node tools/explain.ts <SKILL.md>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';

const path = resolve(process.argv[2] ?? '');
const text = await readFile(path, 'utf8');
const doc = buildFlow(parseSkill(text), text, { sourceFile: 'SKILL.md' });

process.stdout.write(`${doc.skill}: ${doc.nodes.length} nodes\n\n`);
for (const node of doc.nodes) {
  const span = node.anchor.start === node.anchor.end ? `${node.anchor.start}` : `${node.anchor.start}-${node.anchor.end}`;
  process.stdout.write(`[${span}] ${node.type} ${Math.round(node.confidence * 100)}%  ${node.label}\n`);
  for (const line of node.raw.split('\n').slice(0, 6)) {
    process.stdout.write(`        | ${line}\n`);
  }
  if (node.raw.split('\n').length > 6) process.stdout.write('        | …\n');
  process.stdout.write('\n');
}
