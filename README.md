# cc-control

A keyboard-first command center for Claude Code sessions: arrow to a session, press Enter, fire commands from the number pad, hold a key to talk.

Status: Phase 1 (core) done. See [docs/PLAN.md](docs/PLAN.md).

## Run

Requires Node 24+, pnpm, and a logged-in Claude Code CLI (the app uses your existing login).

```sh
pnpm install
pnpm start        # builds the web app, serves http://localhost:7777
pnpm dev          # server with --watch + Vite on http://localhost:5173
```

Press `?` in the app for every key binding. The server binds to 127.0.0.1 only: it is effectively a remote shell, so never expose it.
