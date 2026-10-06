# Continue cc-control: the app runs the card's session (the hub)

Paste this into a new Claude Code session opened in `D:\repos\cc-control` (the personal laptop) after `git pull`, followed by the phase you want to work on ("Phase A" to start). On the VU work laptop: read, diagnose, write a handoff (`docs/prompts/vu-handoff-template.md`), never edit or commit there.

---

You're continuing **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local, keyboard-first web app for working on many Claude Code sessions at once at a company. A card on the Ticket Line is one unit of work: a Jira or TFS ticket gives it context, it gets a branch and a worktree per repo, it starts a Claude Code session, it moves Plan → Build → Needs you → Try it → Ship as that session works, Try it starts the whole multi-repo stack on free ports, Ship opens one PR per repo. QA and code-review cards turn the same machinery toward testers and reviewers. The owner uses it daily, tests from a clone on their work laptop (VU), and is showing it to their org.

## The owner's vision (2026-10-06, in their words, condensed)

One central hub users never have to leave. Pick up work from Jira cards, spin up Claude sessions from them with as much context as the app can gather, see each session's status at a glance so one person can run several domains or issues at once, then the rest of the flow: local environments for smoke testing and QA, PRs for every affected repo, and eventually releases and deployments. During implementation: add context easily, reset a session's context while keeping the core context so work goes on in a fresh session (saving tokens), and see the diffs across every affected file in every repo. The app is **not** trying to replace Claude Code or match all of its features. It needs the highest-performance **basic** match so people can talk to their sessions easily from the hub.

## The decision: the app runs the session; the terminal is the escape hatch

Plan §26 (2026-09-29) chose to run every card's Claude in a Windows Terminal tab and to reach it from the page. That is why the chat is slow and fragile, and §85 to §91 are the bill: the page reads the transcript file off disk (a message at a time, no streaming), channels are off by org policy at VU, and the fallback is `hooks/cc-control-launch.ps1`, which screen-scrapes the console for Claude Code's prompt hint and injects keystrokes with 0.7 s, 1.2 s and 8 s waits. Four smoke-test rounds at VU in two days, and it broke once already when the CLI changed its status line. Claude Code offers no supported way to join a running terminal session, so "never leave the app" and "the session lives in a terminal tab" cannot both hold.

The responsive path already exists and is tested: `server/session-manager.ts` runs sessions in-process through the Agent SDK's `query()` with streaming partials, `canUseTool` approvals through `server/permission-broker.ts`, modes, todos, slash commands, `/clear` following and resume/fork. **From now on a card's session runs there by default.** A session the app runs is an ordinary Claude Code session on disk, so `g` can still hand it to a real terminal with `claude --resume`, and the board follows it there through the hooks and the mirror that already exist. The launcher and the channel stop being the way in.

