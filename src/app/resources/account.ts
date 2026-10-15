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
  parentAccountId: z.string().uuid().optional(),
  changeSetId: z.string().uuid().optional(),
}).strict();

export const AccountStatus = z.object({
  state: z.enum(['Draft', 'Committed']).default('Draft'),
  deleted: z.boolean().default(false),
  directBalance: Money.default('0.00'),
  descendantsBalance: Money.default('0.00'),
  totalBalance: Money.default('0.00'),
  latestKnownValueDate: z.string().nullable().default(null),
  unreconciledAmount: Money.default('0.00'),
}).strict();

export const accountResource: ResourceDefinition = {
  kind: 'Account',
  description: 'A user-arranged account node with direct and descendant balances.',
  spec: AccountSpec,
  status: AccountStatus,
  relationships: AccountRelationships,
  relationshipDescriptors: [
    { field: 'parentAccountId', targetKind: 'Account', cardinality: 'one' },
    { field: 'changeSetId', targetKind: 'ChangeSet', cardinality: 'one' },
  ],
  businessRules: [
    'Accounts form a user-defined hierarchy and may receive transactions at any level.',
    'A parent total is its direct balance plus all descendant balances.',
    'external-to-internal is income, internal-to-external is expense, and same-boundary movement is a transfer.',
  ],
  constraints: [
    'currency is an uppercase three-letter ISO 4217 code.',
    'An account cannot be its own parent or be moved beneath one of its descendants.',
    'Accounts referenced by transactions cannot be deleted.',
  ],
  events: ['Account.created', 'Account.updated', 'Account.deleted'],
};
