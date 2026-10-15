import assert from 'node:assert/strict';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import {
  DEFAULT_IDS,
  accountDisplayOrders,
  initializeBankingSchema,
} from '../../src/app/ledger-store.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

test('derives transaction classification and hierarchical account balances', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Build account tree').result;
    const parent = service.create({
      kind: 'Account',
      spec: { name: 'Banking', currency: 'USD', internal: true },
      relationships: { changeSetId: changeSet.metadata.id },
    }).result;
    const checking = service.create({
      kind: 'Account',
      spec: { name: 'Checking', currency: 'USD', internal: true },
      relationships: {
        parentAccountId: parent.metadata.id,
        changeSetId: changeSet.metadata.id,
      },
    }).result;
    service.create({
      kind: 'Transaction',
      spec: { date: '2026-01-01', description: 'Paycheck', amount: '1000.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.receivableAccount,
        toAccountId: checking.metadata.id,
        budgetId: DEFAULT_IDS.uncategorizedBudget,
        changeSetId: changeSet.metadata.id,
      },
    });
    assert.equal(service.get('Account', checking.metadata.id).result.status.totalBalance, '1000.00');
    service.commitChangeSet(changeSet.metadata.id, changeSet.metadata.resourceVersion);

    const transaction = service.query('Transaction', undefined).result[0];
    assert.equal(transaction.status.classification, 'Income');
    assert.equal(service.get('Account', checking.metadata.id).result.status.directBalance, '1000.00');
    const parentBalance = service.get('Account', parent.metadata.id).result.status;
    assert.equal(parentBalance.directBalance, '0.00');
    assert.equal(parentBalance.descendantsBalance, '1000.00');
    assert.equal(parentBalance.totalBalance, '1000.00');
  } finally {
    store.close();
  }
});

test('rejects cycles in account and budget hierarchies', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Hierarchy').result;
    const parent = service.create({
      kind: 'Account',
      spec: { name: 'Parent', currency: 'USD', internal: true },
      relationships: { changeSetId: changeSet.metadata.id },
    }).result;
    const child = service.create({
      kind: 'Account',
      spec: { name: 'Child', currency: 'USD', internal: true },
      relationships: {
        parentAccountId: parent.metadata.id,
        changeSetId: changeSet.metadata.id,
      },
    }).result;
    assert.throws(() => service.update({
      kind: 'Account',
      id: parent.metadata.id,
      expectedResourceVersion: parent.metadata.resourceVersion,
      spec: parent.spec,
      status: parent.status,
      relationships: {
        parentAccountId: child.metadata.id,
        changeSetId: changeSet.metadata.id,
      },
    }), /cycle/);
  } finally {
    store.close();
  }
});

test('reports exact pending fields against committed baselines', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Adjust accounts').result;
    const cash = service.get('Account', DEFAULT_IDS.cashAccount).result;
    service.update({
      kind: 'Account',
      id: cash.metadata.id,
      expectedResourceVersion: cash.metadata.resourceVersion,
      spec: { ...cash.spec, name: 'Operating Cash' },
      status: cash.status,
      relationships: { ...cash.relationships, changeSetId: changeSet.metadata.id },
    });
    const created = service.create({
      kind: 'Account',
      spec: { name: 'Savings', currency: 'USD', internal: true },
      relationships: { changeSetId: changeSet.metadata.id },
    }).result;

    const pending = service.pendingChanges().result;
    assert.deepEqual(
      pending.find((change) => change.resourceId === cash.metadata.id),
      {
        changeSetId: changeSet.metadata.id,
        changeSetResourceVersion: changeSet.metadata.resourceVersion,
        resourceKind: 'Account',
        resourceId: cash.metadata.id,
        action: 'update',
        changedFields: ['spec.name'],
      },
    );
    assert.deepEqual(
      pending.find((change) => change.resourceId === created.metadata.id),
      {
        changeSetId: changeSet.metadata.id,
        changeSetResourceVersion: changeSet.metadata.resourceVersion,
        resourceKind: 'Account',
        resourceId: created.metadata.id,
        action: 'create',
        changedFields: ['spec.name', 'spec.currency', 'spec.internal'],
      },
    );
  } finally {
    store.close();
  }
});

