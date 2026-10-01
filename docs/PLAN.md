# cc-control — implementation plan

A slim, local, **keyboard-first** command center for Claude Code sessions.
Pick a session with the arrow keys, press Enter, fire commands from the number pad, talk to it with a hotkey.

Status: **Showcase-ready** (2026-09-28). Phases 0–5 done, a hardening pass (§15), live activity (§16) and the **cockpit redesign** with workspaces (§17). "Later" items are parked. · Started 2026-09-28

---

## 1. Product principles

1. **Keyboard first, mouse optional.** Every action has a key, and the whole core loop works from the number pad alone.
2. **Zero-config start.** `pnpm start` opens `http://localhost:7777` and lists every Claude Code session on the machine. No setup screen.
3. **Always know who needs you.** A session that is waiting on you (for an approval, or because it finished) is the loudest thing on screen.
4. **Commands are shareable.** Command packs are plain JSON that can be committed into any repo, so a team shares its workflows through git.
5. **Slim.** One Node process, one SPA, one SQLite file. No accounts, no cloud.

## 2. The core loop (what "fast" means)

```
[Session list] --↑/↓--> pick --Enter--> [Session view] --Numpad 3--> command fired
      ^                                      |  hold ` --> speak --> release --> sent
      +-------------------Esc----------------+  Alt+↑/↓ --> hop to next session in place
```

Target: going from "a session needs me" to "handled" should take **3 keystrokes or fewer**.

## 3. Keyboard map (v1 defaults, all rebindable)

### Global
| Key | Action |
|---|---|
| `Ctrl+K` | Command palette (fuzzy search over sessions, commands and actions) |
| `?` | Keyboard help overlay |
| `Alt+↑` / `Alt+↓` | Previous / next session, from anywhere |
| `Alt+N` | Jump to the next session that **needs attention**: pending approvals first (oldest first), then sessions that finished unseen |
| `M` | Sound on / off (outside text fields) |
| `Alt+T` | Theme: match Windows → light → dark |
| `Alt+Shift+N` | New session in the app, without a card (pick repo → optional first prompt). Not `Ctrl+Shift+N`: Chrome reserves it for an incognito window and pages can't intercept it. |

### Ticket Line (the home page since §30; Home, §17–§25, is gone)
| Key | Action |
|---|---|
| `← → ↑ ↓` | Move between cards |
| `Enter` | Open the card's drawer (Overview, Context, Transcript; `Tab` switches) |
| `Ctrl+Enter` | The card's session full screen; again (or `Esc`), back to the line as you left it |
| `c` | New card (`m` model, `p` preview, `w` keep a card repo for the workspace, `Ctrl+Enter` start work) |
| `1–9` / `0` | One workspace's cards / all of them |
| `/` | Filter the cards by words (`Esc` clears) |
| `W` / `E` / `Shift+Delete` | New workspace / edit / delete the one shown (with All showing, a picker asks which) |
| `+` / `−` | Add a repo from the library to the workspace shown / remove one |
| `Shift+E` / `Shift+I` | Share the workspace as a file / import one |
| `F` | The folders the repo library lists |
| `n` / `Enter` (a ticket in the Inbox) | Start work on it: the new-card screen with the ticket as context (§31) |
| `Shift+T` | Tickets: demo set, Jira, Trello, project → workspace (§31) |
| `Delete` | Take the card off the line |

### Folder picker
The folders dialog (`F` on the Ticket Line), the workspace editor's "add a folder", and "Another folder…" (`Ctrl+O`) in the new-session and add-a-repo pickers all use it.

| Key | Action |
|---|---|
| `↑ ↓` `PgUp PgDn` | Choose a folder |
| `→` / `Enter` | Open the highlighted folder |
| `←` / `Backspace` | Up one folder (from a drive root: the starting points) |
| `Space` / `Ctrl+Enter` | Use the folder you are in (`Ctrl+Enter` also while typing) |
| typing | A name filters this folder; a path (`D:\repos`, `"C:\x"`, `~/code`) jumps there |
| `Esc` | Clear what you typed, then go back |
| `Tab`, then `Delete` | Folders dialog: go to your folders and remove one |

### Session view
Focus zones: **Composer** ↔ **Command board**. `Esc` steps outward: composer → board → list.

| Key | Action |
|---|---|
| `Numpad 1–9` | Fire command N in the current group. From the composer, this works only while the composer is empty, so numbers can still be typed. |
| `Alt+1–9` | Fire command N, always |
| `Numpad +` / `Numpad −` or `[` / `]` | Next / previous command group |
| `Numpad 0` | Back (the same as `Esc`) |
| `↑ ↓ ← →` + `Enter` | Move around the board (laid out like the numpad: 7 8 9 / 4 5 6 / 1 2 3) and fire the focused command |
| `i` (on the board) | Focus the composer |
| `E` / `Delete` (on the board) | Edit / remove the focused command. `E` on a slash command saves an editable copy. |
| `Ctrl+↑ ↓ ← →` (on the board) | Move the focused command to the neighbouring slot |
| `Shift+E` / `Shift+I` (on the board) | Export / import global commands as JSON |
| `PgUp` `PgDn` `Home` `End` | Scroll the transcript |
| `Enter` / `Shift+Enter` (in the composer) | Send / newline |
| `Esc` (while Claude is working) | **Stop the turn**, like Esc in Claude Code (also dismisses a pending approval). When idle, `Esc` steps out as before. `Numpad 0` always steps out. |
| `Ctrl+.` | Interrupt the running turn (same as Esc while busy, works anywhere) |
| `Ctrl+B` | Send the running tool or subagent to the background (like Ctrl+B in the terminal) |
| `Tab` (in the composer) | Go to the board / approval card without interrupting |
| **Hold `` ` `` (backtick)** or **Hold `Numpad .`** | **Push-to-talk** voice input. Release to send. Like the numpad, this works only while you aren't mid-message, so backticks still type. `Esc` while holding cancels. |
| `Y` / `A` / `N` | Pending approval: **Y**es once / **A**lways / **N**o. Works when the approval card is focused, which happens automatically unless you are in the message box (then `Tab`). `D` shows the raw details. |
| `+` (on the number pad) | Give this session another repo to work in |
| `Numpad /` · `Numpad *` | Type a message · search everything |

The number keys and their labels are always visible on the command tiles (like a game hotbar), so nothing has to be memorised.

## 4. Features by pillar

### 4.1 Sessions
- **Live sessions**: started or resumed by cc-control and owned by its server. They are fully controllable.
- **History**: `listSessions()` across all projects under `~/.claude/projects`. Selecting one shows the transcript (`getSessionMessages`), and `Enter` resumes it (`resume: id`).
- **Status badge** from `session_state_changed`: `running` (spinner), `idle` (done, ✓), `requires_action` (pulsing amber). Each row also shows repo, git branch, title, last activity and context usage (`getContextUsage()`).
- **"Active elsewhere" guard**: if a transcript's JSONL was modified in the last ~2 minutes and cc-control doesn't own it, it's probably open in a terminal. Warn before resuming, because two writers on the same session conflict.
- The session view streams output with collapsible tool calls. Assistant text renders as markdown.
- **Notifications**: a browser Notification plus an optional sound when a session goes `idle` or `requires_action` while it isn't focused. The tab title shows a count (`(2) cc-control`).

### 4.2 Approvals
- `canUseTool` → the server holds the promise → pushes a `permission_request` to the UI → the user presses Y/A/N → the promise resolves. "Always" returns the SDK's `suggestions` as `updatedPermissions`.
- A global **approval inbox** (`Alt+N` cycles through it).
- A permission-mode switch per session: default, acceptEdits or plan (`setPermissionMode`).

### 4.3 Command board
A command is `{ label, body, group, slot, mode, scope }`:
- `mode: send`: sent immediately, e.g. `/code-review high` or "run the web build and report errors".
- `mode: insert`: dropped into the composer for editing.
- `mode: template`: `{{prompt}}` placeholders open a one-line input first, e.g. `Make a card for: {{idea}}`.

It also includes:
- **Groups** (tabs), where slots 1–9 map to the number keys, reordered by drag or with `Ctrl+↑/↓`.
- **Scopes**:
  - global (SQLite)
  - per repo (`<repo>/.cc-control/commands.json`, committed and shared with the team)
  - auto-generated from the session's `supportedCommands()`, i.e. its slash commands and skills
- An inline editor (`E` on a focused tile), plus import/export of packs as JSON.
- **Voice triggers**: saying a command's label (e.g. "code review") fires it (see 4.4).

### 4.4 Voice
- v1 uses the **Web Speech API** (Chrome/Edge, which treat `localhost` as a secure context): push-to-talk, a live transcript in the composer, and release to send (or release and then Enter, configurable).
- If the whole utterance fuzzy-matches a command label, that command fires instead of the text being sent (e.g. "run tests"). Low-confidence matches ask for confirmation first.
- ⚠️ Chrome's Web Speech sends audio to Google's servers. A later option is **local Whisper** (whisper.cpp / `faster-whisper` server) for private, offline dictation.

## 5. Architecture

```
Browser SPA (Vite + React + TS)
   │  WebSocket (JSON messages)  +  REST (commands CRUD, history)
Node server (Hono + ws), bound to 127.0.0.1:7777
   ├─ SessionManager ── one @anthropic-ai/claude-agent-sdk `query()` per live session
   │                     prompt = AsyncIterable input queue (keeps the session open)
   │                     canUseTool → PermissionBroker (pending promises)
   ├─ HistoryIndex ──── listSessions() / getSessionMessages() + fs.watch on ~/.claude/projects
   └─ Store ─────────── node:sqlite (built into Node 24, no native build): commands, groups, settings, keybinds
```

- **Session status** comes from `session_state_changed`, which the CLI only emits when `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` is in `options.env` (see §9). SessionManager always sets it, and falls back to deriving status from `result` messages plus pending `canUseTool` calls if no state event arrives after init.
- **Why the Agent SDK instead of spawning `claude -p` ourselves:** it gives typed messages, `interrupt()`, `setPermissionMode`, `supportedCommands`, `getContextUsage` and session listing for free.
- **Frontend state:** Zustand store keyed by session id. A single `useHotkeys` layer with a focus-zone stack makes key handling deterministic.
- **Styling:** Tailwind; dark by default.

### WebSocket protocol (sketch)
```
client → server                       server → client
session.create {cwd, prompt?}         session.upsert {id, status, title, cwd, branch, ctx%}
session.resume {id}                   session.message {id, msg: SDKMessage}
session.send {id, text}               permission.request {id, reqId, tool, input, suggestions}
session.interrupt {id}                permission.resolved {reqId}
session.stop {id}                     notify {id, kind: 'idle' | 'needs_action'}
permission.respond {reqId, decision}
```

### Security
- Binds to `127.0.0.1` only by default. It is effectively a remote shell, so never expose it publicly.
- Remote/phone access goes over **Tailscale** only (`--remote`), guarded by a secret token that the server prints on start (see §14). It is never deployed on Coolify.

## 6. Phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Spike** (½ day) ✅ | Prove the risky bits in a script: SDK streaming input keeps a session alive across turns; `canUseTool` round-trip; auth uses the existing Claude login (`accountInfo()`); `resume` works on a terminal-created session; runs on Windows; Web Speech works on localhost | A script holds a multi-turn session with a manual approval |
| **1. Core** ✅ | Server, SessionManager, WS protocol, session list with full keyboard nav, session view with streaming output and composer, history + resume | Create / resume / chat with 3 sessions using only the keyboard |
| **2. Attention** ✅ | Approval cards (Y/A/N), inbox, `Alt+N`, notifications and sound, tab-title count, interrupt | A blocked session is cleared in ≤ 3 keys from anywhere |
| **3. Command board** ✅ | Groups, numpad slots, send/insert/template modes, editor, per-repo packs, auto slash-commands, import/export | A starter pack is fired entirely from the numpad |
| **4. Voice** ✅ | Push-to-talk, transcript to composer, voice-triggered commands | Hold the key, speak, release, and it's sent |
| **5. Polish** ✅ | `Ctrl+K` palette, `?` overlay, rebinding, phone layout, Tailscale + token, context-usage meter | Daily-driver quality |
| Later (parked) | Local Whisper, diff viewer for edits, per-session cost, multi-machine, session templates. **Parked 2026-09-28:** the project is being prepared as an org showcase, so the focus is polish, reliability and docs rather than new integrations. | — |

## 7. Starter command pack (rc-hub, example)
1. `/code-review high`
2. Run the web build and report errors only
3. Run the suites you touched and summarise failures
4. `git log origin/main..main` + `git status`: what's unpushed?
5. `/card-author {{idea}}`
6. `docker compose up --build -d` and smoke the change
7. Summarise what you did in 3 bullets
8. Continue
9. `/simplify`

## 8. Decisions
Locked 2026-09-28:
1. **Frontend**: React + Vite + TS.
2. **Voice v1**: browser Web Speech API. Local Whisper stays in "Later".
3. **After voice release**: auto-send. Voice-matched commands still ask for confirmation when the match is low-confidence.
4. **GitHub**: `https://github.com/ryan-stephens/claude-command-center` (local folder `D:\repos\cc-control`).

Open:
5. **Distribution for "everyone"**: local `pnpm start` only, or publish later as `npx cc-control`? This can wait until after phase 3.

## 9. Phase 0 findings

Run 2026-09-28 on Windows 11, Node 24, `@anthropic-ai/claude-agent-sdk` 0.3.283, model Haiku 4.5, in a fresh temp dir. Script: `spike/sdk-spike.mjs` (`pnpm spike`). **8/8 automated checks pass, and the manual voice check passes.**

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Auth via existing login | PASS | `accountInfo()` → `apiProvider: firstParty`, `subscriptionType: "Claude Max"`, `email`. `tokenSource` and `apiKeySource` are **undefined** under OAuth; no `ANTHROPIC_API_KEY` needed. |
| 2 | Multi-turn via input queue | PASS | One `query()` with an async-iterable prompt held two turns on the same `session_id`. Pushing `session_id: ''` on `SDKUserMessage` is accepted. |
| 3 | Approvals | PASS | With `settingSources: []` + `permissionMode: 'default'`, `canUseTool` fired once per Bash call. Allow wrote the file; deny (`{behavior:'deny', message}`) left it absent and the model didn't retry. `suggestions` was populated, so "Always" is feasible. |
| 4 | Status events | PASS* | **Surprise:** `session_state_changed` is not emitted by default. The bundled CLI gates it on `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` (not mentioned in `sdk.d.ts`). With it set: `running → idle` per turn, and `running → requires_action → running` around each approval; `canUseTool` fires while the state is `requires_action`. |
| 5 | Interrupt | PASS | `interrupt()` resolves to `{ still_queued: [] }`; the turn ends within ~5–20 ms with `result.subtype: "error_during_execution"`. The session answers the next turn normally. |
| 6 | Introspection | PASS | `supportedCommands()`: 54 commands with `settingSources: []`, 67 with default settings. `SlashCommand` also carries `builtin?` and `aliases?`; filter on `!builtin` to get user/project/plugin skills for the auto-generated command group. `getContextUsage({ detail: 'summary' })` returns `totalTokens`, `maxTokens`, `percentage` (plus per-category rows) cheaply. |
| 7 | History | PASS | `listSessions({ dir })` found the session with an auto-generated `summary`. `getSessionMessages` returned 23 entries for 6 turns, because tool-use / tool-result entries count as user/assistant messages, so the transcript view must group them. `getSessionInfo` also gives `gitBranch`, `cwd`, `createdAt`, `tag`. |
| 8 | Resume terminal session | PASS | `claude -p … --output-format json` (spawned with `shell: true`) → `session_id` → SDK `resume` recalled the codeword. **Resume keeps the same session id** (it appends to the same JSONL; no fork), so the "active elsewhere" guard in §4.1 is necessary. `forkSession: true` is the safe option when a terminal may still be attached. |
| 9 | Voice | PASS (manual) | `pnpm spike:voice` → `http://localhost:7778`. Hold `` ` `` or `Numpad .`; release stops recognition, and `onend` is the auto-send moment. The owner tested it by hand on 2026-09-28: it **works well in both Chrome and Edge** on localhost. |

Other observations:
- The SDK runs its **own bundled `claude.exe`** (`@anthropic-ai/claude-agent-sdk-win32-x64`), not the CLI on PATH. SDK-driven and terminal sessions can therefore be on different CLI versions; both write to the same `~/.claude/projects` store and interoperate (check 8).
- `options.env` replaces the child environment, so pass `{ ...process.env, … }`.
- A single `query()` result is followed by the `idle` state event, so treat `idle` (not `result`) as "turn over", as the SDK docs note.

**Architecture impact:** none structural. SessionManager sets `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` (see §5), history rendering groups tool entries, and resume of a recently-modified transcript offers `forkSession` instead of a plain resume.

## 10. Phase 1 notes

Built 2026-09-28. `pnpm start` builds the web app and serves everything on `http://localhost:7777`; `pnpm dev` runs the server with `--watch` plus Vite on `:5173`. Set `CC_CONTROL_MODEL` to force a model (tests use Haiku).

**Layout**
- `shared/protocol.ts`: WebSocket message types, imported by both sides.
- `server/`: runs as TypeScript directly through Node 24 type stripping (no build step), so it must stay erasable syntax (no enums or parameter properties; `erasableSyntaxOnly` enforces this). `index.ts` (Hono static + `ws`), `session-manager.ts`, `permission-broker.ts`, `history-index.ts`, `transcript.ts` (normalises SDK and stored messages into flat items), `input-queue.ts`.
- `web/`: React + Zustand + Tailwind v4. `keys.ts` holds the single key router and `KEYMAP`, which feeds both the `?` overlay and the hint bar.
- One package rather than a pnpm workspace: simpler, and nothing needs separate publishing yet.

**Changes from the Phase 1 proposal**
- **Approvals are in Phase 1**, not auto-allowed: auto-allow would turn every live session into bypass mode. The approval card with Y / A / N already works and takes focus automatically. The inbox, `Alt+N`, notifications and sound stay in Phase 2. The tab-title count also landed early.
- **The store (`node:sqlite`) moves to Phase 3.** Phase 1 has nothing to persist.
- **Session ids are chosen up front** with the SDK's `sessionId` option, including the fork target, so the UI never waits on an init message to learn an id.
- **Security**: the WebSocket upgrade requires a loopback `Host` and an `Origin` from the app or the Vite dev server. HTTP requests with a foreign `Host` get a 403, which blocks cross-site WebSocket hijacking and DNS rebinding.

**Verified end-to-end with Playwright, keyboard only (Haiku)**: created 3 sessions (`N` and `Alt+Shift+N`), approved a Bash call with `Y`, interrupted a long turn with `Ctrl+.`, hopped between sessions with `Alt+↓` and continued a conversation, stopped a session with `X Y`, found it again with `Tab` `/` and resumed it from History (it recalled the codeword), and sent to a session that a terminal had just written, which forked it with the history intact.

**Known gaps and follow-ups**
- **Resume/start latency is about 10 s**: spawning the CLI with the user's full settings and MCP servers is slow. The SDK has a prewarm mechanism (a spare `query()` claimed later); worth trying in Phase 2 or 5.
- Stored transcripts have no `result` entries, so "done in Xs · $cost" lines only show for turns run live.
- The SDK reports the branch `HEAD` for directories that aren't git repos.
- The history list is capped at 300 sessions and refreshed on a 1.5 s debounce whenever a `.jsonl` under `~/.claude/projects` changes.

## 11. Phase 2 notes

Built 2026-09-28. **Done-when met**: parked in another session's composer, a blocked session was cleared with `Alt+N` `Y` (2 keys), verified in Playwright.

- **Inbox tab** (`web/components/SessionList.tsx`): the sessions that need you, in `Alt+N` order. Approval rows show the tool and input, and `Y` / `A` / `N` answer them in place. Finished rows show a preview of the last reply.
- **Unread**: a live session that goes `running → idle` while you aren't looking at it (not open, or the window isn't focused) gets a dot and joins the Inbox. Opening it, or focusing the window while it's open, clears the dot. This is client-side state, so a reload forgets it.
- **Signals** (`web/attention.ts`): a Web Audio chime (two rising notes for "needs you", one soft note for "done"; `M` mutes it, and the preference is stored in `localStorage`), and a browser notification when the window isn't focused. Clicking the notification opens the session. Audio and the notification prompt are armed on the first key or click, as browsers require.
- The tab title shows `(n)` and the header badge counts sessions that need you.

**Bugs found while testing, and fixed**
- **Keys acted on a hidden row.** After a reload with an empty Inbox, `Enter` opened the History row that was still selected but not visible. List keys now act only on a selection the current tab and filter actually show (`visibleSelection()` in `keys.ts`). During the test this sent a prompt into this very planning conversation. The "active elsewhere" guard caught it and **forked** instead of writing into the live transcript, which shows that guard is worth keeping.
- **Missed "finished" transitions.** Full `sessions` snapshots, which are rebroadcast whenever a transcript changes, silently replaced live statuses. The later `upsert` then saw no change. Snapshots now run the same transition check.
- **Orphaned dev processes.** `scripts/dev.mjs` now kills whole process trees on Windows (`taskkill /T`). Otherwise `node --watch` survives and keeps port 7777. The server now prints a clear "port in use" message instead of a stack trace.

**Not verifiable headless**: the chime and the OS notification. Check them by hand: open the app, press any key once, start a session, switch to another window, and wait for it to finish.

## 12. Phase 3 notes

Built 2026-09-28. **Done-when met**: the starter pack was fired from the numpad alone in Playwright. `Numpad 2` sent "Summarise", `Numpad 6` opened the template and sent it, `Numpad +` cycled to the slash-command groups, and `Numpad 2` there ran `/context`. So slash commands work when sent as SDK prompts.

**Where commands come from** (board order: repo, then global, then auto)
- **global**: SQLite at `~/.cc-control/cc-control.db` (`CC_CONTROL_DB` overrides it). Seeded once with the generic "Everyday" starter pack from `server/packs.ts`.
- **repo**: `<cwd>/.cc-control/commands.json`, meant to be committed. This repo ships one (`.cc-control/commands.json`) as the example. The server only writes into directories that sessions actually use.
- **auto**: the session's `supportedCommands()` (kept current through `commands_changed` events). Non-built-in skills are paged into "Skills", "Skills 2", …, plus a curated "Built-in" group (compact, context, usage, review, …). Commands that take arguments open in the composer instead of sending. They are read-only; `E` saves a copy into "Mine". The last list seen is cached per cwd, so history sessions get the auto groups too.
- Both editable scopes are the same `CommandPack` shape, so save, delete, swap and import are written once in `packs.ts`. The global scope rewrites its few rows in one transaction.

**Keys**: see §3. The board is a 3×3 grid in numpad order. In the composer the numpad fires only while the draft is empty, so the draft lives in the store (`drafts`) rather than component state.

**Bugs found while testing, and fixed**
- **A dialog's Enter/Esc leaked to the screen underneath.** A dialog closes itself in its own handler, and the same event then bubbled to the window-level router, which no longer saw a modal. Enter in the editor fired the focused tile, and Esc in any dialog left the session. It happened for real during the test: Enter in the editor sent "Unpushed?" to a Haiku session. That session then asked to run `git status` in rc-hub, which I denied, and nothing ran there. The router now ignores any key event whose target is inside a `[role=dialog]`.
- **Firing from a fallback group.** While the board was refreshing, the selected group wasn't found, and the lookup fell back to the first group. `fireSlot` now fires only on an exact group match, and a board that no longer has the selected group resets the selection explicitly.
- **Creating a session or exporting while disconnected hung the dialog.** `send()` now reports failure, and those requests reject straight away.
- **node:sqlite's ExperimentalWarning** is filtered out at load time. Other warnings still print.

## 13. Phase 4 notes

Built 2026-09-28. **Done-when met in automation**: hold the key, speak, release, and it's sent. Verified in Playwright with a fake `SpeechRecognition` injected into the page, because headless Chromium has no speech backend. The real recogniser passed by hand in the Phase 0 spike (Chrome and Edge); **the owner should try the integrated app once** (`pnpm start`, open a session, hold `` ` ``).

- `web/voice.ts`: the push-to-talk controller. It listens while the key is held, and the live transcript replaces the composer text (read-only, with a red "Listening…" bar). Release calls `stop()`, and the recogniser's final `end` delivers the text. If Chrome ends recognition during a pause while the key is still held, it restarts. Window blur counts as a release, and `Esc` aborts. Errors are made readable (e.g. "Microphone blocked: allow it for this site in the address bar").
- `web/voice-match.ts` (pure, with tests in `voice-match.test.ts`, run by `pnpm test` using `node:test`): an utterance of 5 words or fewer is matched against command labels on the board, searching the current group first. It uses Dice similarity over character bigrams after normalising punctuation and filler ("please", "run …"). A score of **0.85 or more fires** the command; **0.6 to 0.85 asks** (`Y` run it, `N` send the words, `Esc` drop it); anything lower is sent as text. "slot three" or "command 7" fires that slot.
- **Surprise**: current Chromium exposes an unprefixed `SpeechRecognition`, and the code prefers it over `webkitSpeechRecognition`. Test fakes must replace both.

Verified: dictation was sent as text; "continue" fired Continue; "summary" asked "Run Summarise?" and `N` sent the words; hold then `Esc` sent nothing and stayed in the session; typing a message with backticks still works; `Numpad .` + "slot two" fired slot 2.

## 14. Phase 5 notes

Built 2026-09-28.

