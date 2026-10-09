import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

export const AccountSpec = z.object({
  name: z.string().trim().min(1).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Currency must be an uppercase ISO 4217 code.'),
  internal: z.boolean().default(true),
  institution: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(20_000).optional(),
}).strict();

export const AccountRelationships = z.object({
  categoryId: z.string().uuid(),
}).strict();

export const AccountStatus = z.object({
  balance: Money.default('0.00'),
}).strict();

export const accountResource: ResourceDefinition = {
  kind: 'Account',
  description: 'A financial account whose ledger entries form an independent running balance.',
  spec: AccountSpec,
  status: AccountStatus,
  relationships: AccountRelationships,
  relationshipDescriptors: [{
    field: 'categoryId',
    targetKind: 'Category',
    cardinality: 'one',
    required: true,
  }],
  businessRules: [
    'Every account belongs to one Category for organization.',
    'internal controls ledger rollups: external-to-internal is income, internal-to-external is expense, and movements within either boundary are transfers.',
    'balance is derived from all chronological LedgerEntry transfers; Cash also includes the legacy opening cash value.',
  ],
  constraints: [
    'currency is an uppercase three-letter ISO 4217 code.',
    'An account referenced by a LedgerEntry cannot be deleted.',
  ],
  events: ['Account.created', 'Account.updated', 'Account.deleted'],
};
