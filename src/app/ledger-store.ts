import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { ResourceEnvelope } from '../framework/types.js';
import { SNAPSHOT_ACCOUNTS } from './account-catalog.js';
import { cents, money } from './money.js';

export const DEFAULT_IDS = {
  cashAccount: 'a954ca56-3181-5944-8d73-74f85209a2be',
  receivableAccount: '00000000-0000-4000-8000-000000000102',
  payableAccount: '00000000-0000-4000-8000-000000000103',
  retirementAccount: 'd979af1d-f983-534c-af57-e4001e0c2267',
  uncategorizedBudget: '00000000-0000-4000-8000-000000000201',
} as const;

export interface ChangeSetItemRow {
  changeSetId: string;
  resourceKind: string;
  resourceId: string;
  before: ResourceEnvelope | null;
  action: 'create' | 'update' | 'delete';
}

function migrateUnreconciledAmounts(database: DatabaseSync): void {
  const migration = '160-unreconciled-amounts';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migration)) return;
  database.exec(`
    UPDATE resources
    SET status = json_set(
      json_remove(status, '$.reconciliationDifference'),
      '$.unreconciledAmount',
      COALESCE(json_extract(status, '$.reconciliationDifference'), '0.00')
    )
    WHERE kind = 'Account';

    UPDATE resources
    SET status = json_set(
      json_remove(status, '$.difference'),
      '$.unreconciledAmount',
      COALESCE(json_extract(status, '$.difference'), '0.00')
    )
    WHERE kind = 'AccountKnownValue';

    UPDATE change_set_items
    SET before_value = json_set(
      json_remove(before_value, '$.status.reconciliationDifference'),
      '$.status.unreconciledAmount',
      COALESCE(json_extract(before_value, '$.status.reconciliationDifference'), '0.00')
    )
    WHERE resource_kind = 'Account' AND before_value IS NOT NULL;

    UPDATE change_set_items
    SET before_value = json_set(
      json_remove(before_value, '$.status.difference'),
      '$.status.unreconciledAmount',
      COALESCE(json_extract(before_value, '$.status.difference'), '0.00')
    )
    WHERE resource_kind = 'AccountKnownValue' AND before_value IS NOT NULL;
  `);
  database.prepare(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migration, new Date().toISOString());
}

export interface LedgerProjectionRow {
  id: string;
  entryAt: number;
  description: string;
  lifecycleStatus: 'Realized' | 'Planned' | 'Estimated';
  revenueCents: number;
  expensesCents: number;
  reinvestedCents: number;
  openingCashCents: number | null;
}

export interface LedgerProjectionItem {
  id: string;
  projectionId: string;
  entryAt: number | null;
  description: string | null;
  lifecycleStatus: LedgerProjectionRow['lifecycleStatus'] | null;
  fromAccount: string;
  toAccount: string;
  amountCents: number;
  flow: 'Income' | 'Expense' | 'Reinvested';
  note: string | null;
  staging: Array<{
    date: string;
    description: string;
    amountCents: number;
    sourceAccount: string;
    sourceType: string;
    sourceStatus: string;
    state: string;
  }>;
}

export interface AccountDisplayOrder {
  accountId: string;
  order: number;
}

