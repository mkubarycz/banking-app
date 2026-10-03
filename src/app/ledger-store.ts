import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { ResourceEnvelope } from '../framework/types.js';
import { cents, money } from './money.js';
import { LedgerEntrySpec } from './resources/ledger-entry.js';

export interface LedgerRow {
  id: string;
  entryAt: number;
  description: string;
  lifecycleStatus: string;
  revenueCents: number;
  expensesCents: number;
  reinvestedCents: number;
  openingCashCents: number | null;
  note: string | null;
  sourceJson: string | null;
  committedAt: number | null;
  deleted: boolean;
  resourceVersion: number;
  createdAt: number;
  updatedAt: number;
}

export function initializeLedgerSchema(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER IF EXISTS ledger_entries_log_insert;
    DROP TRIGGER IF EXISTS ledger_entries_log_first_dirty_update;
    DROP TRIGGER IF EXISTS ledger_entries_require_dirty;
    DROP TRIGGER IF EXISTS ledger_entries_require_uncommitted;
    DROP TRIGGER IF EXISTS ledger_entries_prevent_physical_delete;
    DROP INDEX IF EXISTS ledger_entries_dirty_idx;

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
      committed_at INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
      resource_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_change_log (
      id TEXT PRIMARY KEY,
      changed_at INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL
        CHECK (operation IN ('create', 'update', 'delete', 'restore')),
      before_data TEXT,
      after_data TEXT,
      actor TEXT,
      committed_at INTEGER,
      resolution TEXT
        CHECK (resolution IS NULL OR resolution IN ('committed', 'discarded')),
      resolved_at INTEGER,
      commit_id TEXT
    );
  `);
  migrateCommittedAt(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS ledger_entries_timeline_idx
      ON ledger_entries(entry_at, id) WHERE deleted = 0;
    CREATE INDEX IF NOT EXISTS ledger_entries_status_idx
      ON ledger_entries(lifecycle_status, entry_at) WHERE deleted = 0;
    CREATE INDEX IF NOT EXISTS ledger_entries_uncommitted_idx
      ON ledger_entries(committed_at) WHERE committed_at IS NULL;
    CREATE INDEX IF NOT EXISTS ledger_entries_deleted_idx
      ON ledger_entries(deleted) WHERE deleted = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS data_change_log_open_row_idx
      ON data_change_log(table_name, row_id) WHERE resolution IS NULL;
    CREATE INDEX IF NOT EXISTS data_change_log_commit_idx
      ON data_change_log(commit_id);

    CREATE TRIGGER IF NOT EXISTS ledger_entries_log_insert
    AFTER INSERT ON ledger_entries
    WHEN NEW.committed_at IS NULL
    BEGIN
      INSERT INTO data_change_log
        (id, changed_at, table_name, row_id, operation, before_data, committed_at)
      VALUES
        (lower(hex(randomblob(16))), NEW.updated_at, 'ledger_entries', NEW.id, 'create', NULL, NULL);
    END;

    CREATE TRIGGER IF NOT EXISTS ledger_entries_log_first_dirty_update
    BEFORE UPDATE ON ledger_entries
    WHEN OLD.committed_at IS NOT NULL
      AND NEW.committed_at IS NULL
      AND (
        OLD.entry_at IS NOT NEW.entry_at
        OR OLD.description IS NOT NEW.description
        OR OLD.lifecycle_status IS NOT NEW.lifecycle_status
        OR OLD.revenue_cents IS NOT NEW.revenue_cents
        OR OLD.expenses_cents IS NOT NEW.expenses_cents
        OR OLD.reinvested_cents IS NOT NEW.reinvested_cents
        OR OLD.opening_cash_cents IS NOT NEW.opening_cash_cents
        OR OLD.note IS NOT NEW.note
        OR OLD.source_json IS NOT NEW.source_json
        OR OLD.deleted IS NOT NEW.deleted
      )
    BEGIN
      INSERT INTO data_change_log
        (id, changed_at, table_name, row_id, operation, before_data, committed_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.updated_at,
        'ledger_entries',
        NEW.id,
        CASE
          WHEN OLD.deleted = 0 AND NEW.deleted = 1 THEN 'delete'
          WHEN OLD.deleted = 1 AND NEW.deleted = 0 THEN 'restore'
          ELSE 'update'
        END,
        json_object(
          'id', OLD.id,
          'entry_at', OLD.entry_at,
          'description', OLD.description,
          'lifecycle_status', OLD.lifecycle_status,
          'revenue_cents', OLD.revenue_cents,
          'expenses_cents', OLD.expenses_cents,
          'reinvested_cents', OLD.reinvested_cents,
          'opening_cash_cents', OLD.opening_cash_cents,
          'note', OLD.note,
          'source_json', OLD.source_json,
          'deleted', OLD.deleted,
          'resource_version', OLD.resource_version,
          'created_at', OLD.created_at,
          'updated_at', OLD.updated_at
        ),
        OLD.committed_at
      );
    END;

    CREATE TRIGGER IF NOT EXISTS ledger_entries_require_uncommitted
    BEFORE UPDATE ON ledger_entries
    WHEN OLD.committed_at IS NOT NULL
      AND NEW.committed_at IS NOT NULL
      AND (
        OLD.entry_at IS NOT NEW.entry_at
        OR OLD.description IS NOT NEW.description
        OR OLD.lifecycle_status IS NOT NEW.lifecycle_status
        OR OLD.revenue_cents IS NOT NEW.revenue_cents
        OR OLD.expenses_cents IS NOT NEW.expenses_cents
        OR OLD.reinvested_cents IS NOT NEW.reinvested_cents
        OR OLD.opening_cash_cents IS NOT NEW.opening_cash_cents
        OR OLD.note IS NOT NEW.note
        OR OLD.source_json IS NOT NEW.source_json
        OR OLD.deleted IS NOT NEW.deleted
      )
    BEGIN
      SELECT RAISE(ABORT, 'Editable ledger changes must clear committed_at.');
    END;

    CREATE TRIGGER IF NOT EXISTS ledger_entries_prevent_physical_delete
    BEFORE DELETE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'Ledger entries must be soft deleted.');
    END;
  `);
}

