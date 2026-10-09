import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD.');

export const TransactionStagingSpec = z.object({
  date: calendarDate,
  description: z.string().trim().min(1).max(2_000),
  amount: Money.refine((value) => !value.startsWith('-'), 'Amount cannot be negative.'),
  sourceStatus: z.string().trim().min(1).max(80),
  sourceType: z.string().trim().min(1).max(120),
  sourceAccount: z.string().trim().min(1).max(300),
  sourceFile: z.string().trim().min(1).max(500),
}).strict();

export const TransactionStagingState = z.enum(['Unmapped', 'Provisional', 'Reconciled']);

export const TransactionStagingStatus = z.object({
  state: TransactionStagingState,
  dirty: z.boolean(),
  deleted: z.boolean(),
  committedAt: z.string().datetime().nullable(),
  previousSpec: TransactionStagingSpec.nullable().optional(),
  previousRelationships: z.object({
    fromAccountId: z.string().uuid().optional(),
    toAccountId: z.string().uuid().optional(),
    ledgerEntryId: z.string().uuid().optional(),
  }).strict().nullable().optional(),
}).strict();

export const TransactionStagingRelationships = z.object({
  fromAccountId: z.string().uuid().optional(),
  toAccountId: z.string().uuid().optional(),
  ledgerEntryId: z.string().uuid().optional(),
}).strict().refine(
  (value) => !value.fromAccountId || !value.toAccountId
    || value.fromAccountId !== value.toAccountId,
  'fromAccountId and toAccountId must differ.',
);

export const transactionStagingResource: ResourceDefinition = {
  kind: 'TransactionStaging',
  description: 'An imported bank transaction awaiting reconciliation to a LedgerEntry.',
  spec: TransactionStagingSpec,
  status: TransactionStagingStatus,
  relationships: TransactionStagingRelationships,
  relationshipDescriptors: [
    { field: 'fromAccountId', targetKind: 'Account', cardinality: 'one' },
    { field: 'toAccountId', targetKind: 'Account', cardinality: 'one' },
    { field: 'ledgerEntryId', targetKind: 'LedgerEntry', cardinality: 'one' },
  ],
  businessRules: [
    'Imported transactions begin clean and Unmapped.',
    'Mapping to a LedgerEntry changes the state to Provisional and marks the row dirty.',
    'Editing a reconciled row returns its existing mapping to Provisional for correction.',
    'Reconciliation applies the staged accounts and exact amount to the mapped LedgerEntry.',
    'Reconciled transactions remain queryable but are omitted from the staging rail.',
    'Soft-deleted unmapped transactions remain addressable by id and are not reimported.',
  ],
  constraints: [
    'Reconciliation requires distinct from and to accounts plus a mapped LedgerEntry.',
    'Updates use resource-version compare-and-swap.',
  ],
  lifecycle: [
    'Unmapped -> Provisional -> Reconciled.',
    'Dirty working changes can be discarded to the last committed staging baseline.',
  ],
  effects: [
    'Reconciliation commits the containing LedgerEntryGroup and the staging row atomically.',
  ],
  events: [
    'TransactionStaging.created',
    'TransactionStaging.updated',
    'TransactionStaging.committed',
    'TransactionStaging.discarded',
  ],
};
