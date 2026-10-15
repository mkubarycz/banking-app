import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

export const AccountKnownValueSpec = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: Money,
  note: z.string().max(20_000).optional(),
}).strict();

export const AccountKnownValueRelationships = z.object({
  accountId: z.string().uuid(),
  changeSetId: z.string().uuid().optional(),
}).strict();

export const AccountKnownValueStatus = z.object({
  state: z.enum(['Draft', 'Committed']).default('Draft'),
  deleted: z.boolean().default(false),
  calculatedValue: Money.default('0.00'),
  unreconciledAmount: Money.default('0.00'),
  severity: z.enum(['Normal', 'High']).default('Normal'),
}).strict();

export const accountKnownValueResource: ResourceDefinition = {
  kind: 'AccountKnownValue',
  description: 'A dated observed account balance used as a reconciliation anchor.',
  spec: AccountKnownValueSpec,
  status: AccountKnownValueStatus,
  relationships: AccountKnownValueRelationships,
  relationshipDescriptors: [
    { field: 'accountId', targetKind: 'Account', cardinality: 'one', required: true },
    { field: 'changeSetId', targetKind: 'ChangeSet', cardinality: 'one' },
  ],
  businessRules: [
    'A leaf known value anchors its direct balance.',
    'A parent known value reconciles its direct activity plus all descendant account balances.',
    'The unreconciled amount is a calculated display-only virtual adjustment, never a transaction.',
    'Unreconciled amounts over the configured threshold are highlighted.',
  ],
  events: [
    'AccountKnownValue.created',
    'AccountKnownValue.updated',
    'AccountKnownValue.deleted',
  ],
};
