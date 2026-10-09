import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { ResourceEnvelope } from '../framework/types.js';
import { money } from './money.js';
import { DEFAULT_IDS } from './ledger-store.js';

export interface TransactionStagingRow {
  id: string;
  sourceKey: string;
  transactionAt: number;
  description: string;
  amountCents: number;
  sourceStatus: string;
  sourceType: string;
  sourceAccount: string;
  sourceFile: string;
  state: 'Unmapped' | 'Provisional' | 'Reconciled';
  fromAccountId: string | null;
  toAccountId: string | null;
  ledgerEntryId: string | null;
  deleted: boolean;
  committedAt: number | null;
  baselineJson: string | null;
  resourceVersion: number;
  createdAt: number;
  updatedAt: number;
}

interface ImportedResources {
  accounts: ResourceEnvelope[];
  transactions: ResourceEnvelope[];
}

interface CsvTransaction {
  date: string;
  description: string;
  amountCents: number;
  sourceStatus: string;
  sourceType: string;
  sourceAccountName: string;
  sourceAccountNumber: string;
  sourceAccountDisplay: string;
  sourceFile: string;
  sourceKey: string;
}

export function initializeTransactionStagingSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS transaction_staging (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      transaction_at INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      source_status TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_account TEXT NOT NULL,
      source_file TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('Unmapped', 'Provisional', 'Reconciled')),
      from_account_id TEXT,
      to_account_id TEXT,
      ledger_entry_id TEXT,
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
      committed_at INTEGER,
      baseline_json TEXT,
      resource_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS transaction_staging_state_idx
      ON transaction_staging(state, transaction_at, id);
    CREATE INDEX IF NOT EXISTS transaction_staging_ledger_entry_idx
      ON transaction_staging(ledger_entry_id);
  `);
  const columns = database.prepare(
    'PRAGMA table_info(transaction_staging)',
  ).all() as Array<Record<string, SQLInputValue>>;
  if (!columns.some((column) => String(column.name) === 'deleted')) {
    database.exec(`
      ALTER TABLE transaction_staging
      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1));
    `);
  }
  const now = Date.now();
  database.prepare(`
    UPDATE transaction_staging
    SET deleted = 1, committed_at = ?, baseline_json = NULL,
        resource_version = resource_version + 1, updated_at = ?
    WHERE amount_cents = 0 AND state = 'Unmapped' AND deleted = 0
  `).run(now, now);
}

export function transactionStagingRows(database: DatabaseSync): TransactionStagingRow[] {
  return (database.prepare(`
    SELECT * FROM transaction_staging WHERE deleted = 0
    ORDER BY transaction_at DESC, created_at DESC, id
  `).all() as Array<Record<string, SQLInputValue>>).map(toRow);
}

export function getTransactionStagingRow(
  database: DatabaseSync,
  id: string,
): TransactionStagingRow | undefined {
  const value = database.prepare(
    'SELECT * FROM transaction_staging WHERE id = ?',
  ).get(id) as Record<string, SQLInputValue> | undefined;
  return value ? toRow(value) : undefined;
}

export function transactionStagingEnvelope(row: TransactionStagingRow): ResourceEnvelope {
  const baseline = row.baselineJson
    ? JSON.parse(row.baselineJson) as TransactionStagingRow
    : undefined;
  return {
    kind: 'TransactionStaging',
    metadata: {
      id: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      resourceVersion: row.resourceVersion,
    },
    spec: stagingSpec(row),
    status: {
      state: row.state,
      dirty: row.committedAt === null,
      deleted: row.deleted,
      committedAt: row.committedAt === null ? null : new Date(row.committedAt).toISOString(),
      ...(baseline ? {
        previousSpec: stagingSpec(baseline),
        previousRelationships: stagingRelationships(baseline),
      } : {}),
    },
    relationships: stagingRelationships(row),
  };
}

export function serializeTransactionStagingRow(row: TransactionStagingRow): string {
  return JSON.stringify(row);
}

export function importTransactionFiles(
  database: DatabaseSync,
  directory: string,
  includeBeforeRealizedCutoff = false,
): ImportedResources {
  if (!existsSync(directory)) {
    throw new Error(`Transaction import path "${directory}" does not exist.`);
  }
  const accounts: ResourceEnvelope[] = [];
  const transactions: ResourceEnvelope[] = [];
  const realized = database.prepare(`
    SELECT MAX(entry_at) AS entry_at FROM ledger_entries
    WHERE deleted = 0 AND lower(lifecycle_status) IN ('realized', 'recognized')
  `).get() as Record<string, SQLInputValue>;
  const realizedThrough = realized.entry_at === null
    ? undefined
    : new Date(Number(realized.entry_at)).toISOString().slice(0, 10);
  const files = readdirSync(directory).filter((file) => file.toLowerCase().endsWith('.csv')).sort();
  for (const file of files) {
    for (const transaction of readTransactions(join(directory, file))) {
      if (!includeBeforeRealizedCutoff && realizedThrough && transaction.date <= realizedThrough) continue;
      if (transaction.amountCents === 0) continue;
      const account = ensureImportedAccount(database, transaction);
      if (account.created) accounts.push(account.resource);
      const now = Date.now();
      const id = stableUuid(`transaction:${transaction.sourceKey}`);
      const isOutflow = transaction.amountCents < 0;
      const result = database.prepare(`
        INSERT OR IGNORE INTO transaction_staging
          (id, source_key, transaction_at, description, amount_cents, source_status,
           source_type, source_account, source_file, state, from_account_id,
           to_account_id, ledger_entry_id, deleted, committed_at, baseline_json,
           resource_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unmapped', ?, ?, NULL, 0, ?, NULL, 1, ?, ?)
      `).run(
        id,
        transaction.sourceKey,
        Date.parse(`${transaction.date}T12:00:00.000Z`),
        transaction.description,
        Math.abs(transaction.amountCents),
        transaction.sourceStatus,
        transaction.sourceType,
        transaction.sourceAccountDisplay,
        transaction.sourceFile,
        isOutflow ? account.resource.metadata.id : null,
        isOutflow ? null : account.resource.metadata.id,
        now,
        now,
        now,
      );
      if (result.changes === 1) {
        transactions.push(transactionStagingEnvelope(
          getTransactionStagingRow(database, id)!,
        ));
      }
    }
  }
  return { accounts, transactions };
}

function ensureImportedAccount(
  database: DatabaseSync,
  transaction: CsvTransaction,
): { resource: ResourceEnvelope; created: boolean } {
  const id = stableUuid(`account:${transaction.sourceAccountNumber}`);
  const existing = database.prepare(
    'SELECT * FROM resources WHERE kind = ? AND id = ?',
  ).get('Account', id) as Record<string, SQLInputValue> | undefined;
  if (existing) return { resource: genericEnvelope(existing), created: false };
  const now = new Date().toISOString();
  const categoryId = /\bIRA\b/i.test(transaction.sourceAccountName)
    ? DEFAULT_IDS.retirementCategory
    : DEFAULT_IDS.assetCategory;
  database.prepare(`
    INSERT INTO resources
      (id, kind, spec, status, relationships, resource_version, created_at, updated_at)
    VALUES (?, 'Account', ?, '{}', ?, 1, ?, ?)
  `).run(
    id,
    JSON.stringify({
      name: transaction.sourceAccountDisplay,
      currency: 'USD',
      internal: true,
    }),
    JSON.stringify({ categoryId }),
    now,
    now,
  );
  return {
    resource: genericEnvelope(database.prepare(
      'SELECT * FROM resources WHERE kind = ? AND id = ?',
    ).get('Account', id) as Record<string, SQLInputValue>),
    created: true,
  };
}

function readTransactions(path: string): CsvTransaction[] {
  const records = parseCsv(readFileSync(path, 'utf8'));
  if (records.length < 2) return [];
  const headers = records[0];
  const indexes = new Map(headers.map((header, index) => [header.trim(), index]));
  if (indexes.has('Trade Date')) return readMerrillTransactions(path, records, indexes);
  if (indexes.has('Original Description')) return readAggregateTransactions(path, records, indexes);
  throw new Error(`${basename(path)} uses an unsupported transaction export format.`);
}

function readMerrillTransactions(
  path: string,
  records: string[][],
  indexes: Map<string, number>,
): CsvTransaction[] {
  const required = [
    'Trade Date', 'Pending/Settled', 'Account Nickname', 'Account #',
    'Type', 'Description 1', 'Description 2', 'Symbol/CUSIP #', 'Amount ($)',
  ];
  requireHeaders(path, indexes, required);
  const duplicateCounts = new Map<string, number>();
  return records.slice(1).filter((record) => record.some(Boolean)).map((record) => {
    const value = (header: string) => record[indexes.get(header)!]?.trim() ?? '';
    const date = calendarDate(value('Trade Date'), basename(path));
    const description = [
      value('Description 1'),
      value('Description 2'),
      value('Symbol/CUSIP #'),
    ].filter(Boolean).join(' - ');
    const amountCents = csvMoneyCents(value('Amount ($)'), basename(path));
    const identity = JSON.stringify({
      date,
      settlementDate: value('Settlement Date'),
      account: value('Account #'),
      type: value('Type'),
      description,
      quantity: value('Quantity'),
      price: value('Price ($)'),
      amountCents,
    });
    const duplicate = duplicateCounts.get(identity) ?? 0;
    duplicateCounts.set(identity, duplicate + 1);
    return {
      date,
      description,
      amountCents,
      sourceStatus: value('Pending/Settled'),
      sourceType: value('Type'),
      sourceAccountName: value('Account Nickname'),
      sourceAccountNumber: value('Account #'),
      sourceAccountDisplay: `${value('Account Nickname')} (${maskAccount(value('Account #'))})`,
      sourceFile: basename(path),
      sourceKey: createHash('sha256').update(`${identity}:${duplicate}`).digest('hex'),
    };
  });
}

function readAggregateTransactions(
  path: string,
  records: string[][],
  indexes: Map<string, number>,
): CsvTransaction[] {
  const required = [
    'Status', 'Date', 'Original Description', 'Category', 'Currency',
    'Amount', 'User Description', 'Memo', 'Account Name', 'Simple Description',
  ];
  requireHeaders(path, indexes, required);
  const duplicateCounts = new Map<string, number>();
  return records.slice(1).filter((record) => record.some(Boolean)).flatMap((record) => {
    const value = (header: string) => record[indexes.get(header)!]?.trim() ?? '';
    const account = value('Account Name');
    if (account.startsWith('Merrill Lynch')) return [];
    if (value('Currency') !== 'USD') {
      throw new Error(`${basename(path)} contains unsupported currency "${value('Currency')}".`);
    }
    const date = calendarDate(value('Date'), basename(path));
    const amountCents = csvMoneyCents(value('Amount'), basename(path));
    const description = value('User Description')
      || value('Simple Description')
      || value('Original Description');
    const identity = JSON.stringify({
      date,
      account,
      status: value('Status'),
      type: value('Category'),
      description: value('Original Description'),
      amountCents,
    });
    const duplicate = duplicateCounts.get(identity) ?? 0;
    duplicateCounts.set(identity, duplicate + 1);
    return [{
      date,
      description,
      amountCents,
      sourceStatus: value('Status'),
      sourceType: value('Category'),
      sourceAccountName: account,
      sourceAccountNumber: account,
      sourceAccountDisplay: account,
      sourceFile: basename(path),
      sourceKey: createHash('sha256').update(`${identity}:${duplicate}`).digest('hex'),
    }];
  });
}

function requireHeaders(
  path: string,
  indexes: Map<string, number>,
  required: string[],
): void {
  for (const header of required) {
    if (!indexes.has(header)) throw new Error(`${basename(path)} is missing "${header}".`);
  }
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  return rows;
}

function calendarDate(value: string, file: string): string {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`${file} contains invalid trade date "${value}".`);
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function csvMoneyCents(value: string, file: string): number {
  const negative = value.startsWith('(') && value.endsWith(')');
  const normalized = value.replace(/[,$()]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${file} contains invalid amount "${value}".`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error(`${file} contains an unsafe amount "${value}".`);
  return negative ? -cents : cents;
}

function stableUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function maskAccount(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9]/g, '');
  return `...${compact.slice(-4)}`;
}

function stagingSpec(row: TransactionStagingRow): Record<string, unknown> {
  return {
    date: new Date(row.transactionAt).toISOString().slice(0, 10),
    description: row.description,
    amount: money(BigInt(row.amountCents)),
    sourceStatus: row.sourceStatus,
    sourceType: row.sourceType,
    sourceAccount: row.sourceAccount,
    sourceFile: row.sourceFile,
  };
}

function stagingRelationships(row: TransactionStagingRow): Record<string, unknown> {
  return {
    ...(row.fromAccountId ? { fromAccountId: row.fromAccountId } : {}),
    ...(row.toAccountId ? { toAccountId: row.toAccountId } : {}),
    ...(row.ledgerEntryId ? { ledgerEntryId: row.ledgerEntryId } : {}),
  };
}

function toRow(value: Record<string, SQLInputValue>): TransactionStagingRow {
  return {
    id: String(value.id),
    sourceKey: String(value.source_key),
    transactionAt: Number(value.transaction_at),
    description: String(value.description),
    amountCents: Number(value.amount_cents),
    sourceStatus: String(value.source_status),
    sourceType: String(value.source_type),
    sourceAccount: String(value.source_account),
    sourceFile: String(value.source_file),
    state: String(value.state) as TransactionStagingRow['state'],
    fromAccountId: value.from_account_id === null ? null : String(value.from_account_id),
    toAccountId: value.to_account_id === null ? null : String(value.to_account_id),
    ledgerEntryId: value.ledger_entry_id === null ? null : String(value.ledger_entry_id),
    deleted: Number(value.deleted) === 1,
    committedAt: value.committed_at === null ? null : Number(value.committed_at),
    baselineJson: value.baseline_json === null ? null : String(value.baseline_json),
    resourceVersion: Number(value.resource_version),
    createdAt: Number(value.created_at),
    updatedAt: Number(value.updated_at),
  };
}

function genericEnvelope(row: Record<string, SQLInputValue>): ResourceEnvelope {
  return {
    kind: String(row.kind),
    metadata: {
      id: String(row.id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      resourceVersion: Number(row.resource_version),
    },
    spec: JSON.parse(String(row.spec)),
    status: JSON.parse(String(row.status)),
    relationships: JSON.parse(String(row.relationships)),
  };
}
