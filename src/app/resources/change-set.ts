import { z } from 'zod';
import type { ResourceDefinition } from '../../framework/types.js';

export const ChangeSetSpec = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().max(20_000).optional(),
}).strict();

export const ChangeSetRelationships = z.object({}).strict();

export const ChangeSetStatus = z.object({
  state: z.enum(['Open', 'Committed', 'Discarded']).default('Open'),
  changeCount: z.number().int().min(0).default(0),
}).strict();

export const changeSetResource: ResourceDefinition = {
  kind: 'ChangeSet',
  description: 'An atomic set of draft creates, updates, deletes, and reconciliations.',
  spec: ChangeSetSpec,
  status: ChangeSetStatus,
  relationships: ChangeSetRelationships,
  relationshipDescriptors: [],
  businessRules: [
    'All mutable application data is edited through an open ChangeSet.',
    'Commit and discard apply atomically to every resource in the set.',
    'Committed resources are corrected through a new ChangeSet.',
  ],
  events: ['ChangeSet.created', 'ChangeSet.committed', 'ChangeSet.discarded'],
};
