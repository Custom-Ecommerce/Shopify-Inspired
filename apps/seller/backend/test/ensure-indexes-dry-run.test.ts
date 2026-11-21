import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
// @ts-expect-error plain .mjs module without types; tests are not type-checked
import * as noAutoNs from '../../../../scripts/lib/mongoose-no-auto.mjs';

// SB-6 (verification bug 1): the dry run of scripts/ensure-indexes.mjs used to create every collection and index, because Mongoose autoCreate and
// autoIndex build them when the connection opens. The script now imports scripts/lib/mongoose-no-auto.mjs above the models. These tests pin that
// without a database (each test file runs in its own process, so the global switch below does not leak into other tests).

const noAuto = ((noAutoNs as { default?: unknown }).default ?? noAutoNs) as { NO_AUTO_CONNECT_OPTIONS: Record<string, unknown> };
const scriptSource = readFileSync(join(process.cwd(), '..', '..', '..', 'scripts', 'ensure-indexes.mjs'), 'utf8');
const code = scriptSource
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

test('importing the no-auto module switches autoIndex and autoCreate off for every model compiled after it', async () => {
  assert.equal(mongoose.get('autoIndex'), false);
  assert.equal(mongoose.get('autoCreate'), false);
  assert.notEqual(new mongoose.Mongoose().get('autoIndex'), false, 'a Mongoose that did not import it keeps the default (on)');
  assert.notEqual(new mongoose.Mongoose().get('autoCreate'), false);
  assert.deepEqual({ ...noAuto.NO_AUTO_CONNECT_OPTIONS }, { autoIndex: false, autoCreate: false });
  // What a model does when it is compiled is what init() decides: with both options on it runs createCollection and ensureIndexes (the two calls
  // that built every collection and index on connect). The spies below stand in for the database. The connect options end up in connection.config,
  // which is what is simulated here (mongoose.connect(uri, options) puts them there); the global switch is read as well once the connection is up.
  const calls: string[] = [];
  const model$ = mongoose.Model as unknown as Record<string, unknown>;
  const saved = { createCollection: model$.createCollection, ensureIndexes: model$.ensureIndexes };
  model$.createCollection = async () => void calls.push('createCollection');
  model$.ensureIndexes = async () => void calls.push('ensureIndexes');
  try {
    const schema = () => {
      const probe = new mongoose.Schema({ store: String, phone: String });
      probe.index({ store: 1, phone: 1 }, { unique: true });
      return probe;
    };
    const quiet = mongoose.createConnection();
    Object.assign(quiet.config, noAuto.NO_AUTO_CONNECT_OPTIONS);
    await quiet.model('Sb6NoAutoProbe', schema()).init();
    assert.deepEqual(calls, [], 'no createCollection and no createIndexes: the dry run only reads');

    // The control: the same model on a connection that asks for both DOES run them, so the spies would have caught it.
    const loud = mongoose.createConnection();
    Object.assign(loud.config, { autoIndex: true, autoCreate: true });
    await loud.model('Sb6AutoProbe', schema()).init();
    assert.deepEqual(calls, ['createCollection', 'ensureIndexes']);
  } finally {
    model$.createCollection = saved.createCollection;
    model$.ensureIndexes = saved.ensureIndexes;
  }
});

test('ensure-indexes.mjs imports the no-auto module above the models and passes the options to connect', () => {
  const noAutoAt = scriptSource.indexOf("from './lib/mongoose-no-auto.mjs'");
  const modelsAt = scriptSource.indexOf("import '../packages/db-schemas/src/index.ts'");
  assert.ok(noAutoAt > 0 && modelsAt > 0, 'both imports are there');
  assert.ok(noAutoAt < modelsAt, 'the no-auto import runs before the models are compiled');
  assert.match(code, /mongoose\.connect\(uri, \{[^}]*\.\.\.NO_AUTO_CONNECT_OPTIONS/);
});

test('the dry run only reads: createIndexes is reached only after the dry-run return, and nothing creates a collection, syncs or drops', () => {
  const dryReturn = code.indexOf('if (!apply) return;');
  const create = code.indexOf('.createIndexes()');
  assert.ok(dryReturn > 0 && create > 0);
  assert.ok(dryReturn < create, 'the only createIndexes call is after "if (!apply) return"');
  assert.equal((code.match(/\.createIndexes\(\)/g) ?? []).length, 1);
  for (const forbidden of ['createCollection', 'syncIndexes', 'dropIndex', 'dropIndexes', 'ensureIndexes', 'autoIndex: true', 'autoCreate: true']) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }
});
