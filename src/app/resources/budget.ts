import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';
import { Money } from '../money.js';

const monthValues = z.record(
  z.string().regex(/^\d{4}-\d{2}$/),
  Money,
).default({});

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const recurrence = z.discriminatedUnion('frequency', [
  z.object({
    frequency: z.literal('Monthly'),
    interval: z.literal(1).default(1),
    daysOfMonth: z.array(z.number().int().min(-31).max(31).refine((day) => day !== 0))
      .min(1).max(31),
    startsOn: calendarDate,
    endsOn: calendarDate,
  }).strict(),
  z.object({
    frequency: z.literal('Weekly'),
    interval: z.literal(2),
    startsOn: calendarDate,
    endsOn: calendarDate,
  }).strict(),
]);

export const BudgetSpec = z.object({
  name: z.string().trim().min(1).max(200),
  order: z.number().int().min(0).default(0),
  flow: z.enum(['Income', 'Expense', 'Reinvested']).default('Expense'),
  amount: Money.default('0.00'),
  recurrence: recurrence.optional(),
  note: z.string().max(20_000).optional(),
}).strict();

export const BudgetRelationships = z.object({
  parentBudgetId: z.string().uuid().optional(),
  changeSetId: z.string().uuid().optional(),
}).strict();

export const BudgetStatus = z.object({
  state: z.enum(['Draft', 'Committed']).default('Draft'),
  deleted: z.boolean().default(false),
  budgeted: Money.default('0.00'),
  realized: Money.default('0.00'),
  balance: Money.default('0.00'),
  budgetedByMonth: monthValues,
  realizedByMonth: monthValues,
  balanceByMonth: monthValues,
}).strict();

export const budgetResource: ResourceDefinition = {
  kind: 'Budget',
  description: 'A node in the hierarchical planning and realized-spending model.',
  spec: BudgetSpec,
  status: BudgetStatus,
  relationships: BudgetRelationships,
  relationshipDescriptors: [
    { field: 'parentBudgetId', targetKind: 'Budget', cardinality: 'one' },
    { field: 'changeSetId', targetKind: 'ChangeSet', cardinality: 'one' },
  ],
  businessRules: [
    'Budgeted Value is the amount of each recurrence occurrence.',
    'Recurrence follows RFC 5545 concepts: monthly BYMONTHDAY values or weekly INTERVAL=2 anchored by DTSTART.',
    'Calendar-derived monthly budgeted values roll up through the budget hierarchy.',
    'Realized values are derived from committed transactions assigned to the budget.',
    'Balance is Budgeted Value disbursements minus Realized Transactions; balanceByMonth is cumulative.',
  ],
  constraints: [
    'A budget cannot be its own parent or be moved beneath one of its descendants.',
  ],
  events: ['Budget.created', 'Budget.updated', 'Budget.deleted'],
};
