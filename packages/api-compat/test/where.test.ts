
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhere, WhereParseError, WHERE_OPERATORS } from '../src/where';

test('equals keeps the raw string', () => {
  assert.deepEqual(parseWhere(new URLSearchParams('where[status][equals]=active')), [
    { field: 'status', operator: 'equals', value: 'active' },
  ]);
});

test('in splits a comma list and trims each value', () => {
  const clauses = parseWhere(new URLSearchParams('where[status][in]=active, suspended ,'));
  assert.deepEqual(clauses[0].value, ['active', 'suspended']);
});

test('like keeps the pattern as written', () => {
  assert.deepEqual(parseWhere(new URLSearchParams('where[title][like]=shirt')), [
    { field: 'title', operator: 'like', value: 'shirt' },
  ]);
});

test('greater_than_equal and less_than_equal parse numbers', () => {
  const clauses = parseWhere(new URLSearchParams('where[price][greater_than_equal]=10&where[price][less_than_equal]=99.5'));
  assert.deepEqual(clauses.map((c) => c.value), [10, 99.5]);
});

test('exists parses true and false', () => {
  const clauses = parseWhere(new URLSearchParams('where[media][exists]=true&where[slug][exists]=false'));
  assert.deepEqual(clauses.map((c) => c.value), [true, false]);
});

test('non-where parameters are ignored', () => {
  const clauses = parseWhere(new URLSearchParams('page=2&limit=10&where[status][equals]=active'));
  assert.equal(clauses.length, 1);
});

test('clauses keep the order they arrive in', () => {
  const clauses = parseWhere(new URLSearchParams('where[b][equals]=2&where[a][equals]=1'));
  assert.deepEqual(clauses.map((c) => c.field), ['b', 'a']);
});

test('an unknown operator is rejected and named', () => {
  assert.throws(
    () => parseWhere(new URLSearchParams('where[status][regex]=x')),
    (err: unknown) => err instanceof WhereParseError && /unknown operator "regex"/.test((err as Error).message) && (err as WhereParseError).field === 'status',
  );
});

test('a where key without an operator is malformed', () => {
  assert.throws(() => parseWhere(new URLSearchParams('where[status]=active')), /malformed where clause/);
});

test('a bare where key is malformed', () => {
  assert.throws(() => parseWhere(new URLSearchParams('where=active')), /malformed where clause/);
});

test('a field name with a dollar sign is rejected', () => {
  assert.throws(
    () => parseWhere(new URLSearchParams('where[$where][equals]=x')),
    (err: unknown) => err instanceof WhereParseError && (err as WhereParseError).field === '$where',
  );
});

test('exists rejects a value that is not true or false', () => {
  assert.throws(() => parseWhere(new URLSearchParams('where[media][exists]=yes')), /must be true or false/);
});

test('a numeric operator rejects a non-numeric value and names the field', () => {
  assert.throws(
    () => parseWhere(new URLSearchParams('where[price][greater_than_equal]=cheap')),
    (err: unknown) => err instanceof WhereParseError && (err as WhereParseError).field === 'price',
  );
});

test('in rejects an empty list', () => {
  assert.throws(() => parseWhere(new URLSearchParams('where[status][in]=,')), /needs at least one value/);
});

test('the supported operator set is exactly the six the frontend uses', () => {
  assert.deepEqual([...WHERE_OPERATORS], ['equals', 'in', 'like', 'greater_than_equal', 'less_than_equal', 'exists']);
});
