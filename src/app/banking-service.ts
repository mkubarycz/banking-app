import type { SQLInputValue } from 'node:sqlite';
import { ResourceService } from '../framework/service.js';
import type { ResourceRegistry } from '../framework/registry.js';
import type { ResourceStore } from '../framework/store.js';
import type { OperationResult, RequestContext, ResourceEnvelope } from '../framework/types.js';
import { cents } from './money.js';
import {
  activeRows,
  appendEntryAt,
  calculatedEnvelopes,
  dirtyRows,
  getRow,
  initializeLedgerSchema,
  logDataToRow,
  rowSpec,
  serializeRow,
  type LedgerRow,
} from './ledger-store.js';
import { LedgerEntrySpec } from './resources/ledger-entry.js';

const KIND = 'LedgerEntry';

export class BankingResourceService extends ResourceService {
  constructor(registry: ResourceRegistry, store: ResourceStore) {
    super(registry, store);
    initializeLedgerSchema(store.database);
  }

  override query(
    kind: string,
    specEquals: Record<string, unknown> | undefined,
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<ResourceEnvelope[]> {
    if (kind !== KIND) return super.query(kind, specEquals, transactionId);
    const entries = [...calculatedEnvelopes(this.store.database).values()].filter(
      (entry) => Object.entries(specEquals ?? {}).every(
        ([key, value]) => JSON.stringify(entry.spec[key]) === JSON.stringify(value),
      ),
    );
    return { transactionId, result: entries };
  }

  override get(
    kind: string,
    id: string,
    transactionId: string = crypto.randomUUID(),
  ): OperationResult<ResourceEnvelope> {
    if (kind !== KIND) return super.get(kind, id, transactionId);
    const entry = calculatedEnvelopes(this.store.database).get(id);
    if (!entry) throw new Error(`${KIND} "${id}" was not found.`);
    return { transactionId, result: entry };
  }

  dirty(transactionId: string = crypto.randomUUID()): OperationResult<ResourceEnvelope[]> {
    const entries = calculatedEnvelopes(this.store.database, true);
    return {
      transactionId,
      result: dirtyRows(this.store.database).map((row) => entries.get(row.id)!),
    };
  }

  override create(input: {
    kind: string; spec: unknown; status?: unknown; relationships?: unknown;
    transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind !== KIND) return super.create(input);
    const context = requestContext(input);
    return this.mutate(context, () => {
      const spec = LedgerEntrySpec.parse(input.spec);
      const id = crypto.randomUUID();
      const now = Date.now();
      this.store.database.prepare(`
        INSERT INTO ledger_entries
          (id, entry_at, description, lifecycle_status, revenue_cents, expenses_cents,
           reinvested_cents, opening_cash_cents, note, source_json, committed_at, deleted,
           resource_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 1, ?, ?)
      `).run(
        id,
        appendEntryAt(this.store.database, spec.date),
        spec.description,
        spec.status,
        Number(cents(spec.revenue)),
        Number(cents(spec.expenses)),
        Number(cents(spec.reinvested)),
        spec.openingCashOnHand === undefined ? null : Number(cents(spec.openingCashOnHand)),
        spec.note ?? null,
        spec.source === undefined ? null : JSON.stringify(spec.source),
        now,
        now,
      );
      setLogActor(this.store, id, context.actor);
      const created = calculatedEnvelopes(this.store.database).get(id)!;
      appendEvents(this.store, 'created', undefined, created, context);
      return created;
    });
  }

  override update(input: {
    kind: string; id: string; expectedResourceVersion: number; spec: unknown;
    status: unknown; relationships: unknown; transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind !== KIND) return super.update(input);
    const context = requestContext(input);
    return this.mutate(context, () => {
      const before = this.get(KIND, input.id).result;
      const row = getRow(this.store.database, input.id);
      if (!row) throw new Error(`${KIND} "${input.id}" was not found.`);
      const spec = LedgerEntrySpec.parse(input.spec);
      const currentDate = new Date(row.entryAt).toISOString().slice(0, 10);
      const entryAt = spec.date === currentDate
        ? row.entryAt
        : appendEntryAt(this.store.database, spec.date, row.id);
      const result = this.store.database.prepare(`
        UPDATE ledger_entries SET
          entry_at = ?, description = ?, lifecycle_status = ?,
          revenue_cents = ?, expenses_cents = ?, reinvested_cents = ?,
          opening_cash_cents = ?, note = ?, source_json = ?,
          committed_at = NULL, resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND deleted = 0 AND resource_version = ?
      `).run(
        entryAt,
        spec.description,
        spec.status,
        Number(cents(spec.revenue)),
        Number(cents(spec.expenses)),
        Number(cents(spec.reinvested)),
        spec.openingCashOnHand === undefined ? null : Number(cents(spec.openingCashOnHand)),
        spec.note ?? null,
        spec.source === undefined ? null : JSON.stringify(spec.source),
        Date.now(),
        input.id,
        input.expectedResourceVersion,
      );
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      setLogActor(this.store, input.id, context.actor);
      const updated = calculatedEnvelopes(this.store.database).get(input.id)!;
      appendEvents(this.store, 'updated', before, updated, context);
      return updated;
    });
  }

  override delete(input: {
    kind: string; id: string; expectedResourceVersion: number;
    transactionId?: string; actor?: string;
  }): OperationResult<ResourceEnvelope> {
    if (input.kind !== KIND) return super.delete(input);
    const context = requestContext(input);
    return this.mutate(context, () => {
      const before = this.get(KIND, input.id).result;
      const result = this.store.database.prepare(`
        UPDATE ledger_entries
        SET deleted = 1, committed_at = NULL,
            resource_version = resource_version + 1, updated_at = ?
        WHERE id = ? AND deleted = 0 AND resource_version = ?
      `).run(Date.now(), input.id, input.expectedResourceVersion);
      if (result.changes !== 1) throw new Error('Resource version conflict. Re-read and retry.');
      setLogActor(this.store, input.id, context.actor);
      const after = dirtyEnvelope(this.store, input.id);
      appendEvents(this.store, 'deleted', before, after, context);
      return after;
    });
  }

  commit(
    ids: string[],
    transactionId: string = crypto.randomUUID(),
    actor?: string,
  ): OperationResult<ResourceEnvelope[]> {
    const context = { transactionId, actor };
    return this.mutate(context, () => {
      const selected = uniqueIds(ids);
      const before = calculatedEnvelopes(this.store.database, true);
      const selectedRows: LedgerRow[] = [];
      for (const id of selected) {
        const row = getRow(this.store.database, id, true);
        if (!row || row.committedAt !== null) throw new Error(`LedgerEntry "${id}" is not dirty.`);
        selectedRows.push(row);
        const log = unresolvedLog(this.store, id);
        const now = Date.now();
        this.store.database.prepare(`
          UPDATE ledger_entries SET committed_at = ?, updated_at = ? WHERE id = ?
        `).run(now, now, id);
        const committedRow = getRow(this.store.database, id, true)!;
        this.store.database.prepare(`
          UPDATE data_change_log
          SET after_data = ?, resolution = 'committed', resolved_at = ?,
              commit_id = ?, actor = COALESCE(actor, ?)
          WHERE id = ?
        `).run(serializeRow(committedRow), now, transactionId, actor ?? null, log.id);
      }
      const activeAfter = calculatedEnvelopes(this.store.database);
      return selectedRows.map((priorRow) => {
        const currentRow = getRow(this.store.database, priorRow.id, true)!;
        const after = currentRow.deleted
          ? cleanDeletedEnvelope(before.get(priorRow.id)!, currentRow)
          : activeAfter.get(priorRow.id)!;
        appendEvents(this.store, 'committed', before.get(priorRow.id), after, context);
        return after;
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
      const selected = uniqueIds(ids);
      const before = calculatedEnvelopes(this.store.database, true);
      const selectedRows: LedgerRow[] = [];
      for (const id of selected) {
        const row = getRow(this.store.database, id, true);
        if (!row || row.committedAt !== null) throw new Error(`LedgerEntry "${id}" is not dirty.`);
        selectedRows.push(row);
        const log = unresolvedLog(this.store, id);
        const now = Date.now();
        if (log.beforeData === null) {
          this.store.database.prepare(`
            UPDATE ledger_entries
            SET deleted = 1, committed_at = ?,
                resource_version = resource_version + 1, updated_at = ?
            WHERE id = ?
          `).run(now, now, id);
        } else {
          const baseline = logDataToRow(log.beforeData);
          this.store.database.prepare(`
            UPDATE ledger_entries SET
              entry_at = ?, description = ?, lifecycle_status = ?,
              revenue_cents = ?, expenses_cents = ?, reinvested_cents = ?,
              opening_cash_cents = ?, note = ?, source_json = ?,
              deleted = ?, committed_at = ?,
              resource_version = resource_version + 1, updated_at = ?
            WHERE id = ?
          `).run(
            baseline.entryAt,
            baseline.description,
            baseline.lifecycleStatus,
            baseline.revenueCents,
            baseline.expensesCents,
            baseline.reinvestedCents,
            baseline.openingCashCents,
            baseline.note,
            baseline.sourceJson,
            baseline.deleted ? 1 : 0,
            log.committedAt,
            now,
            id,
          );
        }
        const afterRow = getRow(this.store.database, id, true)!;
        this.store.database.prepare(`
          UPDATE data_change_log
          SET after_data = ?, resolution = 'discarded', resolved_at = ?,
              commit_id = ?, actor = COALESCE(actor, ?)
          WHERE id = ?
        `).run(serializeRow(afterRow), now, transactionId, actor ?? null, log.id);
      }
      const activeAfter = calculatedEnvelopes(this.store.database);
      return selectedRows.map((priorRow) => {
        const currentRow = getRow(this.store.database, priorRow.id, true)!;
        const after = currentRow.deleted
          ? cleanDeletedEnvelope(before.get(priorRow.id)!, currentRow)
          : activeAfter.get(priorRow.id)!;
        appendEvents(this.store, 'discarded', before.get(priorRow.id), after, context);
        return after;
      });
    });
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

function dirtyEnvelope(store: ResourceStore, id: string): ResourceEnvelope {
  const entry = calculatedEnvelopes(store.database, true).get(id);
  if (!entry) throw new Error(`LedgerEntry "${id}" was not found.`);
  return entry;
}

function cleanDeletedEnvelope(
  prior: ResourceEnvelope,
  row: LedgerRow,
): ResourceEnvelope {
  return {
    ...prior,
    metadata: {
      ...prior.metadata,
      updatedAt: new Date(row.updatedAt).toISOString(),
      resourceVersion: row.resourceVersion,
    },
    spec: rowSpec(row),
    status: {
      ...prior.status,
      dirty: false,
      committedAt: row.committedAt === null ? null : new Date(row.committedAt).toISOString(),
      deleted: true,
      previousSpec: undefined,
    },
  };
}

function unresolvedLog(
  store: ResourceStore,
  id: string,
): { id: string; beforeData: string | null; committedAt: number | null } {
  const value = store.database.prepare(`
    SELECT id, before_data, committed_at FROM data_change_log
    WHERE table_name = 'ledger_entries' AND row_id = ? AND resolution IS NULL
  `).get(id) as Record<string, SQLInputValue> | undefined;
  if (!value) throw new Error(`LedgerEntry "${id}" has no unresolved change log.`);
  return {
    id: String(value.id),
    beforeData: value.before_data === null ? null : String(value.before_data),
    committedAt: value.committed_at === null ? null : Number(value.committed_at),
  };
}

function setLogActor(store: ResourceStore, id: string, actor: string | undefined): void {
  if (!actor) return;
  store.database.prepare(`
    UPDATE data_change_log SET actor = COALESCE(actor, ?)
    WHERE table_name = 'ledger_entries' AND row_id = ? AND resolution IS NULL
  `).run(actor, id);
}

function uniqueIds(ids: string[]): string[] {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error('At least one LedgerEntry id is required.');
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
    crypto.randomUUID(),
    context.transactionId,
    action,
    resource.kind,
    resource.metadata.id,
    context.actor ?? null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    now,
  );
  store.database.prepare(`
    INSERT INTO domain_events
      (id, transaction_id, event_type, resource_kind, resource_id, payload, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    context.transactionId,
    `${resource.kind}.${action}`,
    resource.kind,
    resource.metadata.id,
    JSON.stringify({ before, after }),
    now,
  );
}
