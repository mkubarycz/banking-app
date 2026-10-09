import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';

export const CategorySpec = z.object({
  name: z.string().trim().min(1).max(200),
  classification: z.enum([
    'Asset',
    'AccountsReceivable',
    'AccountsPayable',
    'InvestmentAsset',
    'Retirement',
    'Other',
  ]).describe('Organizes accounts independently from their internal or external accounting boundary.'),
  note: z.string().max(20_000).optional(),
}).strict();

export const CategoryRelationships = z.object({
  parentCategoryId: z.string().uuid().optional(),
}).strict();

export const categoryResource: ResourceDefinition = {
  kind: 'Category',
  description: 'A user-defined classification for ledger entries, optionally nested below another category.',
  spec: CategorySpec,
  status: z.object({}).strict(),
  relationships: CategoryRelationships,
  relationshipDescriptors: [{
    field: 'parentCategoryId',
    targetKind: 'Category',
    cardinality: 'one',
  }],
  businessRules: [
    'A category may have at most one parent category.',
    'A category cannot be its own parent and category ancestry cannot contain a cycle.',
  ],
  constraints: [
    'A category referenced by an Account or child Category cannot be deleted.',
  ],
  events: ['Category.created', 'Category.updated', 'Category.deleted'],
};
