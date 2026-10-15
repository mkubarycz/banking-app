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
        'resource-crud',
        'account-hierarchy',
        'immediate-account-display-order',
        'budget-hierarchy',
        'calendar-recurring-budgets',
        'simple-transactions',
        'atomic-change-sets',
        'pending-change-fields',
        'known-account-values',
        'virtual-reconciliation-adjustments',
        'deterministic-import',
        'change-version',
        'container-app-resource-reference-v2',
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
      status: { type: 'object', description: 'Kind-specific state and derived values.' },
      relationships: {
        type: 'object',
        description: 'Kind-specific typed references to other resources.',
      },
    },
    operations: {
      query: 'resource-query / GET /api/resources/:kind.',
      pendingChanges: 'pending-changes-query / GET /api/pending-changes returns each open Change Set resource and the exact fields changed from its committed baseline.',
      accountOrder: 'account-order-query and account-order-update / GET and PUT /api/account-order read and immediately update Account display order without a Change Set. Account parent relationships remain staged Account changes.',
      resourceReference: 'Dragged resources use application/vnd.kubarycz.container-app-resource+json version 2. Transaction references resolve through resource-get and change through resource-update.',
      get: 'resource-get / GET /api/resources/:kind/:id.',
      create: 'resource-create / POST /api/resources/:kind stages the resource. Include relationships.changeSetId only to reuse an explicitly created atomic group; otherwise the app creates a ChangeSet.',
      update: 'resource-update / PUT /api/resources/:kind/:id stages a compare-and-swap replacement. Preserve the full envelope and include relationships.changeSetId when reusing an explicit atomic group.',
      delete: 'resource-delete / DELETE /api/resources/:kind/:id stages a soft deletion.',
      changeSetCreate: 'change-set-create / POST /api/change-sets is only needed before multiple mutations that must share one atomic approval; pass its returned ID as relationships.changeSetId on every grouped mutation.',
      changeSetCommit: 'change-set-commit / POST /api/change-sets/:id/commit.',
      changeSetDiscard: 'change-set-discard / POST /api/change-sets/:id/discard restores baselines and is used only on explicit user request.',
      reset: 'application-reset / POST /api/reset clears data and restores defaults for reimport.',
      import: 'transaction-import / POST /api/reimport idempotently imports supported CSV files as committed native Transactions and creates source Accounts as needed.',
      changeVersion: 'GET /api/change-version supports host refresh after MCP mutations.',
      relationships: 'Accounts and Budgets form independent trees. Transactions reference distinct From/To Accounts and one Budget. Known Values reference one Account. Draft resources reference one open ChangeSet.',
    },
    consistency: {
      mutations: 'A ChangeSet baseline, resource mutation, audit event, and domain event are atomic.',
      calculations: 'Balances, calendar-recurring budget totals, hierarchy rollups, classifications, realized budgets, and unreconciled amounts are derived.',
      transactionIds: 'Supply transactionId to MCP or x-transaction-id to HTTP; otherwise the app generates one.',
    },
    resources: registry.contract(),
  };
}
