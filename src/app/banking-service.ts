import { ResourceService } from '../framework/service.js';
import type { ResourceRegistry } from '../framework/registry.js';
import type { ResourceStore } from '../framework/store.js';
import type { OperationResult, ResourceEnvelope } from '../framework/types.js';
import { SNAPSHOT_ACCOUNTS, SNAPSHOT_DATE, stableUuid } from './account-catalog.js';
import { cents, money } from './money.js';
import {
  DEFAULT_IDS,
  accountDisplayOrders,
  accountStatuses,
  activeResources,
  changeSetItems,
  classifyTransaction,
  initializeBankingSchema,
  importLegacyLedger,
  ensureAccountDisplayOrder,
  ledgerProjectionItems,
  ledgerProjectionRows,
  knownValueStatuses,
  recordChange,
  resetBankingData,
  setAccountDisplayOrders,
  updateLedgerProjectionItem,
} from './ledger-store.js';
import { readTransactionFiles } from './transaction-staging-store.js';

const CHANGE_SET = 'ChangeSet';
const ACCOUNT = 'Account';
const BUDGET = 'Budget';
const TRANSACTION = 'Transaction';
const KNOWN_VALUE = 'AccountKnownValue';

interface LedgerViewItem {
  id: string;
  status: 'Realized' | 'Planned' | 'Estimated';
  description: string;
  date: string;
  fromAccount: string;
  toAccount: string;
  amount: string;
  flow: 'Income' | 'Expense' | 'Reinvested' | 'Adjustment';
  note?: string;
  staging: Array<{
    date: string;
    description: string;
    amount: string;
    sourceAccount: string;
    sourceType: string;
    sourceStatus: string;
    state: string;
  }>;
  revenue: string;
  expenses: string;
  reinvested: string;
  cashOnHand: string;
  sourceKind: 'Transaction' | 'Budget' | 'Projection';
  sourceId: string;
}

interface PendingResourceChange {
  changeSetId: string;
  changeSetResourceVersion: number;
  resourceKind: string;
  resourceId: string;
  action: 'create' | 'update' | 'delete';
  changedFields: string[];
}

export class BankingResourceService extends ResourceService {
  constructor(registry: ResourceRegistry, store: ResourceStore) {
    super(registry, store);
    initializeBankingSchema(store.database);
  }