test('updates account display order immediately without a Change Set', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    assert.equal('order' in service.get('Account', DEFAULT_IDS.cashAccount).result.spec, false);
    const result = service.updateAccountOrder({
      updates: [
        { accountId: DEFAULT_IDS.cashAccount, order: 2 },
        { accountId: DEFAULT_IDS.receivableAccount, order: 1 },
      ],
      actor: 'account-order-test',
    }).result;
    assert.deepEqual(result, [
      { accountId: DEFAULT_IDS.receivableAccount, order: 1 },
      { accountId: DEFAULT_IDS.cashAccount, order: 2 },
    ]);
    assert.deepEqual(service.pendingChanges().result, []);
    assert.equal(
      (store.database.prepare(`
        SELECT event_type
        FROM domain_events
        WHERE resource_kind = 'AccountDisplayOrder'
        ORDER BY occurred_at DESC
        LIMIT 1
      `).get() as Record<string, unknown>).event_type,
      'AccountDisplayOrder.updated',
    );
  } finally {
    store.close();
  }
});

test('migrates legacy account order without discarding parent changes', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const orderChangeSet = service.createChangeSet('Legacy order only').result;
    const cash = service.get('Account', DEFAULT_IDS.cashAccount).result;
    service.update({
      kind: 'Account',
      id: cash.metadata.id,
      expectedResourceVersion: cash.metadata.resourceVersion,
      spec: { ...cash.spec, name: 'Temporary name' },
      status: cash.status,
      relationships: { ...cash.relationships, changeSetId: orderChangeSet.metadata.id },
    });

    const parentChangeSet = service.createChangeSet('Legacy parent change').result;
    const receivable = service.get('Account', DEFAULT_IDS.receivableAccount).result;
    service.update({
      kind: 'Account',
      id: receivable.metadata.id,
      expectedResourceVersion: receivable.metadata.resourceVersion,
      spec: receivable.spec,
      status: receivable.status,
      relationships: {
        ...receivable.relationships,
        parentAccountId: DEFAULT_IDS.cashAccount,
        changeSetId: parentChangeSet.metadata.id,
      },
    });

    store.database.exec(`
      UPDATE resources
      SET spec = json_set(spec, '$.name', '4060 Ingest', '$.order', 7)
      WHERE kind = 'Account' AND id = '${DEFAULT_IDS.cashAccount}';
      UPDATE change_set_items
      SET before_value = json_set(before_value, '$.spec.order', 2)
      WHERE resource_kind = 'Account' AND resource_id = '${DEFAULT_IDS.cashAccount}';

      UPDATE resources
      SET spec = json_set(spec, '$.order', 9)
      WHERE kind = 'Account' AND id = '${DEFAULT_IDS.receivableAccount}';
      UPDATE change_set_items
      SET before_value = json_set(before_value, '$.spec.order', 3)
      WHERE resource_kind = 'Account' AND resource_id = '${DEFAULT_IDS.receivableAccount}';

      DELETE FROM account_display_order;
      DELETE FROM app_migrations WHERE id = '120-account-display-order';
    `);

    initializeBankingSchema(store.database);

    assert.deepEqual(
      accountDisplayOrders(store.database).filter((item) =>
        item.accountId === DEFAULT_IDS.cashAccount
        || item.accountId === DEFAULT_IDS.receivableAccount),
      [
        { accountId: DEFAULT_IDS.cashAccount, order: 7 },
        { accountId: DEFAULT_IDS.receivableAccount, order: 9 },
      ],
    );
    assert.equal('order' in service.get('Account', DEFAULT_IDS.cashAccount).result.spec, false);
    assert.equal(
      service.get('Account', DEFAULT_IDS.cashAccount).result.status.state,
      'Committed',
    );
    assert.equal(
      service.get('ChangeSet', orderChangeSet.metadata.id).result.status.state,
      'Discarded',
    );
    assert.deepEqual(
      service.pendingChanges().result.find((item) =>
        item.resourceId === DEFAULT_IDS.receivableAccount)?.changedFields,
      ['relationships.parentAccountId'],
    );
    assert.equal(
      service.get('ChangeSet', parentChangeSet.metadata.id).result.status.state,
      'Open',
    );
  } finally {
    store.close();
  }
});

