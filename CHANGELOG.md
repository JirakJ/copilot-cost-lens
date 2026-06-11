# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.5.1] — 2026-06-11

### Changed

- README screenshots for project groups: group detail view (per-repo breakdown, receipt/invoice/edit/delete) and the combined project receipt; reproducible demo generator in `scripts/gen-demos.mjs`.
- Test coverage extended to the status-bar sparkline, CSV export and the dashboard document (CSP nonce, string-catalog injection, message-handler wiring) — pure helpers moved into `src/core` to be testable without the VS Code API.

## [1.5.0] — 2026-06-11

### Added

- **Project management in the dashboard** — a "＋ New project" button creates a group by picking repositories from a native multi-select list (sorted by spend); projects can be edited and deleted from their detail view. No more hand-editing settings JSON — `copilotCostLens.projectGroups` remains the storage and stays editable.
- **Combined receipt for projects** — the receipt PDF is now available for project groups too, with a *Breakdown by repository* section, aggregated model line items and source subtotals.
- The Projects card is always visible in the overview (with an explanatory hint when no project exists yet), so the grouping feature is discoverable.
- `Copilot Cost Lens: Create Project (Group Repositories)` command.

## [1.4.0] — 2026-06-11

### Added

- **Month-over-month trend** in the Spend card (▲/▼ % vs the previous month).
- **Allowance burn rate** — the gauge card shows the projected date your Copilot allowance runs out at the current pace.
- **Most expensive sessions** table in the repository detail (date, models, source, requests, cost).
- **Cache read share** KPI in the repository detail — how much of your context is served from cache.
- **Monthly bar chart** replaces the daily chart in the all-time view.
- **Status-bar sparkline** — last 7 days of spend as a tiny graph.
- Refreshed README with project-detail, invoice and receipt screenshots.

## [1.3.0] — 2026-06-11

### Added

- **Project groups** (`copilotCostLens.projectGroups`) — roll several repositories into one named project. Groups appear in the dashboard with aggregated cost, models and a drill-down detail.
- **Invoice PDF export** — A4 summary invoice per project group with a per-repository breakdown (model line items, token anatomy, source subtotals, grand total), and per single repository. Paginated for large projects.
- **Credit alerts** (`copilotCostLens.creditAlerts`) — absolute AI-credit thresholds (e.g. 2,500 AIC); each fires a notification once per month when crossed.
- **Scan diagnostics** — a "Copilot Cost Lens" output channel logs every scan (duration, files, events per source, errors); the dashboard footer shows loaded events per source and the newest data timestamp.

### Changed

- Each data source is now isolated: an error in one (VS Code, Copilot CLI, Claude Code) no longer aborts the whole scan; errors surface in the dashboard and output channel.

## [1.2.0] — 2026-06-11

### Added

- **All-time view** — the period selector now offers *All time* alongside individual months.
- **Project drill-down** — click a repository row for a detail view with model mix, daily trend, source split, token anatomy and first/last activity.
- **PDF receipts** — receipt-style PDF export per project (model line items, token counts, totals), available from the project detail and the command palette. Hand-written PDF, zero dependencies.
- **Localization** — English (default), Czech, German and Japanese for the dashboard, settings, commands and receipts (receipt PDFs use English labels for CJK locales — core PDF fonts carry no CJK glyphs).
- **Allowance presets in the dashboard** — 1,900 / 3,900 / 10,000 / 100,000 / 1,000,000 AIC or a custom number, persisted to settings; fixes allowance configuration from the UI.
- Expanded explanation of `estimation.charsPerToken` (what it affects and how accurate estimates are).

### Changed

- Clicking the activity-bar icon now opens the dashboard directly in the sidebar — the placeholder tree view with Dashboard/Refresh buttons is gone. The `Open Dashboard` command still opens the full-size panel.

## [1.1.0] — 2026-06-10

### Added

- **Claude Code source**: exact per-request usage from `~/.claude/projects` transcripts (tokens incl. cache read/write, model, per-`cwd` repo attribution, streaming dedupe). Shown in the total AI spend per project, never counted against the Copilot allowance. Toggle: `copilotCostLens.claudeCode.enabled`.
- **GitHub Copilot CLI source**: exact per-model metrics from `~/.copilot/session-state` shutdown events — tokens incl. cache read/write, billed premium requests ($0.04 each) and AI-credit units, repository slug straight from the session context. Estimation fallback for sessions that never shut down. Toggle: `copilotCostLens.copilotCli.enabled`.
- Cache read and cache write token columns in the dashboard repository table and tree view; cache-write-aware token pricing.
- Models column in the repository table (with request counts on hover).
- Per-provider spend split (Copilot / Copilot CLI / Claude Code) in the dashboard and status-bar tooltip.
- Anthropic-style dashed model ids are normalized (`claude-opus-4-5-…` → `claude-opus-4.5`); added rates for `gemini-3-pro`, `claude-fable-5` and a `claude-opus-4` catch-all.

### Fixed

- The month selector always offers the current month, even before any data exists for it.
- The allowance gauge now counts Copilot usage only.



## [1.0.0] — 2026-06-10

### Added

- Per-repository cost tracking from local Copilot Chat logs (exact JSONL usage + estimated chat sessions, deduped by session).
- Pricing engine for GitHub's AI Credits billing: billed nano-credit units, token-based model rates (GPT, Claude, Gemini, Grok, …), user overrides, plan presets including Jun–Aug 2026 promotional allowances.
- Dashboard webview: monthly spend, allowance gauge, end-of-month forecast, cost-by-repository chart, model donut, daily trend, repository table, month selector, CSV/JSON export.
- Activity-bar tree view with per-repo and per-model breakdown.
- Status-bar month-to-date ticker with warning state.
- Budget alerts (allowance % or dollar budget, at most once per day).
- Automatic detection of VS Code, Insiders, VSCodium, Cursor and Windsurf storage roots; configurable extra roots.
- CSV and JSON export commands.
