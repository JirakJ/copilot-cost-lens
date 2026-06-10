import * as crypto from 'node:crypto';

/**
 * Self-contained dashboard document: no external resources, strict CSP,
 * all rendering done client-side from posted report data.
 */
export function renderDashboardHtml(): string {
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
    margin: 0; padding: 24px 28px 40px;
    background: var(--bg); color: var(--fg);
    font-family: var(--vscode-font-family); font-size: 13px;
  }
  header {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    margin-bottom: 20px;
  }
  header h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: 0.2px; }
  header .spacer { flex: 1; }
  select, button {
    background: var(--vscode-dropdown-background, var(--card));
    color: var(--vscode-dropdown-foreground, var(--fg));
    border: 1px solid var(--border); border-radius: 6px;
    padding: 5px 10px; font-size: 12.5px; font-family: inherit; cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  .grid { display: grid; gap: 14px; }
  .kpis { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); margin-bottom: 14px; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px 18px; overflow: hidden;
  }
  .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
  .card .value { font-size: 24px; font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .card .sub { color: var(--muted); margin-top: 4px; font-size: 12px; }
  .charts { grid-template-columns: 3fr 2fr; margin-bottom: 14px; }
  @media (max-width: 760px) { .charts { grid-template-columns: 1fr; } }
  .card h2 { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: var(--fg); }
  .gauge { height: 7px; border-radius: 4px; background: rgba(128,128,128,0.18); margin-top: 10px; overflow: hidden; }
  .gauge > div { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--c1), var(--c2)); transition: width .4s ease; }
  .gauge.over > div { background: linear-gradient(90deg, var(--warn), var(--c6)); }
  svg text { fill: var(--muted); font-size: 10px; font-family: var(--vscode-font-family); }
  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td.models { max-width: 230px; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 500; }
  td.num, th.num { text-align: right; }
  tr:last-child td { border-bottom: none; }
  .sharebar { display: inline-block; height: 5px; border-radius: 3px; background: linear-gradient(90deg, var(--c1), var(--c2)); vertical-align: middle; margin-right: 8px; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 10.5px; background: rgba(128,128,128,0.15); color: var(--muted); margin-left: 6px; }
  .legend { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
  .legend .row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .legend .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .legend .name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .legend .val { color: var(--muted); font-variant-numeric: tabular-nums; }
  .empty { text-align: center; color: var(--muted); padding: 60px 20px; }
  .empty .icon { font-size: 34px; margin-bottom: 10px; }
  footer { color: var(--muted); font-size: 11.5px; margin-top: 18px; line-height: 1.6; }
</style>
</head>
<body>
  <header>
    <h1>Copilot Cost Lens</h1>
    <span class="spacer"></span>
    <select id="month"></select>
    <button id="refresh" title="Rescan usage logs">⟳ Refresh</button>
    <button id="exportCsv">Export CSV</button>
    <button id="exportJson">Export JSON</button>
    <button id="settings" title="Open settings">⚙</button>
  </header>
  <div id="app"></div>
  <footer id="foot"></footer>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const foot = document.getElementById('foot');
  const monthSel = document.getElementById('month');
  const PALETTE = ['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)'];

  document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
  document.getElementById('exportCsv').onclick = () => vscode.postMessage({ type: 'export', format: 'csv' });
  document.getElementById('exportJson').onclick = () => vscode.postMessage({ type: 'export', format: 'json' });
  document.getElementById('settings').onclick = () => vscode.postMessage({ type: 'openSettings' });
  monthSel.onchange = () => vscode.postMessage({ type: 'selectMonth', month: monthSel.value });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'data') render(msg.report, msg.months, msg.selectedMonth);
  });
  vscode.postMessage({ type: 'ready' });

  const usd = (v) => '$' + v.toFixed(2);
  const cr = (v) => v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const tok = (v) => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : String(v);

  function render(r, months, selected) {
    monthSel.innerHTML = months.map((m) =>
      '<option value="' + m + '"' + (m === selected ? ' selected' : '') + '>' + m + '</option>').join('');

    if (!r || r.requestCount === 0) {
      app.innerHTML = '<div class="card empty"><div class="icon">📊</div>' +
        '<p>No Copilot usage found for this period.</p>' +
        '<p>Use Copilot Chat in any workspace and data appears here automatically.</p></div>';
      foot.innerHTML = '';
      return;
    }

    const overBudget = r.includedCredits > 0 && r.copilotCredits > r.includedCredits;
    const pct = r.includedCredits > 0 ? Math.min(100, r.usedPercent) : 0;
    const providerNames = { 'copilot': 'Copilot', 'copilot-cli': 'Copilot CLI', 'claude-code': 'Claude Code' };
    const providerSplit = (r.providers || []).map((p) => (providerNames[p.provider] || p.provider) + ' ' + usd(p.usd)).join(' · ');

    app.innerHTML =
      '<div class="grid kpis">' +
        kpi('Spend · ' + r.month, usd(r.totalUsd), providerSplit || (cr(r.totalCredits) + ' AI Credits')) +
        kpiGauge('Copilot allowance', r, pct, overBudget) +
        kpi('Forecast (EOM)', usd(r.forecastUsd), cr(r.forecastCredits) + ' credits at current pace') +
        kpi('Activity', r.requestCount.toLocaleString('en-US') + ' req', r.sessionCount + ' sessions · ' + r.repos.length + ' repos') +
      '</div>' +
      '<div class="grid charts">' +
        '<div class="card"><h2>Cost by repository</h2>' + repoBars(r.repos) + '</div>' +
        '<div class="card"><h2>Cost by model</h2>' + modelDonut(r.models) + '</div>' +
      '</div>' +
      '<div class="card" style="margin-bottom:14px"><h2>Daily spend</h2>' + dailyArea(r.days) + '</div>' +
      '<div class="card"><h2>Repositories</h2>' + repoTable(r) + '</div>';

    foot.innerHTML =
      'Data sources: VS Code Copilot Chat, GitHub Copilot CLI and Claude Code local logs · all processing happens on this machine, nothing leaves it.' +
      '<br>The allowance gauge counts Copilot usage only; Claude Code is billed separately and is shown for total AI spend per project.' +
      (r.hasEstimates ? '<br>Entries marked <b>~est</b> are estimated from chat content length because exact token counts were not present in the logs.' : '');
  }

  function kpi(label, value, sub) {
    return '<div class="card"><div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function kpiGauge(label, r, pct, over) {
    if (r.includedCredits <= 0) return kpi(label, '—', 'set your plan in settings');
    return '<div class="card"><div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + r.usedPercent.toFixed(0) + '%</div>' +
      '<div class="gauge' + (over ? ' over' : '') + '"><div style="width:' + pct + '%"></div></div>' +
      '<div class="sub">' + cr(r.copilotCredits) + ' / ' + r.includedCredits.toLocaleString('en-US') + ' credits (Copilot only)</div></div>';
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
      '<div class="row"><span class="dot" style="background:' + PALETTE[i % 6] + '"></span>' +
      '<span class="name">' + esc(m.model) + '</span><span class="val">' + usd(m.usd) + ' · ' + m.requestCount + '×</span></div>').join('');
    return '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
      '<svg viewBox="0 0 140 140" width="120" height="120">' + rings + '</svg>' +
      '<div class="legend" style="flex:1;min-width:170px">' + legend + '</div></div>';
  }

  function dailyArea(days) {
    if (days.length === 0) return '<div class="sub">no data</div>';
    const w = 860, h = 150, padB = 22, padL = 8, padR = 46;
    const max = Math.max(...days.map((d) => d.usd), 1e-9);
    const startDay = +days[0].day.slice(-2), endDay = +days[days.length - 1].day.slice(-2);
    const span = Math.max(1, endDay - startDay);
    const x = (d) => padL + ((+d.slice(-2) - startDay) / span) * (w - padL - padR);
    const y = (v) => (h - padB) - (v / max) * (h - padB - 14);
    const pts = days.map((d) => x(d.day).toFixed(1) + ',' + y(d.usd).toFixed(1));
    const line = 'M' + pts.join(' L');
    const area = line + ' L' + x(days[days.length - 1].day).toFixed(1) + ',' + (h - padB) + ' L' + x(days[0].day).toFixed(1) + ',' + (h - padB) + ' Z';
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--c1)" stop-opacity="0.45"/><stop offset="100%" stop-color="var(--c1)" stop-opacity="0.03"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#ag)"/>' +
      '<path d="' + line + '" fill="none" stroke="var(--c1)" stroke-width="2"/>' +
      '<text x="' + (w - padR + 6) + '" y="' + (y(max) + 4) + '">' + usd(max) + '</text>';
    days.forEach((d) => {
      svg += '<circle cx="' + x(d.day) + '" cy="' + y(d.usd) + '" r="2.6" fill="var(--c1)"/>' +
        '<text x="' + x(d.day) + '" y="' + (h - 6) + '" text-anchor="middle">' + (+d.day.slice(-2)) + '</text>';
    });
    return svg + '</svg>';
  }

  function repoTable(r) {
    const total = r.totalCredits || 1;
    const rows = r.repos.map((repo) => {
      const share = (repo.credits / total) * 100;
      const models = (repo.models || []);
      const shown = models.slice(0, 2).map((m) => esc(m.model)).join(', ');
      const more = models.length > 2 ? ' <span class="badge" title="' + esc(models.slice(2).map((m) => m.model).join(', ')) + '">+' + (models.length - 2) + '</span>' : '';
      return '<tr><td>' + esc(repo.repo.name) + (repo.hasEstimates ? '<span class="badge">~est</span>' : '') + '</td>' +
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
    return '<div class="tablewrap"><table><thead><tr><th>Repository</th><th>Models</th><th class="num">Req</th><th class="num">Sessions</th>' +
      '<th class="num">Input</th><th class="num">Output</th><th class="num">Cache&nbsp;R</th><th class="num">Cache&nbsp;W</th>' +
      '<th class="num">Credits</th><th class="num">Spend</th><th>Share</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
</script>
</body>
</html>`;
}
