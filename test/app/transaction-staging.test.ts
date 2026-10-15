import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

const merrillCsv = `"Trade Date","Settlement Date","Pending/Settled","Account Nickname","Account Registration","Account #","Type","Description 1 ","Description 2","Symbol/CUSIP #","Quantity","Price ($)","Amount ($)"
"10/5/2026","10/5/2026","Settled","Short Term Cash 121k","CMA-Edge","76W-70D81","SecurityTransactions","Redemption","CD BANK","06051XST0","-48000","--","48,000.00"
"10/1/2026","10/1/2026","Settled","Mike Steph IRA","IRA-Edge","79Z-74668","Other","Reinvestment Program","ARTISAN FUND","ARTFX","--","--","(60.57)"
`;

const aggregateCsv = `Status,Date,Original Description,Split Type,Category,Currency,Amount,User Description,Memo,Classification,Account Name,Simple Description
posted,10/06/2026,Online Banking transfer to CHK 3695,,Transfers,USD,"-12,000.00",,,,Bank of America - Bank - 4060 Ingest,Online Banking Transfer
posted,10/05/2026,Decimal debit,,Groceries,USD,-7.44,,,,Bank of America - Bank - 4060 Ingest,Decimal Debit
posted,10/05/2026,CD BANK OF AMERICA NA,,Investment Income,USD,973.15,,,,Merrill Lynch Merrill Edge - Investments - CMA-Edge-Short Term Cash 121k,
posted,10/04/2026,No movement,,Transfers,USD,0.00,,,,Bank of America - Bank - 4060 Ingest,
`;

test('imports supported exports directly as committed native transactions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'banking-staged-'));
  writeFileSync(join(directory, 'merrill.csv'), merrillCsv);
  writeFileSync(join(directory, 'aggregate.csv'), aggregateCsv);
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    assert.equal(service.importTransactions(directory).result.length, 4);
    assert.equal(service.importTransactions(directory).result.length, 0);
    const legacyDebit = service.query('Transaction', undefined).result.find(
      (item) => item.spec.description === 'Decimal Debit',
    )!;
    store.update({
      kind: 'Transaction',
      id: legacyDebit.metadata.id,
      expectedResourceVersion: legacyDebit.metadata.resourceVersion,
      spec: { ...legacyDebit.spec, amount: '6.56' },
      status: legacyDebit.status,
      relationships: legacyDebit.relationships,
    }, { transactionId: 'legacy-import-test', actor: 'test' });
    store.database.prepare(
      'DELETE FROM app_migrations WHERE id = ?',
    ).run('140-correct-negative-decimal-imports');
    assert.equal(service.importTransactions(directory).result.length, 0);
    const transactions = service.query('Transaction', undefined).result;
    assert.equal(transactions.length, 4);
    assert.ok(transactions.every((item) => item.status.state === 'Committed'));
    assert.ok(transactions.every((item) => item.spec.amount !== '0.00'));
    assert.equal(service.query('AccountKnownValue', undefined).result.length, 15);
    assert.equal(service.query('Account', undefined).result.length, 17);
    assert.equal(
      transactions.filter((item) =>
        String((item.spec.source as Record<string, string>)?.account)
          .startsWith('Merrill Lynch')).length,
      0,
    );
    const redemption = transactions.find((item) => item.spec.amount === '48000.00')!;
    assert.equal(
      (redemption.spec.source as Record<string, string>).type,
      'SecurityTransactions',
    );
    assert.equal(redemption.status.classification, 'Income');
    const decimalDebit = transactions.find((item) => item.spec.description === 'Decimal Debit')!;
    assert.equal(decimalDebit.spec.amount, '7.44');
    assert.equal(decimalDebit.status.classification, 'Expense');
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});