- **`Ctrl+K` palette** (`web/components/Palette.tsx`, `web/fuzzy.ts` + tests): fuzzy search over actions (new session, go to Inbox/Live/History, sound, help, shortcuts, export/import, and rename/interrupt/stop for the open session), the open session's commands, and every session.
- **Rebinding** (`web/bindings.ts` + tests, `BindingsDialog.tsx`): the global shortcuts (palette, help, next-needs-you, previous/next session, new session, interrupt, sound, push-to-talk) can be rebound. Open `?`, press `B`, pick a row, press `Enter`, then press the new keys. `Backspace` resets a row. Combos are built from physical keys (`e.code`), so they don't depend on the keyboard layout. Conflicts and the app's own keys are refused, and actions that work while typing must use Ctrl, Alt or Meta. Overrides are stored in the SQLite `settings` table and broadcast to every connected browser. The `?` overlay and the hint bar show the current bindings. Screen-local keys (arrows, Enter, Esc, numpad board, Y/A/N) stay fixed on purpose.
- **Context meter** (`CtxMeter`): a bar in list rows and the session header; amber from 70%, red from 85% (time to `/compact`).
- **Phone layout**: below Tailwind's `md` breakpoint, list rows drop the path column and a tap opens the session. The session view gets a back button; the board becomes a panel under the composer (⌗ button); the composer gains touch buttons for **hold-to-talk 🎙** and send. The hint bar hides. Checked at 390×844 with no horizontal scroll.
- **Remote access over Tailscale** (`server/remote.ts` + tests): `pnpm start -- --remote` (or `CC_CONTROL_REMOTE=1`) adds a second listener on the machine's Tailscale address, and only there. It refuses to start without one, and never binds 0.0.0.0 or the LAN. It prints a one-time sign-in link, `http://<tailscale-ip>:7777/auth?token=…`, which sets an HttpOnly, SameSite=Strict cookie. Every remote HTTP request and WebSocket upgrade then needs that cookie (compared in constant time), a Tailscale-IP or `*.ts.net` Host header, and a same-origin `Origin` header. The token persists in SQLite; `--rotate-token` revokes it. The loopback listener is unchanged and needs no token. Verified with a loopback alias standing in for the Tailscale IP (`CC_CONTROL_REMOTE_IP=127.0.0.2`, which only accepts Tailscale or loopback-alias addresses): 10/10 checks for no cookie, wrong token, sign-in redirect, wrong Host, and WebSocket without cookie / wrong origin / wrong token. **Not yet tried on a real tailnet**, because Tailscale isn't installed on this machine.
- The reconnect loop now backs off from 1 s to 10 s while the server is down.
- `pnpm test` runs 16 `node:test` tests (voice matcher, fuzzy, bindings, remote auth helpers).

## 15. Showcase hardening

2026-09-28, after Phase 5. The goal: a demo to the owner's organization, so no new integrations, just reliability, first impressions and docs.

**Independent correctness review.** A separate review agent read the whole codebase and found 11 issues, all fixed and the key ones re-verified in Playwright:
1. **An approval card stole focus from the composer**, so the next letters typed answered it (`a` = always allow). Cards no longer take focus from the composer; the card says "Esc first". Y / A / N are also ignored for 400 ms after a card appears.
2. **Dialogs opened by Enter were confirmed by that same Enter.** React 19 attaches the dialog's window listener before the event finishes bubbling, so "Stop this session" from the palette stopped instantly, and the welcome tour closed at once. The shared `useDialogKeys` hook (`Overlay.tsx`) ignores events older than the dialog. Verified: the tour now stays open.
3. **Two quick sends to a history session started two CLI processes** (or two forks). `SessionManager` now deduplicates in-flight resumes, and a fork's old id forwards to it. Verified: Enter then `Numpad 1` gave both turns to exactly one `claude.exe`.
4. A CLI that died mid-approval left unanswerable cards. `retire()` now cancels them.
5. Approvals held across a reconnect or server restart went stale. The client now clears them on connect, and the server re-sends the live ones.
6. After a dialog closed over the composer, keys went nowhere. The composer refocuses when the dialog closes.
7. The New-session dialog could hang if the socket dropped mid-create. Pending requests are now rejected on close.
8. **Editing a tile into an occupied slot overwrote it silently**, and a failed move still deleted the original. The editor now asks ("Press Enter again to replace"). A move is a single `command.save` with `from`, and the server deletes the source only after the save succeeds. Verified.
9. Rebinding could capture the screens' own keys (Y, A, N, E, `/`, `[`, Alt+1–9, …). These are now reserved, with tests.
10. `Alt+↑/↓` from a session missing from the current list landed on the wrong row. Fixed.
11. Voice restarted in a loop after a fatal mic error. Fatal errors now stop listening.

The review found no issue in the security boundary (loopback Host/Origin guard, remote token checks) or in the repo-pack write paths.

**Also added**
- **Welcome card** on first visit (`Welcome.tsx`): the five keys worth knowing, with current bindings. It can be reopened from the palette ("Show the welcome tour").
- **Palette ranking**: a minimum match quality for queries of 3 or more characters, and a session's repo path only counts when its title doesn't match. Scattered one-letter hits no longer flood the results.
- **Phone header** collapses to icons, and the header shows current bindings rather than hard-coded ones.
- **Server safety net**: unhandled promise rejections are logged instead of killing every live session.
- **CI** (`.github/workflows/ci.yml`): typecheck, tests and build on every push and PR (`packageManager` pinned to pnpm 11.1.1).
- **README** rewritten for a first-time reader, with screenshots in `docs/screenshots/`. They were taken with throwaway demo repos (`%TEMP%\cc-demo`) and a separate demo database, so no real session titles appear. Tailscale access is kept, but moved to a collapsed "Advanced" note.

## 16. Live activity and stopping

Added 2026-09-28 at the owner's request: *"sessions need to be able to see the same thing Claude Code is showing them"* and *"we need a way to stop a session, like Esc in Claude Code"*.

**Event shapes, confirmed with a probe turn** (thinking, a background shell and a subagent; Sonnet 5.5):
- **Model calls:** `system/status {status:'requesting'|'compacting'|null}` marks each one.
- **Phase changes:** `stream_event` `content_block_start` with `thinking` / `text` / `tool_use` (with its name).
- **Tool input:** arrives with the `assistant` message.
- **Subagents and shells:** `system/task_started {task_id, task_type: local_agent|local_bash|local_workflow, is_backgrounded, description}`, then `task_updated {patch:{status,end_time}}` and finally `task_notification {status:'completed'|'failed'|'stopped', summary}`.
- **Background list:** `system/background_tasks_changed {tasks:[…]}` is the authoritative list of background work, and it outlives the turn.
- **Not seen in that turn:** `thinking_tokens` and `tool_progress`. They are handled when present, but nothing depends on them.
- **The CLI refuses long foreground `sleep` commands** (it suggests `run_in_background`). Tests use `node -e setTimeout(...)` instead.

**Design**
- `server/activity.ts` is a pure reducer (event → state, unit-tested). It tracks the phase (working / thinking / writing / tool / compacting / retrying / approval), the current tool and its input, thinking tokens, API retries, and tasks. Finished tasks stay listed for 2 minutes, at most 5. Updates reach clients at most every 150 ms (`session.activity`). `SessionSummary.background` counts running background tasks.
- **Session view:** an activity bar above the composer. It shows the spinner line with ticking phase and turn timers (e.g. `Bash · npm test 12s · turn 40s`), **■ Stop (Esc)**, **⇲ Background (Ctrl+B)** during a tool, and a list of subagents and shells, each with **✕** to stop it (`Query.stopTask`).
- **The transcript** gets a notice when background work starts, and one when its `task_notification` says how it ended.
- **List:** the row shows a short live label ("Bash 12s", "thinking 4s"). An idle session with background work shows a violet **background** badge instead of "idle".
- **Stopping:**
  - **`Esc` while Claude is working interrupts** (`Query.interrupt`), from the composer or the board. `Tab` gets from the composer to an approval card without interrupting.
  - **`Ctrl+B`** backgrounds the running tool (`Query.backgroundTasks`).
  - **The palette** lists "Stop <task>", "Stop all running tasks", "Stop the current turn" and "End this session".
  - **The header** has an **End session** button (same as `X`).

**Verified headless** (`node -e` timers, Haiku): the live tool line with timers; `Esc` interrupted and the session went idle, staying in view; `Tab` then `Y` answered an approval; a background shell outlived its turn with the list badge on "background"; ✕ stopped it and the notice read "Background stopped"; `Ctrl+B` moved a running foreground command to the background.

## 17. Cockpit redesign: workspaces, repo library, keys you can see

2026-09-28. Goal from the owner: make it intuitive enough that a non-technical person could get coding work done, keep every capability, and make it a tool to use all day.

**How we got here**
1. **Audit** (`docs/UX-AUDIT.md`, screenshots in `docs/ux-audit/`): 20 findings ranked by how much they confuse. The blockers: no visible way to start, raw paths to pick a project, approvals needing a hidden `Tab`, and a first screen of 54 unfamiliar History rows.
2. **Round 1** (`docs/design-directions.html`): three Apple-style directions (Inbox, Projects, Focus) that hid key hints behind hover. **The owner rejected all three.** They want a daily driver where keyboard use is *visibly expected*, and a way to group many repos and pull them into a session as context, with drag and drop from a folder of repos.
3. **Round 2** (`docs/design-cockpit.html`): the **cockpit**. Approved as is, with the groups named **Workspaces** and the theme following the OS.

