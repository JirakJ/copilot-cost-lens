// Reproducible README screenshots: renders the real dashboard webview with
// mock data into docs/demo-*.html, ready for a headless-Chrome screenshot.
//   node scripts/gen-demos.mjs && ./scripts/shoot-demos.sh
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';

await build({
  entryPoints: ['src/ui/dashboardHtml.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '/tmp/cost-lens-demo-html.mjs',
});
const { renderDashboardHtml } = await import('/tmp/cost-lens-demo-html.mjs');

const S = {
  refresh: 'Refresh', refreshTitle: 'Rescan usage logs', exportCsv: 'Export CSV',
  exportJson: 'Export JSON', settingsTitle: 'Open settings', allTime: 'All time',
  spend: 'Spend', allowance: 'Copilot allowance', forecast: 'Forecast (end of month)',
  activity: 'Activity', aiCredits: 'AI Credits', includesEstimates: 'includes estimates',
  creditsAtPace: 'credits at current pace', creditsCopilotOnly: 'credits (Copilot only)',
  sessionsRepos: '{0} sessions · {1} repos', req: 'req', costByRepo: 'Cost by repository',
  costByModel: 'Cost by model', dailySpend: 'Daily spend', repositories: 'Repositories',
  colRepository: 'Repository', colModels: 'Models', colReq: 'Req', colSessions: 'Sessions',
  colInput: 'Input', colOutput: 'Output', colCacheR: 'Cache R', colCacheW: 'Cache W',
  colCredits: 'Credits', colSpend: 'Spend', colShare: 'Share',
  emptyTitle: 'No usage found.', emptyHint: 'Use Copilot and data appears automatically.',
  footSources: 'Data sources: VS Code Copilot Chat, GitHub Copilot CLI and Claude Code local logs · all processing happens on this machine, nothing leaves it.',
  footAllowance: 'The allowance gauge counts Copilot usage only; Claude Code is billed separately and is shown for total AI spend per project.',
  footEstimates: 'Entries marked ~est are estimated from chat content length.',
  back: 'Back', receiptPdf: 'Receipt (PDF)', firstActivity: 'First activity',
  lastActivity: 'Last activity', tokenAnatomy: 'Token anatomy', bySource: 'By source',
  custom: 'Custom…', noData: 'no data', detailHint: 'Click a repository row for a detailed breakdown.',
  projects: 'Projects', invoicePdf: 'Invoice (PDF)', reposInProject: 'Repositories in this project',
  footStats: 'Loaded events', footNewest: 'newest data:', vsPrevMonth: 'vs previous month',
  runsOut: 'allowance runs out ~{0}', monthlySpend: 'Monthly spend',
  topSessions: 'Most expensive sessions', colDate: 'Date', colSource: 'Source',
  cacheShare: 'Cache read share', cacheShareSub: 'of context read from cache',
  newProject: 'New project', editProject: 'Edit', deleteProject: 'Delete',
  save: 'Save project', cancel: 'Cancel', projectNameLabel: 'Project name',
  projectNamePlaceholder: 'e.g. MyProduct', selectReposLabel: 'Repositories in this project',
  errNameRequired: 'Enter a project name', errPickRepo: 'Select at least one repository',
  projectsEmptyHint: 'Group several repositories (frontend, backend, tests…) into one project and export a combined receipt or invoice.',
  providerCopilot: 'Copilot', providerCopilotCli: 'Copilot CLI', providerClaudeCode: 'Claude Code',
};

const mkRepo = (name, usd, req, sess, inT, outT, cR, cW, models, est) => ({
  repo: { name }, credits: usd * 100, usd, inputTokens: inT, outputTokens: outT,
  cachedTokens: cR, cacheWriteTokens: cW, requestCount: req, sessionCount: sess,
  lastActivity: Date.now(), hasEstimates: !!est, providers: ['copilot'], models,
});

const repos = [
  mkRepo('acme/payments-api', 48.02, 459, 14, 12950000, 410000, 193000000, 7400000,
    [{ model: 'claude-opus-4.8', credits: 3000, usd: 30, requestCount: 200 },
     { model: 'claude-fable-5', credits: 1500, usd: 15, requestCount: 180 },
     { model: 'gpt-5.5', credits: 302, usd: 3.02, requestCount: 79 }]),
  mkRepo('acme/web-frontend', 31.16, 793, 21, 8100000, 350000, 135000000, 4000000,
    [{ model: 'claude-fable-5', credits: 2000, usd: 20, requestCount: 500 },
     { model: 'gpt-5.3-codex', credits: 1116, usd: 11.16, requestCount: 293 }], true),
  mkRepo('acme/infra-terraform', 24.40, 337, 9, 4500000, 210000, 63600000, 1200000,
    [{ model: 'gpt-5.5', credits: 2440, usd: 24.4, requestCount: 337 }]),
  mkRepo('acme/mobile-app', 17.52, 124, 8, 2100000, 160000, 37700000, 2800000,
    [{ model: 'claude-sonnet-4.6', credits: 1752, usd: 17.52, requestCount: 124 }], true),
  mkRepo('acme/data-pipeline', 15.45, 205, 6, 1900000, 140000, 45000000, 1100000,
    [{ model: 'gemini-3.1-pro', credits: 1045, usd: 10.45, requestCount: 150 },
     { model: 'gpt-5-mini', credits: 500, usd: 5, requestCount: 55 }]),
];

const group = {
  name: 'Acme Platform', repos: [repos[0], repos[1], repos[2]],
  credits: 10358, usd: 103.58, inputTokens: 25550000, outputTokens: 970000,
  cachedTokens: 391600000, cacheWriteTokens: 12600000, requestCount: 1589, sessionCount: 44,
  models: [
    { model: 'claude-opus-4.8', credits: 3000, usd: 30, requestCount: 200 },
    { model: 'claude-fable-5', credits: 3500, usd: 35, requestCount: 680 },
    { model: 'gpt-5.5', credits: 2742, usd: 27.42, requestCount: 416 },
    { model: 'gpt-5.3-codex', credits: 1116, usd: 11.16, requestCount: 293 },
  ],
  hasEstimates: true,
};

const days = Array.from({ length: 11 }, (_, i) => {
  const c = [600, 950, 1400, 800, 2100, 1700, 550, 1900, 1500, 2682, 1900][i];
  return { day: '2026-06-' + String(i + 1).padStart(2, '0'), credits: c, usd: c / 100 };
});

const report = {
  month: '2026-06', totalCredits: 14182, totalUsd: 141.82, copilotCredits: 1287, copilotUsd: 12.87,
  includedCredits: 1900, usedPercent: 67.8, forecastCredits: 42546, forecastUsd: 425.46,
  prevMonth: '2026-05', prevMonthUsd: 96.40, allowanceExhaustion: '2026-06-19',
  monthsSeries: [
    { month: '2026-01', credits: 5200, usd: 52 }, { month: '2026-02', credits: 7400, usd: 74 },
    { month: '2026-03', credits: 6100, usd: 61 }, { month: '2026-04', credits: 9800, usd: 98 },
    { month: '2026-05', credits: 9640, usd: 96.4 }, { month: '2026-06', credits: 14182, usd: 141.82 },
  ],
  requestCount: 2412, sessionCount: 86, hasEstimates: true,
  providers: [
    { provider: 'claude-code', usd: 96.20, credits: 9620, requestCount: 1610 },
    { provider: 'copilot-cli', usd: 32.75, credits: 3275, requestCount: 540 },
    { provider: 'copilot', usd: 12.87, credits: 1287, requestCount: 262 },
  ],
  groups: [group],
  repos,
  models: [
    { model: 'claude-opus-4.8', credits: 4800, usd: 48.0, requestCount: 620 },
    { model: 'claude-fable-5', credits: 3500, usd: 35.0, requestCount: 690 },
    { model: 'gpt-5.5', credits: 2750, usd: 27.5, requestCount: 416 },
    { model: 'gpt-5.3-codex', credits: 1610, usd: 16.1, requestCount: 432 },
    { model: 'claude-sonnet-4.6', credits: 1052, usd: 10.52, requestCount: 184 },
    { model: 'gemini-3.1-pro', credits: 470, usd: 4.7, requestCount: 70 },
  ],
  days,
};

const repoDetail = {
  month: '2026-06', firstActivity: Date.parse('2026-06-01'), summary: repos[0],
  days: days.map((d) => ({ ...d, usd: d.usd * 0.34, credits: d.credits * 0.34 })),
  providers: [
    { provider: 'claude-code', usd: 31.10, credits: 3110, requestCount: 300 },
    { provider: 'copilot-cli', usd: 12.40, credits: 1240, requestCount: 110 },
    { provider: 'copilot', usd: 4.52, credits: 452, requestCount: 49 },
  ],
  topSessions: [
    { sessionId: 'a1', provider: 'claude-code', credits: 1240, usd: 12.40, requestCount: 84, models: ['claude-opus-4.8'], lastTimestamp: Date.parse('2026-06-09') },
    { sessionId: 'b2', provider: 'claude-code', credits: 980, usd: 9.80, requestCount: 61, models: ['claude-fable-5', 'claude-opus-4.8'], lastTimestamp: Date.parse('2026-06-07') },
    { sessionId: 'c3', provider: 'copilot-cli', credits: 760, usd: 7.60, requestCount: 12, models: ['gpt-5.5'], lastTimestamp: Date.parse('2026-06-05') },
    { sessionId: 'd4', provider: 'copilot', credits: 310, usd: 3.10, requestCount: 22, models: ['gpt-5.3-codex'], lastTimestamp: Date.parse('2026-06-03') },
  ],
};

const groupDetail = {
  month: '2026-06', group,
  days: days.map((d) => ({ ...d, usd: d.usd * 0.73, credits: d.credits * 0.73 })),
  providers: [
    { provider: 'claude-code', usd: 70.10, credits: 7010, requestCount: 1100 },
    { provider: 'copilot-cli', usd: 22.60, credits: 2260, requestCount: 340 },
    { provider: 'copilot', usd: 10.88, credits: 1088, requestCount: 149 },
  ],
};

const stats = {
  providers: { copilot: 563, 'copilot-cli': 592, 'claude-code': 3199 },
  newestTimestamp: Date.now(), scanMs: 1200, filesParsed: 380, errors: [],
};

const theme = '<style>:root{--vscode-editor-background:#1e2227;--vscode-editor-foreground:#d6dbe2;' +
  '--vscode-descriptionForeground:#8a93a1;--vscode-editorWidget-background:#262b33;' +
  '--vscode-widget-border:#343b46;--vscode-font-family:-apple-system,"Segoe UI",sans-serif;' +
  '--vscode-dropdown-background:#2c323b;--vscode-dropdown-foreground:#d6dbe2;' +
  '--vscode-button-background:#3794ff;--vscode-button-foreground:#fff;}</style>';

const base = renderDashboardHtml(S);
const months = ['2026-06', '2026-05', '2026-04'];
const allRepos = repos.map((r) => ({ name: r.repo.name, usd: r.usd }));
const demos = {
  'docs/demo.html': { payload: { type: 'data', months, selectedMonth: '2026-06', report, detail: null, groupDetail: null, allRepos, stats } },
  'docs/demo-detail.html': { payload: { type: 'data', months, selectedMonth: '2026-06', report, detail: repoDetail, groupDetail: null, allRepos, stats: null } },
  'docs/demo-group.html': { payload: { type: 'data', months, selectedMonth: '2026-06', report, detail: null, groupDetail, allRepos, stats: null } },
  // project editor opened over the group detail (auto-clicks the Edit button)
  'docs/demo-editor.html': {
    payload: { type: 'data', months, selectedMonth: '2026-06', report, detail: null, groupDetail, allRepos, stats: null },
    autoClick: 'editGroup',
  },
};

for (const [file, { payload, autoClick }] of Object.entries(demos)) {
  const click = autoClick
    ? 'setTimeout(() => document.getElementById(' + JSON.stringify(autoClick) + ')?.click(), 400);'
    : '';
  const stub =
    '<script>window.acquireVsCodeApi = () => ({ postMessage(){}, getState(){}, setState(){} });' +
    'window.addEventListener("DOMContentLoaded", () => { window.postMessage(' +
    JSON.stringify(payload) + ', "*"); ' + click + ' });</' + 'script>' + theme;
  let html = base.replace('</head>', stub + '</head>');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/s, '');
  await writeFile(file, html);
  console.log('written', file);
}
