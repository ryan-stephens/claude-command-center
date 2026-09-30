# Try it starts the whole stack (Okteto API + proxied UI + a loan to test)

Paste this into a new Claude Code session opened in the cc-control repo, followed by the owner's answers to the questions at the end.

---

You're continuing development of **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`). It's a local web app that sits on top of Claude Code terminal sessions. Its home page is the **Ticket Line**, a board of tickets moving through the loop (Inbox → Plan → Build → Needs you → Try it → Ship → Done), where each card follows a Claude Code session running in a Windows Terminal tab. The owner uses it for everyday work at Veterans United (VU) and wants to roll it out to coworkers, so it has to stay simple for non-developers, fast for developers, and flexible about how teams work.

## Read before changing anything
- `CLAUDE.md`: the project rules.
- `docs/prompts/continue.md`: how the code is laid out, how to test without touching the owner's running app, and the machine facts.
- `docs/prompts/continue-ticket-line.md`: what the line does and where it stands.
- `docs/PLAN.md`, a numbered section per change. For this job, read these closely:
  - §33, run recipes and Try it
  - §35, trackers, dev environments and PR hosts stay swappable per team; Okteto is the example there
  - §37, workspace run recipes: `@repo`, `NAME=value`, `! by hand`, `stop:`
  - §40, QA cards and the workspace's *How this team tests* notes
  - §41, the full-screen card view
- The code you'll change: `shared/recipes.ts` (the step syntax and `parseStep`), `server/recipes.ts` (`RunService`, which decides when a step is "the app"), and the Try it section in `web/components/TicketLine.tsx`.

**Check which machine you're on** (hostname, repo path) before trusting machine details. The docs describe the owner's personal laptop (`D:\repos`, demo repos in `%TEMP%\cc-demo`, a server on :7777). The owner now works mainly on the VU work laptop, from a git clone they `git pull`. The real Okteto, TFS and Jira are only reachable from there.

## The job: `t` (Try it) brings up the owner's whole stack
Today a workspace recipe can run steps across repos, set variables per step, list steps to do by hand, and tear down on stop (§37). That was proved with stand-in scripts, never with real Okteto. The owner's actual flow is:

1. **The API runs on Okteto**, pointed at **dev (the default) or uat**. Choosing between them is part of starting it.
2. **The UI project's proxy config** (a `proxy.conf` file) is changed to point at that local/Okteto API.
3. **The UI's dev server starts** against that proxy.
4. **A loan is opened against the local UI**, and they test from there. Test loans come from VU's scenario tool, LoanForge: a repo run locally that Claude can already drive given context. It is described in the workspace's *How this team tests* notes (§40).

Make `t` do this end to end for the owner's workspace first. Prove it against the real thing at VU, then generalise, because other APIs and projects will come later (§35: each piece a swappable module configured per workspace, never an `if` threaded through the UI).

### What the recipe system likely needs
Confirm each against the owner's answers before building:
- **A choice made at Try it time**, such as an environment (dev / uat, dev by default), fed into steps as a variable. Pressing `t` should be one key with the default, plus a way to pick the other. It needs a key and a legend entry.
- **A step that edits a config file and puts it back on stop**, such as setting the proxy target in `proxy.conf`.
  - The change must never be committed by accident. Ship already only stages files you tick, and a file Try it changed shows as "not from this card"; keep it that way.
  - If the file is gitignored or has a local-override mechanism, prefer that.
- **Waiting for readiness, and passing values between steps.** Okteto's endpoint or readiness shows up in its output, so a later step needs that value (listed under "Not yet" in §37). Some steps are long-running (`okteto up` keeps a sync session), and the recipe must know when to move on.
- **Opening the loan**:
  - either a step that runs LoanForge to make a scenario and reads back the loan id
  - or a by-hand step with a clear instruction

  Then open the UI at that loan's URL, where `o` already opens the app.
- **Teardown on `t` again** (stop): restore `proxy.conf`, and stop or leave Okteto per the owner's preference.
- **Clear failure messages when a step can't run**: Okteto not logged in, the wrong context, the port in use, certificate errors (VU uses an internal CA; `NODE_OPTIONS=--use-system-ca` fixed npm).
- Consider a `pnpm run doctor` check for the `okteto` CLI and its context.

Keep secrets out of recipes and workspace files. Tokens go in `%USERPROFILE%\.cc-control\config.env`, and the Try it section shows variable names only, never values (§37).

## How we work
- **Push verified work straight to main**, without asking. "Verified" means:
  - `pnpm typecheck` and `pnpm test` pass
  - `npx tsc --noEmit --noUnusedLocals -p .` now and then (it already flags an unused `useEffect` in `web/components/CommandDialogs.tsx`)
  - for UI changes, a scripted Playwright walkthrough on an isolated server, with screenshots you actually look at
