# cc-control

A keyboard-first command center for Claude Code sessions: arrow to a session, press Enter, fire commands from the number pad, hold a key to talk.

Status: all planned phases (0–5) done. See [docs/PLAN.md](docs/PLAN.md).

## Run

Requires Node 24+, pnpm, and a logged-in Claude Code CLI (the app uses your existing login).

```sh
pnpm install
pnpm start        # builds the web app, serves http://localhost:7777
pnpm dev          # server with --watch + Vite on http://localhost:5173
pnpm test         # unit tests (node:test)
```

Press `Ctrl+K` for the palette and `?` for every key binding (`B` there to rebind).

### Phone access (optional, Tailscale only)

```sh
pnpm start -- --remote          # also listens on this machine's Tailscale IP
pnpm start -- --remote --rotate-token   # revoke the old sign-in link
```

It prints a sign-in link with a secret token. Open it once on your phone (on the same tailnet), and treat it like a password.

Press `?` in the app for every key binding. The server binds to 127.0.0.1 only: it is effectively a remote shell, so never expose it.
