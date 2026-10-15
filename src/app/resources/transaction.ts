import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const TransactionSpec = z.object({
  date: calendarDate,
  description: z.string().trim().min(1).max(2_000),
  amount: Money.refine((value) => !value.startsWith('-') && value !== '0.00'),
  note: z.string().max(20_000).optional(),
  source: z.object({
    status: z.string().min(1).max(200),
    type: z.string().min(1).max(200),
    account: z.string().min(1).max(300),
    file: z.string().min(1).max(300),
    key: z.string().min(1).max(200),
  }).strict().optional(),
}).strict();

export const TransactionRelationships = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  budgetId: z.string().uuid(),
  changeSetId: z.string().uuid().optional(),
}).strict().refine(
  (value) => value.fromAccountId !== value.toAccountId,
  'fromAccountId and toAccountId must differ.',
);

export const TransactionStatus = z.object({
  state: z.enum(['Draft', 'Committed']).default('Draft'),
  deleted: z.boolean().default(false),
  classification: z.enum(['Income', 'Expense', 'Transfer']).default('Transfer'),
}).strict();

export const transactionResource: ResourceDefinition = {
  kind: 'Transaction',
  description: 'One simple movement from one account to another under one budget.',
  spec: TransactionSpec,
  status: TransactionStatus,
  relationships: TransactionRelationships,
  relationshipDescriptors: [
    { field: 'fromAccountId', targetKind: 'Account', cardinality: 'one', required: true },
    { field: 'toAccountId', targetKind: 'Account', cardinality: 'one', required: true },
    { field: 'budgetId', targetKind: 'Budget', cardinality: 'one', required: true },
    { field: 'changeSetId', targetKind: 'ChangeSet', cardinality: 'one' },
  ],
  businessRules: [
    'A transaction has exactly one From account, one To account, one amount, and one budget.',
    'Rare splits are represented as multiple transactions and may be grouped only in the view.',
    'Classification is derived from the referenced accounts internal boundaries.',
  ],
  constraints: [
    'From and To accounts must be distinct.',
    'Amount must be greater than zero.',
  ],
  events: ['Transaction.created', 'Transaction.updated', 'Transaction.deleted'],
};
