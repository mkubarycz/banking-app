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
        'typed-resource-relationships',
        'ledger-entry-groups',
        'transaction-staging',
        'transaction-reconciliation',
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
      query: 'resource-query / GET /api/resources/:kind for Account, Category, LedgerEntryGroup, LedgerEntry, or TransactionStaging; LedgerEntryGroup results are chronological and contain derived rollups.',
      get: 'resource-get / GET /api/resources/:kind/:id.',
      create: 'resource-create / POST /api/resources/:kind for Account, Category, and child LedgerEntry resources. Use ledger-group-create / POST /api/ledger/groups to atomically create a group with at least one entry. TransactionStaging rows are created by idempotent CSV import.',
      update: 'resource-update / PUT /api/resources/:kind/:id with expectedResourceVersion compare-and-swap.',
      delete: 'resource-delete / DELETE /api/resources/:kind/:id performs a version-checked soft delete. Unmapped TransactionStaging rows are immediately acknowledged and retained for audit and import idempotency.',
      dirtyQuery: 'ledger-dirty-query / GET /api/ledger/dirty; dirty means committedAt is null.',
      commit: 'ledger-commit / POST /api/ledger/commit reconciles provisional staging linked to each group, marks the group Realized, and commits it atomically.',
      discard: 'ledger-discard / POST /api/ledger/discard with one or more LedgerEntryGroup ids; restores group and child-entry baselines.',
      stagingMap: 'transaction-staging-map / POST /api/transaction-staging/:id/map creates a dirty Provisional mapping and immediately updates the mapped LedgerEntry accounts and amount.',
      stagingAttach: 'transaction-staging-attach / POST /api/transaction-staging/:id/attach atomically creates a new child LedgerEntry in a selected group and provisionally maps an Unmapped transaction.',
      stagingCreateLedgerEntry: 'transaction-staging-create-ledger-entry / POST /api/transaction-staging/:id/create-ledger-entry atomically creates a new Realized group and child entry from an Unmapped transaction.',
      stagingReconcile: 'transaction-staging-reconcile / POST /api/transaction-staging/:id/reconcile applies the exact staged amount and accounts, commits the containing group, and marks staging Reconciled atomically.',
      stagingDiscard: 'transaction-staging-discard / POST /api/transaction-staging/:id/discard restores the committed staging baseline.',
      relationships: 'Account references one Category. LedgerEntry references one group plus distinct from/to Accounts. LedgerEntryGroup exposes one or more child ids. TransactionStaging optionally references from/to Accounts and one provisional LedgerEntry.',
    },
    consistency: {
      mutations: 'Working-row mutation, prior committedAt, one clean baseline log, audit event, and domain event commit atomically. Calculated balances are never persisted.',
      transactionIds: 'Supply a UUID transactionId to MCP or x-transaction-id to HTTP; otherwise the app generates one.',
    },
    resources: registry.contract(),
  };
}
