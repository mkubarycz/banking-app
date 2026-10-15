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
      description: 'Return the live resource and operation contract. Call this before mutations.',
      inputSchema: { transactionId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true },
    }, async () => text(applicationContract(this.registry)));
    server.registerTool('resource-query', {
      description: 'Query Account, Budget, Transaction, AccountKnownValue, or ChangeSet resources.',
      inputSchema: {
        kind: z.string().min(1),
        specEquals: z.record(z.string(), z.unknown()).optional(),
        transactionId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    }, async (input) => text(this.service.query(input.kind, input.specEquals, input.transactionId)));
    server.registerTool('resource-get', {
      description: 'Get one resource envelope by kind and identifier.',
      inputSchema: {
        kind: z.string().min(1),
        id: z.string().uuid(),
        transactionId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    }, async (input) => text(this.service.get(input.kind, input.id, input.transactionId)));
    server.registerTool('pending-changes-query', {
      description: 'List resources awaiting Change Set approval and the exact spec, status, or relationship fields changed from their committed baselines.',
      inputSchema: {
        transactionId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    }, async (input) => text(this.service.pendingChanges(input.transactionId)));
    server.registerTool('account-order-query', {
      description: 'Return immediate display ordering for Accounts. Account parenting remains part of staged Account relationships.',
      inputSchema: {
        transactionId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true },
    }, async (input) => text(this.service.accountOrder(input.transactionId)));
    server.registerTool('account-order-update', {
      description: 'Immediately replace Account display-order positions without creating or committing a Change Set. This does not change account parenting.',
      inputSchema: {
        updates: z.array(z.object({
          accountId: z.string().uuid(),
          order: z.number().int().nonnegative(),
        }).strict()).min(1),
        ...contextSchema,
      },
    }, async (input) => text(this.service.updateAccountOrder(input)));
    server.registerTool('resource-create', {
      description: 'Create a draft Account, Budget, Transaction, or AccountKnownValue. To add it to an explicitly created atomic group, include that open ChangeSet ID as relationships.changeSetId; otherwise the app creates a ChangeSet automatically.',
      inputSchema: {
        kind: z.string().min(1),
        spec: z.record(z.string(), z.unknown()),
        status: z.record(z.string(), z.unknown()).optional(),
        relationships: z.record(z.string(), z.unknown()).optional().describe(
          'Resource relationships. Include changeSetId when reusing an explicitly created open ChangeSet.',
        ),
        ...contextSchema,
      },
    }, async (input) => text(this.service.create(input)));
    server.registerTool('resource-update', {
      description: 'Stage a version-checked resource replacement. Preserve the complete current spec, status, and relationships while changing only intended fields. To reuse an explicitly created atomic group, include its ID as relationships.changeSetId; omitting it creates a separate ChangeSet.',
      inputSchema: {
        kind: z.string().min(1),
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        spec: z.record(z.string(), z.unknown()),
        status: z.record(z.string(), z.unknown()),
        relationships: z.record(z.string(), z.unknown()).describe(
          'Complete replacement relationships. Include the explicit open changeSetId for grouped mutations.',
        ),
        ...contextSchema,
      },
    }, async (input) => text(this.service.update(input)));
    server.registerTool('resource-delete', {
      description: 'Stage a version-checked resource deletion in an open ChangeSet.',
      inputSchema: {
        kind: z.string().min(1),
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.delete(input)));
    server.registerTool('change-set-create', {
      description: 'Create an open ChangeSet only when multiple mutations must share one atomic approval. Every subsequent resource-create or resource-update in that group must include the returned ID as relationships.changeSetId. Do not create one for a single mutation that can use the app-created ChangeSet.',
      inputSchema: {
        title: z.string().trim().min(1).max(200),
        note: z.string().max(20_000).optional(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.createChangeSet(
      input.title,
      input.note,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('change-set-commit', {
      description: 'Validate and atomically commit all resources in an open ChangeSet.',
      inputSchema: {
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.commitChangeSet(
      input.id,
      input.expectedResourceVersion,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('change-set-discard', {
      description: 'Atomically restore all baselines and discard an open ChangeSet. Use only when the user explicitly asks to discard or revert staged changes; never use it merely to clean up during a larger request.',
      inputSchema: {
        id: z.string().uuid(),
        expectedResourceVersion: z.number().int().positive(),
        ...contextSchema,
      },
    }, async (input) => text(this.service.discardChangeSet(
      input.id,
      input.expectedResourceVersion,
      input.transactionId,
      input.actor,
    )));
    server.registerTool('application-reset', {
      description: 'Delete application data and restore 1.2 defaults before deterministic reimport.',
      inputSchema: { transactionId: z.string().uuid().optional() },
      annotations: { destructiveHint: true },
    }, async (input) => text(this.service.reset(input.transactionId)));
    server.registerTool('transaction-import', {
      description: 'Idempotently import supported transaction CSV files from a local directory.',
      inputSchema: {
        directory: z.string().trim().min(1),
        ...contextSchema,
      },
    }, async (input) => text(this.service.importTransactions(
      input.directory,
      input.transactionId,
      input.actor,
      true,
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