function migrateCommittedAt(database: DatabaseSync): void {
  const ledgerColumns = database.prepare('PRAGMA table_info(ledger_entries)').all() as Array<
    Record<string, SQLInputValue>
  >;
  const ledgerNames = new Set(ledgerColumns.map((column) => String(column.name)));
  const logColumns = database.prepare('PRAGMA table_info(data_change_log)').all() as Array<
    Record<string, SQLInputValue>
  >;
  const logNames = new Set(logColumns.map((column) => String(column.name)));
  if (!logNames.has('committed_at')) {
    database.exec('ALTER TABLE data_change_log ADD COLUMN committed_at INTEGER;');
  }
  if (!ledgerNames.has('committed_at')) {
    database.exec('ALTER TABLE ledger_entries ADD COLUMN committed_at INTEGER;');
  }
  if (ledgerNames.has('dirty')) {
    database.exec(`
      UPDATE ledger_entries
      SET committed_at = CASE WHEN dirty = 0 THEN updated_at ELSE NULL END;
      UPDATE data_change_log
      SET committed_at = CAST(json_extract(before_data, '$.updated_at') AS INTEGER)
      WHERE before_data IS NOT NULL AND committed_at IS NULL;
      ALTER TABLE ledger_entries DROP COLUMN dirty;
    `);
  }
}

export function activeRows(database: DatabaseSync): LedgerRow[] {
  return rows(database, 'WHERE deleted = 0');
}

export function dirtyRows(database: DatabaseSync): LedgerRow[] {
  return rows(database, 'WHERE committed_at IS NULL');
}

export function getRow(
  database: DatabaseSync,
  id: string,
  includeDeleted = false,
): LedgerRow | undefined {
  const value = database.prepare(
    `SELECT * FROM ledger_entries WHERE id = ?${includeDeleted ? '' : ' AND deleted = 0'}`,
  ).get(id);
  return value ? toRow(value) : undefined;
}

export function calculatedEnvelopes(
  database: DatabaseSync,
  includeDirtyDeleted = false,
): Map<string, ResourceEnvelope> {
  const active = activeRows(database);
  const result = new Map<string, ResourceEnvelope>();
  let running = 0n;
  active.forEach((row, index) => {
    const spec = rowSpec(row);
    const revenue = BigInt(row.revenueCents);
    const expenses = BigInt(row.expensesCents);
    const reinvested = BigInt(row.reinvestedCents);
    const cashDelta = revenue - expenses - reinvested;
    const operatingCashFlow = revenue - expenses;
    if (row.openingCashCents !== null) {
      if (index !== 0) throw new Error('Only the first chronological LedgerEntry may establish openingCashOnHand.');
      if (cashDelta !== 0n || revenue !== 0n || expenses !== 0n || reinvested !== 0n) {
        throw new Error('An opening LedgerEntry must have zero revenue, expenses, and reinvested.');
      }
      running = BigInt(row.openingCashCents);
    } else {
      running += cashDelta;
    }
    result.set(row.id, envelope(row, {
      cashDelta: money(cashDelta),
      operatingCashFlow: money(operatingCashFlow),
      cashOnHand: money(running),
      dirty: row.committedAt === null,
      committedAt: row.committedAt === null ? null : new Date(row.committedAt).toISOString(),
      deleted: false,
      previousSpec: row.committedAt === null ? previousSpec(database, row.id) : undefined,
    }));
  });
  if (includeDirtyDeleted) {
    for (const row of dirtyRows(database).filter((candidate) => candidate.deleted)) {
      const revenue = BigInt(row.revenueCents);
      const expenses = BigInt(row.expensesCents);
      const reinvested = BigInt(row.reinvestedCents);
      result.set(row.id, envelope(row, {
        cashDelta: money(revenue - expenses - reinvested),
        operatingCashFlow: money(revenue - expenses),
        cashOnHand: '0.00',
        dirty: true,
        committedAt: null,
        deleted: true,
        previousSpec: previousSpec(database, row.id),
      }));
    }
  }
  return result;
}

