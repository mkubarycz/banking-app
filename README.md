# Banking App

Banking App 1.2 is a transaction, planning, and account-reconciliation
workspace. It owns its SQLite data, audit/domain events,
HTTP API, MCP server, responsive web UI, and Docker image. Working Memory can
launch it and manipulate the same contract through MCP.

## Run

Node 22 or newer is required.

```sh
npm ci
npm test
npm run typecheck
npm run build
DATABASE_PATH=./banking-app.sqlite npm start
```

Container:

```sh
docker compose build
docker compose up -d
curl http://127.0.0.1:4174/health
open http://127.0.0.1:4174/
```

Compose publishes only `127.0.0.1:4174` and stores SQLite data in the
`working-memory-banking-app-data` volume.

## Model

Every resource uses:

```json
{
  "kind": "Transaction",
  "metadata": {
    "id": "uuid",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "resourceVersion": 1
  },
  "spec": {},
  "status": {},
  "relationships": {}
}
```

The registered resource kinds are:

- **Account** — a node in a user-controlled hierarchy. Both parents and leaves
  may receive transactions. Responses derive `directBalance`,
  `descendantsBalance`, and `totalBalance`.
- **Budget** — a separate planning hierarchy with one Budgeted Value per
  occurrence plus an Income, Expense, or Reinvested flow. Calendar recurrence
  uses RFC 5545-style rules: monthly day lists (including `-1` for the last day)
  or `FREQ=WEEKLY;INTERVAL=2` behavior anchored by a first occurrence. The app
  derives monthly Budgeted totals over the selected start/end dates and rolls
  them through parent Budgets alongside Realized transaction totals. Derived
  `balance` and cumulative `balanceByMonth` values represent disbursements
  minus assigned Transactions.
- **Transaction** — one date, description, positive amount, From account, To
  account, and Budget. There are no split transactions or persisted groups.
- **AccountKnownValue** — a dated observation of one account's balance. A leaf
  observation anchors its direct balance; a parent observation reconciles its
  direct activity together with all descendant balances.
  Account-detail add, correction, and deletion controls stage an atomic Change
  Set. Pending observations appear in the timeline with the standard red
  commit bar; double-clicking only that bar commits them.
- **ChangeSet** — an atomic unit of staged creates, updates, deletes, imports,
  and reconciliation proposals.

Money is represented as a canonical decimal string with exactly two
fractional digits and persisted/calculated as integer cents.

### Classification

Only the Account `internal` boundary has accounting semantics:

- External → Internal: Income
- Internal → External: Expense
- Internal → Internal: Transfer
- External → External: Transfer

### Known values and reconciliation

A committed leaf known value anchors its selected account's direct balance.
For a parent Account, the calculated value includes direct activity plus every
descendant Account, and the anchor applies to that combined total.
The application calculates forward from the latest anchor using committed
transactions. At each known value it publishes:

- observed value
- calculated pre-adjustment value
- virtual unreconciled amount
- severity (`High` when the absolute unreconciled amount is at least $1,000)

The unreconciled amount is display-only and is never persisted as a
transaction. It appears directly on the Accounts hierarchy; `$0.00` is green,
and clicking any amount opens the underlying known value.
Parent account totals combine each account's anchored/calculated direct value
with its descendants.

### Change Sets

Single resource mutations automatically create their own Change Set. For an
atomic multi-resource operation, create one Change Set first and include its ID
as `relationships.changeSetId` on every grouped create or update. Omitting that
relationship creates a separate Change Set. Agents must not commit or discard a
Change Set unless the user explicitly requests that lifecycle operation; normal
work leaves correct changes staged for UI approval.

Interactive resource mutations are staged. Account display ordering and
deterministic source imports apply immediately. The default staged lifecycle is:

`Open → Committed` or `Open → Discarded`

Open Change Sets are prospective: their effective draft resource values drive
Account balances, unreconciled amounts, ledger projections, dashboards, and
Realized Budget totals until the Change Set is committed or discarded. Staging
a metadata-only Transaction edit such as a Budget assignment must never remove
that Transaction from financial calculations.

Commit validates and applies every item atomically. Discard removes newly
created resources and restores the first baseline of updated/deleted resources.
Every write also produces audit and domain events. Updates and deletes require
`expectedResourceVersion` compare-and-swap protection.

## Import and reimport

Set `TRANSACTION_IMPORT_PATH` to a directory containing supported Merrill
activity CSVs and Bank of America aggregate exports. Startup imports are
idempotent. Zero-dollar rows are ignored, Merrill rows in aggregate exports
are excluded, and source fingerprints remain stable.

Imported rows become committed native `Transaction` resources immediately.
Each Transaction retains its source status, type, account, file, and stable
fingerprint. Positive rows flow from external `Uncategorized Income` into the
source account; negative rows flow from the source account to external
`Uncategorized Expense`. All imported rows use the Uncategorized Budget until
they are edited.

