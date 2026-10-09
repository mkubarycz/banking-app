import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD.');

export const LedgerEntryGroupSpec = z.object({
  status: z.enum(['Realized', 'Planned', 'Estimated']),
  description: z.string().trim().min(1).max(500),
  date: calendarDate,
  note: z.string().max(20_000).optional(),
}).strict();

export const LedgerEntryGroupRelationships = z.object({
  ledgerEntryIds: z.array(z.string().uuid()).min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'ledgerEntryIds must be unique.'),
}).strict();

export const LedgerEntryGroupStatus = z.object({
  income: Money,
  expense: Money,
  transfers: Money,
  cashDelta: Money,
  operatingCashFlow: Money,
  cashOnHand: Money,
  dirty: z.boolean(),
  committedAt: z.string().datetime().nullable(),
  deleted: z.boolean(),
  previousSpec: LedgerEntryGroupSpec.nullable().optional(),
}).strict();

export const ledgerEntryGroupResource: ResourceDefinition = {
  kind: 'LedgerEntryGroup',
  description: 'One visible ledger row containing one or more account-to-account ledger entries.',
  spec: LedgerEntryGroupSpec,
  status: LedgerEntryGroupStatus,
  relationships: LedgerEntryGroupRelationships,
  relationshipDescriptors: [{
    field: 'ledgerEntryIds',
    targetKind: 'LedgerEntry',
    cardinality: 'many',
    required: true,
  }],
  businessRules: [
    'A group contains at least one distinct, active LedgerEntry resource.',
    'A LedgerEntry may belong to at most one LedgerEntryGroup.',
    'External-to-internal entries are income.',
    'Internal-to-external entries are expense.',
    'Internal-to-internal and external-to-external entries are transfers.',
  ],
  constraints: [
    'Deleting a grouped LedgerEntry is rejected until it is removed from its group.',
  ],
  events: [
    'LedgerEntryGroup.created', 'LedgerEntryGroup.updated', 'LedgerEntryGroup.deleted',
  ],
};
