# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
