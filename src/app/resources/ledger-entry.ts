import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

export const LedgerEntrySpec = z.object({
  amount: Money.refine((value) => !value.startsWith('-'), 'Amount cannot be negative.'),
  note: z.string().max(20_000).optional(),
}).strict();

export const LedgerEntryStatus = z.object({}).strict();

export const LedgerEntryRelationships = z.object({
  groupId: z.string().uuid(),
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
}).strict().refine(
  (value) => value.fromAccountId !== value.toAccountId,
  'fromAccountId and toAccountId must differ.',
);

export const ledgerEntryResource: ResourceDefinition = {
  kind: 'LedgerEntry',
  description: 'One exact-money transfer between two accounts inside a LedgerEntryGroup.',
  spec: LedgerEntrySpec,
  status: LedgerEntryStatus,
  relationships: LedgerEntryRelationships,
  relationshipDescriptors: [
    { field: 'groupId', targetKind: 'LedgerEntryGroup', cardinality: 'one', required: true },
    { field: 'fromAccountId', targetKind: 'Account', cardinality: 'one', required: true },
    { field: 'toAccountId', targetKind: 'Account', cardinality: 'one', required: true },
  ],
  businessRules: [
    'The amount moves from fromAccountId to toAccountId.',
    'Income, expense, and transfer totals are derived from the referenced accounts’ category classifications.',
  ],
  constraints: [
    'Money is published and accepted only as a canonical signed decimal string with exactly two fractional digits.',
    'fromAccountId and toAccountId must reference distinct active accounts.',
  ],
  lifecycle: [
    'Create, update, and delete mark the containing LedgerEntryGroup dirty.',
  ],
  effects: [
    'Group aggregates are calculated from active child entries after retrieval.',
  ],
  errors: [
    'INVALID_RESOURCE: Zod structure or domain invariants failed.',
    'NOT_FOUND: the requested entry does not exist.',
    'VERSION_CONFLICT: expectedResourceVersion is stale; re-read and retry.',
  ],
  events: [
    'LedgerEntry.created', 'LedgerEntry.updated', 'LedgerEntry.deleted',
  ],
};
