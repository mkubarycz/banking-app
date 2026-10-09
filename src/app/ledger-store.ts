import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { ResourceEnvelope } from '../framework/types.js';
import { money } from './money.js';
import { LedgerEntryGroupSpec } from './resources/ledger-entry-group.js';
import { LedgerEntryRelationships, LedgerEntrySpec } from './resources/ledger-entry.js';

export const DEFAULT_IDS = {
  assetCategory: '00000000-0000-4000-8000-000000000001',
  accountsReceivableCategory: '00000000-0000-4000-8000-000000000002',
  accountsPayableCategory: '00000000-0000-4000-8000-000000000003',
  retirementCategory: '00000000-0000-4000-8000-000000000004',
  investmentAssetsCategory: '00000000-0000-4000-8000-000000000005',
  cashAccount: '00000000-0000-4000-8000-000000000101',
  accountsReceivableAccount: '00000000-0000-4000-8000-000000000102',
  accountsPayableAccount: '00000000-0000-4000-8000-000000000103',
  retirementAccount: '00000000-0000-4000-8000-000000000104',
} as const;

export interface LedgerGroupRow {
  id: string;
  entryAt: number;
  description: string;
  lifecycleStatus: string;
  openingCashCents: number | null;
  note: string | null;
  sourceJson: string | null;
  committedAt: number | null;
  deleted: boolean;
  resourceVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface LedgerItemRow {
  id: string;
  groupId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  note: string | null;
  resourceVersion: number;
  createdAt: number;
  updatedAt: number;
}

export function initializeLedgerSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
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
      account_id TEXT,
      category_id TEXT,
      committed_at INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
      resource_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger_items (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      from_account_id TEXT NOT NULL,
      to_account_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      note TEXT,
      resource_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES ledger_entries(id)
    );
    CREATE INDEX IF NOT EXISTS ledger_items_group_idx ON ledger_items(group_id, created_at, id);
    CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_change_log (
      id TEXT PRIMARY KEY,
      changed_at INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      before_data TEXT,
      after_data TEXT,
      actor TEXT,
      committed_at INTEGER,
      items_before TEXT,
      resolution TEXT,
      resolved_at INTEGER,
      commit_id TEXT
    );
  `);
  migrateColumns(database);
  seedDefaults(database);
  migrateCategoryVocabulary(database);
  migrateInvestmentAssets(database);
  migrateAccountInternality(database);
  migrateLegacyRows(database);
  repairSignedLegacyEntries(database);
  createTriggers(database);
}

function migrateColumns(database: DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(ledger_entries)').all() as Array<Record<string, SQLInputValue>>;
  const names = new Set(columns.map((column) => String(column.name)));
  const additions: Array<[string, string]> = [
    ['account_id', 'TEXT'], ['category_id', 'TEXT'], ['committed_at', 'INTEGER'],
  ];
  for (const [name, type] of additions) {
    if (!names.has(name)) database.exec(`ALTER TABLE ledger_entries ADD COLUMN ${name} ${type};`);
  }
  if (names.has('dirty')) {
    database.exec(`
      UPDATE ledger_entries SET committed_at = CASE WHEN dirty = 0 THEN updated_at ELSE NULL END;
      ALTER TABLE ledger_entries DROP COLUMN dirty;
    `);
  }
  const logColumns = database.prepare('PRAGMA table_info(data_change_log)').all() as Array<Record<string, SQLInputValue>>;
  if (!logColumns.some((column) => String(column.name) === 'committed_at')) {
    database.exec('ALTER TABLE data_change_log ADD COLUMN committed_at INTEGER;');
  }
  if (!logColumns.some((column) => String(column.name) === 'items_before')) {
    database.exec('ALTER TABLE data_change_log ADD COLUMN items_before TEXT;');
  }
}

function seedDefaults(database: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO resources
      (id, kind, spec, status, relationships, resource_version, created_at, updated_at)
    VALUES (?, ?, ?, '{}', ?, 1, ?, ?)
  `);
  const categories = [
    [DEFAULT_IDS.assetCategory, 'Cash', 'Asset'],
    [DEFAULT_IDS.accountsReceivableCategory, 'Accounts Receivable', 'AccountsReceivable'],
    [DEFAULT_IDS.accountsPayableCategory, 'Accounts Payable', 'AccountsPayable'],
    [DEFAULT_IDS.retirementCategory, 'Retirement', 'Retirement'],
    [DEFAULT_IDS.investmentAssetsCategory, 'Investment Assets', 'InvestmentAsset'],
  ];
  for (const [id, name, classification] of categories) {
    insert.run(id, 'Category', JSON.stringify({ name, classification }), '{}', now, now);
  }
  const accounts = [
    [DEFAULT_IDS.cashAccount, 'Cash', DEFAULT_IDS.assetCategory],
    [DEFAULT_IDS.accountsReceivableAccount, 'Misc Accounts Receivable', DEFAULT_IDS.accountsReceivableCategory],
    [DEFAULT_IDS.accountsPayableAccount, 'Misc Accounts Payable', DEFAULT_IDS.accountsPayableCategory],
    [DEFAULT_IDS.retirementAccount, 'Misc Retirement Account', DEFAULT_IDS.retirementCategory],
  ];
  const externalCategoryIds = new Set<string>([
    DEFAULT_IDS.accountsReceivableCategory,
    DEFAULT_IDS.accountsPayableCategory,
    DEFAULT_IDS.investmentAssetsCategory,
  ]);
  for (const [id, name, categoryId] of accounts) {
    insert.run(
      id,
      'Account',
      JSON.stringify({
        name,
        currency: 'USD',
        internal: !externalCategoryIds.has(categoryId),
      }),
      JSON.stringify({ categoryId }),
      now,
      now,
    );
  }
}

