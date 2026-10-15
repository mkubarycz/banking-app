import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegistry } from '../../src/app/registry.js';
import { applicationContract } from '../../src/contract.js';

test('publishes the 1.2 resource and operation contract', () => {
  const contract = applicationContract(createRegistry());
  assert.equal(contract.contractVersion, '3.0');
  assert.deepEqual(
    Object.keys(contract.envelope),
    ['kind', 'metadata', 'spec', 'status', 'relationships'],
  );
  assert.deepEqual(
    contract.resources.map((resource) => resource.kind),
    ['Account', 'Budget', 'Transaction', 'AccountKnownValue', 'ChangeSet'],
  );
  const transaction = contract.resources.find((resource) => resource.kind === 'Transaction');
  assert.ok(transaction?.schema.spec.required?.includes('amount'));
  assert.deepEqual(transaction?.relationships, [
    { field: 'fromAccountId', targetKind: 'Account', cardinality: 'one', required: true },
    { field: 'toAccountId', targetKind: 'Account', cardinality: 'one', required: true },
    { field: 'budgetId', targetKind: 'Budget', cardinality: 'one', required: true },
    { field: 'changeSetId', targetKind: 'ChangeSet', cardinality: 'one' },
  ]);
  const account = contract.resources.find((resource) => resource.kind === 'Account');
  assert.ok(account?.schema.status.required?.includes('directBalance'));
  assert.ok(account?.schema.status.required?.includes('descendantsBalance'));
  const budget = contract.resources.find((resource) => resource.kind === 'Budget');
  assert.ok(budget?.schema.status.required?.includes('budgeted'));
  assert.ok(budget?.schema.status.required?.includes('balance'));
  assert.ok(budget?.schema.status.required?.includes('balanceByMonth'));
  assert.ok(budget?.schema.spec.required?.includes('amount'));
  assert.ok(contract.application.capabilities.includes('atomic-change-sets'));
  assert.match(contract.operations.changeVersion, /change-version/);
});
