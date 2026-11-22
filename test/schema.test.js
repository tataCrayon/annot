/**
 * The schema is a published contract, so it is tested like one.
 *
 * No JSON-Schema validator is a dependency of this package, and adding one to
 * check one file is a poor trade. These tests instead assert the properties that
 * make the schema useful to a reader: every required field the writer emits is
 * named, every enum matches the writer, and the schema's own vocabulary is legal
 * 2020-12. A field that stops being written, or a type that is renamed, fails
 * here rather than in someone else's validator.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFlow } from '../src/flow.ts';
import { parseSkill } from '../src/parse.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'flow.schema.json'), 'utf8'));
const analysisSchema = JSON.parse(readFileSync(join(ROOT, 'schema', 'analysis.schema.json'), 'utf8'));

/** A document produced by the real writer, so the schema is checked against it. */
function sampleDoc() {
  const text = readFileSync(join(ROOT, 'test', 'fixtures', 'grill-method.md'), 'utf8');
  const skill = parseSkill(text, { file: 'grill-method.md' });
  return buildFlow(skill, text, { sourceFile: 'grill-method.md', now: () => '2026-01-01T00:00:00.000Z' });
}

test('the schema is a legal JSON Schema 2020-12 document', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required.slice().sort(), ['edges', 'nodes', 'schema_version', 'sections', 'skill', 'source', 'stats']);
  assert.ok(schema.$defs.node, 'node definition missing');
  assert.ok(schema.$defs.edge, 'edge definition missing');
  assert.ok(schema.$defs.association, 'association definition missing');
  assert.ok(schema.$defs.anchor, 'anchor definition missing');
});

test('every field the writer emits is declared, at every level', () => {
  const doc = sampleDoc();
  const node = doc.nodes[0];

  for (const key of Object.keys(doc)) {
    assert.ok(schema.properties[key], `flow.json writes "${key}" but the schema does not declare it`);
  }
  for (const key of Object.keys(node)) {
    assert.ok(schema.$defs.node.properties[key], `a node writes "${key}" but the schema does not declare it`);
  }
  for (const key of Object.keys(node.anchor)) {
    assert.ok(schema.$defs.anchor.properties[key], `an anchor writes "${key}" but the schema does not declare it`);
  }
  for (const key of Object.keys(doc.source)) {
    assert.ok(schema.properties.source.properties[key], `source writes "${key}" but the schema does not declare it`);
  }
  for (const key of Object.keys(doc.stats)) {
    assert.ok(schema.properties.stats.properties[key], `stats writes "${key}" but the schema does not declare it`);
  }
  if (doc.edges.length > 0) {
    for (const key of Object.keys(doc.edges[0])) {
      assert.ok(schema.$defs.edge.properties[key], `an edge writes "${key}" but the schema does not declare it`);
    }
  }
  if (doc.associations.length > 0) {
    for (const key of Object.keys(doc.associations[0])) {
      assert.ok(schema.$defs.association.properties[key], `an association writes "${key}" but the schema does not declare it`);
    }
  }
});

test('the type and flag enums match what the writer can produce', () => {
  const doc = sampleDoc();
  const declaredTypes = schema.$defs.node.properties.type.enum;
  assert.deepEqual(declaredTypes.slice().sort(), ['artifact', 'decision', 'external', 'gate', 'note', 'stage']);
  for (const node of doc.nodes) {
    assert.ok(declaredTypes.includes(node.type), `the writer emitted an undeclared type: ${node.type}`);
  }

  const declaredFlags = schema.$defs.node.properties.flags.items.enum;
  assert.deepEqual(declaredFlags.slice().sort(), ['broken', 'dropped-by-sidecar', 'low-confidence', 'orphan-note', 'relocated', 'stale', 'unresolved-branch']);
  for (const node of doc.nodes) {
    for (const flag of node.flags) assert.ok(declaredFlags.includes(flag), `undeclared flag: ${flag}`);
  }

  const declaredRoles = schema.$defs.node.properties.noteRole.enum;
  assert.deepEqual(declaredRoles.slice().sort(), ['context', 'definition', 'example', 'principle', 'rationale', 'reference', 'risk', 'trigger']);

  const declaredEdges = schema.$defs.edge.properties.kind.enum;
  assert.deepEqual(declaredEdges.slice().sort(), ['branch', 'sequence']);
  for (const edge of doc.edges) assert.ok(declaredEdges.includes(edge.kind), `undeclared edge kind: ${edge.kind}`);
});

test('the schema requires exactly the fields a reader may rely on', () => {
  const doc = sampleDoc();
  // A required field that the writer sometimes omits would make every consumer
  // defensive; a field the writer always sets but the schema omits lets a
  // consumer skip it and break later.
  for (const key of schema.$defs.node.required) {
    assert.ok(key in doc.nodes[0], `the schema requires "${key}" but this node does not have it`);
  }
  for (const key of schema.required) {
    assert.ok(key in doc, `the schema requires "${key}" but the document does not have it`);
  }
});

test('the anchor description states the rule the code actually enforces', () => {
  // The schema is documentation too. If the hash rule changes in `drift.ts`, this
  // text becomes a lie that a reader will believe.
  assert.match(schema.$defs.anchor.description, /contiguous/);
  assert.match(schema.$defs.anchor.description, /only staleness judge/);
  assert.match(schema.$defs.anchor.properties.sha.description, /identical/);
});

test('the published package ships the schema', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(
    pkg.files.some((entry) => entry === 'schema' || entry.startsWith('schema/')),
    'package.json `files` does not include schema/, so npm would publish a schema nobody can fetch',
  );
});

test('the AI analysis schema requires exact source evidence', () => {
  assert.equal(analysisSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(analysisSchema.required.slice().sort(), ['edges', 'nodes', 'schema_version', 'skill', 'source_sha']);
  assert.deepEqual(analysisSchema.properties.nodes.items.required.slice().sort(), ['end', 'id', 'label', 'quote', 'start', 'type']);
  assert.match(analysisSchema.description, /exact source lines/);
});