function migrateInvestmentAssets(database: DatabaseSync): void {
  const migrationId = '004-investment-assets-category';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migrationId)) return;
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE resources
    SET relationships = json_set(relationships, '$.categoryId', ?),
        resource_version = resource_version + 1,
        updated_at = ?
    WHERE kind = 'Account' AND json_type(spec, '$.internal') IS NULL
      AND json_extract(spec, '$.name') = 'Mutual Fund - ARTFX'
  `).run(DEFAULT_IDS.investmentAssetsCategory, now);
  database.prepare(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migrationId, now);
}

function migrateAccountInternality(database: DatabaseSync): void {
  const migrationId = '005-account-internal-boundary';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migrationId)) return;
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE resources
    SET spec = json_set(
      spec,
      '$.internal',
      CASE
        WHEN json_extract(relationships, '$.categoryId') IN (?, ?, ?) THEN json('false')
        ELSE json('true')
      END
    ), resource_version = resource_version + 1, updated_at = ?
    WHERE kind = 'Account'
  `).run(
    DEFAULT_IDS.accountsReceivableCategory,
    DEFAULT_IDS.accountsPayableCategory,
    DEFAULT_IDS.investmentAssetsCategory,
    now,
  );
  database.prepare(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migrationId, now);
}

function migrateCategoryVocabulary(database: DatabaseSync): void {
  const migrationId = '003-accounts-receivable-payable-vocabulary';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migrationId)) return;
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE resources
    SET spec = json_set(
      spec,
      '$.classification',
      CASE json_extract(spec, '$.classification')
        WHEN 'Revenue' THEN 'AccountsReceivable'
        WHEN 'Expense' THEN 'AccountsPayable'
      END,
      '$.name',
      CASE json_extract(spec, '$.name')
        WHEN 'Revenue' THEN 'Accounts Receivable'
        WHEN 'Expense' THEN 'Accounts Payable'
        ELSE json_extract(spec, '$.name')
      END
    ), resource_version = resource_version + 1, updated_at = ?
    WHERE kind = 'Category'
      AND json_extract(spec, '$.classification') IN ('Revenue', 'Expense')
  `).run(now);
  database.prepare(`
    UPDATE resources
    SET spec = json_set(
      spec,
      '$.name',
      CASE id
        WHEN ? THEN 'Misc Accounts Receivable'
        WHEN ? THEN 'Misc Accounts Payable'
      END
    ), resource_version = resource_version + 1, updated_at = ?
    WHERE kind = 'Account' AND id IN (?, ?)
      AND json_extract(spec, '$.name') IN ('Misc Revenue Account', 'Misc Expense Account')
  `).run(
    DEFAULT_IDS.accountsReceivableAccount,
    DEFAULT_IDS.accountsPayableAccount,
    now,
    DEFAULT_IDS.accountsReceivableAccount,
    DEFAULT_IDS.accountsPayableAccount,
  );
  database.prepare(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migrationId, now);
}

function migrateLegacyRows(database: DatabaseSync): void {
  const rows = database.prepare(`
    SELECT * FROM ledger_entries
    WHERE NOT EXISTS (SELECT 1 FROM ledger_items WHERE group_id = ledger_entries.id)
  `).all() as Array<Record<string, SQLInputValue>>;
  const insert = database.prepare(`
    INSERT INTO ledger_items
      (id, group_id, from_account_id, to_account_id, amount_cents, note,
       resource_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)
  `);
  for (const row of rows) {
    const values: Array<[string, string, number]> = [];
    if (Number(row.revenue_cents) !== 0) values.push(legacyTransfer(
      Number(row.revenue_cents), DEFAULT_IDS.accountsReceivableAccount, DEFAULT_IDS.cashAccount,
    ));
    if (Number(row.expenses_cents) !== 0) values.push(legacyTransfer(
      Number(row.expenses_cents), DEFAULT_IDS.cashAccount, DEFAULT_IDS.accountsPayableAccount,
    ));
    if (Number(row.reinvested_cents) !== 0) values.push(legacyTransfer(
      Number(row.reinvested_cents), DEFAULT_IDS.cashAccount, DEFAULT_IDS.retirementAccount,
    ));
    if (!values.length) values.push([DEFAULT_IDS.cashAccount, DEFAULT_IDS.accountsPayableAccount, 0]);
    values.forEach(([from, to, amount], index) => insert.run(
      deterministicItemId(String(row.id), index),
      row.id,
      from,
      to,
      amount,
      row.created_at,
      row.updated_at,
    ));
  }
}

function repairSignedLegacyEntries(database: DatabaseSync): void {
  const migrationId = '002-repair-signed-ledger-items';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migrationId)) return;
  const rows = database.prepare('SELECT * FROM ledger_entries').all() as Array<Record<string, SQLInputValue>>;
  const update = database.prepare(`
    UPDATE ledger_items
    SET from_account_id = ?, to_account_id = ?, amount_cents = ?
    WHERE id = ? AND group_id = ?
  `);
  for (const row of rows) {
    const values: Array<[string, string, number]> = [];
    if (Number(row.revenue_cents) !== 0) values.push(legacyTransfer(
      Number(row.revenue_cents), DEFAULT_IDS.accountsReceivableAccount, DEFAULT_IDS.cashAccount,
    ));
    if (Number(row.expenses_cents) !== 0) values.push(legacyTransfer(
      Number(row.expenses_cents), DEFAULT_IDS.cashAccount, DEFAULT_IDS.accountsPayableAccount,
    ));
    if (Number(row.reinvested_cents) !== 0) values.push(legacyTransfer(
      Number(row.reinvested_cents), DEFAULT_IDS.cashAccount, DEFAULT_IDS.retirementAccount,
    ));
    if (!values.length) values.push([DEFAULT_IDS.cashAccount, DEFAULT_IDS.accountsPayableAccount, 0]);
    values.forEach(([from, to, amount], index) => update.run(
      from, to, amount, deterministicItemId(String(row.id), index), row.id,
    ));
  }
  database.prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)').run(
    migrationId,
    new Date().toISOString(),
  );
}

function legacyTransfer(
  amount: number,
  positiveFrom: string,
  positiveTo: string,
): [string, string, number] {
  return amount < 0
    ? [positiveTo, positiveFrom, Math.abs(amount)]
    : [positiveFrom, positiveTo, amount];
}

function deterministicItemId(groupId: string, index: number): string {
  const hex = groupId.replaceAll('-', '').padEnd(32, '0').slice(0, 30);
  const suffix = index.toString(16).padStart(2, '0');
  const value = `${hex}${suffix}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

