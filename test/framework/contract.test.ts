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
  assert.deepEqual(
    contract.resources.map((resource) => resource.kind),
    ['Account', 'Category', 'LedgerEntryGroup', 'LedgerEntry', 'TransactionStaging'],
  );
  const ledgerEntry = contract.resources.find((resource) => resource.kind === 'LedgerEntry');
  assert.ok(ledgerEntry);
  assert.equal(ledgerEntry.schema.spec.type, 'object');
  assert.ok(ledgerEntry.schema.spec.required?.includes('amount'));
  assert.match(JSON.stringify(ledgerEntry.schema.spec), /Exact signed decimal/);
  assert.deepEqual(ledgerEntry.relationships, [
    { field: 'groupId', targetKind: 'LedgerEntryGroup', cardinality: 'one', required: true },
    { field: 'fromAccountId', targetKind: 'Account', cardinality: 'one', required: true },
    { field: 'toAccountId', targetKind: 'Account', cardinality: 'one', required: true },
  ]);
  assert.ok(ledgerEntry.lifecycle.length > 0);
  assert.ok(ledgerEntry.effects.length > 0);

  const group = contract.resources.find((resource) => resource.kind === 'LedgerEntryGroup');
  assert.deepEqual(group?.relationships, [{
    field: 'ledgerEntryIds',
    targetKind: 'LedgerEntry',
    cardinality: 'many',
    required: true,
  }]);
  const account = contract.resources.find((resource) => resource.kind === 'Account');
  assert.ok(account?.schema.status.required?.includes('balance'));
  const staging = contract.resources.find((resource) => resource.kind === 'TransactionStaging');
  assert.ok(staging?.schema.status.required?.includes('state'));
  assert.deepEqual(staging?.relationships, [
    { field: 'fromAccountId', targetKind: 'Account', cardinality: 'one' },
    { field: 'toAccountId', targetKind: 'Account', cardinality: 'one' },
    { field: 'ledgerEntryId', targetKind: 'LedgerEntry', cardinality: 'one' },
  ]);
});
