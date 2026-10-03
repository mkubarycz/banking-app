import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegistry } from '../../src/app/registry.js';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { ResourceStore } from '../../src/framework/store.js';

test('runs generic CRUD with compare-and-swap and transaction correlation', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const transactionId = '11111111-1111-4111-8111-111111111111';
    const created = service.create({
      kind: 'LedgerEntry',
      spec: {
        status: 'Realized', description: 'First entry', date: '2026-01-01',
        revenue: '1.00', expenses: '0.00', reinvested: '0.00',
      },
      transactionId,
      actor: 'test',
    });
    assert.equal(created.transactionId, transactionId);
    assert.equal(created.result.kind, 'LedgerEntry');
    assert.equal(created.result.metadata.resourceVersion, 1);
    assert.deepEqual(created.result.status, {
      cashDelta: '1.00', operatingCashFlow: '1.00', cashOnHand: '1.00',
      dirty: true, committedAt: null, deleted: false, previousSpec: null,
    });
    service.commit([created.result.metadata.id]);

    const queried = service.query('LedgerEntry', { status: 'Realized' });
    assert.equal(queried.result.length, 1);
    assert.equal(queried.result[0].status.dirty, false);
    assert.match(String(queried.result[0].status.committedAt), /^\d{4}-\d{2}-\d{2}T/);

    const updated = service.update({
      kind: 'LedgerEntry',
      id: created.result.metadata.id,
      expectedResourceVersion: 1,
      spec: {
        status: 'Planned', description: 'Updated entry', date: '2026-01-01',
        revenue: '2.00', expenses: '0.00', reinvested: '0.00',
      },
      status: created.result.status,
      relationships: {},
    });
    assert.equal(updated.result.metadata.resourceVersion, 2);
    assert.equal(updated.result.status.committedAt, null);
    assert.throws(() => service.update({
      kind: 'LedgerEntry',
      id: created.result.metadata.id,
      expectedResourceVersion: 1,
      spec: updated.result.spec,
      status: updated.result.status,
      relationships: updated.result.relationships,
    }), /conflict/);
  } finally {
    store.close();
  }
});

test('commits dirty history and retains soft-deleted rows atomically', () => {
  const store = new ResourceStore(':memory:');
  const service = new BankingResourceService(createRegistry(), store);
  try {
    const created = service.create({
      kind: 'LedgerEntry',
      spec: {
        status: 'Estimated', description: 'Atomic entry', date: '2026-01-01',
        revenue: '0.00', expenses: '1.00', reinvested: '0.00',
      },
      transactionId: '22222222-2222-4222-8222-222222222222',
    });
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM ledger_entries').get()!.count, 1);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM audit_events').get()!.count, 1);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM domain_events').get()!.count, 1);
    assert.equal(
      store.database.prepare('SELECT transaction_id FROM audit_events').get()!.transaction_id,
      created.transactionId,
    );

    service.commit([created.result.metadata.id]);
    const clean = service.get('LedgerEntry', created.result.metadata.id).result;
    assert.notEqual(clean.status.committedAt, null);
    service.delete({
      kind: 'LedgerEntry',
      id: created.result.metadata.id,
      expectedResourceVersion: clean.metadata.resourceVersion,
    });
    service.commit([created.result.metadata.id]);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM ledger_entries').get()!.count, 1);
    assert.equal(store.database.prepare('SELECT deleted FROM ledger_entries').get()!.deleted, 1);
    assert.equal(
      store.database.prepare(
        "SELECT count(*) AS count FROM pragma_table_info('ledger_entries') WHERE name = 'dirty'",
      ).get()!.count,
      0,
    );
    assert.equal(
      store.database.prepare("SELECT count(*) AS count FROM data_change_log WHERE resolution = 'committed'").get()!.count,
      2,
    );
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM audit_events').get()!.count, 4);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM domain_events').get()!.count, 4);
  } finally {
    store.close();
  }
});
