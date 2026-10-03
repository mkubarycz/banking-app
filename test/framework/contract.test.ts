import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegistry } from '../../src/app/registry.js';
import { applicationContract } from '../../src/contract.js';

test('publishes the approved envelope and Zod-derived app resource schemas', () => {
  const contract = applicationContract(createRegistry());
  assert.deepEqual(
    Object.keys(contract.envelope),
    ['kind', 'metadata', 'spec', 'status', 'relationships'],
  );
  assert.equal(contract.application.dataOwnership, 'application');
  const resource = contract.resources[0];
  assert.ok(resource);
  assert.equal(resource.kind, 'LedgerEntry');
  assert.equal(resource.schema.spec.type, 'object');
  assert.ok(resource.schema.spec.required?.includes('status'));
  assert.ok(resource.schema.spec.required?.includes('revenue'));
  assert.match(JSON.stringify(resource.schema.spec), /Exact signed decimal/);
  assert.ok(resource.lifecycle.length > 0);
  assert.ok(resource.effects.length > 0);
});
