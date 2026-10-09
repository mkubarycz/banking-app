import assert from 'node:assert/strict';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { summarizeLedger } from '../../src/app/dashboard.js';
import { DEFAULT_IDS } from '../../src/app/ledger-store.js';
import { cents, money } from '../../src/app/money.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

test('uses exact cents and canonical decimal strings', () => {
  assert.equal(cents('9007199254740993.01'), 900719925474099301n);
  assert.equal(money(-12345n), '-123.45');
  assert.throws(() => createRegistry().get('LedgerEntry').spec.parse({ amount: 0.1 }));
});

test('migrates aggregate rows into groups with child ledger entries', () => {
  const store = new ResourceStore(':memory:');
  try {
    store.database.exec(`
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY, entry_at INTEGER NOT NULL, description TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL, revenue_cents INTEGER NOT NULL,
        expenses_cents INTEGER NOT NULL, reinvested_cents INTEGER NOT NULL,
        opening_cash_cents INTEGER, note TEXT, source_json TEXT, committed_at INTEGER,
        deleted INTEGER NOT NULL, resource_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO ledger_entries VALUES
        ('11111111-1111-4111-8111-111111111111', 1767225600000, 'Legacy', 'Realized',
         10000, 40000, 5000, NULL, NULL, NULL, 100, 0, 1, 50, 100);
    `);
    const service = new BankingResourceService(createRegistry(), store);
    const groups = service.query('LedgerEntryGroup', undefined).result;
    const entries = service.query('LedgerEntry', undefined).result;
    assert.equal(groups.length, 1);
    assert.equal(entries.length, 3);
    assert.deepEqual(groups[0].status, {
      income: '100.00',
      expense: '400.00',
      transfers: '50.00',
      cashDelta: '-350.00',
      operatingCashFlow: '-300.00',
      cashOnHand: '-350.00',
      dirty: false,
      committedAt: new Date(100).toISOString(),
      deleted: false,
      previousSpec: undefined,
    });
    assert.equal(entries[1].relationships.fromAccountId, DEFAULT_IDS.cashAccount);
    assert.equal(entries[1].relationships.toAccountId, DEFAULT_IDS.accountsPayableAccount);
  } finally {
    store.close();
  }
});

test('summarizes derived group totals', () => {
  const groups = [{
    kind: 'LedgerEntryGroup',
    metadata: { id: '1', createdAt: '', updatedAt: '', resourceVersion: 1 },
    spec: { status: 'Realized', date: '2026-01-01', description: 'Group' },
    status: { income: '1000.00', expense: '250.00' },
    relationships: { ledgerEntryIds: ['entry'] },
  }];
  assert.deepEqual(summarizeLedger(groups, '2026').total, {
    income: '1000.00',
    expense: '250.00',
    operatingCashFlow: '750.00',
    activeEntryCount: 1,
  });
});
