# One dashboard for all your AI tools

Copilot Cost Lens reads local logs from:

- **VS Code Copilot Chat** — always on (exact AI-credit data)
- **Claude Code** — `~/.claude` transcripts (exact token data)
- **GitHub Copilot CLI** — terminal sessions
- **ChatGPT Codex** — `~/.codex/sessions` rollout logs (exact token data)
- **JetBrains Copilot** — IntelliJ/Rider/… chat sessions (estimated, off by default)

Toggle each source in settings. Sessions without exact token counts are **estimated** from content length and marked `~est` in the dashboard.
