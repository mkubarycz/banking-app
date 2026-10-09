import assert from 'node:assert/strict';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { DEFAULT_IDS } from '../../src/app/ledger-store.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

test('creates grouped transfers and derives rollups from account categories', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    assert.equal(service.query('Account', undefined).result.length, 4);
    assert.equal(service.query('Category', undefined).result.length, 5);
    const group = service.createGroup({
      status: 'Realized',
      date: '2026-01-01',
      description: 'Mixed group',
    }, [
      {
        spec: { amount: '200.00' },
        relationships: {
          fromAccountId: DEFAULT_IDS.accountsReceivableAccount,
          toAccountId: DEFAULT_IDS.cashAccount,
        },
      },
      {
        spec: { amount: '40.00' },
        relationships: {
          fromAccountId: DEFAULT_IDS.cashAccount,
          toAccountId: DEFAULT_IDS.accountsPayableAccount,
        },
      },
      {
        spec: { amount: '25.00' },
        relationships: {
          fromAccountId: DEFAULT_IDS.cashAccount,
          toAccountId: DEFAULT_IDS.retirementAccount,
        },
      },
    ]).result;
    assert.equal(group.kind, 'LedgerEntryGroup');
    assert.equal((group.relationships.ledgerEntryIds as string[]).length, 3);
    assert.deepEqual(group.status, {
      income: '200.00',
      expense: '40.00',
      transfers: '25.00',
      cashDelta: '135.00',
      operatingCashFlow: '160.00',
      cashOnHand: '135.00',
      dirty: true,
      committedAt: null,
      deleted: false,
      previousSpec: null,
    });
    const cashAccount = service.get('Account', DEFAULT_IDS.cashAccount).result;
    assert.equal(cashAccount.status.balance, '135.00');
    assert.throws(() => service.delete({
      kind: 'Account',
      id: DEFAULT_IDS.cashAccount,
      expectedResourceVersion: 1,
    }), /referenced by a LedgerEntry/);
  } finally {
    store.close();
  }
});

test('derives income, expense, and transfers from account boundaries', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const investment = service.create({
      kind: 'Account',
      spec: { name: 'External Mutual Fund', currency: 'USD', internal: false },
      relationships: { categoryId: DEFAULT_IDS.investmentAssetsCategory },
    }).result;
    const internalInvestment = service.create({
      kind: 'Account',
      spec: { name: 'Internal Mutual Fund', currency: 'USD', internal: true },
      relationships: { categoryId: DEFAULT_IDS.investmentAssetsCategory },
    }).result;
    const group = service.createGroup({
      status: 'Realized',
      date: '2026-10-08',
      description: 'Investment activity',
    }, [{
      spec: { amount: '100.00' },
      relationships: {
        fromAccountId: investment.metadata.id,
        toAccountId: DEFAULT_IDS.cashAccount,
      },
    }, {
      spec: { amount: '40.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: investment.metadata.id,
      },
    }, {
      spec: { amount: '25.00' },
      relationships: {
        fromAccountId: investment.metadata.id,
        toAccountId: DEFAULT_IDS.accountsPayableAccount,
      },
    }, {
      spec: { amount: '5.00' },
      relationships: {
        fromAccountId: internalInvestment.metadata.id,
        toAccountId: DEFAULT_IDS.cashAccount,
      },
    }]).result;
    assert.equal(group.status.income, '100.00');
    assert.equal(group.status.expense, '40.00');
    assert.equal(group.status.transfers, '30.00');
    assert.equal(group.status.operatingCashFlow, '60.00');
    assert.equal(group.status.cashDelta, '65.00');
  } finally {
    store.close();
  }
});

test('moves the ARTFX mutual fund into Investment Assets', () => {
  const store = new ResourceStore(':memory:');
  try {
    const now = new Date().toISOString();
    const accountId = '11111111-1111-4111-8111-111111111111';
    store.database.prepare(`
      INSERT INTO resources
        (id, kind, spec, status, relationships, resource_version, created_at, updated_at)
      VALUES (?, 'Account', ?, '{}', ?, 1, ?, ?)
    `).run(
      accountId,
      JSON.stringify({ name: 'Mutual Fund - ARTFX', currency: 'USD' }),
      JSON.stringify({ categoryId: DEFAULT_IDS.retirementCategory }),
      now,
      now,
    );
    const service = new BankingResourceService(createRegistry(), store);
    const category = service.get('Category', DEFAULT_IDS.investmentAssetsCategory).result;
    const account = service.get('Account', accountId).result;
    assert.deepEqual(category.spec, {
      name: 'Investment Assets',
      classification: 'InvestmentAsset',
    });
    assert.equal(account.relationships.categoryId, DEFAULT_IDS.investmentAssetsCategory);
    assert.equal(account.spec.internal, false);
    assert.equal(account.metadata.resourceVersion, 3);
  } finally {
    store.close();
  }
});

