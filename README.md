# Banking App

A durable personal ledger with exact balances and budget pacing. This is an
independent Cruft-managed application data plane: it owns SQLite persistence,
resource schemas, audit/domain events, MCP and HTTP APIs, the dashboard,
health, and its Docker image. Working Memory is an optional launcher and
contract-first client.

## Start and use

Local Node development (Node 22+):

```sh
npm ci
npm test
npm run typecheck
npm run build
DATABASE_PATH=./banking-app.sqlite npm start
```

Containerized:

```sh
docker compose build
docker compose up -d
curl http://127.0.0.1:4174/health
open http://127.0.0.1:4174/
docker compose down
```

Compose publishes only `127.0.0.1:4174` and uses the named persistent volume
`working-memory-banking-app-data`. The production database starts empty.

Endpoints:

- UI: `http://127.0.0.1:4174/`
- health: `GET /health`
- MCP Streamable HTTP: `/mcp`
- discovery: `GET /.well-known/banking-app-contract` or `GET /api/contract`
- resources: `GET|POST /api/resources/LedgerEntry` and
  `GET|PUT|DELETE /api/resources/LedgerEntry/:id`
- dirty changes: `GET /api/ledger/dirty`
- commit: `POST /api/ledger/commit` with `{ "ids": ["..."] }`
- discard: `POST /api/ledger/discard` with `{ "ids": ["..."] }`
- dashboard: `GET /api/dashboard?year=2026`

Send `x-transaction-id: <uuid>` over HTTP or `transactionId` through MCP to
correlate writes. Updates and deletes require `expectedResourceVersion`.

## Published LedgerEntry shape

The generic envelope is `{ kind, metadata, spec, status, relationships }`.
`metadata.id` is an application-generated stable UUID.

```json
{
  "kind": "LedgerEntry",
  "spec": {
    "status": "Realized",
    "description": "Consulting payment",
    "date": "2026-01-15",
    "revenue": "1250.00",
    "expenses": "0.00",
    "reinvested": "250.00",
    "note": "Optional",
    "source": {
      "system": "manual",
      "document": "Optional provenance",
      "worksheet": "Optional provenance",
      "row": "Optional provenance"
    }
  },
  "status": {
    "cashDelta": "1000.00",
    "operatingCashFlow": "1250.00",
    "cashOnHand": "1000.00",
    "dirty": true,
    "committedAt": null,
    "deleted": false,
    "previousSpec": null
  },
  "relationships": {}
}
```

Money is published as a canonical signed decimal **string** with exactly two
fractional digits and stored as integer cents. JSON numeric money is rejected.

`cashDelta = revenue - expenses - reinvested`; `operatingCashFlow = revenue -
expenses`. Entries use an internal UTC millisecond timestamp for ordering while
the external contract displays only the date. The first entry may include
`openingCashOnHand` when all three flow amounts are zero. Cash calculations are
produced after retrieval and are not persisted.

Creates, edits, soft deletes, and restores are immediately visible working
changes with `committed_at = NULL`. There is no stored dirty flag; the external
`dirty` status is derived from that null timestamp. The first committed-to-
uncommitted transition stores one complete baseline and its prior commit time
in `data_change_log`; later edits reuse it. Commit records the final row and
sets `committed_at` to the current time. Revert restores both the baseline and
its prior commit time. Deletes set `deleted` and never physically remove a
ledger row. Normal queries omit deleted rows.
The ledger header reports the dirty-row count and links to a dirty-only view,
including proposed deletions. Hovering a dirty row reveals its committed values
in an aligned row underneath, where the user can revert to that baseline. The
final column uses the self-hosted `timeago.js` package to show the live relative
commit time for clean rows, Commit for dirty current rows, and Revert for prior
rows. Times under one minute read `Just now`, then advance through minutes,
hours, and days without a page reload. Times older than seven days display their
calendar date. Delete is available from the row's gear menu, which appears at
the far left on hover.
Lifecycle labels are required but open-ended; Realized, Planned, and Estimated
are initial common values rather than an enum.

## Working Memory

Working Memory registers the app as `@banking-app`, launches container
`working-memory-banking-app`, and mounts independent volume
`working-memory-banking-app-data`. Select Banking App in Container Apps or
mention `@banking-app`; the chat agent discovers `contract-discover` before
using generic resource tools.

## Cruft updates and ownership

Provenance is pinned in `.cruft.json` to Working Memory commit `9d37a29`,
subdirectory `templates/standalone-app`. Framework/runtime surfaces remain
template-owned. Banking domain definitions, policies, UI, and tests are
app-owned under `src/app/**` and `test/app/**` and are the only skipped paths.

From the Banking App directory:

```sh
../working-memory/scripts/cruft.sh check
../working-memory/scripts/cruft.sh update --template-path ../working-memory
```

Review every update diff. Do not use `--skip-update` to hide framework drift.