export function rowSpec(row: LedgerRow): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    status: row.lifecycleStatus,
    description: row.description,
    date: new Date(row.entryAt).toISOString().slice(0, 10),
    revenue: money(BigInt(row.revenueCents)),
    expenses: money(BigInt(row.expensesCents)),
    reinvested: money(BigInt(row.reinvestedCents)),
  };
  if (row.openingCashCents !== null) spec.openingCashOnHand = money(BigInt(row.openingCashCents));
  if (row.note !== null) spec.note = row.note;
  if (row.sourceJson !== null) spec.source = JSON.parse(row.sourceJson);
  return spec;
}

export function appendEntryAt(database: DatabaseSync, date: string, excludeId?: string): number {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  const end = start + 86_400_000;
  const row = database.prepare(`
    SELECT MAX(entry_at) AS latest
    FROM ledger_entries
    WHERE entry_at >= ? AND entry_at < ? AND id <> COALESCE(?, '')
  `).get(start, end, excludeId ?? null) as Record<string, SQLInputValue> | undefined;
  return row?.latest === null || row?.latest === undefined ? start : Number(row.latest) + 1;
}

export function serializeRow(row: LedgerRow): string {
  return JSON.stringify({
    id: row.id,
    entry_at: row.entryAt,
    description: row.description,
    lifecycle_status: row.lifecycleStatus,
    revenue_cents: row.revenueCents,
    expenses_cents: row.expensesCents,
    reinvested_cents: row.reinvestedCents,
    opening_cash_cents: row.openingCashCents,
    note: row.note,
    source_json: row.sourceJson,
    committed_at: row.committedAt,
    deleted: row.deleted ? 1 : 0,
    resource_version: row.resourceVersion,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

export function previousSpec(database: DatabaseSync, id: string): Record<string, unknown> | null | undefined {
  const log = database.prepare(`
    SELECT before_data FROM data_change_log
    WHERE table_name = 'ledger_entries' AND row_id = ? AND resolution IS NULL
  `).get(id) as Record<string, SQLInputValue> | undefined;
  if (!log) return undefined;
  if (log.before_data === null) return null;
  return rowSpec(logDataToRow(String(log.before_data)));
}

export function logDataToRow(value: string): LedgerRow {
  return toRow(JSON.parse(value));
}

function rows(database: DatabaseSync, where: string): LedgerRow[] {
  return database.prepare(
    `SELECT * FROM ledger_entries ${where} ORDER BY entry_at, id`,
  ).all().map(toRow);
}

function envelope(
  row: LedgerRow,
  status: ResourceEnvelope['status'],
): ResourceEnvelope {
  return {
    kind: 'LedgerEntry',
    metadata: {
      id: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      resourceVersion: row.resourceVersion,
    },
    spec: LedgerEntrySpec.parse(rowSpec(row)),
    status,
    relationships: {},
  };
}

function toRow(value: unknown): LedgerRow {
  const row = value as Record<string, SQLInputValue>;
  return {
    id: String(row.id),
    entryAt: Number(row.entry_at),
    description: String(row.description),
    lifecycleStatus: String(row.lifecycle_status),
    revenueCents: Number(row.revenue_cents),
    expensesCents: Number(row.expenses_cents),
    reinvestedCents: Number(row.reinvested_cents),
    openingCashCents: row.opening_cash_cents === null ? null : Number(row.opening_cash_cents),
    note: row.note === null ? null : String(row.note),
    sourceJson: row.source_json === null ? null : String(row.source_json),
    committedAt: row.committed_at === null
      ? null
      : row.committed_at === undefined
        ? Number(row.updated_at)
        : Number(row.committed_at),
    deleted: Number(row.deleted) === 1,
    resourceVersion: Number(row.resource_version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
