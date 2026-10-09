import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { DEFAULT_IDS } from '../../src/app/ledger-store.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

const csv = `"Trade Date","Settlement Date","Pending/Settled","Account Nickname","Account Registration","Account #","Type","Description 1 ","Description 2","Symbol/CUSIP #","Quantity","Price ($)","Amount ($)"
"10/5/2026","10/5/2026","Settled","Short Term Cash 121k","CMA-Edge","76W-70D81","SecurityTransactions","Redemption","CD BANK","06051XST0","-48000","--","48,000.00"
"10/1/2026","10/1/2026","Settled","Mike Steph IRA","IRA-Edge","79Z-74668","Other","Reinvestment Program","ARTISAN FUND","ARTFX","--","--","(60.57)"
`;

const aggregateCsv = `Status,Date,Original Description,Split Type,Category,Currency,Amount,User Description,Memo,Classification,Account Name,Simple Description
posted,10/06/2026,Online Banking transfer to CHK 3695,,Transfers,USD,"-12,000.00",,,,Bank of America - Bank - 4060 Ingest,Online Banking Transfer
posted,10/05/2026,CD BANK OF AMERICA NA,,Investment Income,USD,973.15,,,,Merrill Lynch Merrill Edge - Investments - CMA-Edge-Short Term Cash 121k,
posted,10/04/2026,No movement,,Transfers,USD,0.00,,,,Bank of America - Bank - 4060 Ingest,
`;

