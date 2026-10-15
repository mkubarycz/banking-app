import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { summarizeTransactions } from '../../src/app/dashboard.js';
import { DEFAULT_IDS } from '../../src/app/ledger-store.js';
import { cents, money } from '../../src/app/money.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

test('uses exact cents and canonical decimal strings', () => {
  assert.equal(cents('9007199254740993.01'), 900719925474099301n);
  assert.equal(money(-12345n), '-123.45');
  assert.throws(() => createRegistry().get('Transaction').spec.parse({
    date: '2026-01-01',
    description: 'Invalid',
    amount: 0.1,
  }));
});

test('anchors direct account values and exposes virtual unreconciled amounts', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const transactions = service.createChangeSet('Transactions').result;
    service.create({
      kind: 'Transaction',
      spec: { date: '2026-01-10', description: 'Deposit', amount: '250.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.receivableAccount,
        toAccountId: DEFAULT_IDS.cashAccount,
        budgetId: DEFAULT_IDS.uncategorizedBudget,
        changeSetId: transactions.metadata.id,
      },
    });

    service.commitChangeSet(transactions.metadata.id, transactions.metadata.resourceVersion);

    const knownSet = service.createChangeSet('Known value').result;
    const known = service.create({
      kind: 'AccountKnownValue',
      spec: { date: '2026-01-31', value: '1500.00', note: 'Portal balance' },
      relationships: {
        accountId: DEFAULT_IDS.cashAccount,
        changeSetId: knownSet.metadata.id,
      },
    }).result;
    service.commitChangeSet(knownSet.metadata.id, knownSet.metadata.resourceVersion);
    const calculated = service.get('AccountKnownValue', known.metadata.id).result;
    assert.equal(calculated.status.calculatedValue, '250.00');
    assert.equal(calculated.status.unreconciledAmount, '1250.00');
    assert.equal(calculated.status.severity, 'High');
    const account = service.get('Account', DEFAULT_IDS.cashAccount).result;
    assert.equal(account.status.directBalance, '1500.00');
    assert.equal(account.status.unreconciledAmount, '1250.00');
    const updated = service.update({
      kind: 'AccountKnownValue',
      id: calculated.metadata.id,
      expectedResourceVersion: calculated.metadata.resourceVersion,
      spec: { ...calculated.spec, value: '1600.00' },
      status: calculated.status,
      relationships: calculated.relationships,
    }).result;
    assert.equal(updated.status.state, 'Draft');
    const pendingValue = service.query('AccountKnownValue', undefined).result.find(
      (item) => item.metadata.id === calculated.metadata.id,
    );
    assert.equal(pendingValue?.status.unreconciledAmount, '1350.00');
    const updateSet = service.get('ChangeSet', String(updated.relationships.changeSetId)).result;
    service.commitChangeSet(updateSet.metadata.id, updateSet.metadata.resourceVersion);
    assert.equal(service.get('AccountKnownValue', calculated.metadata.id).result.spec.value, '1600.00');

    const deleted = service.delete({
      kind: 'AccountKnownValue',
      id: calculated.metadata.id,
      expectedResourceVersion: service.get('AccountKnownValue', calculated.metadata.id).result.metadata.resourceVersion,
    }).result;
    assert.equal(deleted.status.deleted, true);
    const deleteSet = service.get('ChangeSet', String(deleted.relationships.changeSetId)).result;
    service.commitChangeSet(deleteSet.metadata.id, deleteSet.metadata.resourceVersion);
    assert.equal(service.query('AccountKnownValue', undefined).result.some(
      (item) => item.metadata.id === calculated.metadata.id,
    ), false);
  } finally {
    store.close();
  }
});

test('marks unreconciled amounts at exactly one thousand dollars as high severity', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Known balance threshold').result;
    service.create({
      kind: 'AccountKnownValue',
      spec: { date: '2026-01-01', value: '1000.00' },
      relationships: {
        accountId: DEFAULT_IDS.cashAccount,
        changeSetId: changeSet.metadata.id,
      },
    });
    service.commitChangeSet(changeSet.metadata.id, changeSet.metadata.resourceVersion);
    const value = service.query('AccountKnownValue', undefined).result.find(
      (item) => item.spec.date === '2026-01-01',
    );
    assert.equal(value?.status.unreconciledAmount, '1000.00');
    assert.equal(value?.status.severity, 'High');
  } finally {
    store.close();
  }
});