export function initializeBankingSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS change_set_items (
      change_set_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      before_value TEXT,
      action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
      PRIMARY KEY (change_set_id, resource_kind, resource_id)
    );
    CREATE TABLE IF NOT EXISTS ledger_projection_rows (
      id TEXT PRIMARY KEY,
      entry_at INTEGER NOT NULL,
      description TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL CHECK (
        lifecycle_status IN ('Realized', 'Planned', 'Estimated')
      ),
      revenue_cents INTEGER NOT NULL,
      expenses_cents INTEGER NOT NULL,
      reinvested_cents INTEGER NOT NULL,
      opening_cash_cents INTEGER,
      source TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_projection_rows_date_idx
      ON ledger_projection_rows(entry_at, id);
    CREATE TABLE IF NOT EXISTS ledger_projection_items (
      id TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      from_account TEXT NOT NULL,
      to_account TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      flow TEXT NOT NULL CHECK (flow IN ('Income', 'Expense', 'Reinvested')),
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS ledger_projection_items_group_idx
      ON ledger_projection_items(projection_id, id);
    CREATE TABLE IF NOT EXISTS ledger_projection_staging (
      id TEXT PRIMARY KEY,
      projection_item_id TEXT NOT NULL,
      transaction_at INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      source_account TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_status TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_projection_staging_item_idx
      ON ledger_projection_staging(projection_item_id, id);
    CREATE TABLE IF NOT EXISTS account_display_order (
      account_id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL CHECK (sort_order >= 0)
    );
  `);
  addColumnIfMissing(database, 'ledger_projection_items', 'entry_at', 'INTEGER');
  addColumnIfMissing(database, 'ledger_projection_items', 'description', 'TEXT');
  addColumnIfMissing(database, 'ledger_projection_items', 'lifecycle_status', 'TEXT');
  resetLegacyData(database);
  migrateAccountDisplayOrder(database);
  migrateNativeTransactionWorkspace(database);
  seedDefaults(database);
  migrateBudgetFlows(database);
  migrateBudgetRecurrence(database);
  migrateUnreconciledAmounts(database);
}

export function resetBankingData(database: DatabaseSync): void {
  database.exec(`
    DELETE FROM change_set_items;
    DELETE FROM ledger_projection_staging;
    DELETE FROM ledger_projection_items;
    DELETE FROM ledger_projection_rows;
    DELETE FROM account_display_order;
    DELETE FROM domain_events;
    DELETE FROM audit_events;
    DELETE FROM resources;
  `);
  seedDefaults(database);
}

export function importLegacyLedger(database: DatabaseSync, path: string): number {
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = source.prepare(`
      SELECT id, entry_at, description, lifecycle_status, revenue_cents,
             expenses_cents, reinvested_cents, opening_cash_cents
      FROM ledger_entries
      WHERE deleted = 0
      ORDER BY entry_at, id
    `).all() as Array<Record<string, SQLInputValue>>;
    const insert = database.prepare(`
      INSERT OR IGNORE INTO ledger_projection_rows
        (id, entry_at, description, lifecycle_status, revenue_cents,
         expenses_cents, reinvested_cents, opening_cash_cents, source, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    let imported = 0;
    for (const row of rows) {
      const result = insert.run(
        String(row.id),
        Number(row.entry_at),
        String(row.description),
        String(row.lifecycle_status),
        Number(row.revenue_cents),
        Number(row.expenses_cents),
        Number(row.reinvested_cents),
        row.opening_cash_cents === null ? null : Number(row.opening_cash_cents),
        path,
        now,
      );
      imported += Number(result.changes);
    }
    const sourceTables = new Set((source.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as Array<Record<string, SQLInputValue>>).map((row) => String(row.name)));
    const items = sourceTables.has('ledger_items') && sourceTables.has('resources')
      ? source.prepare(`
      SELECT li.id, li.group_id, li.amount_cents, li.note,
             COALESCE(json_extract(f.spec, '$.name'), 'Unknown account') AS from_name,
             COALESCE(json_extract(t.spec, '$.name'), 'Unknown account') AS to_name,
             json_extract(f.spec, '$.internal') AS from_internal,
             json_extract(t.spec, '$.internal') AS to_internal
      FROM ledger_items li
      LEFT JOIN resources f ON f.id = li.from_account_id
      LEFT JOIN resources t ON t.id = li.to_account_id
      JOIN ledger_entries le ON le.id = li.group_id
      WHERE le.deleted = 0
      ORDER BY li.created_at, li.id
    `).all() as Array<Record<string, SQLInputValue>>
      : [];
    const insertItem = database.prepare(`
      INSERT OR IGNORE INTO ledger_projection_items
        (id, projection_id, from_account, to_account, amount_cents, flow, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      const fromName = String(item.from_name);
      const toName = String(item.to_name);
      insertItem.run(
        String(item.id),
        String(item.group_id),
        fromName,
        toName,
        Number(item.amount_cents),
        projectionItemFlow(item.from_internal, item.to_internal, fromName, toName),
        item.note === null ? null : String(item.note),
      );
    }
    const staging = sourceTables.has('transaction_staging')
      ? source.prepare(`
      SELECT id, ledger_entry_id, transaction_at, description, amount_cents,
             source_account, source_type, source_status, state
      FROM transaction_staging
      WHERE ledger_entry_id IS NOT NULL
      ORDER BY created_at, id
    `).all() as Array<Record<string, SQLInputValue>>
      : [];
    const insertStaging = database.prepare(`
      INSERT OR IGNORE INTO ledger_projection_staging
        (id, projection_item_id, transaction_at, description, amount_cents,
         source_account, source_type, source_status, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of staging) {
      insertStaging.run(
        String(item.id),
        String(item.ledger_entry_id),
        Number(item.transaction_at),
        String(item.description),
        Number(item.amount_cents),
        String(item.source_account),
        String(item.source_type),
        String(item.source_status),
        String(item.state),
      );
    }
    return imported;
  } finally {
    source.close();
  }
}

export function ledgerProjectionRows(database: DatabaseSync): LedgerProjectionRow[] {
  return (database.prepare(`
    SELECT id, entry_at, description, lifecycle_status, revenue_cents,
           expenses_cents, reinvested_cents, opening_cash_cents
    FROM ledger_projection_rows
    ORDER BY entry_at, id
  `).all() as Array<Record<string, SQLInputValue>>).map((row) => ({
    id: String(row.id),
    entryAt: Number(row.entry_at),
    description: String(row.description),
    lifecycleStatus: String(row.lifecycle_status) as LedgerProjectionRow['lifecycleStatus'],
    revenueCents: Number(row.revenue_cents),
    expensesCents: Number(row.expenses_cents),
    reinvestedCents: Number(row.reinvested_cents),
    openingCashCents: row.opening_cash_cents === null ? null : Number(row.opening_cash_cents),
  }));
}

export function ledgerProjectionItems(database: DatabaseSync): LedgerProjectionItem[] {
  const stagingRows = database.prepare(`
    SELECT * FROM ledger_projection_staging
    ORDER BY transaction_at, id
  `).all() as Array<Record<string, SQLInputValue>>;
  const stagingByItem = new Map<string, LedgerProjectionItem['staging']>();
  for (const row of stagingRows) {
    const itemId = String(row.projection_item_id);
    stagingByItem.set(itemId, [...(stagingByItem.get(itemId) ?? []), {
      date: new Date(Number(row.transaction_at)).toISOString().slice(0, 10),
      description: String(row.description),
      amountCents: Number(row.amount_cents),
      sourceAccount: String(row.source_account),
      sourceType: String(row.source_type),
      sourceStatus: String(row.source_status),
      state: String(row.state),
    }]);
  }

  return (database.prepare(`
    SELECT * FROM ledger_projection_items
    ORDER BY rowid
  `).all() as Array<Record<string, SQLInputValue>>).map((row) => ({
    id: String(row.id),
    projectionId: String(row.projection_id),
    entryAt: row.entry_at === null ? null : Number(row.entry_at),
    description: row.description === null ? null : String(row.description),
    lifecycleStatus: row.lifecycle_status === null
      ? null
      : String(row.lifecycle_status) as LedgerProjectionRow['lifecycleStatus'],
    fromAccount: String(row.from_account),
    toAccount: String(row.to_account),
    amountCents: Number(row.amount_cents),
    flow: String(row.flow) as LedgerProjectionItem['flow'],
    note: row.note === null ? null : String(row.note),
    staging: stagingByItem.get(String(row.id)) ?? [],
  }));
}

export function accountDisplayOrders(database: DatabaseSync): AccountDisplayOrder[] {
  return (database.prepare(`
    SELECT account_id, sort_order
    FROM account_display_order
    ORDER BY sort_order, account_id
  `).all() as Array<Record<string, SQLInputValue>>).map((row) => ({
    accountId: String(row.account_id),
    order: Number(row.sort_order),
  }));
}

export function ensureAccountDisplayOrder(database: DatabaseSync, accountId: string): void {
  database.prepare(`
    INSERT OR IGNORE INTO account_display_order (account_id, sort_order)
    VALUES (
      ?,
      COALESCE((SELECT MAX(sort_order) + 1 FROM account_display_order), 0)
    )
  `).run(accountId);
}

export function setAccountDisplayOrders(
  database: DatabaseSync,
  updates: AccountDisplayOrder[],
  context: { transactionId: string; actor?: string },
): AccountDisplayOrder[] {
  const update = database.prepare(`
    UPDATE account_display_order
    SET sort_order = ?
    WHERE account_id = ?
  `);
  const before = new Map(accountDisplayOrders(database).map((item) => [item.accountId, item.order]));
  for (const item of updates) {
    const result = update.run(item.order, item.accountId);
    if (result.changes !== 1) throw new Error(`Account "${item.accountId}" has no display order.`);
  }
  const after = accountDisplayOrders(database).filter((item) =>
    updates.some((updateItem) => updateItem.accountId === item.accountId));
  const now = new Date().toISOString();
  for (const item of after) {
    const prior = before.get(item.accountId);
    if (prior === item.order) continue;
    database.prepare(`
      INSERT INTO audit_events
        (id, transaction_id, action, resource_kind, resource_id, actor,
         before_value, after_value, occurred_at)
      VALUES (?, ?, 'updated', 'AccountDisplayOrder', ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      context.transactionId,
      item.accountId,
      context.actor ?? null,
      JSON.stringify({ order: prior }),
      JSON.stringify({ order: item.order }),
      now,
    );
    database.prepare(`
      INSERT INTO domain_events
        (id, transaction_id, event_type, resource_kind, resource_id, payload, occurred_at)
      VALUES (?, ?, 'AccountDisplayOrder.updated', 'AccountDisplayOrder', ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      context.transactionId,
      item.accountId,
      JSON.stringify({ before: { order: prior }, after: { order: item.order } }),
      now,
    );
  }
  return after;
}

export function updateLedgerProjectionItem(
  database: DatabaseSync,
  id: string,
  patch: {
    entryAt?: number;
    description?: string;
    lifecycleStatus?: LedgerProjectionRow['lifecycleStatus'];
    fromAccount?: string;
    toAccount?: string;
    amountCents?: number;
    flow?: LedgerProjectionItem['flow'];
    note?: string | null;
  },
  context: { transactionId: string; actor?: string },
): LedgerProjectionItem {
  const before = ledgerProjectionItems(database).find((item) => item.id === id);
  if (!before) throw new Error(`LedgerItem "projection-item:${id}" was not found.`);
  const assignments: string[] = [];
  const values: SQLInputValue[] = [];
  const set = (column: string, value: SQLInputValue): void => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.entryAt !== undefined) set('entry_at', patch.entryAt);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.lifecycleStatus !== undefined) set('lifecycle_status', patch.lifecycleStatus);
  if (patch.fromAccount !== undefined) set('from_account', patch.fromAccount);
  if (patch.toAccount !== undefined) set('to_account', patch.toAccount);
  if (patch.amountCents !== undefined) set('amount_cents', patch.amountCents);
  if (patch.flow !== undefined) set('flow', patch.flow);
  if (patch.note !== undefined) set('note', patch.note);
  if (!assignments.length) throw new Error('At least one ledger item field must be updated.');

  const nextAmount = patch.amountCents ?? before.amountCents;
  const nextFlow = patch.flow ?? before.flow;
  adjustProjectionAggregate(database, before.projectionId, before.flow, -before.amountCents);
  adjustProjectionAggregate(database, before.projectionId, nextFlow, nextAmount);
  const result = database.prepare(`
    UPDATE ledger_projection_items
    SET ${assignments.join(', ')}
    WHERE id = ?
  `).run(...values, id);
  if (result.changes !== 1) throw new Error(`LedgerItem "projection-item:${id}" was not found.`);
  const after = ledgerProjectionItems(database).find((item) => item.id === id)!;
  appendProjectionItemUpdateEvents(database, before, after, context);
  return after;
}

function adjustProjectionAggregate(
  database: DatabaseSync,
  projectionId: string,
  flow: LedgerProjectionItem['flow'],
  deltaCents: number,
): void {
  const column = flow === 'Income'
    ? 'revenue_cents'
    : flow === 'Expense' ? 'expenses_cents' : 'reinvested_cents';
  database.prepare(`
    UPDATE ledger_projection_rows
    SET ${column} = ${column} + ?
    WHERE id = ?
  `).run(deltaCents, projectionId);
}

function appendProjectionItemUpdateEvents(
  database: DatabaseSync,
  before: LedgerProjectionItem,
  after: LedgerProjectionItem,
  context: { transactionId: string; actor?: string },
): void {
  const now = new Date().toISOString();
  const resourceId = `projection-item:${after.id}`;
  database.prepare(`
    INSERT INTO audit_events
      (id, transaction_id, action, resource_kind, resource_id, actor,
       before_value, after_value, occurred_at)
    VALUES (?, ?, 'updated', 'LedgerItem', ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    context.transactionId,
    resourceId,
    context.actor ?? null,
    JSON.stringify(before),
    JSON.stringify(after),
    now,
  );
  database.prepare(`
    INSERT INTO domain_events
      (id, transaction_id, event_type, resource_kind, resource_id, payload, occurred_at)
    VALUES (?, ?, 'LedgerItem.updated', 'LedgerItem', ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    context.transactionId,
    resourceId,
    JSON.stringify({ before, after }),
    now,
  );
}

function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  declaration: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<
    Record<string, SQLInputValue>
  >;
  if (columns.some((candidate) => String(candidate.name) === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

function projectionItemFlow(
  fromInternalValue: SQLInputValue,
  toInternalValue: SQLInputValue,
  fromName: string,
  toName: string,
): LedgerProjectionItem['flow'] {
  const fromInternal = fromInternalValue === null
    ? fromName === 'Cash' || fromName.includes('Retirement')
    : Boolean(fromInternalValue);
  const toInternal = toInternalValue === null
    ? toName === 'Cash' || toName.includes('Retirement')
    : Boolean(toInternalValue);
  if (!fromInternal && toInternal) return 'Income';
  if (fromInternal && !toInternal) return 'Expense';
  return 'Reinvested';
}

function resetLegacyData(database: DatabaseSync): void {
  const migration = '100-banking-app-1.2-clean-model';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migration)) return;
  database.exec(`
    DELETE FROM domain_events;
    DELETE FROM audit_events;
    DELETE FROM resources;
    DROP TABLE IF EXISTS ledger_items;
    DROP TABLE IF EXISTS ledger_entries;
    DROP TABLE IF EXISTS transaction_staging;
    DROP TABLE IF EXISTS data_change_log;
  `);
  database.prepare(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migration, new Date().toISOString());
}

function seedDefaults(database: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO resources
      (id, kind, spec, status, relationships, resource_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', 1, ?, ?)
  `);
  const accounts: Array<[string, string, boolean, string?]> = [
    ...SNAPSHOT_ACCOUNTS.map((account) =>
      [account.id, account.name, true, account.institution] as [string, string, boolean, string]),
    [DEFAULT_IDS.receivableAccount, 'Uncategorized Income', false],
    [DEFAULT_IDS.payableAccount, 'Uncategorized Expense', false],
  ];
  const insertAccountOrder = database.prepare(`
    INSERT OR IGNORE INTO account_display_order (account_id, sort_order)
    VALUES (?, ?)
  `);
  accounts.forEach(([id, name, internal, institution], order) => {
    insert.run(
      id,
      'Account',
      JSON.stringify({
        name,
        currency: 'USD',
        internal,
        ...(institution ? { institution } : {}),
      }),
      JSON.stringify({
        state: 'Committed',
        deleted: false,
        directBalance: '0.00',
        descendantsBalance: '0.00',
        totalBalance: '0.00',
        latestKnownValueDate: null,
        unreconciledAmount: '0.00',
      }),
      now,
      now,
    );
    insertAccountOrder.run(id, order);
  });
  insert.run(
    DEFAULT_IDS.uncategorizedBudget,
    'Budget',
    JSON.stringify({
      name: 'Uncategorized',
      order: 0,
      flow: 'Expense',
      amount: '0.00',
    }),
    JSON.stringify({
      state: 'Committed',
      deleted: false,
      budgeted: '0.00',
      realized: '0.00',
      budgetedByMonth: {},
      realizedByMonth: {},
    }),
    now,
    now,
  );
}

function migrateNativeTransactionWorkspace(database: DatabaseSync): void {
  const migration = '130-native-transactions-workspace';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migration)) return;
  database.exec(`
    DELETE FROM change_set_items;
    DELETE FROM ledger_projection_staging;
    DELETE FROM ledger_projection_items;
    DELETE FROM ledger_projection_rows;
    DELETE FROM account_display_order;
    DELETE FROM domain_events;
    DELETE FROM audit_events;
    DELETE FROM resources;
  `);
  database.prepare(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migration, new Date().toISOString());
}

function migrateAccountDisplayOrder(database: DatabaseSync): void {
  const migration = '120-account-display-order';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migration)) return;
  database.exec(`
    INSERT OR IGNORE INTO account_display_order (account_id, sort_order)
    SELECT id, COALESCE(json_extract(spec, '$.order'), rowid)
    FROM resources
    WHERE kind = 'Account';

    UPDATE resources
    SET spec = json_remove(spec, '$.order')
    WHERE kind = 'Account';

    UPDATE change_set_items
    SET before_value = json_remove(before_value, '$.spec.order')
    WHERE resource_kind = 'Account' AND before_value IS NOT NULL;
  `);
  const candidates = database.prepare(`
    SELECT csi.change_set_id, csi.resource_id, csi.before_value,
           r.spec, r.status, r.relationships
    FROM change_set_items csi
    JOIN resources r ON r.id = csi.resource_id AND r.kind = 'Account'
    WHERE csi.resource_kind = 'Account'
      AND csi.action = 'update'
      AND csi.before_value IS NOT NULL
  `).all() as Array<Record<string, SQLInputValue>>;
  for (const candidate of candidates) {
    const before = JSON.parse(String(candidate.before_value)) as ResourceEnvelope;
    const relationships = JSON.parse(String(candidate.relationships)) as Record<string, unknown>;
    const currentRelationships = { ...relationships };
    delete currentRelationships.changeSetId;
    const beforeRelationships = { ...before.relationships };
    delete beforeRelationships.changeSetId;
    if (
      JSON.stringify(before.spec) !== String(candidate.spec)
      || JSON.stringify(beforeRelationships) !== JSON.stringify(currentRelationships)
    ) continue;
    database.prepare(`
      DELETE FROM change_set_items
      WHERE change_set_id = ? AND resource_kind = 'Account' AND resource_id = ?
    `).run(String(candidate.change_set_id), String(candidate.resource_id));
    const status = JSON.parse(String(candidate.status)) as Record<string, unknown>;
    database.prepare(`
      UPDATE resources
      SET status = ?, relationships = ?
      WHERE kind = 'Account' AND id = ?
    `).run(
      JSON.stringify({ ...status, state: 'Committed' }),
      JSON.stringify(currentRelationships),
      String(candidate.resource_id),
    );
  }
  database.exec(`
    UPDATE resources
    SET status = json_set(status, '$.state', 'Discarded', '$.changeCount', 0)
    WHERE kind = 'ChangeSet'
      AND json_extract(status, '$.state') = 'Open'
      AND NOT EXISTS (
        SELECT 1 FROM change_set_items
        WHERE change_set_id = resources.id
      );
  `);
  database.prepare(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
  ).run(migration, new Date().toISOString());
}

function migrateBudgetFlows(database: DatabaseSync): void {
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE resources
    SET spec = json_set(spec, '$.flow', 'Expense'),
        resource_version = resource_version + 1,
        updated_at = ?
    WHERE kind = 'Budget' AND json_type(spec, '$.flow') IS NULL
  `).run(now);
}

function migrateBudgetRecurrence(database: DatabaseSync): void {
  const migration = '150-budget-calendar-recurrence';
  if (database.prepare('SELECT 1 FROM app_migrations WHERE id = ?').get(migration)) return;
  const migrateSpec = (value: Record<string, unknown>): Record<string, unknown> => {
    if (typeof value.amount === 'string') return value;
    const planned = moneyEntries(value.planned);
    const estimated = moneyEntries(value.estimated);
    const entries = planned.length ? planned : estimated;
    const amounts = new Set(entries.map(([, amount]) => amount));
    if (amounts.size > 1) {
      throw new Error(`Budget "${String(value.name)}" has nonuniform legacy monthly values and cannot be migrated to one recurring value.`);
    }
    const months = entries.map(([month]) => month).sort();
    const firstMonth = months[0];
    const lastMonth = months.at(-1);
    return {
      name: value.name,
      order: value.order,
      flow: value.flow ?? 'Expense',
      amount: entries[0]?.[1] ?? '0.00',
      ...(firstMonth && lastMonth ? {
        recurrence: {
          frequency: 'Monthly',
          interval: 1,
          daysOfMonth: [1],
          startsOn: `${firstMonth}-01`,
          endsOn: lastCalendarDay(lastMonth),
        },
      } : {}),
      ...(typeof value.note === 'string' ? { note: value.note } : {}),
    };
  };
  const migrateStatus = (value: Record<string, unknown>): Record<string, unknown> => ({
    state: value.state ?? 'Draft',
    deleted: value.deleted ?? false,
    budgeted: '0.00',
    realized: value.realized ?? '0.00',
    budgetedByMonth: {},
    realizedByMonth: value.realizedByMonth ?? {},
  });
  database.exec('BEGIN');
  try {
    const resources = database.prepare(`
      SELECT id, spec, status FROM resources WHERE kind = 'Budget'
    `).all() as Array<Record<string, SQLInputValue>>;
    const updateResource = database.prepare(`
      UPDATE resources
      SET spec = ?, status = ?, resource_version = resource_version + 1, updated_at = ?
      WHERE kind = 'Budget' AND id = ?
    `);
    const now = new Date().toISOString();
    for (const row of resources) {
      updateResource.run(
        JSON.stringify(migrateSpec(JSON.parse(String(row.spec)) as Record<string, unknown>)),
        JSON.stringify(migrateStatus(JSON.parse(String(row.status)) as Record<string, unknown>)),
        now,
        String(row.id),
      );
    }
    const baselines = database.prepare(`
      SELECT change_set_id, resource_id, before_value
      FROM change_set_items
      WHERE resource_kind = 'Budget' AND before_value IS NOT NULL
    `).all() as Array<Record<string, SQLInputValue>>;
    const updateBaseline = database.prepare(`
      UPDATE change_set_items SET before_value = ?
      WHERE change_set_id = ? AND resource_kind = 'Budget' AND resource_id = ?
    `);
    for (const row of baselines) {
      const envelope = JSON.parse(String(row.before_value)) as ResourceEnvelope;
      updateBaseline.run(
        JSON.stringify({
          ...envelope,
          spec: migrateSpec(envelope.spec),
          status: migrateStatus(envelope.status),
        }),
        String(row.change_set_id),
        String(row.resource_id),
      );
    }
    database.prepare(
      'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
    ).run(migration, now);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function moneyEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([month, amount]) => [month, String(amount)]);
}

function lastCalendarDay(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function recordChange(
  database: DatabaseSync,
  changeSetId: string,
  resource: ResourceEnvelope,
  action: ChangeSetItemRow['action'],
): void {
  const existing = database.prepare(`
    SELECT action FROM change_set_items
    WHERE change_set_id = ? AND resource_kind = ? AND resource_id = ?
  `).get(changeSetId, resource.kind, resource.metadata.id) as Record<string, SQLInputValue> | undefined;
  if (existing) {
    if (String(existing.action) === 'create') return;
    database.prepare(`
      UPDATE change_set_items SET action = ?
      WHERE change_set_id = ? AND resource_kind = ? AND resource_id = ?
    `).run(action, changeSetId, resource.kind, resource.metadata.id);
    return;
  }
  database.prepare(`
    INSERT INTO change_set_items
      (change_set_id, resource_kind, resource_id, before_value, action)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    changeSetId,
    resource.kind,
    resource.metadata.id,
    action === 'create' ? null : JSON.stringify(resource),
    action,
  );
}

export function changeSetItems(database: DatabaseSync, changeSetId: string): ChangeSetItemRow[] {
  const rows = database.prepare(`
    SELECT * FROM change_set_items
    WHERE change_set_id = ?
    ORDER BY rowid
  `).all(changeSetId) as Array<Record<string, SQLInputValue>>;
  return rows.map((row) => ({
    changeSetId: String(row.change_set_id),
    resourceKind: String(row.resource_kind),
    resourceId: String(row.resource_id),
    before: row.before_value ? JSON.parse(String(row.before_value)) as ResourceEnvelope : null,
    action: String(row.action) as ChangeSetItemRow['action'],
  }));
}

export function activeResources(database: DatabaseSync, kind: string): ResourceEnvelope[] {
  return (database.prepare(
    'SELECT * FROM resources WHERE kind = ? ORDER BY created_at, id',
  ).all(kind) as Array<Record<string, SQLInputValue>>)
    .map(toEnvelope)
    .filter((resource) => resource.status.deleted !== true);
}

export function classifyTransaction(
  transaction: ResourceEnvelope,
  accounts: Map<string, ResourceEnvelope>,
): 'Income' | 'Expense' | 'Transfer' {
  const from = accounts.get(String(transaction.relationships.fromAccountId));
  const to = accounts.get(String(transaction.relationships.toAccountId));
  if (!from || !to) return 'Transfer';
  const fromInternal = from.spec.internal === true;
  const toInternal = to.spec.internal === true;
  if (!fromInternal && toInternal) return 'Income';
  if (fromInternal && !toInternal) return 'Expense';
  return 'Transfer';
}

export function accountStatuses(
  accounts: ResourceEnvelope[],
  transactions: ResourceEnvelope[],
  knownValues: ResourceEnvelope[],
): Map<string, Record<string, unknown>> {
  const committedKnownValues = knownValues.filter(isCommitted);
  const calculateBalance = accountBalanceCalculator(accounts, transactions, committedKnownValues);
  const calculatedKnownStatuses = knownValueStatuses(knownValues, transactions, accounts);
  const latestKnown = new Map<string, ResourceEnvelope>();
  for (const known of committedKnownValues) {
    const accountId = String(known.relationships.accountId);
    const current = latestKnown.get(accountId);
    if (!current || String(current.spec.date) < String(known.spec.date)) latestKnown.set(accountId, known);
  }
  return new Map(accounts.map((account) => {
    const balance = calculateBalance(account.metadata.id, '9999-12-31');
    const anchor = latestKnown.get(account.metadata.id);
    return [account.metadata.id, {
      ...account.status,
      directBalance: money(balance.direct),
      descendantsBalance: money(balance.total - balance.direct),
      totalBalance: money(balance.total),
      latestKnownValueDate: anchor?.spec.date ?? null,
      unreconciledAmount: anchor
        ? calculatedKnownStatuses.get(anchor.metadata.id)?.unreconciledAmount ?? '0.00'
        : '0.00',
    }];
  }));
}

export function knownValueStatuses(
  knownValues: ResourceEnvelope[],
  transactions: ResourceEnvelope[],
  accounts: ResourceEnvelope[] = [],
): Map<string, Record<string, unknown>> {
  const activeKnownValues = knownValues.filter((item) => item.status.deleted !== true);
  const calculateBalance = accountBalanceCalculator(accounts, transactions, activeKnownValues);
  const result = new Map<string, Record<string, unknown>>();
  for (const value of activeKnownValues) {
    const accountId = String(value.relationships.accountId);
    const calculated = calculateBalance(accountId, String(value.spec.date), {
      accountId,
      date: String(value.spec.date),
      id: value.metadata.id,
    }).total;
    const observed = cents(String(value.spec.value));
    const difference = observed - calculated;
    result.set(value.metadata.id, {
      ...value.status,
      calculatedValue: money(calculated),
      unreconciledAmount: money(difference),
      severity: difference >= 100000n || difference <= -100000n ? 'High' : 'Normal',
    });
  }
  return result;
}

function accountBalanceCalculator(
  accounts: ResourceEnvelope[],
  transactions: ResourceEnvelope[],
  knownValues: ResourceEnvelope[],
): (
  accountId: string,
  throughDate: string,
  cutoff?: { accountId: string; date: string; id: string },
) => { direct: bigint; total: bigint } {
  const children = new Map<string, string[]>();
  for (const account of accounts) {
    const parent = account.relationships.parentAccountId;
    if (typeof parent === 'string') children.set(parent, [...(children.get(parent) ?? []), account.metadata.id]);
  }
  const byAccount = new Map<string, ResourceEnvelope[]>();
  for (const value of knownValues) {
    const accountId = String(value.relationships.accountId);
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), value]);
  }
  byAccount.forEach((values) => values.sort((left, right) =>
    String(left.spec.date).localeCompare(String(right.spec.date))
    || left.metadata.id.localeCompare(right.metadata.id)));
  const effectiveTransactions = transactions.filter((transaction) => transaction.status.deleted !== true);
  const calculate = (
    accountId: string,
    throughDate: string,
    cutoff?: { accountId: string; date: string; id: string },
    visiting = new Set<string>(),
  ): { direct: bigint; total: bigint } => {
    if (visiting.has(accountId)) throw new Error('Account hierarchy contains a cycle.');
    const nextVisiting = new Set(visiting).add(accountId);
    const childIds = children.get(accountId) ?? [];
    const childTotalAt = (date: string) => childIds.reduce(
      (sum, childId) => sum + calculate(childId, date, undefined, nextVisiting).total,
      0n,
    );
    const anchors = (byAccount.get(accountId) ?? []).filter((value) => {
      const date = String(value.spec.date);
      if (date > throughDate) return false;
      if (!cutoff || cutoff.accountId !== accountId) return true;
      return date < cutoff.date || (date === cutoff.date && value.metadata.id < cutoff.id);
    });
    const anchor = anchors.at(-1);
    const anchorDate = anchor ? String(anchor.spec.date) : '';
    let direct = anchor
      ? cents(String(anchor.spec.value)) - childTotalAt(anchorDate)
      : 0n;
    for (const transaction of effectiveTransactions) {
      const date = String(transaction.spec.date);
      if (date <= anchorDate || date > throughDate) continue;
      const amount = cents(String(transaction.spec.amount));
      if (transaction.relationships.fromAccountId === accountId) direct -= amount;
      if (transaction.relationships.toAccountId === accountId) direct += amount;
    }
    const descendantTotal = childTotalAt(throughDate);
    return { direct, total: direct + descendantTotal };
  };
  return calculate;
}

function isCommitted(resource: ResourceEnvelope): boolean {
  return resource.status.state === 'Committed' && resource.status.deleted !== true;
}

function toEnvelope(row: Record<string, SQLInputValue>): ResourceEnvelope {
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
