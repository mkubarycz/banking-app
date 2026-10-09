import type { SQLInputValue } from 'node:sqlite';
import { ResourceService } from '../framework/service.js';
import type { ResourceRegistry } from '../framework/registry.js';
import type { ResourceStore } from '../framework/store.js';
import type { OperationResult, RequestContext, ResourceEnvelope } from '../framework/types.js';
import { cents, money } from './money.js';
import {
  accountBalances,
  appendEntryAt,
  calculatedGroupEnvelopes,
  dirtyGroupRows,
  getGroupRow,
  getItemRow,
  groupSpec,
  initializeLedgerSchema,
  itemEnvelope,
  itemRows,
  logDataToGroupRow,
  serializeGroupRow,
  type LedgerGroupRow,
  type LedgerItemRow,
} from './ledger-store.js';
import { AccountRelationships } from './resources/account.js';
import { CategoryRelationships } from './resources/category.js';
import { LedgerEntryGroupSpec } from './resources/ledger-entry-group.js';
import { LedgerEntryRelationships, LedgerEntrySpec } from './resources/ledger-entry.js';
import {
  TransactionStagingRelationships,
  TransactionStagingSpec,
} from './resources/transaction-staging.js';
import {
  getTransactionStagingRow,
  importTransactionFiles,
  initializeTransactionStagingSchema,
  serializeTransactionStagingRow,
  transactionStagingEnvelope,
  transactionStagingRows,
  type TransactionStagingRow,
} from './transaction-staging-store.js';

const GROUP_KIND = 'LedgerEntryGroup';
const ENTRY_KIND = 'LedgerEntry';
const STAGING_KIND = 'TransactionStaging';

interface EntryInput {
  spec: unknown;
  relationships: { fromAccountId?: unknown; toAccountId?: unknown };
}

export class BankingResourceService extends ResourceService {
  constructor(registry: ResourceRegistry, store: ResourceStore) {
    super(registry, store);
    initializeLedgerSchema(store.database);
    initializeTransactionStagingSchema(store.database);
  }

