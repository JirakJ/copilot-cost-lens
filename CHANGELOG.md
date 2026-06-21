# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.13.0] — 2026-06-13

### Changed

- **Faster, smoother dashboard.** Results now appear as soon as the first source is scanned and fill in progressively instead of waiting for the whole (large) scan to finish, with a modern loading spinner until then. Idle background refreshes that find no changes no longer re-render, so the view never flickers.

## [1.12.1] — 2026-06-13

### Fixed

- **Wrong repository names for git worktrees.** Work done in a git worktree (e.g. Claude Code's `<repo>/.claude/worktrees/<slug>`) was attributed to the random worktree slug instead of the real repository, because a worktree's `.git` is a file (`gitdir: …`) not a directory, so the remote couldn't be read. The resolver now follows the worktree pointer to the main repo's config and reads the `owner/repo` remote. Folders that fall back to a name also skip meaningless segments like `.git` and worktree scaffolding.

## [1.12.0] — 2026-06-13

### Added

- **JetBrains Copilot usage (estimated, opt-in).** Enable `copilotCostLens.jetbrainsCopilot.enabled` to include GitHub Copilot activity from the JetBrains IDE plugin (`~/.config/github-copilot/<ide>/`). It attributes usage to the right repository (from the project path) and identifies the models used; since the JetBrains plugin stores no token counts locally, cost is **estimated** from chat content and every entry is marked `~est`. Off by default; the reader is capped/scaled for speed and degrades to nothing if the undocumented store format changes.

## [1.11.0] — 2026-06-13

### Added

- **Activity heatmap** — a GitHub-style calendar of daily spend over the last 26 weeks, so you can see your usage rhythm at a glance (weekends, crunch weeks, quiet spells).
- **Filter the repository table by source** — one-click Copilot / Copilot CLI / Claude Code chips next to the text filter; combine with the search box and column sorting.

## [1.10.0] — 2026-06-11

### Fixed

- **Token pricing accuracy across providers.** Token buckets are now disjoint and consistent everywhere (fresh input / cache read / cache write / output). Previously Claude Code's fresh `input_tokens` (which excludes cache reads, per the Anthropic API) was incorrectly reduced by the cache-read count, zeroing it out; Copilot's cache-inclusive `inputTokens` is normalized at the source. Billed entries (AI-credit units, premium requests) were always correct — only token-computed costs are affected, and the per-model **effective $/1M** figures are now exact.

### Added

- **Smart empty state** — when the selected month has no data but other periods do, the dashboard says so and offers a one-click **View all time** instead of a generic "no usage" message. The footer always shows loaded events per source, so it's obvious data exists and where.
- **`Copilot Cost Lens: Show Diagnostics`** command — prints scanned storage roots, files parsed, events per source, newest timestamp and any scan errors to the output channel. Makes "no data" reports self-diagnosable.
- **Hardened configuration parsing** — malformed `projectGroups`, `priceOverrides`, `creditAlerts`, `starredRepos`, `extraStorageRoots` and `charsPerToken` values are sanitized instead of breaking a scan; covered by unit tests.

## [1.9.1] — 2026-06-11

### Fixed

- **Dashboard failed to render in 1.9.0** — a syntax error slipped into the webview script during the table rework, leaving the dashboard blank. A new unit test now parses the entire generated webview script, so a broken script can never pass CI again.

### Changed

- Complete screenshot gallery with mock data: overview, all-time view, repository and project details, inline project editor, credit-alert notification with the status-bar sparkline.

## [1.9.0] — 2026-06-11

### Added

- **Repository filter & sortable columns** — instant text filter (matches repo names and models) and click-to-sort headers in the repository table; built for workspaces with 100+ repositories.
- **"Open in VS Code"** button in the repository detail opens the project folder in a new window.
- **Period-scoped exports** — the dashboard CSV/JSON buttons now export the selected period (month or all time) instead of always everything.

### Removed

- **Invoice PDF export.** The receipt covers the same need — the project receipt includes the per-repository breakdown and per-model effective rates. One document type, less confusion. (`copilotCostLens.exportInvoice` command removed.)

## [1.8.1] — 2026-06-11

### Added

- **Effective $ / 1M tokens per model** — repository and project details show the blended price actually paid per million tokens for each model (cache effects included), with the same line on receipts (`~$/1M`). Compare it with the official list rates to see how much prompt caching saves you. Per-model token counts (input/output/cache read/cache write) are now aggregated everywhere.

## [1.8.0] — 2026-06-11

### Fixed

- **Model price table synced with GitHub's official "Models and pricing" reference.** Claude Fable 5 was priced at the Opus tier ($5/$0.50/$6.25/$25 per 1M tokens) — the official rate is double ($10/$1/$12.50/$50), so token-computed Fable 5 costs were understated by ~2×. Billed entries (AI-credit units, premium requests) were always correct; only token-computed and estimated entries reprice.

### Added

- **Long-context pricing tiers** — GPT-5.4 and GPT-5.5 above 272K context and Gemini 3.1 Pro above 200K now bill at the official higher rates per request.
- Rates for Gemini 3.5 Flash, MAI-Code-1-Flash and Claude Opus 4.8.

## [1.7.1] — 2026-06-11

### Changed

- **PDF documents default to English.** Receipts and invoices previously followed the VS Code display language; business documents now export in English unless `copilotCostLens.documentLanguage` says otherwise (`auto` = follow VS Code, or `cs`/`de` explicitly).
- README screenshots of the invoice and receipts regenerated in English.

## [1.7.0] — 2026-06-11

### Added

- **Starred repositories** — click the ☆ in the repository table to pin a repo; starred repos appear in a dedicated ★ Starred section at the top for a quick overview. Stored in `copilotCostLens.starredRepos` (syncs via Settings Sync).

### Changed

- **Exclusive project membership** — repositories already assigned to another project are no longer offered in the project editor, and saving a project removes its members from any other project they were part of.

## [1.6.0] — 2026-06-11

### Changed

- **Project editor moved into the dashboard.** Creating and editing a project no longer uses the VS Code input/quick-pick at the top of the screen — "＋ New project" and ✏️ Edit open an inline editor right in the dashboard: project name field plus a checkbox list of all repositories with their spend, members pre-checked, with a live selection counter and rename support. Members remain visible in the project detail and stay editable at any time.

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