test('reverses negative legacy amounts and keeps account balance aligned with ending cash on hand', () => {
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
        ('11111111-1111-4111-8111-111111111111', 1, 'Opening', 'Realized',
         0, 0, 0, 10000, NULL, NULL, 1, 0, 1, 1, 1),
        ('22222222-2222-4222-8222-222222222222', 2, 'Retirement reversal', 'Realized',
         0, 0, -2500, NULL, NULL, NULL, 2, 0, 1, 2, 2);
    `);
    const service = new BankingResourceService(createRegistry(), store);
    const groups = service.query('LedgerEntryGroup', undefined).result;
    assert.equal(groups[1].status.transfers, '25.00');
    assert.equal(groups[1].status.cashOnHand, '125.00');
    assert.equal(service.get('Account', DEFAULT_IDS.cashAccount).result.status.balance, '125.00');
  } finally {
    store.close();
  }
});

test('requires one child entry and valid distinct accounts', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    assert.throws(() => service.createGroup({
      status: 'Realized', date: '2026-01-01', description: 'Empty',
    }, []), /at least one/);
    assert.throws(() => service.createGroup({
      status: 'Realized', date: '2026-01-01', description: 'Invalid',
    }, [{
      spec: { amount: '1.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.cashAccount,
      },
    }]), /must differ/);
    assert.equal(service.query('LedgerEntryGroup', undefined).result.length, 0);
  } finally {
    store.close();
  }
});

test('migrates revenue and expense categories to receivable and payable vocabulary', () => {
  const store = new ResourceStore(':memory:');
  try {
    const now = new Date().toISOString();
    store.database.prepare(`
      INSERT INTO resources
        (id, kind, spec, status, relationships, resource_version, created_at, updated_at)
      VALUES
        (?, 'Category', ?, '{}', '{}', 1, ?, ?),
        (?, 'Category', ?, '{}', '{}', 1, ?, ?),
        (?, 'Account', ?, '{}', ?, 1, ?, ?),
        (?, 'Account', ?, '{}', ?, 1, ?, ?)
    `).run(
      DEFAULT_IDS.accountsReceivableCategory,
      JSON.stringify({ name: 'Revenue', classification: 'Revenue' }),
      now,
      now,
      DEFAULT_IDS.accountsPayableCategory,
      JSON.stringify({ name: 'Expense', classification: 'Expense' }),
      now,
      now,
      DEFAULT_IDS.accountsReceivableAccount,
      JSON.stringify({ name: 'Misc Revenue Account', currency: 'USD' }),
      JSON.stringify({ categoryId: DEFAULT_IDS.accountsReceivableCategory }),
      now,
      now,
      DEFAULT_IDS.accountsPayableAccount,
      JSON.stringify({ name: 'Misc Expense Account', currency: 'USD' }),
      JSON.stringify({ categoryId: DEFAULT_IDS.accountsPayableCategory }),
      now,
      now,
    );
    const service = new BankingResourceService(createRegistry(), store);
    const receivable = service.get('Category', DEFAULT_IDS.accountsReceivableCategory).result;
    const payable = service.get('Category', DEFAULT_IDS.accountsPayableCategory).result;
    assert.deepEqual(receivable.spec, {
      name: 'Accounts Receivable',
      classification: 'AccountsReceivable',
    });
    assert.deepEqual(payable.spec, {
      name: 'Accounts Payable',
      classification: 'AccountsPayable',
    });
    assert.equal(
      service.get('Account', DEFAULT_IDS.accountsReceivableAccount).result.spec.name,
      'Misc Accounts Receivable',
    );
    assert.equal(
      service.get('Account', DEFAULT_IDS.accountsPayableAccount).result.spec.name,
      'Misc Accounts Payable',
    );
  } finally {
    store.close();
  }
});
