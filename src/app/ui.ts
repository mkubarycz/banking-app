export const bankingUi = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Banking App</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fa;
      --panel: #ffffff;
      --panel-2: #f0f3f7;
      --line: #d8dee7;
      --text: #1f2937;
      --muted: #64748b;
      --accent: #2563eb;
      --good: #16835b;
      --warn: #a95c0b;
      --bad: #c93434;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); padding: 7px 11px; cursor: pointer; }
    button:hover { border-color: var(--accent); }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.danger { color: var(--bad); }
    input, select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); padding: 7px 9px; }
    header { position: sticky; top: 0; z-index: 5; display: flex; align-items: stretch; gap: 8px; height: 42px; padding: 0 12px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.97); }
    header h1 { display: flex; align-items: center; margin: 0; padding-right: 10px; border-right: 1px solid var(--line); color: var(--muted); font-size: 12px; font-weight: 650; white-space: nowrap; }
    .embedded header h1 { display: none; }
    nav { display: flex; align-items: stretch; gap: 1px; }
    nav button { padding: 0 10px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted); font-size: 12px; font-weight: 650; }
    nav button:hover { background: var(--panel-2); border-bottom-color: #9db8f5; }
    nav button.active { color: var(--accent); background: transparent; border-bottom-color: var(--accent); }
    #sync { margin-left: auto; color: var(--muted); font-size: 12px; }
    #sync { display: flex; align-items: center; }
    main { width: 100%; min-width: 0; height: calc(100vh - 42px); min-height: 0; }
    #workspace { min-width: 0; padding: 20px; overflow: auto; }
    .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 15px; }
    .toolbar h2 { margin: 0 auto 0 0; font-size: 18px; }
    .search { max-width: 280px; }
    .card { border: 1px solid var(--line); border-radius: 9px; background: var(--panel); margin-bottom: 10px; overflow: hidden; }
    .tree-row, .table-row { display: grid; align-items: center; gap: 12px; min-height: 44px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
    .tree-row:last-child, .table-row:last-child { border-bottom: 0; }
    .tree-row { grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(110px, 140px)); }
    .account-tree-row { grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(90px, 120px)) minmax(120px, 150px); }
    .tree-row[draggable="true"] { cursor: grab; }
    .tree-row.drag-inside { outline: 2px solid var(--accent); outline-offset: -2px; }
    .tree-row.drag-before { box-shadow: inset 0 3px 0 var(--accent); }
    .tree-row.drag-after { box-shadow: inset 0 -3px 0 var(--accent); }
    .tree-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .tree-name span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account-link { min-width: 0; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; font-weight: 650; }
    .account-link:hover { color: var(--accent); }
    .budget-link { min-width: 0; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; font: inherit; }
    .budget-link:hover, .budget-link:focus-visible { color: var(--accent); text-decoration: underline; }
    .account-route-link { padding: 0; border: 0; background: transparent; color: var(--accent); text-align: left; }
    .account-route-link:hover, .account-route-link:focus-visible { text-decoration: underline; }
    .indent { display: inline-block; flex: 0 0 auto; }
    .money { font-variant-numeric: tabular-nums; text-align: right; }
    .muted { color: var(--muted); }
    .tag { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 2px 7px; color: var(--muted); font-size: 11px; }
    .tag.draft { color: var(--warn); }
    .tag.high { color: var(--bad); border-color: var(--bad); }
    .unreconciled-link { justify-self: end; padding: 2px 7px; border: 1px solid var(--bad); border-radius: 999px; background: #fff5f5; color: var(--bad); font-variant-numeric: tabular-nums; }
    .unreconciled-link.balanced { border-color: var(--good); background: #effaf5; color: var(--good); }
    .unreconciled-link:hover, .unreconciled-link:focus-visible { text-decoration: underline; }
    .pending-change { position: relative; box-shadow: inset 8px 0 var(--bad); }
    .changed-value { color: var(--bad) !important; }
    .pending-commit-bar { position: absolute; z-index: 2; left: 0; top: 0; bottom: 0; width: 8px; padding: 0; border: 0; border-radius: 0; background: var(--bad); cursor: pointer; }
    .pending-commit-bar:hover, .pending-commit-bar:focus-visible { background: #b91c1c; outline: 2px solid #b91c1c; outline-offset: 1px; }
    .month { margin: 20px 0 8px; color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .transaction { grid-template-columns: 95px minmax(220px, 1fr) 120px 120px 100px 100px; }
    .transaction-title { display: block; min-width: 0; padding: 0; overflow: hidden; border: 0; background: transparent; color: inherit; text-align: left; text-overflow: ellipsis; }
    .transaction-title:hover, .transaction-title:focus-visible { color: var(--accent); text-decoration: underline; }
    .transaction-source { display: block; color: var(--muted); font-size: 11px; }
    .account-detail-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .account-title-input { min-width: 220px; max-width: 520px; padding: 3px 7px; border-color: transparent; background: transparent; font-size: 22px; font-weight: 750; }
    .account-title-input:hover, .account-title-input:focus { border-color: var(--line); background: #fff; }
    .account-detail-header .commit-account { margin-left: auto; background: var(--bad); border-color: var(--bad); color: #fff; font-weight: 700; }
    .budget-detail-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .budget-detail-header .commit-budget { margin-left: auto; background: var(--bad); border-color: var(--bad); color: #fff; font-weight: 700; }
    .budget-detail-form { display: contents; }
    .budget-meta { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 10px 14px; margin-bottom: 12px; padding: 14px; }
    .budget-meta .field { margin: 0; }
    .budget-detail-error { grid-column: 1 / -1; }
    .account-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 9px 18px; padding: 10px 12px; margin-bottom: 12px; }
    .account-meta label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
    .account-meta input[type="text"] { width: 180px; padding: 4px 7px; color: var(--text); }
    .account-meta .currency-input { width: 62px; text-transform: uppercase; }
    .account-meta-link { padding: 0; border: 0; background: transparent; color: var(--accent); }
    .account-meta-link:hover { text-decoration: underline; }
    .account-inline-editor { flex: 1 1 100%; display: flex; align-items: start; gap: 8px; }
    .account-inline-editor textarea { min-height: 72px; }
    .account-history h3 { margin: 0 0 12px; font-size: 15px; }
    .account-summary { display: grid; grid-template-columns: repeat(3, minmax(100px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .account-summary div { padding: 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel-2); }
    .account-summary small { display: block; color: var(--muted); }
    .account-summary strong { display: block; margin-top: 3px; font-variant-numeric: tabular-nums; }
    .balance-chart { position: relative; padding: 12px; }
    .balance-chart-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .balance-chart svg { display: block; width: 100%; height: 280px; overflow: visible; }
    .balance-chart svg { cursor: zoom-in; }
    .chart-line { fill: none; stroke: var(--accent); stroke-width: 2; }
    .chart-area { stroke-width: 1.5; stroke-linejoin: round; }
    .chart-grid { stroke: var(--line); stroke-width: 1; }
    .chart-axis { stroke: var(--muted); stroke-width: 1; }
    .chart-tick { stroke: var(--muted); stroke-width: 1; }
    .chart-label { fill: var(--muted); font-size: 11px; text-anchor: middle; }
    .budget-zero-line { stroke: var(--text); stroke-width: 1.5; stroke-dasharray: 5 4; }
    .budget-zero-label { fill: var(--text); font-size: 11px; font-weight: 700; text-anchor: end; }
    .chart-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 4px 0 0; color: var(--muted); font-size: 11px; }
    .chart-legend span::before { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 2px; background: var(--series-color); content: ""; }
    .chart-dot { fill: var(--accent); stroke: #fff; stroke-width: 2; cursor: pointer; transition: r .12s, stroke-width .12s; }
    .chart-dot.virtual.safe { fill: var(--good); }
    .chart-dot.virtual.danger { fill: #d97706; }
    .chart-dot.active { r: 7; stroke: var(--text); stroke-width: 3; }
    .budget-chart-dot { stroke: #fff; stroke-width: 2; }
    .budget-chart-dot.budget-disbursement { fill: #7c3aed; }
    .budget-chart-dot.budget-transaction-dot { fill: var(--good); }
    .budget-chart-dot.budget-estimate { fill: #d97706; }
    .account-event { grid-template-columns: 95px minmax(230px, 1fr) minmax(210px, max-content) 120px 120px; }
    .account-events-card { max-width: 100%; overflow-x: auto; }
    .account-events-table { min-width: 840px; }
    .budget-transaction { grid-template-columns: 95px minmax(230px, 1fr) minmax(220px, max-content) 140px 120px 120px; }
    .budget-transactions-card { max-width: 100%; overflow-x: auto; }
    .budget-transactions-table { min-width: 980px; }
    .account-event.virtual.safe { border-left: 5px solid var(--good); background: #effaf5; }
    .account-event.virtual.danger { border-left: 5px solid #d97706; background: #fff7ed; }
    .account-event.active, .budget-transaction.active { outline: 2px solid var(--accent); outline-offset: -2px; background: #eff6ff; }
    .account-event.virtual.danger.active { outline-color: #d97706; background: #ffedd5; }
    .virtual-title-link { border: 0; background: none; padding: 0; color: inherit; font: inherit; font-weight: 700; }
    .virtual-title-link:hover, .virtual-title-link:focus-visible { color: var(--accent); text-decoration: underline; }
    .chart-dot.pending { fill: var(--bad); }
    .perfect-reconciliation-badge { margin-left: 7px; border: 1px solid var(--good); border-radius: 999px; background: #effaf5; color: var(--good); padding: 2px 7px; font-size: 11px; font-weight: 700; }
    .perfect-reconciliation-badge:hover, .perfect-reconciliation-badge:focus-visible { background: #dff5e9; }
    .perfect-balance { color: var(--good); font-weight: 700; }
    .linked-staging { display: inline-flex; align-items: center; justify-content: center; color: var(--accent); cursor: help; }
    .resource-highlight { outline: 2px solid var(--accent); outline-offset: -2px; animation: resource-pulse 1.6s ease-out; }
    @keyframes resource-pulse { from { background: rgba(99,197,218,.28); } to { background: transparent; } }
    .empty { padding: 32px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 9px; }
    dialog { width: min(520px, calc(100vw - 30px)); border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--text); padding: 0; }
    dialog::backdrop { background: rgba(31,41,55,.35); }
    dialog form { padding: 18px; }
    dialog h2 { margin: 0 0 15px; font-size: 18px; }
    .field { margin-bottom: 12px; }
    .field label { display: block; color: var(--muted); margin-bottom: 4px; font-size: 12px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .dialog-actions .delete-record { margin-right: auto; color: var(--bad); }
    .error { color: var(--bad); }
    @media (max-width: 900px) {
      .tree-row { grid-template-columns: minmax(180px, 1fr) repeat(2, 100px); }
      .account-tree-row { grid-template-columns: minmax(180px, 1fr) repeat(3, 90px) 130px; }
      .tree-row .row-actions { display: none; }
      .account-event { grid-template-columns: 90px minmax(180px, 1fr) 110px 110px; }
      .account-event > :nth-child(3) { display: none; }
      .budget-meta { grid-template-columns: 1fr 1fr; }
      .budget-transaction { grid-template-columns: 90px minmax(180px, 1fr) 110px 110px 110px; }
      .budget-transaction > :nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Banking App <span class="tag">1.2</span></h1>
    <nav id="tabs">
      <button data-tab="transactions" class="active">Transactions</button>
      <button data-tab="accounts">Accounts</button>
      <button data-tab="budgets">Budgets</button>
    </nav>
    <span id="sync">Loading...</span>
  </header>
  <main>
    <section id="workspace"></section>
  </main>
  <dialog id="editor"></dialog>
  <datalist id="accountOptions"></datalist>
  <datalist id="budgetOptions"></datalist>
  <script>
    document.documentElement.classList.toggle('embedded', window.parent !== window);
    const ACTIVE_TAB_STORAGE_KEY = 'banking-app.active-tab';
    const state = {
      tab: restoreActiveTab(),
      search: '',
      accounts: [],
      budgets: [],
      transactions: [],
      knownValues: [],
      accountOrder: [],
      pendingChanges: [],
      changeVersion: -1,
      deepLinkApplied: false,
      selectedAccountId: null,
      selectedBudgetId: null,
      accountParentEditing: false,
      accountNoteEditing: false,
      timelineChartView: null,
      budgetBalanceMode: 'settled',
    };

    const workspace = document.querySelector('#workspace');
    const editor = document.querySelector('#editor');
    const sync = document.querySelector('#sync');
    document.querySelectorAll('[data-tab]').forEach(
      (item) => item.classList.toggle('active', item.dataset.tab === state.tab),
    );

    document.querySelector('#tabs').addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      state.tab = button.dataset.tab;
      if (state.tab !== 'accounts') state.selectedAccountId = null;
      if (state.tab !== 'budgets') state.selectedBudgetId = null;
      state.timelineChartView = null;
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, state.tab);
      document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
      render();
    });

    async function api(path, options = {}) {
      const response = await fetch(path, {
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        ...options,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Request failed.');
      return payload.result;
    }

    async function load() {
      sync.textContent = 'Refreshing...';
      try {
        const kinds = ['Account', 'Budget', 'Transaction', 'AccountKnownValue'];
        const values = await Promise.all([
          ...kinds.map((kind) => api('/api/resources/' + kind)),
          api('/api/pending-changes'),
          api('/api/account-order'),
        ]);
        [state.accounts, state.budgets, state.transactions, state.knownValues] = values;
        state.pendingChanges = values[4];
        state.accountOrder = values[5];
        fillDataLists();
        if (!applyDeepLink()) render();
        sync.textContent = 'Up to date';
        sync.className = '';
      } catch (error) {
        sync.textContent = error.message;
        sync.className = 'error';
      }
    }

    function applyDeepLink() {
      if (state.deepLinkApplied) return false;
      state.deepLinkApplied = true;
      const params = new URLSearchParams(location.search);
      const resourceKind = params.get('resource');
      const resourceId = params.get('id');
      if (!resourceKind || !resourceId) return false;
      const tabs = {
        Account: 'accounts',
        Budget: 'budgets',
        Transaction: 'transactions',
        AccountKnownValue: 'accounts',
      };
      state.tab = tabs[resourceKind] || state.tab;
      if (resourceKind === 'Account') state.selectedAccountId = resourceId;
      if (resourceKind === 'Budget') state.selectedBudgetId = resourceId;
      if (resourceKind === 'AccountKnownValue') {
        state.selectedAccountId = state.knownValues.find(
          (item) => item.metadata.id === resourceId,
        )?.relationships.accountId || null;
      }
      document.querySelectorAll('[data-tab]').forEach(
        (button) => button.classList.toggle('active', button.dataset.tab === state.tab),
      );
      render();
      requestAnimationFrame(() => {
        const selector = '[data-resource-kind="' + CSS.escape(resourceKind)
          + '"][data-resource-id="' + CSS.escape(resourceId) + '"]';
        const target = document.querySelector(selector);
        target?.scrollIntoView({ block: 'center' });
        target?.classList.add('resource-highlight');
      });
      return true;
    }

    function render() {
      const renderers = {
        accounts: renderAccounts,
        budgets: renderBudgets,
        transactions: renderTransactions,
      };
      workspace.innerHTML = renderers[state.tab]();
      wireWorkspace();
    }

    function toolbar(title, actionLabel, action) {
      return '<div class="toolbar"><h2>' + escapeHtml(title) + '</h2>'
        + '<input class="search" id="search" placeholder="Search" value="' + escapeHtml(state.search) + '">'
        + (actionLabel ? '<button class="primary" data-action="' + action + '">' + escapeHtml(actionLabel) + '</button>' : '')
        + '</div>';
    }

    function renderAccounts() {
      const selected = state.accounts.find((item) => item.metadata.id === state.selectedAccountId);
      if (selected) return renderAccountDetail(selected);
      const rows = treeRows(state.accounts, 'parentAccountId').filter(matchesSearch);
      return toolbar('Account hierarchy', 'Add account', 'add-account')
        + '<div class="card">'
        + '<div class="tree-row account-tree-row muted">'
        + ['Account', 'Direct', 'Descendants', 'Total', 'Unreconciled'].map((label) => '<strong>' + label + '</strong>').join('')
        + '</div>'
        + rows.map(({ item, depth }) => {
          const latestKnownValue = latestKnownValueForAccount(item.metadata.id);
          const unreconciledAmount = Number(latestKnownValue?.status.unreconciledAmount || 0);
          const unreconciled = latestKnownValue
            ? '<button type="button" class="unreconciled-link'
              + (unreconciledAmount === 0 ? ' balanced' : '') + '" data-action="edit-known-value"'
              + ' data-id="' + latestKnownValue.metadata.id + '"'
              + ' title="Observed ' + escapeHtml(formatMoney(latestKnownValue.spec.value))
              + '; ledger ' + escapeHtml(formatMoney(latestKnownValue.status.calculatedValue))
              + '; as of ' + escapeHtml(latestKnownValue.spec.date) + '">'
              + escapeHtml(formatMoney(unreconciledAmount)) + '</button>'
            : '<span class="money muted">—</span>';
          return '<div class="tree-row account-tree-row' + pendingClass(item) + '" draggable="true" data-kind="Account" data-id="' + item.metadata.id
            + '" data-app-resource-kind="Account" data-app-resource-id="' + item.metadata.id + '"'
            + ' data-app-resource-title="' + escapeHtml(item.spec.name) + '"'
            + ' data-app-resource-description="' + escapeHtml(item.spec.name) + '"'
            + ' data-app-resource-amount="' + escapeHtml(formatMoney(item.status.totalBalance)) + '"'
            + ' data-resource-kind="Account" data-resource-id="' + item.metadata.id + '">'
            + pendingCommitBar(item)
            + '<div class="tree-name"><span class="indent" style="width:' + (depth * 20) + 'px"></span>'
            + '<button type="button" class="account-link" data-action="account-detail" data-id="' + item.metadata.id + '">'
            + '<span class="' + changedClass(item, ['spec.name', 'relationships.parentAccountId']) + '">' + escapeHtml(item.spec.name) + '</span>'
            + '</button></div>'
            + moneyCell(item.status.directBalance)
            + moneyCell(item.status.descendantsBalance)
            + moneyCell(item.status.totalBalance)
            + unreconciled
            + '</div>';
        }).join('')
        + '</div><p class="muted">Drag near a row edge to reorder it, onto the row center to make it a child, or onto empty space to move it to the end of the root.</p>';
    }

    function latestKnownValueForAccount(accountId) {
      return state.knownValues
        .filter((item) => item.status.state === 'Committed' && item.relationships.accountId === accountId)
        .sort((left, right) => String(left.spec.date).localeCompare(String(right.spec.date))
          || left.metadata.id.localeCompare(right.metadata.id))
        .at(-1);
    }

    function renderAccountDetail(account) {
      const events = accountTimeline(account);
      const change = pendingChange(account);
      return '<div class="account-detail-header"><button type="button" data-action="account-back">← Accounts</button>'
        + '<input class="account-title-input ' + changedClass(account, ['spec.name']) + '"'
        + ' data-account-field="name" value="' + escapeHtml(account.spec.name) + '" aria-label="Account name">'
        + (change ? '<button type="button" class="commit-account" data-action="commit-account">Commit</button>' : '')
        + '</div><div class="card account-meta">'
        + '<label>Institution <input type="text" data-account-field="institution" value="' + escapeHtml(account.spec.institution || '') + '"></label>'
        + '<label>Currency <input class="currency-input" type="text" maxlength="3" data-account-field="currency" value="' + escapeHtml(account.spec.currency) + '"></label>'
        + '<label><input style="width:auto" type="checkbox" data-account-field="internal"'
        + (account.spec.internal ? ' checked' : '') + '> Internal account</label>'
        + (state.accountParentEditing
          ? '<label class="account-inline-editor">Parent <input id="account-parent-inline" list="accountOptions" value="'
            + escapeHtml(accountName(account.relationships.parentAccountId)) + '" placeholder="No parent"></label>'
          : '<button type="button" class="account-meta-link" data-action="edit-account-parent">Parent: '
            + escapeHtml(accountName(account.relationships.parentAccountId) || 'None') + '</button>')
        + (state.accountNoteEditing
          ? '<label class="account-inline-editor">Notes <textarea id="account-note-inline" rows="3">'
            + escapeHtml(account.spec.note || '') + '</textarea></label>'
          : '<button type="button" class="account-meta-link" data-action="edit-account-note">'
            + (account.spec.note ? 'Edit notes' : 'Add notes') + '</button>')
        + '<button type="button" class="account-meta-link" data-action="known-value" data-id="'
        + account.metadata.id + '">Add known value</button>'
        + '</div><div class="account-summary">'
        + summaryValue('Direct balance', account.status.directBalance)
        + summaryValue('Descendants', account.status.descendantsBalance)
        + summaryValue('Total balance', account.status.totalBalance)
        + '</div><div class="account-history"><div class="card balance-chart">'
        + balanceChart(account, events) + '</div>'
        + '<div class="card account-events-card"><div class="account-events-table">'
        + '<div class="table-row account-event muted"><strong>Date</strong><strong>Transaction</strong>'
        + '<strong>Route</strong><strong class="money">Change</strong><strong class="money">Balance</strong></div>'
        + accountEventRows(events) + '</div></div></div>';
    }

    function summaryValue(label, value) {
      return '<div><small>' + escapeHtml(label) + '</small><strong>' + formatMoney(value) + '</strong></div>';
    }

    function accountTimeline(account, includeDescendants = true) {
      const accountIds = new Set(includeDescendants
        ? accountSubtreeIds(account.metadata.id)
        : [account.metadata.id]);
      const hierarchical = accountIds.size > 1;
      const transactions = state.transactions
        .filter((item) => item.status.deleted !== true
          && (accountIds.has(item.relationships.fromAccountId)
            || accountIds.has(item.relationships.toAccountId)))
        .map((item) => {
          const fromInside = accountIds.has(item.relationships.fromAccountId);
          const toInside = accountIds.has(item.relationships.toAccountId);
          const participatingAccountId = fromInside
            ? item.relationships.fromAccountId
            : item.relationships.toAccountId;
          const counterpartyId = fromInside
            ? item.relationships.toAccountId
            : item.relationships.fromAccountId;
          const route = hierarchical && participatingAccountId !== account.metadata.id
            ? accountName(participatingAccountId) + (fromInside ? ' → ' : ' ← ') + accountName(counterpartyId)
            : accountName(counterpartyId);
          const routeParts = hierarchical && participatingAccountId !== account.metadata.id
            ? [
                { accountId: participatingAccountId, label: accountName(participatingAccountId) },
                fromInside ? ' → ' : ' ← ',
                { accountId: counterpartyId, label: accountName(counterpartyId) },
              ]
            : [{ accountId: counterpartyId, label: accountName(counterpartyId) }];
          return {
            id: 'transaction-' + item.metadata.id,
            resourceId: item.metadata.id,
            date: item.spec.date,
            description: item.spec.description,
            route,
            routeParts,
            amount: fromInside && toInside ? 0 : (toInside ? 1 : -1) * Number(item.spec.amount),
            virtual: false,
          };
        });
      const virtual = state.knownValues
        .filter((item) => accountIds.has(item.relationships.accountId)
          && (item.status.state === 'Draft' || Number(item.status.unreconciledAmount) !== 0))
        .map((item) => {
          const descendant = hierarchical && item.relationships.accountId !== account.metadata.id;
          return {
            id: 'virtual-' + item.metadata.id,
            resourceId: item.metadata.id,
            date: item.spec.date,
            description: 'Virtual reconciliation adjustment',
            route: descendant
              ? accountName(item.relationships.accountId) + ' → Known balance'
              : 'Known balance',
            routeParts: descendant
              ? [
                  { accountId: item.relationships.accountId, label: accountName(item.relationships.accountId) },
                  ' → Known balance',
                ]
              : ['Known balance'],
            amount: Number(item.status.unreconciledAmount),
            virtual: true,
            knownValue: item,
            pending: Boolean(pendingChange(item)),
            danger: Math.abs(Number(item.status.unreconciledAmount)) >= 1000,
          };
        });
      const events = [...transactions, ...virtual].sort((left, right) =>
        String(left.date).localeCompare(String(right.date))
        || Number(left.virtual) - Number(right.virtual)
        || left.id.localeCompare(right.id));
      let balance = 0;
      const timeline = events.map((event) => {
        balance += event.amount;
        return { ...event, balance };
      });
      const perfectKnownValues = state.knownValues.filter((item) =>
        item.status.state === 'Committed'
        && accountIds.has(item.relationships.accountId)
        && Number(item.status.unreconciledAmount) === 0);
      for (const knownValue of perfectKnownValues) {
        const matched = [...timeline].reverse().find((event) =>
          !event.virtual && String(event.date) <= String(knownValue.spec.date));
        if (matched) {
          matched.perfectKnownValues = [...(matched.perfectKnownValues || []), knownValue];
        }
      }
      return timeline;
    }

    function balanceChart(account, events) {
      const children = state.accounts.filter((item) => item.relationships.parentAccountId === account.metadata.id);
      if (children.length) return stackedLineChart(account, events, children);
      if (!events.length) return empty('No transactions or reconciliation adjustments for this account.');
      const width = 900;
      const height = 280;
      const padding = 34;
      const plotBottom = 225;
      const fullStart = chartDate(events[0].date);
      const fullEnd = Math.max(chartDate(events.at(-1).date), fullStart + 86400000);
      const chartKey = 'Account:' + account.metadata.id;
      const view = timelineChartViewport(chartKey, fullStart, fullEnd);
      const start = Math.max(fullStart, view.start);
      const end = Math.min(fullEnd, view.end);
      const visible = events.filter((event) => {
        const time = chartDate(event.date);
        return time >= start && time <= end;
      });
      const values = [0, ...visible.map((event) => event.balance)];
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      const x = (time) => padding + (time - start) * (width - padding * 2) / Math.max(end - start, 1);
      const y = (value) => padding + (max - value) * (plotBottom - padding) / range;
      const points = visible.map((event) => x(chartDate(event.date)) + ',' + y(event.balance)).join(' ');
      const zeroY = y(0);
      const ticks = chartTimelineTicks(start, end, 7);
      return '<div class="balance-chart-header"><h3>Balance history</h3>'
        + timelineChartResetButton(chartKey)
        + '</div><svg class="account-balance-chart timeline-chart" viewBox="0 0 ' + width + ' ' + height + '"'
        + ' data-chart-key="' + chartKey + '" data-chart-padding="' + padding + '" data-chart-min-span="' + (7 * 86400000) + '"'
        + ' data-chart-start="' + start + '" data-chart-end="' + end + '"'
        + ' data-chart-full-start="' + fullStart + '" data-chart-full-end="' + fullEnd + '"'
        + ' role="img" aria-label="Account balance over time">'
        + '<line class="chart-grid" x1="' + padding + '" y1="' + zeroY + '" x2="' + (width - padding) + '" y2="' + zeroY + '"></line>'
        + '<line class="chart-axis" x1="' + padding + '" y1="' + plotBottom + '" x2="' + (width - padding) + '" y2="' + plotBottom + '"></line>'
        + ticks.map((tick) => '<line class="chart-tick" x1="' + x(tick.time) + '" y1="' + plotBottom
          + '" x2="' + x(tick.time) + '" y2="' + (plotBottom + 6) + '"></line>'
          + '<text class="chart-label" x="' + x(tick.time) + '" y="' + (plotBottom + 21) + '">'
          + escapeHtml(tick.label) + '</text>').join('')
        + (points ? '<polyline class="chart-line" points="' + points + '"></polyline>' : '')
        + visible.map((event) => '<circle class="chart-dot' + (event.virtual ? ' virtual ' + (event.danger ? 'danger' : 'safe')
          + (event.pending ? ' pending' : '') : '')
          + '" cx="' + x(chartDate(event.date)) + '" cy="' + y(event.balance) + '" r="4" tabindex="0"'
          + ' data-timeline-event-id="' + escapeHtml(event.id) + '"><title>'
          + escapeHtml(event.date + ' · ' + event.description + ' · ' + formatMoney(event.amount)
            + ' · Balance ' + formatMoney(event.balance)) + '</title></circle>').join('')
        + '</svg><p class="muted">Scroll over the timeline to zoom. Double-click a date to zoom into that month. Each dot is a Transaction; virtual adjustments are green below $1,000 and orange at $1,000 or more.</p>';
    }

    function stackedLineChart(account, aggregateEvents, children) {
      const colors = ['#2563eb', '#16835b', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#64748b'];
      const series = [
        {
          id: account.metadata.id,
          name: 'Direct / reconciliation',
          events: accountTimeline(account, false),
        },
        ...children.map((child) => ({
          id: child.metadata.id,
          name: child.spec.name,
          events: accountTimeline(child, true),
        })),
      ].filter((item) => item.events.length);
      if (!series.length) return empty('No transactions or reconciliation adjustments for this account hierarchy.');
      const dates = [...new Set(series.flatMap((item) => item.events.map((event) => event.date)))].sort();
      const running = new Map(series.map((item) => [item.id, 0]));
      const snapshots = dates.map((date) => {
        for (const item of series) {
          const change = item.events
            .filter((event) => event.date === date)
            .reduce((sum, event) => sum + event.amount, 0);
          running.set(item.id, (running.get(item.id) || 0) + change);
        }
        return { date, values: series.map((item) => running.get(item.id) || 0) };
      });
      const width = 900;
      const height = 280;
      const padding = 34;
      const plotBottom = 225;
      const fullStart = chartDate(dates[0]);
      const fullEnd = Math.max(chartDate(dates.at(-1)) + 86400000, fullStart + 86400000);
      const chartKey = 'Account:' + account.metadata.id;
      const view = timelineChartViewport(chartKey, fullStart, fullEnd);
      const start = Math.max(fullStart, view.start);
      const end = Math.min(fullEnd, view.end);
      const intervals = snapshots.map((snapshot, index) => ({
        ...snapshot,
        start: chartDate(snapshot.date),
        end: index + 1 < snapshots.length ? chartDate(snapshots[index + 1].date) : fullEnd,
      }));
      const visible = intervals.filter((interval) => interval.end >= start && interval.start <= end);
      const positiveMax = Math.max(1, ...visible.map((snapshot) =>
        snapshot.values.reduce((sum, value) => sum + Math.max(0, value), 0)));
      const negativeMin = Math.min(0, ...visible.map((snapshot) =>
        snapshot.values.reduce((sum, value) => sum + Math.min(0, value), 0)));
      const range = positiveMax - negativeMin || 1;
      const x = (time) => padding + (time - start) * (width - padding * 2) / Math.max(end - start, 1);
      const y = (value) => padding + (positiveMax - value) * (plotBottom - padding) / range;
      const ticks = chartTimelineTicks(start, end, 7);
      const layers = series.map((item, seriesIndex) => {
        let positive = 0;
        let negative = 0;
        return {
          item,
          color: colors[seriesIndex % colors.length],
          points: visible.map((interval) => {
            positive = 0;
            negative = 0;
            for (let index = 0; index < seriesIndex; index += 1) {
              const value = interval.values[index];
              if (value >= 0) positive += value;
              else negative += value;
            }
            const value = interval.values[seriesIndex];
            const lower = value >= 0 ? positive : negative;
            return { start: interval.start, end: interval.end, lower, upper: lower + value };
          }),
        };
      });
      return '<div class="balance-chart-header"><h3>Balance history by child account</h3>'
        + timelineChartResetButton(chartKey)
        + '</div><svg class="account-balance-chart timeline-chart" viewBox="0 0 ' + width + ' ' + height + '"'
        + ' data-chart-key="' + chartKey + '" data-chart-padding="' + padding + '" data-chart-min-span="' + (7 * 86400000) + '"'
        + ' data-chart-start="' + start + '" data-chart-end="' + end + '"'
        + ' data-chart-full-start="' + fullStart + '" data-chart-full-end="' + fullEnd + '"'
        + ' role="img" aria-label="Stacked line account balance history">'
        + '<line class="chart-grid" x1="' + padding + '" y1="' + y(0) + '" x2="' + (width - padding)
        + '" y2="' + y(0) + '"></line>'
        + '<line class="chart-axis" x1="' + padding + '" y1="' + plotBottom + '" x2="' + (width - padding)
        + '" y2="' + plotBottom + '"></line>'
        + ticks.map((tick) => '<line class="chart-tick" x1="' + x(tick.time) + '" y1="' + plotBottom
          + '" x2="' + x(tick.time) + '" y2="' + (plotBottom + 6) + '"></line>'
          + '<text class="chart-label" x="' + x(tick.time) + '" y="' + (plotBottom + 21) + '">'
          + escapeHtml(tick.label) + '</text>').join('')
        + layers.map((layer) => '<path class="chart-area" d="'
          + stackedAreaPath(layer.points, start, end, x, y) + '" fill="' + layer.color
          + '" fill-opacity="0.24" stroke="' + layer.color + '"><title>'
          + escapeHtml(layer.item.name) + '</title></path>').join('')
        + aggregateEvents.filter((event) => {
          const time = chartDate(event.date);
          return time >= start && time <= end;
        }).map((event) => '<circle class="chart-dot'
          + (event.virtual ? ' virtual ' + (event.danger ? 'danger' : 'safe')
            + (event.pending ? ' pending' : '') : '')
          + '" cx="' + x(chartDate(event.date)) + '" cy="' + y(event.balance) + '" r="4" tabindex="0"'
          + ' data-timeline-event-id="' + escapeHtml(event.id) + '"><title>'
          + escapeHtml(event.date + ' · ' + event.description + ' · ' + formatMoney(event.amount)
            + ' · Balance ' + formatMoney(event.balance)) + '</title></circle>').join('')
        + '</svg><div class="chart-legend">'
        + series.map((item, index) => '<span style="--series-color:' + colors[index % colors.length] + '">'
          + escapeHtml(item.name) + '</span>').join('')
        + '</div><p class="muted">Each stacked line carries its balance forward until the next event. Dots link to transactions and reconciliation entries. Scroll to zoom; double-click a date to zoom into that month.</p>';
    }

    function stackedAreaPath(points, start, end, x, y) {
      if (!points.length) return '';
      const clipped = points.map((point) => ({
        ...point,
        start: Math.max(point.start, start),
        end: Math.min(point.end, end),
      }));
      let path = 'M ' + x(clipped[0].start) + ' ' + y(clipped[0].upper);
      for (const point of clipped) {
        path += ' L ' + x(point.start) + ' ' + y(point.upper)
          + ' L ' + x(point.end) + ' ' + y(point.upper);
      }
      const last = clipped.at(-1);
      path += ' L ' + x(last.end) + ' ' + y(last.lower);
      for (const point of [...clipped].reverse()) {
        path += ' L ' + x(point.end) + ' ' + y(point.lower)
          + ' L ' + x(point.start) + ' ' + y(point.lower);
      }
      return path + ' Z';
    }

    function accountSubtreeIds(accountId) {
      return [accountId, ...state.accounts
        .filter((item) => item.relationships.parentAccountId === accountId)
        .flatMap((item) => accountSubtreeIds(item.metadata.id))];
    }

    function chartDate(date) {
      return Date.parse(date + 'T00:00:00Z');
    }

    function timelineChartViewport(key, fullStart, fullEnd) {
      return state.timelineChartView?.key === key
        ? state.timelineChartView
        : { start: fullStart, end: fullEnd };
    }

    function timelineChartResetButton(key) {
      return state.timelineChartView?.key === key
        ? '<button type="button" data-action="reset-timeline-chart">Reset zoom</button>'
        : '';
    }

    function chartPointsInView(points, start, end) {
      const before = [...points].reverse().find((point) => point.time < start);
      const after = points.find((point) => point.time > end);
      return [
        ...(before ? [{ ...before, time: start, boundary: true }] : []),
        ...points.filter((point) => point.time >= start && point.time <= end),
        ...(after ? [{ ...after, time: end, boundary: true }] : []),
      ];
    }

    function chartTimelineTicks(start, end, count) {
      const span = end - start;
      return Array.from({ length: count }, (_, index) => {
        const time = start + span * index / (count - 1);
        const date = new Date(time);
        const label = span > 370 * 86400000
          ? date.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
          : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
        return { time, label };
      });
    }

    function accountEventRows(events) {
      if (!events.length) return empty('No account activity.');
      return [...events].reverse().map((event) =>
        '<div class="table-row account-event' + (event.virtual ? ' virtual ' + (event.danger ? 'danger' : 'safe') : '')
        + (event.virtual ? pendingClass(event.knownValue) : '')
        + '" data-timeline-event-id="' + escapeHtml(event.id) + '"'
        + (event.virtual ? ' data-resource-kind="AccountKnownValue" data-resource-id="'
          + event.knownValue.metadata.id + '"' : '') + '>'
        + (event.virtual ? pendingCommitBar(event.knownValue) : '')
        + '<span class="' + (event.virtual ? changedClass(event.knownValue, ['spec.date']) : '') + '">'
        + escapeHtml(event.date) + '</span>'
        + '<span>' + (event.virtual
          ? '<button type="button" class="virtual-title-link '
            + changedClass(event.knownValue, ['spec.value', 'spec.date', 'spec.note'])
            + '" data-action="edit-known-value" data-id="' + event.knownValue.metadata.id + '">'
            + escapeHtml(event.description) + '</button>'
          : '<strong>' + escapeHtml(event.description) + '</strong>'
            + (event.perfectKnownValues || []).map((knownValue) =>
              ' <button type="button" class="perfect-reconciliation-badge"'
              + ' data-action="edit-known-value" data-id="' + knownValue.metadata.id + '"'
              + ' title="Known value ' + escapeHtml(formatMoney(knownValue.spec.value))
              + ' observed on ' + escapeHtml(knownValue.spec.date) + '. Click to view or edit."'
              + ' aria-label="Perfect Reconciliation for ' + escapeHtml(knownValue.spec.date) + '">'
              + 'Perfect Reconciliation</button>').join(''))
        + (event.virtual
          ? '<small class="transaction-source '
            + changedClass(event.knownValue, ['spec.value', 'spec.date', 'spec.note']) + '">Known value '
            + formatMoney(event.knownValue.spec.value)
            + ' observed on ' + escapeHtml(event.knownValue.spec.date)
            + (event.knownValue.spec.note ? ' · ' + escapeHtml(event.knownValue.spec.note) : '')
            + '</small>'
          : '') + '</span>'
        + '<span class="' + (event.virtual ? changedClass(event.knownValue, ['relationships.accountId']) : '') + '">'
        + accountRouteHtml(event) + '</span>'
        + '<span class="money ' + (event.virtual ? changedClass(event.knownValue, ['spec.value', 'spec.date']) : '')
        + '">' + formatMoney(event.amount) + '</span>'
        + '<span class="money' + (event.perfectKnownValues?.length ? ' perfect-balance' : '') + '">'
        + formatMoney(event.balance) + '</span></div>').join('');
    }

    function accountRouteHtml(event) {
      return (event.routeParts || [event.route]).map((part) =>
        typeof part === 'string'
          ? escapeHtml(part)
          : '<button type="button" class="account-route-link" data-action="account-detail" data-id="'
            + escapeHtml(part.accountId) + '">' + escapeHtml(part.label) + '</button>').join('');
    }

    function renderBudgets() {
      const selected = state.budgets.find((item) => item.metadata.id === state.selectedBudgetId);
      if (selected) return renderBudgetDetail(selected);
      const rows = treeRows(state.budgets, 'parentBudgetId').filter(matchesSearch);
      return toolbar('Budget hierarchy', 'Add budget', 'add-budget')
        + '<div class="card">'
        + headerRow(['Budget', 'Budgeted Value', 'Realized'])
        + rows.map(({ item, depth }) => '<div class="tree-row' + pendingClass(item) + '" draggable="true" data-kind="Budget" data-id="' + item.metadata.id
          + '" data-resource-kind="Budget" data-resource-id="' + item.metadata.id + '">'
          + pendingCommitBar(item)
          + treeName(item, depth, '', 'budget-detail')
          + moneyCell(item.status.budgeted, changedClass(item, ['spec.amount', 'spec.recurrence']))
          + moneyCell(item.status.realized)
          + '</div>').join('')
        + '</div><p class="muted">Calendar occurrences roll up to monthly and parent Budget totals. Drag to rearrange the hierarchy.</p>';
    }

    function renderBudgetDetail(budget) {
      const recurrence = budgetRecurrence(budget);
      const schedule = recurrence.frequency === 'Weekly' ? 'Every other week' : 'Monthly';
      return '<form id="budget-detail-form" class="budget-detail-form">'
        + '<div class="budget-detail-header"><button type="button" data-action="budget-back">← Budgets</button>'
        + '<input class="account-title-input ' + changedClass(budget, ['spec.name']) + '" name="name"'
        + ' value="' + escapeHtml(budget.spec.name) + '" aria-label="Budget name">'
        + (pendingChange(budget) ? '<button type="button" class="commit-budget" data-action="commit-budget">Commit</button>' : '')
        + '</div><div class="card budget-meta' + pendingClass(budget) + '">'
        + selectField('flow', 'Flow', ['Income', 'Expense', 'Reinvested'], budget.spec.flow || 'Expense')
        + resourceField('parentBudgetId', 'Parent budget', 'budgetOptions', budgetName(budget.relationships.parentBudgetId))
        + field('amount', 'Budgeted value per occurrence', budget.spec.amount || '', 'number', '0.01')
        + selectField('schedule', 'Repeats', ['Monthly', 'Every other week'], schedule)
        + field('startsOn', 'Start date / first occurrence', recurrence.startsOn, 'date')
        + field('endsOn', 'End date', recurrence.endsOn, 'date')
        + field('daysOfMonth', 'Days of month (-1 is last)', recurrence.frequency === 'Monthly'
          ? recurrence.daysOfMonth.join(', ') : '', 'text', '', false)
        + '<span id="budgetDetailError" class="budget-detail-error error"></span></div>'
        + '<div class="account-summary">'
        + summaryValue('Budgeted', budgetYearTotal(budget, 'budgeted'))
        + summaryValue('Actual', budgetYearTotal(budget, 'actual'))
        + summaryValue('Projected', budgetProjectedTotal(budget))
        + '</div><div class="account-history"><div class="card balance-chart">'
        + budgetChart(budget) + '</div>'
        + '<div class="card budget-transactions-card"><div class="budget-transactions-table">'
        + '<div class="table-row budget-transaction muted"><strong>Date</strong><strong>Transaction</strong>'
        + '<strong>Route</strong><strong>Budget</strong><strong class="money">Amount</strong>'
        + '<strong class="money">Balance</strong></div>'
        + budgetTransactionRows(budget) + '</div></div></div></form>';
    }

    function budgetRecurrence(budget) {
      return budget?.spec.recurrence || {
        frequency: 'Monthly',
        interval: 1,
        daysOfMonth: [1],
        startsOn: new Date().getUTCFullYear() + '-01-01',
        endsOn: new Date().getUTCFullYear() + '-12-31',
      };
    }

    function budgetSubtreeIds(budgetId) {
      return [budgetId, ...state.budgets
        .filter((item) => item.relationships.parentBudgetId === budgetId)
        .flatMap((item) => budgetSubtreeIds(item.metadata.id))];
    }

    function budgetTransactions(budget) {
      const budgetIds = new Set(budgetSubtreeIds(budget.metadata.id));
      return state.transactions
        .filter((item) => item.status.deleted !== true && budgetIds.has(item.relationships.budgetId))
        .sort((left, right) => String(right.spec.date).localeCompare(String(left.spec.date))
          || left.metadata.id.localeCompare(right.metadata.id));
    }

    function budgetTransactionRows(budget) {
      const transactions = budgetBalanceTimeline(budget)
        .filter((event) => event.kind === 'Transaction')
        .reverse();
      if (!transactions.length) return empty('No transactions use this Budget.');
      return transactions.map((event) => {
        const item = event.item;
        return (
        '<div class="table-row budget-transaction' + pendingClass(item) + '"'
        + ' data-resource-kind="Transaction" data-resource-id="' + item.metadata.id + '"'
        + ' data-timeline-event-id="transaction-' + item.metadata.id + '">'
        + pendingCommitBar(item)
        + '<span>' + escapeHtml(item.spec.date) + '</span>'
        + '<button type="button" class="transaction-title" data-action="edit-transaction" data-id="'
        + item.metadata.id + '">' + escapeHtml(item.spec.description) + '</button>'
        + '<span>' + accountRouteLink(item.relationships.fromAccountId) + ' → '
        + accountRouteLink(item.relationships.toAccountId) + '</span>'
        + '<span>' + escapeHtml(budgetName(item.relationships.budgetId) || 'Uncategorized') + '</span>'
        + moneyCell(item.spec.amount)
        + moneyCell(event.balance) + '</div>');
      }).join('');
    }

    function accountRouteLink(accountId) {
      return '<button type="button" class="account-route-link" data-action="account-detail" data-id="'
        + escapeHtml(accountId) + '">' + escapeHtml(accountName(accountId)) + '</button>';
    }

    function budgetSeries(budget) {
      const recurrence = budgetRecurrence(budget);
      const year = Number(String(recurrence.startsOn).slice(0, 4)) || new Date().getUTCFullYear();
      const now = new Date();
      const actualThrough = year < now.getUTCFullYear() ? 11
        : year > now.getUTCFullYear() ? -1 : now.getUTCMonth();
      const monthlyBudget = Array.from({ length: 12 }, (_, month) =>
        Number(budget.status.budgetedByMonth?.[year + '-' + String(month + 1).padStart(2, '0')] || 0));
      const monthlyActual = Array.from({ length: 12 }, (_, month) =>
        Number(budget.status.realizedByMonth?.[year + '-' + String(month + 1).padStart(2, '0')] || 0));
      let budgetedTotal = 0;
      let actualTotal = 0;
      let projectedTotal = 0;
      const budgeted = [];
      const actual = [];
      const projected = [];
      monthlyBudget.forEach((amount, month) => {
        budgetedTotal += amount;
        if (month <= actualThrough) {
          actualTotal += monthlyActual[month];
          projectedTotal = actualTotal;
          actual.push(actualTotal);
          projected.push(month === actualThrough ? actualTotal : null);
        } else {
          projectedTotal += amount;
          actual.push(null);
          projected.push(projectedTotal);
        }
        budgeted.push(budgetedTotal);
      });
      return { year, budgeted, actual, projected, projectedTotal, budgetedTotal, actualTotal };
    }

    function budgetYearTotal(budget, kind) {
      const series = budgetSeries(budget);
      return (kind === 'actual' ? series.actualTotal : series.budgetedTotal).toFixed(2);
    }

    function budgetProjectedTotal(budget) {
      return budgetSeries(budget).projectedTotal.toFixed(2);
    }

    function budgetBalanceTimeline(budget) {
      const year = Number(String(budgetRecurrence(budget).startsOn).slice(0, 4))
        || new Date().getUTCFullYear();
      const budgetIds = new Set(budgetSubtreeIds(budget.metadata.id));
      const today = new Date().toISOString().slice(0, 10);
      const occurrences = state.budgets
        .filter((item) => budgetIds.has(item.metadata.id))
        .flatMap((item) => budgetOccurrenceDates(item, year).map((date) => ({ item, date })));
      const disbursements = occurrences.map(({ item, date }) => ({
          id: 'disbursement-' + item.metadata.id + '-' + date,
          kind: 'Disbursement',
          date,
          description: item.spec.name + ' Budget disbursement',
          amount: Number(item.spec.amount),
          item,
        }));
      const estimates = occurrences
        .filter(({ date }) => date > today)
        .map(({ item, date }) => ({
          id: 'estimate-' + item.metadata.id + '-' + date,
          kind: 'Estimated payment',
          date,
          description: item.spec.name + ' estimated payment',
          amount: -Number(item.spec.amount),
          item,
        }));
      const transactions = budgetTransactions(budget)
        .filter((item) => String(item.spec.date).startsWith(year + '-'))
        .map((item) => ({
          id: 'transaction-' + item.metadata.id,
          kind: 'Transaction',
          date: item.spec.date,
          description: item.spec.description,
          amount: -Number(item.spec.amount),
          item,
        }));
      let balance = 0;
      return [...disbursements, ...transactions, ...estimates]
        .sort((left, right) => String(left.date).localeCompare(String(right.date))
          || left.kind.localeCompare(right.kind)
          || left.id.localeCompare(right.id))
        .map((event) => ({ ...event, balance: balance += event.amount }));
    }

    function budgetOccurrenceDates(budget, year) {
      const recurrence = budgetRecurrence(budget);
      const result = [];
      const add = (date) => {
        if (date >= recurrence.startsOn && date <= recurrence.endsOn && date.startsWith(year + '-')) {
          result.push(date);
        }
      };
      if (recurrence.frequency === 'Weekly') {
        for (
          let date = new Date(recurrence.startsOn + 'T00:00:00Z');
          date.toISOString().slice(0, 10) <= recurrence.endsOn;
          date = new Date(date.getTime() + 14 * 86400000)
        ) add(date.toISOString().slice(0, 10));
        return result;
      }
      for (let month = 0; month < 12; month += 1) {
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        for (const rawDay of recurrence.daysOfMonth || []) {
          const day = Number(rawDay);
          const resolvedDay = day < 0 ? daysInMonth + day + 1 : day;
          if (!Number.isInteger(resolvedDay) || resolvedDay < 1 || resolvedDay > daysInMonth) continue;
          add(year + '-' + String(month + 1).padStart(2, '0') + '-'
            + String(resolvedDay).padStart(2, '0'));
        }
      }
      return result;
    }

    function settledBudgetTimeline(timeline, settlementDays = 5) {
      const result = [];
      for (let index = 0; index < timeline.length;) {
        const event = timeline[index];
        if (event.kind !== 'Disbursement') {
          result.push({ ...event, displayBalance: event.balance });
          index += 1;
          continue;
        }
        const startsOn = chartDate(event.date);
        const endsOn = startsOn + settlementDays * 86400000;
        let endIndex = index;
        while (endIndex + 1 < timeline.length) {
          const next = timeline[endIndex + 1];
          if (chartDate(next.date) > endsOn) break;
          if (next.kind === 'Disbursement' && next.date !== event.date) break;
          endIndex += 1;
        }
        const settledBalance = timeline[endIndex].balance;
        for (let groupIndex = index; groupIndex <= endIndex; groupIndex += 1) {
          result.push({ ...timeline[groupIndex], displayBalance: settledBalance });
        }
        index = endIndex + 1;
      }
      return result;
    }

    function budgetChart(budget) {
      const series = budgetSeries(budget);
      const width = 900;
      const height = 280;
      const padding = 34;
      const plotBottom = 225;
      const fullStart = Date.UTC(series.year, 0, 1);
      const fullEnd = Date.UTC(series.year + 1, 0, 1) - 1;
      const chartKey = 'Budget:' + budget.metadata.id;
      const view = timelineChartViewport(chartKey, fullStart, fullEnd);
      const start = Math.max(fullStart, view.start);
      const end = Math.min(fullEnd, view.end);
      const rawTimeline = budgetBalanceTimeline(budget);
      const timeline = state.budgetBalanceMode === 'settled'
        ? settledBudgetTimeline(rawTimeline)
        : rawTimeline.map((event) => ({ ...event, displayBalance: event.balance }));
      const balancePoints = chartPointsInView(timeline.map((event) => ({
        time: chartDate(event.date),
        value: event.displayBalance,
        event,
      })), start, end);
      const values = [0, ...balancePoints.map((point) => point.value)];
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const range = maximum - minimum || 1;
      const x = (time) => padding + (time - start) * (width - padding * 2) / Math.max(end - start, 1);
      const y = (value) => padding + (maximum - value) * (plotBottom - padding) / range;
      const points = (items) => items.map((point) =>
        x(point.time).toFixed(1) + ',' + y(point.value).toFixed(1)).join(' ');
      const ticks = chartTimelineTicks(start, end, 7);
      return '<div class="balance-chart-header"><div><h3>Budget balance · ' + series.year
        + '</h3><p class="muted">' + (state.budgetBalanceMode === 'settled'
          ? 'Settled view nets Transactions within five days after each Budget disbursement.'
          : 'Raw view shows the immediate balance after every Budget disbursement and Transaction.')
        + '</p></div><div><button type="button" data-action="toggle-budget-balance">'
        + (state.budgetBalanceMode === 'settled' ? 'Show raw' : 'Show settled') + '</button>'
        + timelineChartResetButton(chartKey) + '</div></div>'
        + '<svg class="budget-year-chart timeline-chart" viewBox="0 0 ' + width + ' ' + height + '"'
        + ' data-chart-key="' + chartKey + '" data-chart-padding="' + padding
        + '" data-chart-min-span="' + (31 * 86400000) + '"'
        + ' data-chart-start="' + start + '" data-chart-end="' + end + '"'
        + ' data-chart-full-start="' + fullStart + '" data-chart-full-end="' + fullEnd
        + '" role="img" aria-label="Budget balance over time for ' + series.year + '">'
        + [0, .25, .5, .75, 1].map((ratio) => {
          const lineY = padding + ratio * (plotBottom - padding);
          return '<line class="chart-grid" x1="' + padding + '" y1="' + lineY + '" x2="'
            + (width - padding) + '" y2="' + lineY + '"/>';
        }).join('')
        + '<line class="budget-zero-line" x1="' + padding + '" y1="' + y(0) + '" x2="'
          + (width - padding) + '" y2="' + y(0) + '"></line>'
        + '<text class="budget-zero-label" x="' + (width - padding - 4) + '" y="'
          + (y(0) - 6) + '">Balance $0</text>'
        + '<line class="chart-axis" x1="' + padding + '" y1="' + plotBottom + '" x2="'
          + (width - padding) + '" y2="' + plotBottom + '"></line>'
        + ticks.map((tick) => '<line class="chart-tick" x1="' + x(tick.time) + '" y1="' + plotBottom
          + '" x2="' + x(tick.time) + '" y2="' + (plotBottom + 6) + '"></line>'
          + '<text class="chart-label" x="' + x(tick.time) + '" y="' + (plotBottom + 21) + '">'
          + escapeHtml(tick.label) + '</text>').join('')
        + (balancePoints.length ? '<polyline class="chart-line" points="' + points(balancePoints) + '"/>' : '')
        + balancePoints.filter((point) => point.event && !point.boundary).map((point) => {
          const event = point.event;
          return '<circle class="chart-dot budget-chart-dot '
            + (event.kind === 'Disbursement' ? 'budget-disbursement'
              : event.kind === 'Estimated payment' ? 'budget-estimate' : 'budget-transaction-dot')
            + '" cx="' + x(point.time) + '" cy="' + y(point.value)
            + '" r="4" tabindex="0" data-timeline-event-id="' + escapeHtml(event.id) + '"><title>'
            + escapeHtml(event.date + ' · ' + event.description + ' · '
              + (event.amount >= 0 ? '+' : '') + formatMoney(event.amount)
              + ' · Raw balance ' + formatMoney(event.balance)
              + (event.displayBalance !== event.balance
                ? ' · Settled balance ' + formatMoney(event.displayBalance) : '')) + '</title></circle>';
        }).join('')
        + '</svg><div class="chart-legend">'
        + '<span style="--series-color:var(--accent)">'
        + (state.budgetBalanceMode === 'settled' ? 'Settled balance' : 'Raw balance') + '</span>'
        + '<span style="--series-color:#7c3aed">Budget disbursement</span>'
        + '<span style="--series-color:var(--good)">Transaction</span>'
        + '<span style="--series-color:#d97706">Estimated payment</span></div>'
        + '<p class="muted">Scroll over the timeline to zoom. Double-click a date to zoom into that month. Transaction dots link to rows below.</p>';
    }

    function renderTransactions() {
      const filtered = state.transactions.filter(matchesSearch);
      const groups = groupBy(filtered, (item) => String(item.spec.date).slice(0, 7));
      return toolbar('Transactions', 'Add transaction', 'add-transaction')
        + ([...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, items]) =>
          '<div class="month">' + escapeHtml(monthLabel(month)) + '</div><div class="card">'
          + [...items].sort((a, b) => String(b.spec.date).localeCompare(String(a.spec.date)))
            .map((item) => '<div class="table-row transaction' + pendingClass(item) + '" draggable="true"'
            + ' data-app-resource-kind="Transaction" data-app-resource-id="' + item.metadata.id + '"'
            + ' data-app-resource-title="' + escapeHtml(item.spec.description) + '"'
            + ' data-app-resource-date="' + escapeHtml(item.spec.date) + '"'
            + ' data-app-resource-description="' + escapeHtml(item.spec.description) + '"'
            + ' data-app-resource-amount="' + escapeHtml(formatMoney(item.spec.amount)) + '"'
            + ' data-resource-kind="Transaction" data-resource-id="' + item.metadata.id + '">'
            + pendingCommitBar(item)
            + '<span class="' + changedClass(item, ['spec.date']) + '">' + escapeHtml(item.spec.date) + '</span>'
            + '<button type="button" class="transaction-title ' + changedClass(item, ['spec.description'])
            + '" data-action="edit-transaction" data-id="' + item.metadata.id + '">'
            + escapeHtml(item.spec.description)
            + (item.spec.source ? '<small class="transaction-source">' + escapeHtml(item.spec.source.type)
              + ' · ' + escapeHtml(item.spec.source.account) + '</small>' : '') + '</button>'
            + '<span class="' + changedClass(item, ['relationships.fromAccountId']) + '">' + escapeHtml(accountName(item.relationships.fromAccountId)) + '</span>'
            + '<span class="' + changedClass(item, ['relationships.toAccountId']) + '">' + escapeHtml(accountName(item.relationships.toAccountId)) + '</span>'
            + '<span class="' + changedClass(item, ['relationships.budgetId']) + '">' + escapeHtml(budgetName(item.relationships.budgetId) || 'Uncategorized') + '</span>'
            + moneyCell(item.spec.amount, changedClass(item, ['spec.amount']))
            + '</div>').join('') + '</div>'
        ).join('') || empty('No transactions match this view.'));
    }

    function wireWorkspace() {
      document.querySelector('#search')?.addEventListener('input', (event) => {
        state.search = event.target.value;
        render();
      });
      document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
        const actions = {
          'add-account': () => openAccountEditor(),
          'account-detail': () => {
            state.tab = 'accounts';
            state.selectedAccountId = button.dataset.id;
            state.selectedBudgetId = null;
            state.accountParentEditing = false;
            state.accountNoteEditing = false;
            state.timelineChartView = null;
            localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, state.tab);
            document.querySelectorAll('[data-tab]').forEach(
              (item) => item.classList.toggle('active', item.dataset.tab === state.tab),
            );
            render();
          },
          'account-back': () => {
            state.selectedAccountId = null;
            state.accountParentEditing = false;
            state.accountNoteEditing = false;
            state.timelineChartView = null;
            render();
          },
          'edit-account-parent': () => {
            state.accountParentEditing = true;
            render();
            requestAnimationFrame(() => document.querySelector('#account-parent-inline')?.focus());
          },
          'edit-account-note': () => {
            state.accountNoteEditing = true;
            render();
            requestAnimationFrame(() => document.querySelector('#account-note-inline')?.focus());
          },
          'commit-account': () => acceptPendingResource('Account', state.selectedAccountId),
          'reset-timeline-chart': () => { state.timelineChartView = null; render(); },
          'toggle-budget-balance': () => {
            state.budgetBalanceMode = state.budgetBalanceMode === 'settled' ? 'raw' : 'settled';
            render();
          },
          'add-budget': () => openBudgetEditor(),
          'budget-detail': () => {
            state.selectedBudgetId = button.dataset.id;
            state.timelineChartView = null;
            render();
          },
          'budget-back': () => {
            state.selectedBudgetId = null;
            state.timelineChartView = null;
            render();
          },
          'commit-budget': () => acceptPendingResource('Budget', state.selectedBudgetId),
          'add-transaction': () => openTransactionEditor(),
          'edit-transaction': () => openTransactionEditor(
            state.transactions.find((item) => item.metadata.id === button.dataset.id),
          ),
          'known-value': () => openKnownValueEditor(button.dataset.id),
          'edit-known-value': () => openKnownValueEditor(
            button.dataset.id,
            state.knownValues.find((item) => item.metadata.id === button.dataset.id),
          ),
        };
        actions[button.dataset.action]?.();
      }));
      wireAccountAutosave();
      wireBudgetDetail();
      wirePendingChangeAcceptance();
      wireResourceReferences(workspace);
      wireTreeDrag();
      wireTimelineCharts();
    }

    function wireBudgetDetail() {
      const form = document.querySelector('#budget-detail-form');
      if (!form) return;
      wireDateInputs(form);
      form.addEventListener('submit', (event) => event.preventDefault());
      form.querySelectorAll('input, select').forEach((input) => input.addEventListener('change', async () => {
        form.querySelectorAll('[data-date-input]').forEach((input) => normalizeDateInput(input));
        if (!form.reportValidity()) return;
        const budget = state.budgets.find((item) => item.metadata.id === state.selectedBudgetId);
        if (!budget) return;
        const errorMessage = document.querySelector('#budgetDetailError');
        errorMessage.textContent = '';
        try {
          await saveBudget(budget, new FormData(form));
        } catch (error) {
          errorMessage.textContent = error.message;
        }
      }));
    }

    function wireTimelineCharts() {
      document.querySelectorAll('[data-timeline-event-id]').forEach((element) => {
        const toggle = (active) => {
          document.querySelectorAll('[data-timeline-event-id="' + CSS.escape(element.dataset.timelineEventId) + '"]')
            .forEach((match) => match.classList.toggle('active', active));
        };
        element.addEventListener('mouseenter', () => toggle(true));
        element.addEventListener('mouseleave', () => toggle(false));
        element.addEventListener('focus', () => toggle(true));
        element.addEventListener('blur', () => toggle(false));
        if (element.classList.contains('chart-dot')) {
          element.addEventListener('click', () => {
            const row = document.querySelector('.table-row[data-timeline-event-id="'
              + CSS.escape(element.dataset.timelineEventId) + '"]');
            row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            toggle(true);
            setTimeout(() => toggle(false), 1200);
          });
        }
      });
      document.querySelectorAll('.timeline-chart').forEach((chart) => {
        chart.addEventListener('wheel', (event) => {
          event.preventDefault();
          const start = Number(chart.dataset.chartStart);
          const end = Number(chart.dataset.chartEnd);
          const fullStart = Number(chart.dataset.chartFullStart);
          const fullEnd = Number(chart.dataset.chartFullEnd);
          const center = chartPointerTime(chart, event.clientX);
          const minimumSpan = Math.min(Number(chart.dataset.chartMinSpan), fullEnd - fullStart);
          const targetSpan = Math.min(
            fullEnd - fullStart,
            Math.max(minimumSpan, (end - start) * (event.deltaY < 0 ? 0.72 : 1.38)),
          );
          const ratio = (center - start) / Math.max(end - start, 1);
          let nextStart = center - targetSpan * ratio;
          let nextEnd = nextStart + targetSpan;
          if (nextStart < fullStart) {
            nextStart = fullStart;
            nextEnd = fullStart + targetSpan;
          }
          if (nextEnd > fullEnd) {
            nextEnd = fullEnd;
            nextStart = fullEnd - targetSpan;
          }
          state.timelineChartView = targetSpan >= fullEnd - fullStart
            ? null
            : { key: chart.dataset.chartKey, start: nextStart, end: nextEnd };
          render();
        }, { passive: false });
        chart.addEventListener('dblclick', (event) => {
          if (event.target.classList.contains('chart-dot')) return;
          const fullStart = Number(chart.dataset.chartFullStart);
          const fullEnd = Number(chart.dataset.chartFullEnd);
          const date = new Date(chartPointerTime(chart, event.clientX));
          const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
          const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1;
          state.timelineChartView = {
            key: chart.dataset.chartKey,
            start: Math.max(fullStart, start),
            end: Math.min(fullEnd, end),
          };
          render();
        });
      });
    }

    function chartPointerTime(chart, clientX) {
      const rect = chart.getBoundingClientRect();
      const start = Number(chart.dataset.chartStart);
      const end = Number(chart.dataset.chartEnd);
      const padding = Number(chart.dataset.chartPadding);
      const plotLeft = rect.left + rect.width * padding / 900;
      const plotRight = rect.right - rect.width * padding / 900;
      const ratio = Math.max(0, Math.min(1, (clientX - plotLeft) / Math.max(plotRight - plotLeft, 1)));
      return start + (end - start) * ratio;
    }

    function wireAccountAutosave() {
      document.querySelectorAll('[data-account-field]').forEach((input) => {
        const eventName = input.type === 'checkbox' ? 'change' : 'blur';
        input.addEventListener(eventName, () => void autosaveAccountField(input.dataset.accountField,
          input.type === 'checkbox' ? input.checked : input.value));
      });
      document.querySelector('#account-parent-inline')?.addEventListener('blur', (event) => {
        void autosaveAccountField('parentAccountId', event.target.value);
      });
      document.querySelector('#account-note-inline')?.addEventListener('blur', (event) => {
        void autosaveAccountField('note', event.target.value);
      });
    }

    async function autosaveAccountField(field, value) {
      const account = state.accounts.find((item) => item.metadata.id === state.selectedAccountId);
      if (!account) return;
      try {
        const parentId = field === 'parentAccountId'
          ? idFromInput(value, state.accounts, false)
          : account.relationships.parentAccountId;
        const nextSpec = {
          name: field === 'name' ? String(value).trim() : account.spec.name,
          currency: field === 'currency' ? String(value).trim().toUpperCase() : account.spec.currency,
          internal: field === 'internal' ? Boolean(value) : account.spec.internal,
          ...((field === 'institution' ? String(value).trim() : account.spec.institution)
            ? { institution: field === 'institution' ? String(value).trim() : account.spec.institution } : {}),
          ...((field === 'note' ? String(value).trim() : account.spec.note)
            ? { note: field === 'note' ? String(value).trim() : account.spec.note } : {}),
        };
        const nextRelationships = parentId ? { parentAccountId: parentId } : {};
        if (JSON.stringify(nextSpec) === JSON.stringify(account.spec)
          && JSON.stringify(nextRelationships) === JSON.stringify(
            account.relationships.parentAccountId ? { parentAccountId: account.relationships.parentAccountId } : {},
          )) {
          state.accountParentEditing = false;
          state.accountNoteEditing = false;
          render();
          return;
        }
        sync.textContent = 'Saving draft...';
        state.accountParentEditing = false;
        state.accountNoteEditing = false;
        await mutate('/api/resources/Account/' + account.metadata.id, {
          expectedResourceVersion: account.metadata.resourceVersion,
          spec: nextSpec,
          status: account.status,
          relationships: nextRelationships,
        }, 'PUT', 'Saving draft...');
      } catch (error) {
        sync.textContent = error.message;
        sync.className = 'error';
      }
    }

    function wirePendingChangeAcceptance() {
      document.querySelectorAll('.pending-commit-bar').forEach((bar) => {
        const accept = () => acceptPendingResource(bar.dataset.resourceKind, bar.dataset.resourceId);
        bar.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          void accept();
        });
        bar.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          void accept();
        });
      });
    }

    async function acceptPendingResource(kind, id) {
      const change = state.pendingChanges.find((candidate) =>
        candidate.resourceKind === kind && candidate.resourceId === id);
      if (!change) {
        sync.textContent = 'This row no longer has pending changes.';
        sync.className = 'error';
        return;
      }
      sync.textContent = 'Accepting changes...';
      sync.className = '';
      try {
        await api('/api/change-sets/' + change.changeSetId + '/commit', {
          method: 'POST',
          body: JSON.stringify({ expectedResourceVersion: change.changeSetResourceVersion }),
        });
        await load();
      } catch (error) {
        sync.textContent = error.message;
        sync.className = 'error';
      }
    }

    function wireResourceReferences(root) {
      root.querySelectorAll('[data-app-resource-kind]').forEach((element) => {
        const reference = resourceReference(
          element.dataset.appResourceKind,
          element.dataset.appResourceId,
          element.dataset.appResourceTitle,
          {
            date: element.dataset.appResourceDate,
            description: element.dataset.appResourceDescription,
            amount: element.dataset.appResourceAmount,
          },
        );
        element.addEventListener('dragstart', (event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = reference.resourceKind === 'Account' ? 'copyMove' : 'copy';
          event.dataTransfer.setData('application/vnd.kubarycz.container-app-resource+json', JSON.stringify(reference));
          const markdown = resourceReferenceMarkdown(reference);
          event.dataTransfer.setData('text/plain', markdown);
          event.dataTransfer.setData('text/markdown', markdown);
          event.dataTransfer.setData('text/uri-list', reference.deepLink);
        });
      });
    }

    function resourceReference(resourceKind, resourceId, title, preview) {
      const deepLink = new URL(location.pathname, location.origin);
      deepLink.searchParams.set('resource', resourceKind);
      deepLink.searchParams.set('id', resourceId);
      return {
        version: 2,
        appId: 'banking-app',
        resourceKind,
        resourceId,
        title,
        deepLink: deepLink.toString(),
        preview,
      };
    }

    function resourceReferenceMarkdown(reference) {
      const label = [
        reference.preview?.date,
        reference.preview?.description || reference.title,
        reference.preview?.amount,
      ].filter(Boolean).join(' · ');
      return '[' + label.replace(/[\\\\[\\]]/g, '\\\\$&') + '](' + reference.deepLink + ')';
    }

    function wireTreeDrag() {
      let dragged;
      const clearDropMarker = (row) => row.classList.remove('drag-before', 'drag-inside', 'drag-after');
      document.querySelectorAll('.tree-row[draggable]').forEach((row) => {
        row.addEventListener('dragstart', () => { dragged = row; });
        row.addEventListener('dragover', (event) => {
          if (!dragged || dragged.dataset.kind !== row.dataset.kind || dragged.dataset.id === row.dataset.id) return;
          event.preventDefault();
          event.stopPropagation();
          clearDropMarker(row);
          row.classList.add('drag-' + dropPosition(row, event.clientY));
        });
        row.addEventListener('dragleave', () => clearDropMarker(row));
        row.addEventListener('drop', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const position = dropPosition(row, event.clientY);
          clearDropMarker(row);
          if (!dragged || dragged.dataset.kind !== row.dataset.kind || dragged.dataset.id === row.dataset.id) return;
          await reorderResource(dragged.dataset.kind, dragged.dataset.id, row.dataset.id, position);
        });
      });
      workspace.ondragover = (event) => {
        if (dragged && !event.target.closest('.tree-row')) event.preventDefault();
      };
      workspace.ondrop = async (event) => {
        if (!dragged || event.target.closest('.tree-row')) return;
        event.preventDefault();
        await reorderResource(dragged.dataset.kind, dragged.dataset.id);
      };
    }

    function dropPosition(row, clientY) {
      const bounds = row.getBoundingClientRect();
      const ratio = (clientY - bounds.top) / bounds.height;
      return ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
    }

    async function reorderResource(kind, id, targetId, position = 'root') {
      const collection = kind === 'Account' ? state.accounts : state.budgets;
      const parentField = kind === 'Account' ? 'parentAccountId' : 'parentBudgetId';
      const orderFor = kind === 'Account'
        ? (item) => accountDisplayOrder(item.metadata.id)
        : (item) => Number(item.spec.order);
      const changes = planTreeMove(collection, parentField, id, targetId, position, orderFor);
      if (!changes.length) return;
      const parentChanges = changes.filter(({ item, parentId }) =>
        item.relationships[parentField] !== parentId);
      const stagedChanges = kind === 'Account' ? parentChanges : changes;
      const existingChangeSets = [...new Set(stagedChanges.map(
        ({ item }) => item.relationships.changeSetId,
      ).filter(Boolean))];
      if (existingChangeSets.length > 1) {
        throw new Error('Commit or discard the existing account changes before reordering these rows.');
      }
      let changeSetId = existingChangeSets[0];
      if (stagedChanges.length && !changeSetId) {
        const changeSet = await api('/api/change-sets', {
          method: 'POST',
          body: JSON.stringify({
            title: kind === 'Account' ? 'Reparent accounts' : 'Reorder budgets',
          }),
        });
        changeSetId = changeSet.metadata.id;
      }
      sync.textContent = kind === 'Account' ? 'Saving account layout...' : 'Saving order...';
      for (const change of stagedChanges) {
        const relationships = { ...change.item.relationships, changeSetId };
        if (change.parentId) relationships[parentField] = change.parentId;
        else delete relationships[parentField];
        await api('/api/resources/' + kind + '/' + change.item.metadata.id, {
          method: 'PUT',
          body: JSON.stringify({
            expectedResourceVersion: change.item.metadata.resourceVersion,
            spec: kind === 'Account'
              ? change.item.spec
              : { ...change.item.spec, order: change.order },
            status: change.item.status,
            relationships,
          }),
        });
      }
      if (kind === 'Account') {
        await api('/api/account-order', {
          method: 'PUT',
          body: JSON.stringify({
            updates: changes.map(({ item, order }) => ({
              accountId: item.metadata.id,
              order,
            })),
          }),
        });
      }
      await load();
    }

    function planTreeMove(collection, parentField, id, targetId, position, orderFor = (item) => Number(item.spec.order)) {
      const dragged = collection.find((item) => item.metadata.id === id);
      const target = collection.find((item) => item.metadata.id === targetId);
      if (!dragged || (targetId && !target)) return [];
      const parentId = position === 'inside'
        ? target.metadata.id
        : position === 'root'
          ? undefined
          : target.relationships[parentField];
      const siblings = collection
        .filter((item) => item.metadata.id !== id && item.relationships[parentField] === parentId)
        .sort((left, right) => orderFor(left) - orderFor(right)
          || String(left.spec.name).localeCompare(String(right.spec.name)));
      let index = siblings.length;
      if (position === 'before' || position === 'after') {
        const targetIndex = siblings.findIndex((item) => item.metadata.id === targetId);
        index = targetIndex + (position === 'after' ? 1 : 0);
      }
      siblings.splice(index, 0, dragged);
      return siblings.flatMap((item, order) => {
        const currentParent = item.relationships[parentField];
        if (currentParent === parentId && orderFor(item) === order) return [];
        return [{ item, parentId, order }];
      });
    }

    function openAccountEditor() {
      showEditor('Add account', [
        field('name', 'Name'),
        field('institution', 'Institution (optional)', '', 'text', '', false),
        checkbox('internal', 'Internal account', true),
        resourceField('parentAccountId', 'Parent account (optional)', 'accountOptions'),
      ], async (data) => mutate('/api/resources/Account', {
        spec: {
          name: data.get('name'),
          currency: 'USD',
          internal: data.get('internal') === 'on',
          ...(data.get('institution') ? { institution: data.get('institution') } : {}),
        },
        relationships: idFromInput(data.get('parentAccountId'), state.accounts, false)
          ? { parentAccountId: idFromInput(data.get('parentAccountId'), state.accounts, false) } : {},
      }));
    }

    function openBudgetEditor(item) {
      const recurrence = budgetRecurrence(item);
      const schedule = recurrence.frequency === 'Weekly' ? 'Every other week' : 'Monthly';
      showEditor(item ? 'Edit budget' : 'Add budget', [
        field('name', 'Name', item?.spec.name || ''),
        selectField('flow', 'Flow', ['Income', 'Expense', 'Reinvested'], item?.spec.flow || 'Expense'),
        resourceField('parentBudgetId', 'Parent budget (optional)', 'budgetOptions', budgetName(item?.relationships.parentBudgetId)),
        field('amount', 'Budgeted value per occurrence', item?.spec.amount || '', 'number', '0.01'),
        selectField('schedule', 'Repeats', ['Monthly', 'Every other week'], schedule),
        field('startsOn', 'Start date / first occurrence', recurrence.startsOn, 'date'),
        field('endsOn', 'End date', recurrence.endsOn, 'date'),
        field(
          'daysOfMonth',
          'Days of month (monthly only; comma-separated, -1 means last day)',
          recurrence.frequency === 'Monthly' ? recurrence.daysOfMonth.join(', ') : '',
          'text',
          '',
          false,
        ),
      ], (data) => saveBudget(item, data));
    }

    async function saveBudget(item, data) {
      const startsOn = String(data.get('startsOn'));
      const endsOn = String(data.get('endsOn'));
      if (startsOn > endsOn) throw new Error('The recurrence end date must be on or after its start date.');
      const schedule = data.get('schedule');
      const recurrence = schedule === 'Every other week'
        ? { frequency: 'Weekly', interval: 2, startsOn, endsOn }
        : {
            frequency: 'Monthly',
            interval: 1,
            daysOfMonth: parseMonthDays(String(data.get('daysOfMonth'))),
            startsOn,
            endsOn,
          };
      const payload = {
        spec: {
          name: data.get('name'),
          order: item?.spec.order ?? state.budgets.length,
          flow: data.get('flow'),
          amount: Number(data.get('amount')).toFixed(2),
          recurrence,
          ...(item?.spec.note ? { note: item.spec.note } : {}),
        },
        relationships: item?.relationships.changeSetId
          ? { changeSetId: item.relationships.changeSetId }
          : {},
      };
      const parentId = idFromInput(data.get('parentBudgetId'), state.budgets, false);
      if (parentId) payload.relationships.parentBudgetId = parentId;
      if (item) {
        payload.expectedResourceVersion = item.metadata.resourceVersion;
        payload.status = item.status;
        await mutate('/api/resources/Budget/' + item.metadata.id, payload, 'PUT', 'Saving draft...');
      } else {
        await mutate('/api/resources/Budget', payload);
      }
    }

    function parseMonthDays(value) {
      const days = [...new Set(value.split(',').map((part) => Number(part.trim())))];
      if (!days.length || days.some((day) => !Number.isInteger(day) || day === 0 || day < -31 || day > 31)) {
        throw new Error('Enter one or more month days from 1 to 31, or use -1 for the last day.');
      }
      return days;
    }

    function openTransactionEditor(item) {
      showEditor(item ? 'Transaction details' : 'Add transaction', [
        field('date', 'Date', item?.spec.date || new Date().toISOString().slice(0, 10), 'date'),
        field('description', 'Description', item?.spec.description || ''),
        field('amount', 'Amount', item?.spec.amount || '', 'number', '0.01'),
        resourceField('fromAccountId', 'From account', 'accountOptions', accountName(item?.relationships.fromAccountId)),
        resourceField('toAccountId', 'To account', 'accountOptions', accountName(item?.relationships.toAccountId)),
        resourceField('budgetId', 'Budget', 'budgetOptions', budgetName(item?.relationships.budgetId) || 'Uncategorized'),
      ], async (data) => {
        const payload = {
          spec: {
            ...(item?.spec || {}),
          date: data.get('date'),
          description: data.get('description'),
          amount: Number(data.get('amount')).toFixed(2),
          },
          relationships: {
            ...(item?.relationships || {}),
            fromAccountId: idFromInput(data.get('fromAccountId'), state.accounts),
            toAccountId: idFromInput(data.get('toAccountId'), state.accounts),
            budgetId: idFromInput(data.get('budgetId'), state.budgets),
          },
        };
        if (item) {
          payload.expectedResourceVersion = item.metadata.resourceVersion;
          payload.status = item.status;
          await mutate('/api/resources/Transaction/' + item.metadata.id, payload, 'PUT');
        } else {
          await mutate('/api/resources/Transaction', payload);
        }
      });
    }

    function openKnownValueEditor(accountId, item) {
      const resolvedAccountId = item?.relationships.accountId || accountId;
      showEditor(item ? 'Edit known account value' : 'Add known account value', [
        field('date', 'Observed date', item?.spec.date || new Date().toISOString().slice(0, 10), 'date'),
        field('value', 'Observed account balance', item?.spec.value || '', 'number', '0.01'),
        textarea('note', 'Note', item?.spec.note || ''),
      ], async (data) => {
        const payload = {
          spec: {
            date: data.get('date'),
            value: Number(data.get('value')).toFixed(2),
            ...(data.get('note') ? { note: data.get('note') } : {}),
          },
          relationships: { accountId: resolvedAccountId },
        };
        if (item) {
          payload.expectedResourceVersion = item.metadata.resourceVersion;
          payload.status = item.status;
          await mutate('/api/resources/AccountKnownValue/' + item.metadata.id, payload, 'PUT');
        } else {
          await mutate('/api/resources/AccountKnownValue', payload);
        }
      }, item ? {
        remove: () => mutate('/api/resources/AccountKnownValue/' + item.metadata.id, {
          expectedResourceVersion: item.metadata.resourceVersion,
        }, 'DELETE', 'Deleting known value...'),
      } : {});
    }

    function showEditor(title, fields, submit, options = {}) {
      editor.innerHTML = '<form method="dialog"><h2>' + escapeHtml(title) + '</h2>'
        + fields.join('') + '<div id="editorError" class="error"></div>'
        + '<div class="dialog-actions">'
        + (options.remove ? '<button type="button" class="delete-record" data-dialog-delete'
          + ' aria-label="Delete known value" title="Delete known value">'
          + '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"'
          + ' stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg></button>' : '')
        + '<button type="button" data-dialog-cancel>Cancel</button>'
        + '<button class="primary" type="submit" value="save">Stage change</button></div></form>';
      const form = editor.querySelector('form');
      wireDateInputs(form);
      editor.querySelector('[data-dialog-cancel]').addEventListener('click', () => editor.close());
      editor.querySelector('[data-dialog-delete]')?.addEventListener('click', async () => {
        try {
          await options.remove();
          editor.close();
        } catch (error) {
          editor.querySelector('#editorError').textContent = error.message;
        }
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        form.querySelectorAll('[data-date-input]').forEach((input) => normalizeDateInput(input));
        if (!form.reportValidity()) return;
        try {
          await submit(new FormData(form));
          editor.close();
        } catch (error) {
          editor.querySelector('#editorError').textContent = error.message;
        }
      });
      editor.showModal();
    }

    function wireDateInputs(form) {
      form.querySelectorAll('[data-date-input]').forEach((input) => {
        input.addEventListener('paste', (event) => {
          const pasted = event.clipboardData?.getData('text')?.trim();
          if (!pasted) return;
          event.preventDefault();
          input.value = pasted;
          normalizeDateInput(input);
        });
        input.addEventListener('blur', () => normalizeDateInput(input));
        input.addEventListener('input', () => input.setCustomValidity(''));
      });
    }

    function normalizeDateInput(input) {
      const formatted = parseDateInput(input.value);
      if (formatted) {
        input.value = formatted;
        input.setCustomValidity('');
        return;
      }
      input.setCustomValidity('Enter a valid date such as 12/24/2025 or 2025-12-24.');
    }

    function parseDateInput(value) {
      const input = String(value || '').trim();
      let year;
      let month;
      let day;
      const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const us = input.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
      if (iso) {
        [, year, month, day] = iso.map(Number);
      } else if (us) {
        [, month, day, year] = us.map(Number);
      } else {
        const parsed = new Date(input);
        if (Number.isNaN(parsed.getTime())) return null;
        year = parsed.getFullYear();
        month = parsed.getMonth() + 1;
        day = parsed.getDate();
      }
      const verified = new Date(Date.UTC(year, month - 1, day));
      if (verified.getUTCFullYear() !== year
        || verified.getUTCMonth() + 1 !== month
        || verified.getUTCDate() !== day) return null;
      return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0')
        + '-' + String(day).padStart(2, '0');
    }

    async function mutate(path, body, method = 'POST', message = 'Saving...') {
      sync.textContent = message;
      await api(path, { method, body: JSON.stringify(body) });
      await load();
    }

    function treeRows(items, parentField) {
      const byParent = new Map();
      items.forEach((item) => {
        const parent = item.relationships[parentField] || '';
        byParent.set(parent, [...(byParent.get(parent) || []), item]);
      });
      byParent.forEach((children) => children.sort((a, b) => {
        const leftOrder = a.kind === 'Account'
          ? accountDisplayOrder(a.metadata.id)
          : Number(a.spec.order);
        const rightOrder = b.kind === 'Account'
          ? accountDisplayOrder(b.metadata.id)
          : Number(b.spec.order);
        return leftOrder - rightOrder || String(a.spec.name).localeCompare(String(b.spec.name));
      }));
      const rows = [];
      const append = (parent, depth) => (byParent.get(parent) || []).forEach((item) => {
        rows.push({ item, depth });
        append(item.metadata.id, depth + 1);
      });
      append('', 0);
      return rows;
    }

    function fillDataLists() {
      document.querySelector('#accountOptions').innerHTML = state.accounts.map(
        (item) => '<option value="' + escapeHtml(item.spec.name) + '"></option>',
      ).join('');
      document.querySelector('#budgetOptions').innerHTML = state.budgets.map(
        (item) => '<option value="' + escapeHtml(item.spec.name) + '"></option>',
      ).join('');
    }

    function idFromInput(name, resources, required = true) {
      const resource = resources.find((item) => item.spec.name === name || item.metadata.id === name);
      if (!resource && required) throw new Error('Choose a value from the list.');
      return resource?.metadata.id;
    }
    function accountName(id) { return state.accounts.find((item) => item.metadata.id === id)?.spec.name || ''; }
    function budgetName(id) { return state.budgets.find((item) => item.metadata.id === id)?.spec.name || ''; }
    function accountDisplayOrder(id) {
      return state.accountOrder.find((item) => item.accountId === id)?.order ?? Number.MAX_SAFE_INTEGER;
    }
    function pendingChange(item) {
      return state.pendingChanges.find((change) =>
        change.resourceKind === item.kind && change.resourceId === item.metadata.id);
    }
    function pendingClass(item) { return pendingChange(item) ? ' pending-change' : ''; }
    function changedClass(item, fields) {
      const changed = pendingChange(item)?.changedFields || [];
      return fields.some((field) => changed.includes(field)) ? 'changed-value' : '';
    }
    function pendingCommitBar(item) {
      const change = pendingChange(item);
      if (!change) return '';
      return '<button type="button" class="pending-commit-bar"'
        + ' data-resource-kind="' + escapeHtml(item.kind) + '"'
        + ' data-resource-id="' + escapeHtml(item.metadata.id) + '"'
        + ' title="Double-click to accept this atomic Change Set"'
        + ' aria-label="Accept pending changes"></button>';
    }
    function matchesSearch(item) {
      return JSON.stringify([item.spec, item.status]).toLowerCase().includes(state.search.toLowerCase());
    }
    function groupBy(items, key) {
      const groups = new Map();
      items.forEach((item) => {
        const value = key(item);
        groups.set(value, [...(groups.get(value) || []), item]);
      });
      return groups;
    }
    function monthLabel(value) {
      return new Date(value + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    function headerRow(labels) {
      return '<div class="tree-row muted">' + labels.map((label) => '<strong>' + label + '</strong>').join('') + '</div>';
    }
    function treeName(item, depth, extra = '', action = 'edit-budget') {
      const positionFields = item.kind === 'Account'
        ? ['spec.name', 'relationships.parentAccountId']
        : ['spec.name', 'spec.order', 'relationships.parentBudgetId'];
      return '<div class="tree-name"><span class="indent" style="width:' + (depth * 20) + 'px"></span>'
        + '<button type="button" class="budget-link ' + changedClass(item, positionFields)
        + '" data-action="' + action + '" data-id="' + item.metadata.id + '">' + escapeHtml(item.spec.name) + '</button>'
        + extra + '</div>';
    }
    function moneyCell(value, className = '') {
      return '<span class="money ' + className + '">' + formatMoney(value) + '</span>';
    }
    function restoreActiveTab() {
      const value = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      return ['accounts', 'budgets', 'transactions', 'staged'].includes(value)
        ? value
        : 'transactions';
    }
    function formatMoney(value) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value || 0));
    }
    function empty(message) { return '<div class="empty">' + escapeHtml(message) + '</div>'; }
    function resourceInput(id, list, value, placeholder) {
      return '<input id="' + id + '" list="' + list + '" value="' + escapeHtml(value || '') + '" placeholder="' + escapeHtml(placeholder) + '">';
    }
    function field(name, label, value = '', type = 'text', step = '', required = true) {
      const dateAttributes = type === 'date'
        ? ' type="text" data-date-input inputmode="numeric" placeholder="MM/DD/YYYY or YYYY-MM-DD"'
        : ' type="' + type + '"';
      return '<div class="field"><label>' + escapeHtml(label) + '</label><input name="' + name + '"'
        + dateAttributes + ' value="' + escapeHtml(value) + '"' + (step ? ' step="' + step + '"' : '')
        + (required ? ' required' : '') + '></div>';
    }
    function textarea(name, label, value = '') {
      return '<div class="field"><label>' + escapeHtml(label) + '</label><textarea name="' + name + '" rows="4">' + escapeHtml(value) + '</textarea></div>';
    }
    function checkbox(name, label, checked) {
      return '<div class="field"><label><input style="width:auto" name="' + name + '" type="checkbox" ' + (checked ? 'checked' : '') + '> ' + escapeHtml(label) + '</label></div>';
    }
    function selectField(name, label, options, selected) {
      return '<div class="field"><label>' + escapeHtml(label) + '</label><select name="' + name + '">'
        + options.map((option) => '<option value="' + escapeHtml(option) + '"'
          + (option === selected ? ' selected' : '') + '>' + escapeHtml(option) + '</option>').join('')
        + '</select></div>';
    }
    function resourceField(name, label, list, value = '') {
      return '<div class="field"><label>' + escapeHtml(label) + '</label><input name="' + name + '" list="' + list + '" value="' + escapeHtml(value) + '"></div>';
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[character]);
    }

    load();
    setInterval(async () => {
      try {
        const value = await api('/api/change-version');
        if (state.changeVersion < 0) state.changeVersion = value.version;
        else if (value.version !== state.changeVersion) {
          state.changeVersion = value.version;
          await load();
        }
        if (sync.classList.contains('error')) {
          sync.textContent = 'Up to date';
          sync.className = '';
        }
      } catch (error) {
        sync.textContent = 'Refresh failed: ' + error.message;
        sync.className = 'error';
      }
    }, 3000);
  </script>
</body>
</html>`;
