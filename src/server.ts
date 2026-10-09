import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { appConfig } from './app/config.js';
import { BankingResourceService } from './app/banking-service.js';
import { summarizeLedger } from './app/dashboard.js';
import { createRegistry } from './app/registry.js';
import { bankingUi } from './app/ui.js';
import { applicationContract } from './contract.js';
import { ResourceStore } from './framework/store.js';
import { McpAdapter } from './mcp.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? appConfig.port);
const httpEnabled = booleanSetting(process.env.ENABLE_HTTP, appConfig.defaultHttpEnabled);
const uiEnabled = booleanSetting(process.env.ENABLE_UI, appConfig.defaultUiEnabled);
const require = createRequire(import.meta.url);
const timeagoScript = readFileSync(require.resolve('timeago.js/dist/timeago.min.js'), 'utf8');
const registry = createRegistry();
const service = new BankingResourceService(
  registry,
  new ResourceStore(process.env.DATABASE_PATH ?? './application.sqlite'),
);
if (process.env.TRANSACTION_IMPORT_PATH) {
  const imported = service.importTransactions(process.env.TRANSACTION_IMPORT_PATH).result;
  console.log(`Imported ${imported.length} new transaction staging rows.`);
}
const mcp = new McpAdapter(registry, service);

createServer((req, res) => void handle(req, res))
  .listen(port, host, () => console.log(`${appConfig.title} listening on http://${host}:${port}`));

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const transactionId = headerTransactionId(req) ?? crypto.randomUUID();
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${port}`}`);
    if (url.pathname === '/health') {
      return json(res, 200, {
        transactionId,
        ok: true,
        applicationId: appConfig.id,
        version: appConfig.version,
        contractVersion: appConfig.contractVersion,
      }, transactionId);
    }
    if (url.pathname === '/mcp') {
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      return mcp.handle(req, res, body);
    }
    if (httpEnabled && url.pathname === '/api/contract' && req.method === 'GET') {
      return json(res, 200, {
        transactionId,
        result: applicationContract(registry),
      }, transactionId);
    }
    if (httpEnabled && url.pathname === '/.well-known/banking-app-contract' && req.method === 'GET') {
      return json(res, 200, {
        transactionId,
        result: applicationContract(registry),
      }, transactionId);
    }
    if (httpEnabled && url.pathname === '/api/dashboard' && req.method === 'GET') {
      const year = url.searchParams.get('year') ?? String(new Date().getUTCFullYear());
      if (!/^\d{4}$/.test(year)) throw new Error('year must contain exactly four digits.');
      return json(res, 200, {
        transactionId,
        result: summarizeLedger(service.query('LedgerEntryGroup', undefined, transactionId).result, year),
      }, transactionId);
    }
    if (httpEnabled && url.pathname === '/api/ledger/groups' && req.method === 'POST') {
      const input = asObject(await readBody(req));
      return json(res, 201, service.createGroup(
        input.spec,
        input.entries,
        transactionId,
        stringValue(input.actor),
      ), transactionId);
    }
    if (httpEnabled && url.pathname === '/api/ledger/dirty' && req.method === 'GET') {
      return json(res, 200, service.dirty(transactionId), transactionId);
    }
    if (httpEnabled && url.pathname === '/api/ledger/commit' && req.method === 'POST') {
      const input = asObject(await readBody(req));
      return json(res, 200, service.commit(
        stringArray(input.ids),
        transactionId,
        stringValue(input.actor),
      ), transactionId);
    }
    if (httpEnabled && url.pathname === '/api/ledger/discard' && req.method === 'POST') {
      const input = asObject(await readBody(req));
      return json(res, 200, service.discard(
        stringArray(input.ids),
        transactionId,
        stringValue(input.actor),
      ), transactionId);
    }
    const stagingMatch = url.pathname.match(
      /^\/api\/transaction-staging\/([0-9a-f-]+)\/(attach|create-ledger-entry|map|reconcile|discard)$/,
    );
    if (httpEnabled && stagingMatch && req.method === 'POST') {
      const input = asObject(await readBody(req));
      const [, id, operation] = stagingMatch;
      if (operation === 'create-ledger-entry') {
        return json(res, 201, service.createLedgerEntryFromStaging(
          id,
          numberValue(input.expectedResourceVersion),
          transactionId,
          stringValue(input.actor),
        ), transactionId);
      }
      if (operation === 'attach') {
        return json(res, 200, service.attachStaging(
          id,
          requiredString(input.groupId, 'groupId'),
          numberValue(input.expectedResourceVersion),
          transactionId,
          stringValue(input.actor),
        ), transactionId);
      }
      if (operation === 'map') {
        return json(res, 200, service.mapStaging(
          id,
          requiredString(input.ledgerEntryId, 'ledgerEntryId'),
          numberValue(input.expectedResourceVersion),
          transactionId,
          stringValue(input.actor),
        ), transactionId);
      }
      if (operation === 'reconcile') {
        return json(res, 200, service.reconcileStaging(
          id,
          numberValue(input.expectedResourceVersion),
          transactionId,
          stringValue(input.actor),
        ), transactionId);
      }
      return json(res, 200, service.discardStaging(
        id,
        numberValue(input.expectedResourceVersion),
        transactionId,
        stringValue(input.actor),
      ), transactionId);
    }
    if (httpEnabled && url.pathname.startsWith('/api/resources/')) {
      return handleResource(req, res, url, transactionId);
    }
    if (uiEnabled && url.pathname === '/vendor/timeago.min.js' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=86400',
        'x-transaction-id': transactionId,
      });
      res.end(timeagoScript);
      return;
    }
    if (uiEnabled && url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-transaction-id': transactionId,
      });
      res.end(bankingUi);
      return;
    }
    json(res, 404, { transactionId, error: 'Not found.' }, transactionId);
  } catch (error) {
    json(res, 400, {
      transactionId,
      error: error instanceof Error ? error.message : String(error),
    }, transactionId);
  }
}

