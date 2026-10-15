import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';
import { McpAdapter } from '../../src/mcp.js';

test('serves the complete 1.2 contract and mutation tools over Streamable HTTP', async () => {
  const registry = createRegistry();
  const store = new ResourceStore(':memory:');
  const adapter = new McpAdapter(registry, new BankingResourceService(registry, store));
  const http = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      await adapter.handle(
        req,
        res,
        chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined,
      );
    })();
  });
  const client = new Client({ name: 'banking-mcp-test', version: '1.0.0' });
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const address = http.address();
    assert.ok(address && typeof address === 'object');
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    ));
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const required of [
      'contract-discover',
      'resource-query',
      'pending-changes-query',
      'account-order-query',
      'account-order-update',
      'resource-create',
      'change-set-create',
      'change-set-commit',
      'change-set-discard',
      'application-reset',
    ]) assert.ok(names.includes(required), `missing ${required}`);
    const result = await client.callTool({ name: 'contract-discover', arguments: {} });
    const item = (Array.isArray(result.content) ? result.content : []).find(
      (candidate) => candidate.type === 'text',
    );
    assert.ok(item && item.type === 'text');
    const contract = JSON.parse(item.text) as {
      contractVersion: string;
      resources: Array<{ kind: string }>;
    };
    assert.equal(contract.contractVersion, '3.0');
    assert.deepEqual(
      contract.resources.map((resource) => resource.kind),
      ['Account', 'Budget', 'Transaction', 'AccountKnownValue', 'ChangeSet'],
    );
  } finally {
    await client.close().catch(() => undefined);
    await new Promise<void>((resolve) => http.close(() => resolve()));
    store.close();
  }
});
