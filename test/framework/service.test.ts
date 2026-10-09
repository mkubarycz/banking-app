import assert from 'node:assert/strict';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { DEFAULT_IDS } from '../../src/app/ledger-store.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

test('commits and restores grouped child-entry changes atomically', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const created = service.createGroup({
      status: 'Realized', date: '2026-01-01', description: 'Expense',
    }, [{
      spec: { amount: '400.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.accountsPayableAccount,
      },
    }]).result;
    const committed = service.commit([created.metadata.id]).result[0];
    assert.equal(committed.status.dirty, false);
    const entryIds = committed.relationships.ledgerEntryIds as string[];
    const entry = service.get('LedgerEntry', entryIds[0]).result;
    service.update({
      kind: 'LedgerEntry',
      id: entry.metadata.id,
      expectedResourceVersion: entry.metadata.resourceVersion,
      spec: { amount: '450.00' },
      status: {},
      relationships: entry.relationships,
    });
    assert.equal(service.get('LedgerEntryGroup', created.metadata.id).result.status.expense, '450.00');
    service.discard([created.metadata.id]);
    assert.equal(service.get('LedgerEntryGroup', created.metadata.id).result.status.expense, '400.00');
    assert.equal(service.query('LedgerEntry', undefined).result[0].spec.amount, '400.00');
  } finally {
    store.close();
  }
});

test('prevents removing the final child entry from a group', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const group = service.createGroup({
      status: 'Realized', date: '2026-01-01', description: 'One entry',
    }, [{
      spec: { amount: '1.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.accountsPayableAccount,
      },
    }]).result;
    const entryIds = group.relationships.ledgerEntryIds as string[];
    const entry = service.get('LedgerEntry', entryIds[0]).result;
    assert.throws(() => service.delete({
      kind: 'LedgerEntry',
      id: entry.metadata.id,
      expectedResourceVersion: entry.metadata.resourceVersion,
    }), /retain at least one/);
  } finally {
    store.close();
  }
});
