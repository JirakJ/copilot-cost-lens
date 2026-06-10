# Cost Lens for GitHub Copilot

**Know exactly what GitHub Copilot costs you — per repository, per model, per day. 100% local and private.**

Cost Lens reads the Copilot Chat logs that VS Code already keeps on your machine, attributes every request to the repository you were working in, prices it using GitHub's AI Credits model rates, and turns the result into a live dashboard, a tree view and a status-bar ticker.

![Dashboard](docs/dashboard.png)

## Why

Since GitHub Copilot moved to usage-based billing (AI Credits), the question is no longer *"how many requests did I make?"* but *"which project is burning my credits, on which model, and will I fit into my monthly allowance?"* GitHub's billing page gives you an account-level total — Cost Lens gives you the per-repository breakdown it can't.

## Features

- **Cost per repository** — every chat request is attributed to the workspace it ran in, resolved to a `owner/repo` slug via the project's git remote when available.
- **Dashboard** — monthly overview with spend, allowance gauge, end-of-month forecast, cost-by-repo chart, model donut, daily spend trend and a sortable repository table. Adapts to your color theme.
- **Status bar** — month-to-date credits and dollars at a glance; turns orange when you cross your warning threshold.
- **Tree view** — repositories ranked by spend with per-model breakdown, right in the activity bar.
- **Budgets & alerts** — set your plan (Business, Enterprise, promo periods or custom allowance) and an optional dollar budget; get warned once a day when you cross the threshold.
- **Forecast** — linear end-of-month projection based on month-to-date spend.
- **Export** — one click to CSV or JSON for invoicing, chargeback or further analysis.
- **Multi-installation** — scans VS Code, VS Code Insiders, VSCodium, Cursor and Windsurf storage automatically; extra locations are configurable.
- **Zero runtime dependencies** — small, fast, auditable.

## How it works

Copilot Chat stores conversation data in VS Code's `workspaceStorage`. Cost Lens combines two local sources:

| Source | What it provides | Accuracy |
|---|---|---|
| `GitHub.copilot-chat/transcripts/*.jsonl` and `debug-logs/**.jsonl` | exact token counts and billed AI-credit units per request | **exact** |
| `chatSessions/*.json` (VS Code's chat store) | model, timestamp and conversation content | **estimated** from content length |

When both exist for the same session, exact data wins. Estimated entries are always marked (`~est`) in every view. Costs are computed as:

1. **Billed credits** from the logs when present (`1 credit = $0.01`),
2. otherwise **exact tokens × model rate** (built-in price table, USD per 1M tokens),
3. otherwise **estimated tokens × model rate**.

The built-in price table covers GPT, Claude, Gemini, Grok and more, and every rate can be overridden in settings — so when GitHub updates pricing, you don't have to wait for an extension update.

> **Disclaimer:** Cost Lens is an independent open-source project, not affiliated with GitHub or Microsoft. The log format is not a stable public API and numbers shown here are an analytical aid, not a bill. Your GitHub billing page remains the source of truth.

## Privacy

Everything happens on your machine. Cost Lens:

- reads only local files under VS Code's `workspaceStorage`,
- makes **no network requests**, collects **no telemetry**,
- never executes git — repository names are read from `workspace.json` and `.git/config` as plain files.

## Getting started

1. Install **Cost Lens for GitHub Copilot** from the Marketplace.
2. Set `copilotCostLens.plan` to your Copilot plan (defaults to Business).
3. Open the **Copilot Cost Lens** view in the activity bar, or run `Copilot Cost Lens: Open Dashboard`.

Data appears automatically as you use Copilot Chat. Historical sessions already on disk are picked up on first scan.

## Settings

| Setting | Default | Description |
|---|---|---|
| `copilotCostLens.plan` | `business` | Plan preset for the included-credits gauge (`business`, `businessPromo`, `enterprise`, `enterprisePromo`, `custom`). |
| `copilotCostLens.includedCreditsPerMonth` | `1900` | Monthly allowance when plan is `custom`. |
| `copilotCostLens.monthlyBudgetUsd` | `0` | Personal dollar budget (0 = off). |
| `copilotCostLens.warnAtPercent` | `80` | Warning threshold for allowance/budget. |
| `copilotCostLens.statusBar.enabled` | `true` | Status-bar spend ticker. |
| `copilotCostLens.extraStorageRoots` | `[]` | Additional `workspaceStorage` roots to scan. |
| `copilotCostLens.estimation.enabled` | `true` | Estimate sessions that have no exact token data. |
| `copilotCostLens.estimation.charsPerToken` | `4` | Ratio used by the estimator. |
| `copilotCostLens.priceOverrides` | `{}` | Per-model rate overrides (USD per 1M tokens). |
| `copilotCostLens.refreshIntervalSeconds` | `120` | Background rescan interval. |

## Commands

- `Copilot Cost Lens: Open Dashboard`
- `Copilot Cost Lens: Refresh Usage Data`
- `Copilot Cost Lens: Export Usage as CSV` / `as JSON`
- `Copilot Cost Lens: Open Settings`

## FAQ

**Numbers don't match my GitHub bill exactly.**
Expected. Sessions without exact token logs are estimated from content length, code completions are not in chat logs (they're included in paid plans anyway), and Copilot usage outside this machine (web, CLI, other devices) is invisible locally. Treat Cost Lens as a relative lens on *where* your usage goes.

**I see `~est` everywhere.**
Your Copilot Chat version isn't writing token-level transcripts yet. Estimates still give you a faithful *relative* picture across repos; exact data is used automatically the moment it appears.

**Does it work with older "premium requests" billing?**
The pricing model targets AI Credits (effective June 2026). For older periods the relative per-repo breakdown is still valid.

## Development

```bash
npm install
npm run build        # bundle with esbuild
npm test             # vitest unit tests
npm run typecheck
npm run lint
npm run vsix         # package .vsix
```

Press <kbd>F5</kbd> in VS Code to launch the Extension Development Host.

## License

[MIT](LICENSE)
