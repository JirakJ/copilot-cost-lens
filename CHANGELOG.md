# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
