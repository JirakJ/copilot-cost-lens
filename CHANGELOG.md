# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
