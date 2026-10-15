import assert from 'node:assert/strict';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { DEFAULT_IDS } from '../../src/app/ledger-store.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

test('commits and discards change sets atomically', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const createSet = service.createChangeSet('Create transaction').result;
    service.create({
      kind: 'Transaction',
      spec: { date: '2026-01-01', description: 'Expense', amount: '400.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.payableAccount,
        budgetId: DEFAULT_IDS.uncategorizedBudget,
        changeSetId: createSet.metadata.id,
      },
    });
    assert.equal(service.get('ChangeSet', createSet.metadata.id).result.status.changeCount, 1);
    service.commitChangeSet(createSet.metadata.id, createSet.metadata.resourceVersion);
    const transaction = service.query('Transaction', undefined).result[0];
    assert.equal(transaction.status.state, 'Committed');
    assert.equal(service.get('Account', DEFAULT_IDS.cashAccount).result.status.directBalance, '-400.00');

    const budgetSet = service.createChangeSet('Create mortgage budget').result;
    const mortgage = service.create({
      kind: 'Budget',
      spec: { name: 'Mortgage', amount: '0.00' },
      relationships: { changeSetId: budgetSet.metadata.id },
    }).result;
    service.commitChangeSet(budgetSet.metadata.id, budgetSet.metadata.resourceVersion);

    const updated = service.update({
      kind: 'Transaction',
      id: transaction.metadata.id,
      expectedResourceVersion: transaction.metadata.resourceVersion,
      spec: transaction.spec,
      status: transaction.status,
      relationships: { ...transaction.relationships, budgetId: mortgage.metadata.id },
    }).result;
    const updateSet = service.get('ChangeSet', String(updated.relationships.changeSetId)).result;
    assert.equal(service.get('Account', DEFAULT_IDS.cashAccount).result.status.directBalance, '-400.00');
    assert.equal(service.get('Budget', mortgage.metadata.id).result.status.realized, '400.00');
    service.discardChangeSet(updateSet.metadata.id, updateSet.metadata.resourceVersion);
    assert.equal(service.query('Transaction', undefined).result[0].spec.amount, '400.00');
    assert.equal(service.get('Account', DEFAULT_IDS.cashAccount).result.status.directBalance, '-400.00');
  } finally {
    store.close();
  }
});

test('requires compare-and-swap resource versions', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const account = service.get('Account', DEFAULT_IDS.cashAccount).result;
    assert.throws(() => service.update({
      kind: 'Account',
      id: account.metadata.id,
      expectedResourceVersion: account.metadata.resourceVersion + 1,
      spec: account.spec,
      status: account.status,
      relationships: account.relationships,
    }), /version conflict/);
  } finally {
    store.close();
  }
});