**What changed**
- **Home is three columns you walk with `← →`**: workspaces (keys `1–9`, `0` for everything else) → that workspace's sessions, bucketed **Needs you / Working / Done / Earlier** → a preview that shows the last reply or answers a pending approval. The focused column is lifted with an accent edge; every row shows its key.
- **Workspaces** (`server/store.ts`, `shared/workspaces.ts`): a name, a colour, repo paths and a home repo, in SQLite. A session belongs to every workspace holding its `cwd` (Windows paths compare case-insensitively). Each workspace has its own **workflows** (a new `workspace` command scope, first on the number pad), seeded from starter templates in `shared/templates.ts` (Web app, API service, Docs, Blank). Slots 1–3 and 7–9 are the same in every template.
- **Repo library** (`server/repo-library.ts`): git repos directly under the source folders you pick (one level, no watching; worktrees are followed through `.git` files). First run suggests sources from where past sessions ran (`suggestSources`). Drag a card onto a workspace (adds it), onto a session row or context bar (extra context), or use `+` / `Enter` from the keyboard.
- **Extra repos per session**: the SDK takes `additionalDirectories` only at launch, so adding a repo to a live, idle session **restarts its CLI in place** (same id, same transcript, `resume`); a busy one refuses with a message. History sessions get them on resume. Kept in SQLite (`session_dirs`). Verified: added `docs-site` to a running `web-app` session, and the next turn read `docs-site/README.md` without an approval card.
- **Plain language** (`web/plain.ts`, tested): tool steps as sentences ("Read index.html", "Changing src/a.ts", Claude's own Bash description), file names relative to the repo, and approval explanations ("Claude wants to check app.js for syntax errors") with a **risk rating**: safe (only looks), makes changes, careful (deletes, pushes, installs, network, admin, kills processes, infrastructure, publishes). Rules match at the start of each command in a `&&` / `|` chain, so `grep format` is not a disk format. The server now sends structured `fields` (description, file, edit before/after) with tool items, approvals and live activity.
- **Transcript**: chat bubbles, and consecutive tool calls fold into a **steps card** (last 4 shown, rest behind "N earlier steps"). Edits show "See change" with a real line diff (`web/diff.ts`, LCS with folded context). The API cost moved to a tooltip; "done in 13s" reads "Finished in 13s".
- **Approvals** explain themselves: what, risk and why, what it touches, then **Y Allow once / A Always allow (says exactly what) / N Don't allow** as big keycaps. Raw command and diff behind `D`. For careful actions, "Don't allow" is the highlighted default.
- **Number pad drawn as a real numpad**, including `Num / * −`, `+` and `Enter` (tall), `0` (wide) and `.` (hold to talk), so what is on screen is what is under your hand. `Numpad /` focuses the message box, `Numpad *` opens search.
- **Keys you can see**: keycaps are the visual language. A context **legend bar** (`web/legend.ts`, tested) shows the 5–8 keys that matter for the focused column or zone, in large keycaps; the full list stays in `?`.
- **Theme** (`web/theme.ts`): light and dark tokens, following Windows unless you pick one (`Alt+T`, header button). Components use semantic tokens (`bg-surface`, `text-sub`, `text-attn`…) defined with Tailwind's `@theme inline`. Base and component CSS sit in `@layer base` / `@layer components` so utilities win.
- **Words**: "Command Center"; sessions say "Waiting for your OK", "Working on it", "Finished · your turn", "Done", "Open in a terminal"; the context meter reads "Memory"; subagents are "helpers".
- **Share a workspace** (`server/workspace-file.ts`, tested): `Shift+E` / `Shift+I` in the workspace column (or the palette, or Export in its editor). The file lists repos **by folder name** plus the workflows; import matches the names against your own library and says which it could not find. Verified over the socket: export, import as a copy with one unknown repo, delete.
- **First run** (`Welcome.tsx`): four key clusters (arrows, number pad, Y/A/N, Esc and talk), then straight into creating a workspace, including picking the repo folder. The seen flag is `cc-control.welcomed.v2`, so existing users see it once more.

**Decisions and deviations**
- **Approvals do not steal focus from the message box**, even when it is empty, contrary to a line in the cockpit mock. Starting to type just as a card appears would otherwise answer it (`a` = Always allow), which is the bug §15 #1 fixed. The card and the legend say "Tab to answer". The 400 ms grace stays.
- On home, `N` is "new session" everywhere except the preview column, where `Y`/`A`/`N` answer the selected session's approval. That removes the old Inbox rule where `N` meant two things.
- Inbox / Live / History tabs are gone: their jobs are the buckets, the header badge plus `Alt+N`, and "Everything else" (key `0`).

**Verified** (headless Chromium on an isolated server and database, Haiku, throwaway repos under `%TEMP%\cc-demo`): welcome → workspace created from the folder picker → second workspace from the keyboard → `N` → prompt → approval answered with `Tab` `Y` → done → home with preview → drag a repo onto a workspace → `+` added a repo to a live session, which then answered from it → `?`, `Ctrl+K`, light and dark themes, phone 390×844 (workspace chips, session, number pad panel). No console errors. `pnpm typecheck`, `pnpm test` (59 tests) and `pnpm build` pass.

**Independent review** (a separate agent read both commits): 11 findings, all fixed.
1. **Cycling number-pad groups broke every workflow key.** `cycleGroup` wrote the old key format, so no group matched exactly and `fireSlot` refused silently. Now it uses `groupKeyOf`, with a test (`web/commands.test.ts`).
2. **Some dangerous commands were rated Safe:** `ls & rm -rf x` (a lone `&`), `echo $(rm -rf ~)`, `env rm …`, `find -execdir rm`, and `1>file` redirects. The classifier now splits on `&` (not inside `2>&1`), checks `$(…)`, backticks, `<(…)` and `bash -c` / `cmd /c` / `powershell -Command` strings, drops `env` from the read-only list, and treats any `N>` redirect or `--output` as a write.
3. Home keys could move focus into columns hidden at the window width (answering an approval you couldn't see). Keys and the legend now skip hidden columns.
4. After a restart, the old query's loop could still write into the shared transcript. It stops at once now, and the new session gets its own copy.
5. Workspace repos weren't checked, so the repo-pack write guard accepted any path. New repo paths must be existing folders, and `writeRepoPack` never creates the repo folder itself.
6. The top-row digits now run workflows on the number pad, as the legend says.
7. More careful rules: `git -C x push`, `reset … --hard`, `restore`, `checkout .`, `xargs rm`, `rimraf`, `ssh`/`scp`/`rsync`.
8–11. The library index can't go negative. A bad source folder is reported, not dropped. Esc in the embedded folder field no longer closes the workspace editor. The library scan is cached and runs on request, not on every connection.

**Known gaps**
- Home loads the preview's transcript on selection (after 200 ms); very long histories make that first read slow, as before.
- Drag and drop needs a mouse; the keyboard path (`+`, `Enter` in the library) covers the same moves.


## 18. Folder picker, and a server that says it is out of date

2026-09-28. The owner opened the folders dialog, typed a path, pressed Enter, and the folder didn't persist.

**Cause (confirmed):** the app on `:7777` was the pre-redesign server (process started 21:04, before the redesign commits) serving the new web build. On connect it sent only `sessions`, `settings` and `session.activity`, with no `workspaces` or `library`, so it dropped `library.setSources` without a word. A restart fixes it. The changes below make that case impossible to miss, then remove the need to type paths at all.

**What changed**
- **Protocol handshake** (`PROTOCOL` in `shared/protocol.ts`): the server's first message is `hello { protocol }`. A page that hears anything else first, or an older number, shows a red banner: *"The cc-control server is out of date… stop it and run `pnpm start`."* A newer number asks you to reload the page. Requests that need an answer (`fs.list`, `library.setSources`) fail at once against an outdated server, and after 10 s against a silent one, with that message inside the dialog.
- **Requests with answers** (`web/ws.ts` `request()`): `fs.list` and `library.setSources` carry a `reqId`; the server replies `fs.list`, `ok`, or an `error` with the same `reqId`, and the dialog that asked shows it. Errors no longer only flash in the header.
- **Paths people actually paste** (`normalizeFolder` in `server/fs-browse.ts`, tested): "Copy as path" quotes (straight or curly) dropped, `~` expanded, either slash, `..` resolved, trailing separators stripped except on a root, and `D:` means the root of D (Windows reads a bare `D:` as "the current folder on D"). `\foo` and `C:foo` are refused, since both are relative. Used for library sources, workspace repos, `session.create`/`addDir`, and the picker.
- **Sources** (`cleanSources`, tested) name the bad path in the error ("There is no folder at D:\x."). Saved sources that are offline (an unplugged drive) are kept, so removing one source never fails because of another.
- **`fs.list { reqId, path? }`** (`listFolder` / `listRoots`): the subfolders of `path`, each marked as a git repo or with the number of repos directly inside (up to 150 checked). No path returns the starting points: the drives, your home folder, the library's folders and the suggested ones. Read-only and names only. Hidden (`.x`), system (`$Recycle.Bin`, `System Volume Information`, `AppData`…) and `node_modules` folders are skipped, with up to 300 entries per folder. Measured: `D:\` 16 ms, `C:\Users\ryans` 5 ms. The server still binds to loopback only.
- **Folder picker** (`web/components/FolderPicker.tsx`, pure parts in `web/folder-model.ts`, tested): a breadcrumb (`Start › D: › repos`, clickable) with "5 repos inside", a field, and the folder list. Keys are in the table in §3. A half-typed path shows its parent filtered to the rest (`D:\repos\we` shows `D:\repos` filtered to "we"). Rows highlight on mouse *move*, not enter, so a list redrawn under a resting pointer doesn't steal the keyboard's place.
- **Used in all three places:** the folders dialog (with your folders listed, their repo counts, `Tab` then `Delete` to remove, and a confirmation like "D:\repos is in your library: 5 repos"); the workspace editor's embedded prompt; and "Another folder…" (`Ctrl+O`, or the last row) in the new-session and add-a-repo pickers. A path typed there now opens the picker at it instead of being used unchecked.
- **Focus fixes found while testing:** deleting a focused folder row moves focus to its neighbour first (it used to fall to the page, and then `Esc` did nothing). Closing the embedded picker returns focus to its toggle. `Esc` with focus lost closes any input-driven dialog (`INPUT_DIALOGS` in `web/keys.ts`). Disabled buttons now look disabled.
- `CC_CONTROL_WEB_DIST` makes the server serve another build, so a test server never rewrites the `dist/web` that a running app serves.

**Verified** (headless Chromium, isolated server on `:7788` with its own database and a build in `dist/web-test`; screenshots only inside a demo workspace): pasted a quoted `"…\cc-demo"` into the workspace editor, which jumped there ("5 repos inside"); `Ctrl+Enter` added it and the library row showed the 5 repos. Then `F` → arrows to `D:` → `Enter` → arrows to `repos` ("5 repos inside") → `→` → `Space` → "D:\repos is in your library: 5 repos", and the library row updated. A missing path showed its error inside the dialog, and `D:` opened the drive root. **After a server restart both folders were still there.** `Tab` `↓` `Delete` removed `D:\repos` and the row went back to 5 demo repos. `Ctrl+O` worked in add-a-repo and in new session (picked `cdn-worker`), and `?` shows the new section. A stand-in for an old server (its `hello` dropped) showed the banner, and the folders dialog said why inside. No console errors. `pnpm typecheck`, `pnpm test` (75 tests) and `pnpm build` pass.

**Known gaps**
- The picker lists only folders, one level at a time, with no search across the disk; paste a path to jump.
- Repo counts look one level down, the same depth the library scans, so a folder of folders of repos shows 0.

## 19. A workspace is the context: its sessions can use all of its repos

2026-09-28. The owner's call: people expect every session in a workspace, new or running, to be able to use every repo in it. Until now a workspace only grouped repos, and a session could use other repos only when they were added to it one by one.

**What changed**
- **The rule** (`workspaceRepos` in `shared/workspaces.ts`, tested): a session in `cwd` can use every repo of every workspace that holds `cwd`, except its own (or one that contains it). On top of that come the repos added to that session alone. All of them go to the SDK as `additionalDirectories`. Repos that don't exist right now (an unplugged drive) are left out, so they can't stop a session starting.
- **Changes reach running sessions** (`SessionManager.setWorkspaces` / `applyDirs`): the server passes every workspace change to the manager. Each live session remembers the repos its CLI launched with. If they differ, an idle session restarts in place (same id and transcript, as in §17) with a note ("Now also working in payments-api." / "No longer working in …"). A busy one is marked and restarts once it is idle and nothing runs in the background. History sessions get the new set when they are resumed. `SessionSummary.workspaceDirs` carries the inherited repos to the page.
- **Removing** mirrors adding, with `−` next to `+`. On home, `−` opens "Remove a repo from *workspace*" (`↑ ↓`, `1–9` or `Enter`), which warns that sessions running in that repo leave the workspace. In a session, `−` opens "Stop this session using a repo", which lists only the repos added to that session and shows the workspace's repos greyed out with "remove it there". The picker is `RepoRemover` in `Dialogs.tsx`. The old `Ctrl+K` "Stop working in …" action still works.
- **Labels say which kind is which:** the session bar reads **"Claude can use"**: its own repo, the workspace's repos (with the workspace badge, not removable there), then its own additions (with ×). The sessions column of a workspace has a strip, **"Sessions here can use"**, listing its repos with the home repo marked, × on each, and `+ Add` / `Remove −`. Repo cards can be dropped on the strip. The new-session dialog lists the workspace's repos next to the chosen one and says "Claude can use every repo in *workspace*; this is just where it starts". Space-to-add-more is offered only outside a workspace, where it still matters.
- `?`, the legend and the README list `+ / −` for both.

**Verified** (headless Chromium, isolated server on `:7788`, Haiku, the demo repos): workspace Demo = web-app + docs-site. `N` → web-app → the dialog showed docs-site coming along. Asked for the first line of `docs-site\README.md` by absolute path, and Claude read it and answered "Acme docs" **with no approval card**. The session bar read "Claude can use web-app · docs-site". `+` added payments-api to the workspace, and the idle live session restarted with "Now also working in payments-api". `−` on home → `3` removed it, giving "No longer working in payments-api". In the session, `+` added cdn-worker to it alone, and `−` offered cdn-worker with docs-site greyed as Demo's; `1` removed it. No console errors. `pnpm typecheck`, `pnpm test` (76) and `pnpm build` pass.

**Known gaps**
- A busy session picks up a workspace change only after its turn. Until then its chips already show the new set.
- One session can't opt out of one of its workspace's repos. Take the repo out of the workspace, or run the session outside it.

## 20. Easier to read: collapsible sections, repos where the workspace is, a real preview

2026-09-29. The owner asked for the UI to be as easy to use and understand as possible, with collapsible sections. A screenshot tour (1440×900 light, 1280×720 dark, phone) found space used badly: an empty preview, a number pad that is always open, the library always taking about 120 px, and the workspace's repo strip wrapping. It also found noise: an empty circle on every past session, a "·" badge, and a cramped `?`.

**Collapsible sections** (`web/folds.ts`, tested; remembered per browser in `localStorage`, and the page still works without it). `C` folds whatever you are in, and each section has a chevron to click:
- **Workspace column → a rail** of badges with their digit and a needs-you or working dot. Arrows and `1–9` still work on it.
- **Groups of sessions** (Needs you / Working / Done / Earlier): `C` folds the selected session's group, clicking a header folds that group, and `Shift+C` opens them all. `↑ ↓` skip folded groups, and the selection moves off a group as it folds (`visibleSessions` → `unfolded`).
- **Repo library → one line** ("10 repos from cc-demo, repos · Tab opens it"). It opens while you are in it (`Tab`) and folds again when you leave.
- **Number pad → a slim rail** in the session view, giving the conversation the width. It opens while you use it (`Tab` or `Esc` from the message box, or clicking the rail), and a chevron in its header folds it.

**Clearer home**
- **The selected workspace lists its repos** under its row in the workspace column: "Sessions here can use" with the home repo marked, × on hover, and `+ Add` / `Remove −`. Repo cards can be dropped there. The strip in the sessions column is now phone-only, where the workspace column is hidden.
- **The preview shows the recent conversation**: the last three exchanges (your message, then Claude's reply, with the newest shown in full). It has a primary **Open / Open and continue** button (`Enter`) next to Rename and End session, replacing a lone "Last from Claude" paragraph.
- Past sessions no longer carry an empty status circle. "Everything else" has a grid badge instead of "·". The library header names its folders instead of printing full paths (the paths are in the tooltip).
- `?` is wider (three columns on wide screens) with a narrower key column, so descriptions stop wrapping into slivers.
- Phones: one "New" button instead of two.

**Verified** (headless Chromium, isolated server, Demo workspace only): 11 checks. `C` folds the workspace column to a rail, and the arrows still pick workspaces. `C` folds the selected session's group and hides its rows, and `Shift+C` opens it. The library folds to one line and `Tab` opens it. All folds survive a reload. `C` on the pad folds it to a rail and `Tab` opens it. No console errors. Phone 390×844 and dark 1280×800 have no horizontal scroll. `pnpm typecheck`, `pnpm test` (79) and `pnpm build` pass.

**Owner-reported fixes (same day):** the repo library wouldn't fold with the mouse. Clicking its chevron first made the library the focused section, and a folded library opens while focused, so it reopened at once. Folding it (chevron or `C`) now also steps back out to the sessions. The folded workspace rail scrolled sideways because its digit keycaps sat outside the badges; they sit inside now and the rail clips sideways overflow. Both are checked in the walkthrough, including a real click on the chevron and a measured `scrollWidth`.

**Process note:** one failure screenshot in this run caught "Everything else" (the owner's real sessions) because `1` was pressed before workspaces loaded. It was deleted at once, and the scripts now wait for the Demo workspace before any key or screenshot, and never screenshot on failure.

## 21. Slash-command suggestions in the message box, and /clear that sticks

2026-09-29. The owner asked for suggestions while typing, like Claude Code: `/cl` should offer `/clear`.

**Where the list comes from:** the SDK's `supportedCommands()`, which the server already fetched for each live session (it feeds the number pad's Skills groups). A probe in `web-app` returned 67 entries: the built-ins (`/clear` with aliases reset/new, `/compact`, `/model <model>`, `/context`…) and every skill, each with a description, argument hint and aliases. The `board` message now carries `slash: SlashInfo[]`, without internal `_`-prefixed commands. A session that has never run in this app gets its folder's list, else the last one seen anywhere. When none is known at all, `SessionManager.slashFor` starts a CLI once, with no prompt so there is no model call, asks it for the list, closes it, and tells clients to refetch.

**Suggestions** (`web/slash.ts`, tested): typing `/` at the very start of a message opens a list above the message box. It matches names first, then aliases (`/res` → `/clear`), then fuzzily, up to 8, each with its aliases, description and argument hint. `↑ ↓` choose. `Tab` completes to `/name `. `Enter` runs the command when its arguments are all optional (`[name]`, `<optional …>`), and otherwise completes it so you can type them (`/model `). `Esc` hides the list until the text changes, without leaving the box or stopping Claude. A finished command shows a one-line hint with its arguments and description. It is in `?` and the README.

**`/clear` really starts fresh, and the app follows it.** A direct SDK check showed `/clear` clears the context (Claude then answered UNKNOWN to "what word did I ask you to remember?") but **moves the session to a new id**. Left alone, the app would keep the old id, so a restart or resume would bring the cleared context back. Now `handle()` watches `init` for a new `session_id` and `follow()`s it:
- The live session is re-keyed, its repos are copied, and sends to the old id go to the new one.
- Approvals follow, because `canUseTool` reads the live session's current id.
- Clients get `session.forked` plus a fresh transcript with a "Fresh start" note.
- The session is called "Fresh start" until your next message names it.
- The cleared conversation stays in the list under Earlier.

**Verified** (headless Chromium, isolated server, Demo workspace, Haiku):
- `/cl` → `/clear` first; `Tab` → "/clear "; `/res` finds it by alias.
- `Esc` hides the list and keeps the text; `/mod` + `Enter` → "/model ".
- `/contex` + `Enter` ran `/context` and printed its table.
- Told a new session "remember PINEAPPLE", then `/cl` `Enter`: a "Fresh start" note, Claude answered UNKNOWN, the transcript holds only the new conversation, the title became the next message, and the PINEAPPLE conversation is still listed.
- No console errors. `pnpm typecheck`, `pnpm test` (85) and `pnpm build` pass.

**Not done:** `@` file suggestions (Claude Code's other popup). They would need a server-side file listing like `fs.list`.

## 22. Claude Code parity: questions, modes and plans, to-do list, @ files, history, images

2026-09-29. The owner's goal: people using the app shouldn't miss anything Claude Code does natively, and should get it with better flow. A gap check against the code found these missing, two of them broken:

| Claude Code | Before | Now |
|---|---|---|
| Claude asks a multiple-choice question (AskUserQuestion) | **Broken:** a generic "Allow AskUserQuestion?" card; allowing it returned no answer | A **question card**: `1–4` pick (multi-select toggles), `O` your own answer, `↑ ↓` between questions, `Enter` sends, `N` skips. Answers go back as `updatedInput.answers` (question → labels, comma-joined), as the SDK expects |
| `Shift+Tab` modes: default / accept edits / plan | Fixed at default | `Shift+Tab` cycles *Asks first → Accepts edits → Plan first* (`Query.setPermissionMode`; never bypass). A pill under the message box shows the mode and the model, both mirrored from the CLI's `init` and `status` messages. Modes chosen for past sessions apply when they resume |
| Plan approval (ExitPlanMode) | **Broken:** a raw tool approval | A **plan card** showing the plan as markdown: `Y` start asking first, `A` start accepting edits, `N` keep planning (a deny that tells Claude to revise) |
| The to-do list while Claude works | "Updated the to-do list" only | A foldable **To-do** panel above the message box ("2 of 5 done", the current item as it runs; `L` folds it). `server/todos.ts` (tested) follows both `TodoWrite` and the newer `TaskCreate`/`TaskUpdate` tools, whose ids arrive in the tool result, for the main agent only. It is sent as `session.todos`, also on connect |
| `@` file mentions | None | Type `@` and files from the session's repos and its workspace's repos pop up (`server/file-search.ts`, tested: `git ls-files -co --exclude-standard`, or a capped walk, cached 20 s; names only). Own-repo files insert relative, the others by full path. **Verified with the SDK** that the CLI expands both into the prompt (Claude answered from the file with tools disabled) |
| `↑` for earlier prompts | None | `↑`/`↓` on the first/last line walk this session's messages, then ones sent elsewhere (`web/prompt-history.ts`, tested; per browser) |
| Paste / drop images | None | `Ctrl+V` or drop adds thumbnails (up to 5, 5 MB, PNG/JPEG/GIF/WebP; validated again on the server). They are sent as base64 image blocks; `Backspace` in an empty box takes the last one off |

**Also:** the legend and the live status line now speak to what is waiting ("Claude has a question for you" / "has a plan" instead of "Waiting for your OK to use AskUserQuestion"). The to-do and question tools read as plain steps. `PROTOCOL` is 3, so a server from before this shows the out-of-date banner.

**Bug found on the way:** after a turn ended, the status line could say "Thinking… ~129 tokens" indefinitely. The CLI streams its own chores between turns (naming the session), and activity treated them as Claude thinking. Stream events and thinking counts are now ignored between turns, and a turn the CLI starts by itself (after a background task) still counts, because "running" starts the turn clock. Tested.

**Verified** (headless Chromium, isolated server, Demo workspace, Haiku):
- **Question:** answered with `Tab` `2` `Enter`, and Claude replied "Blue".
- **Modes:** `Shift+Tab` → Accepts edits → Plan first. A plan card appeared, and `Y` started the plan with the mode back on Asks first.
- **Edit after the plan:** it went through without a card. That was correct: the owner's global settings allow Edit and Write, and the default mode honours them as the CLI does. The demo change was reverted.
- **To-do:** a 3-item list ticked to "3 of 3 done".
- **`@`:** `@READ` offered docs-site's README (web-app has none), and `Tab` inserted `@C:/…/docs-site/README.md`.
- **History:** `↑` recalled the last message and `↓` came back.
- **Image:** a pasted red square was sent, and Claude answered "Red".
- No console errors. `pnpm typecheck`, `pnpm test` (101) and `pnpm build` pass.

**Not yet:** rewinding files to an earlier message (Claude Code's `Esc Esc`; the SDK has `rewindFiles` with `enableFileCheckpointing`); `!` shell commands; a model picker beyond `/model`.

## 23. Arrow keys and Enter, like Claude Code's menus

2026-09-29. The owner: Claude Code lets you pick with the arrow keys, for `/model`'s list and whenever Claude needs a decision.

**Commands with choices** (`web/slash.ts` `hintChoices` / `argQuery`, tested): once a command is completed (`/model `, `/effort `), its choices fill the same suggestion list, filtered as you type, and `↑ ↓` `Enter` runs `/command choice`.
- `/model` lists the SDK's `supportedModels()`: Default, Opus 5.5, Fable 5.1, Haiku 4.5, Sonnet 5 and older ones, fetched once per server (from the first live session, or from the no-prompt probe) and sent with the board.
- Other commands take their choices from the argument hint when it lists fixed words (`<low|medium|high|xhigh|max|auto>`, `[on|off]`, colours). Placeholders like `<tokens>` are not offered.
- **Verified with the SDK:** `/model sonnet` sent as text switches the session ("Set model to Sonnet 5"), and the next reply came from `claude-sonnet-5`.

**Cards answer with the arrows** (`cardKeys` in `web/keys.ts`), when the keyboard is on the card (`Tab` from the message box):
- **Approvals and plans:** `← →` (or `↑ ↓`) walk Allow / Always / Don't allow (or a plan's three answers), and `Enter` confirms. The highlight starts on the card's main button, which is "Don't allow" for careful actions.
- **Questions:** `↑ ↓` walk the answers, with "type your own" as the last row. `Enter` picks: a single choice moves on to the next unanswered question, and sends after the last. On a multi-select, `Enter` turns a row on, and `Enter` on a row that is already on sends once everything is answered (`enterOnRow`, tested). `Space` toggles, and `← →` change question.
- `Y` `A` `N` and `1–4` still work. The highlighted choice shows the focus ring, and the legend and `?` say "← → Enter Choose". Enter no longer fires a number-pad workflow while a card is waiting.

**Verified** (headless Chromium, isolated server, Haiku):
- A question answered with `Tab` `↓` `Enter`: Claude replied "Blue".
- `/mod` `Enter` listed 11 models, the arrows reached Haiku 4.5, and `Enter` gave "Set model to …".
- `/effort` `Tab` offered low…auto.
- A Bash approval (`node -e`) went `Tab` → highlighted "Allow once" → `→ →` "Don't allow" → `Enter`. The card closed and the command did not run.
- `echo` does not ask at all, because the CLI treats it as read-only, as Claude Code does.
- No console errors. `pnpm test` (104) passes.

## 24. The session itself beside the list, instead of a preview

2026-09-29. The owner didn't get much from the preview column (the last three exchanges plus Open, Rename and End). They wanted selecting a session on home to show **the session itself**, usable right there, with a clear way to make it full screen and back.

**Design: reuse, not a copy.** The third home column now renders the real `SessionView` with a `docked` flag: the live transcript, approval, question and plan cards, the to-do list, the activity line, the "Claude can use" chips and the message box with `/`, `@`, choices, history and images. Nothing was reimplemented for it.
- **Focus model:** `openId` is set while `screen` stays `'list'` and `homeCol` is `'preview'`. One rule, `activeSession()` in `web/store.ts` (tested in `dock.test.ts`), replaced every `screen === 'session'` check: `cardKeys`, `sessionKeys`, the numpad and `Alt+1–9`, push-to-talk, the interrupt and background shortcuts, card highlighting, the approval auto-focus in `ws.ts` and "you've seen it" in `attention.ts`. So the docked session takes exactly the keys it takes full screen. Clicking another column (or a row) steps out.
- **Header:** the title, status, a full-screen button with its key, and a chevron that folds the pane. "End session" shows as a button from 1536 px up; below that, `X` still ends it from the list or the pad. Full screen gains a "Beside the list" button.
- **The number pad** is a rail beside the list. It opens while you use it (`Tab` from the message box when nothing is waiting), but a waiting card keeps the width, so `Tab` goes to the card with the pad still a rail.

**Keys** (legend, `?` and README updated; `legend.test.ts` covers them):
| Key | Where | Does |
|---|---|---|
| `↑ ↓` | sessions column | Choose; the pane follows once the selection settles for 200 ms (`useSettled`), then loads the transcript if it isn't loaded yet |
| `→` / `Enter` | sessions column, filter box | Step into the docked session: its message box, or its card when one is waiting |
| `Ctrl+Enter` | anywhere | New rebindable `expand` action: the session you're in (or the selected one) full screen, and from full screen back beside the list. The composer lets it through instead of sending |
| `Esc` | docked | Back to the list (from the message box too, because the pad is only a rail here). While Claude works, `Esc` stops it first, as everywhere |
| `Numpad 0` / `Alt+0` | docked | Back to the list, even while Claude works |
| `C` | docked, on the pad | Folds the pane to a rail and steps out, like the repo library. Folded, `→` / `Enter` still open it while you're in it; the rail's chevron unfolds it. Remembered with the other folds (`folds.dock`) |
| `Alt+↑ ↓`, `Alt+N` | docked | Move the docked pane to the previous / next session, or the next that needs you, without leaving home |
| Double-click | a row | Full screen, as before |

**Narrow screens:** under 1024 px the pane isn't shown (`shownCols`), and `Enter` opens full screen as it did. Phones still open a session with a tap.

**What went:** the preview's "Recent conversation" summary and its Y/A/N-from-the-preview-column keys. Answering from home now happens in the real card: `→` lands on it when one is waiting. The sessions column is 22 rem between 1024 and 1280 px so the pane has room, and takes the whole width when the pane is folded.

**Cost:** the transcript is still loaded once per selection (never on each arrow press), and a docked step-in doesn't re-read it when it is already loaded. `board.get` (the pad and the `/` list) is only asked for once you step in.

**Verified** (headless Chromium, isolated server on `:7788` with its own database and build, Demo workspace, Haiku), 24 checks:
- Selecting a fresh session shows its real transcript beside the list, with "Press → or Enter in the list to type here" in the message box and "Enter Go into it · Ctrl+Enter Full screen" in the legend.
- `↓ ↑` then `→` puts the focus in its message box. The legend switches to the session keys, with `Esc` "Back to the list" once Claude is idle ("Stop Claude" while it works).
- Sent "Reply with just the word PONG." from home and got PONG. `/cl` offered `/clear`, and `Esc` hid it and stayed in the box. `@READ` offered files.
- A Bash approval (`node -e`) appeared in the pane. `Tab` reached it, the legend showed the answers, `← ←` `Enter` allowed it, and Claude reported 42.
- `Ctrl+Enter` went full screen, and `Ctrl+Enter` again came back beside the list with the focus still in it. `Esc` returned to the list.
- `Enter` `Tab` `C` folded the pane to a rail and stepped out. The fold survived a reload, `Enter` still opened the pane, and `Esc` folded it again. The rail's chevron unfolded it.
- `?` describes it. At 900 px `Enter` opened full screen and `Numpad 0` came back. A 390 px phone has no sideways scroll, and a tap opens the session.
- No console errors. `pnpm typecheck`, `pnpm test` (107) and `pnpm build` pass.

**Found on the way:** the docked header first truncated the title to "Re…", and `Tab` onto a card opened the full 24 rem pad beside the list, squeezing the card. The header now shows the full-screen control as icon and key below 1536 px, and a waiting card keeps the pad a rail.

## 25. Faster lists, and suggestions that keep the command's name

2026-09-29, from the owner.
- **`Ctrl+↑ ↓` moves 5 rows at a time** in every vertical list: the sessions and workspace columns (and the filter box), the folder picker, the new-session and add-a-repo pickers, the remove-a-repo list, the folders dialog and `Ctrl+K`. One rule, `web/list-step.ts` (tested); `Cmd` works too. Ctrl+arrows still move a key on the session's number pad, where they always did. It is in `?` and the README.
- **`↑` through earlier messages no longer gets stuck on a slash command.** Recalling `/model sonnet` or `/effort high` opened that command's choices, which then took `↑ ↓`, so you couldn't go further back. Suggestions now stay hidden while you walk history, and come back once you edit the recalled text. Verified: `↑` walked past `/model sonnet` and `/effort high` to the oldest message with no list shown, `↓` came back, and deleting characters from `/effort high` brought its choices back.
- **The `/` suggestion list no longer cuts off command names** to fit descriptions. The name is kept whole (up to 70% of the row), and the description, aliases and argument hint give way. Hovering a description shows all of it.

**Verified** (headless Chromium, isolated server, Demo workspace, 1280×800): `Ctrl+↓` went from row 0 to 5, `↓` to 6, and `Ctrl+↑` back to 1. In the docked pane at its narrowest, no command name in the `/` list overflowed (measured `scrollWidth`). `Ctrl+↓` in `Ctrl+K` raised no errors, and there were no console errors. `pnpm typecheck`, `pnpm test` (109) and `pnpm build` pass.

## 26. Direction: sit on top of the terminal. Step 1, terminal sessions update live; Auto mode

2026-09-29. The owner wasn't reaching for the app over plain Claude Code terminals. Agreed roadmap, in order:
1. **Sit on top of terminals, not beside them.** Sessions started in a terminal show up live, and can be answered from the app.
2. **Visualise every step of development**, so non-developers can be dangerous and experienced developers fast: a card when a session finishes (what changed, in plain words, the diff, one-key Commit / Open PR / Ask for a fix), and a Changes view per session with undo per file or back to any message (SDK file checkpoints).
3. **Context you can move around:** `@session` pulls another session's findings into a prompt, one-key handoff to a fresh session when memory fills, and workspace notes every session starts with.
4. **A short first run for newcomers:** pick a workspace → say what you want → review the result card. Plan first by default for new users; the pad, library and modes appear when wanted.

Not planned: more Claude Code parity for its own sake (`!` shell, model pickers).

**What Claude Code allows** (checked against CLI 2.1.285, the SDK types and the docs):
- No supported way for another program to join a running terminal session. `claude --bg` / `claude attach` are terminal-only, Remote Control only connects claude.ai and the apps, and the cross-session socket is internal.
- The documented way in is a **channel** (research preview): an MCP server with the `claude/channel` capability pushes messages into a running session, and `claude/channel/permission` relays its permission prompts. A channel of our own needs the terminal to start with `--dangerously-load-development-channels server:<name>`, and Team/Enterprise orgs need `channelsEnabled`. The messages show as `← <name>: …` and reach Claude in a `<channel>` tag; slash commands arrive as text.
- The transcript file format is internal, so the app reads it only through the SDK (`getSessionMessages`).

**Step 1, done: terminal sessions update live** (`server/mirror.ts`, tested). The history watcher now reports which session's file changed. Each page's last-opened session is watched, and a session this app doesn't run is re-read through the SDK and pushed as `session.transcript`, at most once per 700 ms, only to the pages looking at it. Subagent files are ignored, and so are sessions the app runs itself (their updates already stream). The banner says "Open in a terminal: you're watching it live…". Replies arrive a message at a time, not word by word. No protocol change.

**Auto mode:** `Shift+Tab` now cycles *Asks first → Accepts edits → Plan first → Auto*, like Claude Code. Terminal sessions keep whatever mode they were started with. **Auto isn't offered for every model** (the CLI said "auto mode unavailable for this model" on Haiku), and a failed switch used to leave the mode where it was, so `Shift+Tab` retried Auto forever. Now it goes round to *Asks first* and says why, like Claude Code skipping it.

**Verified** (isolated server, Demo workspace):
- A session made with the plain `claude -p` in `web-app` showed beside the list with the live banner. Running `claude -p --resume <id>` made its reply appear on the page with no reload, within 10 ms of the CLI finishing.
- On Haiku: *Accepts edits → Plan first → Asks first*, with the message, and the next press went on to *Accepts edits*.
- After `/model sonnet`: *Plan first → Auto → Asks first*.
- No console errors. `pnpm typecheck`, `pnpm test` (113) and `pnpm build` pass.

**Next:** try a cc-control channel in a real terminal (sending from the page, relaying approvals, working out which session a channel belongs to), then the finish card.

## 27. Direction chosen: the Ticket Line

2026-09-29. To pick how the app should sit on top of terminal sessions, four future paths were mocked up in `docs/futures/` (open `index.html`): **1 Ticket Line** (a board of tickets moving through the loop), **2 Runbook** (one job as a guided checklist), **3 Flight Recorder** (a timeline of every step across terminals) and **4 Context Map** (a map of what each session knows). Each has a clickable, keyboard-driven mock, a day in the life, trade-offs and a build size. All four share one idea for smoke testing: a **run recipe** per repo, detected from `package.json` / `compose.yaml` and editable.

**The owner chose path 1, the Ticket Line.** `docs/futures/path-line.html` is the spec to build from. What it shows:
- **The board:** columns Inbox → Plan → Build → Needs you → Try it → Ship → Done. A card is a piece of work (a Jira or Trello ticket, or a card with no ticket) and moves through the columns. Each column's gate is one key: `a` approve the plan, `t` try it, `f` fix, `s` ship.
- **The new-card screen** (`n` on a ticket, dragging a ticket onto Plan, or `c` for a card with no ticket). It has three panels:
  - **Add context:** tickets, the repo library, files and links, saved notes, and findings from other cards.
  - **What Claude will know:** three layers with a size for each item. *Workspace* holds the repos, notes and run recipe. *Ticket* holds the description and each acceptance criterion; comments, attachments and linked tickets can be switched on. *This card* holds your extras and your own note. `p` previews the exact text.
  - **How it starts:** terminal tab or in the app, the home repo, the branch (new, current or a worktree), the mode, and the opening message, with the launch command shown.
- **How context reaches a terminal session:**
  1. The server saves the packet under the card.
  2. `claude` starts in a new Windows Terminal tab in the home repo, with `--add-dir` for each extra repo and `CC_CONTROL_CARD` set.
  3. A SessionStart hook fetches the packet and returns it as `additionalContext`.
  4. The hook also reports the session id, which links the card to the session.

  App-run sessions get the packet directly through the SDK.
- **Adding context later:** extras wait on the card. A UserPromptSubmit hook adds them to your next message in the terminal, or the channel (preview flag) delivers them at once.
- **The card drawer** has three tabs, Overview / Context / Transcript. Context shows the start-up log, what Claude was given, and what was added since.

**Rough build order:** context packet and Start work in a terminal, including the hooks bridge → board and drawer → new-card screen → Jira/Trello import → adding context later → run recipes (Try it) → Ship (commit, `gh pr create`, Slack post). The handoff for building it is `docs/prompts/continue-ticket-line.md`.

**Verified since** (§28): SessionStart and UserPromptSubmit both deliver `additionalContext`, and hooks inherit the `claude` process's environment, in a Windows Terminal tab too.

## 28. Ticket Line, milestone 1: a card starts a terminal session with its context

2026-09-29. The mechanism everything else on the line depends on, proved end to end. `Alt+L` opens the line; `c` opens the new-card screen; `Ctrl+Enter` saves the card, makes its branch and opens a Windows Terminal tab running `claude`; the tab's SessionStart hook fetches the card's context and links the session to the card.

**Claude Code facts, checked live on CLI 2.1.285 and against the hooks docs:**
- SessionStart and UserPromptSubmit both deliver `hookSpecificOutput.additionalContext` (Claude repeated a codeword sent each way). Over 10,000 characters, Claude Code saves it to a file and shows Claude a preview, so the new-card screen warns past that.
- Hooks inherit the `claude` process's environment, including in a `wt -w 0 nt` tab spawned by Node. Their stdin carries `session_id`, `transcript_path`, `cwd` and `source` (startup / resume / clear / compact). On Windows they run in Git Bash.
- **`--add-dir` takes every argument after it**, so it swallowed the opening message as a second folder. A `--` before the message fixes it.
- **`claude --settings <file>` loads hooks for one session.** So cards bring their own hook and `~/.claude/settings.json` is never touched: other sessions never run it and there is nothing to install. The owner chose this over a user-settings install. The one cost: resuming a card's session by hand with plain `claude --resume` doesn't bring the hook.
- **Windows Terminal re-quotes the command's arguments,** so the opening message goes through Windows quoting twice: `;` is escaped for wt, quotes are escaped, and backslashes before a quote or at the end are doubled (`wtArg`, tested; checked live with `;`, `&`, quotes and a trailing backslash).
- **A folder Claude Code hasn't been told to trust stops the tab at the trust prompt, before any hook runs.** After 45 s without word, the card turns amber and says to answer the prompt in the tab. Answering it lets the hook run and link as usual.
- **A server started from inside a Claude Code session passes that session's markers on** (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, its messaging socket…). A tab that inherits them runs as that session's child and never writes its own transcript. The tab's environment drops them (`tabEnv`, tested); settings people set themselves (`CLAUDE_CODE_USE_BEDROCK` and the like) stay.

**What was built:**
- `shared/cards.ts`: the card, its three-layer packet (workspace, ticket, this card) plus your note, `packetText` (exactly what the hook returns and what `p` previews), sizes, branch names, and the launch command, shared so the preview and the server always agree.
- `server/cards.ts`: checks the draft (real folders, known modes, never a mode the page didn't offer), makes the branch (new, current, or a worktree beside the repo), writes the hook settings file next to the database, and spawns `wt -w 0 nt --title CARD-n -d <repo> claude --settings … --permission-mode … --add-dir … -- "<message>"` with `CC_CONTROL_CARD`, a per-card token and the server URL in its environment. A failed branch or launch saves nothing, so the new-card screen shows the error and can be retried. Cards live in SQLite (`cards` table); the token is a separate column and never reaches the page.
- `hooks/cc-control-hook.mjs`: reads stdin and the card variables, posts to `127.0.0.1:<port>/hooks/SessionStart`, prints the answer. Without the variables, or when the server is down or slow (5 s), it exits with no output.
- `/hooks/:event` on the loopback listener only: it needs the card id and token in custom headers, which a web page can't send cross-site without a CORS preflight the server never answers, and the Host check still applies. Startup, `/clear` and compaction get the packet; a resume is only linked.
- **The board** (`web/components/TicketLine.tsx`): the seven columns from the mock with their gates, workspace chips on `1`–`9` / `0`, card tiles (key, terminal pill, the latest start-up step, repos), arrows between cards, `Enter` opens the drawer, `Delete` takes a card off the line (its tab, session and branch stay).
- **The drawer:** Overview (where it runs, folder, branch, session, context size), Context (how it started, with times, and what Claude was given by layer, with the exact text), Transcript (the linked session read through the SDK, live through `mirror.ts`). `Tab` switches.
- **The new-card screen** (`web/components/NewCard.tsx`): the mock's three panels. 1: the repo library with search (`/`), `Space` adds or takes out. 2: the layers with sizes, `Space` includes or leaves out, `x` removes what the card added, `e` your note, `p` the exact text. 3: where it runs (terminal; "in the app" shown as later), workspace, starts in, branch, mode, opening message, and what happens. `Ctrl+Enter` starts work, also while typing.
- Keys: `line-keys.ts` routes the line before the global shortcuts (its `Ctrl+Enter` starts work), with rows in `?` (Ticket Line, New card) and in the legend (`lineLegendFor`). `Alt+L` is rebindable. `PROTOCOL` 4 (`card.start`, `card.delete`, `cards`).

**Not in this milestone, as planned:** tickets (the Inbox says import comes next), stage tracking (a card stays in Plan or Build as started), the gates (`a` `t` `f` `s`), adding context later, notes / files / findings as sources, run recipes, Ship. The mock's filter (`/` on the board) comes with the board milestone.

**Verified** (isolated server, Demo workspace, Haiku):
- A card built only with keys (title, a library repo added with `/` and `Enter`, a note with `e`, `p`, Current branch, a typed message, `Ctrl+Enter`) opened a real tab; the hook fetched the packet and linked the session within a second; the Transcript tab showed Claude answering with the codeword that was only in the note.
- New branch in a fresh repo: the branch was made, the tab stopped at the trust prompt, and after 45 s the card said so in amber.
- The hook route refuses no headers, a wrong token and a foreign Host (403).
- No console errors. `pnpm typecheck`, `pnpm test` (135) and the Vite build (to `dist/web-test`) pass. `dist/web`, which the running app serves, was left alone.

**Next:** the board over the existing session list (cards follow their session's state: Needs you from pending approvals, Try it when a turn ends), then Jira/Trello import. The owner doesn't have Jira credentials to hand yet, so the import starts against mock tickets with the same shape, and a real Jira site plugs in later.

## 29. Ticket Line, milestone 2: cards follow their session

2026-09-29. A card now moves by itself as its terminal session works, through more of Claude Code's hooks. They go in the same `--settings` file as SessionStart, so still nothing is added to the user's settings.

**What the hooks send** (recorded live on CLI 2.1.285 in a real tab, every event logged):
- Every event carries `session_id`, `permission_mode` and `prompt_id`; subagents' events add `agent_id`.
- `PreToolUse` / `PostToolUse` carry `tool_name`, `tool_input`, `tool_use_id`; PostToolUse adds `tool_response`.
- **`PermissionRequest` fires the moment a prompt appears in the tab**, with the tool and its input. For a plan, `tool_input.plan` is the plan's markdown. The `Notification` with `notification_type: permission_prompt` comes about 7 s later, so it is only the fallback.
- `Stop` carries `last_assistant_message`. An idle session sends `Notification` `idle_prompt`.
- Hooks with `"async": true` run in the background. Every event but SessionStart is async, so following a card never slows Claude down.
- In plan mode Claude writes its plan to `~/.claude/plans/…` before ExitPlanMode. That is not a change to the card's repos.

**How a card moves** (`server/card-events.ts`, pure, 11 tests, the live sequences replayed):
- Your message → working, in Plan (plan mode) or Build. A message after Try it is round 2.
- A tool call → the live line says what it is doing ("editing CheckoutForm.tsx", "running: pnpm test"). TodoWrite and TaskCreate / TaskUpdate become the card's steps (`server/todos.ts`, reused).
- A prompt in the tab → needs you. A plan stays in Plan, amber, with the plan in the drawer; a tool or question goes to Needs you. When the tool runs, it was allowed, so the card goes back to work; an approved plan goes to Build.
- **A turn that ends on a question** ("Should it be X or Y?") needs you too. Claude often asks in plain text instead of a prompt. After changes, "Anything else?" doesn't count: the card goes to Try it.
- **The turn ends with files changed** in the card's own repos → Try it ("Done. Ready to try"). With nothing changed → "Replied: …".
- The session ends → the line says so. Ship and Done belong to you: hooks never move a card out of them.
- **Only the card's session moves it.** Once linked, only `/clear` in its tab relinks it. A `claude -p` that Claude runs inside the tab inherits the card's variables, and before this it would have taken the card over.

**What you see:**
- Tiles: the live line (a spinner while working, amber when it needs you, grey once ended), the steps' progress bar, files changed, time since it started, and the round. Amber tiles for needs you, and "N need you" beside "in flight".
- The drawer's Overview: what it is doing now (with the turn's time), or what it asks: the plan, rendered, or the question or the tool. It says to answer in its terminal tab, because answering from the board needs the channel (a preview flag). Then the steps, what changed (relative to the card's folder) and what Claude said last.
- A chime, and a browser notification when the page isn't in front, when a card starts needing you or is ready to try. Clicking the notification opens that card.

**Verified live** (isolated server, Haiku):
- A plan-mode card in a real tab went: session started → working → "writing the plan" → "presenting its plan" → **Plan ready**, with the plan in the drawer.
- A card whose session made an edit went Build → writing NOTES.md → **Try it**, with the file and both steps done. For this one, a `claude -p` run with the card's variables stood in for the tab, because a new folder stops at the trust prompt and a test can't answer it. Its reply ended in a question, and the change still won.
- A session that asked a clarifying question in text: found by this check and fixed (the question rule above).
- No console errors; `pnpm typecheck` and `pnpm test` (150) pass.

**Known gaps:**
- Closing a tab kills `claude` without a SessionEnd, so its card keeps its last line.
- Answering from the board, and `a` to approve a plan, need the channel (§26). For now the drawer says where to answer.
- Sessions without a card don't show on the board yet.

**Next:** Jira/Trello import against mock tickets (the owner has no Jira credentials to hand), then adding context later.

## 30. Ticket Line, milestone 3: the line is the home page

2026-09-29. The app opens on the Ticket Line, and Home (the three columns, the docked session and the repo library strip) is gone. What Home did that is still needed moved onto the line first.

**What moved where:**
- **Workspaces** are managed from the chips: `W` new, `E` edit, `Shift+Delete` delete, `Shift+E` share, `Shift+I` import. A bar under the chips shows the workspace's repos, with buttons for the same keys. With All showing, `+` `−` `E` `Shift+E` `Shift+Delete` ask which workspace (`pickWorkspace`, `1`–`9` or arrows); with one workspace they just use it. The filter (`1`–`9` / `0`) is remembered per browser, as Home's scope was.
- **Repo context:** `+` adds a repo from the library to the workspace shown, `−` removes one (the existing picker and remover dialogs). `F` picks the library's folders. The drag-and-drop library strip went with Home; `+` is how repos come in now.
- **The new-card screen:** `w` on a repo the card added keeps it for the whole workspace. It moves to the workspace layer and the server saves it, so later cards get it too. There is a button on the row as well.
- **Sessions without a card** sit in the mock's **Unticketed** row under the board (`line-model.ts` `unticketed`, tested): not linked to a card, in the workspace shown, needs-you first, then working, finished, and the last three days' others, at most 12 (the rest are counted; `Ctrl+K` or `/` finds them). `u` or `↓` from the bottom of a column goes there; `Enter` opens one full screen; `R` / `X` rename / end it.
- **Full screen from a card:** `Ctrl+Enter` (the rebindable expand key) on the focused card or in its drawer opens its session full screen, and the drawer has a Full screen button. `Esc`, `Numpad 0`, `Alt+0`, `Alt+L` or the expand key go back to the line as it was, drawer and focus kept. `Alt+↑ ↓` walk the sessions the line shows: the cards' in column order, then the row's.
- **`/` filters** the board and the row by words (key, title, branch; the row by title, folder, branch).

**Choosing the model (the owner asked for it mid-milestone):** the new-card screen names the model in its header, and **Model** under How it starts offers the default, Opus, Sonnet or Haiku (`← →` there, or `m` from anywhere on the screen). The default is named: the server's `CC_CONTROL_MODEL` if set, otherwise the `model` in `~/.claude/settings.json` (sent as `userModel` with `cards`), otherwise "Claude Code picks". A chosen model goes on the command as `--model <alias>` and wins over the server's pin; the server only accepts the three aliases. The card records the model it started with, and the drawer shows it. Optional fields only, so no `PROTOCOL` bump.

**Dropped with Home, as redundant:** the column keys (`← →` between columns, `Tab` to the library), folding (`C` / `Shift+C`, the workspace rail, session groups, the docked pane), the docked session itself (full screen replaces it), bare `N` (`Alt+Shift+N` still starts an app session), and "Everything else" as a scope (All now shows every session). `folds.ts` keeps only the number pad and the to-do list.

**Verified** (isolated server, Demo workspace, scripted with Playwright; 30 checks plus 12 on a real card):
- Opens on the line, no Home in the header; `1` shows Demo and its repos; the legend and `?` have the new keys and no Home section.
- `W`, `E` (edits Demo), `F` open their dialogs; `+` added `cdn-worker` to Demo from the library and `−` removed it; with All showing, `+` asked which workspace and `2` opened the picker for the second one; `Shift+Delete` deleted it.
- The Unticketed row listed Demo sessions; `u`, `Enter` opened one full screen, `Alt+0` came back with the row still focused, `↑` left it; `/` filtered it and `Esc` cleared.
- New card: `/ design-tokens`, then `w` on it moved it to the workspace layer, and Demo kept it.
- A real card (web-app, current branch): `m` three times picked Haiku, the command showed `--model haiku`; the tab linked, the drawer said Model Haiku, `Ctrl+Enter` opened its session full screen and again came back with the drawer open.
- A bug the checks found: the workspace dialog had a local `setFilter` shadowing the store's, so saving a workspace would have set the dialog's repo filter instead of showing the workspace. Renamed.
- No console errors. `pnpm typecheck`, `pnpm test` (149) and the Vite build to `dist/web-test` pass.

**Amended the same day: the Unticketed row is gone.** The owner didn't want it: not every session belongs on the line, so a row of the ones without a card is noise. Removed with its keys (`u`, `R` / `X` there, `↓` into it). Sessions without a card are found with `Ctrl+K`, as before; `Alt+↑ ↓` now walk the cards' sessions only, and `/` filters the cards.

**Next:** Jira/Trello import against mock tickets (the Inbox, `n` on a ticket, the ticket layer of the packet), then adding context later.

## 31. Ticket Line, milestone 4: tickets from Jira and Trello (against demo tickets)

2026-09-29. The Inbox fills with tickets, and a ticket becomes a card with its context. The owner has no Jira credentials yet, so it was built against a demo set in the real shape, with the Jira and Trello clients written and tested against the APIs' JSON but not yet against a live site.

**How tickets get in** (`server/tickets.ts`, read-only, nothing is ever written back):
- **Jira Cloud:** `CC_CONTROL_JIRA_SITE`, `CC_CONTROL_JIRA_EMAIL`, `CC_CONTROL_JIRA_TOKEN` (an API token), optional `CC_CONTROL_JIRA_JQL` (default: assigned to me, not done). It POSTs `/rest/api/3/search/jql` with basic auth. `fromJira` flattens the description from Atlassian Document Format and splits out the **acceptance criteria**: the list under a heading or bold line called "Acceptance criteria", "Done when" or "Definition of done" (Jira has no standard field; this is the common convention). It also maps comments, attachments, issue links (with their relation), status and done.
- **Trello:** `CC_CONTROL_TRELLO_KEY`, `CC_CONTROL_TRELLO_TOKEN`, `CC_CONTROL_TRELLO_BOARDS` (board ids). `fromTrello`: the key is the board's initials and the card number (Web board → `WB-12`); the acceptance criteria come from the checklist called "Acceptance criteria" / "Done when", else the first checklist; the status is the card's list, and it's done when that list is called Done or the card is archived.
- **Tokens stay on the server** (environment variables; the page only sees whether a source is connected, or why it failed). The server fetches on start and every 5 minutes while a source is connected; `R` in the Tickets dialog fetches again.
- **Demo tickets:** the mock's (SHOP-155, PAY-91, SHOP-160, PAY-77, DOCS-19, SHOP-98 done, and a Trello WB-12), switched on with `D` in the Tickets dialog. Off by default.
- **Project → workspace:** `Shift+T` opens Tickets: each source's state, the demo switch, and each project (Jira key / Trello board) with the workspace it goes to (`↑ ↓` project, `← →` workspace). Saved on the server. An unmapped project's tickets show under All only.

**On the line:**
- **The Inbox** shows open tickets that no card has started, in the workspace shown, newest first. Tiles carry the key (Jira blue, Trello violet), source, workspace, status and age.
- **`n` or `Enter` on a ticket** opens the new-card screen with it: its title, its workspace (from the mapping), "Plan SHOP-155." as the opening message, and a branch named after the key. The card is called after the ticket (the tab title too), and a ticket gets one card.
- **Panel 1 has Tickets and Repos** (`← →`). On Tickets, `/` searches by key or words. `Space` on the first ticket makes it the card's; later ones go in as **related tickets** (card layer), and `Space` again takes one out. `x` on the card's own ticket takes it off.
- **The ticket layer** follows the mock: the description and each acceptance criterion on; the comments (with the latest quoted) and linked tickets there but off; attachments on, by name. `p` shows it as Claude gets it, under `## The ticket (Jira SHOP-155)` with a "Done when" list.
- The card's drawer shows the ticket (a link to it when it's real) and its layer on the Context tab.
- `PROTOCOL` 5 (`tickets`, `tickets.demo`, `tickets.map`, `tickets.refresh`, and the draft's `ticketKey`; the server fills in the ticket itself).

**Found and fixed on the way (milestone 2's hooks):** when two helper agents ran in parallel and one stopped at a permission prompt, the other's next tool call reset the card to "working" while the prompt still waited. A helper's tool call no longer clears a waiting prompt (tested).

**Verified** (isolated server, Demo workspace, scripted with Playwright; 23 checks, and a real card):
- The Inbox started empty, saying how to get tickets; `Shift+T` said Jira and Trello were not connected; `D` brought in the demo tickets and their projects; `→` mapped Storefront to Demo.
- Demo's Inbox showed SHOP-155 and SHOP-160 only (not the done SHOP-98, not Payments'); All showed the unmapped ones, marked "no workspace".
- `n` on SHOP-155 opened the new-card screen with the ticket and every part of its layer; `←` switched to Tickets; `/ SHOP-160 Enter` added it as related; `p` showed the ticket section with "Done when" and "Also look at", and no comments (off).
- Started with Haiku on the current branch, tab titled SHOP-155: it linked, the Context tab said "from Jira SHOP-155 (a demo ticket)", SHOP-155 left the Inbox and its card went on the board. **Claude was only told "Plan SHOP-155." and started exploring the cart code**, so the ticket reached it through the hook.
- `c` opens on Tickets; `Space` made the first open ticket the card's (tickets already on the line sort after open ones, found by this check); `x` took it off. `?` has the new rows.
- No console errors. `pnpm typecheck`, `pnpm test` (159) and the Vite build pass.

**Not yet:** a live Jira site and Trello board (the owner sends the site, email and token when ready; the mapping and ADF parsing are the likely places to adjust); dragging a ticket onto Plan (mouse); `x` on a ticket to add it to a running card (that is "adding context later", next); the Files, Notes and Findings tabs.

**Next:** adding context later (a UserPromptSubmit hook sends queued extras with the next message), then run recipes (Try it), then Ship.

## 32. Ticket Line, milestone 5: adding context later

2026-09-30. Work already under way can be given more: a repo, a related ticket, or a note. It waits on the card and reaches Claude with the next message typed in the card's terminal tab, through a UserPromptSubmit hook in the same `--settings` file. Nothing new in the user's settings, and no preview flags.

**How it reaches Claude:**
- **UserPromptSubmit now runs synchronously** (the other tracking hooks stay async). When a message is typed in the card's tab, the server moves the card as before (`applyEvent`) and, if anything waits, answers with it as `hookSpecificOutput.additionalContext` and marks it sent. `laterText` in `shared/cards.ts` is exactly what is sent, and what `p` previews: `# Added to SHOP-155 by cc-control`, then the extra repos by path, related tickets, and your note under `## From you`.
- **Before the session links**, what waits goes in with the packet at SessionStart instead.
- **After `/clear` or compaction** the session has lost it, so SessionStart sends everything added since, with the packet, again.
- Only the card's own session takes it: a `claude -p` run inside the tab, or any other session, gets nothing (the same check as the other hooks).
- The hook settings file is also rewritten when the server starts, so a card resumed by hand gets the current hooks. Tabs started before this keep the old file's async UserPromptSubmit until they restart.
- A repo added later reaches Claude as its path (there is no `--add-dir` for a running session), so the session may ask once before working outside its folder. Its edits count toward the card's files (`cardRepos`), and the tile lists it.
- Answering "right now" would need the channel (a preview flag, §26). The Deliver panel shows that option as later, like "in the app" on the new-card screen.

**What you see (the mock's words and keys):**
- **`c` in a card's drawer** opens the new-card screen in its add form: "Add context to a running card · stage · terminal tab KEY". Panel 1 is the same Tickets and Repos; what the card already has says *has it*, its own ticket *this card's*, and adding them again is refused with a reason. Panel 2 is **What you are adding** (the items and your note, `e`) above **Already has** (dimmed: what it started with and what was added since). Panel 3 is **Deliver**: "With your next message", "Right now, through the channel (later)", and a Good to know. `p` shows the exact text, "sent by a UserPromptSubmit hook". `Ctrl+Enter` **Add to KEY**. The header meter reads "Adding 0.1k on top of 0.2k".
- **The Context tab's "Added since it started"**: each item with its time, size, and *goes with your next message* (amber) or *delivered* (green). Opening it after adding scrolls it into view. `x` takes back the last item still waiting.
- The tile says "N waiting for your next message"; the Overview's Context line counts what was added since; the drawer has an **Add context** button.
- Keys: `c` and `x` in the drawer, with rows in `?` and the legend (`Add context`, `Take back`). In the add form the legend says `Add to KEY` and drops `m` (the model was set when the card started) and `w`.
- `PROTOCOL` 6 (`card.addContext`, answered with `ok`; `card.withdraw`). The card gains `later` (items with `at` and, once delivered, `sent`).

**Verified** (isolated server, Demo workspace, Haiku):
- 17 scripted checks on the SHOP-155 card: `c` from the drawer opened the add form; its own ticket and the related SHOP-160 it already had were refused with reasons; web-app showed *has it*; PAY-91 (by `/` search), cdn-worker and a note went in; `p` showed the exact text; `Ctrl+Enter` left three items waiting on the Context tab and "3 waiting" on the tile; adding nothing says what to do; a fourth note and `x` took it back; `?` has both rows.
- **Delivered by the real hook:** the card's session resumed with its `--settings` file and variables (a `claude -p --resume` standing in for typing in the tab, which a script can't do) and asked, without tools, for the codeword, the related ticket and the extra repo. Haiku answered "PERIWINKLE-42", "PAY-91", "cdn-worker", none of which were in the message. All three turned *delivered* at the same moment, the session id unchanged, and the tile's "waiting" went away.
- Found and fixed by the checks: long rows in Added since widened the drawer's section past its edge (grid items needed `min-w-0`), and after adding, the section sat below the fold.
- Unit tests: adding skips what the card has, only a typed message takes what waits, it is sent once, `/clear` sends it again with the packet, waiting items can be taken back but sent ones can't; the add form's model and legend. No console errors. `pnpm typecheck`, `pnpm test` (162) and the Vite build pass.

**Not yet:** delivering at once through the channel; dragging a ticket onto a card (mouse); notes, files and findings as sources (the Files, Notes and Findings tabs); taking back anything but the last waiting item.

**Next:** run recipes (Try it), then Ship.

## 33. Ticket Line, milestone 6: run recipes (Try it)

2026-09-30. A card's change can be tried from the line: `t` starts the app of the repo the card works in, from the card's own folder (its worktree when it has one), and shows each step, where the app is and what a failing step said. `o` opens the app, `t` again stops it.

**Recipes** (`shared/recipes.ts`, `server/recipes.ts`):
- **Detected** per repo from its files: `docker compose up -d` for a compose file; for `package.json`, the package manager from `packageManager` or the lockfile (pnpm, yarn, bun, else npm), `install`, the setup scripts that exist (`db:migrate`, `migrate`, `db:seed`, `seed`), then the first of `dev`, `start`, `serve`, `preview`. Where the app will be comes from the script (`--port`, `-p`, `PORT=`, or the tool's default: Vite 5173, Next / Nuxt / Remix 3000, Astro 4321). Without a `package.json`, a plain node server (`server.js`, `app.js`… calling `.listen(3000)`) runs with `node`. Nothing to go on: no recipe, and the drawer says `e` writes one.
- **Written by you:** `e` in a card's drawer edits the recipe of the repo it starts in: one command per line, and optionally the address. Saved on the server per repo, so every card in that repo uses it. Emptying the commands goes back to the detected one.
- **In the context:** the workspace layer of a new card has the home repo's recipe ("Run recipe: pnpm install, pnpm dev", kind *run*, `Space` leaves it out), and Claude gets it under `## Running the app`, with a line saying cc-control runs it on Try it.
- The page gets recipes for the library's, the workspaces' and the cards' repos (`recipes`), sent on connect and when any of those change.

**Running** (`RunService`): the steps run one after another as child processes (a shell, the card's folder, `BROWSER=none` so dev servers don't open their own tab, colours off, Python unbuffered). A step that exits 0 is done; one that fails stops the run there, with its exit code and last lines. **A step that keeps running and serves is the app**: it printed a localhost URL (colour codes stripped, `0.0.0.0` read as localhost), or the recipe's port opened, or, for a step that looks like an app (`dev`, `start`, `serve`, the last step…), it stayed up 20 s without a word. An install is never taken for the app however long it takes, and a port already in use before the step started doesn't count. The app stays up and the next step starts (so tests can run against it). What the app printed wins over the recipe's address unless the port is the same. Stopping kills the whole process tree (`taskkill /T` on Windows). One run per card; `t` on a finished or failed run starts it again. Runs stop when the card is removed or the server shuts down.

**What you see:**
- The Overview's **Try it · web-app run recipe** section (the mock's words): where the recipe came from with `e` edit, each step with `$`, a spinner, `✓`, `● serving`, `✗ exit 2` or `–`, then "Running at http://localhost:5198" with `o` open, or the failure in red with "`t` runs it again", and the last lines of the step that failed, is running or is serving. After an edit, the new steps show instead of the last run's.
- The tile says "App at localhost:5198" (green), "Starting the app", or "Try it failed · exit 2" (red).
- The drawer has **Try it** (primary when the card is in Try it) / **Stop the app** and **Open the app** buttons.
- Keys: `t` (board and drawer), `o` (board and drawer), `e` (drawer), with rows in `?` and the legend (`Try it`, `Stop the app`, `Open the app`, `Run recipe`). `PROTOCOL` 7 (`card.try`, `card.stopRun`, `recipe.save`; `recipes`, `runs`).

**Verified** (isolated server, Demo workspace; 18 scripted checks, clean run):
- The SHOP-155 card (web-app, which has nothing to detect) said "No run recipe for web-app", and `t` said `e` writes one. `e`: a bad address was refused; `python -c "print('checking files')"` then `python -m http.server 5198 --bind 127.0.0.1` with `http://localhost:5198` saved as *written by you*.
- `t`: the first step ticked, the server showed *serving* and "Running at http://localhost:5198"; fetching it returned the page; the tile said "App at localhost:5198"; `o` opened it in a new tab; `t` stopped it and the port was free.
- A recipe whose first step exits 2: "Cannot find module express", `✗ exit 2`, the server step never ran, the tile said "Try it failed · exit 2".
- A new card in Demo had "Run recipe: python -m http.server 5198 --bind 127.0.0.1" in its workspace layer, and `p` showed it under "Running the app". `?` has `t`, `o`, `e`. No console errors.
- Detected for the demo payments-api: `node server.js` at localhost:3000, from server.js.
- Found by the checks and fixed: the Try it section kept showing the last run's steps after the recipe was edited; the app's printed 127.0.0.1 replaced the recipe's localhost.
- Unit tests (9): detection from package.json, lockfiles, compose and a node server; dev-script ports; URLs in coloured output; which steps can be the app; saved recipes win and emptying goes back; a real run whose app prints its URL, serves, and is stopped; a failing step. `pnpm typecheck`, `pnpm test` (171) and the Vite build pass.

**Known gaps:**
- **An app outlives a hard kill of the server.** Stopping the server with `Stop-Process` (as the restart below does) ends it without running its shutdown, so a running app keeps its port. Stop apps with `t` before restarting.
- `f` (feedback / fix from Try it) needs the channel to reach the session (§26); for now, type the fix in the card's tab. Recipes for repos other than the home repo, several apps at once, and a narrow browser window for `o` are not built. The run's output isn't kept after a server restart.

**Next:** Ship (`s`: commit, push, `gh pr create`; Slack later).

## 34. Ticket Line, milestone 7: Ship

2026-09-30. A card that works can leave the line as a pull request: `s` opens the mock's Ship sheet, `Enter` commits, pushes and opens the PR, and the card moves to Ship. `s` on a card in Ship merges it, and it moves to Done. Slack posts come later, as the owner asked.

**The sheet** (`web/components/ShipSheet.tsx`; the plan from `ShipService.plan`):
- **Commit** (`m` to edit): `feat: <title> (<KEY>)`, a conventional commit naming the card.
- **Branch:** the card's branch → the base (origin's default branch, else main / master). **A card on the default branch** (started with "Current branch") gets a new branch named after it first (`shop-160-cart-badge-shows-wrong`), and the sheet says so.
- **Files to commit:** `git status` of the card's repo. The files the card's session wrote are ticked; anything else (a lockfile Try it made, your own scratch files) is listed as "not from this card" and left out unless you tick it (`↑ ↓ Space`). Only ticked files are staged, **by name** (`git add -- <paths>`), never `git add -A`. Commits already on the branch count too, so a card whose Claude committed its own work can still ship.
- **Pull request, written from the ticket** (title and body editable, `b` for the body): `SHOP-160: <title>` (the card's title when it has no ticket), then the ticket's description, what Claude said it changed (the first paragraph of its last message), the acceptance criteria as an unticked **Done when** checklist for the reviewer, the files, "Tried locally: `npm install && npm run dev`" when Try it got the app up (or "Not tried locally yet"), and the ticket's link. `shared/ship.ts` builds it, so the sheet shows exactly what is sent.
- **Said up front:** no remote, no `gh`, a detached HEAD, or a branch name already taken stop it with a reason; files it changed in other repos, and files left out, are noted.

**Shipping** (`server/ship.ts`): in the card's folder, without a shell: `git switch -c` (when on the default branch) → `git add -- <ticked>` → `git commit -F -` → `git push -u origin <branch>` → `gh pr create --title … --body-file … --head <branch> --base <base>`. Each step lands on the card (`card.ship.steps`) as it happens, shown in the sheet and on the drawer's new **Ship** section; a failing step stops there with git's or gh's first line. The PR's number and link are saved, the card moves to **Ship**, and its tile shows "PR #41 · waiting for review".

**Following and merging:** every 3 minutes (and when the merge sheet opens) `gh pr view --json state,reviewDecision,statusCheckRollup` updates the card: "PR #41 · approved · checks passing" (or changes asked for, checks failing / running). A PR merged elsewhere moves the card to Done. `s` on a card with an open PR opens **Merge PR #41**; `Enter` runs `gh pr merge --squash`, deletes the branch on the remote, and moves the card to Done. **The local checkout is left as it is** (no `--delete-branch`, which would also switch the card's folder, possibly under a running session). `o` in the merge sheet opens the PR.

Keys: `s` on the board and in the drawer (Ship, or Merge once there is a PR), with rows in `?` and the legend; the drawer has a **Ship** / **Merge #41** button. In the sheet: `Enter` (or `Ctrl+Enter` while typing), `↑ ↓ Space`, `m`, `b`, `Esc` (leave the field, then cancel). `PROTOCOL` 8 (`card.shipPlan` → `ship.plan`, `card.ship`, `card.prRefresh`, `card.merge`). `CC_CONTROL_GH` points at another `gh` (a `.js` / `.mjs` runs with node), for tests.

**Verified** (isolated server; a new demo repo `shop-site` with a local bare repo as `origin`; a stand-in `gh` that logs its arguments; 23 scripted checks, clean run):
- A seeded SHOP-160 card on `main` in Try it: `t` detected `npm install`, `npm run dev` from package.json and brought the app up at localhost:5197.
- `s`: branch `shop-160-cart-badge-shows-wrong → main`, made from main first; files `cart.js` (this card, ticked), `package-lock.json` (made by Try it's `npm install`) and `scratch.txt` (not from this card); the commit message, PR title and a body with the description, what Claude said, Done when, the file, "Tried locally: `npm install && npm run dev`" and the demo ticket. `↓ Space` ticked a file and `Space` unticked it.
- `Enter`: git really made the branch, **committed only cart.js**, left `scratch.txt` alone, and pushed to the bare origin; `gh pr create` got the title, `--head` and `--base main`; the drawer listed the four steps with the commit's hash; the card went to Ship with "PR #41 · waiting for review".
- `s` again: the merge sheet asked gh (approved, checks passing); `Enter` merged, the branch was gone from the remote, the local checkout was still on it, and the tile said "PR #41 · merged". `t` then stopped the app. `?` has `s`. No console errors.
- Found by the checks and fixed: the steps selector returned a new empty list on every render (React's "maximum update depth", the sheet never opened); the sheet turned into the merge sheet the moment the PR existed and asked GitHub again.
- Unit tests (4, against real git with a bare remote and the stub gh): the words, `git status -z` with renames, paths relative to the repo, checks summed up, shipping only ticked files off main then refresh and merge, and what stops it (no remote, nothing ticked). `pnpm typecheck`, `pnpm test` (175) and the Vite build pass.

**Not verified:** a real `gh pr create` on GitHub. That publishes a PR, so it waits for the owner to say which repo to try it on.

**Not yet:** posting to Slack; moving the ticket to Done in Jira or Trello (the import is read-only); shipping from more than one repo per card; `f` (feedback / fix, needs the channel).

## 35. Direction: every team's processes differ, so each step stays swappable

2026-09-30, from the owner after milestone 7. Ticketing, starting a dev environment and opening PRs all vary by team, and will keep changing: some repos are on GitHub, some on Azure DevOps (TFS); a workspace can span several repos with different setups. **Example (Veterans United Home Loans):** backend dev environments are spun up with **Okteto**, and the UI has to be pointed at them through a proxy config change. cc-control can't handle every setup for people, but it should know the shapes these take and leave room to add new ones later without rewrites.

**Where the code stands** (honest inventory, so later work knows what to loosen):

| Step | Today | Hard-wired to | The seam to grow |
|---|---|---|---|
| Tickets | `server/tickets.ts`: Jira, Trello, demo; each a fetch that returns the shared `Ticket` shape; project → workspace mapping | the `TicketSource` union (`'jira' \| 'trello'`) and one fetch per source inside `TicketService` | A source interface (`id`, `name`, `configured()`, `fetch()`), so Azure DevOps Boards, GitHub Issues or Linear are one file each. The `Ticket` shape (key, description, acceptance, comments, links) already fits them. |
| Dev environment (Try it) | `server/recipes.ts`: one recipe **per repo**, detected or written; steps run in the card's folder | one repo per run; every step runs in the same folder with the same environment | **Workspace recipes**: steps that name their repo (`cwd`), set environment variables, and say whether they are long-running. Okteto fits as a step (`okteto up` in the backend repo, long-running, its endpoint read from its output) followed by a UI step with the proxy target passed in (an env var such as `VITE_API_PROXY`, or a config file the step writes), then the UI's dev server. A teardown step (`okteto down`) runs on stop. Keep recipes in the workspace file so a team shares one. |
| Code host (Ship) | `server/ship.ts`: git for branch / commit / push (host-neutral); `gh` for create, view, merge | `gh` and GitHub's PR JSON | A host interface (`createPr`, `viewPr`, `merge`), picked from the remote URL: `github.com` → gh; `dev.azure.com` / `*.visualstudio.com` / an on-prem TFS URL → `az repos pr create` / `show` / `update --auto-complete`, or the REST API with a PAT kept on the server like the Jira token. The sheet's words (`shared/ship.ts`) don't change: Azure DevOps PRs take the same title and markdown body, and link work items with `#123` / `AB#123`. |
| Builds, pipelines, releases (wanted, not started) | Nothing: the owner asked (2026-09-30) to manage them from cc-control instead of going into TFS | — | Methods on the same host interface: `builds(branch / PR)`, `queue(pipeline, branch)`, `logs(run)`, `releases(…)` / `deploy(stage)`. Azure DevOps: `_apis/build/builds`, `_apis/pipelines/{id}/runs`, and the Release API on the `vsrm.` host (on-prem, the collection URL). Token scopes: Build *Read & execute*, Release *Read, write, execute & manage*. GitHub: `gh run list / view / rerun`, `gh workflow run`. On the line: the PR's build on the card and in the Ship section, a key to queue or re-run, and after merge the card could follow the change through release stages instead of stopping at Done. |
| Hooks and context | Claude Code hooks via `--settings`; the packet's three layers | Claude Code (by design) | Already open: workspace notes and per-card extras carry anything team-specific ("the UI proxies to your Okteto namespace; run okteto up first"). |

**Rules for new work:**
- A new ticket tracker, environment tool or code host should be **one module behind an interface**, chosen by configuration or detected (remote URL, files in the repo), never an `if` threaded through the UI.
- **Configuration lives with the workspace** (and its shareable file), since that's where one team's way of working sits; per-repo detection stays the fallback.
- When a setup can't be automated, **say what to do instead of guessing**: a recipe step can be a note ("Point the UI at your Okteto URL in proxy.config.js"), and Ship can stop after the push with "open the PR in Azure DevOps".
- Tokens stay on the server, as for Jira and Trello.

**Not started.** This records the direction. The first concrete pieces will likely be workspace recipes (several repos, env and long-running steps, which the Okteto case needs) and an Azure DevOps host for Ship, once there is a real repo to try them on.

## 36. Ready for VU: settings file, company certificates, pnpm doctor, Jira Data Center, Azure DevOps Server

2026-09-30. The owner will take cc-control to Veterans United and wants as much done on this laptop first. Their answers: tickets are in **Jira**; non-GitHub repos are on **Azure DevOps Server / TFS on-prem** (`https://tfs.p.vu.local/tfs/DefaultCollection/ss/_git/Workspaces-UI`); auth by **personal access token**; the machine is **Windows with Windows Terminal**. The first pieces of §35's seams, built for that.

**Settings and certificates** (`server/config.ts`, applied first by `server/boot.ts`):
- `%USERPROFILE%\.cc-control\config.env` (or `CC_CONTROL_CONFIG`) holds `CC_CONTROL_*` settings and tokens, one `NAME=value` per line, read with `util.parseEnv`. The environment wins, so one-off overrides still work. `docs/config.env.example` lists every setting.
- **Company certificates:** Node only trusts its own roots, so a server with an internal CA (`tfs.p.vu.local` very likely) fails with "unable to get local issuer certificate". The certificates Windows trusts are added to Node's defaults at start (`tls.getCACertificates('system')` + `setDefaultCACertificates`; checked: a self-signed server `fetch` rejected is accepted once its CA is added). `CC_CONTROL_CA_FILE` adds a PEM; `CC_CONTROL_SYSTEM_CA=0` turns the Windows ones off.

**`pnpm doctor`** (`scripts/doctor.ts`): Node, Claude Code, Windows Terminal (through `where.exe`, which sees the `wt.exe` app alias Node can't stat), git, the built page; the settings file and certificates; **signs in to Jira** (`/myself`); and for every repo in every workspace, its PR host: `gh` installed and `gh auth status` for GitHub, **a real request to the repo** for Azure DevOps (saying which API version answered); plus each repo's run recipe. A line per check with what to do, exit 1 when something needed is missing, never a token. On this laptop it found that `gh` isn't signed in (so Ship to a GitHub repo would stop until `gh auth login`).

**Jira Data Center / Server** (`server/tickets.ts`): any site that isn't `*.atlassian.net` (or `CC_CONTROL_JIRA_KIND=server`) uses `POST /rest/api/2/search` with the personal access token as `Bearer` (or `CC_CONTROL_JIRA_EMAIL` as a username with a password), and keeps a context path (`https://jira.company.local/jira`). Descriptions are wiki markup: `h3. Acceptance Criteria`, `*Acceptance criteria:*` and `#` / `*` / `**` lists are read. `CC_CONTROL_JIRA_AC_FIELD` names a custom field holding the criteria, which wins over the description. Failures say what they mean (401: the token; 404: the address or context path; certificate errors: `CC_CONTROL_CA_FILE`).

**Pull-request hosts** (`server/hosts.ts`, the `CodeHost` interface): branch, commit and push stay plain git; creating, following and merging the PR go to the host the `origin` URL names.
- **GitHub:** `gh`, as before (§34).
- **Azure DevOps** (any URL with `/_git/`: dev.azure.com, `*.visualstudio.com`, on-prem `https://host/tfs/Collection/Project/_git/Repo`, Azure DevOps Server without `/tfs`, the short `…/Collection/_git/Repo`, SSH `v3/` remotes; on-prem SSH needs `CC_CONTROL_ADO_URL`): the REST API with `CC_CONTROL_ADO_TOKEN` (basic auth, empty user). **The API version is found on the first request**, newest first (7.0, 6.0, 5.0, 4.1, stepping down on `VssVersionOutOfRangeException`), and remembered per collection; `CC_CONTROL_ADO_API_VERSION` pins one. Create (`sourceRefName`, `targetRefName`, title, the description cut to Azure DevOps' 4000 characters), view (status → open / merged / abandoned; reviewer votes → approved / changes asked for; branch-policy evaluations → checks), merge (`status: completed` with the last merge commit, `mergeStrategy: squash` and the older `squashMerge`, `deleteSourceBranch`). The PR links to its web page (`…/_git/Repo/pullrequest/314`).
- **Any other host:** Ship still makes the branch, commits and pushes, moves the card to Ship, and says to open the PR in the browser (§35: say what to do rather than guess). The sheet notes it up front.
- The base branch is the remote's default (`origin/HEAD`), else `main`, `master` or `develop`.

**Verified:**
- **A stand-in VU** (`fake-vu.mjs`: Jira Data Center under `/jira` with a PAT, and a TFS 2019 under `/tfs` that answers API 5.0 only), with a settings file pointing at it and a `Workspaces-UI` repo whose `origin` is the stand-in TFS (pushes going to a local bare repo). 14 scripted checks: `Shift+T` said Jira was connected with 2 tickets; the unstarted one was in the Inbox; `n` on it and `p` showed "Done when" read from `*Acceptance criteria:*` wiki markup; on the seeded WSUI-481 card, `s` offered `wsui-481-point-workspaces-ui-okteto → develop` with `proxy.conf.json` ticked; `Enter` committed and pushed, asked the API for 7.0, then 6.0, then 5.0, opened PR #500 from the new branch into `develop` titled from the ticket, and linked it to its TFS page; `s` showed it approved with policies passing, and `Enter` completed it with squash and branch deletion. `pnpm doctor` against the same stand-in: settings file read, Jira Data Center signed in, `Workspaces-UI: Azure DevOps, reached ss/Workspaces-UI (API 5.0)`.
- **Found and fixed by that walkthrough:** the command runner trimmed `git status` output, so a changed tracked file listed first (` M proxy.conf.json`) lost its first letter and wasn't recognised as the card's (every earlier test had only new files, `??`). `git status` is now read untrimmed, with a test. Branch names also drop "at", "by", "from", "into" and "is".
- Unit tests: the settings file and its precedence; Jira kind, request and auth for Cloud and Data Center, wiki markup, the criteria field, a real request to a Data Center-shaped server and what a 401 means; Azure DevOps remote URLs (the VU one among them), votes and policies, and a full ship → refresh → merge through a stand-in TFS that only speaks 5.0; the push-only path for an unknown host. `pnpm typecheck`, `pnpm test` (186) and the Vite build pass.

**Amended the same day, from the first try on the VU laptop:**
- **The check is `pnpm run doctor`.** pnpm 11 has a built-in `pnpm doctor` (it checks pnpm itself), and a built-in wins over a script of the same name. The docs said `pnpm doctor` and ran pnpm's own check; they now say `pnpm run doctor`.
- **The VU laptop had Node 22.** `engines` in package.json doesn't stop `pnpm install`, and the server would then fail while loading, with an error that doesn't mention Node. `scripts/check-node.mjs` now runs before `start`, `dev` and `doctor` and says to install Node 24. The certificate code checks that Node's certificate functions exist, instead of importing them by name, which fails before any code runs.
- `pnpm install` there fetched pnpm 11.1.1 itself (the `packageManager` pin) from VU's npm feed on TFS and failed with "fetch failed". Setting `NODE_OPTIONS=--use-system-ca` together with `--config.manage-package-manager-versions=false` got it going. It isn't known yet which of the two did it, so the pin is unchanged. VU's own Jira turned out to be **Jira Cloud** (`vuconfluence.atlassian.net`), which cc-control supports too: email plus API token.

**Not verified:** a real Jira Data Center, a real TFS, and whether `tfs.p.vu.local`'s certificate chains to a root Windows trusts there. At VU: fill in `config.env`, run `pnpm doctor`, and it says which of these works.

**Next:** workspace run recipes (steps across repos, their own environment variables, long-running steps and a teardown, notes for what can't be automated), which the Okteto + UI proxy setup needs.

## 37. Workspace run recipes: several repos, their own variables, teardown, steps by hand

2026-09-30. The Okteto case (§35): a backend dev environment spun up from one repo, the UI started from another and pointed at it, and torn down afterwards. A workspace can now have **its own run recipe**, which every card in it runs instead of its repo's.

**One step per line** (`shared/recipes.ts` `parseStep`; the editor stays a text box):
- `@Workspaces-API okteto deploy --wait`: `@repo` runs the step in that repo, by folder name, from the card's repos and its workspace's. The card's own repo is its folder (its worktree when it has one). A name that matches nothing fails the step and lists the names it knows.
- `@Workspaces-UI API_URL=https://api-you.okteto.example npm run dev`: `NAME=value` before the command sets that variable for that step only. It is parsed by cc-control, so it works in cmd.exe, which has no `NAME=value cmd` of its own. Quotes allow spaces.
- `! Check the namespace is green in the dashboard`: something to do by hand. It is shown as a step (☐ BY HAND) and never run: for what can't be automated, the recipe says what to do (§35).
- `stop: @Workspaces-API okteto destroy`: runs when the app is stopped (`t`), after its processes are killed, one after another with two minutes each. It also runs before a restart. A server shutdown kills without them (there is no time to wait).
- `# …` is a comment.
- Repo recipes use the same syntax, so a plain `pnpm install` / `pnpm dev` recipe is unchanged.

**What you see:**
- `e` on a card opens the editor on what the card runs (the workspace's recipe if there is one). **`Alt+W`** switches between *This repo* and *The whole workspace*. Untouched text follows the switch; edited text stays, so a repo's recipe can be saved as the workspace's.
- The help line under the box gives the syntax. Emptying a workspace recipe removes it, and cards go back to their repo's.
- The Try it section (*Try it · Demo workspace run recipe*) shows each step with its repo, the **names** of the variables it sets (never the values: they can hold tokens), ☐ BY HAND steps, and a *When stopped* group.
- New cards in the workspace get the recipe in their context, step by step, variable names only: "in Workspaces-API: (with NAMESPACE set) node deploy.js", "By hand: …", "When stopping: …".
- **Shared with the workspace file** (`Shift+E` / `Shift+I`). An imported recipe is text; nothing runs until someone presses `t`. It is marked "from the workspace file you imported: check it before running", with an amber note in Try it, because its commands are someone else's. Import keeps strings only, at most 20 steps of 500 characters, and only http(s) addresses.
- `PROTOCOL` stays 8: `recipes` gains `workspaceRecipes` and `recipe.save` gains `workspaceId`, both optional.

**Verified** (isolated server, Demo workspace, a stand-in `Workspaces-API` repo whose `deploy.js` / `destroy.js` play `okteto deploy` / `destroy`; 11 scripted checks):
- `e` opened on the repo's detected recipe; `Alt+W` switched to the workspace ("Every Demo card runs this instead of its repo's").
- Saving `@Workspaces-API NAMESPACE=rs-dev node deploy.js`, a `!` step, `@Workspaces-UI OKTETO_URL=https://api-rs-dev.okteto.vu.local npm run dev` and `stop: @Workspaces-API node destroy.js` showed the steps with repos, variable names only, the BY HAND step and When stopped.
- `t`: deploy ran **in the API repo with its own variable**; the UI came up at localhost:5196 **serving the Okteto URL it was given**. `t` stopped it, the stop step ran in the API repo, and the port was free.
- A new Demo card's `p` had the recipe under "Running the app", step by step. No console errors.
- Unit tests: the step syntax (and that `--port=5000` in a command isn't a variable); what Claude is told; a card runs its workspace's recipe first; saving, removing and importing workspace recipes; a real two-repo run (a variable per step, a note skipped, the stop step run on stop); a repo name that matches nothing; the workspace file's recipe, bounded on import. `pnpm typecheck`, `pnpm test` (191) and the Vite build pass.

**Not yet:** passing a value one step printed (the Okteto endpoint, say) into a later step's variable (for now, write the address in the recipe; per-developer namespaces are usually stable); a recipe per developer on top of the shared one; waiting on a by-hand step before going on.

## 38. Hide tickets from the Inbox

2026-09-30, asked for while trying it at VU: the Inbox should be able to drop tickets you don't want there.

- **`Delete` on a ticket in the Inbox hides it.** It is gone from the Inbox, and focus moves to the next ticket. The message says "Shift+T shows hidden tickets again". Nothing is written to Jira or Trello: the import stays read-only.
- **`Shift+T` has a *Hidden from the Inbox* list** under the project mapping. `↑ ↓` walk the projects and then the hidden tickets, and `Enter` (or the button) shows one in the Inbox again. With none hidden, the list says so, and points to `CC_CONTROL_JIRA_JQL` for leaving out whole groups.
- **The hidden list is kept on the server** (`tickets.hidden`, with when each was hidden), so it survives restarts and other browsers. A hidden ticket can still be picked on the new-card screen, sorted after the open ones and marked "hidden from the Inbox".
- Keys: the legend on a focused ticket shows `Delete` *Hide*, and `?` has a row. `PROTOCOL` 9 (`tickets.hide`).
- **Found by the walkthrough:** the dialog's list filtered inside the store selector, which returns a new array each time, so React re-rendered forever (the same bug as §34's). It now filters outside the selector.
- **Verified** (isolated server, demo tickets; 9 scripted checks):
  - `Delete` on PAY-91 hid it, said how to bring it back, and moved the focus to PAY-77.
  - `Shift+T` listed it, and `Enter` showed it again; it was back in the Inbox.
  - It stayed hidden across a reload, and the legend shows *Hide*. No console errors.
  - Unit tests cover hiding surviving a new service on the same store, and the Inbox leaving out only that ticket. `pnpm test` (192) passes.

## 39. Home from anywhere: the logo, and Alt+L

2026-09-30, from the owner: people will click the top-left logo to get back to the home page, and the keyboard needs an obvious way too.

- **The logo** ("Command Center", now with an icon, a hover state and its keycap) goes to the board from anywhere. It leaves a session opened full screen, and closes the card that's open, the new-card screen (whose draft is dropped, as `Esc` drops it) and any dialog. The workspace shown and the focused card stay as they were (`goHome` in `line-keys.ts`).
- **`Alt+L`** (rebindable, the existing *ticketLine* action) now does the same everywhere. Before, it only worked from a session, and it returned to an open drawer. It works while typing, and **through dialogs**: dialogs normally keep every key to themselves, but the home key gets past them. The one exception is the key-rebinding dialog, where `Alt+L` may be the key being assigned.
- `Esc`, `Numpad 0`, `Alt+0` and the expand key still step back to the line as it was, drawer kept. That keeps the round trip from a card to its session and back. Home is for "take me to the board".
- The keycap shows next to the logo; `?` says "Home: the Ticket Line board, from anywhere (or click the logo)".
- **Verified** (isolated server; 10 scripted checks): the logo from an open card; `Alt+L` from the new-card screen while typing in its title, from the `Shift+T` dialog, and from a session opened full screen with `Ctrl+Enter`; the logo from a session; the `?` row. No console errors. `pnpm test` (192) passes.

## 40. QA and code review cards, the Inbox's Ready for QA, Jira search, any folder as context

2026-09-30, from the owner: not every ticket is development. Some are someone else's change to QA (at VU, often with a loan set up in a given state), and some are a pull request to review for a teammate. Those tickets aren't assigned to you, so they need finding. Also asked mid-way: any folder as context, not only tickets and library repos.

**The owner's answers:**
- **Statuses:** VU's Jira statuses are To Do, Blocked, In Progress, Ready for PO, Ready for QA and Done. So *Ready for QA* is an Inbox view, and reviews are found by search (there is no board column for them).
- **Review findings** stay local until the owner chooses to post them. PRs may be on TFS or GitHub.
- **Test data** comes from VU's own tools:
  - a scenario generator installed from a repo and run locally (Claude already makes scenarios with it, given the context)
  - hosted tools for viewing loan fields and checking field setup across environments

  Those tools come later (see the end). For now the team writes how to use them in the workspace's testing notes.

**A card has a kind** (`shared/cards.ts` `CardKind`): *Develop* (as before), *QA* or *Code review*.
- `k` on the new-card screen cycles it, and a *Kind of work* row heads panel 3.
- It follows the ticket until you choose (`kindForTicket`): a ticket that came in through Ready for QA, or has a QA or testing status, makes a QA card; a review status makes a review.

The kind sets three things:
- **What Claude is told** (`jobText`, a *Your job* section of the packet).
  - QA:
    - write a test plan from the ticket: a check for each "Done when" item, plus the edge cases
    - set up the test data the way *How this team tests* says, and say what was created
    - walk the user through each check and record pass or fail
    - don't change the code under test
    - end with a report under `# QA report: KEY`, with `Result: Passed/Failed/Blocked`
  - Review:
    - read, don't change, and post nothing
    - compare the change with the ticket; look for bugs, edge cases, security and missing tests
    - end with `# Code review: KEY`, a `Verdict:` line, and findings as `path:line` with how serious each is
- **How it starts:**
  - Both kinds start in plan mode. QA plans its checks first. For a review, plan mode keeps the session read-only, and Claude is told to reply with findings instead of presenting a plan.
  - QA stays on the current branch. A review starts on the **PR's branch, in a copy**.
- **How it ends:**
  - When a Stop hook's message has the report heading, the report goes on the card (`card.report`, with its result) and the card moves to **Ship**. The development rule "files changed → Try it" doesn't apply.
  - The tile says "Report: Failed" or "Findings: Changes requested", and the drawer shows the report rendered.
  - `s` opens the report sheet: `Enter` copies it, `o` opens the PR, `d` moves the card to **Done** (`card.done`).
  - Nothing is posted to Jira or the PR host.

**The ticket's pull request** (`findPr` on the `CodeHost` interface in `server/hosts.ts`, and `findPrIn` over the card's repos). Read-only.
- **Hosts:** GitHub through `gh pr list --search KEY`; Azure DevOps through `GET …/pullrequests?searchCriteria.status=active`.
- **Matching:** the newest open PR whose title or branch names the key. The key must match whole: WSS-12 doesn't match WSS-123.
- **When it asks:** the new-card screen asks once per ticket, for QA and review cards. When nothing is found, it says why for each repo: no remote, no token, or no PR.
- **When a PR is found:**
  - The Branch row offers *PR #57's branch, in a copy*, and a review picks it.
  - Starting runs `git fetch origin <branch> <target>`, then `git worktree add --detach <repo>-<key> origin/<branch>` in the PR's repo, so your own checkout is untouched.
  - Claude is told which diff to read (`git diff origin/<target>...HEAD`).
- **When none is found:** Claude is told to look for the branch itself.

**The Inbox's views** (`v`, remembered per browser):
- *Mine*: `CC_CONTROL_JIRA_JQL`, as before.
- *Ready for QA*: `status = "Ready for QA"` in the projects your own tickets come from, plus any project mapped to a workspace, so it needs no setting. `CC_CONTROL_JIRA_QA_JQL` replaces the query, and `off` turns the view off.
- Both views come in one refresh, merged by key, and each ticket records the views it came through (`Ticket.views`). A failing QA query never loses your own tickets.
- Tiles in the QA view show who the ticket is assigned to (`Ticket.assignee`, now fetched).

**Search anyone's ticket** (`tickets.search`, `TicketService.search`):
- On the new-card screen's Tickets tab, `/` also asks Jira after a short pause:
  - a key searches `key = "WSS-12"`
  - words search `text ~ "…"` over tickets that aren't done, with quotes and backslashes stripped
- Results come after your own tickets, marked *found in Jira*. A key that doesn't exist counts as "nothing found", not as an error.
- Found tickets are kept on the server (the latest 300), so a card can start from one. They don't join the Inbox.
- With demo tickets on, the demo set answers, including tickets only a search finds (SHOP-162, PAY-93).

**Any folder as context:** panel 1 has a third tab, **Folders** (`← →`).
- `Enter` opens the folder picker, the same walker as `F`; typing or pasting a path jumps there.
- The folder goes on the card like an extra repo: with `--add-dir` at start, or as its path when adding to a running card.
- The tab lists the folders the library doesn't have, and `Space` takes one out. Panel 2 marks them *dir*.

**Workspace notes:** the workspace editor has two new fields.
- *Notes for Claude*: every card starts with them, under `## Notes`.
- *How this team tests*: only QA cards get it, under `## How this team tests`.
- Both travel in the workspace file (`Shift+E` / `Shift+I`), bounded to 8000 characters each, so a team shares how it tests.
- `Ctrl+Enter` saves from a note field, where `Enter` is a new line.

**Keys:** `k`, `v`, `/` (now also Jira), the Folders tab's `Enter` and `Space`, and `s` on QA and review cards (*Report* in the legend), each with a row in `?`. `PROTOCOL` 10 adds `tickets.search` → `tickets.found`, `card.findPr` → `pr.found`, and `card.done`.

**Verified** on an isolated server, with Haiku and this setup:
- the Demo workspace, with notes
- demo tickets
- a `wishlist-app` demo repo whose local bare origin has a `feature/SHOP-162-heart` branch
- a stand-in `gh` that lists PR #57 for that branch

What passed:
- **QA from the Inbox:** `v` switched the Inbox from Mine (SHOP-155, SHOP-160) to Ready for QA (SHOP-149 with "Priya", PAY-84). `n` on SHOP-149 opened a **QA** card with:
  - the current branch
  - "QA SHOP-149: start with the test plan." as the opening message
  - *How this team tests* in the workspace layer
  - the QA job and the report heading in `p`
- **Review from a search:**
  - `c`, then `/ wishlist`: SHOP-162 (Sam's, *found in Jira*) appeared after a pause, and `Enter` made it the card's ticket.
  - `k` `k` made it a **Code review**. The PR lookup found PR #57, and the Branch row and the launch lines showed the copy on its branch.
- **Folders:** `→ →`, `Enter`, a typed path, then `Ctrl+Enter` put the folder on the card as *dir* with `--add-dir`, and `Space` took it out. `?` has the `k`, `v` and Folders rows.
- **Started for real:**
  - The review made `wishlist-app-shop-162`, a detached worktree at the PR's commit, while `wishlist-app` stayed on main. Its tab then stopped at the trust prompt for the new folder, as in §28.
  - The QA card's real session linked, and moved to Needs you on its first permission prompt.
- **The ends of both sessions**, played through the real hook route with each card's token:
  - The QA card went to Ship with "Report: Failed", and the review with "Findings: Changes requested".
  - The drawers rendered them, and the review's drawer also showed its PR.
  - `s` then `Enter` put the report on the clipboard, and `d` moved SHOP-149 to Done.
- No console errors.
- **Found by the walkthrough and fixed:** the *Code review* pill wrapped on a narrow tile and pushed "terminal" off it. It now says "Review", on one line.
- **Unit tests** (18 new) cover:
  - the QA JQL and the search JQL
  - both views from a stand-in Jira, merged by key
  - a search finding a ticket that a card can then start from, and a key that doesn't exist
  - demo search
  - PR matching, and the lookup on a stand-in TFS: reads only, a note per repo, and a missing token
  - reports picked out of Stop messages and moving the card, and never for development cards
  - kinds from tickets, the job text, and the review's launch lines
  - the new-card screen's kind, PR, search results and folders
  - notes in the workspace file
- `pnpm typecheck`, `pnpm test` (210) and the Vite build pass.

**Not verified:**
- VU's Jira (the Ready for QA query, text search) and TFS (the PR list). This is the first thing to try there.
- A real `gh pr list`: the stand-in answered.
- The PR copy of a repo that Claude Code hasn't been told to trust stops at the trust prompt in its tab. Answer it once.

**Not yet:**
- Posting findings to the PR, or the report to Jira. The owner wants this later, asked first each time.
- QA against the PR's build or a deployed environment, rather than locally.
- Bringing VU's tools into the app: the scenario generator as a recipe step or an MCP tool, and the hosted field tools as links or MCP servers per workspace. This fits §35's rule: a workspace-level, swappable module.

## 41. Opening a card takes the whole screen

2026-09-30, from the owner: clicking a card opened a side panel, which didn't feel right. When you open a card, you want to give it your full attention.

This departs from the mock (`path-line.html` drew a 620 px drawer) at the owner's request.

**What changed:**
- **Opening a card fills the line**, the same way the new-card screen does: `Enter` or a click, as before.
  - The header has the card's key, stage, kind, terminal tab, workspace and title, plus *Back to the board* (`Esc`).
  - The board stays underneath, and `Esc` returns to it with the card still focused.
- **Wide windows (1024 px and up) show two columns.** On the left, Overview or Context (`Tab` switches between them). On the right, the live transcript, kept at the newest message unless you scroll up to read.
- **Narrower windows show one column**, with Overview, Context and Transcript as tabs, as before.
- Every other key works as it did in the drawer: `c`, `x`, `t`, `o`, `e`, `s`, `Delete`, and the expand key. The action bar runs along the bottom.
- The button and legend entry for the expand key now say **Type to it here**, since the card itself is already full screen. The key still opens the card's session in the app.
- `?` says "Open the card full screen…", with a row for `Esc (card open)`, and the legend's `Tab` says *Overview · Context*.

**Verified** (isolated server, the §40 test data; 15 scripted checks, screenshots looked at):
- The review card opened at full width, with its findings, PR and details on the left and the transcript on the right.
- `Tab` went to Context and back.
- `s` opened the findings, and `Esc` there left the card open.
- `Esc` returned to the board with SHOP-162 still focused, and `Enter` opened it again.
- `c` opened Add context over it, and `Esc` came back to the card.
- At 900 px wide, Transcript was a tab again, and `Tab` reached it.
- No console errors. `pnpm typecheck` and `pnpm test` (210) pass.

**Amended the same day: `←` / `→` step to the previous or next card**, asked for by the owner.
- The order is the board's: column by column, only the cards the board shows (the workspace and the `/` filter apply). Inbox tickets are skipped.
- The next card opens in the same place and on the same tab, and the board's focus follows it, so `Esc` returns to the card you ended on.
- At either end it says it is the first or last card and stays put.
- The header shows "Card 2 of 7" between two arrow keycaps, which can also be clicked (`stepCard` in `line-model.ts`, tested).
- The legend shows *Previous / next card*, and `?` has a row for it.
- **Verified** (isolated server, 8 scripted checks):
  - `→` from SHOP-162 on its Context tab opened SHOP-149, still on Context.
  - `→` again said it was the last card, and `←` went back.
  - `Esc` left SHOP-162 focused, and `?` has the row.
  - No console errors. `pnpm test` (211) passes.

**Not yet:** the legend's `Tab` still says *Overview · Context* on a narrow window, where it also reaches Transcript.

## 42. Try it starts the stack: pick dev or uat and the APIs, the UI on a proxy copy

2026-09-30, from the owner's answers to `docs/prompts/continue-try-it-stack.md`. Their flow at VU:
1. Each API runs on Okteto from its own repo: a PowerShell command makes the feature-branch deployment and asks two questions, then `kubectl apply`, `okteto up`, and `dotnet watch run` inside the container.
2. The UI's `proxy.conf.json` gets rules pointing at the forwarded local port.
3. The UI's dev server starts.
4. They sign in and open a loan by hand.

**Which APIs run changes per card and per developer**: some, all or none of the APIs in the card's context. So a single hand-written recipe doesn't fit. A workspace's **stack** says once how *an* API starts and lists the APIs with their own values, and `t` picks what to run.

**The stack** (`shared/stack.ts`, stored per workspace by `server/stack.ts`). It's edited as JSON in the recipe dialog's third tab (`Alt+W`) and has four parts:
- **`choose`:** what `t` asks every time, the first value being the default: `{ "env": ["dev", "uat"] }`. The owner wants it asked each time.
- **`api.steps`:** the template for one API, in run-recipe syntax, with `{{placeholders}}`:
  - `{{env}}` and any other `choose` name;
  - `{{branch}}`: the API repo's git branch, made safe for a Kubernetes name (`feature/ABC-12` → `feature-abc-12`);
  - `{{repo}}`, and the API's own `values` (`{{name}}`, `{{port}}`, `{{dir}}` …).

  A placeholder with no value is an error that names it. The braces are double so PowerShell's `{ }` blocks are left alone.
- **`api.proxy`:** the proxy rules each picked API adds, also templated (`/gateway/…/{{route}}/**` → `http://localhost:{{port}}`). An API's own `proxy` adds routes only that API has.
- **`apis` and `ui`:** `apis` is a list of `{ repo, values, proxy? }`; `ui` is `{ repo, proxyFile, proxyMode?, steps, url? }`.

Around the stack:
- It travels in the workspace file (`Shift+E` / `Shift+I`). It is checked on import and marked "from the workspace file you imported: check it before running".
- A workspace with a stack runs the stack instead of its recipe.
- The page gets it as the workspace's `RunRecipe` with `stack` set, so the card's context, the `t` check and the Try it section all see it.
- `PROTOCOL` is 11: `card.try` takes a `choice`, and `card.stackPlan` and `stack.save` are new.

**With a stack, `t` opens a picker** (`web/components/TryPick.tsx`):
- **Keys:** `←` `→` pick the environment; `↑` `↓` and `Space` tick APIs; `a` / `n` tick all or none; `Enter` starts; `Esc` cancels. They are in its footer, with a `?` row.
- **Each API says why it is or isn't ticked:**
  - *changed on this branch* (uncommitted files, or commits the remote's default branch doesn't have): ticked.
  - *named in the ticket* (its repo or `name`, as a whole word, in the card or ticket text): flagged, not ticked.
  - *in context, unchanged*: left to the shared environment.
  - An API whose repo neither the card nor the workspace has can't be ticked.
- The last pick per card is remembered in this browser, and wins over the suggestion next time.
- With nothing ticked, the UI runs alone against the shared environment.

**The run** (`stackSteps`, `prepareStackRun`):
1. Each picked API's steps, in its repo, in the stack's order.
2. The UI's steps.
3. Every `stop:` step: the UI's first, then the APIs' in reverse.

The Try it title says what was picked: "Demo stack · uat · orders-api".

**By default the proxy file is never edited.**
- The UI starts with `{{proxy}}`: a copy of `ui.proxyFile` at `~/.cc-control/runs/<card>.proxy.conf.json`.
- In the copy, the picked APIs' rules come first, because the dev server takes the first rule that matches. A rule of the same name is replaced.
- So Ship can't commit it, and the copy is deleted when the run stops.
- Proxy files with `//` comments and trailing commas are read.

`"proxyMode": "edit"` is for a dev server that can't take a different path:
- It changes the repo's file in place and keeps a backup.
- It puts the file back on stop.
- If the server stopped mid-run, the file is put back when the server next starts (`restoreLeftovers`).

A stack that can't be built changes nothing and says why. That covers a missing placeholder, a repo the card doesn't have, and a proxy file that isn't JSON.

**New step syntax**, for any recipe (`shared/recipes.ts`). Prefixes now come in any order, so a stack can put `@repo` before a line starting `stop:`.
- **`ps:`** runs the step in PowerShell (`powershell.exe -Command`) instead of cmd, with the profile loaded, since team commands often come from there.
- **`answers:"y,n"`** types those lines into the step's input.
  - Checked on this machine: PowerShell's `Read-Host` and `$Host.UI.PromptForChoice` both read them from a pipe.
  - With no input at all, `Read-Host` returns an empty answer. A step that asks questions but has no `answers:` gets empty replies.
- **`wait:"Now listening on"` / `wait:port:8080`:** a step that keeps running is ready only when a line contains that text (any case) or that port opens. Printing a URL or going quiet no longer counts. The drawer shows "waiting for Now listening on".
- **Only the last step sets the address `o` opens**, so an API printing `http://[::]:8080` no longer takes it.
- **`NAME=value` fills in `%NAME%`** from the environment, as cmd would: `KUBECONFIG=%USERPROFILE%\.kube\dev.yaml`.

**`pnpm run doctor`** has a section per stack. It runs none of the stack's steps. It checks:
- every program the steps name;
- PowerShell commands (`Verb-Noun`), looked up with `Get-Command` through the profile;
- `okteto context show`, when a step uses okteto;
- where each API and the UI are;
- two APIs set to the same port;
- whether the proxy file reads.

**Verified, with stand-ins only.** The real Okteto, kubectl and the team's PowerShell command are on the VU laptop.

The setup was an isolated server with a Demo workspace of three stand-in git repos:
- `orders-api`, on `feature/ORD-7-rounding` with a change;
- `fees-api`, clean;
- `web-ui`, with a commented `proxy.conf.json`.

The API template had three steps:
1. A `ps:` step that runs a stand-in `New-DevEnvironment.ps1` unless `deployment.json` exists. The stand-in asks two `Read-Host` questions.
2. `wait:"Now listening on" PORT={{port}} node api.js`, which prints build lines, then dotnet's line after 2.5 s.
3. `stop: node down.js {{name}}-{{branch}} -n team-{{env}}`.

27 scripted checks passed, and I looked at the screenshots:
- **Before starting:** Try it showed the stack. `t` opened the picker with orders-api ticked ("changed on this branch"), fees-api not ticked ("in context, unchanged"), and dev the default. `→` chose uat.
- **`Enter` started it:**
  - The create step ran in orders-api's repo, with the answers `y` then `n` and `uat`.
  - The API step showed "waiting for Now listening on" until the line appeared.
  - The UI came up at localhost:4299, not the API's address, started with the proxy copy: the API's gateway rule first, `/orders/api/**` sent to `localhost:18080`, the rest after.
  - The repo's proxy file was unchanged, and fees-api never ran.
- **`t` stopped it:** the stop step ran with `orders-api-feature-ord-7-rounding -n team-uat`, the API's port closed, and the copy was gone.
- **`t` again** remembered uat + orders-api. The create step was skipped because the stand-in deployment existed.
- **Editing:** `e` opened on the stack, `Alt+W` went round the tabs, and a stack missing a repo name was refused with the reason. `?` has the picker row. No console errors.
- **`pnpm run doctor`** against the same data: node and PowerShell found, both APIs and the UI in the workspace with their ports, and the proxy file read.

Unit tests cover:
- validation and its messages, placeholders, branch names and the choice;
- the order of the steps and `@repo`, proxy merging, suggestions, and what Claude is told;
- a real two-API run with readiness, the proxy copy and teardown;
- edit mode restoring the file on stop and after a crash, and a broken stack changing nothing;
- PowerShell answering `Read-Host` and a choice prompt;
- the new prefixes, `wait:` ignoring URLs, `%NAME%`, and the stack in the workspace file.

`pnpm typecheck`, `pnpm test` (227) and `tsc --noUnusedLocals` pass. The unused `useEffect` in `CommandDialogs.tsx` is gone.

**Not verified; needs the VU laptop:**
- Whether `okteto up` runs without a terminal. It normally opens a shell in the container, so the owner's stack runs `dotnet watch run` through `okteto exec`, in a second step.
- The exact deployment name the team's command makes from a branch. The stack assumes `<name>-<branch>`.
- Whether the UI's `nx … serve` accepts `--proxyConfig=<file>`. If not, use `"proxyMode": "edit"`.
- Each API's forwarded port.

**Not yet:**
- Opening a loan. For now a `!` step says to sign in and open one; the scenario tool comes later.
- Starting several APIs at once. They start one after another.
- Per-developer settings on top of the shared stack. Values like ports are shared through the workspace file.

## 43. Review before rollout: secrets, robustness, the daily loop, less on screen

2026-09-30, asked for by the owner ("make sure it's set up in the best way to be fluid and streamlined", then "the UI is a bit too busy"). Four review passes (developer flow and keys; server robustness; onboarding and docs; code health and tests), each finding checked against the code before anything was changed. What was fixed the same evening, then what is left as proposals.

**Fixed: security and robustness**
- **Tokens from `config.env` no longer reach anything the server starts.** They were in the environment of every terminal tab (so in Claude's shell), every Try it step and every SDK session. `withoutSecrets` (`server/config.ts`) drops `CC_CONTROL_*TOKEN|SECRET|PASSWORD|KEY` from `tabEnv`, `RunService` and the SDK env. Tested.
- **The Vite dev page's origin (`:5173`) is only trusted under `pnpm dev`** (`CC_CONTROL_DEV=1`, set by `scripts/dev.mjs`). Before, any page on `localhost:5173`, Vite's default and so very likely the UI a card is working on, could open the WebSocket and run `card.try` or `card.ship`.
- **A second server started by mistake no longer touches the first one's files:** `writeHookSettings` and `restoreLeftovers` moved from module load to after the port is held.
- **`t` again on a live stack run** stopped the old run *after* writing the new proxy file, so the old cleanup deleted (or overwrote) it. The old run is now stopped first, and `RunService.stop` waits on a stop already in progress instead of returning at once.
- **The port poll stopped when a step came up** (it ran every second for the life of every app).
- **Clear words instead of `exit -1` / JSON errors:** a command that times out says a sign-in or confirmation window may be waiting (the usual cause: Git Credential Manager on push); a missing program says so; Azure DevOps answering a sign-in page (203, or HTML) names the token and scope; Jira answering HTML names the address and token kind; `CC_CONTROL_JIRA_SITE` without `https://`, or Jira Cloud without the email, show as the source's error in `Shift+T` instead of a silent "off" and an unhandled rejection every five minutes.
- **The settings file:** a UTF-8 BOM is dropped; a UTF-16 file (PowerShell 5.1's `Out-File` default) is named as the problem; a `CC_CONTROL_*` line that parsed to nothing (an unquoted `#`) is named; doctor prints the exact copy command for a missing file.
- **doctor** survives a missing git or PowerShell. `scripts/` is now typechecked; `noUnusedLocals` / `noUnusedParameters` are on in `tsconfig.json` (so `pnpm typecheck` catches what `tsc --noUnusedLocals` used to); dead `eslint-disable` comments are gone; one recipe test used shell quoting that only works in cmd and failed under CI's `sh`.
- Step caps agreed: the editor kept 12 lines while the server and the stack kept 20 (`MAX_STEPS` in `shared/recipes.ts`).

**Fixed: the daily loop**
- **`d` on a card in Ship moves it to Done by hand** (the PR merged or closed elsewhere, or a host Ship can't follow). Before, a Develop card on such a host could never reach Done. Server: `finish()` allows a Develop card once it is in Ship. Legend, `?`, README.
- **`o` opens the pull request when no app is running** (before: "Nothing running yet"). The legend says *Open the PR*.
- **`e` on a focused card on the board edits its run recipe**, the same as with the card open; `e` with no card focused still edits the workspace. (Before: `e` on the board always opened the workspace editor, though `?` only listed `E`.)
- **Esc works in the run-recipe editor after a click outside its fields** (`recipe` is in `INPUT_DIALOGS`).
- **Esc in the new card's preview returns to the list** instead of dropping the whole screen.
- **Column hints say the key:** Try it: "t tries it · s ships it"; Ship: "s merges the PR · o opens it".
- **After Ship, the flash says what's next:** "Opened PR #12 · o opens it; s merges it once its checks pass (looked at every few minutes)".
- **A QA report or review findings landing now chimes and notifies** ("Report ready: s shows it"); before, those cards' one event was silent.
- **"Type to it here" is now "Its session"** (button, legend, `?`, the rebindable action's name): the session view reads along, and sending from it forks; the terminal tab is where you answer. The old label promised the opposite of what the card view says beside it.
- The session key only shows once the session is in the list (`hasSession` from `linked`), so it can't open an id the page doesn't have.
- Ship sheet: `t` focuses the PR title (`m` / `t` / `b`).
- `?` rows added or fixed: `d`, the picker's `a` / `n`, the report sheet's keys, `Shift+T`'s `D` / `R` and hidden tickets, `e` on the board, one Esc row instead of two.

**Fixed: less on screen** (owner: "a bit too busy and overcomplicating things")
- The board's third bar no longer repeats the legend ("All 1 workspaces. Pick one (1–9)…"); it keeps Import and Folders, and the "no workspaces yet" hint.
- The new card: the memory meter and "% of its memory" are gone (the total stays, the percentage is in its tooltip); "In the app (later)" is gone from *Where it runs*; its help line now says the one thing that matters (the trust prompt) instead of describing the hook.
- The card's Context tab: the paragraph about UserPromptSubmit and `/clear` is one line.
- Welcome: the "Run a workflow" cluster (number pad, for sessions) is now *Start work* (`n`, `c`, `t`, `s`), which is what the first screen needs.

**Fixed: onboarding** (README): a `winget` / `npm i -g` block for a fresh machine; the company-proxy `pnpm install` note (and `.npmrc` with `manage-package-manager-versions=false`, so pnpm doesn't fetch its pinned version from a company feed); the trust-prompt sentence; a **Setting up at a company** section in order (settings file, Jira, PR host, certificates, doctor, workspace and mapping, the stack editor), with a line for people who don't write code; `Delete`, `d`, `o` rows; where state lives; `config.env.example` lists the rarely used variables.

**Verified:** `pnpm typecheck` (now strict on unused), `pnpm test` (229), the Vite build; a 13-check Playwright pass on an isolated server (Welcome cluster, column hints, `e` on the board, Esc in the editor, `d` on a Try it card and on a Ship card, the Ship card's legend, `?` rows, Esc in the preview; three checks that failed were regexes against rendered text and were confirmed by hand from the screenshot and a direct probe); screenshots of the board, new card and open card looked at before and after the trims. No console errors.

**Proposed, not done** (judgement calls for the owner; most valuable first):
1. **Needs you is a dead end:** every "answer it in its tab" ends with the user alt-tabbing and hunting for the tab by title. A key on a card that brings its Windows Terminal tab forward (`wt -w 0 ft` needs the tab index; `AppActivate` from PowerShell is the fallback) would be the single biggest friction cut. The channel-based `Y` / `A` / `N` from a card is the full fix (preview flag).
2. **An open card shows every action twice** (the button bar above the legend). One should go. If the legend's items became clickable, the bar could, keeping the view to the content.
3. **Esc Esc, `Alt+L` or the logo throw away a half-built card** with no way back. Keep the last composer so `c` offers "Resume CARD-4 you were building".
4. **Orphaned Try it processes after a `Stop-Process` restart** (no SIGTERM, so `stopAll` never runs): write spawned PIDs to `runs/pids.json` and kill the survivors on boot, the way `restoreLeftovers` puts files back.
5. **Deleted cards leave worktrees and branches;** a failed `wt.exe` launch leaves a branch that blocks the retry. Undo on failure; offer `git worktree remove` on delete.
6. **Every hook event broadcasts every card to every client** and rereads `settings.json`. Debounce `changed` and send one `card.upsert`.
7. **Claude Code found only as `claude.exe`:** an npm global install has `claude.cmd`, which neither cards nor doctor find. Also the card's "trust the folder" hint shows when `node` isn't on the tab's PATH, which is the wrong cause.
8. Jira *Mine* with nothing assigned shows an empty Inbox with no hint; a transient Jira failure empties the Inbox (keep the last good list).
9. Ctrl+Enter and Alt+arrows fire from the filter box and the composer's text fields.
10. Code health: rename `line.drawer` → `line.open` and fix the "drawer" comments; split `Dialogs.tsx` (1022 lines), `TicketLine.tsx` (card view and Try it into their own files) and `server/index.ts`'s 300-line switch; `web/line-keys.ts` has no tests (pull `decideShip` / `decideTry` into `line-model.ts`); the stack tests bind fixed ports; CI has no `windows-latest` leg though the product is Windows-only where it matters; dead exports `workspacesLoaded`, `flagsFor`, `BUCKET_TITLE`, `library.scan`.

## 44. Type to the card's terminal from the page, and answer its prompts: the channel

2026-09-30, from the owner: "Once we've opened a card, it should be easy to interact with our Claude Code session to answer any questions or send a message (I want this to send messages to that terminal, not a copy)." And, more widely: the developer should leave the app as rarely as possible, for Claude Code, Jira, GitHub or TFS.

**What it does.** With a card open, a message box sits under the transcript. `Enter` focuses it; what you type is sent into the card's terminal session itself (it appears there as `← cc-control: …`, and Claude answers in the tab and in the transcript here). When the terminal asks to allow a tool, or to approve a plan, the card shows it with **`y` / `n`**, and the answer goes straight to the terminal. A question Claude asks is answered by typing. The legend shows `Enter` *Type to it* and, while something waits, `y n` *Allow / deny*; `?` has the rows. A card that started before this, or whose channel is gone, says so and points at the tab.

**How** (the mechanism is Claude Code's research-preview *channels*; PLAN §26 found it, `spike/channel.mjs` proved it on 2.1.285):
- `hooks/cc-control-channel.mjs` is an MCP server with the `claude/channel` and `claude/channel/permission` capabilities and no tools. A card's `claude` starts it (`--mcp-config` names a file written next to the hook settings, `~/.cc-control/claude-channel.json`). It connects to the cc-control server over a WebSocket on loopback (`/channel`), proves which card it is with the card's token (the same one the hook uses), and from then on relays both ways: `send` → `notifications/claude/channel`; `notifications/claude/channel/permission_request` → the server; `permission` → `notifications/claude/channel/permission`. Without the variables or with the server down it still answers the MCP handshake, so the session starts as usual, and it reconnects with backoff.
- `server/channel.ts` (`ChannelService`): one socket per card, nothing believed before a hello with a matching token, a newer channel replaces an older. `card.send` and `card.answer` (`PROTOCOL` 12); `card.channel` says the terminal is reachable.
- **The relayed prompt lives on the card as `relayed`, apart from `live.ask`.** Seen live: the channel's request arrived, then the `PreToolUse` hook (which clears the ask, since Claude is "working"), then `PermissionRequest` six seconds later rebuilt the ask without the id. `askOf(card)` (`shared/cards.ts`) joins the two for the page: the hook's fuller description (the plan text, the question) with the channel's id when they name the same tool, or the relayed prompt alone before the hooks say anything. It is cleared when answered from here, when the tool ran (`PostToolUse`), when the turn ended, or when you typed in the tab.
- **The flag and the launcher.** Channels need `--dangerously-load-development-channels server:cc-control`, which stops at a confirmation in the tab ("I am using this for local development / Exit") on every launch. `--channels server:cc-control` is accepted and loads the channel, but **drops what it sends in** (checked: a message pushed mid-turn was never seen; only approved channels get through, and approval is an org-level managed setting, `allowedChannelPlugins`, for plugins). So a card's tab now runs `hooks/cc-control-launch.ps1`: it starts `claude` in the same console, watches the console's own screen buffer for exactly that prompt, presses Enter once through `WriteConsoleInput`, and otherwise stays out of the way (`WaitForExit`, exit code passed on). The trust-the-folder prompt is still yours. The whole claude command reaches the launcher as one base64 argument (a JSON array), which also ends Windows Terminal's re-quoting of the command line for good: the first live attempt failed because inline `--mcp-config` JSON didn't survive it. `CC_CONTROL_CHANNEL=0` turns the channel off (plain `claude`, as before); `pnpm run doctor` says which.
- Claude Code's banner says "server:cc-control · no MCP server configured with that name" and then uses it anyway (the name check seems to run before `--mcp-config` loads). Cosmetic.
- `CC_CONTROL_DEBUG=1` (where the server starts) makes the channel script log every message both ways to `%TEMP%\cc-control-channel.log`; that log is what found the ordering above.

**Verified live** on this laptop (CLI 2.1.286, Haiku, the trusted demo repo, an isolated server; the card opened a real Windows Terminal tab): the launcher pressed through the prompt and the card linked (hooks) and showed READY (mirror); the open card had the message box (`channel: true`); `Enter` + a message asked Claude to run `node -e "console.log(6*7)"`; the terminal showed `← cc-control: …` and asked to allow Bash; the page showed *Allow running: Run Node.js to calculate 6*7?* with `y` / `n` (the relayed id, after PreToolUse and PermissionRequest both landed); `y` allowed it; the terminal ran it and the transcript showed 42. Headless checks along the way: the channel initializes on 2.1.286; `--channels` drops inbound messages; the launcher passes a message with quotes, a semicolon and a trailing backslash through unchanged. Unit tests: the channel service (token, replace, relay both ways), the channel script's MCP handshake with no server and its relay with one, the launch arguments and base64 payload, the relayed prompt across the hooks' orders; `pnpm test` (233).

**Not yet, and the direction for "leave the app less":**
- The AskUserQuestion tool: its question shows on the card and is answered by typing; whether the terminal's picker accepts a typed answer through the channel wasn't tried.
- Plan approval was exercised in unit tests (ExitPlanMode relayed → kind plan) but not live.
- **Jira:** post the QA report or review findings as a comment, and move the ticket's status, from the report sheet (today it says "copy it into the ticket"). Read-only was a deliberate first step; writing needs asking first each time.
- **GitHub / Azure DevOps:** PR comments and checks inline on the Ship card (checks are already polled); post review findings to the PR (asked first); builds and pipelines from TFS (§35).
- **Bring the tab forward** (§43 proposal 1) still matters for the cases the channel doesn't cover (the trust prompt, a session started outside cc-control).

## 45. Key hints you can switch off

2026-09-30, the owner: the page is busy; the keycaps should be switchable off. The cockpit (§13, keys drawn on everything) stays the default, but it is now a setting, the first step of `docs/prompts/continue-calm-ui.md` (a calmer UI for users and developers alike).

**What it does.** `Settings.keyHints`: `always` (as before), `hover` (keycaps appear while you hover a button or row; the key bar keeps only the keys that matter right now, the ones with a tone), `never` (no keycaps, no key bar; `?` is the way to see keys). Set it with `H` in the `?` overlay (its header shows the current value), or on the first row of `B` (now *Keys and hints*; Enter, Space or ← → cycle it). Saved on the server with the bindings, so it follows you across browsers. The keys work the same whatever the setting.

**How.** `web/hints.ts` (pure, tested): the cycle, `trimLegend`, and `applyHints`, which writes `data-hints` on `<html>` (the theme does the same). `styles.css` does the rest with three rules: `[data-hints] .kc` hides, except large keycaps (content: the answer buttons, the tour), `.kc-inline` ones and anything inside `.kc-keep`; the hover rule shows a keycap while its button, link, label, row or option is hovered; with `never`, `.kc-inline` renders as bold text so a sentence still reads ("Press c to add a repo"). `Key` grew an `inline` prop, set on the ~25 keycaps that sit inside sentences; `Overlay` grew `keepKeys`, set on `?`, `B` and the Welcome tour; the key bar is `kc-keep` too. `cleanSettings` on the server accepts the three values; `PROTOCOL` 13, so a page on an older server shows the restart banner instead of silently not saving.

**Measured** (1440×950, the demo board, visible keycaps): board 38 → 6 (hover) → 0 (off; the two counted are the Inbox sentence's keys, now text); an open card 49 → 11 → 0 (plus three sentence keys as text); the new-card screen 50 → 7 → 0. Interactive elements are unchanged by design: the trims that cut those are the next steps (continue-calm-ui.md §2). **Verified:** `pnpm typecheck`, `pnpm test` (235), the Vite build; a Playwright walkthrough on the isolated server: `H` in `?` cycles the three values and `?` keeps all its keycaps in each; with hints off, Tab, Esc and `c` still work and the sentences read as text; on hover, the hovered button's keycap shows; `B`'s first row cycles with Enter; the value survives a reload (it came back from the server). No console errors.

**Audit with hints off** (every keycap site classified, then every screen and dialog screenshotted): sentence keys read as words (`inline`); words that only make sense next to a key ("click, or Space", "↑ ↓ then ← →", "E edit a key") are `.kc-hint` and go with the keycaps; key strips (a dialog's footer, the slash-suggestion footer) are `.kc-legend`: kept with their keys on hover, gone when off; the card's ← → and the session view's previous / next buttons, which were a keycap and nothing else, now carry an arrow icon. Buttons keep their words, list rows keep their labels, the large keycaps (answer buttons, the tour) stay.

**Not done:** `!important` holds the hide rule over a few keycaps styled `hidden md:inline-flex` (the header's home key); a cleaner way is to drop those responsive classes once the header is trimmed. In hover mode, a keycap appearing widens its button a little; nothing else moves.

## 46. Leave the app less, 1: g brings the card's terminal tab forward

2026-09-30, the owner: "reduce the amount of times the user needs to leave the app… keep us in the app for the majority of our flow". The loop, stage by stage, and where it still leaks out: the trust-the-folder prompt and anything the channel can't relay (Plan, Needs you: alt-tab and hunt for the tab); reviewing what Claude changed (an editor); PR comments and checks (the browser); the ticket's comments and status (Jira); builds (TFS); a half-built card thrown away by Esc (start over). This section is the first: §43's proposal 1.

**What it does.** `g` on a card (focused on the board, or open) brings its Windows Terminal tab to the front. The legend says *Its tab*, or *Answer in its tab* in amber when the session waits on you and the page can't answer (no channel, or the ask has no id yet); the open card's prompt box names it; a button sits in the bar. A card whose tab is gone says so.

**How.** `hooks/cc-control-focus-tab.ps1`: Windows Terminal has no "focus the tab called X" (`wt ft` takes an index), so the script walks the terminal's windows (`CASCADIA_HOSTING_WINDOW_CLASS`) with UI Automation, finds the `TabItem` named with the card's key, selects it and brings the window forward (restoring it if minimised; `AttachThreadInput` to the foreground thread, since Windows only lets that thread hand focus over). Tabs are now opened with `--suppressApplicationTitle`, because Claude Code retitles its tab ("✳ Fix the cart badge") and the key would be lost; the card already shows that state. `card.focusTab` (`PROTOCOL` 14) runs the script and answers ok or a plain error.

**Verified live (g):** two stand-in tabs (`CARD-1`, then another on top), `g` on the open card selected `CARD-1` and put the terminal in front (checked through UI Automation and the foreground window's class); `g` on a card with no tab explains; the legend, the button and the `?` row are there; `pnpm test` (236; a legend test for `g`). Cards started before this commit have Claude's title on their tab, so `g` can't find them until they are restarted: the error says so. over a few keycaps styled `hidden md:inline-flex` (the header's home key); a cleaner way is to drop those responsive classes once the header is trimmed. In hover mode, a keycap appearing widens its button a little; nothing else moves.

## 47. Leave the app less, 2: the card's changes, file by file, with the diffs

2026-09-30. Reviewing what Claude wrote meant an editor or `git diff` in the tab. The card listed file names only.

**What it does.** `Shift+D` on a card (focused on the board, or open; also the *diffs* link on the Overview's *What changed*) opens **Changes**: the files on the left, the card's own first, each with its kind (changed, new, added, deleted, renamed) and `+n −m`; the chosen file's diff on the right, coloured by line; `↑ ↓` (or `j k`) move between files; `s` goes on to Ship. The header says what it is against: the branch against the base it left (and how many commits are already on it), or uncommitted work on the base itself.

**How.** `ShipService.changes` (`server/ship.ts`): `git diff <merge-base of base and HEAD>` for tracked files (so commits already made and edits not yet committed both show), then `git diff --no-index /dev/null <file>` for each untracked file; cut at 2 MB with the sheet saying so. `parsePatch` and `patchLines` in `shared/changes.ts` (pure, tested) split the output into files and class the lines. `card.changes` (`PROTOCOL` 15). `web/components/ChangesSheet.tsx`. The legend shows `⇧D Changes` once a card has files or has shipped.

**Verified** on the isolated server against the demo `web-app`'s real uncommitted changes: four files with counts, `↓` moves, added lines coloured, Esc closes, `Shift+D` on the board opens it for the focused card, the `?` row; `pnpm test` (238). The "Changes" header check in the script failed only on its regex against the rendered separators; the screenshot was right.

## 48. Leave the app less, 3: a half-built card is kept, c picks it up

2026-09-30. §43 proposal 3: Esc Esc, `Alt+L`, the logo or a notification click threw the new-card screen away, and the context you had gathered with it.

**What it does.** Leaving the new-card screen with work on it (a title, a ticket, a note, or repos and tickets of its own) keeps it: the flash says so, the board's legend changes to `c` *Pick up your card* and `⇧C` *New card*. `c` brings it back as it was (the list, not the preview; not starting; no error); `Shift+C` starts a fresh card and keeps the draft for later; `n` on a ticket starts that ticket's card and keeps the draft too. Emptying it and leaving drops it. A blank screen, or one adding context to a running card, isn't kept (one keystroke to redo). It survives a reload: kept per browser in `localStorage` (`cc-control.draft`), the same place as the theme and the welcome flag.

**How.** `hasWork` and `asDraft` in `line-model.ts` (pure, tested); `closeComposer` / `takeDraft` in `store.ts`, called from `leaveComposer` (Esc, Cancel), `goHome` (`Alt+L`, the logo) and the notification click in `attention.ts`. `openComposer(ticket, fresh)` picks the draft up when called bare. One trap for next time: the store reads the draft while `store.ts` is still loading, so the storage key is written out in the two functions rather than a `const` declared below the store (a `const` there is in its temporal dead zone at that moment, and the read silently returned nothing).

**Verified** with a Playwright walkthrough on the isolated server: a blank card is not kept; Esc Esc keeps one with a title and the legend offers it; `c` brings it back with the title; `Alt+L` keeps it; it survives a reload; `Shift+C` opens a fresh one and the draft stays; emptied and left, it is gone; the `?` row. `pnpm test` (239).

## 49. Leave the app less, 4: the report goes to Jira from the sheet, and the ticket moves

2026-09-30. §44's "not yet" list: the QA report and review findings had to be copied into Jira by hand, and the ticket's status changed there.

**What it does.** On a QA or review card's report sheet (`s`): `j` posts the report as a comment on the card's Jira ticket, after a confirmation on the sheet (Enter posts, Esc backs out); `m` asks Jira where the ticket can move from its status and lists the transitions (↑ ↓, Enter moves it). Nothing is written until those keys are pressed and confirmed, and the flash says what happened. Only Jira for now: a Trello ticket, or a card without one, gets a plain message. A demo ticket takes both and remembers them on this server, so the flow can be tried before Jira is connected.

**How.** `server/tickets.ts`: `jiraCommentRequest`, `jiraTransitionsRequest`, `jiraTransitionRequest` (pure, tested): Cloud speaks the v3 API, whose comments must be its document format (`adfFrom`: paragraphs on blank lines, hard breaks on single newlines, never an empty paragraph, which Jira rejects); Data Center speaks v2 with plain text; the same auth as the search. `jiraCall` turns Jira's error bodies into words. `TicketService.comment / transitions / transition`; demo writes live in the `tickets.demoWrites` meta row and are applied in `list()`. Messages `tickets.comment`, `tickets.transitions`, `tickets.transition` (`PROTOCOL` 16). `ReportSheet.tsx` has the two modes.

**Verified** on the isolated server against the demo ticket SHOP-155 on a seeded QA card: `j` asks and names the demo ticket, Esc backs out, Enter posts and the sheet says *Posted*, `m` lists the other three statuses, Enter moves it to Done and the new-card screen's ticket list shows Done; unit tests for the three requests, the document format and the demo writes (`pnpm test`, 241). **Not verified against a real Jira**: the owner's VU laptop has one; the first real `j` is the test (a wrong document shape would come back as a 400 with Jira's words in the error box). Trello comments and list moves are the obvious next step with the same shape.

## 50. Ready for QA shows each ticket's QA reviewer

2026-10-01, from the owner: in the *Ready for QA* view, show the ticket's single QA reviewer, not only its assignee.

Jira has no standard field for a QA reviewer. Teams add a custom one, and its id (`customfield_…`) differs from site to site.

**How the field is found** (`server/tickets.ts`):
- **By name, automatically.** The first refresh asks Jira for its fields (`/rest/api/3/field`, or `/2/` on Data Center). It takes a custom field named like "QA Reviewer", "QA Assignee", "QA Tester", "Testing Owner", "Tester" or "QA" (`pickQaField`).
- **User fields win** over text ones of the same kind, so "QA Notes" or a text "QA Reviewer" lose to a user-type "QA Assignee".
- **Asked once per server run.** A failed lookup is tried again at the next refresh.
- **`CC_CONTROL_JIRA_QA_FIELD`** names the field instead (no lookup), and `off` hides it.
- The field is asked for in every search: the Inbox's views, and the new-card screen's Jira search.

**How the value is read** (`personIn`): a user (`displayName`, or `name` on Data Center), the first of a list of users (one reviewer), a select option's `value`, or plain text.
- An empty field becomes `qaReviewer: null`, and the tile says *no QA reviewer yet*.
- With no such field at all, nothing is said.

**What you see:**
- On *Ready for QA* tiles, after the assignee: "Priya · **QA Sam**", or *no QA reviewer yet* in italics.
- The same in the new-card screen's ticket list ("… · Ready for QA · Priya · QA Sam"), via `ticketSub` / `qaLine` in `shared/tickets.ts`.
- *Mine* doesn't show it.
- `pnpm run doctor` says which field it found, or that none is named like one and to set `CC_CONTROL_JIRA_QA_FIELD`. Run it first at VU.
- The demo tickets have one of each: SHOP-149 (QA Sam) and PAY-84 (none yet).

**Verified:**
- **Unit tests:**
  - picking the field (user fields first, the wrong names left alone)
  - reading each shape of value
  - a stand-in Jira whose field list has "QA Reviewer" as `customfield_10077`: the QA view showed "Priya · QA Sam" and an empty field as null; every search asked for the field, and the field list was fetched once over two refreshes
  - `CC_CONTROL_JIRA_QA_FIELD` naming a field (no lookup) and `off` (not asked for)
  - `pnpm test` (243) passes
- **Isolated server, demo tickets, 5 scripted checks:**
  - Mine doesn't show it.
  - Ready for QA showed "Priya · QA Sam" on SHOP-149 and *no QA reviewer yet* on PAY-84; screenshot looked at.
  - The new-card list showed "Priya · QA Sam".
  - No console errors.
- `pnpm run doctor` still runs.

**Not verified:** VU's Jira. Whether its field is found by name is the first thing `pnpm run doctor` will say there.

## 51. The stack editor starts from your repos, and never saves made-up ones

2026-10-01, from the owner's first try at VU: `t` picked dev, then listed **orders-api** under *APIs to run*, a repo that isn't theirs.

**Why:**
- With no stack yet, the stack tab of the recipe editor (§42) opened on `STACK_EXAMPLE`, an example with made-up names: `orders-api`, a `web-ui` with an Nx command, and a fictional PowerShell command.
- Saving it untouched made it the workspace's stack.
- The picker then listed `orders-api` greyed out as "not in this card or its workspace", and a run would have failed on `web-ui`.

**What changed:**
- **The editor starts from a draft of the workspace's own repos** (`stackDraft` in `shared/stack.ts`):
  - a UI found by name (*ui*, *web*, *client*, *frontend*, *app*… as a word)
  - the APIs found by name (*api*, *service*, *svc*, *backend*…), or every other repo when none says so
  - a port each (5001, 5002…), so two APIs never clash
  - `choose: env: [dev, uat]`, a common Okteto shape (`wait:port:{{port}} okteto up --namespace {{env}}`, `stop: okteto down`), and an Angular-style UI start with `--proxy-config {{proxy}}` on `proxy.conf.json`

  It says, in bold, to change the commands, ports and proxy file before saving. `STACK_EXAMPLE` stays as the tests' worked example and is no longer offered.
- **Saving refuses repos that aren't here.** `stack.save` checks every API and the UI against the workspace's repos and the repo library (a card can add library repos), by folder name, in any case. It names the strangers and the workspace's repos, and says when they are the example's made-up names (`unknownStackRepos`).
- **A stack saved before this says so:**
  - The editor shows an amber note naming the repos it doesn't have, and how to start again: empty the box, save, and reopen for a draft.
  - When none of a stack's APIs is in the card or its workspace, the `t` picker says so (and that it is still the example, for `orders-api`), with the keys to fix it: `Esc`, `e`, `Alt+W`.

**Verified** (isolated server; a workspace of the demo `Workspaces-UI` and `Workspaces-API` with the old example stack written into its database, as the owner's was; 7 scripted checks, screenshots looked at):
- Saving the example through the server was refused: "orders-api, web-ui aren't repos in Workspaces or the repo library (Workspaces has Workspaces-UI, Workspaces-API)… the example's made-up names".
- `t` on the workspace's card said the stack is still the example.
- `e` opened on the stack with the amber note.
- Emptying it and saving removed the stack. `e`, `Alt+W` `Alt+W` then offered the draft, with Workspaces-API as the API and Workspaces-UI as the UI, and no orders-api.
- The draft saved, and `t` then listed Workspaces-API, which could be ticked.
- No console errors.
- Unit tests cover the draft (UI and APIs picked by name, ports, all-API fallback) and finding the example's names. `pnpm typecheck` and `pnpm test` (244) pass.

**Next:** getting the real stack running at VU. The handoff is `docs/prompts/continue-try-it-at-vu.md`, written to be lean on tokens there.

## 52. A step is ready when its address answers: wait:http:

2026-10-01, from a handoff from the VU laptop.

**What happened there:** a stack step that starts a .NET API with `dotnet watch run` was never marked ready by `wait:"Now listening on"`, though the API was up.
- The app logs through Serilog with the `Microsoft` namespace overridden to Warning, so Kestrel's Information-level "Now listening on" line is never printed.
- `wait:port:N` can't tell either: `okteto up` forwards the port locally before the app behind it starts, so the port is open while every connection is dropped.
- The workaround there, until this ships, was `wait:"Overriding HTTP_PORTS"`, a warning printed just before Kestrel binds.

**What changed:**
- **`wait:http:8080/self`** (`shared/recipes.ts`): the step is ready once `http://localhost:8080/self` answers with any status below 500. With no path it asks `/`, where even a 404 means the app is serving. Only a port is taken, never a host, so the check stays on this machine.
- **The server asks every second** (`server/recipes.ts`), each try with a 3 s limit, on its own HTTP agent so a proxy set in the environment is never used for localhost.
  - Refused, reset or dropped connections (the forwarded port with nothing behind it) and answers of 500 and up keep it waiting.
  - After **10 minutes** without an answer below 500 the step turns red and the run fails: "`node api.js`: http://localhost:8080/self never answered". The step is left running so its output stays visible, and `t` stops it with its `stop:` steps as usual. If it exits later, that changes nothing.
- **The Try it section says what it is waiting on and what it last got:** "waiting for http://localhost:8080/self · no answer yet", then "· answered 503"; a timed-out step says "no answer in 10 min" in place of an exit code. No new action, so no new key.
- **Docs:** the recipe editor's help, the README and `continue-try-it-at-vu.md` name the prefix. `STACK_EXAMPLE`'s `dotnet watch run` step uses `wait:http:{{port}}` in place of the Kestrel line.

**Also in this commit:**
- `CLAUDE.md` has a *Two laptops* section: development happens on the personal laptop only; sessions on the VU laptop diagnose and write a handoff, in the shape of the new `docs/prompts/vu-handoff-template.md`, with nothing internal in it.
- `CLAUDE.local.md` is ignored by git, for notes that must stay on one machine.

**Verified** with stand-ins, not the real Okteto or the team's API:
- Unit tests:
  - parsing (`wait:http:8080/self`, no path, any case, a prefix with no command after it);
  - a real run: a stand-in that opens the port and drops every connection (like `okteto up`), then answers 503, then 200 on `/self`. The step waits through all of it, says "no answer yet" then "answered 503", and is ready only at the 200, after which the next step runs;
  - a step that never answers fails the run with its message, the next step never starts, and the step exiting later changes nothing.
- A scripted walkthrough on an isolated server (:7791; :7788 was taken), a Demo workspace with that stand-in as its recipe:
  - `t` showed "waiting for http://localhost:18099/self · no answer yet", then "· answered 503", then both steps "serving" and "Running at …".
  - `e` showed the new prefix in the editor's help.
  - No console errors. Screenshots looked at.
- `pnpm typecheck`, `pnpm test` (246) and `tsc --noUnusedLocals` pass.

**To check at VU:** after `git pull` and a server restart, change the API step to `wait:http:<port>/<a path the API serves>` and press `t`. The step should show "answered …" codes while `dotnet watch` builds, then turn to serving.

**Not yet:**
- Passing a value one step prints into a later step.
- Opening the loan through the scenario tool (for now a `!` step says to do it by hand).
- More APIs at once: each needs its own port, and okteto forwards 8080 by default.
- `pnpm run doctor` shows `okteto context` as invalid, because it runs without `KUBECONFIG`.

## 53. A worktree card gets a worktree of every repo, and Try it runs the card's own code

2026-10-01, the owner: working on several tickets at once, Try it should start the related APIs and the UI from *that card's* branches, not from whatever the repos' usual folders have checked out.

**Why:**
- A *New branch* card switches the branch in the repo's usual folder. Two cards in the same repo share that folder, so starting the second one changes the files under the first one's session and its Try it.
- A *New worktree* card got a worktree of its **home repo only**. Every other repo, and so every API in the stack, ran from its usual folder, on whatever branch was there. `{{branch}}`, and so the Okteto deployment name, came from that folder too.

**What changed:**
- **Every git repo in the card's context gets a worktree** on the card's one branch, next to the repo: `loans-api` → `loans-api-card-4` (`makeWorktrees` in `server/cards.ts`).
  - A folder that isn't the top of a git repo (the *Folders* tab can add any folder) is left as it is and named in the start-up log.
  - If any worktree can't be made (the folder is taken, the branch exists), the ones already made are removed with their branches, and the card doesn't start, as before.
- **The card keeps them** in `card.folders` (`{ repo, dir }`); `folderFor(card, repo)` gives the folder to use. A review card's copy of the PR's branch is recorded the same way.
- **Claude works in them:** `--add-dir` gets the worktrees, and the packet's *Repos* section lists their paths, with "Each repo above is a worktree of its own on that branch: change them there, not in the repos' usual folders." The home repo's line used to show its usual folder even on a worktree card; it now shows where Claude actually starts.
- **Try it uses them:** `runPlaces` maps each repo name to the card's worktree of it. So a recipe's `@repo` steps, the stack's APIs and its UI all run from the card's folders. The picker's *changed on this branch* looks at the worktree, and `{{branch}}` is the card's branch.
- **Edits in the worktrees count as the card's** files (the list Ship uses to tick files and to note what is elsewhere). `D` still shows the home repo only.
- **Ship is still one repo** (the home repo's worktree). Its note about changes in other repos now names the worktrees they are in, so they can be shipped from there by hand.
- **The new-card screen** calls the choice *New worktree of each repo* when the card has more than one repo, and *What happens* shows a `git worktree add` line per repo.
- **The stack editor's draft** (`stackDraft`) starts the UI with `if not exist node_modules npm install`, because a new worktree of the UI has no `node_modules`.

**Verified:**
- Unit tests:
  - `makeWorktrees` against real git repos: two repos and a plain folder give two worktrees on the same branch, the plain folder skipped, and the API's usual folder still on someone else's branch;
  - a clash on the second repo removes the first worktree and its branch, but keeps a branch that was already there;
  - a home folder that isn't a git repo is refused;
  - `folderFor`, the packet's paths and sentence, and *What happens*.
- A scripted walkthrough on an isolated server (:7792), with a worktree card seeded through `makeWorktrees` (no terminal tab opened). The workspace had real git repos `loans-api` and `shop-ui` and a stack. The card's change was only in its worktree of `loans-api`, and the usual `loans-api` folder had been switched to another branch.
  - The picker ticked `loans-api` as *changed on this branch*.
  - The API ran from `loans-api-card-4` on `card-4-fee-rounding`, with the card's change.
  - The UI ran from `shop-ui-card-4` on the same branch, checked by asking the UI itself.
  - Nothing ran from the usual folder. No console errors. Screenshots looked at.
- `pnpm typecheck`, `pnpm test` (250) and `tsc --noUnusedLocals` pass.

**Not verified:** a real card start through Windows Terminal with several worktrees: it opens a tab, which stops at Claude Code's trust prompt for the new folder. The start path is the tested `makeWorktrees` plus the existing tab launch.

**Costs to know about:**
- Each worktree needs its own install (`npm install` for a UI; `dotnet` restores on its first build).
- Claude Code asks to trust the new home folder once, in the tab.
- The worktrees stay when a card is removed; delete them with `git worktree remove` for now.
- Two cards can't run the same API at once: they would want the same forwarded port.

**Not yet:**
- Ship for every repo the card changed (a commit, push and PR per repo).
- A worktree for a repo added later with `c`: it is used from its usual folder.
- Worktrees as a workspace's default for new cards, and removing a card's worktrees from the app when it's done.
- A warning before Try it when a repo it will run from its usual folder is on a different branch from the card's.

## 54. A card is a unit of work: worktrees for everything, several cards up at once, a stack that needs no fiddling

2026-10-01, the owner (`docs/prompts/continue-unit-of-work.md`): one ticket may touch the UI, several APIs and more; all of it should be worked on in that card's own worktrees, spun up locally from them, with several cards tried at once even when they share the same UI and APIs, and with as little stack setup as possible: "they shouldn't need to be changing any stack settings/configs frequently".

**Plan, not yet built.** Five milestones, each its own commit with its own verification and its own *To check at VU* list. Costs are stated per milestone; the VU laptop is where Okteto, kubectl and the team's PowerShell command live, so anything touching them is tried against stand-ins here and checked there.

### Where it stands
- §53: a *New worktree* card gets a worktree of every repo in its context; Try it, the picker and `{{branch}}` use them. But *New branch* is still the Develop default (`kindDefaults`), a repo added with `c` runs from its usual folder, Ship is one repo, and nothing removes worktrees.
- §42/§52: every run of an API wants the same forwarded port (`values.port`), and the UI's port sits in its start command, so two cards can't run the same API or UI at once.
- §51: the stack is hand-written JSON from a draft; ports, routes and commands are typed in and shared through the workspace file.

### Milestone 1: worktrees are the way a card works, not an option
What changes for a user:
- A Develop card defaults to *New worktree of each repo*. *Current branch* stays for QA, review and a quick look, and *New branch* stays as a choice, no longer the default.
- A repo added later with `c` gets a worktree on the card's branch too (`makeWorktrees` for that one repo, added to `card.folders`), and it shows in the `t` picker. Claude is told where it is in the delivered context; with the channel on, cc-control also types `/add-dir <worktree>` into the tab, since `--add-dir` can't be changed after start. Without the channel the context says to run it.
- When a card reaches Done or is deleted, the drawer offers **Remove worktrees** (a key, a legend entry, a `?` row; candidate `Shift+X`, checked against the keymap when built). It lists each worktree with its state (clean, uncommitted changes, unpushed commits), stops a running Try it first, removes the clean ones and asks again for the others. Never silent, never automatic; the delete confirmation gets the same offer.
- Costs said once, plainly, in *What happens* on the new-card screen: a folder per repo next to it; the UI's first start runs `npm install`; Claude Code asks to trust the new folder once in the tab.

What it costs: disk per card is the checkout plus each UI's `node_modules` (git objects are shared, so a worktree is far smaller than a clone); a first `npm install` per card; one trust prompt per card. Nothing at VU depends on it.

Claude Code keeps trust per folder in `~/.claude.json`. The owner agreed (2026-10-01) to a setting, off by default, that marks a card's worktrees trusted before the tab opens, shown with exactly what it writes, like the hook install was.

**Built (2026-10-01), as above, with these particulars:**
- `kindDefaults` gives Develop `worktree`; the Branch row lists *New worktree of each repo*, *Current branch*, *New branch here: …*; the server's fallback for a choice the page never offered is the kind's default. Under the row, one note per choice says what it does and, for worktrees, what it costs; with the trust setting on it says the folder is marked trusted first.
- **`c` with a repo** (`addContext`, now async): a worktree card makes a worktree of each new git repo on the card's branch (`makeWorktrees(…, onExisting)`: `git worktree add <dir> <branch>` when the repo already has the branch, `-b` when not; a plain folder is used as it is), adds it to `card.folders`, and the boot log says so. The hook's text (`laterText` with the card's folders) names the worktree, says to change it there, and that edits there ask until `/add-dir <dir>` is run in the tab. The channel delivers messages, not keystrokes, so it can't run that slash command itself; the note is the honest version.
- **`Shift+X`** (board or open card; a legend entry, a `?` row, and a *Worktrees* row under *Where it runs*): `card.worktrees` answers with each worktree's branch, uncommitted changes, commits no remote or other local branch has (`rev-list HEAD --not --remotes --exclude=<branch> --branches`), or that the folder is gone. On a Done card `Enter` removes the clean ones (`git worktree remove --force`, then `git branch -D` of the card's branch in that repo; a gone folder is pruned), `f` removes them all; a card in flight only shows them. The Delete dialog's **`w`** opens the same dialog "then the card": the card goes once nothing is kept. A running Try it is stopped first. `PROTOCOL` is 17.
- **The trust setting** (`Settings.trustWorktrees`, a row in the Keys and hints dialog that says exactly what it writes): `server/trust.ts` sets `projects["<folder>"].hasTrustDialogAccepted = true` for each new worktree in `~/.claude.json` (keys with forward slashes, as Claude Code writes them), written whole only when the file read as JSON, beside-then-rename. A failure is a boot line, never a failed start. Off by default.

**Verified:**
- Unit tests (258 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the defaults; `laterText` with worktrees; `makeWorktrees` on an existing branch and its clean-up on a clash; `worktreeStates` and `removeWorktrees` against real repos (clean removed with its branch, uncommitted and unpushed kept, a folder deleted by hand pruned, `force` taking the rest); the service's `addContext` making a worktree for a git repo and not for a plain folder, with the hook's text; `removeWorktrees` refusing a card in flight unless it is being deleted; `trustFolders` touching only the flag, skipping folders already trusted, making a missing file and leaving a broken one alone; the legend rows.
- A scripted walkthrough on an isolated server (:7794; :7788 was taken) with a seeded workspace of real git repos, a worktree card in flight (one worktree dirty) and a Done one, and a third repo in the library; 31 checks passed, screenshots looked at: the new-card screen with the worktree default, its costs and the two `worktree add` lines; `Shift+X` on the card in flight showing both worktrees (clean, uncommitted changes) and that they wait for Done, `Enter` removing nothing; `c` adding the third repo, which became a worktree on the card's branch (checked on disk), listed on the Context tab and in the *Worktrees* row; `Shift+X` on the Done card removing both folders and the branch from both repos (checked on disk), with the boot line; `Delete` then `w` on the card in flight removing the two clean worktrees, keeping the dirty one with `f` offered, then `f` removing it with its branch and taking the card off the line; the `?` row; the trust row off, toggled on, and the new-card screen then saying so. No console errors.

**Not verified:** a real card start with the trust setting on (it would open a terminal tab); `trustFolders` was tested against a copy, not the real `~/.claude.json`.

**To check at VU:** start a Develop card with two repos and no setting: both worktrees made, one trust prompt in the tab. Turn the setting on in `?` `B`, start another: no prompt. `c` adds an API repo: its worktree appears in the `t` picker. When a card is Done, `Shift+X` removes its folders; make sure `okteto down` ran first (stop Try it with `t`).

### Milestone 2: several cards up at once
What changes for a user: `t` on two cards of the same stack starts two of everything, each on its own ports, each card's Try it showing its own URL. Nothing is typed into the stack for it.

How:
- **Ports are picked per run**, not written in the stack. cc-control takes free ports from a range (default 18000–18999, `CC_CONTROL_PORTS` to change it) and checks each is unused before the run. The run records them, so stop and the drawer know them.
- **Placeholders:** `{{port}}` becomes the local port picked for that API in that run. `{{appPort}}` is the port the API listens on in its container (from `values`, or the okteto manifest's `forward` once milestone 3 detects it; default 8080). The UI gets `{{uiPort}}`, and `ui.url` may use it (`http://localhost:{{uiPort}}`). A stack that still sets `values.port` keeps working: it is read as `appPort`, and the editor's note says so.
- **Okteto is told the local port.** `okteto up` has no flag for a forward; forwards come from the manifest (`forward: - local:remote`). At VU (the owner, 2026-10-01) the team's PowerShell helper **generates** `okteto.yml` and the deployment manifest per feature branch, in the repo, named after the branch, and `okteto up` reads them from the folder it runs in. So in a worktree card each card already has its own manifest and its own deployment; what is shared is the forward, `8080 -> 8080`. A step prefix **`forward:{{port}}`** on the `okteto up` line makes cc-control read the step's folder's `okteto.yml` when the step starts (after the helper has written it), write a copy beside it (`okteto.cc-control.yml`) with every forward's local side set to the picked port, and run the command with `-f okteto.cc-control.yml` added. The copy sits beside the original so relative paths resolve the same; it is deleted on stop, never ticked by Ship, and listed in `.git/info/exclude`. The draft and the example use it; a team whose manifest already says `${CC_PORT:-8080}:8080` can set `CC_PORT={{port}}` on the step instead.
- **The deployment name is cut to 50 characters** by the helper (the API's name, a dash, then as much of the branch as fits), so `{{name}}-{{branch}}` is wrong for long names. A **`{{deployment}}`** placeholder gives the cut name, and the stop step in the draft uses it. `k8sName` keeps the branch itself at 50.
- **The namespace and kubeconfig per environment:** the helper takes the environment and the project, and `okteto up` reads `OKTETO_NAMESPACE` (`<project>-{{env}}`) and `KUBECONFIG` (a file per cluster) from the environment. The stack sets the namespace from `{{env}}` as now; the kubeconfig path stays per developer in `config.env` (milestone 3), one variable per environment (`KUBECONFIG_DEV`, `KUBECONFIG_UAT`) picked by a step's `KUBECONFIG=%KUBECONFIG_{{ENV}}%`, where `{{ENV}}` is the choice in upper case.
- **The UI** starts with `--port {{uiPort}}` (Angular and nx both take it) and the per-card proxy copy already points at the picked ports.
- **Deployment names** already differ per card (`{{branch}}`); the picker and Try it title say the ports.
- `pnpm run doctor` loses the "two APIs on the same port" check and gains "the port range has room".

What it costs: RAM, mostly. At VU a second UI dev server and a second `okteto up` (its file sync) per card; two cards of a three-API stack are six Okteto deployments in the namespace. The run shows what is up so it can be stopped.

Depends on at VU:
- Namespace quotas for two deployments of one API.
- Whether `okteto up -f` with a sibling file keeps the sync folder and the build context (expected, to confirm).
- That the generated manifest's forward line is the plain `local:remote` shape the rewrite expects (ask for a sanitised copy).

Test here: two seeded worktree cards on one stand-in stack, started together: two APIs on two ports, two UIs on two ports, each UI answering with its own card's branch, each proxy copy pointing at its own API; stopping one leaves the other running.

**Built (2026-10-01), as above, with these particulars:**
- **`server/ports.ts`:** a `PortPool` over `CC_CONTROL_PORTS` (`18000-18999` by default; anything unusable falls back to it). A take skips ports another run holds or something on the machine already listens on, and a failed take holds nothing. `prepareStackRun` takes one port per picked API plus one for the UI when its steps or url use `{{uiPort}}` (`needsUiPort`), and the run's cleanup gives them back.
- **Placeholders (`shared/stack.ts`):** `{{port}}` is the picked local port (an API with none picked falls back to its `port` value, for the tests and for a run outside a pool); `{{appPort}}` is `values.appPort`, else the old `values.port`, else 8080; `{{deployment}}` is `k8sDeployment(name, branch)`, name-branch cut to 50 with no trailing dash; every chosen value is also there in upper case (`{{ENV}}` = `DEV`) for `KUBECONFIG=%KUBECONFIG_{{ENV}}%`. `stackSteps` and `stackRules` take a `StackRunContext` (branches, proxy, ports, uiPort); `uiUrlFor` fills `ui.url`; `runLabel` gives the Try it title its ports ("dev · loans-api :18000 · UI :18001").
- **`forward:LOCAL[:REMOTE]`** (`shared/recipes.ts`, `shared/okteto.ts`, `forwarded` in `server/recipes.ts`): when the step starts, the folder's `okteto.yml` / `okteto.yaml` is read, the forward whose remote side is REMOTE (else the first) gets LOCAL as its local side in a copy, `okteto.cc-control.yml`, beside it; the copy's name is put in the repo's `.git/info/exclude` (the common dir, so a worktree's too); an okteto command gets `-f okteto.cc-control.yml` right after its subcommand (never after `--`). String forwards (`8080:8080`, quoted, `8080:svc:80`) and object forwards (`localPort` / `remotePort`) are handled; line endings are kept. No manifest, or no forward in it, fails the step with what to do (a `launch` that throws is a failed step, not a crashed run). Copies go when the run stops.
- **The draft and the example** use `forward:{{port}}:{{appPort}}`, `appPort` instead of `port`, `{{deployment}}` in the delete step, `--port {{uiPort}}` and `http://localhost:{{uiPort}}`; the example's steps carry `KUBECONFIG=%KUBECONFIG_{{ENV}}%`.
- **`stackWarnings`** says, in the editor (an amber list) and in `pnpm run doctor` ("Two at once"), what keeps a stack from running twice: an `okteto up` without `forward:` while `{{port}}` is used, a `port` value (read as the container port now), `{{name}}-{{branch}}` instead of `{{deployment}}`, a UI without `{{uiPort}}`. Said, never enforced. The doctor's duplicate-port check is gone (there are no shared ports); it shows the range and whether it has room for two runs.
- The picker's footer says each API and the UI get a port of their own for the run; the editor's help names the placeholders and the prefix; `docs/config.env.example` lists `CC_CONTROL_PORTS` and the per-environment kubeconfig variables.

**Verified:**
- Unit tests (267 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the range and the pool (a listening port skipped, held ones skipped, given back, exhaustion); manifest forwards found and rewritten in every form; the `forward:` prefix parsed, the copy written with `-f` placed right, the exclude line written once, the errors; placeholders with and without picked ports, `{{deployment}}` cut, `{{ENV}}`, `uiUrlFor`, `runLabel`, the warnings (four on the old-style test stack, none on the draft or the example); the existing stack run now on a pooled port, given back on stop; **two cards running the same API and UI at once** through a stand-in `okteto` on PATH that starts the API on the port its `-f` manifest forwards: different ports, each UI's proxy copy pointing at its own API, both answering together, card 1 stopping (its copy gone, `{{deployment}}` in its stop step, its ports freed) while card 2 stays up; a `forward:` step with no manifest failing the run and naming the fix.
- A scripted walkthrough on an isolated server (:7795) with the stand-in okteto on its PATH, a Demo workspace of two real git repos, a stack using `forward:{{port}}:{{appPort}}` and `{{uiPort}}`, and two worktree cards; 22 checks passed, screenshots looked at: `t` on CARD-1 (the picker's footer sentence, loans-api ticked), `Enter`, the Try it title "dev · loans-api :18000 · UI :18001", "Running at http://localhost:18001", the step's output showing the forward, the manifest copy in the card's worktree; the UI at 18001 answering from `shop-ui-card-1` with its proxy pointed at 18000, the API at 18000 answering from `loans-api-card-1`; `t` on CARD-2 while CARD-1 ran: ports 18002 and 18003, its UI pointed at its API, CARD-1 still up, both proxy copies present; the board's tiles "App at localhost:18001" and "App at localhost:18003"; `t` on CARD-2 stopping only it (its stop step printing `okteto down loans-api-card-2-rate-lock-banner`, its copy gone, its UI down, CARD-1 still answering); the stack editor naming the placeholders and the prefix with no warning for this stack; `t` on CARD-1 leaving nothing running and no copies. No console errors.

**Not verified:** the real `okteto up -f` (whether a sibling copy keeps the sync folder and the dev name), the real helper's manifest shape, Kestrel binding to `{{appPort}}` inside the container, and the namespace's room for two deployments.

**To check at VU:** `git pull`, restart, `e` then `Alt+W` to the stack: the amber list says what to change (`forward:{{port}}:{{appPort}}` on the `okteto up` line, `appPort` for the old `port`, `{{deployment}}`, `--port {{uiPort}}`). Put `KUBECONFIG_DEV` and `KUBECONFIG_UAT` in `config.env` and `KUBECONFIG=%KUBECONFIG_{{ENV}}%` on the steps that need it. `t` on one card: the title shows the ports, the API step's output shows `Forward: 18000 -> 8080`, the UI serves on its port. Then `t` on a second card of the same stack: the next ports, its own deployment, both UIs up. If `okteto up -f` complains about the manifest path or sync, note the message: the fallback is the `${CC_PORT:-8080}:8080` edit to the team's manifest with `CC_PORT={{port}}` on the step (§54, milestone 2).

### Milestone 3: a stack that needs no fiddling
What changes for a user: `t` on a workspace with no stack works first time. It shows what cc-control found in the repos, with the one or two things it couldn't find asked once, and saves that as the workspace's stack on `Enter`. The JSON stays under an advanced tab for teams whose shape differs.

Detected per repo (`server/stack-detect.ts`, pure parts in `shared/`):
- **An API** by `okteto.yml` / `okteto.yaml`: its dev name, `forward` (gives `appPort`), its `command`; a `*.csproj` folder for `{{dir}}`; the health path when obvious (`MapHealthChecks("/…")`, `MapGet("/self")`, a `[Route]` named health/self/ping), else `/`, which `wait:http:` accepts with a 404.
- **The UI** by `angular.json` / `project.json` / `package.json`: the serve target's `proxyConfig` and `port`, the start script, nx or ng. Its proxy file's existing rules say the **route per API**: a rule whose target or key names the API (`/gateway/team/loans/**` for `loans-api`) is suggested as that API's rule; the rest are asked for once, per API, with the proxy file's rule shapes as examples.
- **What stays asked once per workspace:** the env list (default dev / uat) and any route no rule matched.
- Detection runs again when a repo is added (milestone 5) and when the stack editor is opened, showing *detected* next to *saved* so a drifted manifest is noticed.

The stack editor's first tab becomes that confirmation (a table: repo, role, app port, command, proxy rule, found in which file; `↑` `↓` to a row, `e` to change a value, `Enter` to save, `Alt+W` to the JSON as now). Every key is in the footer and `?`.

**Nothing machine-specific in the shared stack.** `~/.cc-control/config.env` already feeds every variable into the server, and steps fill `%NAME%` from it, so `KUBECONFIG=%USERPROFILE%\.kube\dev.yaml` stays per developer. What's added: the doctor lists which `%NAMES%` the stack uses and which are unset on this machine, and the stack editor's help says to put personal values there. If the owner's own kubeconfig path is in a workspace file today, it moves.

What it costs: nothing at run time; detection reads a few files per repo. Depends on at VU: the real shapes of `okteto.yml` (a fixed `dev:` name or a per-branch one, `forward` lines), the Angular/nx serve target, and the proxy file. Ask the owner for sanitised copies (no URLs or internal names) to write the parsers against; stand-ins otherwise.

**Built (2026-10-01), leaner than the table above, with these particulars:**
- **`shared/stack-detect.ts`** (pure; the server's `server/stack-detect.ts` walks each repo to depth 4 and 600 files, skipping `node_modules`, `.git`, `bin`, `obj`, `dist` and the like, and reads files on demand):
  - **An API** is a repo with `okteto.yml` / `okteto.yaml`, a `.csproj`, or a `package.json` that isn't a UI's. Its values: `name` from the manifest (`name:`, or the first `dev:` entry) else the folder name; `appPort` from the manifest's first forward (its remote side) else 8080; `dir` from `src/<X>/<X>.csproj` (else the shallowest `.csproj`; `.` at the root); `health` from the first C# file with `MapHealthChecks("/x")`, `MapGet("/self"…)`, `[Route("self")]` or `[HttpGet("health")]` (health, healthz, self, ping, alive, ready, status), else `/`; `route` as the draft guesses it.
  - **The UI** is the repo whose `angular.json` (the serve target's `proxyConfig` and `port`; `npx ng serve <project> --proxy-config {{proxy}} --port {{uiPort}}`), `project.json` (nx: `npx nx serve <name> --proxyConfig={{proxy}} --port={{uiPort}}`) or `package.json` (Angular's `npm start`, or vite / next / react-scripts `npm run dev -- --port {{uiPort}}`, with no proxy flag) says how it serves; two candidates, the one named like a UI wins and the other is said. Its proxy file is the serve target's, else `proxy.conf.json` anywhere; a `.js` proxy file is said to be code, not JSON.
  - **The route per API** comes from the proxy file's own rules: the rule whose key or target names the API (its route, name or folder) becomes the template `api.proxy` with the route swapped for `{{route}}` (in the key and in `pathRewrite`) and the target set to `http://localhost:{{port}}`; an API matched by a rule of another shape gets that rule as its own `proxy`; one no rule names is said to get the template.
  - **The template** is okteto (`wait:http:{{port}}{{health}} forward:{{port}}:{{appPort}} okteto up`, `stop: okteto down`) when any API has a manifest, else `ASPNETCORE_URLS=http://localhost:{{port}} dotnet run --project {{dir}}` for `.csproj` APIs, else `PORT={{port}} npm start`.
  - **Findings:** one line per thing read (with the file) or assumed (`?`): no manifest, no health route, no proxy file, a rule that names no API, the environments (dev, uat), and that anything the team runs before `okteto up` (a helper writing the manifest and deploying the branch, as at VU, where the manifest is generated and not in the repo) goes first in `api.steps`. Nothing to go on at all gives no stack.
  - `envNamesIn` lists the `%NAMES%` a stack's steps read, for the doctor.
- **`t` on a card in a workspace of several repos with no recipe or stack of its own** opens the picker in detect mode (`stack.detect`, `PROTOCOL` 18): the findings, then `Enter` keeps the found stack as the workspace's (`stack.save`) and the picker takes over with the environment and the APIs; `e` opens the editor on the stack tab (`modal.recipe.scope`) to change it first; with nothing found, `Enter` runs the home repo's own recipe instead. The legend's `t` and the `?` row say so. A single-repo workspace keeps its repo recipe.
- **The stack editor** with no stack saved opens on what was found (the findings listed over the box, the JSON in it) instead of the generic draft, and replaces the box only while it is still untouched.
- **Personal values:** `config.env` already reaches the steps as `%NAME%`; the doctor now lists each `%NAME%` the stack reads (`%KUBECONFIG_{{ENV}}%` expands to one per environment) and whether it is set on this machine, with where to put it. The confirmation *table* with per-field editing from the plan above was not built: the findings list plus the JSON box is the confirmation, and the JSON stays the one editing surface.

**Verified:**
- Unit tests (271 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the manifest's name (v1 and v2), health routes in their forms and one that isn't guessed, the serve command from `angular.json`, `project.json` and `package.json`, the rule for an API and its template; a workspace of an Angular UI with a proxy file naming two APIs, an okteto API with a `.csproj` and a `[Route("self")]` controller, a `.csproj`-only API with `MapHealthChecks`, and a docs repo, giving the stack above and the findings line by line; dotnet and npm templates, a UI with no proxy file, an API whose rule has another shape, nothing at all; the walk on disk skipping `node_modules`, `.git` and `bin`.
- A scripted walkthrough on an isolated server (:7796) with real git repos of that shape and no stack saved; 14 checks passed, screenshots looked at: the legend offering `t`; `t` showing *Found in your repos* with loans-api's manifest, project, `/self` route and rule, fees-api's assumption (`?`) and its `/health` route, shop-ui's `ng serve` from `angular.json` and the three rules, the `?` lines for the helper step and the environments; `Enter` keeping it, the picker following with both APIs; the Try it section showing the stack; `e` opening the stack tab on the saved JSON with `health`, `dir`, `appPort`, the `{{route}}` template rule and the `ng serve` step, and no two-at-once warning; the `?` row. No console errors.

**Not verified:** detection against VU's real files (the generated manifest, the nx serve target, the real proxy file): built against the shapes in the Okteto and Angular docs and the owner's description. A run of the detected stack wasn't started in the walkthrough (`ng serve` and the real `okteto` aren't here); milestone 2 proved the run mechanics.

**To check at VU:** on a workspace with no stack, `t` on a card: read the findings; what is `?` is what to fix in `e`. Expect: no `okteto.yml` until the helper has run (so fees-api-style assumptions for every API until then; run the helper once by hand, then `t` again and the manifest is read), the helper step to add first in `api.steps`, and the proxy file's rules naming each API. Send back any shape the detector missed (a sanitised `angular.json` serve target, `project.json`, the proxy file's rule, the manifest).

### Milestone 4: Ship per repo
What changes for a user: a card that changed several repos ships each of them. The sheet shows one block per repo (branch, files ticked, host), `Enter` commits, pushes and opens a PR in each from its worktree, in order, stopping at the first failure with the rest untouched. The card lists its PRs; `o` opens the focused one, `↑` `↓` moves between them in the Ship section. `s` again merges every open one after one confirmation naming them. Done when all are merged.

How: `shipPlan` returns a plan per repo that has changes in the card's folders (`card.folders` from §53); `card.ship` takes one request per repo; `card.ship.prs` replaces the single `pr`; each PR's body links the others ("Part of KEY; see also loans-ui PR 12"). GitHub stays on `gh`, Azure DevOps on its REST API (§36). `PROTOCOL` bumps.

What it costs: nothing new to install. Depends on at VU: a real multi-repo PR hasn't been opened from the app; the first one should be on repos the owner picks, asked first as today.

### Milestone 5: context added later feeds the run
What changes for a user: anything added with `c` changes what `t` offers. A repo added becomes a worktree (milestone 1) and is detected into the stack (milestone 3) if it is an API or a UI, with its row in the picker. A note naming an API makes the picker flag that API as *named in the ticket*, because the suggestions read the card's added notes too. The packet's *Running the app* says what is runnable now: each API's worktree, the ones added since the start, and the URL pattern the card will get.

What it costs: nothing. No VU dependency.

### Order and what each depends on
1 → 2 → 3 → 4 → 5 as the owner suggested. 2 defines the port placeholders that 3's detection fills, so 2 goes before 3. 4 needs only §53's folders and could be done any time after 1. 5 is small once 1 and 3 exist.

### Verification, each milestone
`pnpm typecheck`, `pnpm test`, `tsc --noUnusedLocals`, unit tests for the pure parts (worktree planning, port picking, placeholder filling, manifest rewriting, detection against sample files, per-repo ship plans), and a scripted Playwright walkthrough on an isolated server with screenshots looked at. The real Okteto, kubectl, nx and the team's command are only at VU: each milestone's section ends with *To check at VU*, and the stack docs say what was tried against stand-ins.

**Status:** plan agreed with the owner 2026-10-01 (order as above; the trust setting yes). Milestones 1, 2 and 3 built and verified 2026-10-01; milestone 4 (Ship per repo) next.