- **Build and test against stand-ins first**, the way §37 did (stand-in `okteto` / `deploy.js` scripts in demo repos), then hand the owner a short checklist to run at VU.
- **Report plainly** what passed and what didn't. Be clear about what met the real Okteto versus a stand-in.
- **Every change gets a PLAN section** in the same commit, plus a README update when it's user-facing. Keep `continue-ticket-line.md` pointing at what's next.
- Conventional commits. Stage named paths only, never `git add -A`. Files are CRLF. Node 24 and pnpm.
- **Still ask first before:**
  - restarting a server the owner is running
  - anything that writes to Jira or TFS (opening a real PR counts)
  - changing global npm, pnpm or git config
  - running real `okteto` commands that create, deploy or destroy anything in a shared namespace
- **Never commit** tokens, VU code or ticket contents. Keep VU-internal tool names out of code and examples: say "the scenario tool" in code, and put the real names in the owner's workspace notes.
- **Keyboard first, with the keys visible:** every action needs a key, a legend entry and a row in the `?` overlay. The top-left logo and `Alt+L` go home from anywhere. Local only: the server binds to 127.0.0.1.

## Lessons from earlier sessions
- **Zustand selectors:** a selector that returns a new array or object (`?? []`, `.filter()`) re-renders forever (React error #185). Keep a stable empty constant, or filter outside the selector.
- **Don't trim `git status --porcelain` output:** its leading spaces are part of the format.
- **The Bash tool's heredocs mangle backslashes** (regexes, Windows paths `D:\r` → `D:` + CR) and sometimes fail on quotes. Write edit scripts and test files with the Write tool, or use Edit.
- **Playwright:** `page.keyboard.press('?')` doesn't open help; use `Shift+Slash`. The legend bar also contains the words "Every key", so check for the `[role=dialog]` element, not page text.
- **A card started in a folder Claude Code hasn't trusted** stops at the trust prompt in its tab (§28). A new worktree always counts as new.
- **Real terminal tabs you start while testing can't be stopped from here** (process kills are blocked). Tell the owner which tabs to close.

## Before you start
Tell the owner in a few lines what you understand the current state to be and which machine you're on. If any of the answers below are missing, ask for them, then propose the design (the step syntax or UI, and how dev/uat is chosen) before building.

## Questions for the owner
Answer what you can. Replace anything internal or secret with a placeholder that keeps the shape: `https://api-<you>.<okteto-domain>`, `<token>`.

**The repos**
1. The UI and API repos' folder names (for example Workspaces-UI, Workspaces-API), and where they're cloned on the VU laptop. Is the API repo the one you run Okteto from?
2. Are they in one cc-control workspace already, and which is home?

**Okteto**
3. The exact commands you run today, in order: `okteto context use …`, `okteto namespace …`, `okteto up` or `okteto deploy`, any flags, and which folder you run them in.
4. How dev vs uat is chosen: a flag, an env var, a different manifest, a different namespace, or a config value the API reads?
5. Does it stay running (a sync session you leave open), or finish once deployed? How do you know the API is ready?
6. Where the API's URL comes from: printed by Okteto, a fixed pattern (namespace-based), or something you look up in the Okteto dashboard?
7. After testing, do you run `okteto down` or destroy, or leave it up?
8. Is `okteto` installed and logged in on the laptop, and does it run in PowerShell / cmd without prompting?

**The UI and proxy.conf**
9. The proxy file's path and name (`proxy.conf.json`? `.js`?), and a sanitised copy of the entry that changes (before and after).
10. Is that file committed? Do you normally revert it before committing? Is there a local-override file instead?
11. The command that starts the UI (`npm start`? `ng serve --proxy-config …`?), its port, and anything it needs first (`npm install` from the Azure Artifacts feed with `NODE_OPTIONS=--use-system-ca`).

**Opening the loan**
12. How you open a loan against the local UI today: a URL pattern with a loan id (sanitised), a page you navigate, or LoanForge doing it?
13. LoanForge: how it's run (a CLI, a local web app, a script), where it lives, and whether it can print the loan id it made so a later step can use it. What does "a scenario in state X" look like as input?
14. Does the local UI need you to sign in (SSO or similar) before a loan opens, and does that need a real browser?

**Scope**
15. For the first version, is it OK if some steps stay "by hand" (the recipe tells you what to do and waits), and only the Okteto → proxy → UI part is automated?
16. Should dev/uat be chosen per card, per workspace (remembered), or asked every time `t` is pressed?
