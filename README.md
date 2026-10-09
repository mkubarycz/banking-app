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
- resources: `GET|POST /api/resources/:kind` and
  `GET|PUT|DELETE /api/resources/:kind/:id`, where `:kind` is `Account`,
  `Category`, `LedgerEntryGroup`, `LedgerEntry`, or `TransactionStaging`
- atomic group creation: `POST /api/ledger/groups` with a group `spec` and
  non-empty `entries` array
- dirty changes: `GET /api/ledger/dirty`
- commit: `POST /api/ledger/commit` with `{ "ids": ["..."] }`
- discard: `POST /api/ledger/discard` with `{ "ids": ["..."] }`
- provisional staging mapping:
  `POST /api/transaction-staging/:id/map`
- attach as a new child entry:
  `POST /api/transaction-staging/:id/attach`
- create a new group and child entry:
  `POST /api/transaction-staging/:id/create-ledger-entry`
- verify and reconcile:
  `POST /api/transaction-staging/:id/reconcile`
- discard staging changes:
  `POST /api/transaction-staging/:id/discard`
- soft delete an unmapped staged transaction:
  `DELETE /api/resources/TransactionStaging/:id`
- dashboard: `GET /api/dashboard?year=2026`

Send `x-transaction-id: <uuid>` over HTTP or `transactionId` through MCP to
correlate writes. Updates and deletes require `expectedResourceVersion`.

Mapping staging to an existing child entry immediately updates that entry's
From account, To account, and amount, then marks its group dirty. Reconciliation
later verifies the staged values and commits the group.

Committing a dirty ledger group with its check-mark action reconciles every
provisional staging row linked to its children, applies their exact values,
marks the staging rows Reconciled, changes the group status to Realized, and
commits the entire group atomically.

## Grouped ledger model

The generic envelope is `{ kind, metadata, spec, status, relationships }`.
`metadata.id` is an application-generated stable UUID.

`LedgerEntryGroup` is the visible, chronological ledger row. Its aggregate
money fields are derived from its child ledger entries and account categories:

```json
{
  "kind": "LedgerEntryGroup",
  "spec": {
    "status": "Realized",
    "description": "Office purchase",
    "date": "2026-01-15",
    "note": "Optional"
  },
  "status": {
    "income": "0.00",
    "expense": "400.00",
    "transfers": "0.00",
    "cashDelta": "-400.00",
    "operatingCashFlow": "-400.00",
    "cashOnHand": "-400.00",
    "dirty": true,
    "committedAt": null,
    "deleted": false,
    "previousSpec": null
  },
  "relationships": {
    "ledgerEntryIds": ["40a09ac6-609e-4753-b8c8-577ade524825"]
  }
}
```

A child `LedgerEntry` is one transfer from one account to another:

```json
{
  "kind": "LedgerEntry",
  "spec": { "amount": "400.00" },
  "relationships": {
    "groupId": "f805a53a-cbec-401f-a8bf-a48234935f43",
    "fromAccountId": "00000000-0000-4000-8000-000000000101",
    "toAccountId": "00000000-0000-4000-8000-000000000103"
  }
}
```

Money is a canonical decimal string with exactly two fractional digits and is
stored as integer cents. JSON numeric money is rejected. A group always retains
at least one child entry.

## Accounts and categories

Every account references one category for organization. Category `classification` is one of
`Asset`, `AccountsReceivable`, `AccountsPayable`, `InvestmentAsset`,
`Retirement`, or `Other`.
Accounting boundaries are configured independently on each account with
`spec.internal`. External-to-internal movement is income, internal-to-external
movement is expense, and internal-to-internal or external-to-external movement
is a transfer. Transfer amounts are displayed slightly smaller and italicized.

Account responses publish a derived `status.balance`. The Cash balance includes
the imported opening cash value and all active chronological child transfers,
so it matches the latest ledger group’s `cashOnHand`.

The application seeds:

- Cash
- Misc Accounts Receivable
- Misc Accounts Payable
- Misc Retirement Account
- Investment Assets category

The Accounts tab provides an edit dialog for changing an account title,
category/type, internal-account checkbox, currency, institution, and note.

Existing aggregate ledger rows are migrated in place into groups with child
entries using these defaults. For example, a legacy `$400.00` expense becomes
`Cash -> Misc Accounts Payable` for `$400.00`.

Creates, edits, soft deletes, and restores are immediately visible working
changes on their containing group. Commit acknowledges the group and its child
entries atomically. Revert restores both group metadata and the committed child
entry set. Discover `/api/contract` or MCP `contract-discover` for authoritative
schemas.

Ledger-group and child-entry cells use click-to-edit, blur-to-save inline
editing. Computed aggregate cells are shaded as read-only. Autosaved changes
mark the containing group dirty for Commit/Revert. Account and category cards
provide management controls. Expanded groups can add or delete child entries;
the final child cannot be deleted.

## Transaction staging and reconciliation

Compose reads Merrill activity CSV files from `/data/imports` in the
application's persistent volume. Copy files from the repository's ignored
`data/` directory into that location before restarting the container. Local
Node runs can instead set `TRANSACTION_IMPORT_PATH` directly to the source
directory. Imports are idempotent, and transactions on or before the latest
realized or recognized ledger date are skipped. Zero-dollar transactions are
ignored before source accounts or staging rows are created; previously imported
unmapped zero-dollar rows are retired on startup. Each distinct source account
creates a stable account resource, and imported transaction money is
represented as a non-negative amount with its source account placed on the
appropriate side of the transfer.

An explicit historical import may bypass the realized-date cutoff for a
controlled batch. Startup imports always retain the cutoff.

The importer supports Merrill activity exports and Bank of America aggregate
exports. Merrill rows in aggregate exports are excluded to prevent duplication
with the dedicated Merrill source files.

Imported `TransactionStaging` rows begin clean with status `Unmapped`. They
appear in the right-hand rail with From, To, Amount, Ledger ID, and Status.
Select a staging row, expand a ledger group, and use the link icon on a child
entry to create a dirty `Provisional` mapping. Selecting a provisionally mapped
row expands, scrolls to, and highlights its ledger entry.

When the transaction needs its own child entry, use **Attach selected
transaction** on the target ledger group. The application atomically creates
the child entry from the staging From, To, and Amount fields and makes the
staging mapping provisional.

When no ledger group exists, use **Create ledger entry** directly on the
staging card. It creates a new Realized group using the transaction date and
description, adds the exact From → To child entry, and makes the mapping
provisional for verification.

Verify and reconcile requires concrete, distinct From and To accounts. The
operation atomically applies the staging row's exact amount and account
direction to the mapped child ledger entry, commits its containing group, and
marks the staging row `Reconciled`. Reconciled rows remain available through
the resource API but disappear from the rail. Dirty staging edits and mappings
can be reverted to their last committed baseline.

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
