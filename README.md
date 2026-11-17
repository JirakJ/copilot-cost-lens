# Cost Lens for GitHub Copilot

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/JakubJirak.copilot-cost-lens?label=Marketplace&color=1b7f4d)](https://marketplace.visualstudio.com/items?itemName=JakubJirak.copilot-cost-lens)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/JakubJirak.copilot-cost-lens?label=Installs)](https://marketplace.visualstudio.com/items?itemName=JakubJirak.copilot-cost-lens)
[![CI](https://img.shields.io/github/actions/workflow/status/JirakJ/copilot-cost-lens/ci.yml?label=CI)](https://github.com/JirakJ/copilot-cost-lens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Know exactly what your AI coding tools cost you — per repository, per model, per day. 100% local and private.**

Cost Lens reads the logs that GitHub Copilot (VS Code Chat **and** the Copilot CLI), ChatGPT Codex and optionally Claude Code already keep on your machine, attributes every request to the repository you were working in, prices it using the providers' model rates, and turns the result into a live dashboard and a status-bar ticker.

![Dashboard](docs/dashboard.png)

| Repository detail | Project (group) detail |
|---|---|
| ![Repository detail — model mix, top sessions, cache share, effective $/1M](docs/project-detail.png) | ![Project group — per-repo breakdown, receipt/edit/delete](docs/group-detail.png) |

| All-time view | Alerts & status bar |
|---|---|
| ![All-time view with monthly spend bars](docs/alltime.png) | ![Credit alert notification and the status-bar sparkline](docs/notification.png) |

![Inline project editor — pick repositories right in the dashboard](docs/project-editor.png)

<details>
<summary>Project receipt — combined, with per-repository breakdown</summary>

![Combined project receipt with repository breakdown](docs/group-receipt.png)
</details>

<details>
<summary>Single-repository receipt — the thermal-printer look</summary>

![Receipt PDF](docs/receipt.png)
</details>

## Why

Since GitHub Copilot moved to usage-based billing (AI Credits), the question is no longer *"how many requests did I make?"* but *"which project is burning my credits, on which model, and will I fit into my monthly allowance?"* GitHub's billing page gives you an account-level total — Cost Lens gives you the per-repository breakdown it can't.

## Features

- **Cost per repository** — every chat request is attributed to the workspace it ran in, resolved to a `owner/repo` slug via the project's git remote when available.
- **All your AI tools in one ledger** — VS Code Copilot Chat, GitHub Copilot CLI agent sessions and Claude Code transcripts, with a per-provider spend split. Claude Code never counts against your Copilot allowance — it's shown so you see the *total* AI cost of a project.
- **Token anatomy** — input, output, cache read and cache write tokens per repository, plus the exact models used and how often.
- **Project drill-down** — click any repository for a detailed view: model mix, daily trend, source split, token anatomy, first/last activity.
- **All-time view** — switch the period selector to *All time* to see everything since your logs began, not just one month.
- **Custom date ranges** — pick *Custom range…* and cost any from/to window: a sprint, a billing period, a single week. The range flows through the dashboard, exports and receipts.
- **Period-over-period deltas** — the spend card and every repository row show how the period compares with the equal-length window before it, so you see what is actually growing.
- **Cache economics** — what prompt caching earned you (cache reads priced against fresh input) against what cache writes cost, per period. Negative net is a real finding, not a bug: short sessions pay to fill a cache nobody reuses.
- **Savings headroom** — each model's tokens repriced at the cheapest model of the same family. It is a ceiling, not a recommendation: Cost Lens never reads prompt content, so it cannot tell which requests genuinely needed the expensive model.
- **PDF receipts** — export a classic printed-receipt PDF per repository or per project (with a per-repository breakdown), including model line items, token counts, effective $/1M rates and totals. Great for chargeback or framing on the wall.
- **Project groups** — roll several repositories (frontend, backend, e2e…) into one named project, straight from the dashboard ("＋ New project" → pick repos; membership is exclusive). The aggregated project gets its own detail and a combined receipt with per-repository breakdown.
- **Starred repositories** — pin your important repos with a ☆ and they surface in a dedicated section at the top of the dashboard.
- **Rename repositories** — give hash-named remote repositories like `(unknown) 2bebdc79` a friendly display name; the alias follows the repository through every view, project total and receipt. Hover a table row for the ✎ button, or use the detail view.
- **Hide repositories** — remove noise repos with the 🙈 button (row hover or detail view). Raw CSV/JSON exports and budget alerts still see the full picture; unhide via `Copilot Cost Lens: Manage Hidden Repositories`.
- **Your currency** — show all amounts in EUR, CZK, GBP… via `copilotCostLens.displayCurrency` plus a manually set exchange rate. No network calls, ever; receipts stay in USD.
- **Summary receipt** — one PDF for every repository in the selected period (🧾 button in the toolbar), next to the existing per-repository and per-project receipts.
- **Status bar, your way** — show spend so far or the AI credits you have left (`copilotCostLens.statusBar.mode`).
- **Share it** — copy the current month as a Markdown table for standups, or export a per-repository summary CSV for finance (alongside the raw event exports).
- **Per-project budgets** — give each project its own monthly USD budget (`copilotCostLens.projectBudgetsUsd`) and get warned when it crosses your threshold.
- **Runaway-session alert** — set `copilotCostLens.sessionCostAlertUsd` and get warned the moment a single (agent) session crosses your dollar threshold — before it becomes a surprise on the bill.
- **Credit alerts** — set absolute thresholds (e.g. 2,500 AIC) and get notified once per month when month-to-date Copilot usage crosses them, on top of the percentage warning.
- **Localized** — English, Čeština, Deutsch and 日本語, following your VS Code display language.
- **Dashboard** — monthly overview with spend, allowance gauge, end-of-month forecast, cost-by-repo chart, model donut, daily spend trend and a sortable repository table. Adapts to your color theme.
- **Status bar** — month-to-date credits and dollars at a glance; turns orange when you cross your warning threshold.
- **Budgets & alerts** — pick your monthly allowance right in the dashboard (1,900 / 3,900 / 10k / 100k / 1M AIC or a custom number) and an optional dollar budget; get warned once a day when you cross the threshold.
- **Forecast & burn rate** — linear end-of-month projection, month-over-month trend, and a projected date your allowance runs out at the current pace.
- **Cost detective tools** — the most expensive sessions per repository, cache read share (how much of your context comes from cache), and a per-month bar chart in the all-time view.
- **Status-bar sparkline** — the last 7 days of spend at a glance, right next to the month-to-date total.
- **Built for 100+ repositories** — instant text filter, source chips (Copilot / CLI / Claude Code) and sortable columns in the repository table, starred repos pinned on top, and "Open in VS Code" straight from a repository detail.
- **Activity heatmap** — a calendar of daily spend over the last 26 weeks reveals your usage rhythm at a glance.
- **Export** — one click to CSV or JSON for invoicing, chargeback or further analysis.
- **Multi-installation** — scans VS Code, VS Code Insiders, VSCodium, Cursor and Windsurf storage automatically; extra locations are configurable.
- **Zero runtime dependencies** — small, fast, auditable.

## How it works

Cost Lens combines these local sources:

| Source | What it provides | Accuracy |
|---|---|---|
| VS Code: `GitHub.copilot-chat/transcripts/*.jsonl`, `debug-logs/**.jsonl` (per-workspace, and `globalStorage/github.copilot-chat/debug-logs` since Copilot Chat 0.71) | exact token counts and billed AI-credit units per request | **exact** |
| VS Code: `chatSessions/*.json` | model, timestamp and conversation content | **estimated** from content length |
| Copilot CLI / SDK: `~/.copilot/session-state/**` | exact per-request tokens (including active SDK sessions), legacy per-model shutdown totals, cache read/write, billed units, repository slug | **exact** (estimation fallback when exact usage is absent) |
| Claude Code: `~/.claude/projects/**/*.jsonl` | exact per-request tokens incl. cache read/write, model, working directory | **exact** |
| ChatGPT Codex: `~/.codex/sessions/**/*.jsonl` | exact per-request input, cached and output tokens, model, working directory | **exact** |
| JetBrains Copilot: `~/.config/github-copilot/<ide>/**` (opt-in) | repository + models recovered; cost estimated from content (plugin stores no token counts) | **estimated** |

When both exact and estimated data exist for the same session, exact wins. Estimated entries are always marked (`~est`) in every view. Costs are computed as:

1. **Billed units** from the logs when present — AI-credit nano units (`1 credit = $0.01`) or premium requests (`$0.04` each, pre-June-2026 Copilot billing),
2. otherwise **exact tokens × model rate** (built-in price table, USD per 1M tokens),
3. otherwise **estimated tokens × model rate**.

The built-in price table covers GPT, Claude, Gemini, Grok and more, and every rate can be overridden in settings — so when GitHub updates pricing, you don't have to wait for an extension update.

> **Disclaimer:** Cost Lens is an independent open-source project, not affiliated with GitHub or Microsoft. The log format is not a stable public API and numbers shown here are an analytical aid, not a bill. Your GitHub billing page remains the source of truth.

## Privacy

Everything happens on your machine. Cost Lens:

- reads local files by default (VS Code `workspaceStorage` and Copilot Chat `globalStorage`, and the Copilot CLI / ChatGPT Codex / Claude Code / JetBrains Copilot stores in your home directory),
- optionally reads explicitly configured remote Copilot CLI/SDK logs over your existing VS Code remote connection (see below). **Whole logs, including any prompts and tool output, transfer to the local extension host** for parsing; usage is not uploaded to a service,
- downloads GitHub's public [Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) page so new models and price changes are priced without an extension update. Nothing about you or your usage is sent; turn it off with `copilotCostLens.pricing.autoUpdate: false` (the built-in table is used then). Apart from opt-in remote reads, this is the only network request,
- collects **no telemetry**,
- never executes git — repository names are read from `workspace.json` and `.git/config` as plain files.

## Getting started

1. Install **Cost Lens for GitHub Copilot** from the Marketplace — the built-in **walkthrough** (Help → Get Started → Copilot Cost Lens) guides you through the rest.
2. Set `copilotCostLens.plan` to your Copilot plan (defaults to Business).
3. Open the **Copilot Cost Lens** view in the activity bar, or run `Copilot Cost Lens: Open Dashboard`.

Data appears automatically as you use Copilot Chat. Historical sessions already on disk are picked up on first scan.

### Remote Copilot CLI / SDK sessions (opt-in)

With Cost Lens installed **locally**, connect to a remote workspace using VS Code (SSH, WSL, a dev container or Codespaces). Run **Copilot Cost Lens: Add Remote Copilot Root…**, enter the absolute remote session-state directory (for example `/home/user/.copilot/session-state`), and grant access only to logs you want transferred. No remote Cost Lens installation or separate credentials are needed. The command checks directory access, saves its `vscode-remote://<authority>/...` URI globally, verifies the effective setting, then refreshes.

`copilotCostLens.remoteCopilotRoots` defaults to `[]` and is machine-scoped. Only authorities in the current window's remote workspace folders are read, and only while `copilotCostLens.copilotCli.enabled` is enabled. Disconnected roots report diagnostics rather than opening a connection to another host. Both flat `<session>.jsonl` files and `<session>/events.jsonl` directories work.

Remote reads use `workspace.fs` over the existing connection. Each file is transferred whole, with a **64 MiB maximum** checked against both its advertised and actual size; larger files are skipped with a diagnostic. Parsed results are cached in memory by URI, modification time, size and estimation ratio; unchanged files are not retransferred. Removed or failed files leave the cache, which is cleared on disposal. Refreshes and workspace-folder changes rescan configured roots.

Local and remote copies are deduplicated by session ID: the **entire copy with the newest usage timestamp** wins, with remote preferred on ties (copies are never merged request-by-request). Repository names use session metadata, then the working-folder basename; remote paths never become local “Open in VS Code” targets. Request usage updates replace earlier records by usage ID, API-call ID or event ID; checkpoints and shutdown summaries after request records are not double-counted. Legacy shutdown accounting and estimation remain available for older logs.

## Settings

| Setting | Default | Description |
|---|---|---|
| `copilotCostLens.plan` | `business` | Plan preset for the included-credits gauge (`business`, `businessPromo`, `enterprise`, `enterprisePromo`, `custom`). |
| `copilotCostLens.includedCreditsPerMonth` | `1900` | Monthly allowance when plan is `custom`. |
| `copilotCostLens.projectGroups` | `{}` | Named projects: `{ "MyProduct": ["acme/fe", "acme/be"] }`. |
| `copilotCostLens.creditAlerts` | `[]` | Absolute AIC thresholds, each notifies once per month. |
| `copilotCostLens.monthlyBudgetUsd` | `0` | Personal dollar budget (0 = off). |
| `copilotCostLens.warnAtPercent` | `80` | Warning threshold for allowance/budget. |
| `copilotCostLens.statusBar.enabled` | `true` | Status-bar spend ticker. |
| `copilotCostLens.pricing.autoUpdate` | `true` | Sync model prices daily from GitHub's official price list (`priceOverrides` still win). Command: **Update Model Prices from GitHub**. |
| `copilotCostLens.extraStorageRoots` | `[]` | Additional `workspaceStorage` roots to scan. |
| `copilotCostLens.remoteCopilotRoots` | `[]` | Opt-in remote Copilot CLI/SDK session-state URIs; requires a connected remote workspace. Whole-log transfer, 64 MiB/file maximum. |
| `copilotCostLens.claudeCode.enabled` | `true` | Include Claude Code usage in per-repo costs. |
| `copilotCostLens.copilotCli.enabled` | `true` | Include GitHub Copilot CLI usage. |
| `copilotCostLens.codex.enabled` | `true` | Include ChatGPT Codex CLI/Desktop usage. |
| `copilotCostLens.jetbrainsCopilot.enabled` | `false` | Include JetBrains Copilot chat sessions (estimated). |
| `copilotCostLens.starredRepos` | `[]` | Repositories pinned to the top of the dashboard. |
| `copilotCostLens.repoAliases` | `{}` | Display names: `{ "(unknown) 2bebdc79": "Backend API" }` — set via ✎ Rename. |
| `copilotCostLens.hiddenRepos` | `[]` | Repositories hidden from all views — set via 🙈 Hide, unhide via the Manage Hidden Repositories command. |
| `copilotCostLens.sessionCostAlertUsd` | `0` | Warn when one session crosses this USD amount (0 = off). |
| `copilotCostLens.displayCurrency` | `USD` | Currency code shown in the dashboard and status bar. |
| `copilotCostLens.usdExchangeRate` | `1` | Units of the display currency per 1 USD (manual, offline). |
| `copilotCostLens.statusBar.mode` | `spend` | Status bar shows `spend` so far or `remaining` allowance credits. |
| `copilotCostLens.projectBudgetsUsd` | `{}` | Monthly USD budget per project: `{ "MyProduct": 50 }`. |
| `copilotCostLens.documentLanguage` | `en` | Language of exported PDF receipts (`en`, `auto`, `cs`, `de`). |
| `copilotCostLens.estimation.enabled` | `true` | Estimate sessions that have no exact token data. |
| `copilotCostLens.estimation.charsPerToken` | `4` | Ratio used by the estimator — only affects `~est` entries. ~4 chars/token is the rule of thumb for English text and code (CJK ≈ 1–2); estimates land within roughly ±20–30 % of real counts. |
| `copilotCostLens.priceOverrides` | `{}` | Per-model rate overrides (USD per 1M tokens). |
| `copilotCostLens.refreshIntervalSeconds` | `120` | Background rescan interval. |

## Commands

- `Copilot Cost Lens: Add Remote Copilot Root…`
- `Copilot Cost Lens: Open Dashboard`
- `Copilot Cost Lens: Refresh Usage Data`
- `Copilot Cost Lens: Export Usage as CSV` / `as JSON`
- `Copilot Cost Lens: Export Project Receipt (PDF)`
- `Copilot Cost Lens: Manage Hidden Repositories`
- `Copilot Cost Lens: Add Storage Root…`
- `Copilot Cost Lens: Copy Summary as Markdown`
- `Copilot Cost Lens: Export Summary CSV (per repository)`
- `Copilot Cost Lens: Open Settings`
- `Copilot Cost Lens: Show Diagnostics` — scanned roots, file counts, events per source

## FAQ

**I see no data / the dashboard is empty.**
Switch the period to *All time* (the empty state offers a one-click button), or run `Copilot Cost Lens: Show Diagnostics` to see which storage roots were scanned and how many events were found per source. Most often the current month simply has no usage yet.

**Numbers don't match my GitHub bill exactly.**
Expected. Sessions without exact token logs are estimated from content length, code completions are not in chat logs (they're included in paid plans anyway), and Copilot usage outside this machine (web, CLI, other devices) is invisible locally. Treat Cost Lens as a relative lens on *where* your usage goes.

**I see `~est` everywhere.**
Your Copilot Chat version isn't writing token-level transcripts yet. Estimates still give you a faithful *relative* picture across repos; exact data is used automatically the moment it appears.

**I work over Remote SSH / WSL / a dev container and see no new usage. Why?**
In a remote window Copilot (and Claude Code, Codex, Copilot CLI) run on the remote machine and write their logs there, so a Cost Lens that runs on your local machine cannot read them. Install Cost Lens on the remote too (Extensions view → *Install in SSH: …* / *Install in WSL: …*). It then runs next to the logs and reads the VS Code Server storage (`~/.vscode-server/data/User/…`) and `~/.copilot/session-state` of that machine. Each machine shows its own usage: history recorded on your local machine stays in local windows.

**Can I rename a remote repository from my local VS Code window?**
Yes. Cost Lens recognizes `vscode-remote://` workspace metadata and shows the remote folder name instead of an opaque workspace hash. You can rename that entry directly from the local dashboard; you no longer need to connect to the remote machine first.

**Does it work with older "premium requests" billing?**
Yes — Copilot CLI sessions log the billed premium requests directly and Cost Lens prices them at $0.04 each; everything else falls back to token-based pricing. The AI Credits model (effective June 2026) is the primary target.

**How do I unhide a hidden repository?**
Open settings and remove its entry from `copilotCostLens.hiddenRepos` (the 🙈 Hide button in a repository's detail adds it there). Hidden repositories are excluded from the dashboard, status bar and receipts, but raw CSV/JSON exports and budget alerts still include them, so your totals never silently lie.

**I use my own API key / custom endpoint (BYOK) in Copilot Chat. Is that counted?**
Yes, as a separate **Copilot (BYOK)** provider that never counts toward the AI-credit allowance, since your endpoint's provider bills it, not GitHub. BYOK requests are recognized by the absence of billed AI-credit units (debug logs) or a non-`copilot` vendor prefix such as `customendpoint/…` (chat sessions). They're priced from the built-in table; if your provider charges different rates, set them with `copilotCostLens.priceOverrides`.

**Why is Claude Code in a Copilot extension?**
Because the question you actually ask is "what does this repository cost me in AI tools?" Claude Code spend is tracked separately from the Copilot allowance gauge and can be disabled with one setting.

## Development

```bash
npm ci
npm run build        # bundle with esbuild
npm test             # vitest unit tests
npm run typecheck
npm run lint
npm run vsix         # package .vsix
npm run verify-package # assert the shipping file allowlist
```

CI checks Linux, Windows and macOS with Node 24, including dependency and secret scanning. The bundled extension targets the Node 16 runtime used by VS Code 1.75; build tooling runs on a current LTS Node version.

After merging a version bump and its changelog, run the **Release** workflow on `main` (or push the matching `vX.Y.Z` tag). It verifies the commit, rebuilds and checks the VSIX, publishes that exact artifact to Visual Studio Marketplace, then creates the GitHub release with the VSIX and SHA-256 checksum. The repository's `VSCE_PAT` secret is required. A failed or skipped publication is not a completed release.

JSONL records and legacy JSON sessions larger than 64 MiB are rejected to bound parser memory; scan diagnostics identify affected files. Exports include repository names and usage metadata, so review them before sharing. JSON exports also include locally resolved folder paths.

Press <kbd>F5</kbd> in VS Code to launch the Extension Development Host.

## License

[MIT](LICENSE)

---

<sub>Made by [Jakub Jirák](https://ai.jakubjirak.com)</sub>
