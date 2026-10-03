import assert from 'node:assert/strict';
import test from 'node:test';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { summarizeLedger } from '../../src/app/dashboard.js';
import { cents, money } from '../../src/app/money.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';

function setup() {
  const store = new ResourceStore(':memory:');
  return { store, service: new BankingResourceService(createRegistry(), store) };
}

function spec(overrides: Record<string, unknown> = {}) {
  return {
    status: 'Realized',
    description: 'Ledger row',
    date: '2026-01-01',
    revenue: '0.00',
    expenses: '0.00',
    reinvested: '0.00',
    ...overrides,
  };
}

test('uses exact cents and canonical decimal strings', () => {
  assert.equal(cents('9007199254740993.01'), 900719925474099301n);
  assert.equal(money(-12345n), '-123.45');
  assert.throws(() => createRegistry().get('LedgerEntry').spec.parse(spec({ revenue: 0.1 })));
  assert.throws(() => createRegistry().get('LedgerEntry').spec.parse(spec({ revenue: '0.1' })));
});

test('uses timestamp order, calculated balances, dirty commits, and soft deletes', () => {
  const { store, service } = setup();
  try {
    const opening = service.create({
      kind: 'LedgerEntry',
      spec: spec({
        description: 'Opening',
        date: '2025-12-31',
        openingCashOnHand: '100.00',
      }),
    }).result;
    const later = service.create({
      kind: 'LedgerEntry',
      spec: spec({ description: 'Later', revenue: '30.00', expenses: '4.00' }),
    }).result;
    const sameDay = service.create({
      kind: 'LedgerEntry',
      spec: spec({ description: 'Same day', expenses: '6.00' }),
    }).result;

    assert.deepEqual(
      service.query('LedgerEntry', undefined).result.map((entry) => entry.spec.description),
      ['Opening', 'Later', 'Same day'],
    );
    assert.equal(service.get('LedgerEntry', later.metadata.id).result.status.cashOnHand, '126.00');
    assert.equal(service.get('LedgerEntry', sameDay.metadata.id).result.status.cashOnHand, '120.00');
    service.commit([opening.metadata.id, later.metadata.id, sameDay.metadata.id]);
    const firstCommittedAt = store.database.prepare(
      'SELECT committed_at FROM ledger_entries WHERE id = ?',
    ).get(sameDay.metadata.id)!.committed_at;
    assert.equal(typeof firstCommittedAt, 'number');

    const moved = service.update({
      kind: 'LedgerEntry',
      id: sameDay.metadata.id,
      expectedResourceVersion: sameDay.metadata.resourceVersion,
      spec: spec({ description: 'Same day', date: '2025-12-31', expenses: '6.00' }),
      status: sameDay.status,
      relationships: {},
      transactionId: '33333333-3333-4333-8333-333333333333',
    }).result;
    assert.equal(moved.status.cashOnHand, '94.00');
    assert.equal(moved.status.committedAt, null);
    const recalculatedLater = service.get('LedgerEntry', later.metadata.id).result;
    assert.equal(recalculatedLater.status.cashOnHand, '120.00');
    assert.equal(recalculatedLater.metadata.resourceVersion, 1);
    assert.equal(
      store.database.prepare(
        "SELECT count(*) AS count FROM data_change_log WHERE row_id = ? AND resolution IS NULL",
      ).get(sameDay.metadata.id)!.count,
      1,
    );
    assert.equal(
      store.database.prepare(
        'SELECT committed_at FROM data_change_log WHERE row_id = ? AND resolution IS NULL',
      ).get(sameDay.metadata.id)!.committed_at,
      firstCommittedAt,
    );

    service.discard([sameDay.metadata.id]);
    const restored = service.get('LedgerEntry', sameDay.metadata.id).result;
    assert.equal(restored.status.committedAt, new Date(Number(firstCommittedAt)).toISOString());
    assert.equal(restored.spec.date, '2026-01-01');

    service.delete({
      kind: 'LedgerEntry',
      id: opening.metadata.id,
      expectedResourceVersion: opening.metadata.resourceVersion,
    });
    assert.equal(service.dirty().result.some((entry) => (
      entry.metadata.id === opening.metadata.id && entry.status.deleted === true
    )), true);
    assert.throws(() => service.get('LedgerEntry', opening.metadata.id), /not found/);
    assert.equal(service.get('LedgerEntry', later.metadata.id).result.status.cashOnHand, '26.00');
    assert.equal(
      store.database.prepare('SELECT deleted FROM ledger_entries WHERE id = ?').get(opening.metadata.id)!.deleted,
      1,
    );
  } finally {
    store.close();
  }
});

