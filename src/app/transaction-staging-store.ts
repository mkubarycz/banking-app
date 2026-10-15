import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { SNAPSHOT_ACCOUNT_BY_ID, stableUuid } from './account-catalog.js';
import { money } from './money.js';
import { DEFAULT_IDS } from './ledger-store.js';

export interface ImportedAccount {
  id: string;
  name: string;
}

export interface ImportedTransaction {
  id: string;
  legacyAmount?: string;
  spec: {
    date: string;
    description: string;
    amount: string;
    source: {
      status: string;
      type: string;
      account: string;
      file: string;
      key: string;
    };
  };
  relationships: {
    fromAccountId: string;
    toAccountId: string;
  };
}

interface CsvTransaction {
  date: string;
  description: string;
  amountCents: number;
  legacyAmountCents?: number;
  sourceStatus: string;
  sourceType: string;
  sourceAccountName: string;
  sourceAccountNumber: string;
  sourceAccountDisplay: string;
  sourceFile: string;
  sourceKey: string;
}

export function readTransactionFiles(directory: string): {
  accounts: ImportedAccount[];
  transactions: ImportedTransaction[];
} {
  const files = readdirSync(directory)
    .filter((file) => file.toLowerCase().endsWith('.csv'))
    .sort();
  const rows = files.flatMap((file) => readTransactions(join(directory, file)))
    .filter((row) => row.amountCents !== 0);
  const accounts = new Map<string, ImportedAccount>();
  const transactions = rows.map((row) => {
    const accountId = stableUuid(`source-account:${row.sourceAccountNumber}`);
    accounts.set(accountId, {
      id: accountId,
      name: SNAPSHOT_ACCOUNT_BY_ID.get(accountId)?.name ?? row.sourceAccountDisplay,
    });
    const incoming = row.amountCents > 0;
    return {
      id: stableUuid(`transaction:${row.sourceKey}`),
      ...(row.legacyAmountCents !== undefined && row.legacyAmountCents !== row.amountCents
        ? { legacyAmount: money(BigInt(Math.abs(row.legacyAmountCents))) } : {}),
      spec: {
        date: row.date,
        description: row.description,
        amount: money(BigInt(Math.abs(row.amountCents))),
        source: {
          status: row.sourceStatus || 'Unknown',
          type: row.sourceType || 'Unknown',
          account: SNAPSHOT_ACCOUNT_BY_ID.get(accountId)?.name ?? row.sourceAccountDisplay,
          file: row.sourceFile,
          key: row.sourceKey,
        },
      },
      relationships: {
        fromAccountId: incoming ? DEFAULT_IDS.receivableAccount : accountId,
        toAccountId: incoming ? accountId : DEFAULT_IDS.payableAccount,
      },
    };
  });
  return { accounts: [...accounts.values()], transactions };
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
    const rawAmount = value('Amount');
    const amountCents = csvMoneyCents(rawAmount, basename(path));
    const legacyAmountCents = legacyCsvMoneyCents(rawAmount, basename(path));
    const description = value('User Description')
      || value('Simple Description')
      || value('Original Description');
    const identity = JSON.stringify({
      date,
      account,
      status: value('Status'),
      type: value('Category'),
      description: value('Original Description'),
      amountCents: legacyAmountCents,
    });
    const duplicate = duplicateCounts.get(identity) ?? 0;
    duplicateCounts.set(identity, duplicate + 1);
    return [{
      date,
      description,
      amountCents,
      legacyAmountCents,
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

function requireHeaders(path: string, indexes: Map<string, number>, required: string[]): void {
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
  if (!match) throw new Error(`${file} contains invalid date "${value}".`);
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function csvMoneyCents(value: string, file: string): number {
  const negative = (value.startsWith('(') && value.endsWith(')')) || value.startsWith('-');
  const normalized = value.replace(/[,$()]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${file} contains invalid amount "${value}".`);
  }
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const centsValue = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(centsValue)) {
    throw new Error(`${file} contains an unsafe amount "${value}".`);
  }
  return negative ? -centsValue : centsValue;
}

function legacyCsvMoneyCents(value: string, file: string): number {
  const negative = value.startsWith('(') && value.endsWith(')');
  const normalized = value.replace(/[,$()]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${file} contains invalid amount "${value}".`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  const centsValue = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(centsValue)) {
    throw new Error(`${file} contains an unsafe amount "${value}".`);
  }
  return negative ? -centsValue : centsValue;
}

function maskAccount(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9]/g, '');
  return `...${compact.slice(-4)}`;
}