Not in scope, ever: Claude Code feature parity for its own sake (`!` shell, every slash command's UI). Local only, loopback, never deployed.

## Read first, in this order
1. `CLAUDE.md`: local only; keyboard first with every action in `?` and the legend; a PLAN section per commit; conventional commits; named paths only; **check `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` before assuming an SDK API shape** (option names below were written without it open: verify each).
2. `docs/prompts/continue.md`: code layout, the owner's server on :7777, how to test on an isolated server, machine facts.
3. `docs/PLAN.md` §26 (why terminals), §28 to §29 (how a card starts and follows its session through hooks), §54 (a card is a unit of work), §81 (the open card: the chat is the page), §85 to §91 (the ways in, to be retired), §92 (this direction).
4. The seams this work touches:
   - `server/cards.ts`: `CardService.start` (branch/worktrees, then `openTab`), `claudeArgs`, `otherFolders`, `reopen`, `sessionStart` (the packet as `additionalContext`), `hookEvent` (→ `applyEvent`), `addContext` (waits on the card until a `UserPromptSubmit` hook takes it).
   - `server/card-events.ts`: `applyEvent(card, event, input)`, pure and tested: moves the card's stage, live line, ask, todos, files from Claude Code hook events. **Keep it as is.**
   - `server/session-manager.ts`: `start` (the `query()` options), `send` (resumes a history session on first send; forks when a terminal owns it), `handle`, `follow` (`/clear`), `restart` (new `--add-dir`s), `setMode`, `interrupt`; `server/permission-broker.ts` (`ask`, `respond` with `answers` for questions and `plan` for ExitPlanMode).
   - `server/index.ts`: `card.send`, `card.answer`, `card.answerQuestion`, `card.focusTab`, `card.addContext`, `typeInto`, the `/hooks/:event` route, the `session.*` messages, `mirror`.
   - `shared/cards.ts`: `Card` (`sessionId`, `channel`, `keys`, `relayed`, `live.ask`, `later`), `askOf`, `reachable`, `packetText`, `laterText`.
   - `web/components/CardView.tsx`: `Chat` (reads `transcripts[card.sessionId]`), `Say`, the dock; `web/line-keys.ts`: `saySubmit`, `answerAsk`, `goToTab`, `openAddComposer`, `LINE_SECTIONS`; `web/ws.ts`: `session.items`, `session.partial`, `session.transcript`; `web/components/SessionView.tsx` shows how partials and approvals are drawn for in-app sessions today.
   - `docs/walkthroughs/simple-new-card/walk-card.cjs` (the open card's Playwright net, seeded cards), `walk-resume.cjs`, `walk-type.cjs`.

## Phases

Each phase is its own PLAN section (next is §93) and its own commit or few, pushed to `main` once verified. Do them in order; A is the one everything else waits on. At the end of each phase, report plainly what passed, what didn't, and what was only tried against stand-ins.

### Phase A. A card's session runs in the app

**Done: PLAN §93** (2026-10-06; `walk-hub.cjs` passes). What differs from the plan below: the packet goes in the system prompt (in-process `SessionStart` callbacks never fire), `PermissionRequest` comes from the broker and `SessionEnd` isn't used.

**Goal.** `Ctrl+Enter` on the new-card screen starts the session inside the server; the open card streams the reply word by word; `Enter` in the box sends at once; `y` / `n` answer a tool prompt, a plan or a question without any keystroke injection; every card with a session is always reachable. No Windows Terminal tab is opened, no channel, no launcher.

**What to change.**
1. **Start.** `CardService.start` keeps everything up to and including the worktrees and trust, then, instead of `openTab`, asks a new `CardOpts.startSession(card)` (wired in `index.ts` to the `SessionManager`) to start a `query()` with: `cwd: card.cwd`; `additionalDirectories` = `otherFolders`; `permissionMode` from `card.launch.mode` (check the SDK's `PermissionMode` names: the card's `'default' | 'plan' | 'auto'`); `model` from `card.model` (check that an alias such as `opus` is accepted by the `model` option; if not, map through `supportedModels()`); `includePartialMessages: true`; `settingSources` set so the user's own `~/.claude` settings, allowlists, skills and MCP servers apply the way they do in their terminal (check the option's name and default in `sdk.d.ts`); `sessionId` fixed up front so the card can be linked before the first message arrives. The card's `boot` lines say what happened in the same voice as today ("Started Claude in the app in `<folder>` with 2 more repos").
2. **The packet.** Deliver `packetText(card, key, branchName)` the way the terminal path does, through the SDK's in-process **`hooks`** option: a `SessionStart` callback that returns `{ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }`, so `/clear` and compaction re-deliver it exactly as `sessionStart` does now (`source` of `clear` / `compact` / `resume`). Reuse `CardService.sessionStart`'s logic by lifting its body into a function both the HTTP hook and the callback call. If `sdk.d.ts` shows the `hooks` option can't return `additionalContext` for `SessionStart`, fall back to `systemPrompt: { type: 'preset', preset: 'claude_code', append: packet }` and say so in the PLAN section.
3. **The card follows the session.** Register in-process hook callbacks for every event in `TRACKED_EVENTS` (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`) that build the same `HookInput` and call `applyEvent` through `CardService.hookEvent`'s logic (no token check needed in-process). `card-events.ts` and its tests stay untouched. If an event isn't offered to in-process hooks, derive it from the SDK stream in `SessionManager.handle` (a `tool_use` block is `PreToolUse`, its result `PostToolUse`, a `result` message is `Stop`) in one small adapter with its own test.
4. **Asks.** `canUseTool` already lands in `PermissionBroker.ask` → `PermissionRequest`. Put that request's `reqId`, tool, summary, `plan` and `questions` on the card as `live.ask` with `requestId`, replacing `relayed`. `card.answer` → `broker.respond(reqId, 'allow' | 'deny')`; `card.answerQuestion` → `broker.respond(reqId, 'allow', answers)` (the broker already formats answers for AskUserQuestion; `web/components/QuestionForm.tsx` already draws the form; drop the `questionKeys` keystroke mapping). ExitPlanMode: approve = allow, "not yet" = deny with the broker's message. `askOf` loses `typed`; `y` / `n` always work on a reachable card.
5. **Chat.** `Chat` in `CardView.tsx` shows `partials[sessionId]` under the items while a turn runs (as `SessionView` does), the live line comes from `session.activity`, and `Esc` on the open card calls `manager.interrupt` (through a `card.interrupt` message or the existing `session.interrupt`). Make sure the page receives `session.items` / `session.partial` for a card's session even when no `SessionView` opened it (they are broadcast today; confirm, and confirm `transcripts[sessionId]` is loaded once when the card opens).
6. **Send.** `card.send` → `manager.send(card.sessionId, text, images)`. The manager resumes a history session itself on first send, so a card whose session isn't live (server restarted) just resumes: no reopen, no tab. Drop the `RESUME_WAIT_MS` wait, `channels.waitFor`, `typist.waitFor` and the Escape-before-text dance from this path. `reachable(card)` becomes: has a session, not owned by a terminal right now (Phase B), not ended by `/exit`; an ended session is still resumable, so the box says *Resume and send* and does it in the app.
7. **Context added later.** `addContext` on a live, idle session hands `laterText(...)` to Claude at once (as the next user turn, or as `additionalContext` on a `UserPromptSubmit` callback firing on the next send, whichever `sdk.d.ts` supports; mark the items `sent` when they go). A busy session keeps today's behaviour: the items wait and ride the next message. New repos still need the SDK restart `SessionManager.addDir` already does (same id, same transcript).
8. **Server restart.** On start, every card whose `live.phase` is `working` or `needs` becomes `waiting` with a boot line "The server restarted; the next message resumes the session". `manager.stopAll()` on shutdown already closes queries cleanly. The first send after a restart must resume in under a few seconds; log how long it took (`send KEY:` lines stay).
9. **Legacy.** Keep the terminal-tab start behind `CC_CONTROL_CARDS_IN_TERMINAL=1` for one release so VU can fall back; default off. Don't delete the launcher, channel or typist yet (Phase B decides what survives). Mark `channel`, `keys`, `relayed` on `Card` as legacy in a comment.
10. **Doctor and README.** `pnpm run doctor` no longer requires Windows Terminal for cards (it becomes "for `g`, optional"); channels are no longer mentioned as a requirement. README's "Talk to the session from here" paragraph is rewritten: the session runs in the app; `g` opens it in a terminal when you want one.

**Keys.** No new keys needed; every existing row in `LINE_SECTIONS`, the legend and `?` must still be true (`Enter`, `c`, `y`, `n`, `Esc`, `g`). Where a row's text says "in its tab", fix it.

**Verify.**
- `pnpm typecheck`, `npx tsc --noEmit --noUnusedLocals -p .`, `pnpm test` (new tests: the hook-callback adapter, `askOf` without `typed`, `reachable` on each phase, the restart notice).
- **The real thing, on the isolated server** (`CC_CONTROL_MODEL=claude-haiku-4-5-20251001`, a Demo repo): a new Playwright walkthrough `walk-hub.cjs` that makes a card from the new-card screen (not seeded), watches the reply stream in (assert a partial appears before the final item), sends a second message and sees it answered, gets a tool prompt and answers `y`, gets an AskUserQuestion form and answers it with digits and `Enter`, approves a plan on a Plan-first card, presses `Esc` mid-turn and sees it stop, closes and reopens the card and sees the transcript, then restarts the test server and sends again (the resume path). Screenshots in light and dark, looked at. `walk-card.cjs` (seeded cards) must still pass; adapt its seeds for `live.ask.requestId`.
- Record in the PLAN section the measured send → first partial and `y` → tool-ran times from the server log (Phase C makes them a budget).

### Phase B. The terminal as the escape hatch, and retiring the ways in

**Goal.** `g` on a card hands the session to a Windows Terminal tab when someone wants the real TUI; the card keeps following it; the app never injects keystrokes again.

**What to change.**
1. **`g` (`card.focusTab`).** If the app holds the session: close its query cleanly (the turn must be idle; while busy, `g` says "Claude is working; `Esc` stops it first"), then open a tab running `claude --resume <sessionId>` with the card's `--add-dir`s, mode and model and the `--settings` hooks file (the HTTP hooks keep the card's stage, live line and asks current; no channel args, no launcher). Mark the card `owner: 'terminal'`. If a tab with the card's key exists, bring it forward as today.
2. **While a terminal owns it**, the box reads *Open in its tab (g)* and is disabled, the ask says *Answer in its tab*, and the Chat follows through the mirror (a message at a time; say so in one quiet line). On `SessionEnd` from the tab's hook, or two minutes with no hook and no file change, `owner` clears and the next `Enter` resumes in the app. Never two writers on one transcript: the manager's `activeElsewhere` fork guard stays as the last line of defence, but the card path should never reach it.
3. **Retire:** `hooks/cc-control-launch.ps1`, `server/typist.ts`, `/launcher/poll`, `hooks/cc-control-channel.mjs`, `server/channel.ts`, `channelArgs`, `card.keys`, `CC_CONTROL_CHANNEL`, `reopen`, `walk-type.cjs`, `walk-resume.cjs`, and the `channel`, `keys`, `relayed` fields with their tests, once Phase A has been confirmed at VU (one smoke-test round). Remove the §87–§89 rows from README and `?`. PLAN sections stay as history; add a line at their top saying they were retired in §9x.
4. `CC_CONTROL_CARDS_IN_TERMINAL` goes with them.

**Verify.** Unit tests for the owner state; a walkthrough that starts a card in the app, presses `g`, sees a real tab open on the session (a minute on screen), types in the tab and sees the card's live line and transcript follow, closes the tab, and sends from the card again. `walk-hub.cjs` and `walk-card.cjs` pass.

### Phase C. A speed budget the walkthrough enforces

**Goal.** The hub stays fast as features land. Numbers the owner can quote.

**What to change.**
- The server logs, per card session: `send → first partial` (ms), `send → first item`, `y → PostToolUse`, `card open → transcript on screen`. The walkthrough reads them and fails above a budget: first partial within 3 s on Haiku, approve within 300 ms, open within 500 ms for a 200-item transcript.
- Fix what fails: `session.items` deltas not whole transcripts; `Chat` renders the tail and folds older items (`web/folds.ts` exists); markdown of a streaming partial debounced to ~50 ms; no Zustand selector returning new arrays (the open card re-rendered the whole board before).
- The card tile's live line updates within one hook event, not a poll.

### Phase D. Context you can keep, and a fresh session that keeps it

**Goal.** The owner's "reset session context while retaining core context". A card can move to a fresh session that starts with the packet and a handoff of the work so far, saving tokens; the card shows how full the session's memory is so people know when.

**What to change.**
1. **Memory on the card.** The manager has `ctxPct`; show it on the open card's header as "Memory 62%" (plain words, `SessionView` has the tooltip) and tint the tile from 70%.
2. **Fresh start (`card.fresh`, a key picked from what `LINE_SECTIONS` leaves free; add it to `?` and the legend, and a button in the dock's More panel).** Flow: if the session is live and idle, send it one fixed prompt asking for a handoff in a set shape (done, left to do, decisions, files touched by repo, how to run and test; no secrets); take the `Stop` message as the handoff. If the session is gone, build the handoff from the card's own record (`todos`, `files`, `live.lastMessage`, `report`). Then start a new session id for the card (the same options as Phase A) whose `SessionStart` callback returns the packet + every `later` item + the handoff; `card.sessionId` moves, the old id goes on `card.sessions: { id, from, to }[]` so the Chat can show *Earlier session* folded above and `Ctrl+K` still finds it. Changes, Try it and Ship are git-based and unaffected. Claude's `/clear` from a terminal keeps working through `follow` and `sessionStart(source: 'clear')`.
3. **+ Context is immediate** on an idle session (Phase A.7) and the Context panel shows when each item reached Claude.
4. **Diffs across repos** already exist (§90, `ship.changes`); make sure the Changes panel refreshes on `PostToolUse` of an edit tool for the file touched, not only on open.

**Verify.** Unit tests for the handoff shape and the record-based fallback; the walkthrough runs a fresh start on a real Haiku session and asserts the new session's first reply refers to something only the handoff could have told it.

### Phase E. Status at a glance across many sessions

**Goal.** One person runs five cards and always knows which needs them. Mostly exists; make it true for app-run sessions.

- The board's live line, amber *Needs you*, chime and `Alt+N` are driven by `applyEvent` and the broker; check each on an app-run card with two cards working at once (the walkthrough starts two).
- The tile shows the model, memory %, elapsed turn time, and the last thing Claude said (`live.lastMessage`, one line).
- `Ctrl+K` lists app-run card sessions with their card key.

### Phase F. Rollout at VU

- Doctor: channels and Windows Terminal are optional now; proxies no longer matter to the chat (nothing leaves the server process); say so in its output.
- A two-week test with two or three colleagues on real tickets, Develop and QA cards. What to watch: do they send from the card or open the terminal; how often does a card say it can't be reached (should be never); the Phase C numbers from their logs. Write the findings as a PLAN section; the decision after the two weeks is the owner's.

### Later (not now)
- Releases and deployments as a card kind or a Ship step (the team's deploy commands as stack-style lines).
- Supervising sessions outside the server process so a server restart never interrupts a turn.
- Writing QA reports back to Jira (§49 has the sheet).

## Don't
- Don't inject keystrokes into any console again, whatever the ask.
- Don't replicate Claude Code features for their own sake; the chat is for the judgment call and the nudge, the terminal is one `g` away.
- Don't widen a phase. New ideas go under *Later* in the PLAN section.
- Don't start a new feature while `walk-hub.cjs` fails.

## How we work
- Push verified work straight to `main`; no need to ask. Every change gets a PLAN section in the same commit, and a README row when user-facing.
- **The owner's app runs on :7777** as a hidden `node server/index.ts` serving `dist/web`: a page-only change reaches it with `pnpm build` (they reload). A server change needs a restart: **ask first**, then the lines in `docs/prompts/continue.md`. Restarting now also stops the sessions the server runs: say so when you ask.
- Test on the isolated server (`:7788`, its own DB, Haiku), never theirs. Demo repos in `%TEMP%\cc-demo`.
- Keyboard first; local only; never commit tokens, VU code, URLs, proxy entries, ticket contents or internal tool names.
- Windows 11, Node 24, pnpm, CRLF files. The Bash tool's heredocs eat backslashes: write scripts with the Write tool, fix regexes with Edit. Playwright: `Shift+Slash` opens help; check `[role=dialog]`, not page text. Zustand selectors must not return new arrays.

Start by reading, then say in a few lines what you understand the state to be and what the first commit of the phase will contain, check the SDK option names you'll rely on in `sdk.d.ts`, and go.