  override query(
    kind: string,
    specEquals: Record<string, unknown> | undefined,
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<ResourceEnvelope[]> {
    this.registry.get(kind);
    const resources = this.enriched(kind).filter((resource) => Object.entries(specEquals ?? {}).every(
      ([key, value]) => JSON.stringify(resource.spec[key]) === JSON.stringify(value),
    ));
    return { transactionId, result: resources };
  }

  override get(
    kind: string,
    id: string,
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<ResourceEnvelope> {
    this.registry.get(kind);
    const resource = this.enriched(kind).find((candidate) => candidate.metadata.id === id);
    if (!resource) throw new Error(`${kind} "${id}" was not found.`);
    return { transactionId, result: resource };
  }

  override create(input: {
    kind: string;
    spec: unknown;
    status?: unknown;
    relationships?: unknown;
    transactionId?: string;
    actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind === CHANGE_SET) return super.create(input);
    return this.store.atomic(() => {
      const changeSet = this.resolveChangeSet(
        relationshipId(input.relationships, 'changeSetId'),
        input.transactionId,
        input.actor,
      );
      const relationships = {
        ...asObject(input.relationships),
        changeSetId: changeSet.metadata.id,
      };
      this.validateRelationships(input.kind, relationships);
      const result = super.create({
        ...input,
        status: { ...asObject(input.status), state: 'Draft', deleted: false },
        relationships,
      });
      if (input.kind === ACCOUNT) {
        ensureAccountDisplayOrder(this.store.database, result.result.metadata.id);
      }
      recordChange(this.store.database, changeSet.metadata.id, result.result, 'create');
      return result;
    });
  }

  override update(input: {
    kind: string;
    id: string;
    expectedResourceVersion: number;
    spec: unknown;
    status: unknown;
    relationships: unknown;
    transactionId?: string;
    actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind === CHANGE_SET) {
      const existing = super.get(CHANGE_SET, input.id).result;
      if (existing.status.state !== 'Open') throw new Error('Only open ChangeSets can be updated.');
      return super.update(input);
    }
    return this.store.atomic(() => {
      const existing = super.get(input.kind, input.id).result;
      const existingChangeSetId = relationshipId(existing.relationships, 'changeSetId');
      const requestedChangeSetId = relationshipId(input.relationships, 'changeSetId');
      const changeSet = this.resolveChangeSet(
        requestedChangeSetId ?? existingChangeSetId,
        input.transactionId,
        input.actor,
      );
      if (existingChangeSetId && existingChangeSetId !== changeSet.metadata.id) {
        throw new Error('A draft resource cannot be moved to another ChangeSet.');
      }
      const relationships = {
        ...asObject(input.relationships),
        changeSetId: changeSet.metadata.id,
      };
      this.validateRelationships(input.kind, relationships, input.id);
      recordChange(this.store.database, changeSet.metadata.id, existing, 'update');
      return super.update({
        ...input,
        status: { ...asObject(input.status), state: 'Draft', deleted: false },
        relationships,
      });
    });
  }

  override delete(input: {
    kind: string;
    id: string;
    expectedResourceVersion: number;
    transactionId?: string;
    actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind === CHANGE_SET) {
      throw new Error('Discard a ChangeSet instead of deleting it.');
    }
    return this.store.atomic(() => {
      const existing = super.get(input.kind, input.id).result;
      this.assertCanDelete(existing);
      const changeSet = this.resolveChangeSet(
        relationshipId(existing.relationships, 'changeSetId'),
        input.transactionId,
        input.actor,
      );
      recordChange(this.store.database, changeSet.metadata.id, existing, 'delete');
      return super.update({
        kind: input.kind,
        id: input.id,
        expectedResourceVersion: input.expectedResourceVersion,
        spec: existing.spec,
        status: { ...existing.status, state: 'Draft', deleted: true },
        relationships: { ...existing.relationships, changeSetId: changeSet.metadata.id },
        transactionId: input.transactionId,
        actor: input.actor,
      });
    });
  }

  createChangeSet(
    title: string,
    note?: string,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    return super.create({
      kind: CHANGE_SET,
      spec: { title, ...(note ? { note } : {}) },
      transactionId,
      actor,
    });
  }

  commitChangeSet(
    id: string,
    expectedResourceVersion: number,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    return this.store.atomic(() => {
      const changeSet = super.get(CHANGE_SET, id).result;
      assertVersion(changeSet, expectedResourceVersion);
      if (changeSet.status.state !== 'Open') throw new Error('Only open ChangeSets can be committed.');
      const items = changeSetItems(this.store.database, id);
      for (const item of items) {
        const current = this.store.get(item.resourceKind, item.resourceId);
        if (!current) continue;
        if (current.status.deleted === true) {
          super.delete({
            kind: current.kind,
            id: current.metadata.id,
            expectedResourceVersion: current.metadata.resourceVersion,
            transactionId,
            actor,
          });
          continue;
        }
        this.validateRelationships(current.kind, current.relationships, current.metadata.id);
        const relationships = { ...current.relationships };
        delete relationships.changeSetId;
        const status = {
          ...current.status,
          state: 'Committed',
          deleted: false,
        };
        super.update({
          kind: current.kind,
          id: current.metadata.id,
          expectedResourceVersion: current.metadata.resourceVersion,
          spec: current.spec,
          status,
          relationships,
          transactionId,
          actor,
        });
      }
      this.store.database.prepare(
        'DELETE FROM change_set_items WHERE change_set_id = ?',
      ).run(id);
      const updated = super.update({
        kind: CHANGE_SET,
        id,
        expectedResourceVersion,
        spec: changeSet.spec,
        status: { state: 'Committed', changeCount: items.length },
        relationships: {},
        transactionId,
        actor,
      });
      return updated;
    });
  }

  discardChangeSet(
    id: string,
    expectedResourceVersion: number,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    return this.store.atomic(() => {
      const changeSet = super.get(CHANGE_SET, id).result;
      assertVersion(changeSet, expectedResourceVersion);
      if (changeSet.status.state !== 'Open') throw new Error('Only open ChangeSets can be discarded.');
      const items = changeSetItems(this.store.database, id).reverse();
      for (const item of items) {
        const current = this.store.get(item.resourceKind, item.resourceId);
        if (item.action === 'create') {
          if (current) super.delete({
            kind: current.kind,
            id: current.metadata.id,
            expectedResourceVersion: current.metadata.resourceVersion,
            transactionId,
            actor,
          });
        } else if (current && item.before) {
          super.update({
            kind: current.kind,
            id: current.metadata.id,
            expectedResourceVersion: current.metadata.resourceVersion,
            spec: item.before.spec,
            status: item.before.status,
            relationships: item.before.relationships,
            transactionId,
            actor,
          });
        }
      }
      this.store.database.prepare(
        'DELETE FROM change_set_items WHERE change_set_id = ?',
      ).run(id);
      return super.update({
        kind: CHANGE_SET,
        id,
        expectedResourceVersion,
        spec: changeSet.spec,
        status: { state: 'Discarded', changeCount: items.length },
        relationships: {},
        transactionId,
        actor,
      });
    });
  }

  importTransactions(
    directory: string,
    transactionId: string = crypto.randomUUID(),
    actor = 'transaction-import',
    _includeBeforeRealizedCutoff = false,
  ): OperationResult<ResourceEnvelope[]> {
    const parsed = readTransactionFiles(directory);
    const imported: ResourceEnvelope[] = [];
    const correctionMigration = '140-correct-negative-decimal-imports';
    const correctLegacyAmounts = !this.store.database.prepare(
      'SELECT 1 FROM app_migrations WHERE id = ?',
    ).get(correctionMigration);
    this.store.atomic(() => {
      for (const account of parsed.accounts) {
        if (this.store.get(ACCOUNT, account.id)) continue;
        this.store.create({
          kind: ACCOUNT,
          id: account.id,
          spec: {
            name: account.name,
            currency: 'USD',
            internal: true,
            institution: importedInstitution(account.name),
          },
          status: {
            state: 'Committed',
            deleted: false,
            directBalance: '0.00',
            descendantsBalance: '0.00',
            totalBalance: '0.00',
            latestKnownValueDate: null,
            unreconciledAmount: '0.00',
          },
          relationships: {},
        }, { transactionId, actor });
        ensureAccountDisplayOrder(this.store.database, account.id);
      }
      for (const candidate of parsed.transactions) {
        const existing = this.store.get(TRANSACTION, candidate.id);
        if (existing) {
          if (correctLegacyAmounts
            && candidate.legacyAmount
            && existing.status.state === 'Committed'
            && existing.spec.amount === candidate.legacyAmount
            && (existing.spec.source as Record<string, unknown> | undefined)?.key
              === candidate.spec.source.key) {
            this.store.update({
              kind: TRANSACTION,
              id: existing.metadata.id,
              expectedResourceVersion: existing.metadata.resourceVersion,
              spec: candidate.spec,
              status: existing.status,
              relationships: existing.relationships,
            }, { transactionId, actor: 'transaction-import-correction' });
          }
          continue;
        }
        const spec = this.registry.get(TRANSACTION).spec.parse(candidate.spec);
        const relationships = this.registry.get(TRANSACTION).relationships.parse({
          ...candidate.relationships,
          budgetId: DEFAULT_IDS.uncategorizedBudget,
        });
        imported.push(this.store.create({
          kind: TRANSACTION,
          id: candidate.id,
          spec,
          status: { state: 'Committed', deleted: false, classification: 'Transfer' },
          relationships,
        }, { transactionId, actor }));
      }
      for (const account of SNAPSHOT_ACCOUNTS) {
        const id = stableUuid(`known-value:${account.id}:${SNAPSHOT_DATE}`);
        if (this.store.get(KNOWN_VALUE, id)) continue;
        this.store.create({
          kind: KNOWN_VALUE,
          id,
          spec: {
            date: SNAPSHOT_DATE,
            value: account.value,
            note: 'Balance snapshot supplied on 2026-10-11.',
          },
          status: {
            state: 'Committed',
            deleted: false,
            calculatedValue: '0.00',
            unreconciledAmount: '0.00',
            severity: 'Normal',
          },
          relationships: { accountId: account.id },
        }, { transactionId, actor });
      }
      if (correctLegacyAmounts) {
        this.store.database.prepare(
          'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)',
        ).run(correctionMigration, new Date().toISOString());
      }
    });
    return { transactionId, result: imported };
  }

  reset(
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<{ reset: true }> {
    this.store.atomic(() => resetBankingData(this.store.database));
    return { transactionId, result: { reset: true } };
  }

  pendingChanges(
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<PendingResourceChange[]> {
    const result = activeResources(this.store.database, CHANGE_SET)
      .filter((changeSet) => changeSet.status.state === 'Open')
      .flatMap((changeSet) => changeSetItems(this.store.database, changeSet.metadata.id)
        .map((item) => {
          const current = this.store.get(item.resourceKind, item.resourceId);
          return {
            changeSetId: changeSet.metadata.id,
            changeSetResourceVersion: changeSet.metadata.resourceVersion,
            resourceKind: item.resourceKind,
            resourceId: item.resourceId,
            action: item.action,
            changedFields: changedResourceFields(item.before, current, item.action),
          };
        }));
    return { transactionId, result };
  }

  accountOrder(
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<Array<{ accountId: string; order: number }>> {
    return { transactionId, result: accountDisplayOrders(this.store.database) };
  }

  updateAccountOrder(input: {
    updates: Array<{ accountId: string; order: number }>;
    transactionId?: string;
    actor?: string;
  }): OperationResult<Array<{ accountId: string; order: number }>> {
    const transactionId = input.transactionId ?? crypto.randomUUID();
    if (!input.updates.length) throw new Error('updates must contain at least one account order.');
    const ids = input.updates.map((item) => item.accountId);
    if (new Set(ids).size !== ids.length) throw new Error('updates must not repeat account IDs.');
    const accounts = new Set(activeResources(this.store.database, ACCOUNT).map(
      (account) => account.metadata.id,
    ));
    for (const item of input.updates) {
      if (!accounts.has(item.accountId)) throw new Error(`Account "${item.accountId}" was not found.`);
      if (!Number.isInteger(item.order) || item.order < 0) {
        throw new Error('Account display order must be a non-negative integer.');
      }
    }
    const result = this.store.atomic(() => setAccountDisplayOrders(
      this.store.database,
      input.updates,
      { transactionId, actor: input.actor },
    ));
    return { transactionId, result };
  }

  ledger(
    filters: {
      from?: string;
      through?: string;
      status?: 'Realized' | 'Planned' | 'Estimated' | 'Not realized';
      search?: string;
    } = {},
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<LedgerViewItem[]> {
    validateLedgerDate(filters.from, 'from');
    validateLedgerDate(filters.through, 'through');
    if (filters.from && filters.through && filters.from > filters.through) {
      throw new Error('from cannot be after through.');
    }
    const importedProjection = ledgerProjectionRows(this.store.database);
    if (importedProjection.length) {
      const itemsByProjection = new Map<string, Array<{
        id: string;
        entryAt: number | null;
        description: string | null;
        lifecycleStatus: 'Realized' | 'Planned' | 'Estimated' | null;
        fromAccount: string;
        toAccount: string;
        amountCents: bigint;
        flow: 'Income' | 'Expense' | 'Reinvested';
        note?: string;
        staging: LedgerViewItem['staging'];
      }>>();
      for (const item of ledgerProjectionItems(this.store.database)) {
        itemsByProjection.set(item.projectionId, [
          ...(itemsByProjection.get(item.projectionId) ?? []),
          {
            id: item.id,
            entryAt: item.entryAt,
            description: item.description,
            lifecycleStatus: item.lifecycleStatus,
            fromAccount: item.fromAccount,
            toAccount: item.toAccount,
            amountCents: BigInt(item.amountCents),
            flow: item.flow,
            ...(item.note ? { note: item.note } : {}),
            staging: item.staging.map((staged) => ({
              date: staged.date,
              description: staged.description,
              amount: money(BigInt(Math.abs(staged.amountCents))),
              sourceAccount: staged.sourceAccount,
              sourceType: staged.sourceType,
              sourceStatus: staged.sourceStatus,
              state: staged.state,
            })),
          },
        ]);
      }
      let cashOnHand = 0n;
      const result: LedgerViewItem[] = [];
      for (const row of importedProjection) {
        if (row.openingCashCents !== null) cashOnHand = BigInt(row.openingCashCents);
        const expectedDelta = BigInt(row.revenueCents)
          - BigInt(row.expensesCents)
          - BigInt(row.reinvestedCents);
        const date = new Date(row.entryAt).toISOString().slice(0, 10);
        const items = itemsByProjection.get(row.id) ?? [];
        let itemDelta = 0n;
        for (const item of items) {
          const delta = item.flow === 'Income' ? item.amountCents : -item.amountCents;
          itemDelta += delta;
          cashOnHand += delta;
          result.push({
            id: `projection-item:${item.id}`,
            status: item.lifecycleStatus ?? row.lifecycleStatus,
            description: item.description ?? row.description,
            date: item.entryAt === null
              ? date
              : new Date(item.entryAt).toISOString().slice(0, 10),
            fromAccount: item.fromAccount,
            toAccount: item.toAccount,
            amount: money(item.amountCents),
            flow: item.flow,
            ...(item.note ? { note: item.note } : {}),
            staging: item.staging,
            revenue: money(item.flow === 'Income' ? item.amountCents : 0n),
            expenses: money(item.flow === 'Expense' ? item.amountCents : 0n),
            reinvested: money(item.flow === 'Reinvested' ? item.amountCents : 0n),
            cashOnHand: money(cashOnHand),
            sourceKind: 'Projection',
            sourceId: item.id,
          });
        }
        const difference = expectedDelta - itemDelta;
        if (difference !== 0n) {
          const amount = difference < 0n ? -difference : difference;
          const flow = difference > 0n ? 'Income' : 'Expense';
          cashOnHand += difference;
          result.push({
            id: `projection-adjustment:${row.id}`,
            status: row.lifecycleStatus,
            description: row.description,
            date,
            fromAccount: '',
            toAccount: '',
            amount: money(amount),
            flow,
            note: 'Imported ledger adjustment',
            staging: [],
            revenue: money(flow === 'Income' ? amount : 0n),
            expenses: money(flow === 'Expense' ? amount : 0n),
            reinvested: '0.00',
            cashOnHand: money(cashOnHand),
            sourceKind: 'Projection',
            sourceId: row.id,
          });
        } else if (items.length === 0 && row.openingCashCents !== null) {
          result.push({
            id: `projection-anchor:${row.id}`,
            status: row.lifecycleStatus,
            description: row.description,
            date,
            fromAccount: '',
            toAccount: '',
            amount: '0.00',
            flow: 'Adjustment',
            note: 'Opening cash anchor',
            staging: [],
            revenue: '0.00',
            expenses: '0.00',
            reinvested: '0.00',
            cashOnHand: money(cashOnHand),
            sourceKind: 'Projection',
            sourceId: row.id,
          });
        }
      }
      return { transactionId, result: filterLedgerRows(result, filters).reverse() };
    }

    const accounts = this.enriched(ACCOUNT);
    const transactions = this.enriched(TRANSACTION);
    const budgets = this.enriched(BUDGET);
    const accountMap = new Map(accounts.map((account) => [account.metadata.id, account]));
    const cash = accounts.find((account) => account.spec.name === 'Cash');
    const cashAccounts = cash
      ? descendantIds(accounts, cash.metadata.id, 'parentAccountId')
      : new Set<string>();
    const rows: Array<{
      id: string;
      status: 'Realized' | 'Planned' | 'Estimated';
      description: string;
      date: string;
      revenueCents: bigint;
      expensesCents: bigint;
      reinvestedCents: bigint;
      cashDeltaCents: bigint;
      sourceKind: 'Transaction' | 'Budget' | 'Projection';
      sourceId: string;
      fromAccount: string;
      toAccount: string;
      amountCents: bigint;
      flow: LedgerViewItem['flow'];
      note?: string;
      staging: LedgerViewItem['staging'];
    }> = [];
    for (const transaction of transactions) {
      if (transaction.status.deleted === true) continue;
      const date = String(transaction.spec.date);
      const amount = cents(String(transaction.spec.amount));
      const classification = classifyTransaction(transaction, accountMap);
      const fromId = String(transaction.relationships.fromAccountId);
      const toId = String(transaction.relationships.toAccountId);
      rows.push({
        id: `transaction:${transaction.metadata.id}`,
        status: 'Realized',
        description: String(transaction.spec.description),
        date,
        revenueCents: classification === 'Income' ? amount : 0n,
        expensesCents: classification === 'Expense' ? amount : 0n,
        reinvestedCents: classification === 'Transfer' ? amount : 0n,
        cashDeltaCents: (cashAccounts.has(toId) ? amount : 0n)
          - (cashAccounts.has(fromId) ? amount : 0n),
        sourceKind: 'Transaction',
        sourceId: transaction.metadata.id,
        fromAccount: String(accountMap.get(fromId)?.spec.name ?? 'Unknown account'),
        toAccount: String(accountMap.get(toId)?.spec.name ?? 'Unknown account'),
        amountCents: amount,
        flow: classification === 'Transfer' ? 'Reinvested' : classification,
        ...(transaction.spec.note ? { note: String(transaction.spec.note) } : {}),
        staging: [],
      });
    }

    const parentBudgetIds = new Set(budgets.flatMap((budget) => {
      const parentId = relationshipId(budget.relationships, 'parentBudgetId');
      return parentId ? [parentId] : [];
    }));
    for (const budget of budgets.filter((candidate) => !parentBudgetIds.has(candidate.metadata.id))) {
      const budgeted = moneyMap(budget.status.budgetedByMonth);
      for (const [month, amount] of [...budgeted].sort(([left], [right]) => left.localeCompare(right))) {
        if (amount === 0n) continue;
        const flow = String(budget.spec.flow ?? 'Expense');
        rows.push({
          id: `budget:${budget.metadata.id}:${month}`,
          status: 'Planned',
          description: String(budget.spec.name),
          date: `${month}-01`,
          revenueCents: flow === 'Income' ? amount : 0n,
          expensesCents: flow === 'Expense' ? amount : 0n,
          reinvestedCents: flow === 'Reinvested' ? amount : 0n,
          cashDeltaCents: flow === 'Income' ? amount : -amount,
          sourceKind: 'Budget',
          sourceId: budget.metadata.id,
          fromAccount: '',
          toAccount: '',
          amountCents: amount,
          flow: flow === 'Income' || flow === 'Reinvested' ? flow : 'Expense',
          staging: [],
        });
      }
    }
    rows.sort((left, right) => left.date.localeCompare(right.date)
      || ledgerStatusOrder(left.status) - ledgerStatusOrder(right.status)
      || left.description.localeCompare(right.description));
    let cashOnHand = openingCashBalance(
      cash?.metadata.id,
      rows[0]?.date ?? '9999-12-31',
      accounts,
      transactions,
      activeResources(this.store.database, KNOWN_VALUE),
    );
    const result = rows.map((row) => {
        cashOnHand += row.cashDeltaCents;
        return {
          id: row.id,
          status: row.status,
          description: row.description,
          date: row.date,
          revenue: money(row.revenueCents),
          expenses: money(row.expensesCents),
          reinvested: money(row.reinvestedCents),
          cashOnHand: money(cashOnHand),
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
          fromAccount: row.fromAccount,
          toAccount: row.toAccount,
          amount: money(row.amountCents),
          flow: row.flow,
          ...(row.note ? { note: row.note } : {}),
          staging: row.staging,
        };
      });
    return { transactionId, result: filterLedgerRows(result, filters).reverse() };
  }

  updateLedgerItem(input: {
    id: string;
    amount?: string;
    date?: string;
    description?: string;
    status?: 'Realized' | 'Planned' | 'Estimated';
    fromAccount?: string;
    toAccount?: string;
    flow?: 'Income' | 'Expense' | 'Reinvested';
    note?: string | null;
    transactionId?: string;
    actor?: string;
  }): OperationResult<LedgerViewItem> {
    const transactionId = input.transactionId ?? crypto.randomUUID();
    if (!input.id.startsWith('projection-item:')) {
      if (input.id.startsWith('transaction:')) {
        throw new Error(
          'Transaction-backed ledger items must be updated with resource-get and resource-update.',
        );
      }
      throw new Error(
        'Only projection-item ledger entries are directly editable; adjustment and anchor rows are computed.',
      );
    }
    const itemId = input.id.slice('projection-item:'.length);
    const description = input.description?.trim();
    if (input.description !== undefined && !description) {
      throw new Error('description must be a non-empty string.');
    }
    const amountCents = input.amount === undefined ? undefined : cents(input.amount);
    if (amountCents !== undefined && amountCents <= 0n) {
      throw new Error('amount must be greater than zero.');
    }
    if (amountCents !== undefined && amountCents > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('amount is too large.');
    }
    let entryAt: number | undefined;
    if (input.date !== undefined) {
      validateLedgerDate(input.date, 'date');
      entryAt = Date.parse(`${input.date}T00:00:00.000Z`);
    }
    if (input.fromAccount !== undefined && !input.fromAccount.trim()) {
      throw new Error('fromAccount must be a non-empty string.');
    }
    if (input.toAccount !== undefined && !input.toAccount.trim()) {
      throw new Error('toAccount must be a non-empty string.');
    }
    this.store.atomic(() => updateLedgerProjectionItem(this.store.database, itemId, {
      ...(entryAt === undefined ? {} : { entryAt }),
      ...(description === undefined ? {} : { description }),
      ...(input.status === undefined ? {} : { lifecycleStatus: input.status }),
      ...(input.fromAccount === undefined ? {} : { fromAccount: input.fromAccount.trim() }),
      ...(input.toAccount === undefined ? {} : { toAccount: input.toAccount.trim() }),
      ...(amountCents === undefined ? {} : { amountCents: Number(amountCents) }),
      ...(input.flow === undefined ? {} : { flow: input.flow }),
      ...(!Object.prototype.hasOwnProperty.call(input, 'note') ? {} : { note: input.note ?? null }),
    }, { transactionId, actor: input.actor }));
    const updated = this.ledger({ search: input.id }, transactionId).result.find(
      (candidate) => candidate.id === input.id,
    );
    if (!updated) throw new Error(`LedgerItem "${input.id}" was not found after update.`);
    return { transactionId, result: updated };
  }

  importLegacyProjection(
    path: string,
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<{ imported: number; total: number }> {
    const imported = this.store.atomic(() => importLegacyLedger(this.store.database, path));
    const total = ledgerProjectionRows(this.store.database).length;
    return { transactionId, result: { imported, total } };
  }

  private enriched(kind: string): ResourceEnvelope[] {
    const resources = activeResources(this.store.database, kind);
    const accounts = activeResources(this.store.database, ACCOUNT);
    const transactions = activeResources(this.store.database, TRANSACTION);
    const knownValues = activeResources(this.store.database, KNOWN_VALUE);
    if (kind === ACCOUNT) {
      const statuses = accountStatuses(accounts, transactions, knownValues);
      return resources.map((resource) => ({
        ...resource,
        status: statuses.get(resource.metadata.id) ?? resource.status,
      }));
    }
    if (kind === TRANSACTION) {
      const accountMap = new Map(accounts.map((account) => [account.metadata.id, account]));
      return resources.map((resource) => ({
        ...resource,
        status: {
          ...resource.status,
          classification: classifyTransaction(resource, accountMap),
        },
      })).sort((a, b) => String(a.spec.date).localeCompare(String(b.spec.date)));
    }
    if (kind === KNOWN_VALUE) {
      const statuses = knownValueStatuses(knownValues, transactions, accounts);
      return resources.map((resource) => ({
        ...resource,
        status: statuses.get(resource.metadata.id) ?? resource.status,
      }));
    }
    if (kind === BUDGET) return enrichBudgets(resources, transactions);
    if (kind === CHANGE_SET) {
      return resources.map((resource) => ({
        ...resource,
        status: {
          ...resource.status,
          changeCount: changeSetItems(this.store.database, resource.metadata.id).length,
        },
      }));
    }
    return resources;
  }

  private resolveChangeSet(
    id: string | undefined,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
    title = 'Uncommitted changes',
  ): ResourceEnvelope {
    if (id) {
      const changeSet = super.get(CHANGE_SET, id).result;
      if (changeSet.status.state !== 'Open') throw new Error('ChangeSet must be open.');
      return changeSet;
    }
    return this.createChangeSet(title, undefined, transactionId, actor).result;
  }

  private validateRelationships(kind: string, relationships: Record<string, unknown>, id?: string): void {
    const definition = this.registry.get(kind);
    for (const descriptor of definition.relationshipDescriptors) {
      const value = relationships[descriptor.field];
      if (value === undefined) {
        if (descriptor.required) throw new Error(`${kind}.${descriptor.field} is required.`);
        continue;
      }
      const ids = descriptor.cardinality === 'many' ? value : [value];
      if (!Array.isArray(ids)) throw new Error(`${kind}.${descriptor.field} must be an array.`);
      for (const relatedId of ids) {
        if (typeof relatedId !== 'string' || !this.store.get(descriptor.targetKind, relatedId)) {
          throw new Error(`${kind}.${descriptor.field} references a missing ${descriptor.targetKind}.`);
        }
      }
    }
    if (kind === ACCOUNT) this.assertAcyclic(id, relationshipId(relationships, 'parentAccountId'), ACCOUNT);
    if (kind === BUDGET) this.assertAcyclic(id, relationshipId(relationships, 'parentBudgetId'), BUDGET);
  }

  private assertAcyclic(id: string | undefined, parentId: string | undefined, kind: string): void {
    if (!id || !parentId) return;
    if (id === parentId) throw new Error(`${kind} cannot be its own parent.`);
    const parentField = kind === ACCOUNT ? 'parentAccountId' : 'parentBudgetId';
    let current: string | undefined = parentId;
    const visited = new Set<string>();
    while (current) {
      if (current === id) throw new Error(`${kind} hierarchy cannot contain a cycle.`);
      if (visited.has(current)) throw new Error(`${kind} hierarchy contains a cycle.`);
      visited.add(current);
      current = relationshipId(this.store.get(kind, current)?.relationships, parentField);
    }
  }

  private assertCanDelete(resource: ResourceEnvelope): void {
    if (resource.kind === ACCOUNT) {
      const hasChildren = activeResources(this.store.database, ACCOUNT).some(
        (account) => account.relationships.parentAccountId === resource.metadata.id,
      );
      if (hasChildren) throw new Error('Account has child accounts and cannot be deleted.');
      const referenced = activeResources(this.store.database, TRANSACTION).some(
        (transaction) => transaction.relationships.fromAccountId === resource.metadata.id
          || transaction.relationships.toAccountId === resource.metadata.id,
      );
      if (referenced) throw new Error('Account is referenced by a Transaction.');
    }
    if (resource.kind === BUDGET) {
      const hasChildren = activeResources(this.store.database, BUDGET).some(
        (budget) => budget.relationships.parentBudgetId === resource.metadata.id,
      );
      if (hasChildren) throw new Error('Budget has child budgets and cannot be deleted.');
      const referenced = activeResources(this.store.database, TRANSACTION).some(
        (transaction) => transaction.relationships.budgetId === resource.metadata.id,
      );
      if (referenced) throw new Error('Budget is referenced by a Transaction.');
    }
  }
}

function enrichBudgets(
  budgets: ResourceEnvelope[],
  transactions: ResourceEnvelope[],
): ResourceEnvelope[] {
  const children = new Map<string, string[]>();
  for (const budget of budgets) {
    const parent = relationshipId(budget.relationships, 'parentBudgetId');
    if (parent) children.set(parent, [...(children.get(parent) ?? []), budget.metadata.id]);
  }
  const directRealized = new Map<string, Map<string, bigint>>();
  for (const transaction of transactions) {
    if (transaction.status.deleted === true) continue;
    const budgetId = relationshipId(transaction.relationships, 'budgetId');
    if (budgetId) {
      const month = String(transaction.spec.date).slice(0, 7);
      const values = directRealized.get(budgetId) ?? new Map<string, bigint>();
      values.set(month, (values.get(month) ?? 0n) + cents(String(transaction.spec.amount)));
      directRealized.set(budgetId, values);
    }
  }
  const budgetMap = new Map(budgets.map((budget) => [budget.metadata.id, budget]));
  const totals = new Map<string, {
    budgeted: Map<string, bigint>;
    realized: Map<string, bigint>;
  }>();
  const calculate = (id: string): {
    budgeted: Map<string, bigint>;
    realized: Map<string, bigint>;
  } => {
    const cached = totals.get(id);
    if (cached) return cached;
    const budget = budgetMap.get(id)!;
    const own = {
      budgeted: recurringBudgetByMonth(budget),
      realized: directRealized.get(id) ?? new Map<string, bigint>(),
    };
    const result = (children.get(id) ?? []).reduce((sum, childId) => {
      const child = calculate(childId);
      return {
        budgeted: mergeMoneyMaps(sum.budgeted, child.budgeted),
        realized: mergeMoneyMaps(sum.realized, child.realized),
      };
    }, own);
    totals.set(id, result);
    return result;
  };
  return budgets.map((budget) => {
    const total = calculate(budget.metadata.id);
    const balanceByMonth = cumulativeBudgetBalance(total.budgeted, total.realized);
    return {
      ...budget,
      status: {
        ...budget.status,
        budgeted: money(sumMoneyMap(total.budgeted)),
        realized: money(sumMoneyMap(total.realized)),
        balance: money(sumMoneyMap(total.budgeted) - sumMoneyMap(total.realized)),
        budgetedByMonth: moneyRecord(total.budgeted),
        realizedByMonth: moneyRecord(total.realized),
        balanceByMonth: moneyRecord(balanceByMonth),
      },
    };
  });
}

function cumulativeBudgetBalance(
  budgeted: Map<string, bigint>,
  realized: Map<string, bigint>,
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  let balance = 0n;
  for (const month of [...new Set([...budgeted.keys(), ...realized.keys()])].sort()) {
    balance += (budgeted.get(month) ?? 0n) - (realized.get(month) ?? 0n);
    result.set(month, balance);
  }
  return result;
}

function recurringBudgetByMonth(budget: ResourceEnvelope): Map<string, bigint> {
  const recurrence = budget.spec.recurrence;
  if (!recurrence || typeof recurrence !== 'object' || Array.isArray(recurrence)) return new Map();
  const rule = recurrence as Record<string, unknown>;
  const startsOn = String(rule.startsOn);
  const endsOn = String(rule.endsOn);
  if (startsOn > endsOn) return new Map();
  const amount = cents(String(budget.spec.amount));
  const result = new Map<string, bigint>();
  const add = (date: string) => {
    if (date < startsOn || date > endsOn) return;
    const month = date.slice(0, 7);
    result.set(month, (result.get(month) ?? 0n) + amount);
  };
  if (rule.frequency === 'Weekly' && rule.interval === 2) {
    for (
      let date = parseCalendarDate(startsOn);
      formatCalendarDate(date) <= endsOn;
      date = new Date(date.getTime() + 14 * 86_400_000)
    ) add(formatCalendarDate(date));
    return result;
  }
  if (rule.frequency !== 'Monthly' || !Array.isArray(rule.daysOfMonth)) return result;
  const start = parseCalendarDate(startsOn);
  const end = parseCalendarDate(endsOn);
  for (
    let year = start.getUTCFullYear(), month = start.getUTCMonth();
    year < end.getUTCFullYear() || (year === end.getUTCFullYear() && month <= end.getUTCMonth());
    month += 1
  ) {
    if (month === 12) {
      year += 1;
      month = 0;
    }
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (const rawDay of rule.daysOfMonth) {
      const day = Number(rawDay);
      const resolvedDay = day < 0 ? daysInMonth + day + 1 : day;
      if (!Number.isInteger(resolvedDay) || resolvedDay < 1 || resolvedDay > daysInMonth) continue;
      add(`${year}-${String(month + 1).padStart(2, '0')}-${String(resolvedDay).padStart(2, '0')}`);
    }
  }
  return result;
}

function parseCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function moneyMap(value: unknown): Map<string, bigint> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value as Record<string, unknown>).map(
    ([month, amount]) => [month, cents(String(amount))],
  ));
}

function changedResourceFields(
  before: ResourceEnvelope | null,
  after: ResourceEnvelope | undefined,
  action: PendingResourceChange['action'],
): string[] {
  if (!after) return action === 'delete' ? ['resource'] : [];
  const changed: string[] = [];
  for (const section of ['spec', 'status', 'relationships'] as const) {
    if (section === 'status') continue;
    const beforeValues = before?.[section] ?? {};
    const afterValues = after[section];
    const keys = new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)]);
    for (const key of keys) {
      if (section === 'relationships' && key === 'changeSetId') continue;
      if (action === 'create' || JSON.stringify(beforeValues[key]) !== JSON.stringify(afterValues[key])) {
        changed.push(`${section}.${key}`);
      }
    }
  }
  return changed;
}

function mergeMoneyMaps(left: Map<string, bigint>, right: Map<string, bigint>): Map<string, bigint> {
  const result = new Map(left);
  for (const [month, amount] of right) result.set(month, (result.get(month) ?? 0n) + amount);
  return result;
}

function sumMoneyMap(values: Map<string, bigint>): bigint {
  return [...values.values()].reduce((sum, amount) => sum + amount, 0n);
}

function moneyRecord(values: Map<string, bigint>): Record<string, string> {
  return Object.fromEntries([...values].sort().map(([month, amount]) => [month, money(amount)]));
}

function relationshipId(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function assertVersion(resource: ResourceEnvelope, expected: number): void {
  if (resource.metadata.resourceVersion !== expected) {
    throw new Error('Resource version conflict. Re-read and retry.');
  }
}

function validateLedgerDate(value: string | undefined, field: string): void {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD.`);
  }
}

function filterLedgerRows<T extends {
  id: string;
  status: 'Realized' | 'Planned' | 'Estimated';
  description: string;
  date: string;
  fromAccount: string;
  toAccount: string;
  note?: string;
  staging: LedgerViewItem['staging'];
}>(rows: T[], filters: {
  from?: string;
  through?: string;
  status?: 'Realized' | 'Planned' | 'Estimated' | 'Not realized';
  search?: string;
}): T[] {
  const search = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.from && row.date < filters.from) return false;
    if (filters.through && row.date > filters.through) return false;
    if (filters.status === 'Not realized' && row.status === 'Realized') return false;
    if (filters.status && filters.status !== 'Not realized' && row.status !== filters.status) {
      return false;
    }
    const stagingText = row.staging.map((staged) => (
        `${staged.description} ${staged.sourceAccount} ${staged.sourceType} ${staged.sourceStatus}`
      )).join(' ');
    return !search
      || (`${row.id} ${row.status} ${row.description} ${row.date} ${row.fromAccount} `
        + `${row.toAccount} ${row.note ?? ''} ${stagingText}`).toLowerCase().includes(search);
  });
}

function descendantIds(
  resources: ResourceEnvelope[],
  rootId: string,
  parentField: string,
): Set<string> {
  const result = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const resource of resources) {
      if (result.has(resource.metadata.id)) continue;
      const parentId = relationshipId(resource.relationships, parentField);
      if (parentId && result.has(parentId)) {
        result.add(resource.metadata.id);
        changed = true;
      }
    }
  }
  return result;
}

function ledgerStatusOrder(status: 'Realized' | 'Planned' | 'Estimated'): number {
  return status === 'Realized' ? 0 : status === 'Planned' ? 1 : 2;
}

function openingCashBalance(
  cashAccountId: string | undefined,
  throughDate: string,
  accounts: ResourceEnvelope[],
  transactions: ResourceEnvelope[],
  knownValues: ResourceEnvelope[],
): bigint {
  if (!cashAccountId) return 0n;
  const cashAccounts = descendantIds(accounts, cashAccountId, 'parentAccountId');
  let balance = 0n;
  for (const accountId of cashAccounts) {
    const anchor = knownValues
      .filter((value) => value.status.state === 'Committed'
        && value.relationships.accountId === accountId
        && String(value.spec.date) < throughDate)
      .sort((left, right) => String(right.spec.date).localeCompare(String(left.spec.date)))[0];
    const afterDate = anchor ? String(anchor.spec.date) : '';
    let accountBalance = anchor ? cents(String(anchor.spec.value)) : 0n;
    for (const transaction of transactions) {
      if (transaction.status.deleted === true) continue;
      const date = String(transaction.spec.date);
      if (date <= afterDate || date >= throughDate) continue;
      const amount = cents(String(transaction.spec.amount));
      if (transaction.relationships.toAccountId === accountId) accountBalance += amount;
      if (transaction.relationships.fromAccountId === accountId) accountBalance -= amount;
    }
    balance += accountBalance;
  }
  return balance;
}

function importedInstitution(name: string): string {
  if (name.startsWith('Bank of America')) return 'Bank of America';
  if (name.startsWith('Fidelity Investments')) return 'Fidelity';
  return 'Merrill';
}
