import * as crypto from 'node:crypto';

/**
 * Self-contained dashboard document: no external resources, strict CSP,
 * all rendering done client-side from posted report data. Localized
 * strings are resolved host-side and injected as a catalog.
 */
export function renderDashboardHtml(strings: Record<string, string>): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Copilot Cost Lens</title>
<style nonce="${nonce}">
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground);
    --card: var(--vscode-editorWidget-background, rgba(128,128,128,0.08));
    --border: var(--vscode-widget-border, rgba(128,128,128,0.18));
    --accent: var(--vscode-charts-blue, #3794ff);
    --c1: var(--vscode-charts-blue, #3794ff);
    --c2: var(--vscode-charts-purple, #b180d7);
    --c3: var(--vscode-charts-green, #89d185);
    --c4: var(--vscode-charts-orange, #d18616);
    --c5: var(--vscode-charts-yellow, #cca700);
    --c6: var(--vscode-charts-red, #f14c4c);
    --warn: var(--vscode-charts-orange, #d18616);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 18px 20px 36px;
    background: var(--bg); color: var(--fg);
    font-family: var(--vscode-font-family); font-size: 13px;
  }
  header {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 18px;
  }
  header h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: 0.2px; }
  header .spacer { flex: 1; }
  select, button {
    background: var(--vscode-dropdown-background, var(--card));
    color: var(--vscode-dropdown-foreground, var(--fg));
    border: 1px solid var(--border); border-radius: 6px;
    padding: 5px 10px; font-size: 12.5px; font-family: inherit; cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  .grid { display: grid; gap: 12px; }
  .kpis { grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); margin-bottom: 12px; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 16px; overflow: hidden;
  }
  .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
  .card .value { font-size: 23px; font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .card .sub { color: var(--muted); margin-top: 4px; font-size: 12px; }
  .charts { grid-template-columns: 3fr 2fr; margin-bottom: 12px; }
  @media (max-width: 760px) { .charts { grid-template-columns: 1fr; } }
  .card h2 { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: var(--fg); }
  .gauge { height: 7px; border-radius: 4px; background: rgba(128,128,128,0.18); margin-top: 10px; overflow: hidden; }
  .gauge > div { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--c1), var(--c2)); transition: width .4s ease; }
  .gauge.over > div { background: linear-gradient(90deg, var(--warn), var(--c6)); }
  .allowSelect { margin-top: 8px; width: 100%; }
  svg text { fill: var(--muted); font-size: 10px; font-family: var(--vscode-font-family); }
  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td.models { max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 500; }
  td.num, th.num { text-align: right; }
  tr:last-child td { border-bottom: none; }
  tbody tr.clickable { cursor: pointer; }
  tbody tr.clickable:hover td { background: rgba(128,128,128,0.07); }
  .sharebar { display: inline-block; height: 5px; border-radius: 3px; background: linear-gradient(90deg, var(--c1), var(--c2)); vertical-align: middle; margin-right: 8px; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 10.5px; background: rgba(128,128,128,0.15); color: var(--muted); margin-left: 6px; }
  .legend { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
  .legend .row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .legend .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .legend .name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .legend .val { color: var(--muted); font-variant-numeric: tabular-nums; }
  .loader { display: flex; justify-content: center; padding: 90px 0; }
  .spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--border);
    border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .empty { text-align: center; color: var(--muted); padding: 50px 20px; }
  .empty .icon { font-size: 32px; margin-bottom: 10px; }
  .hint { color: var(--muted); font-size: 11.5px; margin: 8px 2px 0; }
  footer { color: var(--muted); font-size: 11.5px; margin-top: 16px; line-height: 1.6; }
  .detailbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .detailbar h2 { font-size: 16px; margin: 0; flex: 1; }
  .cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
  .cardhead h2 { margin: 0; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .textinput {
    width: 100%; padding: 7px 10px; border-radius: 6px; font-family: inherit; font-size: 13px;
    background: var(--vscode-input-background, var(--card)); color: var(--vscode-input-foreground, var(--fg));
    border: 1px solid var(--vscode-input-border, var(--border));
  }
  .textinput:focus { outline: 1px solid var(--accent); }
  .picklist {
    max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px;
    padding: 4px; margin-top: 2px;
  }
  .pick {
    display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
  }
  .pick:hover { background: rgba(128,128,128,0.08); }
  td.starcell { width: 22px; color: var(--muted); cursor: pointer; user-select: none; }
  td.starcell.on { color: var(--c5); }
  td.starcell:hover { color: var(--c5); }
  .rowact { float: right; visibility: hidden; }
  tr:hover .rowact, tr:focus-within .rowact { visibility: visible; }
  .rowact button { background: none; border: none; cursor: pointer; color: var(--muted); padding: 0 3px; font-size: 12px; }
  .rowact button:hover { color: inherit; }
  tr.clickable:focus-visible { outline: 1px solid var(--c5); outline-offset: -1px; }
  .hiddenlink { margin-left: 10px; color: var(--muted); font-size: 11px; white-space: nowrap; }
  .pick .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick .val { color: var(--muted); font-variant-numeric: tabular-nums; }
  .chip {
    display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11.5px; cursor: pointer;
    border: 1px solid var(--border); color: var(--muted); white-space: nowrap; user-select: none;
  }
  .chip:hover { border-color: var(--accent); }
  .chip.on { background: var(--accent); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
</style>
</head>
<body>
  <header>
    <h1>Copilot Cost Lens</h1>
    <span class="spacer"></span>
    <select id="month"></select>
    <button id="refresh"></button>
    <button id="exportCsv"></button>
    <button id="exportJson"></button>
    <button id="settings">⚙</button>
  </header>
  <div id="app"><div class="loader"><div class="spinner"></div></div></div>
  <footer id="foot"></footer>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const S = ${JSON.stringify(strings)};
  const app = document.getElementById('app');
  const foot = document.getElementById('foot');
  const monthSel = document.getElementById('month');
  const PALETTE = ['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)'];
  const ALLOWANCE_PRESETS = [1900, 3900, 10000, 100000, 1000000];
  const PROVIDER_NAMES = { 'copilot': S.providerCopilot, 'copilot-cli': S.providerCopilotCli, 'claude-code': S.providerClaudeCode };

  document.getElementById('refresh').textContent = '⟳ ' + S.refresh;
  document.getElementById('refresh').title = S.refreshTitle;
  document.getElementById('exportCsv').textContent = S.exportCsv;
  document.getElementById('exportJson').textContent = S.exportJson;
  document.getElementById('settings').title = S.settingsTitle;

  document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
  document.getElementById('exportCsv').onclick = () => vscode.postMessage({ type: 'export', format: 'csv' });
  document.getElementById('exportJson').onclick = () => vscode.postMessage({ type: 'export', format: 'json' });
  document.getElementById('settings').onclick = () => vscode.postMessage({ type: 'openSettings' });
  monthSel.onchange = () => vscode.postMessage({ type: 'selectMonth', month: monthSel.value });

  let lastMsg = null;
  let editor = null; // { originalName, name, members:Set, deletable }
  let repoFilter = '';
  let repoProvider = null;
  let repoSort = { key: 'credits', dir: -1 };

  let lastRenderKey = null;
  let lastViewKey = null;
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'data') {
      lastMsg = msg;
      if (editor) {
        return; // keep the project editor open; fresh data renders after save/cancel
      }
      // skip the rebuild when nothing changed → no flicker on idle auto-refresh
      if (msg.currency) CUR = msg.currency;
      const key = JSON.stringify([msg.selectedMonth, msg.report, msg.detail, msg.groupDetail, msg.starred, msg.groupsConfig, msg.currency, msg.hiddenCount]);
      if (key === lastRenderKey) return;
      lastRenderKey = key;
      // same view (just refreshed data) → keep scroll; navigation → back to top
      const viewKey = JSON.stringify([msg.selectedMonth, msg.detail && msg.detail.summary.repo.name, msg.groupDetail && msg.groupDetail.group.name]);
      const y = window.scrollY;
      render(msg);
      window.scrollTo(0, viewKey === lastViewKey ? y : 0);
      lastViewKey = viewKey;
    }
  });
  vscode.postMessage({ type: 'ready' });

  let CUR = { code: 'USD', rate: 1 };
  const usd = (v) => CUR.code === 'USD' ? '$' + v.toFixed(2) : (v * CUR.rate).toFixed(2) + ' ' + CUR.code;
  const cr = (v) => v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const tok = (v) => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : String(v);
  // effective blended price actually paid per 1M tokens (cache effects included)
  const effRate = (m) => {
    const total = (m.inputTokens || 0) + (m.outputTokens || 0) + (m.cachedTokens || 0) + (m.cacheWriteTokens || 0);
    return total > 0 ? usd((m.usd / total) * 1e6) : '—';
  };
  const tpl = (s, ...args) => s.replace(/\\{(\\d+)\\}/g, (_, i) => args[+i] ?? '');

  function render(msg) {
    const { report: r, months, selectedMonth, detail, groupDetail, stats } = msg;
    monthSel.innerHTML =
      '<option value="all"' + (selectedMonth === 'all' ? ' selected' : '') + '>' + esc(S.allTime) + '</option>' +
      months.map((m) => '<option value="' + m + '"' + (m === selectedMonth ? ' selected' : '') + '>' + m + '</option>').join('');

    if (groupDetail) {
      renderGroupDetail(groupDetail);
    } else if (detail) {
      renderDetail(detail);
    } else {
      renderOverview(r, selectedMonth);
    }
    appendStats(stats);
  }

  function appendStats(stats) {
    if (!stats) return;
    const parts = Object.entries(stats.providers || {}).map(([p, n]) => (PROVIDER_NAMES[p] || p) + ' ' + n);
    let line = '<br>' + esc(S.footStats) + ': ' + (parts.join(' · ') || '0');
    if (stats.newestTimestamp > 0) {
      line += ' · ' + esc(S.footNewest) + ' ' + new Date(stats.newestTimestamp).toLocaleDateString();
    }
    if ((stats.errors || []).length > 0) {
      line += '<br><span style="color:var(--c6)">' + stats.errors.map(esc).join('<br>') + '</span>';
    }
    foot.innerHTML += line;
  }

  function renderOverview(r, selectedMonth) {
    if (!r || r.requestCount === 0) {
      // distinguish "no data anywhere" from "no data in this period"
      const totalEvents = lastMsg && lastMsg.stats
        ? Object.values(lastMsg.stats.providers || {}).reduce((a, b) => a + b, 0) : 0;
      const dataElsewhere = totalEvents > 0 && selectedMonth !== 'all';
      app.innerHTML = '<div class="card empty"><div class="icon">📊</div>' +
        (dataElsewhere
          ? '<p>' + esc(tpl(S.emptyOtherPeriod, periodName(selectedMonth))) + '</p>' +
            '<button id="viewAll" class="primary">' + esc(S.viewAllTime) + '</button>'
          : '<p>' + esc(S.emptyTitle) + '</p><p>' + esc(S.emptyHint) + '</p>') +
        '</div>';
      const viewAll = document.getElementById('viewAll');
      if (viewAll) viewAll.onclick = () => vscode.postMessage({ type: 'selectMonth', month: 'all' });
      foot.innerHTML = '';
      return;
    }

    const overBudget = r.includedCredits > 0 && r.copilotCredits > r.includedCredits;
    const pct = r.includedCredits > 0 ? Math.min(100, r.usedPercent) : 0;
    const providerSplit = (r.providers || []).map((p) => (PROVIDER_NAMES[p.provider] || p.provider) + ' ' + usd(p.usd)).join(' · ');
    const periodLabel = selectedMonth === 'all' ? S.allTime : r.month;

    const trendChart = selectedMonth === 'all'
      ? '<div class="card" style="margin-bottom:12px"><h2>' + esc(S.monthlySpend) + '</h2>' + monthBars(r.monthsSeries) + '</div>'
      : '<div class="card" style="margin-bottom:12px"><h2>' + esc(S.dailySpend) + '</h2>' + dailyArea(r.days) + '</div>';

    app.innerHTML =
      '<div class="grid kpis">' +
        kpiSpend(r, periodLabel, providerSplit, selectedMonth) +
        kpiGauge(r, pct, overBudget, selectedMonth) +
        kpi(S.forecast, usd(r.forecastUsd), cr(r.forecastCredits) + ' ' + S.creditsAtPace) +
        kpi(S.activity, r.requestCount.toLocaleString() + ' ' + S.req, tpl(S.sessionsRepos, r.sessionCount, r.repos.length)) +
      '</div>' +
      '<div class="grid charts">' +
        '<div class="card"><h2>' + esc(S.costByRepo) + '</h2>' + repoBars(r.repos) + '</div>' +
        '<div class="card"><h2>' + esc(S.costByModel) + '</h2>' + modelDonut(r.models) + '</div>' +
      '</div>' +
      trendChart +
      ((r.heatmap || []).some((d) => d.credits > 0)
        ? '<div class="card" style="margin-bottom:12px"><h2>' + esc(S.activityHeatmap) + '</h2>' + heatmapGrid(r.heatmap) + '</div>'
        : '') +
      ((r.groups || []).length > 0
        ? '<div class="card" style="margin-bottom:12px"><div class="cardhead"><h2>' + esc(S.projects) + '</h2>' +
          '<button id="newGroup">＋ ' + esc(S.newProject) + '</button></div>' + groupTable(r) + '</div>'
        : '<div class="card" style="margin-bottom:12px"><div class="cardhead"><h2>' + esc(S.projects) + '</h2>' +
          '<button id="newGroup">＋ ' + esc(S.newProject) + '</button></div>' +
          '<div class="sub">' + esc(S.projectsEmptyHint) + '</div></div>') +
      starredCard(r) +
      '<div class="card"><div class="cardhead"><h2>' + esc(S.repositories) + '</h2>' +
        '<div style="display:flex;gap:8px;align-items:center">' + providerChips(r) +
        '<input id="repoFilter" class="textinput" style="max-width:230px" placeholder="' + esc(S.filterRepos) + '">' +
        (lastMsg && lastMsg.hiddenCount > 0
          ? '<a href="#" id="manageHidden" class="hiddenlink">' + esc(S.hiddenManage.replace('{0}', lastMsg.hiddenCount)) + '</a>'
          : '') +
        '</div></div>' +
        repoTableDynamic() + '<div class="hint">' + esc(S.detailHint) + '</div></div>';

    bindAllowance();
    bindGroupRows();
    const newGroup = document.getElementById('newGroup');
    if (newGroup) newGroup.onclick = () => openEditor(null);

    for (const chip of document.querySelectorAll('.chip[data-provider]')) {
      chip.onclick = () => {
        repoProvider = repoProvider === chip.dataset.provider ? null : chip.dataset.provider;
        renderOverview(lastMsg.report, lastMsg.selectedMonth);
      };
    }

    const filterInput = document.getElementById('repoFilter');
    filterInput.value = repoFilter;
    filterInput.oninput = () => { repoFilter = filterInput.value; refreshRepoTbody(); };
    for (const th of document.querySelectorAll('th[data-sort]')) {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (repoSort.key === key) repoSort.dir = -repoSort.dir;
        else repoSort = { key, dir: key === 'name' ? 1 : -1 };
        renderOverview(lastMsg.report, lastMsg.selectedMonth);
      };
    }
    refreshRepoTbody();
    bindRepoRows();
    bindStars();

    foot.innerHTML = esc(S.footSources) + '<br>' + esc(S.footAllowance) +
      (r.hasEstimates ? '<br>' + esc(S.footEstimates) : '');
  }

  function renderDetail(d) {
    const s = d.summary;
    const periodLabel = d.month === 'all' ? S.allTime : d.month;
    const models = (s.models || []);
    const sources = (d.providers || []).map((p) =>
      '<div class="row"><span class="dot" style="background:var(--c1)"></span><span class="name">' +
      esc(PROVIDER_NAMES[p.provider] || p.provider) + '</span><span class="val">' + usd(p.usd) + ' · ' + p.requestCount + '×</span></div>').join('');

    // share of context read from cache; Copilot reports cache reads as a
    // subset of input, Claude Code reports them separately
    const denom = s.inputTokens >= s.cachedTokens ? s.inputTokens : s.inputTokens + s.cachedTokens;
    const cacheShare = denom > 0 ? (s.cachedTokens / denom) * 100 : 0;

    const sessionsRows = (d.topSessions || []).map((sess) =>
      '<tr><td>' + new Date(sess.lastTimestamp).toLocaleDateString() + '</td>' +
      '<td class="models" title="' + esc(sess.sessionId) + '">' + esc(sess.models.join(', ')) + '</td>' +
      '<td>' + esc(PROVIDER_NAMES[sess.provider] || sess.provider) + '</td>' +
      '<td class="num">' + sess.requestCount + '</td>' +
      '<td class="num">' + cr(sess.credits) + '</td>' +
      '<td class="num"><b>' + usd(sess.usd) + '</b></td></tr>').join('');

    app.innerHTML =
      '<div class="detailbar">' +
        '<button id="back">← ' + esc(S.back) + '</button>' +
        '<h2>' + esc(s.repo.name) + (s.hasEstimates ? '<span class="badge">~est</span>' : '') + '</h2>' +
        '<button id="receipt">🧾 ' + esc(S.receiptPdf) + '</button>' +
        (s.repo.folderPath ? '<button id="openRepo">📂 ' + esc(S.openFolder) + '</button>' : '') +
        '<button id="renameRepo" title="' + esc(S.renameRepoTitle) + '">✎ ' + esc(S.renameRepo) + '</button>' +
        '<button id="hideRepo" title="' + esc(S.hideRepoTitle) + '">🙈 ' + esc(S.hideRepo) + '</button>' +
      '</div>' +
      '<div class="grid kpis">' +
        kpi(S.spend + ' · ' + periodLabel, usd(s.usd), cr(s.credits) + ' ' + S.aiCredits) +
        kpi(S.activity, s.requestCount.toLocaleString() + ' ' + S.req, s.sessionCount + ' ' + S.colSessions.toLowerCase()) +
        kpi(S.colInput + ' / ' + S.colOutput, tok(s.inputTokens) + ' / ' + tok(s.outputTokens), S.tokenAnatomy) +
        kpi(S.colCacheR + ' / ' + S.colCacheW, tok(s.cachedTokens) + ' / ' + tok(s.cacheWriteTokens), S.tokenAnatomy) +
        kpi(S.cacheShare, cacheShare.toFixed(0) + '%', S.cacheShareSub) +
      '</div>' +
      '<div class="grid charts">' +
        '<div class="card"><h2>' + esc(S.costByModel) + '</h2><div class="tablewrap"><table><thead><tr>' +
          '<th>' + esc(S.colModels) + '</th><th class="num">' + esc(S.colReq) + '</th><th class="num" title="' + esc(S.effRateHint) + '">' + esc(S.colPerM) + '</th><th class="num">' + esc(S.colCredits) + '</th><th class="num">' + esc(S.colSpend) + '</th></tr></thead><tbody>' +
          models.map((m) => '<tr><td>' + esc(m.model) + '</td><td class="num">' + m.requestCount + '</td><td class="num" title="' + esc(S.effRateHint) + '">' + effRate(m) + '</td><td class="num">' + cr(m.credits) + '</td><td class="num"><b>' + usd(m.usd) + '</b></td></tr>').join('') +
        '</tbody></table></div></div>' +
        '<div class="card"><h2>' + esc(S.bySource) + '</h2><div class="legend">' + sources + '</div>' +
          '<div class="sub" style="margin-top:12px">' + esc(S.firstActivity) + ': ' + new Date(d.firstActivity).toLocaleDateString() +
          ' · ' + esc(S.lastActivity) + ': ' + new Date(s.lastActivity).toLocaleDateString() + '</div></div>' +
      '</div>' +
      ((d.topSessions || []).length > 0
        ? '<div class="card" style="margin-bottom:12px"><h2>' + esc(S.topSessions) + '</h2><div class="tablewrap"><table><thead><tr>' +
          '<th>' + esc(S.colDate) + '</th><th>' + esc(S.colModels) + '</th><th>' + esc(S.colSource) + '</th>' +
          '<th class="num">' + esc(S.colReq) + '</th><th class="num">' + esc(S.colCredits) + '</th><th class="num">' + esc(S.colSpend) + '</th></tr></thead>' +
          '<tbody>' + sessionsRows + '</tbody></table></div></div>'
        : '') +
      '<div class="card"><h2>' + esc(S.dailySpend) + '</h2>' + dailyArea(d.days) + '</div>';

    document.getElementById('back').onclick = () => vscode.postMessage({ type: 'selectRepo', repo: null });
    document.getElementById('receipt').onclick = () => vscode.postMessage({ type: 'exportReceipt', repo: s.repo.name });
    const openBtn = document.getElementById('openRepo');
    if (openBtn) openBtn.onclick = () => vscode.postMessage({ type: 'openRepo', path: s.repo.folderPath });
    document.getElementById('renameRepo').onclick = () => vscode.postMessage({ type: 'renameRepo', repo: s.repo.name });
    document.getElementById('hideRepo').onclick = () => vscode.postMessage({ type: 'toggleHidden', repo: s.repo.name });
    foot.innerHTML = esc(S.footSources);
  }

  function renderGroupDetail(d) {
    const g = d.group;
    const periodLabel = d.month === 'all' ? S.allTime : d.month;
    const sources = (d.providers || []).map((p) =>
      '<div class="row"><span class="dot" style="background:var(--c1)"></span><span class="name">' +
      esc(PROVIDER_NAMES[p.provider] || p.provider) + '</span><span class="val">' + usd(p.usd) + ' · ' + p.requestCount + '×</span></div>').join('');

    const repoRows = g.repos.map((repo) =>
      '<tr class="clickable" data-repo="' + esc(repo.repo.name) + '"><td>' + esc(repo.repo.name) + (repo.hasEstimates ? '<span class="badge">~est</span>' : '') + '</td>' +
      '<td class="num">' + repo.requestCount + '</td>' +
      '<td class="num">' + tok(repo.inputTokens) + ' / ' + tok(repo.outputTokens) + '</td>' +
      '<td class="num">' + cr(repo.credits) + '</td>' +
      '<td class="num"><b>' + usd(repo.usd) + '</b></td>' +
      '<td class="num">' + ((repo.credits / (g.credits || 1)) * 100).toFixed(1) + '%</td></tr>').join('');

    const modelRows = (g.models || []).map((m) =>
      '<tr><td>' + esc(m.model) + '</td><td class="num">' + m.requestCount + '</td><td class="num" title="' + esc(S.effRateHint) + '">' + effRate(m) + '</td><td class="num">' + cr(m.credits) + '</td><td class="num"><b>' + usd(m.usd) + '</b></td></tr>').join('');

    app.innerHTML =
      '<div class="detailbar">' +
        '<button id="back">← ' + esc(S.back) + '</button>' +
        '<h2>📁 ' + esc(g.name) + (g.hasEstimates ? '<span class="badge">~est</span>' : '') + '</h2>' +
        '<button id="groupReceipt">🧾 ' + esc(S.receiptPdf) + '</button>' +
        '<button id="editGroup">✏️ ' + esc(S.editProject) + '</button>' +
        '<button id="deleteGroup">🗑 ' + esc(S.deleteProject) + '</button>' +
      '</div>' +
      '<div class="grid kpis">' +
        kpi(S.spend + ' · ' + periodLabel, usd(g.usd), cr(g.credits) + ' ' + S.aiCredits) +
        kpi(S.activity, g.requestCount.toLocaleString() + ' ' + S.req, g.sessionCount + ' ' + S.colSessions.toLowerCase()) +
        kpi(S.colInput + ' / ' + S.colOutput, tok(g.inputTokens) + ' / ' + tok(g.outputTokens), S.tokenAnatomy) +
        kpi(S.colCacheR + ' / ' + S.colCacheW, tok(g.cachedTokens) + ' / ' + tok(g.cacheWriteTokens), S.tokenAnatomy) +
      '</div>' +
      '<div class="card" style="margin-bottom:12px"><h2>' + esc(S.reposInProject) + '</h2><div class="tablewrap"><table><thead><tr>' +
        '<th>' + esc(S.colRepository) + '</th><th class="num">' + esc(S.colReq) + '</th><th class="num">' + esc(S.colInput) + '/' + esc(S.colOutput) + '</th>' +
        '<th class="num">' + esc(S.colCredits) + '</th><th class="num">' + esc(S.colSpend) + '</th><th class="num">' + esc(S.colShare) + '</th></tr></thead>' +
        '<tbody>' + repoRows + '</tbody></table></div></div>' +
      '<div class="grid charts">' +
        '<div class="card"><h2>' + esc(S.costByModel) + '</h2><div class="tablewrap"><table><thead><tr>' +
          '<th>' + esc(S.colModels) + '</th><th class="num">' + esc(S.colReq) + '</th><th class="num" title="' + esc(S.effRateHint) + '">' + esc(S.colPerM) + '</th><th class="num">' + esc(S.colCredits) + '</th><th class="num">' + esc(S.colSpend) + '</th></tr></thead>' +
          '<tbody>' + modelRows + '</tbody></table></div></div>' +
        '<div class="card"><h2>' + esc(S.bySource) + '</h2><div class="legend">' + sources + '</div></div>' +
      '</div>' +
      '<div class="card"><h2>' + esc(S.dailySpend) + '</h2>' + dailyArea(d.days) + '</div>';

    document.getElementById('back').onclick = () => vscode.postMessage({ type: 'selectGroup', group: null });
    document.getElementById('groupReceipt').onclick = () => vscode.postMessage({ type: 'exportReceipt', group: g.name });
    document.getElementById('editGroup').onclick = () => openEditor(g);
    document.getElementById('deleteGroup').onclick = () => vscode.postMessage({ type: 'deleteGroup', group: g.name });
    bindRepoRows();
    foot.innerHTML = esc(S.footSources);
  }

  // ---- inline project editor -------------------------------------------

  function openEditor(group) {
    editor = {
      originalName: group ? group.name : null,
      name: group ? group.name : '',
      members: new Set(group ? group.repos.map((r) => r.repo.name) : []),
    };
    renderEditor();
  }

  function closeEditor() {
    editor = null;
    if (lastMsg) render(lastMsg);
  }

  function renderEditor() {
    // repos already claimed by another project are not offered again
    const assignedElsewhere = projectRepoSet(editor.originalName);
    const allRepos = ((lastMsg && lastMsg.allRepos) || []).filter(
      (r) => !assignedElsewhere.has(r.name.toLowerCase()) || editor.members.has(r.name));
    const rows = allRepos.map((r) =>
      '<label class="pick"><input type="checkbox" data-repo="' + esc(r.name) + '"' +
      (editor.members.has(r.name) ? ' checked' : '') + '> <span class="name">' + esc(r.name) +
      '</span><span class="val">' + usd(r.usd) + '</span></label>').join('');

    app.innerHTML =
      '<div class="detailbar">' +
        '<button id="cancelTop">← ' + esc(S.cancel) + '</button>' +
        '<h2>' + (editor.originalName ? '✏️ ' + esc(editor.originalName) : '📁 ' + esc(S.newProject)) + '</h2>' +
      '</div>' +
      '<div class="card" style="max-width:640px">' +
        '<div class="label">' + esc(S.projectNameLabel) + '</div>' +
        '<input id="gname" type="text" class="textinput" value="' + esc(editor.name) + '" placeholder="' + esc(S.projectNamePlaceholder) + '">' +
        '<div class="label" style="margin-top:14px">' + esc(S.selectReposLabel) + ' <span id="pickCount" class="badge"></span></div>' +
        '<div class="picklist">' + rows + '</div>' +
        '<div id="editErr" class="sub" style="color:var(--c6);min-height:16px"></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
          '<button id="saveGroup" class="primary">💾 ' + esc(S.save) + '</button>' +
          '<button id="cancelGroup">' + esc(S.cancel) + '</button>' +
        '</div>' +
      '</div>';
    foot.innerHTML = '';

    const nameInput = document.getElementById('gname');
    const count = document.getElementById('pickCount');
    const updateCount = () => { count.textContent = String(editor.members.size); };
    updateCount();
    nameInput.oninput = () => { editor.name = nameInput.value; };
    for (const box of document.querySelectorAll('.picklist input[type=checkbox]')) {
      box.onchange = () => {
        if (box.checked) editor.members.add(box.dataset.repo);
        else editor.members.delete(box.dataset.repo);
        updateCount();
      };
    }
    document.getElementById('cancelTop').onclick = closeEditor;
    document.getElementById('cancelGroup').onclick = closeEditor;
    document.getElementById('saveGroup').onclick = () => {
      const name = editor.name.trim();
      const err = document.getElementById('editErr');
      if (!name) { err.textContent = S.errNameRequired; return; }
      if (editor.members.size === 0) { err.textContent = S.errPickRepo; return; }
      vscode.postMessage({
        type: 'saveGroup',
        originalName: editor.originalName || undefined,
        name,
        members: [...editor.members],
      });
      editor = null;
    };
    nameInput.focus();
  }

  function keyable(row) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.onclick(); }
    };
  }

  function bindRepoRows() {
    for (const row of document.querySelectorAll('tr.clickable[data-repo]')) {
      row.onclick = () => vscode.postMessage({ type: 'selectRepo', repo: row.dataset.repo });
      keyable(row);
    }
    for (const btn of document.querySelectorAll('.rowact button')) {
      btn.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({
          type: btn.classList.contains('act-rename') ? 'renameRepo' : 'toggleHidden',
          repo: btn.dataset.repo,
        });
      };
    }
    const hiddenLink = document.getElementById('manageHidden');
    if (hiddenLink) hiddenLink.onclick = (e) => { e.preventDefault(); vscode.postMessage({ type: 'manageHidden' }); };
  }

  function bindGroupRows() {
    for (const row of document.querySelectorAll('tr.clickable[data-group]')) {
      row.onclick = () => vscode.postMessage({ type: 'selectGroup', group: row.dataset.group });
      keyable(row);
    }
  }

  function groupTable(r) {
    const rows = r.groups.map((g) => {
      const members = g.repos.map((x) => x.repo.name).join(', ');
      return '<tr class="clickable" data-group="' + esc(g.name) + '"><td>📁 <b>' + esc(g.name) + '</b>' + (g.hasEstimates ? '<span class="badge">~est</span>' : '') + '</td>' +
        '<td class="models" title="' + esc(members) + '">' + esc(members) + '</td>' +
        '<td class="num">' + g.requestCount + '</td>' +
        '<td class="num">' + g.sessionCount + '</td>' +
        '<td class="num">' + tok(g.inputTokens) + ' / ' + tok(g.outputTokens) + '</td>' +
        '<td class="num">' + cr(g.credits) + '</td>' +
        '<td class="num"><b>' + usd(g.usd) + '</b></td></tr>';
    }).join('');
    return '<div class="tablewrap"><table><thead><tr><th>' + esc(S.projects) + '</th><th>' + esc(S.colRepository) + '</th>' +
      '<th class="num">' + esc(S.colReq) + '</th><th class="num">' + esc(S.colSessions) + '</th><th class="num">' + esc(S.colInput) + '/' + esc(S.colOutput) + '</th>' +
      '<th class="num">' + esc(S.colCredits) + '</th><th class="num">' + esc(S.colSpend) + '</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function bindAllowance() {
    const select = document.getElementById('allow');
    if (!select) return;
    select.onchange = () => {
      const v = select.value;
      vscode.postMessage({ type: 'setAllowance', value: v === 'custom' ? 'custom' : Number(v) });
    };
  }

  function kpi(label, value, sub) {
    return '<div class="card"><div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function kpiSpend(r, periodLabel, providerSplit, selectedMonth) {
    let trend = '';
    if (selectedMonth !== 'all' && r.prevMonthUsd !== undefined && r.prevMonthUsd > 0) {
      const delta = ((r.totalUsd - r.prevMonthUsd) / r.prevMonthUsd) * 100;
      const up = delta >= 0;
      trend = ' <span style="font-size:13px;color:var(' + (up ? '--c4' : '--c3') + ')">' +
        (up ? '▲' : '▼') + Math.abs(delta).toFixed(0) + '% ' + esc(S.vsPrevMonth) + '</span>';
    }
    return '<div class="card"><div class="label">' + esc(S.spend + ' · ' + periodLabel) + '</div>' +
      '<div class="value">' + esc(usd(r.totalUsd)) + trend + '</div>' +
      '<div class="sub">' + esc(providerSplit || (cr(r.totalCredits) + ' ' + S.aiCredits)) + '</div></div>';
  }

  function kpiGauge(r, pct, over, selectedMonth) {
    if (selectedMonth === 'all') {
      return kpi(S.allowance, '—', S.allTime);
    }
    const isPreset = ALLOWANCE_PRESETS.includes(r.includedCredits);
    const options = ALLOWANCE_PRESETS.map((v) =>
      '<option value="' + v + '"' + (v === r.includedCredits ? ' selected' : '') + '>' + v.toLocaleString() + ' AIC</option>').join('') +
      (!isPreset && r.includedCredits > 0 ? '<option value="' + r.includedCredits + '" selected>' + r.includedCredits.toLocaleString() + ' AIC</option>' : '') +
      '<option value="custom">' + esc(S.custom) + '</option>';
    const exhaustion = r.allowanceExhaustion
      ? '<div class="sub" style="color:var(--warn)">⚠ ' + esc(tpl(S.runsOut, r.allowanceExhaustion)) + '</div>'
      : '';
    return '<div class="card"><div class="label">' + esc(S.allowance) + '</div>' +
      '<div class="value">' + (r.includedCredits > 0 ? r.usedPercent.toFixed(0) + '%' : '—') + '</div>' +
      '<div class="gauge' + (over ? ' over' : '') + '"><div style="width:' + pct + '%"></div></div>' +
      '<div class="sub">' + cr(r.copilotCredits) + ' / ' + r.includedCredits.toLocaleString() + ' ' + esc(S.creditsCopilotOnly) + '</div>' +
      exhaustion +
      '<select id="allow" class="allowSelect">' + options + '</select></div>';
  }

  function monthBars(series) {
    if (!series || series.length === 0) return '<div class="sub">' + esc(S.noData) + '</div>';
    const w = 860, h = 170, padB = 24, padL = 8, padR = 8;
    const max = Math.max(...series.map((m) => m.usd), 1e-9);
    const slot = (w - padL - padR) / series.length;
    const barW = Math.min(56, slot * 0.7);
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" preserveAspectRatio="xMidYMid meet">';
    series.forEach((m, i) => {
      const x = padL + i * slot + (slot - barW) / 2;
      const barH = Math.max(2, (m.usd / max) * (h - padB - 26));
      const y = h - padB - barH;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" rx="4" fill="' + PALETTE[i % 6] + '" opacity="0.85"/>' +
        '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle">' + usd(m.usd) + '</text>' +
        '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle">' + esc(m.month) + '</text>';
    });
    return svg + '</svg>';
  }

  function repoBars(repos) {
    const top = repos.slice(0, 8);
    const max = Math.max(...top.map((x) => x.credits), 1e-9);
    const rowH = 30, w = 560, labelW = 190;
    let svg = '<svg viewBox="0 0 ' + w + ' ' + (top.length * rowH) + '" width="100%" preserveAspectRatio="xMinYMin meet">';
    top.forEach((repo, i) => {
      const y = i * rowH;
      const barW = Math.max(2, (repo.credits / max) * (w - labelW - 80));
      svg += '<text x="0" y="' + (y + 19) + '">' + esc(trunc(repo.repo.name, 28)) + '</text>' +
        '<rect x="' + labelW + '" y="' + (y + 8) + '" width="' + barW + '" height="14" rx="4" fill="' + PALETTE[i % 6] + '" opacity="0.85"/>' +
        '<text x="' + (labelW + barW + 8) + '" y="' + (y + 19) + '">' + usd(repo.usd) + '</text>';
    });
    return svg + '</svg>';
  }

  function modelDonut(models) {
    const top = models.slice(0, 6);
    const total = top.reduce((s, m) => s + m.credits, 0) || 1;
    const R = 52, C = 2 * Math.PI * R;
    let offset = 0;
    let rings = '';
    top.forEach((m, i) => {
      const frac = m.credits / total;
      rings += '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + PALETTE[i % 6] +
        '" stroke-width="16" stroke-dasharray="' + (frac * C) + ' ' + C + '" stroke-dashoffset="' + (-offset * C) +
        '" transform="rotate(-90 70 70)" opacity="0.9"/>';
      offset += frac;
    });
    const legend = top.map((m, i) =>
      '<div class="row" title="' + esc(S.colPerM) + ': ' + effRate(m) + ' (' + esc(S.effRateHint) + ')"><span class="dot" style="background:' + PALETTE[i % 6] + '"></span>' +
      '<span class="name">' + esc(m.model) + '</span><span class="val">' + usd(m.usd) + ' · ' + m.requestCount + '×</span></div>').join('');
    return '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
      '<svg viewBox="0 0 140 140" width="120" height="120">' + rings + '</svg>' +
      '<div class="legend" style="flex:1;min-width:170px">' + legend + '</div></div>';
  }

  function dailyArea(days) {
    if (!days || days.length === 0) return '<div class="sub">' + esc(S.noData) + '</div>';
    const w = 860, h = 150, padB = 22, padL = 8, padR = 46;
    const max = Math.max(...days.map((d) => d.usd), 1e-9);
    const xs = days.map((d, i) => i);
    const span = Math.max(1, days.length - 1);
    const x = (i) => padL + (i / span) * (w - padL - padR);
    const y = (v) => (h - padB) - (v / max) * (h - padB - 14);
    const pts = days.map((d, i) => x(i).toFixed(1) + ',' + y(d.usd).toFixed(1));
    const line = 'M' + pts.join(' L');
    const area = line + ' L' + x(days.length - 1).toFixed(1) + ',' + (h - padB) + ' L' + x(0).toFixed(1) + ',' + (h - padB) + ' Z';
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--c1)" stop-opacity="0.45"/><stop offset="100%" stop-color="var(--c1)" stop-opacity="0.03"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#ag)"/>' +
      '<path d="' + line + '" fill="none" stroke="var(--c1)" stroke-width="2"/>' +
      '<text x="' + (w - padR + 6) + '" y="' + (y(max) + 4) + '">' + usd(max) + '</text>';
    const step = Math.max(1, Math.ceil(days.length / 16));
    days.forEach((d, i) => {
      svg += '<circle cx="' + x(i) + '" cy="' + y(d.usd) + '" r="2.4" fill="var(--c1)"/>';
      if (i % step === 0 || i === days.length - 1) {
        const label = days.length > 31 ? d.day.slice(5) : String(+d.day.slice(-2));
        svg += '<text x="' + x(i) + '" y="' + (h - 6) + '" text-anchor="middle">' + label + '</text>';
      }
    });
    return svg + '</svg>';
  }

  function starredSet() {
    return new Set(((lastMsg && lastMsg.starred) || []).map((s) => String(s).toLowerCase()));
  }

  // Repo names (lowercased) claimed by a project. A repo belongs to at most one
  // project, so these are hidden from the Repositories table — they're counted
  // under their project instead. Pass exceptGroup to ignore one group's members.
  function projectRepoSet(exceptGroup) {
    const set = new Set();
    const cfg = (lastMsg && lastMsg.groupsConfig) || {};
    for (const [gname, members] of Object.entries(cfg)) {
      if (gname === exceptGroup) continue;
      for (const m of members) set.add(String(m).toLowerCase());
    }
    return set;
  }

  function starredCard(r) {
    const starred = starredSet();
    if (starred.size === 0) return '';
    const repos = r.repos.filter((repo) => starred.has(repo.repo.name.toLowerCase()));
    if (repos.length === 0) return '';
    return '<div class="card" style="margin-bottom:12px"><h2>★ ' + esc(S.starred) + '</h2>' +
      repoTable(r, repos) + '</div>';
  }

  function bindStars() {
    for (const cell of document.querySelectorAll('td.starcell')) {
      cell.onclick = (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'toggleStar', repo: cell.dataset.star });
      };
    }
  }

  function buildRepoRows(r, repoList) {
    const starred = starredSet();
    const total = r.totalCredits || 1;
    return repoList.map((repo) => {
      const share = (repo.credits / total) * 100;
      const models = (repo.models || []);
      const shown = models.slice(0, 2).map((m) => esc(m.model)).join(', ');
      const more = models.length > 2 ? ' <span class="badge" title="' + esc(models.slice(2).map((m) => m.model).join(', ')) + '">+' + (models.length - 2) + '</span>' : '';
      const isStar = starred.has(repo.repo.name.toLowerCase());
      return '<tr class="clickable" data-repo="' + esc(repo.repo.name) + '">' +
        '<td class="starcell' + (isStar ? ' on' : '') + '" data-star="' + esc(repo.repo.name) + '" title="' + esc(S.starToggle) + '">' + (isStar ? '★' : '☆') + '</td>' +
        '<td>' + esc(repo.repo.name) + (repo.hasEstimates ? '<span class="badge">~est</span>' : '') +
          '<span class="rowact">' +
          '<button class="act-rename" data-repo="' + esc(repo.repo.name) + '" title="' + esc(S.renameRepoTitle) + '">✎</button>' +
          '<button class="act-hide" data-repo="' + esc(repo.repo.name) + '" title="' + esc(S.hideRepoTitle) + '">🙈</button>' +
          '</span></td>' +
        '<td class="models" title="' + esc(models.map((m) => m.model + ' (' + m.requestCount + '×)').join(', ')) + '">' + shown + more + '</td>' +
        '<td class="num">' + repo.requestCount + '</td>' +
        '<td class="num">' + repo.sessionCount + '</td>' +
        '<td class="num">' + tok(repo.inputTokens) + '</td>' +
        '<td class="num">' + tok(repo.outputTokens) + '</td>' +
        '<td class="num">' + tok(repo.cachedTokens) + '</td>' +
        '<td class="num">' + tok(repo.cacheWriteTokens) + '</td>' +
        '<td class="num">' + cr(repo.credits) + '</td>' +
        '<td class="num"><b>' + usd(repo.usd) + '</b></td>' +
        '<td><span class="sharebar" style="width:' + Math.max(3, share) + 'px"></span>' + share.toFixed(1) + '%</td></tr>';
    }).join('');
  }

  const SORT_GETTERS = {
    name: (x) => x.repo.name.toLowerCase(),
    req: (x) => x.requestCount,
    sessions: (x) => x.sessionCount,
    input: (x) => x.inputTokens,
    output: (x) => x.outputTokens,
    cacher: (x) => x.cachedTokens,
    cachew: (x) => x.cacheWriteTokens,
    credits: (x) => x.credits,
    spend: (x) => x.usd,
  };

  function repoHeaders(sortable) {
    const cols = [
      ['', null], [S.colRepository, 'name'], [S.colModels, null], [S.colReq, 'req'],
      [S.colSessions, 'sessions'], [S.colInput, 'input'], [S.colOutput, 'output'],
      [S.colCacheR, 'cacher'], [S.colCacheW, 'cachew'], [S.colCredits, 'credits'],
      [S.colSpend, 'spend'], [S.colShare, null],
    ];
    return cols.map(([label, key], i) => {
      const num = i >= 3 && i <= 10 ? ' class="num"' : '';
      if (!sortable || !key) return '<th' + num + '>' + esc(label) + '</th>';
      const marker = repoSort.key === key ? (repoSort.dir < 0 ? ' ▼' : ' ▲') : '';
      return '<th' + num + ' data-sort="' + key + '" style="cursor:pointer">' + esc(label) + marker + '</th>';
    }).join('');
  }

  function repoTable(r, repoList) {
    return '<div class="tablewrap"><table><thead><tr>' + repoHeaders(false) + '</tr></thead>' +
      '<tbody>' + buildRepoRows(r, repoList) + '</tbody></table></div>';
  }

  function repoTableDynamic() {
    return '<div class="tablewrap"><table><thead><tr>' + repoHeaders(true) + '</tr></thead>' +
      '<tbody id="repoTbody"></tbody></table></div>';
  }

  function refreshRepoTbody() {
    const tbody = document.getElementById('repoTbody');
    if (!tbody || !lastMsg) return;
    const r = lastMsg.report;
    const needle = repoFilter.trim().toLowerCase();
    let list = r.repos;
    // repos assigned to a project are shown under their project, not here
    const assigned = projectRepoSet();
    if (assigned.size) list = list.filter((repo) => !assigned.has(repo.repo.name.toLowerCase()));
    if (repoProvider) {
      list = list.filter((repo) => (repo.providers || []).includes(repoProvider));
    }
    if (needle) {
      list = list.filter((repo) =>
        repo.repo.name.toLowerCase().includes(needle) ||
        (repo.models || []).some((m) => m.model.toLowerCase().includes(needle)));
    }
    const getter = SORT_GETTERS[repoSort.key] || SORT_GETTERS.credits;
    list = [...list].sort((a, b) => {
      const va = getter(a), vb = getter(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * repoSort.dir;
    });
    tbody.innerHTML = buildRepoRows(r, list);
    bindRepoRows();
    bindStars();
  }

  function providerChips(r) {
    const present = [...new Set((r.repos || []).flatMap((x) => x.providers || []))];
    const order = ['copilot', 'copilot-cli', 'claude-code'];
    return present.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) =>
      '<span class="chip' + (repoProvider === p ? ' on' : '') + '" data-provider="' + p + '">' +
      esc(PROVIDER_NAMES[p] || p) + '</span>').join('');
  }

  function heatmapGrid(days) {
    if (!days || days.length === 0) return '<div class="sub">' + esc(S.noData) + '</div>';
    const max = Math.max(...days.map((d) => d.usd), 1e-9);
    const cell = 13, gap = 3, weeks = Math.ceil(days.length / 7);
    const w = weeks * (cell + gap) + 30, h = 7 * (cell + gap) + 18;
    // align so the last column ends today; first cell's weekday sets the row offset
    const firstDow = (new Date(days[0].day + 'T00:00:00').getDay() + 6) % 7; // Mon=0
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-width:' + w + 'px" preserveAspectRatio="xMinYMin meet">';
    let lastMonth = '';
    days.forEach((d, i) => {
      const idx = i + firstDow;
      const col = Math.floor(idx / 7), row = idx % 7;
      const x = col * (cell + gap), y = row * (cell + gap) + 14;
      const t = d.usd / max;
      const fill = d.usd <= 0 ? 'rgba(128,128,128,0.12)'
        : 'color-mix(in srgb, var(--c1) ' + Math.round(25 + t * 75) + '%, transparent)';
      svg += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="2.5" fill="' + fill + '"><title>' + d.day + ': $' + d.usd.toFixed(2) + '</title></rect>';
      const mon = d.day.slice(0, 7);
      if (row === 0 && mon !== lastMonth) { lastMonth = mon; svg += '<text x="' + x + '" y="10">' + (+d.day.slice(5, 7)) + '/' + d.day.slice(2, 4) + '</text>'; }
    });
    return svg + '</svg>';
  }

  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function periodName(month) { return month === 'all' ? S.allTime : month; }
</script>
</body>
</html>`;
}
