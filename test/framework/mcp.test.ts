import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BankingResourceService } from '../../src/app/banking-service.js';
import { createRegistry } from '../../src/app/registry.js';
import { ResourceStore } from '../../src/framework/store.js';
import { McpAdapter } from '../../src/mcp.js';

test('serves a contract Working Memory can parse over Streamable HTTP', async () => {
  const registry = createRegistry();
  const store = new ResourceStore(':memory:');
  const adapter = new McpAdapter(registry, new BankingResourceService(registry, store));
  const http = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
        : undefined;
      await adapter.handle(req, res, body);
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
    assert.ok(tools.tools.some((tool) => tool.name === 'contract-discover'));
    assert.ok(tools.tools.some((tool) => tool.name === 'ledger-commit'));
    assert.ok(tools.tools.some((tool) => tool.name === 'ledger-discard'));
    const result = await client.callTool({
      name: 'contract-discover',
      arguments: {},
    });
    const content = Array.isArray(result.content) ? result.content : [];
    const item = content.find((candidate) => (
      candidate.type === 'text' && typeof candidate.text === 'string'
    ));
    assert.ok(item && item.type === 'text');
    const contract = JSON.parse(item.text) as Record<string, unknown>;
    assert.equal(contract.contractVersion, '1.0');
    assert.deepEqual(
      Object.keys(contract.envelope as Record<string, unknown>),
      ['kind', 'metadata', 'spec', 'status', 'relationships'],
    );
  } finally {
    await client.close().catch(() => undefined);
    await new Promise<void>((resolve) => http.close(() => resolve()));
    store.close();
  }
});