test('migrates the legacy dirty flag and restores its committed timestamp', () => {
  const store = new ResourceStore(':memory:');
  try {
    store.database.exec(`
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY,
        entry_at INTEGER NOT NULL,
        description TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        revenue_cents INTEGER NOT NULL DEFAULT 0,
        expenses_cents INTEGER NOT NULL DEFAULT 0,
        reinvested_cents INTEGER NOT NULL DEFAULT 0,
        opening_cash_cents INTEGER,
        note TEXT,
        source_json TEXT,
        dirty INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0, 1)),
        deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
        resource_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE data_change_log (
        id TEXT PRIMARY KEY,
        changed_at INTEGER NOT NULL,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        before_data TEXT,
        after_data TEXT,
        actor TEXT,
        resolution TEXT,
        resolved_at INTEGER,
        commit_id TEXT
      );
      INSERT INTO ledger_entries VALUES (
        'legacy', 1767225600000, 'Working value', 'Realized',
        0, 0, 0, NULL, NULL, NULL, 1, 0, 2, 50, 200
      );
      INSERT INTO data_change_log
        (id, changed_at, table_name, row_id, operation, before_data)
      VALUES (
        'legacy-log', 200, 'ledger_entries', 'legacy', 'update',
        '{"id":"legacy","entry_at":1767225600000,"description":"Committed value","lifecycle_status":"Realized","revenue_cents":0,"expenses_cents":0,"reinvested_cents":0,"opening_cash_cents":null,"note":null,"source_json":null,"dirty":0,"deleted":0,"resource_version":1,"created_at":50,"updated_at":100}'
      );
    `);
    const service = new BankingResourceService(createRegistry(), store);
    assert.equal(
      store.database.prepare(
        "SELECT count(*) AS count FROM pragma_table_info('ledger_entries') WHERE name = 'dirty'",
      ).get()!.count,
      0,
    );
    assert.equal(
      store.database.prepare('SELECT committed_at FROM ledger_entries WHERE id = ?').get('legacy')!.committed_at,
      null,
    );
    assert.equal(
      store.database.prepare('SELECT committed_at FROM data_change_log WHERE id = ?').get('legacy-log')!.committed_at,
      100,
    );
    const restored = service.discard(['legacy']).result[0];
    assert.equal(restored.spec.description, 'Committed value');
    assert.equal(restored.status.committedAt, new Date(100).toISOString());
  } finally {
    store.close();
  }
});

test('rejects invalid opening entries without partial resources or events', () => {
  const { store, service } = setup();
  try {
    assert.throws(() => service.create({
      kind: 'LedgerEntry',
      spec: spec({ openingCashOnHand: '100.00', revenue: '1.00' }),
    }), /zero revenue/);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM ledger_entries').get()!.count, 0);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM audit_events').get()!.count, 0);
    assert.equal(store.database.prepare('SELECT count(*) AS count FROM domain_events').get()!.count, 0);
  } finally {
    store.close();
  }
});

test('summarizes data-driven statuses and worksheet provenance', () => {
  const entries = [
    ['Realized', '1000.00', '250.00'],
    ['Planned', '2000.00', '500.00'],
    ['Estimated', '300.00', '450.00'],
  ].map(([status, revenue, expenses], index) => ({
    kind: 'LedgerEntry',
    metadata: { id: String(index), createdAt: '', updatedAt: '', resourceVersion: 1 },
    spec: {
      status,
      revenue,
      expenses,
      reinvested: '0.00',
      date: status === 'Estimated' ? '2025-09-15' : '2026-01-01',
      description: status,
      source: status === 'Estimated'
        ? { system: 'xlsx-import', worksheet: '2026 Ledger', row: '102' }
        : undefined,
    },
    status: { cashDelta: '0.00', operatingCashFlow: '0.00', cashOnHand: '0.00' },
    relationships: {},
  }));
  const summary = summarizeLedger(entries, '2026');
  assert.deepEqual(summary.groups.map(({ status, revenue, expenses, operatingCashFlow }) => ({
    status, revenue, expenses, operatingCashFlow,
  })), [
    { status: 'Realized', revenue: '1000.00', expenses: '250.00', operatingCashFlow: '750.00' },
    { status: 'Planned', revenue: '2000.00', expenses: '500.00', operatingCashFlow: '1500.00' },
    { status: 'Estimated', revenue: '300.00', expenses: '450.00', operatingCashFlow: '-150.00' },
  ]);
  assert.deepEqual(summary.total, {
    revenue: '3300.00',
    expenses: '1200.00',
    operatingCashFlow: '2100.00',
    activeEntryCount: 3,
  });
});