test('imports aggregate exports while excluding overlapping Merrill rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'ExportData.csv'), aggregateCsv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const imported = service.importTransactions(directory).result;
    assert.equal(imported.length, 1);
    assert.equal(imported[0].spec.amount, '12000.00');
    assert.equal(imported[0].spec.sourceAccount, 'Bank of America - Bank - 4060 Ingest');
    assert.equal(imported[0].spec.sourceType, 'Transfers');
    assert.equal(imported[0].relationships.fromAccountId !== undefined, true);
    const importedAccounts = service.query('Account', undefined).result.filter(
      (account) => account.spec.name === 'Bank of America - Bank - 4060 Ingest',
    );
    assert.equal(importedAccounts.length, 1);
    assert.equal(importedAccounts[0].spec.internal, true);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('ignores zero-dollar transactions before creating source accounts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  const zeroDollarRow = '"10/6/2026","10/6/2026","Settled","Zero Activity","CMA-Edge","00Z-00000","Other","No movement","","","--","--","0.00"\n';
  writeFileSync(join(directory, 'activity.csv'), csv + zeroDollarRow);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const imported = service.importTransactions(directory).result;
    assert.equal(imported.length, 2);
    assert.ok(imported.every((item) => item.spec.amount !== '0.00'));
    assert.equal(service.query('Account', undefined).result.length, 6);
    assert.ok(service.query('Account', undefined).result.every(
      (account) => account.spec.name !== 'Zero Activity (...0000)',
    ));
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('retires previously imported unmapped zero-dollar transactions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'activity.csv'), csv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const transaction = service.importTransactions(directory).result[0];
    store.database.prepare(
      'UPDATE transaction_staging SET amount_cents = 0 WHERE id = ?',
    ).run(transaction.metadata.id);
    const restarted = new BankingResourceService(createRegistry(), store);
    assert.equal(restarted.query('TransactionStaging', undefined).result.length, 1);
    const retired = restarted.get('TransactionStaging', transaction.metadata.id).result;
    assert.equal(retired.status.deleted, true);
    assert.equal(retired.status.dirty, false);
    assert.equal(restarted.importTransactions(directory).result.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('imports transactions idempotently and reconciles exact ledger values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'activity.csv'), csv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    assert.equal(service.importTransactions(directory).result.length, 2);
    assert.equal(service.importTransactions(directory).result.length, 0);
    const staging = service.query('TransactionStaging', undefined).result;
    assert.equal(staging.length, 2);
    assert.ok(staging.every((item) => item.status.state === 'Unmapped'));
    assert.ok(staging.every((item) => item.status.dirty === false));
    assert.equal(service.query('Account', undefined).result.length, 6);

    const group = service.createGroup({
      status: 'Realized', date: '2026-10-05', description: 'CD redemption',
    }, [{
      spec: { amount: '1.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.accountsReceivableAccount,
        toAccountId: DEFAULT_IDS.cashAccount,
      },
    }]).result;
    const committedGroup = service.commit([group.metadata.id]).result[0];
    const ledgerEntryId = (committedGroup.relationships.ledgerEntryIds as string[])[0];
    const deposit = staging.find((item) => item.spec.amount === '48000.00')!;

    const provisional = service.mapStaging(
      deposit.metadata.id,
      ledgerEntryId,
      deposit.metadata.resourceVersion,
    ).result;
    assert.equal(provisional.status.state, 'Provisional');
    assert.equal(provisional.status.dirty, true);
    assert.equal(provisional.relationships.fromAccountId, DEFAULT_IDS.accountsReceivableAccount);
    assert.notEqual(provisional.relationships.toAccountId, DEFAULT_IDS.cashAccount);
    const provisionallyUpdatedEntry = service.get('LedgerEntry', ledgerEntryId).result;
    assert.equal(provisionallyUpdatedEntry.spec.amount, '48000.00');
    assert.equal(
      provisionallyUpdatedEntry.relationships.fromAccountId,
      provisional.relationships.fromAccountId,
    );
    assert.equal(
      provisionallyUpdatedEntry.relationships.toAccountId,
      provisional.relationships.toAccountId,
    );
    assert.equal(service.get('LedgerEntryGroup', group.metadata.id).result.status.dirty, true);

    const reconciled = service.reconcileStaging(
      provisional.metadata.id,
      provisional.metadata.resourceVersion,
    ).result;
    assert.equal(reconciled.status.state, 'Reconciled');
    assert.equal(reconciled.status.dirty, false);
    const entry = service.get('LedgerEntry', ledgerEntryId).result;
    assert.equal(entry.spec.amount, '48000.00');
    assert.equal(entry.relationships.toAccountId, provisional.relationships.toAccountId);
    assert.equal(service.get('LedgerEntryGroup', group.metadata.id).result.status.dirty, false);

    const correctedSource = service.create({
      kind: 'Account',
      spec: { name: 'Fixed Income Interest', currency: 'USD' },
      relationships: { categoryId: DEFAULT_IDS.accountsReceivableCategory },
    }).result;
    const correction = service.update({
      kind: 'TransactionStaging',
      id: reconciled.metadata.id,
      expectedResourceVersion: reconciled.metadata.resourceVersion,
      spec: reconciled.spec,
      status: reconciled.status,
      relationships: {
        ...reconciled.relationships,
        fromAccountId: correctedSource.metadata.id,
      },
    }).result;
    assert.equal(correction.status.state, 'Provisional');
    assert.equal(correction.status.dirty, true);
    const corrected = service.reconcileStaging(
      correction.metadata.id,
      correction.metadata.resourceVersion,
    ).result;
    assert.equal(corrected.status.state, 'Reconciled');
    assert.equal(
      service.get('LedgerEntry', ledgerEntryId).result.relationships.fromAccountId,
      correctedSource.metadata.id,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('soft deletes an unmapped transaction without allowing reimport', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'activity.csv'), csv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const transaction = service.importTransactions(directory).result[0];
    const deleted = service.delete({
      kind: 'TransactionStaging',
      id: transaction.metadata.id,
      expectedResourceVersion: transaction.metadata.resourceVersion,
    }).result;
    assert.equal(deleted.status.deleted, true);
    assert.equal(deleted.status.dirty, false);
    assert.equal(service.query('TransactionStaging', undefined).result.length, 1);
    assert.equal(service.get('TransactionStaging', transaction.metadata.id).result.status.deleted, true);
    assert.equal(service.importTransactions(directory).result.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('discards a provisional staging mapping to its imported baseline', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'activity.csv'), csv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const withdrawal = service.importTransactions(directory).result.find(
      (item) => item.spec.amount === '60.57',
    )!;
    const originalFrom = withdrawal.relationships.fromAccountId;
    const group = service.createGroup({
      status: 'Realized', date: '2026-10-01', description: 'Reinvestment',
    }, [{
      spec: { amount: '60.57' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.retirementAccount,
      },
    }]).result;
    const ledgerEntryId = (group.relationships.ledgerEntryIds as string[])[0];
    const provisional = service.mapStaging(
      withdrawal.metadata.id,
      ledgerEntryId,
      withdrawal.metadata.resourceVersion,
    ).result;
    const restored = service.discardStaging(
      provisional.metadata.id,
      provisional.metadata.resourceVersion,
    ).result;
    assert.equal(restored.status.state, 'Unmapped');
    assert.equal(restored.status.dirty, false);
    assert.equal(restored.relationships.fromAccountId, originalFrom);
    assert.equal(restored.relationships.toAccountId, undefined);
    assert.equal(restored.relationships.ledgerEntryId, undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('attaches an unmapped transaction as a new provisional ledger entry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'activity.csv'), csv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const deposit = service.importTransactions(directory).result.find(
      (item) => item.spec.amount === '48000.00',
    )!;
    const retirementAccount = service.create({
      kind: 'Account',
      spec: { name: 'Retirement - Fixed Income Accounts', currency: 'USD' },
      relationships: { categoryId: DEFAULT_IDS.retirementCategory },
    }).result;
    const edited = service.update({
      kind: 'TransactionStaging',
      id: deposit.metadata.id,
      expectedResourceVersion: deposit.metadata.resourceVersion,
      spec: deposit.spec,
      status: deposit.status,
      relationships: {
        fromAccountId: retirementAccount.metadata.id,
        toAccountId: deposit.relationships.toAccountId,
      },
    }).result;
    const group = service.createGroup({
      status: 'Planned', date: '2026-10-05', description: 'CD payment',
    }, [{
      spec: { amount: '960.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.accountsReceivableAccount,
        toAccountId: DEFAULT_IDS.cashAccount,
      },
    }]).result;
    service.commit([group.metadata.id]);

    const attached = service.attachStaging(
      edited.metadata.id,
      group.metadata.id,
      edited.metadata.resourceVersion,
    ).result;
    assert.equal(attached.status.state, 'Provisional');
    assert.equal(attached.status.dirty, true);
    const ledgerEntryId = attached.relationships.ledgerEntryId as string;
    const entry = service.get('LedgerEntry', ledgerEntryId).result;
    assert.equal(entry.spec.amount, '48000.00');
    assert.equal(entry.relationships.groupId, group.metadata.id);
    assert.equal(entry.relationships.fromAccountId, retirementAccount.metadata.id);
    assert.equal(entry.relationships.toAccountId, deposit.relationships.toAccountId);
    const updatedGroup = service.get('LedgerEntryGroup', group.metadata.id).result;
    assert.equal(updatedGroup.status.income, '960.00');
    assert.equal(updatedGroup.status.expense, '0.00');
    assert.equal(updatedGroup.status.transfers, '48000.00');
    assert.equal(updatedGroup.status.dirty, true);
    const committed = service.commit([group.metadata.id]).result[0];
    assert.equal(committed.spec.status, 'Realized');
    assert.equal(committed.status.dirty, false);
    assert.equal(
      service.get('TransactionStaging', attached.metadata.id).result.status.state,
      'Reconciled',
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('creates a new ledger group and entry from an unmapped transaction', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'activity.csv'), csv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const deposit = service.importTransactions(directory).result.find(
      (item) => item.spec.amount === '48000.00',
    )!;
    const assigned = service.update({
      kind: 'TransactionStaging',
      id: deposit.metadata.id,
      expectedResourceVersion: deposit.metadata.resourceVersion,
      spec: deposit.spec,
      status: deposit.status,
      relationships: {
        fromAccountId: DEFAULT_IDS.accountsReceivableAccount,
        toAccountId: deposit.relationships.toAccountId,
      },
    }).result;
    const provisional = service.createLedgerEntryFromStaging(
      assigned.metadata.id,
      assigned.metadata.resourceVersion,
    ).result;
    assert.equal(provisional.status.state, 'Provisional');
    const entry = service.get(
      'LedgerEntry',
      provisional.relationships.ledgerEntryId as string,
    ).result;
    const group = service.get('LedgerEntryGroup', entry.relationships.groupId as string).result;
    assert.equal(group.spec.status, 'Realized');
    assert.equal(group.spec.date, '2026-10-05');
    assert.equal(group.spec.description, deposit.spec.description);
    assert.equal(group.status.income, '48000.00');
    assert.equal(group.status.dirty, true);
    assert.equal(entry.spec.amount, '48000.00');
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('skips imported activity through the latest realized ledger date', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staging-'));
  writeFileSync(join(directory, 'activity.csv'), csv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    service.createGroup({
      status: 'Realized', date: '2026-10-01', description: 'Recognized through here',
    }, [{
      spec: { amount: '0.00' },
      relationships: {
        fromAccountId: DEFAULT_IDS.cashAccount,
        toAccountId: DEFAULT_IDS.accountsPayableAccount,
      },
    }]);
    const imported = service.importTransactions(directory).result;
    assert.equal(imported.length, 1);
    assert.equal(imported[0].spec.date, '2026-10-05');
    const historical = service.importTransactions(
      directory,
      'historical-import-test',
      'historical-transaction-import',
      true,
    ).result;
    assert.equal(historical.length, 1);
    assert.equal(historical[0].spec.date, '2026-10-01');
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});
