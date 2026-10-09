import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { appConfig } from './app/config.js';
import type { BankingResourceService } from './app/banking-service.js';
import { applicationContract } from './contract.js';
import type { ResourceRegistry } from './framework/registry.js';

const contextSchema = {
  transactionId: z.string().uuid().optional(),
  actor: z.string().trim().min(1).max(200).optional(),
};

export class McpAdapter {
  constructor(
    readonly registry: ResourceRegistry,
    readonly service: BankingResourceService,
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'MCP requires POST.' });
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => void transport.close());
    await this.createServer().connect(transport);
    await transport.handleRequest(req, res, body);
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: appConfig.id, version: appConfig.version });
    server.registerTool('contract-discover', {
      title: 'Discover application contract',
      description: 'Return the live Zod-derived resource contract. Call this before resource operations.',
      inputSchema: { transactionId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    }, async () => text(applicationContract(this.registry)));
    server.registerTool('resource-query', {
      description: 'Query Account, Category, LedgerEntryGroup, LedgerEntry, or TransactionStaging envelopes using optional top-level spec equality. Discover the contract first.',
      inputSchema: {
        kind: z.string().min(1),
        specEquals: z.record(z.string(), z.unknown()).optional(),
        transactionId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    }, async (input) => text(this.service.query(input.kind, input.specEquals, input.transactionId)));
    server.registerTool('resource-get', {
      description: 'Get one resource envelope by discovered kind and identifier.',
      inputSchema: {
        kind: z.string().min(1),
        id: z.string().uuid(),
        transactionId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    }, async (input) => text(this.service.get(input.kind, input.id, input.transactionId)));
    server.registerTool('resource-create', {
      description: 'Create a validated Account, Category, or LedgerEntry envelope with contract-defined relationships. TransactionStaging rows are importer-owned.',
      inputSchema: {
        kind: z.string().min(1),
        spec: z.record(z.string(), z.unknown()),
        status: z.record(z.string(), z.unknown()).optional(),
        relationships: z.record(z.string(), z.unknown()).optional(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.create(input)));
    server.registerTool('ledger-group-create', {
      description: 'Create one visible LedgerEntryGroup and one or more account-to-account LedgerEntry transfers atomically.',
      inputSchema: {
        spec: z.object({
          status: z.string().min(1),
          description: z.string().min(1),
          date: z.string(),
          note: z.string().optional(),
        }),
        entries: z.array(z.object({
          spec: z.object({
            amount: z.string(),
            note: z.string().optional(),
          }),
          relationships: z.object({
            fromAccountId: z.string().uuid(),
            toAccountId: z.string().uuid(),
          }),
        })).min(1),
        ...contextSchema,
      },
    }, async (input) => text(this.service.createGroup(
      input.spec,
      input.entries,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('resource-update', {
      description: 'Replace a resource envelope and its relationships using resource-version compare-and-swap.',
      inputSchema: {
        kind: z.string().min(1),
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        spec: z.record(z.string(), z.unknown()),
        status: z.record(z.string(), z.unknown()),
        relationships: z.record(z.string(), z.unknown()),
        ...contextSchema,
      },
    }, async (input) => text(this.service.update(input)));
    server.registerTool('resource-delete', {
      description: 'Soft-delete a resource envelope using resource-version compare-and-swap. The working change has committedAt null until committed or reverted.',
      inputSchema: {
        kind: z.string().min(1),
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.delete(input)));
    server.registerTool('ledger-dirty-query', {
      description: 'List LedgerEntryGroup working rows whose committedAt is null, including pending soft deletes.',
      inputSchema: { transactionId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    }, async (input) => text(this.service.dirty(input.transactionId)));
    server.registerTool('ledger-commit', {
      description: 'Reconcile provisional staging linked to selected LedgerEntryGroup rows, mark each group Realized, and commit its child entries atomically.',
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1),
        ...contextSchema,
      },
    }, async (input) => text(this.service.commit(input.ids, input.transactionId, input.actor)));
    server.registerTool('ledger-discard', {
      description: 'Restore selected LedgerEntryGroup rows and child entries from their baselines.',
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1),
        ...contextSchema,
      },
    }, async (input) => text(this.service.discard(input.ids, input.transactionId, input.actor)));
    server.registerTool('transaction-staging-map', {
      description: 'Provisionally map an imported TransactionStaging row to one LedgerEntry and immediately update its From account, To account, and amount using resource-version compare-and-swap.',
      inputSchema: {
        id: z.string().uuid(),
        ledgerEntryId: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.mapStaging(
      input.id,
      input.ledgerEntryId,
      input.expectedResourceVersion,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('transaction-staging-attach', {
      description: 'Create a new LedgerEntry in a selected group from an unmapped staged transaction and provisionally map it atomically.',
      inputSchema: {
        id: z.string().uuid(),
        groupId: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.attachStaging(
      input.id,
      input.groupId,
      input.expectedResourceVersion,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('transaction-staging-create-ledger-entry', {
      description: 'Create a new Realized ledger group and child entry from an unmapped staged transaction, then provisionally map it.',
      inputSchema: {
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.createLedgerEntryFromStaging(
      input.id,
      input.expectedResourceVersion,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('transaction-staging-reconcile', {
      description: 'Apply a provisional staged transaction to its mapped LedgerEntry and atomically commit the containing group.',
      inputSchema: {
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.reconcileStaging(
      input.id,
      input.expectedResourceVersion,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('transaction-staging-discard', {
      description: 'Discard dirty staging edits and restore the last committed staging baseline.',
      inputSchema: {
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.discardStaging(
      input.id,
      input.expectedResourceVersion,
      input.transactionId,
      input.actor,
    )));
    return server;
  }
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