The 2026-10-11 account balance snapshot is loaded as committed
`AccountKnownValue` resources. Snapshot accounts without transaction activity
are still created; imported accounts without supplied balances remain
unanchored.

Banking App performs a one-time clean migration from the previous projection
workspace. It removes the old Account, Transaction, Staged Transaction,
projection, and Change Set data before rebuilding Accounts and Transactions
from the current snapshot and source files. Use reset and reimport during
development to reproduce the source-backed data:

```sh
curl -X POST http://127.0.0.1:4174/api/reset
curl -X POST -H 'content-type: application/json' \
  -d '{"reset":false}' http://127.0.0.1:4174/api/reimport
```

`/api/reimport` reads only the server-configured `TRANSACTION_IMPORT_PATH`.

## HTTP and MCP

Discovery:

- `GET /health`
- `GET /api/contract`
- `GET /.well-known/banking-app-contract`
- MCP Streamable HTTP at `/mcp`

Resources:

- `GET|POST /api/resources/:kind`
- `GET|PUT|DELETE /api/resources/:kind/:id`

Workflows:

- `POST /api/change-sets`
- `POST /api/change-sets/:id/commit`
- `POST /api/change-sets/:id/discard`
- `POST /api/reset`
- `POST /api/reimport`
- `GET /api/pending-changes` to list pending resources and fields changed from
  their committed baselines
- `GET|PUT /api/account-order` to read or immediately update Account sibling
  display order without a Change Set
- `GET /api/change-version`
- `GET /api/dashboard?year=2026`

MCP exposes equivalent resource, Change Set, reset, and import tools.
Dragged Transaction references resolve through `resource-get` and change
through `resource-update`. Call `contract-discover` before mutations. Supply
`transactionId` through MCP or `x-transaction-id` over HTTP to correlate
writes.

`GET /api/change-version` is a lightweight host-integration signal. The web UI
polls it and refreshes after MCP or API mutations.

## UI

The UI provides:

- a month-grouped native Transaction list with date, description, source
  provenance, route, classification, and amount
- a consistent pending-change treatment across resource views: an 8px red left
  bar identifies pending rows, red values identify fields that differ from
  committed data, and double-clicking only the red bar commits the associated
  atomic Change Set
- draggable Transactions that emit Working Memory's versioned
  Container App resource-reference JSON with date, description, amount, stable
  app/resource identity, and a loopback deep link
- drag-and-drop Account and Budget trees
- immediate Account ordering stored separately from staged Account resources;
  changing an Account parent remains an atomic Change Set edit
- separate direct, descendant, and total Account balances
- Account detail balance history with a dated timeline, pointer-centered
  mouse-wheel zoom, double-click month zoom, reset, and synchronized
  graph/Transaction highlighting
- stacked balance-history area lines for parent Accounts, showing how direct and
  child-account balances compose and carry the total forward over time, with
  clickable transaction dots linked to activity rows
- parent Account activity tables that include all descendant transactions and
  virtual adjustments, prefixing routes with the participating child Account;
  every Account in a route links to its Account detail page
- draggable Account rows that emit the same versioned Working Memory resource
  reference payload and deep link as draggable Transactions
- Account-detail known-value add/edit dialogs, including deletion and virtual
  adjustment notes that show the observed amount and date
- perfect-reconciliation badges on the latest transaction at or before a
  fully reconciled known value, with a green balance and direct access to the
  known-value editor
- a signed, clickable Unreconciled column on the Accounts hierarchy, with
  green `$0.00` balances and observed/ledger/date details on hover
- paste-friendly date fields that normalize common US, ISO, and month-name
  dates to the canonical `YYYY-MM-DD` format before submission
- calendar-derived monthly Budgeted and Realized Budget rollups
- Account-style Budget detail pages with Back navigation, autosaved inline
  recurrence editing, pending-change highlighting and Commit actions, and
  descendant-aware Transaction tables
- full-calendar-year Budget balance charts where recurrence disbursements add
  funds, assigned Transactions subtract funds, and every dated event is a dot
- a default five-day Settled balance view that nets short-lived disbursement
  spikes while retaining a Raw balance toggle and both values in event tooltips
- an explicit zero-balance reference line and future Estimated payment events
  equal to each remaining scheduled Budget occurrence
- Budget Transaction tables with the balance immediately after each row
- shared Account/Budget timeline interactions: wheel zoom, month zoom on
  double-click, reset controls, and transaction-dot hover/click highlighting
- month-grouped Transaction views with the assigned Budget in the grid and a
  title-click Transaction details popout for editing Date, Description, Amount,
  From Account, To Account, and Budget
- searchable account and budget mapping inputs
- dated known-value entry and virtual unreconciled-amount review
- an always-visible Change Set approval/discard rail

Persisted transaction groups and Account Categories no longer exist.