  override query(
    kind: string,
    specEquals: Record<string, unknown> | undefined,
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<ResourceEnvelope[]> {
    let resources: ResourceEnvelope[];
    if (kind === 'Account') {
      const result = super.query(kind, specEquals, transactionId);
      return {
        transactionId,
        result: withAccountBalances(result.result, accountBalances(this.store.database)),
      };
    } else if (kind === GROUP_KIND) {
      resources = [...calculatedGroupEnvelopes(this.store.database).values()];
    } else if (kind === ENTRY_KIND) {
      resources = itemRows(this.store.database).map(itemEnvelope);
    } else if (kind === STAGING_KIND) {
      resources = transactionStagingRows(this.store.database).map(transactionStagingEnvelope);
    } else {
      return super.query(kind, specEquals, transactionId);
    }
    return {
      transactionId,
      result: resources.filter((resource) => Object.entries(specEquals ?? {}).every(
        ([key, value]) => JSON.stringify(resource.spec[key]) === JSON.stringify(value),
      )),
    };
  }

  override get(
    kind: string,
    id: string,
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<ResourceEnvelope> {
    if (kind === 'Account') {
      const result = super.get(kind, id, transactionId);
      return {
        transactionId,
        result: withAccountBalances([result.result], accountBalances(this.store.database))[0],
      };
    }
    if (kind === GROUP_KIND) {
      const group = calculatedGroupEnvelopes(this.store.database).get(id);
      if (!group) throw new Error(`${GROUP_KIND} "${id}" was not found.`);
      return { transactionId, result: group };
    }
    if (kind === ENTRY_KIND) {
      const row = getItemRow(this.store.database, id);
      if (!row || !getGroupRow(this.store.database, row.groupId)) {
        throw new Error(`${ENTRY_KIND} "${id}" was not found.`);
      }
      return { transactionId, result: itemEnvelope(row) };
    }
    if (kind === STAGING_KIND) {
      const row = getTransactionStagingRow(this.store.database, id);
      if (!row) throw new Error(`${STAGING_KIND} "${id}" was not found.`);
      return { transactionId, result: transactionStagingEnvelope(row) };
    }
    return super.get(kind, id, transactionId);
  }

  dirty(transactionId: string = crypto.randomUUID()): OperationResult<ResourceEnvelope[]> {
    const groups = calculatedGroupEnvelopes(this.store.database, true);
    return {
      transactionId,
      result: dirtyGroupRows(this.store.database).map((row) => groups.get(row.id)!),
    };
  }

  importTransactions(
    directory: string,
    transactionId: string = crypto.randomUUID(),
    actor = 'transaction-import',
    includeBeforeRealizedCutoff = false,
  ): OperationResult<ResourceEnvelope[]> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const imported = importTransactionFiles(
        this.store.database,
        directory,
        includeBeforeRealizedCutoff,
      );
      for (const resource of [...imported.accounts, ...imported.transactions]) {
        appendEvents(this.store, 'created', undefined, resource, context);
      }
      return imported.transactions;
    });
  }

  createGroup(
    specValue: unknown,
    entriesValue: unknown,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    const spec = LedgerEntryGroupSpec.parse(specValue);
    const entries = parseEntryInputs(entriesValue);
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const id = crypto.randomUUID();
      const now = Date.now();
      this.store.database.prepare(`
        INSERT INTO ledger_entries
          (id, entry_at, description, lifecycle_status, revenue_cents, expenses_cents,
           reinvested_cents, opening_cash_cents, note, source_json, committed_at, deleted,
           resource_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, 0, NULL, ?, NULL, NULL, 0, 1, ?, ?)
      `).run(id, appendEntryAt(this.store.database, spec.date), spec.description, spec.status, spec.note ?? null, now, now);
      for (const entry of entries) this.insertItem(id, entry, now);
      const created = calculatedGroupEnvelopes(this.store.database).get(id)!;
      appendEvents(this.store, 'created', undefined, created, context);
      return created;
    });
  }

  override create(input: {
    kind: string; spec: unknown; status?: unknown; relationships?: unknown;
    transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind === GROUP_KIND) {
      throw new Error('Create LedgerEntryGroup through ledger-group-create with at least one entry.');
    }
    if (input.kind === STAGING_KIND) {
      throw new Error('TransactionStaging rows are created through transaction import.');
    }
    if (input.kind === ENTRY_KIND) {
      const context = requestContext(input);
      return this.mutate(context, () => {
        const relationships = LedgerEntryRelationships.parse(input.relationships);
        const group = this.requireGroup(relationships.groupId);
        this.prepareItemMutation(group);
        const row = this.insertItem(group.id, { spec: input.spec, relationships }, Date.now());
        const created = itemEnvelope(row);
        appendEvents(this.store, 'created', undefined, created, context);
        return created;
      });
    }
    this.validateGenericRelationships(input.kind, input.relationships);
    return super.create(input);
  }

  override update(input: {
    kind: string; id: string; expectedResourceVersion: number; spec: unknown;
    status: unknown; relationships: unknown; transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind === GROUP_KIND) return this.updateGroup(input);
    if (input.kind === ENTRY_KIND) return this.updateItem(input);
    if (input.kind === STAGING_KIND) return this.updateStaging(input);
    this.validateGenericRelationships(input.kind, input.relationships, input.id);
    return super.update(input);
  }

  override delete(input: {
    kind: string; id: string; expectedResourceVersion: number;
    transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind === GROUP_KIND) return this.deleteGroup(input);
    if (input.kind === ENTRY_KIND) return this.deleteItem(input);
    if (input.kind === STAGING_KIND) return this.deleteStaging(input);
    this.assertGenericResourceCanBeDeleted(input.kind, input.id);
    return super.delete(input);
  }

  commit(
    ids: string[],
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope[]> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const before = calculatedGroupEnvelopes(this.store.database, true);
      const rows = uniqueIds(ids).map((id) => {
        const row = getGroupRow(this.store.database, id, true);
        if (!row || row.committedAt !== null) throw new Error(`${GROUP_KIND} "${id}" is not dirty.`);
        return row;
      });
      for (const row of rows) {
        const stagingIds = this.store.database.prepare(`
          SELECT staging.id
          FROM transaction_staging staging
          JOIN ledger_items item ON item.id = staging.ledger_entry_id
          WHERE item.group_id = ? AND staging.state = 'Provisional' AND staging.deleted = 0
        `).all(row.id) as Array<{ id: string }>;
        const now = Date.now();
        for (const { id } of stagingIds) {
          const staging = this.requireStaging(id);
          if (!staging.ledgerEntryId || !staging.fromAccountId || !staging.toAccountId) {
            throw new Error(`TransactionStaging "${id}" cannot be reconciled without a complete mapping.`);
          }
          this.requireResource('Account', staging.fromAccountId);
          this.requireResource('Account', staging.toAccountId);
          const entry = getItemRow(this.store.database, staging.ledgerEntryId);
          if (!entry || entry.groupId !== row.id) {
            throw new Error(`TransactionStaging "${id}" does not map to this LedgerEntryGroup.`);
          }
          this.validateItemRelationships(LedgerEntryRelationships.parse({
            groupId: row.id,
            fromAccountId: staging.fromAccountId,
            toAccountId: staging.toAccountId,
          }));
          const entryBefore = itemEnvelope(entry);
          const stagingBefore = transactionStagingEnvelope(staging);
          const entryResult = this.store.database.prepare(`
            UPDATE ledger_items
            SET from_account_id = ?, to_account_id = ?, amount_cents = ?,
                resource_version = resource_version + 1, updated_at = ?
            WHERE id = ? AND resource_version = ?
          `).run(
            staging.fromAccountId,
            staging.toAccountId,
            staging.amountCents,
            now,
            entry.id,
            entry.resourceVersion,
          );
          if (entryResult.changes !== 1) {
            throw new Error('LedgerEntry resource version conflict. Re-read and retry.');
          }
          const stagingResult = this.store.database.prepare(`
            UPDATE transaction_staging
            SET state = 'Reconciled', committed_at = ?, baseline_json = NULL,
                resource_version = resource_version + 1, updated_at = ?
            WHERE id = ? AND resource_version = ?
          `).run(now, now, staging.id, staging.resourceVersion);
          if (stagingResult.changes !== 1) {
            throw new Error('Resource version conflict. Re-read and retry.');
          }
          appendEvents(
            this.store,
            'updated',
            entryBefore,
            itemEnvelope(getItemRow(this.store.database, entry.id)!),
            context,
          );
          appendEvents(
            this.store,
            'committed',
            stagingBefore,
            transactionStagingEnvelope(this.requireStaging(staging.id)),
            context,
          );
        }
        const log = unresolvedLog(this.store, row.id);
        this.store.database.prepare(`
          UPDATE ledger_entries
          SET lifecycle_status = CASE WHEN ? > 0 THEN 'Realized' ELSE lifecycle_status END,
              committed_at = ?,
              resource_version = resource_version
                + CASE WHEN ? > 0 AND lifecycle_status != 'Realized' THEN 1 ELSE 0 END,
              updated_at = ?
          WHERE id = ?
        `).run(stagingIds.length, now, stagingIds.length, now, row.id);
        const committed = getGroupRow(this.store.database, row.id, true)!;
        this.store.database.prepare(`
          UPDATE data_change_log
          SET after_data = ?, resolution = 'committed', resolved_at = ?, commit_id = ?,
              actor = COALESCE(actor, ?)
          WHERE id = ?
        `).run(serializeGroupRow(committed), now, transactionId, actor ?? null, log.id);
      }
      const after = calculatedGroupEnvelopes(this.store.database, true);
      return rows.map((row) => {
        const result = after.get(row.id)!;
        appendEvents(this.store, 'committed', before.get(row.id), result, context);
        return result;
      });
    });
  }

  discard(
    ids: string[],
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope[]> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const before = calculatedGroupEnvelopes(this.store.database, true);
      const rows = uniqueIds(ids).map((id) => {
        const row = getGroupRow(this.store.database, id, true);
        if (!row || row.committedAt !== null) throw new Error(`${GROUP_KIND} "${id}" is not dirty.`);
        return row;
      });
      for (const row of rows) {
        const log = unresolvedLog(this.store, row.id);
        const now = Date.now();
        if (log.beforeData === null) {
          this.store.database.prepare(`
            UPDATE ledger_entries SET deleted = 1, committed_at = ?,
              resource_version = resource_version + 1, updated_at = ? WHERE id = ?
          `).run(now, now, row.id);
        } else {
          const baseline = logDataToGroupRow(log.beforeData);
          this.store.database.prepare(`
            UPDATE ledger_entries SET entry_at = ?, description = ?, lifecycle_status = ?,
              opening_cash_cents = ?, note = ?, source_json = ?, deleted = ?,
              committed_at = ?, resource_version = resource_version + 1, updated_at = ?
            WHERE id = ?
          `).run(
            baseline.entryAt, baseline.description, baseline.lifecycleStatus,
            baseline.openingCashCents, baseline.note, baseline.sourceJson,
            baseline.deleted ? 1 : 0, log.committedAt, now, row.id,
          );
        }

        if (log.itemsBefore !== null) this.restoreItems(row.id, log.itemsBefore);
        this.store.database.prepare(`
          UPDATE data_change_log SET resolution = 'discarded', resolved_at = ?,
            commit_id = ?, actor = COALESCE(actor, ?) WHERE id = ?
        `).run(now, transactionId, actor ?? null, log.id);
      }
      const after = calculatedGroupEnvelopes(this.store.database, true);
      return rows.map((row) => {
        const result = after.get(row.id)!;
        appendEvents(this.store, 'discarded', before.get(row.id), result, context);
        return result;
      });
    });
  }

  mapStaging(
    id: string,
    ledgerEntryId: string,
    expectedResourceVersion: number,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const row = this.requireStaging(id, expectedResourceVersion);
      if (row.state === 'Reconciled') throw new Error('A reconciled transaction cannot be remapped.');
      const ledgerEntry = getItemRow(this.store.database, ledgerEntryId);
      if (!ledgerEntry) throw new Error(`${ENTRY_KIND} "${ledgerEntryId}" was not found.`);
      const duplicate = this.store.database.prepare(`
        SELECT id FROM transaction_staging
        WHERE ledger_entry_id = ? AND state != 'Reconciled' AND id != ?
      `).get(ledgerEntryId, id);
      if (duplicate) throw new Error('That LedgerEntry already has an active staging mapping.');
      const before = transactionStagingEnvelope(row);
      const entryBefore = itemEnvelope(ledgerEntry);
      const baseline = row.baselineJson ?? serializeTransactionStagingRow(row);
      const fromAccountId = row.fromAccountId ?? ledgerEntry.fromAccountId;
      const toAccountId = row.toAccountId ?? ledgerEntry.toAccountId;
      TransactionStagingRelationships.parse({ fromAccountId, toAccountId, ledgerEntryId });
      this.validateItemRelationships(LedgerEntryRelationships.parse({
        groupId: ledgerEntry.groupId,
        fromAccountId,
        toAccountId,
      }));
      this.prepareItemMutation(this.requireGroup(ledgerEntry.groupId));
      const now = Date.now();
      const entryResult = this.store.database.prepare(`
        UPDATE ledger_items
        SET from_account_id = ?, to_account_id = ?, amount_cents = ?,
            resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(
        fromAccountId,
        toAccountId,
        row.amountCents,
        now,
        ledgerEntryId,
        ledgerEntry.resourceVersion,
      );
      if (entryResult.changes !== 1) {
        throw new Error('LedgerEntry resource version conflict. Re-read and retry.');
      }
      const result = this.store.database.prepare(`
        UPDATE transaction_staging
        SET state = 'Provisional', from_account_id = ?, to_account_id = ?,
            ledger_entry_id = ?, committed_at = NULL, baseline_json = ?,
            resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(
        fromAccountId,
        toAccountId,
        ledgerEntryId,
        baseline,
        now,
        id,
        expectedResourceVersion,
      );
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const entryUpdated = itemEnvelope(getItemRow(this.store.database, ledgerEntryId)!);
      const updated = transactionStagingEnvelope(this.requireStaging(id));
      appendEvents(this.store, 'updated', entryBefore, entryUpdated, context);
      appendEvents(this.store, 'updated', before, updated, context);
      return updated;
    });
  }

  attachStaging(
    id: string,
    groupId: string,
    expectedResourceVersion: number,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const staging = this.requireStaging(id, expectedResourceVersion);
      if (staging.state !== 'Unmapped' || staging.ledgerEntryId) {
        throw new Error('Only an unmapped transaction can be attached as a new LedgerEntry.');
      }
      if (!staging.fromAccountId || !staging.toAccountId) {
        throw new Error('Select both From and To accounts before attaching the transaction.');
      }
      const group = this.requireGroup(groupId);
      this.validateItemRelationships(LedgerEntryRelationships.parse({
        groupId,
        fromAccountId: staging.fromAccountId,
        toAccountId: staging.toAccountId,
      }));
      const stagingBefore = transactionStagingEnvelope(staging);
      const baseline = staging.baselineJson ?? serializeTransactionStagingRow(staging);
      this.prepareItemMutation(group);
      const now = Date.now();
      const entry = this.insertItem(groupId, {
        spec: { amount: money(BigInt(staging.amountCents)) },
        relationships: {
          fromAccountId: staging.fromAccountId,
          toAccountId: staging.toAccountId,
        },
      }, now);
      const result = this.store.database.prepare(`
        UPDATE transaction_staging
        SET state = 'Provisional', ledger_entry_id = ?, committed_at = NULL,
            baseline_json = ?, resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(entry.id, baseline, now, id, expectedResourceVersion);
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const entryResource = itemEnvelope(entry);
      const updated = transactionStagingEnvelope(this.requireStaging(id));
      appendEvents(this.store, 'created', undefined, entryResource, context);
      appendEvents(this.store, 'updated', stagingBefore, updated, context);
      return updated;
    });
  }

  createLedgerEntryFromStaging(
    id: string,
    expectedResourceVersion: number,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const staging = this.requireStaging(id, expectedResourceVersion);
      if (staging.state !== 'Unmapped' || staging.ledgerEntryId) {
        throw new Error('Only an unmapped transaction can create a new ledger entry.');
      }
      if (!staging.fromAccountId || !staging.toAccountId) {
        throw new Error('Select both From and To accounts before creating a ledger entry.');
      }
      const date = new Date(staging.transactionAt).toISOString().slice(0, 10);
      const groupId = crypto.randomUUID();
      const now = Date.now();
      this.store.database.prepare(`
        INSERT INTO ledger_entries
          (id, entry_at, description, lifecycle_status, revenue_cents, expenses_cents,
           reinvested_cents, opening_cash_cents, note, source_json, committed_at, deleted,
           resource_version, created_at, updated_at)
        VALUES (?, ?, ?, 'Realized', 0, 0, 0, NULL, NULL, ?, NULL, 0, 1, ?, ?)
      `).run(
        groupId,
        appendEntryAt(this.store.database, date),
        staging.description,
        JSON.stringify({ transactionStagingId: staging.id }),
        now,
        now,
      );
      const entry = this.insertItem(groupId, {
        spec: { amount: money(BigInt(staging.amountCents)) },
        relationships: {
          fromAccountId: staging.fromAccountId,
          toAccountId: staging.toAccountId,
        },
      }, now);
      const stagingBefore = transactionStagingEnvelope(staging);
      const baseline = staging.baselineJson ?? serializeTransactionStagingRow(staging);
      const result = this.store.database.prepare(`
        UPDATE transaction_staging
        SET state = 'Provisional', ledger_entry_id = ?, committed_at = NULL,
            baseline_json = ?, resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(entry.id, baseline, now, id, expectedResourceVersion);
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const group = calculatedGroupEnvelopes(this.store.database).get(groupId)!;
      const entryResource = itemEnvelope(entry);
      const updated = transactionStagingEnvelope(this.requireStaging(id));
      appendEvents(this.store, 'created', undefined, group, context);
      appendEvents(this.store, 'created', undefined, entryResource, context);
      appendEvents(this.store, 'updated', stagingBefore, updated, context);
      return updated;
    });
  }

  discardStaging(
    id: string,
    expectedResourceVersion: number,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const row = this.requireStaging(id, expectedResourceVersion);
      if (!row.baselineJson || row.committedAt !== null) {
        throw new Error(`${STAGING_KIND} "${id}" is not dirty.`);
      }
      const baseline = JSON.parse(row.baselineJson) as TransactionStagingRow;
      const before = transactionStagingEnvelope(row);
      const now = Date.now();
      this.store.database.prepare(`
        UPDATE transaction_staging
        SET transaction_at = ?, description = ?, amount_cents = ?, source_status = ?,
            source_type = ?, source_account = ?, source_file = ?, state = ?,
            from_account_id = ?, to_account_id = ?, ledger_entry_id = ?,
            committed_at = ?, baseline_json = NULL,
            resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(
        baseline.transactionAt,
        baseline.description,
        baseline.amountCents,
        baseline.sourceStatus,
        baseline.sourceType,
        baseline.sourceAccount,
        baseline.sourceFile,
        baseline.state,
        baseline.fromAccountId,
        baseline.toAccountId,
        baseline.ledgerEntryId,
        baseline.committedAt,
        now,
        id,
        expectedResourceVersion,
      );
      const restored = transactionStagingEnvelope(this.requireStaging(id));
      appendEvents(this.store, 'discarded', before, restored, context);
      return restored;
    });
  }

  reconcileStaging(
    id: string,
    expectedResourceVersion: number,
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const staging = this.requireStaging(id, expectedResourceVersion);
      if (staging.state !== 'Provisional' || !staging.ledgerEntryId) {
        throw new Error('Only a provisional transaction with a LedgerEntry mapping can be reconciled.');
      }
      if (!staging.fromAccountId || !staging.toAccountId) {
        throw new Error('Reconciliation requires both from and to accounts.');
      }
      TransactionStagingRelationships.parse({
        fromAccountId: staging.fromAccountId,
        toAccountId: staging.toAccountId,
        ledgerEntryId: staging.ledgerEntryId,
      });
      this.requireResource('Account', staging.fromAccountId);
      this.requireResource('Account', staging.toAccountId);
      const ledgerEntry = getItemRow(this.store.database, staging.ledgerEntryId);
      if (!ledgerEntry) throw new Error(`${ENTRY_KIND} "${staging.ledgerEntryId}" was not found.`);
      const group = this.requireGroup(ledgerEntry.groupId);
      const groupBefore = calculatedGroupEnvelopes(this.store.database).get(group.id)!;
      const entryBefore = itemEnvelope(ledgerEntry);
      const stagingBefore = transactionStagingEnvelope(staging);
      this.prepareItemMutation(group);
      const now = Date.now();
      this.store.database.prepare(`
        UPDATE ledger_items
        SET from_account_id = ?, to_account_id = ?, amount_cents = ?,
            resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(
        staging.fromAccountId,
        staging.toAccountId,
        staging.amountCents,
        now,
        ledgerEntry.id,
        ledgerEntry.resourceVersion,
      );
      const log = unresolvedLog(this.store, group.id);
      this.store.database.prepare(
        `UPDATE ledger_entries
         SET lifecycle_status = 'Realized', committed_at = ?,
             resource_version = resource_version
               + CASE WHEN lifecycle_status = 'Realized' THEN 0 ELSE 1 END,
             updated_at = ?
         WHERE id = ?`,
      ).run(now, now, group.id);
      const committedGroup = getGroupRow(this.store.database, group.id, true)!;
      this.store.database.prepare(`
        UPDATE data_change_log
        SET after_data = ?, resolution = 'committed', resolved_at = ?, commit_id = ?,
            actor = COALESCE(actor, ?)
        WHERE id = ?
      `).run(
        serializeGroupRow(committedGroup),
        now,
        transactionId,
        actor ?? null,
        log.id,
      );
      this.store.database.prepare(`
        UPDATE transaction_staging
        SET state = 'Reconciled', committed_at = ?, baseline_json = NULL,
            resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(now, now, id, expectedResourceVersion);
      const entryAfter = itemEnvelope(getItemRow(this.store.database, ledgerEntry.id)!);
      const groupAfter = calculatedGroupEnvelopes(this.store.database).get(group.id)!;
      const stagingAfter = transactionStagingEnvelope(this.requireStaging(id));
      appendEvents(this.store, 'updated', entryBefore, entryAfter, context);
      appendEvents(this.store, 'committed', groupBefore, groupAfter, context);
      appendEvents(this.store, 'committed', stagingBefore, stagingAfter, context);
      return stagingAfter;
    });
  }

  private updateGroup(input: {
    id: string; expectedResourceVersion: number; spec: unknown;
    transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    const context = requestContext(input);
    return this.mutate(context, () => {
      const before = this.get(GROUP_KIND, input.id).result;
      const row = this.requireGroup(input.id);
      const spec = LedgerEntryGroupSpec.parse(input.spec);
      const currentDate = new Date(row.entryAt).toISOString().slice(0, 10);
      const result = this.store.database.prepare(`
        UPDATE ledger_entries SET entry_at = ?, description = ?, lifecycle_status = ?,
          note = ?, committed_at = NULL, resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND deleted = 0 AND resource_version = ?
      `).run(
        spec.date === currentDate ? row.entryAt : appendEntryAt(this.store.database, spec.date, row.id),
        spec.description, spec.status, spec.note ?? null, Date.now(), input.id, input.expectedResourceVersion,
      );
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const updated = calculatedGroupEnvelopes(this.store.database).get(input.id)!;
      appendEvents(this.store, 'updated', before, updated, context);
      return updated;
    });
  }

  private updateItem(input: {
    id: string; expectedResourceVersion: number; spec: unknown; relationships: unknown;
    transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    const context = requestContext(input);
    return this.mutate(context, () => {
      const before = this.get(ENTRY_KIND, input.id).result;
      const row = getItemRow(this.store.database, input.id);
      if (!row) throw new Error(`${ENTRY_KIND} "${input.id}" was not found.`);
      const spec = LedgerEntrySpec.parse(input.spec);
      const relationships = LedgerEntryRelationships.parse(input.relationships);
      if (relationships.groupId !== row.groupId) throw new Error('LedgerEntry groupId cannot be changed.');
      this.validateItemRelationships(relationships);
      const group = this.requireGroup(row.groupId);
      this.prepareItemMutation(group);
      const result = this.store.database.prepare(`
        UPDATE ledger_items SET from_account_id = ?, to_account_id = ?, amount_cents = ?,
          note = ?, resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(
        relationships.fromAccountId, relationships.toAccountId, Number(cents(spec.amount)),
        spec.note ?? null, Date.now(), input.id, input.expectedResourceVersion,
      );
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const updated = itemEnvelope(getItemRow(this.store.database, input.id)!);
      appendEvents(this.store, 'updated', before, updated, context);
      return updated;
    });
  }

  private deleteGroup(input: {
    id: string; expectedResourceVersion: number; transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    const context = requestContext(input);
    return this.mutate(context, () => {
      const before = this.get(GROUP_KIND, input.id).result;
      const result = this.store.database.prepare(`
        UPDATE ledger_entries SET deleted = 1, committed_at = NULL,
          resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND deleted = 0 AND resource_version = ?
      `).run(Date.now(), input.id, input.expectedResourceVersion);
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const after = calculatedGroupEnvelopes(this.store.database, true).get(input.id)!;
      appendEvents(this.store, 'deleted', before, after, context);
      return after;
    });
  }

  private deleteItem(input: {
    id: string; expectedResourceVersion: number; transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    const context = requestContext(input);
    return this.mutate(context, () => {
      const row = getItemRow(this.store.database, input.id);
      if (!row) throw new Error(`${ENTRY_KIND} "${input.id}" was not found.`);
      if (itemRows(this.store.database, row.groupId).length === 1) {
        throw new Error('A LedgerEntryGroup must retain at least one LedgerEntry.');
      }
      const before = itemEnvelope(row);
      this.prepareItemMutation(this.requireGroup(row.groupId));
      const result = this.store.database.prepare(
        'DELETE FROM ledger_items WHERE id = ? AND resource_version = ?',
      ).run(input.id, input.expectedResourceVersion);
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      appendEvents(this.store, 'deleted', before, undefined, context);
      return before;
    });
  }

  private insertItem(groupId: string, input: EntryInput, now: number): LedgerItemRow {
    const spec = LedgerEntrySpec.parse(input.spec);
    const relationships = LedgerEntryRelationships.parse({ groupId, ...input.relationships });
    this.validateItemRelationships(relationships);
    const id = crypto.randomUUID();
    this.store.database.prepare(`
      INSERT INTO ledger_items
        (id, group_id, from_account_id, to_account_id, amount_cents, note,
         resource_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id, groupId, relationships.fromAccountId, relationships.toAccountId,
      Number(cents(spec.amount)), spec.note ?? null, now, now,
    );
    return getItemRow(this.store.database, id)!;
  }

  private validateItemRelationships(relationships: {
    fromAccountId: string; toAccountId: string;
  }): void {
    this.requireResource('Account', relationships.fromAccountId);
    this.requireResource('Account', relationships.toAccountId);
  }

  private validateGenericRelationships(kind: string, value: unknown, id?: string): void {
    if (kind === 'Account') {
      const relationships = AccountRelationships.parse(value);
      this.requireResource('Category', relationships.categoryId);
    }
    if (kind === 'Category') {
      const relationships = CategoryRelationships.parse(value ?? {});
      if (!relationships.parentCategoryId) return;
      this.requireResource('Category', relationships.parentCategoryId);
      const visited = new Set(id ? [id] : []);
      let ancestorId: string | undefined = relationships.parentCategoryId;
      while (ancestorId) {
        if (visited.has(ancestorId)) throw new Error('Category ancestry cannot contain a cycle.');
        visited.add(ancestorId);
        ancestorId = this.store.get('Category', ancestorId)?.relationships.parentCategoryId as string | undefined;
      }
    }
  }

  private assertGenericResourceCanBeDeleted(kind: string, id: string): void {
    if (kind === 'Account') {
      const reference = this.store.database.prepare(
        'SELECT id FROM ledger_items WHERE from_account_id = ? OR to_account_id = ? LIMIT 1',
      ).get(id, id);
      if (reference) throw new Error(`Account "${id}" is referenced by a LedgerEntry.`);
    }
    if (kind === 'Category') {
      const account = this.store.query('Account').find((candidate) => candidate.relationships.categoryId === id);
      if (account) throw new Error(`Category "${id}" is referenced by an Account.`);
      const child = this.store.query('Category').find((candidate) => candidate.relationships.parentCategoryId === id);
      if (child) throw new Error(`Category "${id}" is referenced by a child Category.`);
    }
  }

  private updateStaging(input: {
    kind: string; id: string; expectedResourceVersion: number; spec: unknown;
    status: unknown; relationships: unknown; transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    const context = requestContext(input);
    return this.mutate(context, () => {
      const row = this.requireStaging(input.id, input.expectedResourceVersion);
      const spec = TransactionStagingSpec.parse(input.spec);
      const relationships = TransactionStagingRelationships.parse(input.relationships);
      if (relationships.ledgerEntryId !== (row.ledgerEntryId ?? undefined)) {
        throw new Error('Use the staging map operation to change ledgerEntryId.');
      }
      if (relationships.fromAccountId) this.requireResource('Account', relationships.fromAccountId);
      if (relationships.toAccountId) this.requireResource('Account', relationships.toAccountId);
      const before = transactionStagingEnvelope(row);
      const baseline = row.baselineJson ?? serializeTransactionStagingRow(row);
      const now = Date.now();
      const result = this.store.database.prepare(`
        UPDATE transaction_staging
        SET transaction_at = ?, description = ?, amount_cents = ?, source_status = ?,
            source_type = ?, source_account = ?, source_file = ?,
            state = ?, from_account_id = ?, to_account_id = ?, committed_at = NULL,
            baseline_json = ?, resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND resource_version = ?
      `).run(
        Date.parse(`${spec.date}T12:00:00.000Z`),
        spec.description,
        Number(cents(spec.amount)),
        spec.sourceStatus,
        spec.sourceType,
        spec.sourceAccount,
        spec.sourceFile,
        row.ledgerEntryId ? 'Provisional' : row.state,
        relationships.fromAccountId ?? null,
        relationships.toAccountId ?? null,
        baseline,
        now,
        input.id,
        input.expectedResourceVersion,
      );
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const updated = transactionStagingEnvelope(this.requireStaging(input.id));
      appendEvents(this.store, 'updated', before, updated, context);
      return updated;
    });
  }

  private deleteStaging(input: {
    id: string; expectedResourceVersion: number; transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    const context = requestContext(input);
    return this.mutate(context, () => {
      const row = this.requireStaging(input.id, input.expectedResourceVersion);
      if (row.deleted) throw new Error(`${STAGING_KIND} "${input.id}" was already deleted.`);
      if (row.state !== 'Unmapped') {
        throw new Error('Only unmapped staged transactions can be deleted.');
      }
      const before = transactionStagingEnvelope(row);
      const now = Date.now();
      const result = this.store.database.prepare(`
        UPDATE transaction_staging
        SET deleted = 1, committed_at = ?, baseline_json = NULL,
            resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND deleted = 0 AND resource_version = ?
      `).run(now, now, input.id, input.expectedResourceVersion);
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      const after = transactionStagingEnvelope(this.requireStaging(input.id));
      appendEvents(this.store, 'deleted', before, after, context);
      return after;
    });
  }

  private prepareItemMutation(group: LedgerGroupRow): void {
    if (group.committedAt === null) return;
    const snapshot = JSON.stringify(itemRows(this.store.database, group.id));
    this.store.database.prepare(`
      UPDATE ledger_entries SET committed_at = NULL,
        resource_version = resource_version + 1, updated_at = ? WHERE id = ?
    `).run(Date.now(), group.id);
    this.store.database.prepare(`
      UPDATE data_change_log SET items_before = ?
      WHERE table_name = 'ledger_entries' AND row_id = ? AND resolution IS NULL
    `).run(snapshot, group.id);
  }

  private restoreItems(groupId: string, value: string): void {
    const items = JSON.parse(value) as LedgerItemRow[];
    this.store.database.prepare('DELETE FROM ledger_items WHERE group_id = ?').run(groupId);
    const insert = this.store.database.prepare(`
      INSERT INTO ledger_items
        (id, group_id, from_account_id, to_account_id, amount_cents, note,
         resource_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) insert.run(
      item.id, item.groupId, item.fromAccountId, item.toAccountId, item.amountCents,
      item.note, item.resourceVersion, item.createdAt, item.updatedAt,
    );
  }

  private requireGroup(id: string): LedgerGroupRow {
    const group = getGroupRow(this.store.database, id);
    if (!group) throw new Error(`${GROUP_KIND} "${id}" was not found.`);
    return group;
  }

  private requireStaging(id: string, expectedResourceVersion?: number): TransactionStagingRow {
    const row = getTransactionStagingRow(this.store.database, id);
    if (!row) throw new Error(`${STAGING_KIND} "${id}" was not found.`);
    if (expectedResourceVersion !== undefined && row.resourceVersion !== expectedResourceVersion) {
      throw new Error('Resource version conflict. Re-read and retry.');
    }
    return row;
  }

  private requireResource(kind: string, id: string): ResourceEnvelope {
    const resource = this.store.get(kind, id);
    if (!resource) throw new Error(`${kind} "${id}" was not found.`);
    return resource;
  }

  private mutate<T extends ResourceEnvelope | ResourceEnvelope[]>(
    context: RequestContext,
    operation: () => T,
  ): OperationResult<T> {
    this.store.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.store.database.exec('COMMIT');
      return { transactionId: context.transactionId, result };
    } catch (error) {
      this.store.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function withAccountBalances(
  accounts: ResourceEnvelope[],
  balances: Map<string, bigint>,
): ResourceEnvelope[] {
  return accounts.map((account) => ({
    ...account,
    status: { balance: money(balances.get(account.metadata.id) ?? 0n) },
  }));
}

function parseEntryInputs(value: unknown): EntryInput[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error('entries must contain at least one LedgerEntry.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Each entry must be an object.');
    }
    const candidate = entry as Record<string, unknown>;
    if (!candidate.relationships || typeof candidate.relationships !== 'object') {
      throw new Error('Each entry requires relationships.');
    }
    return {
      spec: candidate.spec,
      relationships: candidate.relationships as EntryInput['relationships'],
    };
  });
}

function unresolvedLog(
  store: ResourceStore,
  id: string,
): { id: string; beforeData: string | null; committedAt: number | null; itemsBefore: string | null } {
  const value = store.database.prepare(`
    SELECT id, before_data, committed_at, items_before FROM data_change_log
    WHERE table_name = 'ledger_entries' AND row_id = ? AND resolution IS NULL
  `).get(id) as Record<string, SQLInputValue> | undefined;
  if (!value) throw new Error(`${GROUP_KIND} "${id}" has no unresolved change log.`);
  return {
    id: String(value.id),
    beforeData: value.before_data === null ? null : String(value.before_data),
    committedAt: value.committed_at === null ? null : Number(value.committed_at),
    itemsBefore: value.items_before === null ? null : String(value.items_before),
  };
}

function uniqueIds(ids: string[]): string[] {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error(`At least one ${GROUP_KIND} id is required.`);
  return unique;
}

function requestContext(input: { transactionId?: string; actor?: string }): RequestContext {
  return { transactionId: input.transactionId ?? crypto.randomUUID(), actor: input.actor };
}

function appendEvents(
  store: ResourceStore,
  action: 'created' | 'updated' | 'deleted' | 'committed' | 'discarded',
  before: ResourceEnvelope | undefined,
  after: ResourceEnvelope | undefined,
  context: RequestContext,
): void {
  const resource = after ?? before!;
  const now = new Date().toISOString();
  store.database.prepare(`
    INSERT INTO audit_events
      (id, transaction_id, action, resource_kind, resource_id, actor,
       before_value, after_value, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), context.transactionId, action, resource.kind,
    resource.metadata.id, context.actor ?? null,
    before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, now,
  );
  store.database.prepare(`
    INSERT INTO domain_events
      (id, transaction_id, event_type, resource_kind, resource_id, payload, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), context.transactionId, `${resource.kind}.${action}`,
    resource.kind, resource.metadata.id, JSON.stringify({ before, after }), now,
  );
}