async function handleResource(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  transactionId: string,
): Promise<void> {
  const [, , , encodedKind, id] = url.pathname.split('/');
  const kind = decodeURIComponent(encodedKind);
  if (req.method === 'GET') {
    const result = id
      ? service.get(kind, id, transactionId)
      : service.query(kind, parseSpecFilter(url), transactionId);
    return json(res, 200, result, transactionId);
  }
  const input = asObject(await readBody(req));
  if (req.method === 'POST' && !id) {
    return json(res, 201, service.create({
      kind,
      spec: input.spec,
      status: input.status,
      relationships: input.relationships,
      transactionId,
      actor: stringValue(input.actor),
    }), transactionId);
  }
  if (req.method === 'PUT' && id) {
    return json(res, 200, service.update({
      kind,
      id,
      expectedResourceVersion: numberValue(input.expectedResourceVersion),
      spec: input.spec,
      status: input.status,
      relationships: input.relationships,
      transactionId,
      actor: stringValue(input.actor),
    }), transactionId);
  }
  if (req.method === 'DELETE' && id) {
    return json(res, 200, service.delete({
      kind,
      id,
      expectedResourceVersion: numberValue(input.expectedResourceVersion),
      transactionId,
      actor: stringValue(input.actor),
    }), transactionId);
  }
  json(res, 405, { transactionId, error: 'Method not allowed.' }, transactionId);
}

function parseSpecFilter(url: URL): Record<string, unknown> | undefined {
  const raw = url.searchParams.get('specEquals');
  return raw ? asObject(JSON.parse(raw)) : undefined;
}

function headerTransactionId(req: IncomingMessage): string | undefined {
  const value = req.headers['x-transaction-id'];
  return typeof value === 'string' && value ? value : undefined;
}

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value === 'true';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function json(
  res: ServerResponse,
  status: number,
  value: unknown,
  transactionId: string,
): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-transaction-id': transactionId,
  });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number {
  if (typeof value !== 'number') throw new Error('expectedResourceVersion must be a number.');
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('ids must be an array of strings.');
  }
  return value;
}