test('reconciles parent known values against descendant balances without double counting', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Parent reconciliation').result;
    const child = service.create({
      kind: 'Account',
      spec: { name: 'Child cash', currency: 'USD', internal: true },
      relationships: {
        parentAccountId: DEFAULT_IDS.cashAccount,
        changeSetId: changeSet.metadata.id,
      },
    }).result;
    service.create({
      kind: 'AccountKnownValue',
      spec: { date: '2026-01-31', value: '1000.00' },
      relationships: { accountId: child.metadata.id, changeSetId: changeSet.metadata.id },
    });
    const parentKnown = service.create({
      kind: 'AccountKnownValue',
      spec: { date: '2026-01-31', value: '1000.00' },
      relationships: { accountId: DEFAULT_IDS.cashAccount, changeSetId: changeSet.metadata.id },
    }).result;
    service.commitChangeSet(changeSet.metadata.id, changeSet.metadata.resourceVersion);

    const reconciliation = service.get('AccountKnownValue', parentKnown.metadata.id).result;
    assert.equal(reconciliation.status.calculatedValue, '1000.00');
    assert.equal(reconciliation.status.unreconciledAmount, '0.00');
    const parent = service.get('Account', DEFAULT_IDS.cashAccount).result;
    assert.equal(parent.status.directBalance, '0.00');
    assert.equal(parent.status.descendantsBalance, '1000.00');
    assert.equal(parent.status.totalBalance, '1000.00');
  } finally {
    store.close();
  }
});

test('summarizes committed transactions by month and classification', () => {
  const transactions = [{
    kind: 'Transaction',
    metadata: { id: '1', createdAt: '', updatedAt: '', resourceVersion: 1 },
    spec: { date: '2026-01-01', description: 'Income', amount: '1000.00' },
    status: { state: 'Committed', classification: 'Income' },
    relationships: {},
  }, {
    kind: 'Transaction',
    metadata: { id: '2', createdAt: '', updatedAt: '', resourceVersion: 1 },
    spec: { date: '2026-01-02', description: 'Expense', amount: '250.00' },
    status: { state: 'Committed', classification: 'Expense' },
    relationships: {},
  }];
  assert.deepEqual(summarizeTransactions(transactions, '2026').total, {
    income: '1000.00',
    expense: '250.00',
    operatingCashFlow: '750.00',
    transactionCount: 2,
  });
});