function createTriggers(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER IF EXISTS ledger_entries_log_insert;
    DROP TRIGGER IF EXISTS ledger_entries_log_first_dirty_update;
    DROP TRIGGER IF EXISTS ledger_entries_prevent_physical_delete;
    CREATE UNIQUE INDEX IF NOT EXISTS data_change_log_open_row_idx
      ON data_change_log(table_name, row_id) WHERE resolution IS NULL;
    CREATE TRIGGER ledger_entries_log_insert AFTER INSERT ON ledger_entries
    WHEN NEW.committed_at IS NULL BEGIN
      INSERT INTO data_change_log
        (id, changed_at, table_name, row_id, operation, before_data, committed_at)
      VALUES (lower(hex(randomblob(16))), NEW.updated_at, 'ledger_entries', NEW.id, 'create', NULL, NULL);
    END;
    CREATE TRIGGER ledger_entries_log_first_dirty_update BEFORE UPDATE ON ledger_entries
    WHEN OLD.committed_at IS NOT NULL AND NEW.committed_at IS NULL BEGIN
      INSERT INTO data_change_log
        (id, changed_at, table_name, row_id, operation, before_data, committed_at)
      VALUES (
        lower(hex(randomblob(16))), NEW.updated_at, 'ledger_entries', NEW.id,
        CASE WHEN OLD.deleted = 0 AND NEW.deleted = 1 THEN 'delete' ELSE 'update' END,
        json_object(
          'id', OLD.id, 'entry_at', OLD.entry_at, 'description', OLD.description,
          'lifecycle_status', OLD.lifecycle_status, 'opening_cash_cents', OLD.opening_cash_cents,
          'note', OLD.note, 'source_json', OLD.source_json, 'deleted', OLD.deleted,
          'resource_version', OLD.resource_version, 'created_at', OLD.created_at,
          'updated_at', OLD.updated_at
        ),
        OLD.committed_at
      );
    END;
    CREATE TRIGGER ledger_entries_prevent_physical_delete BEFORE DELETE ON ledger_entries
    BEGIN SELECT RAISE(ABORT, 'Ledger entry groups must be soft deleted.'); END;
  `);
}

export function groupRows(database: DatabaseSync, includeDeleted = false): LedgerGroupRow[] {
  return database.prepare(
    `SELECT * FROM ledger_entries${includeDeleted ? '' : ' WHERE deleted = 0'} ORDER BY entry_at, id`,
  ).all().map(toGroupRow);
}

export function dirtyGroupRows(database: DatabaseSync): LedgerGroupRow[] {
  return database.prepare('SELECT * FROM ledger_entries WHERE committed_at IS NULL ORDER BY entry_at, id')
    .all().map(toGroupRow);
}

export function getGroupRow(database: DatabaseSync, id: string, includeDeleted = false): LedgerGroupRow | undefined {
  const value = database.prepare(
    `SELECT * FROM ledger_entries WHERE id = ?${includeDeleted ? '' : ' AND deleted = 0'}`,
  ).get(id);
  return value ? toGroupRow(value) : undefined;
}

export function itemRows(database: DatabaseSync, groupId?: string): LedgerItemRow[] {
  const values = groupId
    ? database.prepare('SELECT * FROM ledger_items WHERE group_id = ? ORDER BY created_at, id').all(groupId)
    : database.prepare('SELECT * FROM ledger_items ORDER BY created_at, id').all();
  return values.map(toItemRow);
}

export function getItemRow(database: DatabaseSync, id: string): LedgerItemRow | undefined {
  const value = database.prepare('SELECT * FROM ledger_items WHERE id = ?').get(id);
  return value ? toItemRow(value) : undefined;
}

export function calculatedGroupEnvelopes(
  database: DatabaseSync,
  includeDirtyDeleted = false,
): Map<string, ResourceEnvelope> {
  const rows = groupRows(database, includeDirtyDeleted);
  const internality = accountInternality(database);
  const result = new Map<string, ResourceEnvelope>();
  let cashOnHand = 0n;
  for (const row of rows) {
    const totals = groupTotals(itemRows(database, row.id), internality);
    if (row.openingCashCents !== null) cashOnHand = BigInt(row.openingCashCents);
    cashOnHand += totals.cashDelta;
    result.set(row.id, groupEnvelope(database, row, totals, cashOnHand));
  }
  return result;
}

function groupTotals(
  items: LedgerItemRow[],
  internality: Map<string, boolean>,
): { income: bigint; expense: bigint; transfers: bigint; cashDelta: bigint } {
  let income = 0n;
  let expense = 0n;
  let transfers = 0n;
  let cashDelta = 0n;
  for (const item of items) {
    const amount = BigInt(item.amountCents);
    const fromInternal = internality.get(item.fromAccountId);
    const toInternal = internality.get(item.toAccountId);
    if (fromInternal === false && toInternal === true) income += amount;
    else if (fromInternal === true && toInternal === false) expense += amount;
    else transfers += amount;
    if (item.toAccountId === DEFAULT_IDS.cashAccount) cashDelta += amount;
    if (item.fromAccountId === DEFAULT_IDS.cashAccount) cashDelta -= amount;
  }

  return { income, expense, transfers, cashDelta };
}

export function accountBalances(database: DatabaseSync): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const group of groupRows(database)) {
    for (const item of itemRows(database, group.id)) {
      const amount = BigInt(item.amountCents);
      balances.set(item.fromAccountId, (balances.get(item.fromAccountId) ?? 0n) - amount);
      balances.set(item.toAccountId, (balances.get(item.toAccountId) ?? 0n) + amount);
    }
  }
  const opening = groupRows(database).find((row) => row.openingCashCents !== null)?.openingCashCents;
  if (opening !== undefined && opening !== null) {
    balances.set(DEFAULT_IDS.cashAccount, (balances.get(DEFAULT_IDS.cashAccount) ?? 0n) + BigInt(opening));
  }
  return balances;
}

function accountInternality(database: DatabaseSync): Map<string, boolean> {
  const rows = database.prepare(`
    SELECT id, json_extract(spec, '$.internal') AS internal
    FROM resources
    WHERE kind = 'Account'
  `).all() as Array<Record<string, SQLInputValue>>;
  return new Map(rows.map((row) => [String(row.id), Number(row.internal) === 1]));
}

function groupEnvelope(
  database: DatabaseSync,
  row: LedgerGroupRow,
  totals: { income: bigint; expense: bigint; transfers: bigint; cashDelta: bigint },
  cashOnHand: bigint,
): ResourceEnvelope {
  const income = totals.income;
  const expense = totals.expense;
  const transfers = totals.transfers;
  return {
    kind: 'LedgerEntryGroup',
    metadata: metadata(row),
    spec: LedgerEntryGroupSpec.parse(groupSpec(row)),
    status: {
      income: money(income),
      expense: money(expense),
      transfers: money(transfers),
      cashDelta: money(totals.cashDelta),
      operatingCashFlow: money(income - expense),
      cashOnHand: money(cashOnHand),
      dirty: row.committedAt === null,
      committedAt: row.committedAt === null ? null : new Date(row.committedAt).toISOString(),
      deleted: row.deleted,
      previousSpec: row.committedAt === null ? previousGroupSpec(database, row.id) : undefined,
    },
    relationships: { ledgerEntryIds: itemRows(database, row.id).map((item) => item.id) },
  };
}

export function itemEnvelope(row: LedgerItemRow): ResourceEnvelope {
  return {
    kind: 'LedgerEntry',
    metadata: metadata(row),
    spec: LedgerEntrySpec.parse({
      amount: money(BigInt(row.amountCents)),
      ...(row.note === null ? {} : { note: row.note }),
    }),
    status: {},
    relationships: LedgerEntryRelationships.parse({
      groupId: row.groupId,
      fromAccountId: row.fromAccountId,
      toAccountId: row.toAccountId,
    }),
  };
}

export function groupSpec(row: LedgerGroupRow): Record<string, unknown> {
  return {
    status: row.lifecycleStatus,
    description: row.description,
    date: new Date(row.entryAt).toISOString().slice(0, 10),
    ...(row.note === null ? {} : { note: row.note }),
  };
}

export function appendEntryAt(database: DatabaseSync, date: string, excludeId?: string): number {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  const row = database.prepare(`
    SELECT MAX(entry_at) AS latest FROM ledger_entries
    WHERE entry_at >= ? AND entry_at < ? AND id <> COALESCE(?, '')
  `).get(start, start + 86_400_000, excludeId ?? null) as Record<string, SQLInputValue>;
  return row.latest === null ? start : Number(row.latest) + 1;
}

export function serializeGroupRow(row: LedgerGroupRow): string {
  return JSON.stringify({
    id: row.id, entry_at: row.entryAt, description: row.description,
    lifecycle_status: row.lifecycleStatus, opening_cash_cents: row.openingCashCents,
    note: row.note, source_json: row.sourceJson, committed_at: row.committedAt,
    deleted: row.deleted ? 1 : 0, resource_version: row.resourceVersion,
    created_at: row.createdAt, updated_at: row.updatedAt,
  });
}

export function logDataToGroupRow(value: string): LedgerGroupRow {
  return toGroupRow(JSON.parse(value));
}

function previousGroupSpec(database: DatabaseSync, id: string): Record<string, unknown> | null | undefined {
  const log = database.prepare(`
    SELECT before_data FROM data_change_log
    WHERE table_name = 'ledger_entries' AND row_id = ? AND resolution IS NULL
  `).get(id) as Record<string, SQLInputValue> | undefined;
  if (!log) return undefined;
  return log.before_data === null ? null : groupSpec(logDataToGroupRow(String(log.before_data)));
}

function metadata(row: { id: string; createdAt: number; updatedAt: number; resourceVersion: number }) {
  return {
    id: row.id,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    resourceVersion: row.resourceVersion,
  };
}

function toGroupRow(value: unknown): LedgerGroupRow {
  const row = value as Record<string, SQLInputValue>;
  return {
    id: String(row.id),
    entryAt: Number(row.entry_at),
    description: String(row.description),
    lifecycleStatus: String(row.lifecycle_status),
    openingCashCents: row.opening_cash_cents == null ? null : Number(row.opening_cash_cents),
    note: row.note == null ? null : String(row.note),
    sourceJson: row.source_json == null ? null : String(row.source_json),
    committedAt: row.committed_at == null ? null : Number(row.committed_at),
    deleted: Number(row.deleted) === 1,
    resourceVersion: Number(row.resource_version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toItemRow(value: unknown): LedgerItemRow {
  const row = value as Record<string, SQLInputValue>;
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    fromAccountId: String(row.from_account_id),
    toAccountId: String(row.to_account_id),
    amountCents: Number(row.amount_cents),
    note: row.note == null ? null : String(row.note),
    resourceVersion: Number(row.resource_version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
