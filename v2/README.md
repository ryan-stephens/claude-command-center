# Command Center v2

The second draft (PLAN §137). A session is the unit of work. Claude Code runs where you already work: a terminal, VS Code or Claude Desktop. Command Center sets the work up properly, hands Claude the team's tools, shows every session's stack, and ships.

```
pnpm v2            # builds the page and starts the server on http://127.0.0.1:7878
pnpm v2:server     # the server only (after pnpm v2:build)
```

v1 (`pnpm start`, :7777) is untouched and can run beside it. v2 reads v1's workspaces and stacks, so write a workspace's stack in v1 and v2 uses it.

## What it does

- **New work** (`/new`): a ticket key builds the preflight: repos, worktrees on a branch (node_modules hard-linked), the context pack, the APIs to run, the tools, the first message. Then Launch opens Claude in a terminal tab (or VS Code; for Claude Desktop, open the folder there).
- **Switchboard** (`/`): every session's stack, one UI and any number of APIs. Plug a session's UI into the front door (the sign-in port). Add or take out an API: the UI's `proxy.conf.json` is rebuilt and the UI restarted. Health every 5 s.
- **HUD** (`/hud`): a small window beside your terminals, with who needs you and one action each.
- **Ship dock** (`/ship/<id>`): PRs with the session's evidence, then the review request posted to Slack.

## How Claude gets the tools

Launch writes three files into the session's home worktree, kept out of git:

| File | What |
|---|---|
| `CLAUDE.local.md` | the context pack: ticket, criteria, worktrees, stack, logs, tools |
| `.mcp.json` | the `command-center` toolbelt (`v2/mcp/toolbelt.ts`): stack, test loans, field checks, evidence, ship |
| `.claude/settings.local.json` | hooks (`v2/hooks/hook.mjs`) that report Claude's state to the Switchboard |

Any Claude Code client opened on the folder gets them.

## Machine settings (never in the repo)

- `~/.cc-control/config.env`: Jira (as in v1), `CC_CONTROL_SLACK_WEBHOOK`, `CC_CONTROL_SLACK_CHANNEL`, `CC_CONTROL_SLACK_MENTION`.
- `~/.cc-control/verify.json`: where the test-data tool and the record lookup are (as in v1).
- `CCV2_PORT` (7878), `CCV2_DIR` (`~/.cc-control/v2`).

## Tests

`pnpm test` includes `v2/**/*.test.ts`. The walk: `pnpm exec vite build --config v2/vite.config.ts --outDir ../../dist/v2-test --emptyOutDir`, then `node docs/walkthroughs/v2/walk-v2.cjs` (an isolated server on :7841, stand-ins for everything).
