import { appConfig } from './app/config.js';
import type { ResourceRegistry } from './framework/registry.js';

export function applicationContract(registry: ResourceRegistry) {
  return {
    contractVersion: appConfig.contractVersion,
    application: {
      id: appConfig.id,
      title: appConfig.title,
      description: appConfig.description,
      version: appConfig.version,
      capabilities: [
        'contract-discovery',
        'resource-query',
        'resource-get',
        'resource-create',
        'resource-update',
        'resource-delete',
        'dirty-query',
        'dirty-commit',
        'dirty-discard',
        'audit-events',
        'domain-events',
      ],
      dataOwnership: 'application',
    },
    envelope: {
      kind: { type: 'string', description: 'Registered resource kind.' },
      metadata: {
        type: 'object',
        required: ['id', 'createdAt', 'updatedAt', 'resourceVersion'],
      },
      spec: { type: 'object', description: 'Kind-specific desired data.' },
      status: { type: 'object', description: 'Kind-specific current state.' },
      relationships: {
        type: 'object',
        description: 'Kind-specific typed references to other resources.',
      },
    },
    operations: {
      query: 'resource-query / GET /api/resources/:kind; LedgerEntry results are chronological by internal timestamp and id; calculated balances are produced after retrieval.',
      get: 'resource-get / GET /api/resources/:kind/:id.',
      create: 'resource-create / POST /api/resources/:kind. The published resource spec schema is authoritative.',
      update: 'resource-update / PUT /api/resources/:kind/:id with expectedResourceVersion compare-and-swap.',
      delete: 'resource-delete / DELETE /api/resources/:kind/:id performs a soft delete, clears committedAt, and uses expectedResourceVersion compare-and-swap.',
      dirtyQuery: 'ledger-dirty-query / GET /api/ledger/dirty; dirty means committedAt is null.',
      commit: 'ledger-commit / POST /api/ledger/commit with one or more LedgerEntry ids; sets committedAt to the current time.',
      discard: 'ledger-discard / POST /api/ledger/discard with one or more LedgerEntry ids; restores the baseline and its prior committedAt.',
    },
    consistency: {
      mutations: 'Working-row mutation, prior committedAt, one clean baseline log, audit event, and domain event commit atomically. Calculated balances are never persisted.',
      transactionIds: 'Supply a UUID transactionId to MCP or x-transaction-id to HTTP; otherwise the app generates one.',
    },
    resources: registry.contract(),
  };
}