test('migrates uniform legacy monthly budgets to calendar recurrence', () => {
  const store = new ResourceStore(':memory:');
  new BankingResourceService(createRegistry(), store);
  try {
    store.database.prepare(`
      UPDATE resources
      SET spec = ?, status = ?
      WHERE kind = 'Budget' AND id = ?
    `).run(
      JSON.stringify({
        name: 'Mortgage',
        order: 1,
        flow: 'Expense',
        planned: { '2026-01': '2900.00', '2026-02': '2900.00' },
        estimated: {},
        annualGrowthRate: 0,
      }),
      JSON.stringify({
        state: 'Draft',
        deleted: false,
        planned: '5800.00',
        estimated: '5800.00',
        realized: '0.00',
        plannedByMonth: { '2026-01': '2900.00', '2026-02': '2900.00' },
        estimatedByMonth: { '2026-01': '2900.00', '2026-02': '2900.00' },
        realizedByMonth: {},
      }),
      DEFAULT_IDS.uncategorizedBudget,
    );
    store.database.prepare(
      "DELETE FROM app_migrations WHERE id = '150-budget-calendar-recurrence'",
    ).run();

    initializeBankingSchema(store.database);

    const migrated = store.get('Budget', DEFAULT_IDS.uncategorizedBudget)!;
    assert.equal(migrated.spec.amount, '2900.00');
    assert.deepEqual(migrated.spec.recurrence, {
      frequency: 'Monthly',
      interval: 1,
      daysOfMonth: [1],
      startsOn: '2026-01-01',
      endsOn: '2026-02-28',
    });
    assert.equal(migrated.status.state, 'Draft');
    assert.equal(migrated.status.budgeted, '0.00');
    assert.equal(Reflect.has(migrated.spec, 'planned'), false);
    assert.equal(Reflect.has(migrated.status, 'estimated'), false);
  } finally {
    store.close();
  }
});

test('migrates persisted and staged reconciliation fields to unreconciled amounts', () => {
  const store = new ResourceStore(':memory:');
  new BankingResourceService(createRegistry(), store);
  try {
    store.database.prepare(`
      UPDATE resources
      SET status = json_set(
        json_remove(status, '$.unreconciledAmount'),
        '$.reconciliationDifference',
        '12.50'
      )
      WHERE kind = 'Account' AND id = ?
    `).run(DEFAULT_IDS.cashAccount);
    const knownValue = store.create({
      kind: 'AccountKnownValue',
      id: '11111111-1111-4111-8111-111111111111',
      spec: { date: '2026-01-01', value: '100.00' },
      status: {
        state: 'Draft',
        deleted: false,
        calculatedValue: '87.50',
        difference: '12.50',
        severity: 'Normal',
      },
      relationships: {
        accountId: DEFAULT_IDS.cashAccount,
        changeSetId: '22222222-2222-4222-8222-222222222222',
      },
    }, { transactionId: 'migration-test' });
    store.database.prepare(`
      INSERT INTO change_set_items
        (change_set_id, resource_kind, resource_id, before_value, action)
      VALUES (?, 'AccountKnownValue', ?, ?, 'update')
    `).run(
      '22222222-2222-4222-8222-222222222222',
      knownValue.metadata.id,
      JSON.stringify(knownValue),
    );
    store.database.prepare(
      "DELETE FROM app_migrations WHERE id = '160-unreconciled-amounts'",
    ).run();

    initializeBankingSchema(store.database);

    const account = store.get('Account', DEFAULT_IDS.cashAccount)!;
    const migratedKnownValue = store.get('AccountKnownValue', knownValue.metadata.id)!;
    const baseline = store.database.prepare(`
      SELECT before_value FROM change_set_items
      WHERE change_set_id = ? AND resource_id = ?
    `).get(
      '22222222-2222-4222-8222-222222222222',
      knownValue.metadata.id,
    ) as { before_value: string };
    assert.equal(account.status.unreconciledAmount, '12.50');
    assert.equal(Reflect.has(account.status, 'reconciliationDifference'), false);
    assert.equal(migratedKnownValue.status.unreconciledAmount, '12.50');
    assert.equal(Reflect.has(migratedKnownValue.status, 'difference'), false);
    const before = JSON.parse(baseline.before_value);
    assert.equal(before.status.unreconciledAmount, '12.50');
    assert.equal(Reflect.has(before.status, 'difference'), false);
  } finally {
    store.close();
  }
});

