import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

const calendarDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Date must be a real calendar date.');

export const LedgerEntrySpec = z.object({
  status: z.string().trim().min(1).max(80)
    .describe('Required lifecycle label. Common initial values are Realized, Planned, and Estimated; other labels are allowed.'),
  description: z.string().trim().min(1).max(500),
  date: calendarDate,
  revenue: Money,
  expenses: Money,
  reinvested: Money,
  openingCashOnHand: Money.optional()
    .describe('Only the chronologically first entry may establish an opening balance; its three flow amounts must be zero.'),
  note: z.string().max(20_000).optional(),
  source: z.object({
    system: z.string().trim().min(1).max(200),
    document: z.string().trim().min(1).max(500).optional(),
    worksheet: z.string().trim().min(1).max(200).optional(),
    row: z.string().trim().min(1).max(100).optional(),
  }).strict().optional(),
}).strict();

export const LedgerEntryStatus = z.object({
  cashDelta: Money,
  operatingCashFlow: Money,
  cashOnHand: Money,
  dirty: z.boolean(),
  committedAt: z.string().datetime().nullable(),
  deleted: z.boolean(),
  previousSpec: LedgerEntrySpec.nullable().optional(),
}).strict();

export const LedgerEntryRelationships = z.object({}).strict();

export const ledgerEntryResource: ResourceDefinition = {
  kind: 'LedgerEntry',
  description: 'One chronologically ordered personal-ledger row with exact decimal-string money and derived balances.',
  spec: LedgerEntrySpec,
  status: LedgerEntryStatus,
  relationships: LedgerEntryRelationships,
  relationshipDescriptors: [],
  businessRules: [
    'cashDelta = revenue - expenses - reinvested.',
    'operatingCashFlow = revenue - expenses.',
    'Except for an explicit opening entry, cashOnHand is the prior chronological cashOnHand plus cashDelta.',
    'Entries sort by their internal millisecond timestamp, then stable generated id; the external contract displays only the UTC date.',
  ],
  constraints: [
    'Money is published and accepted only as a canonical signed decimal string with exactly two fractional digits.',
    'Lifecycle status is required but intentionally open-ended; Realized, Planned, and Estimated are common values, not an enum.',
    'Only the first chronological entry may specify openingCashOnHand, and an opening entry must have zero revenue, expenses, and reinvested.',
  ],
  lifecycle: [
    'Create generates a stable UUID, appends to the selected UTC date, and starts with committedAt null.',
    'Update replaces the working spec using resource-version compare-and-swap and clears committedAt.',
    'Delete is reversible: it sets deleted and clears committedAt rather than physically removing the row.',
    'Commit sets committedAt to the current time; discard restores the prior committedAt and clean baseline.',
  ],
  effects: [
    'The first non-null-to-null committedAt transition serializes the complete previous row exactly once.',
    'cashDelta, operatingCashFlow, and cashOnHand are calculated after retrieval and are never persisted.',
  ],
  errors: [
    'INVALID_RESOURCE: Zod structure or domain invariants failed.',
    'NOT_FOUND: the requested entry does not exist.',
    'VERSION_CONFLICT: expectedResourceVersion is stale; re-read and retry.',
  ],
  events: [
    'LedgerEntry.created', 'LedgerEntry.updated', 'LedgerEntry.deleted',
    'LedgerEntry.committed', 'LedgerEntry.discarded',
  ],
};