test('restores spreadsheet projection rows with historical running cash', () => {
    const directory = mkdtempSync(join(tmpdir(), 'banking-legacy-ledger-'));
    const sourcePath = join(directory, 'legacy.sqlite');
    const source = new DatabaseSync(sourcePath);
    source.exec(`
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY,
        entry_at INTEGER NOT NULL,
        description TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        revenue_cents INTEGER NOT NULL,
        expenses_cents INTEGER NOT NULL,
        reinvested_cents INTEGER NOT NULL,
        opening_cash_cents INTEGER,
        deleted INTEGER NOT NULL
      );
      CREATE TABLE resources (
        id TEXT PRIMARY KEY,
        spec TEXT NOT NULL
      );
      CREATE TABLE ledger_items (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        from_account_id TEXT NOT NULL,
        to_account_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE transaction_staging (
        id TEXT PRIMARY KEY,
        ledger_entry_id TEXT,
        transaction_at INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        source_account TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_status TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO resources VALUES
        ('cash', '{"name":"Cash","internal":true}'),
        ('income-account', '{"name":"Salary Income","internal":false}'),
        ('expense-account', '{"name":"Mortgage Expense","internal":false}');
    `);
    const insert = source.prepare(`
      INSERT INTO ledger_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run('opening', Date.parse('2025-12-31'), 'Opening', 'Realized', 0, 0, 0, 100000, 0);
    insert.run('income', Date.parse('2026-01-15'), 'Salary', 'Realized', 25000, 0, 0, null, 0);
    insert.run('expense', Date.parse('2026-02-01'), 'Mortgage', 'Planned', 0, 40000, 0, null, 0);
    insert.run('deleted', Date.parse('2026-02-02'), 'Deleted', 'Realized', 10000, 0, 0, null, 1);
    source.exec(`
      INSERT INTO ledger_items VALUES
        ('income-item', 'income', 'income-account', 'cash', 25000, NULL, 1),
        ('expense-item', 'expense', 'cash', 'expense-account', 40000, 'Monthly payment', 2);
      INSERT INTO transaction_staging VALUES
        ('staged-expense', 'expense-item', 1769904000000, 'Mortgage payment', -40000,
         'Checking', 'Mortgage', 'posted', 'Reconciled', 1);
    `);
    source.close();

    const store = new ResourceStore(':memory:');
    const service = new BankingResourceService(createRegistry(), store);
    try {
      assert.deepEqual(service.importLegacyProjection(sourcePath).result, {
        imported: 3,
        total: 3,
      });
      assert.deepEqual(service.importLegacyProjection(sourcePath).result, {
        imported: 0,
        total: 3,
      });
      assert.deepEqual(service.ledger({
        from: '2026-01-01',
        through: '2026-12-31',
      }).result.map((row) => ({
        id: row.id,
        status: row.status,
        description: row.description,
        date: row.date,
        fromAccount: row.fromAccount,
        toAccount: row.toAccount,
        amount: row.amount,
        flow: row.flow,
        note: row.note,
        staging: row.staging,
        revenue: row.revenue,
        expenses: row.expenses,
        cashOnHand: row.cashOnHand,
        sourceKind: row.sourceKind,
      })), [{
        id: 'projection-item:expense-item',
        status: 'Planned',
        description: 'Mortgage',
        date: '2026-02-01',
        fromAccount: 'Cash',
        toAccount: 'Mortgage Expense',
        amount: '400.00',
        flow: 'Expense',
        note: 'Monthly payment',
        staging: [{
          date: '2026-02-01',
          description: 'Mortgage payment',
          amount: '400.00',
          sourceAccount: 'Checking',
          sourceType: 'Mortgage',
          sourceStatus: 'posted',
          state: 'Reconciled',
        }],
        revenue: '0.00',
        expenses: '400.00',
        cashOnHand: '850.00',
        sourceKind: 'Projection',
      }, {
        id: 'projection-item:income-item',
        status: 'Realized',
        description: 'Salary',
        date: '2026-01-15',
        fromAccount: 'Salary Income',
        toAccount: 'Cash',
        amount: '250.00',
        flow: 'Income',
        note: undefined,
        staging: [],
        revenue: '250.00',
        expenses: '0.00',
        cashOnHand: '1250.00',
        sourceKind: 'Projection',
      }]);
      assert.deepEqual(service.ledger({
        status: 'Not realized',
        search: 'mort',
      }).result.map((row) => row.description), ['Mortgage']);
      const updated = service.updateLedgerItem({
        id: 'projection-item:expense-item',
        amount: '400.01',
        description: 'Updated mortgage',
        status: 'Estimated',
        actor: 'ledger-test',
      }).result;
      assert.equal(updated.amount, '400.01');
      assert.equal(updated.description, 'Updated mortgage');
      assert.equal(updated.status, 'Estimated');
      assert.equal(updated.cashOnHand, '849.99');
      assert.equal(
        service.ledger().result.some((row) => row.id === 'projection-adjustment:expense'),
        false,
      );
      const event = store.database.prepare(`
        SELECT event_type, resource_kind, resource_id
        FROM domain_events
        WHERE resource_id = 'projection-item:expense-item'
      `).get() as Record<string, unknown>;
      assert.equal(event.event_type, 'LedgerItem.updated');
      assert.equal(event.resource_kind, 'LedgerItem');
      assert.equal(event.resource_id, 'projection-item:expense-item');
      assert.throws(() => service.ledger({
        from: '2026-03-01',
        through: '2026-02-01',
      }), /from cannot be after through/);
    } finally {
      store.close();
      rmSync(directory, { recursive: true });
    }
});