test('rolls recurring budgeted and realized values through the budget tree', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Budget plan').result;
    const parent = service.create({
      kind: 'Budget',
      spec: {
        name: 'Living costs',
        order: 1,
        amount: '0.00',
      },
      relationships: { changeSetId: changeSet.metadata.id },
    }).result;
    const child = service.create({
      kind: 'Budget',
      spec: {
        name: 'Utilities',
        order: 0,
        flow: 'Expense',
        amount: '425.00',
        recurrence: {
          frequency: 'Monthly',
          interval: 1,
          daysOfMonth: [15],
          startsOn: '2026-01-01',
          endsOn: '2026-01-31',
        },
      },
      relationships: {
        parentBudgetId: parent.metadata.id,
        changeSetId: changeSet.metadata.id,
      },
    }).result;
    service.create({
      kind: 'Transaction',
      spec: { date: '2026-01-10', description: 'Energy', amount: '390.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.payableAccount,
        budgetId: child.metadata.id,
        changeSetId: changeSet.metadata.id,
      },
    });
    service.commitChangeSet(changeSet.metadata.id, changeSet.metadata.resourceVersion);
    const parentStatus = service.get('Budget', parent.metadata.id).result.status;
    assert.equal(parentStatus.budgeted, '425.00');
    assert.equal(parentStatus.balance, '35.00');
    assert.equal(monthValue(parentStatus.budgetedByMonth, '2026-01'), '425.00');
    assert.equal(monthValue(parentStatus.realizedByMonth, '2026-01'), '390.00');
    assert.equal(monthValue(parentStatus.balanceByMonth, '2026-01'), '35.00');
  } finally {
    store.close();
  }
});

test('derives monthly and biweekly budget values from calendar recurrence', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Mortgage plan').result;
    const budget = service.create({
      kind: 'Budget',
      spec: {
        name: 'Mortgage',
        order: 1,
        flow: 'Expense',
        amount: '2900.00',
        recurrence: {
          frequency: 'Monthly',
          interval: 1,
          daysOfMonth: [1],
          startsOn: '2026-01-01',
          endsOn: '2026-12-31',
        },
      },
      relationships: { changeSetId: changeSet.metadata.id },
    }).result;
    const paycheck = service.create({
      kind: 'Budget',
      spec: {
        name: 'Biweekly paycheck',
        order: 2,
        flow: 'Income',
        amount: '1000.00',
        recurrence: {
          frequency: 'Weekly',
          interval: 2,
          startsOn: '2026-01-02',
          endsOn: '2026-02-28',
        },
      },
      relationships: { changeSetId: changeSet.metadata.id },
    }).result;
    service.commitChangeSet(changeSet.metadata.id, changeSet.metadata.resourceVersion);

    const mortgageStatus = service.get('Budget', budget.metadata.id).result.status;
    assert.equal(mortgageStatus.budgeted, '34800.00');
    assert.equal(monthValue(mortgageStatus.budgetedByMonth, '2026-01'), '2900.00');
    assert.equal(monthValue(mortgageStatus.budgetedByMonth, '2027-01'), undefined);
    const paycheckStatus = service.get('Budget', paycheck.metadata.id).result.status;
    assert.equal(monthValue(paycheckStatus.budgetedByMonth, '2026-01'), '3000.00');
    assert.equal(monthValue(paycheckStatus.budgetedByMonth, '2026-02'), '2000.00');
  } finally {
    store.close();
  }
});

function monthValue(value: unknown, month: string): unknown {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return Reflect.get(value, month);
}

test('prevents deleting accounts and budgets referenced by transactions', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const changeSet = service.createChangeSet('Expense').result;
    service.create({
      kind: 'Transaction',
      spec: { date: '2026-02-01', description: 'Expense', amount: '25.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.payableAccount,
        budgetId: DEFAULT_IDS.uncategorizedBudget,
        changeSetId: changeSet.metadata.id,
      },
    });
    service.commitChangeSet(changeSet.metadata.id, changeSet.metadata.resourceVersion);
    const cash = service.get('Account', DEFAULT_IDS.cashAccount).result;
    assert.throws(() => service.delete({
      kind: 'Account',
      id: cash.metadata.id,
      expectedResourceVersion: cash.metadata.resourceVersion,
    }), /referenced by a Transaction/);
  } finally {
    store.close();
  }
});
