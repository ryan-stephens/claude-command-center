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

**Found at VU (2026-10-01, the first smoke test):** `t` stuck on the `okteto up` step at *waiting for port 18000* while Okteto printed `Forward: 8080 -> 8080`. The owner's stack (from before this milestone) had no `forward:` on that line, and the amber list that said to add one is only seen in the editor, which nobody opens when `t` is right there. Two things were wrong with the design, not the stack:
- **A prefix that the run needs every time is not a setting.** Now `stackSteps` puts `forward:{{port}}:{{appPort}}` on any `okteto up` line itself whenever a port was picked for that API (shown on the step as it runs, so it is not hidden); `forward:no` on the line keeps the manifest's own forward, and that is the only case the amber list and the doctor mention now. The written prefix still works and still fails loudly when there is no manifest or no forward line. Found: the deployment name in Okteto's output was the 50-character cut (`…-api-wss-1068-denial-with`), as `{{deployment}}` assumes.
- **The `-f` went nowhere in a PowerShell line.** VU's steps are one-line scripts (`$Env:KUBECONFIG = "…"; okteto up`), and `forwarded` only put `-f okteto.cc-control.yml` after an `okteto` at the start of the command, so even a written `forward:` would have left Okteto reading the original manifest. It now finds the okteto command after a `;`, `&&` or `|` too.
Verified by unit tests (the implied prefix with and without a picked port, after a `;`, `forward:no`, other okteto commands left alone; the `-f` placement in a PowerShell line and after `&&`; the warnings) and by the two-cards run through the stand-in `okteto` with the `forward:` taken off the stack's line: both copies written with their ports, both APIs answering at once. **To check at VU:** `git pull`, restart, `t` on the same card with the stack as it is: the step line now starts `forward:18000:8080`, the step's output shows `okteto up -f okteto.cc-control.yml` and `Forward: 18000 -> 8080`, the port opens, the `okteto exec` step follows, and the UI's proxy answers. If `okteto up -f` objects to the copy (the sync folder, the dev name), paste the message: that is the sibling-copy question below.

**Verified at VU (2026-10-01, evening, one card):** after the fixes above and §57/§57a, `t` brought the whole stack up: the helper, `kubectl apply`, the real `okteto up -f okteto.cc-control.yml` with the sibling copy (the sync folder and the generated dev name kept; the forward on the picked port), `okteto exec … dotnet watch run`, the UI on its own port with the proxy copy pointed at the picked port, and the API calls answering from the page. **Still not verified:** two cards of the same stack at once (the namespace's room for two deployments), and `okteto down` through the stop steps.

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
- **Personal values:** `config.env` already reaches the steps as `%NAME%`; the doctor now lists each `%NAME%` the stack reads (`%KUBECONFIG_{{ENV}}%` expands to one per environment) and whether it is set on this machine, with where to put it. ~~The confirmation *table* with per-field editing from the plan above was not built: the findings list plus the JSON box is the confirmation, and the JSON stays the one editing surface.~~
- **The confirmation table (built later on 2026-10-01, `docs/prompts/continue-after-vu.md`):** the editor's stack tab is now a table, with the JSON a fourth tab after it (`Alt+W` goes repo → workspace → table → JSON; `e` on a card with a stack opens on the table, and so does `e` from `t`'s detect screen). One row per part of the stack: *Asked each time* (`choose`), *Every API* (the template's steps and rule), each API (its container port, its values, the rule it gets with its route filled, and the files the detector read it from: `okteto.yml, *.csproj, SelfController.cs`, with each assumption as a `?` line), and the UI (its port, picked per run or fixed, its steps, its proxy file). `↑` `↓` pick a row, **`e`** opens its fields under it (an API's `name`, `appPort`, `dir`, `health`, `route`, any other value and its own rule as JSON; the template's steps and rule; the UI's repo, steps, proxy file, mode and url; the choices as comma lists), `Enter` keeps them (`Esc` drops them; a rule that isn't JSON says so and stays open), **`Delete`** takes an API out, `Enter` on a row saves the stack, `Esc` cancels. Nothing is saved until Enter. The table and the JSON edit one draft: leaving the JSON parses it into the table (a JSON that doesn't read as a stack stays with the reason), and the table's changes show in the JSON. **Drift:** with a stack saved, the repos are read again when the editor opens and a row whose values differ says `≠ the repos now say appPort 8080` (an API's name, container port, project folder or health route; the UI's serve step or proxy file). The pure parts (`stackRows`, `fieldsOf`, `withField`, `withoutApi` in `web/stack-table.ts`) are unit-tested; the dialog is `xl` wide on the table. Verified in a scripted walkthrough on an isolated server (:7799) with the milestone's real repos and no stack saved; 20 checks passed, screenshots looked at: `e`, `Alt+W` twice to the table with the five rows as above; `e` on loans-api showing its fields, `appPort` changed to 8081 and kept; `Delete` on fees-api; `Alt+W` to the JSON showing 8081 and no fees-api, round the tabs and back with the change kept; `Enter` saving; `e` again opening on the table with *Now: the workspace's, written by you* and the drift line; `t` offering loans-api only; the `?` row. No console errors.

**Verified:**
- Unit tests (271 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the manifest's name (v1 and v2), health routes in their forms and one that isn't guessed, the serve command from `angular.json`, `project.json` and `package.json`, the rule for an API and its template; a workspace of an Angular UI with a proxy file naming two APIs, an okteto API with a `.csproj` and a `[Route("self")]` controller, a `.csproj`-only API with `MapHealthChecks`, and a docs repo, giving the stack above and the findings line by line; dotnet and npm templates, a UI with no proxy file, an API whose rule has another shape, nothing at all; the walk on disk skipping `node_modules`, `.git` and `bin`.
- A scripted walkthrough on an isolated server (:7796) with real git repos of that shape and no stack saved; 14 checks passed, screenshots looked at: the legend offering `t`; `t` showing *Found in your repos* with loans-api's manifest, project, `/self` route and rule, fees-api's assumption (`?`) and its `/health` route, shop-ui's `ng serve` from `angular.json` and the three rules, the `?` lines for the helper step and the environments; `Enter` keeping it, the picker following with both APIs; the Try it section showing the stack; `e` opening the stack tab on the saved JSON with `health`, `dir`, `appPort`, the `{{route}}` template rule and the `ng serve` step, and no two-at-once warning; the `?` row. No console errors.

**Not verified:** detection against VU's real files (the generated manifest, the nx serve target, the real proxy file): built against the shapes in the Okteto and Angular docs and the owner's description. A run of the detected stack wasn't started in the walkthrough (`ng serve` and the real `okteto` aren't here); milestone 2 proved the run mechanics.

**To check at VU:** on a workspace with no stack, `t` on a card: read the findings; what is `?` is what to fix in `e`. Expect: no `okteto.yml` until the helper has run (so fees-api-style assumptions for every API until then; run the helper once by hand, then `t` again and the manifest is read), the helper step to add first in `api.steps`, and the proxy file's rules naming each API. Send back any shape the detector missed (a sanitised `angular.json` serve target, `project.json`, the proxy file's rule, the manifest).

### Milestone 4: Ship per repo
What changes for a user: a card that changed several repos ships each of them. The sheet shows one block per repo (branch, files ticked, host), `Enter` commits, pushes and opens a PR in each from its worktree, in order, stopping at the first failure with the rest untouched. The card lists its PRs; `o` opens the focused one, `↑` `↓` moves between them in the Ship section. `s` again merges every open one after one confirmation naming them. Done when all are merged.

How: `shipPlan` returns a plan per repo that has changes in the card's folders (`card.folders` from §53); `card.ship` takes one request per repo; `card.ship.prs` replaces the single `pr`; each PR's body links the others ("Part of KEY; see also loans-ui PR 12"). GitHub stays on `gh`, Azure DevOps on its REST API (§36). `PROTOCOL` bumps.

What it costs: nothing new to install. Depends on at VU: a real multi-repo PR hasn't been opened from the app; the first one should be on repos the owner picks, asked first as today.

**Built (2026-10-01), as above, with these particulars:**
- **`ShipPlan` is one block per repo** (`repos: RepoShipPlan[]`: repo name, root, branch, the new branch if any, base, host, files, commits ahead, blockers, notes) with one commit message, title and body for all; blockers and notes are named by repo when there are several. The home folder is always a block; another worktree of the card's is one when it has files the card wrote or commits the base doesn't have. The body lists files as `repo/path` when there are several. `ShipRequest` carries `repos: { root, paths }[]`. `PROTOCOL` 19.
- **`ship`** goes through the requested repos in the plan's order: branch if needed, commit the ticked files, push, PR; every step is prefixed with the repo's name; the card is in Ship from the first push; a failure stops there with the repos before it shipped and the rest untouched. Each PR's body is the sheet's text plus a *Part of KEY with …* line: the PRs opened before it linked, the ones after it named ("its PR opens with this one"), since a PR can't link one that doesn't exist yet. A repo whose host cc-control doesn't know is pushed and said to need its PR by hand. The card keeps `ship.prs` (each with its repo and root); `ship.pr` stays only on cards from before, and `prsOf` reads either.
- **`refresh`** looks at every PR; **`merge`** squash-merges each open one in order (named by repo in the steps) and deletes the branch on each remote; Done once all are merged. The poll covers cards with any open PR.
- **The sheet:** a block per repo (its branch and host, its files with the card's ticked, `↑` `↓` `Space` walking through all blocks), the shared commit message and PR text, "Ship 2 repos"; the merge sheet lists every PR (`↑` `↓` picks, `o` opens, `Enter` merges them all). The card's Ship section lists each PR by repo; the tile says "2 PRs · #41 approved · checks passing, #42 …"; `o` opens the first open PR and says the others are in the Ship section; the legend's `s` reads "Merge" while any PR is open. The `?` row and the README say Ship is per repo.
- **After a part-way failure (2026-10-01, `docs/prompts/continue-after-vu.md`):** as first built, `s` again refused ("already has PR #41. s merges it") and a new run wiped the PRs the card had, so a second repo whose push failed could not be shipped from the app. Now: `ship` keeps the card's PRs when it starts, records `ship.left` (the repo it is on and the ones after it) before each repo and clears it at the end, and skips a repo that already has a PR; `plan` marks such a block with its `pr` (no blockers, no "tick" notes, its files out of the body). `shipMode(ship)` in `shared/ship.ts` says what `s` does: `ship`, `rest` (open PRs and repos left) or `merge`. In `rest` the sheet opens as the form titled *Ship the rest*: the shipped block says *Shipped already* with its branch pushed and its PR, the rest keep their files, the sentence and the button name the repos left ("Ship loans-api"), and the PR opened then links the ones from before. The drawer's Ship section shows an amber line ("Stopped before loans-api shipped. Fix what the step below says, then ship the rest; merging waits until every repo has its PR.") with `s`, the action button reads "Ship loans-api" and the legend "Ship the rest"; the merge offer waits until nothing is left. `PROTOCOL` 20.

**Verified:**
- Unit tests (272 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the single-repo tests as before on the new shapes (one block, `prs` the record, `pr` unset), the Azure DevOps host test likewise; a card with two repos (two work folders standing in for its worktrees, two bare origins, a file the card wrote in each and a stray one): two blocks with the right files, the note named by repo, the body's `repo/path` lines, one commit per repo with only the ticked file, both pushed, PR numbers in order, the first PR naming the second and the second linking the first, every step prefixed, a second ship refused ("already has 2 open PRs"), refresh of both, Ship until both are merged, then both branches gone from their origins and the card Done.
- A scripted walkthrough on an isolated server (:7797) with two real git repos, bare origins and a stand-in `gh` (`CC_CONTROL_GH`), a worktree card with a change in each worktree and a stray file in one; 19 checks passed, screenshots looked at: the sheet with a block for shop-ui and one for loans-api, each on the card's branch into main with a PR on GitHub, the card's files ticked and the stray one not, the note named by repo, the body's files by repo, "Ship 2 repos"; `Enter` opening #41 and #42, the Ship section listing both by repo with every step tagged, one commit per worktree with only the ticked file, the stray file untouched, both branches on their origins, the PR bodies linking each other; the tile "2 PRs · …"; `s` again showing "Merge 2 pull requests" with both approved, `Enter` merging both, the card in Done, both branches gone; the `?` row. No console errors.

- The part-way path: a unit test (273 pass) where the second repo's remote goes away after the plan: the push fails with the repo named, the first PR stays, `left` is `['api']`, the API's commit is made; with the remote back, the plan shows the first block with its PR and the second with its commit to push, `ship` again ships only the second (its body linking the first PR), `left` is cleared, and a third `s` is refused as before. A scripted walkthrough on an isolated server (:7799) with the milestone's seed and loans-api's push URL pointed at a missing repo; 22 checks passed, screenshots looked at: the sheet stopping at "loans-api: The push failed", the card in Ship with PR #41 only, the amber line and "Ship loans-api" / "Ship the rest", no merge offered, the commit made but not pushed; with the URL fixed, `s` opening *Ship the rest* with shop-ui *Shipped already* (PR #41) and loans-api's block with only the stray file (unticked) and its commit noted; `Enter` opening #42 with only loans-api steps, the banner gone, "Merge 2 PRs"; the merge sheet listing both; the `?` row. No console errors.

**Not verified:** a real PR on GitHub or Azure DevOps from a multi-repo card (the stand-in `gh` and the stub TFS answered); a failure part-way against a real host (the walkthrough's failure was a push to a missing path).

**To check at VU:** ship a card that changed the UI and one API (TFS): two blocks in the sheet, two PRs on the card linking each other, the Jira ticket named in both. If the second push fails, the first PR should stay on the card, the Ship section says it stopped before that repo shipped, and the button reads "Ship <repo>"; `s` again shows the shipped repo as *Shipped already* and ships only the rest, and the new PR links the first.

### Milestone 5: context added later feeds the run
What changes for a user: anything added with `c` changes what `t` offers. A repo added becomes a worktree (milestone 1) and is detected into the stack (milestone 3) if it is an API or a UI, with its row in the picker. A note naming an API makes the picker flag that API as *named in the ticket*, because the suggestions read the card's added notes too. The packet's *Running the app* says what is runnable now: each API's worktree, the ones added since the start, and the URL pattern the card will get.

What it costs: nothing. No VU dependency.

**Built (2026-10-01):**
- **A repo added with `c` joins the stack** (`addRepoToStack` in `shared/stack-detect.ts`, `joinStack` on the server): after the card has its worktree (milestone 1), the worktree's files are read as milestone 3 reads them, named after the repo itself (not the worktree's folder); an API the stack doesn't have is appended with its values, or it becomes the stack's UI when the stack has none; nothing else changes. The card's log says so ("Added fees-api to the workspace’s stack as an API (from its okteto.yml, *.csproj, Program.cs): t can start it"), and since the picker's rows come from the stack and the card's folders, `t` lists it from the card's worktree at once.
- **Added notes feed the picker:** the text the picker reads for *named in the ticket* now includes the notes and related tickets added since the card started; a repo added is not counted as naming itself (it is in the stack and the card, which the picker sees on its own).
- **The hook's text says what is runnable:** a repo added later that the stack can start gets "Try it (t on the card) starts it from there; don’t start it yourself" after its worktree line (`laterText` with the card's runnable repos, from the workspace's stack).
- The `?` row for `c` and the README say so.

**Verified:**
- Unit tests (272 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): `addRepoToStack` (an API already there, a new API with its values and the files it was read from, nothing to go on, a UI when the stack has none, not when it has one); `joinStack` against a saved stack, once, with no stack, and from a worktree folder named after the repo; `laterText` with runnable repos.
- A scripted walkthrough on an isolated server (:7798) with a Demo workspace of a UI and one API whose detected stack was saved, a third API only in the library, and a worktree card; 8 checks passed, screenshots looked at: the picker before (loans-api only); `c` adding fees-api from the library, its worktree made and the log line that it joined the stack; `t` listing fees-api from its worktree ("in context, unchanged") beside loans-api; a note "Also touches fees-api when rounding" added with `c`, after which `t` suggests fees-api ("named in the ticket"); the stack editor showing fees-api with its `/health` route; the `?` row. No console errors.

**To check at VU:** on a card in flight, `c` an API repo from the library: its worktree appears, the card's log says it joined the stack, and `t` lists it. Then a note naming another API, and `t` ticks it.

### Order and what each depends on
1 → 2 → 3 → 4 → 5 as the owner suggested. 2 defines the port placeholders that 3's detection fills, so 2 goes before 3. 4 needs only §53's folders and could be done any time after 1. 5 is small once 1 and 3 exist.

### Verification, each milestone
`pnpm typecheck`, `pnpm test`, `tsc --noUnusedLocals`, unit tests for the pure parts (worktree planning, port picking, placeholder filling, manifest rewriting, detection against sample files, per-repo ship plans), and a scripted Playwright walkthrough on an isolated server with screenshots looked at. The real Okteto, kubectl, nx and the team's command are only at VU: each milestone's section ends with *To check at VU*, and the stack docs say what was tried against stand-ins.

**Status:** plan agreed with the owner 2026-10-01 (order as above; the trust setting yes). All five milestones built and verified against stand-ins 2026-10-01. What's next is each milestone's *To check at VU* list, in order; what the owner sends back from there decides the follow-ups (the Okteto manifest shapes, the real helper step, a real multi-repo PR).

## 55. Overview: Claude said only when the transcript is not beside it

2026-10-01, the owner: with the drawer wide enough for two columns, the live Transcript on the right already shows Claude's last message, so the Overview's *Claude said* section repeated it. It now shows only when the drawer is one column (a narrow window, the phone), where it is the only place that message appears. Checked in the §54 milestone 4 walkthrough: absent at 1400px, present at 800px.

## 56. Changes across every repo the card works in

2026-10-01, the owner, smoke-testing §54 at VU: "make sure the overview of a card shows all changes for all repos that have been effected in the card". §47's Changes asked git in the card's home folder only, so an API worktree's edits were invisible until the Ship sheet; the Overview's *What changed* listed them, but as full Windows paths (`shortPath` knew only the home folder).

**What it does.**
- **The Overview's *What changed*** names a file in another repo of the card by that repo: `loans-api/Fees.cs` (the repo's name, not the worktree folder's); the home repo's files stay relative. `shortPath(path, cwd, folders)` in `web/line-model.ts`.
- **`Shift+D`** lists every repo the card works in: its home folder, each worktree of its (`ownFolders`), and any other repo of the card it wrote a file in (a *Current branch* card with two repos edits the second in place). With several, a header per repo says its name and what its diff is against (`shop-155 against main, 1 commit already on the branch`, or `nothing changed here` for an untouched worktree); the first line counts files and lines across them (`5 files · +6 −2 · in 3 repos: shop-ui, loans-api, docs-site (nothing)`); `↑ ↓` move across the repos; the diff pane is headed `repo/path`. One repo looks as before.

**How.** `Changes` is now `{ repos: RepoChanges[] }` (`shared/changes.ts`; `changeRows`, `changeTotals`, `againstText` are the pure parts, tested). `ShipService.changes` walks the folders in the card's order, reads each once by its git root, skips a folder that isn't a git repo (only the home one is allowed to fail), and runs §47's diff per folder (`changesIn`). `PROTOCOL` 21.

**Verified:** unit tests (279 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the rows, totals and wording; `shortPath` with worktrees; `changes` against three real repos as a worktree card (the home with a commit on the branch and an uncommitted edit, the API worktree with a new file, the docs worktree clean, a plain folder skipped) and as a Current-branch card that edited its second repo in place (read once; not read when nothing was written there). A scripted walkthrough on an isolated server (:7801) with the three worktrees; 12 checks passed, screenshots looked at: the Overview's four files with the API's as `loans-api/…`; `Shift+D` with the three headers, `5 files · +6 −2 · in 3 repos`, the card's files first in each repo, `↓` into the API's rows with the pane headed `loans-api/Rounding.cs`, `↓` stopping at the last file; the `?` row. No console errors.

**To check at VU:** `Shift+D` on a card that touched the UI and an API: a header per repo, the API's files under its own, and *nothing changed here* for a repo Claude left alone. The Overview's *What changed* should read `repo/path` for the API's files.

## 57. The UI's URL is the served app's own: its port and path from its project file

2026-10-01, the owner, second VU handoff: with §54's forward fix the whole stack came up, but Try it said *Running at http://localhost:4200* while the app serves at `localhost:4216/ap-summary/{loan-guid}`. The UI repo is an nx workspace of several standalone apps (one `apps/<name>/project.json` each, each with its own serve port and baseHref); the stack's step serves one of them (`nx serve deny-withdraw`), and `ui.url` had been written by hand from the example (4200). The run's URL from the app's own output didn't correct it either: the step went *up* on its port-poll or quiet timer before nx printed its address, and a URL printed after that is ignored.

**What it does.**
- **`ui.path`** in the stack: where the app lives on its server (`/ap-summary/`), put after the port. A field on the table's UI row; detection fills it from the served app's build `baseHref` when it isn't `/`.
- **No `ui.url`: the URL is worked out.** The port picked for the run (`{{uiPort}}`), else a `--port` in the UI's steps, else the served app's own `serve.options.port` from its project file, read when the run is prepared; then `ui.path`, else the app's baseHref. Nothing says the port: no URL up front, and the address the app prints is used as before (so a UI that picks its own port isn't told it is on 4200). A written `ui.url` still wins; `ui.path` goes after it when it has no path of its own.
- **The served app is known by name.** `uiProject(steps)` reads `nx serve X`, `nx run X:serve` or `ng serve X`; `uiApp(repo, name)` finds that app among the repo's project files (angular.json's projects with a serve target, then every `project.json` with one, so an nx workspace's `apps/*` are all seen). The Try it title and the board's tile name it with its port: *dev · loans-api :18000 · deny-withdraw :4216*.
- **Detection** (`uiApps`) lists every app; the first serves (angular.json's default project first), the others are a `?` finding: *the repo can also serve payoff: to start one of those instead, name it in the serve step*. The serve finding says the app's own port; a baseHref gets its own line. The table's UI row says when the saved path differs from the repo's.
- `repoFiles` moved to `server/repo-files.ts` so `prepareStackRun` can read the UI repo without importing the detector back.

**From the real files (the owner pasted the UI repo's shape the same evening):** an nx 21 workspace with no `angular.json` and 34 projects under `apps/`, each `project.json` with `serve.options.port` (deny-withdraw 4220, app-summary 4216), `build.options.baseHref` `/<app>/`, and the proxy file under `serve.configurations.development.proxyConfig` with `defaultConfiguration: development`, not under `options`. So: `serveOpts` reads the default configuration on top of the options; the *others* finding is cut at eight names. And the saved stack's `ui.url` was `http://localhost:4200` from the example with no `--port` on the step, so **a plain localhost url on a port the steps don't set loses to the served app's project file** (`staleUrl`): the owner changes nothing, and Try it says `http://localhost:4220/deny-withdraw/`, titled *deny-withdraw :4220*. (The `4216/ap-summary` in the handoff was app-summary's; this card serves deny-withdraw.) A url with a path of its own, or a step with `--port`, is left alone. Tested with those shapes in the unit and server tests.

**Resolved the same evening:** the owner starts app-summary themselves (`nx.cmd run app-summary:serve:development`), which hosts the deny-withdraw work; the stack's UI step should name app-summary, and the pushed code then gives `http://localhost:4216/app-summary/`. `uiProject` reads the `run X:serve:development` form.

**Not built yet, pending the owner's say (other standalone apps can be run too; app-summary first):** a *which app* choice in the picker, with the step, port and path following it. The pieces are in place (`uiApps`, `uiApp`), and `choose` with `{{app}}` in the step would carry it; built once the real project files say whether the port and path sit in `serve.options` / `build.options.baseHref` or elsewhere (a configuration, a route file).

**Verified:** unit tests (280 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): `uiUrlFor` in each case (no url and nothing known: none; `--port`; `{{uiPort}}`; the project file's port and baseHref; `ui.path` over the baseHref; a url with a path keeps it), `uiPortFor`, `uiProject` on the real step shape (`node_modules\.bin\nx.cmd serve deny-withdraw --proxyConfig=…`), `withPath`, `ui.path` validated; `uiApps` / `uiApp` / `uiServe` on an nx workspace of two apps and a lib (port 4216, `/ap-summary/`, the other app said), angular.json's `/` baseHref as no path; `prepareStackRun` against a real folder of that shape with no url: `http://localhost:4216/ap-summary/` and the title *dev · orders-api :18441 · deny-withdraw :4216*, the other app by name, a written `{{uiPort}}` url with `ui.path` after it; the table's new field. **No screenshot walkthrough:** the only page change is the field on the UI row and the words on the title the server already sent; the run mechanics are the server tests above.

**To check at VU:** `git pull`, restart, and change the UI step to `node_modules\.bin\nx.cmd run app-summary:serve:development --proxyConfig={{proxy}}`. `t`: the title should read *dev · … · app-summary :4216*, Try it *Running at http://localhost:4216/app-summary/* and `o` opens there (add the loan guid by hand). If nx rejects `--proxyConfig` on the `run` form, say so. If the port or path is wrong, say what the address bar shows.

## 57a. A proxy rule written with the container port follows the picked port

2026-10-01, the owner, third VU handoff: the UI came up on 4216 and the API step showed *up*, but the UI's calls to the API got a 504. The stack's API had two rules of its own (`/azure-gateway/moa/v2/…/**`, `/deny-withdraw/api/**`) with `target: http://localhost:8080` as a literal, written before §54 milestone 2 picked a port per run; the API now answers on the picked port (the `wait:http:` on it is what showed *up*), and the dev server's proxy still went to 8080, where nothing listens.

**What it does.** `stackRules` runs every rule of a picked API through `retarget`: a target or any other string that starts `http://localhost:<appPort>` (or `127.0.0.1`; the API's container port, `appPort` or the old `port` value) becomes the port picked for the run. Only that exact port is touched: a rule on another port, the UI's own `Origin` header, and shared `https://` targets stay as written. With no port picked (a run outside a pool), the rules are as written. Nothing to change in the stack; the amber list already says to call the old `port` value `appPort`.

**Verified:** unit tests (284 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the owner's stack shape (values `port: 8080`, two literal `localhost:8080` rules, one on 8081, one shared with a 4200 `Origin`): both 8080 targets on the picked port, the others untouched; no port picked: as written; `80800` not taken for `8080`.

**To check at VU:** `git pull`, restart, `t` again. The proxy copy under `~/.cc-control/runs/<id>.proxy.conf.json` should show both deny-withdraw rules on `http://localhost:18000` (the picked port), and the API calls answer. If a 504 stays, open that copy and say which rule the failing request matched.

## 58. A card whose ticket has moved past the work goes to Done on its own

2026-10-01, the owner, at VU: "if a jira card is already in ready for po or done, it should go to the done column on the app". VU's workflow ends *… → Ready for QA → Ready for PO → Done*; the card followed its session and its PR, never its ticket, and the Inbox's JQL (`statusCategory != Done`) never brought a finished ticket back, so a card whose ticket someone else moved on sat in Try it or Ship for good.

**What it does.** Every ticket refresh (at start, then every five minutes while Jira or Trello is connected) also fetches the ticket of every card not yet Done, by key (`key in (…)` in batches of fifty, only Jira-shaped keys, a failed batch skipped until next time), on top of what the Inbox views brought. Each card's ticket as it is now is handed to the cards: the status is kept on the card's ticket (the Overview's *Where it runs* row shows it), and when it has moved past the work the card goes to Done with the tile saying why (*Ready for PO in Jira: done*). A card already Done, or whose ticket is as it was, is left alone. A demo ticket moved with `m` does the same at once.

**What counts as past the work:** Jira's done category, or a status named in `CC_CONTROL_DONE_STATUSES` (comma-separated; default *Done, Ready for PO*; any case). `finishesCard` / `doneStatuses` in `shared/tickets.ts`, the list in `config.env.example` and the README. Nothing is written to Jira.

**How.** `TicketService.followCards({ keys, moved })` (`server/tickets.ts`: `fetchFollowed`, `tellCards`), wired in `server/index.ts` to `CardService.ticketMoved(ticket, finished)`. Followed tickets are not put in the Inbox.

**Verified:** unit tests (283 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the rule (category, the names, a list of your own, the default); `ticketMoved` (nothing changed: nothing saved; a status short of done kept on the card with the card where it was; *Ready for PO* taking it to Done with the tile text; a Done card and an unknown key left alone); the service against a local Jira-shaped server (the Inbox view brings one ticket, the follow-up asks `key in (WS-7, WS-9)` for the rest and skips a key that isn't one; all three handed back; followed ones not in the Inbox); a demo move handed back at once. **No screenshot walkthrough:** nothing on the page changed; the card's stage is what the board already shows.

**To check at VU:** with a card whose ticket is in *Ready for PO* or *Done*, restart (the first refresh runs at start) or press `R` in `Shift+T`: the card should be in Done with *Ready for PO in Jira: done* on its tile. Move a card's ticket to *Ready for QA* in Jira: within five minutes the card's ticket row says so and the card stays where it was. If your workflow finishes elsewhere (*Accepted*, say), put it in `CC_CONTROL_DONE_STATUSES`.

## 59. The simple look of the new-card screen

2026-10-01, the owner, walking through a redesign of the whole app one screen at a time, starting with the screen that starts a session: strip it back to what a person needs to read top to bottom, keep the full three-panel screen for when every option should be in view. This section is built in pieces, each its own commit.

### The machine's folder picker (built first: the screen uses it)

The simple look adds folders from disk as context (a spec folder, a tool's output). A browser can't hand a page the path of a folder the user picks, but the server runs on the same machine, so it opens the picker itself: `server/pick-folder.ts` runs a few lines of C# through a PowerShell STA process that calls `IFileOpenDialog` with `FOS_PICKFOLDERS` (the modern *Select Folder* window Explorer and editors use), owned by the foreground window so it opens over the browser, and answers with the path; Cancel answers with nothing. Protocol: `fs.pickFolder` (page → server, with a `reqId`) and `fs.picked` (the path, or none); `pickFolderOnDisk` in `web/ws.ts` waits as long as the dialog is open (ten minutes). Elsewhere than Windows the request fails with a plain message and the path can still be typed.

**Verified:** by hand once, the picker opened over the browser and the path came back into the card. Playwright can't drive a native window, so the walkthroughs type paths instead.

### The simple look

Direction A of the owner's redesign walk-through: one column, read top to bottom, as a popup over the board (the board stays behind it; a click outside keeps the half-built card for `c`). Built beside the full three-panel screen, not in its place: `Settings.newCardLook` (`simple`, the default, or `full`) picks, `Shift+L` on the screen switches and the `?` `B` dialog has the row. Both looks edit the same `Composer`, so switching loses nothing. Adding context to a running card (`c` with a card open) always uses the full screen, which knows that job.

**What it shows,** top to bottom (`↑ ↓` or `Tab` move between the blocks; the focused block carries a one-pixel accent border, `blk-focus`, never its heading):
- **Kind** as a segmented control in the header: Develop, QA, Code review (`k` cycles it from anywhere).
- **Ticket:** the card's ticket (key, status, source, title, three lines of description, counts of criteria, comments and links) with *Change ticket* (`Enter`), a single pick that takes the old ticket's place with its description and criteria; `x` takes it off. With no ticket, the block is the search box itself, its list opening under it (Jira is searched too); a title can be typed instead.
- **What Claude can see** as chips: the lane's repos (`Enter` includes or leaves one out), this card's repos and folders and its related tickets (`x` takes one out, `w` keeps a repo for the lane), then *+ Context*.
- **Your note**, a two-line box (`e` or `Enter` to write).
- **Session settings:** a read-only list of lane, the repo it starts in, branch, first step, model, opening message and where it runs, each with a note on what it means (`howFacts`); *Change* (`Enter`) opens the option rows behind it (`← →` change, `Enter` or *Done* closes). A Develop card here always works in a worktree of each repo, so there is no branch row for it (`develop()` sets it; the full look keeps the older choices).
- **Start work** (`Ctrl+Enter` anywhere, or `Enter` on the button); `p` previews exactly what Claude gets.

**The Add context popup** (`+` or `a` on the chips, or the *+ Context* chip): Repos (the library; `Enter` adds one and keeps the list open, on one already ticked takes it out), Folders (ones from disk: type or paste a path and `Enter`, or `b` browses in the Windows picker above; `Enter` on one listed leaves it out or brings it back, `x` takes it off) and Tickets (related ones; Jira is searched too). `← →` or `Tab` switch tabs, `/` focuses the search, `Esc` or *Done* closes. Everything added is on the card already. The popup is `role="group"`, not a dialog: the app's own keys drive it.

**Keycaps** on the screen are few (`Esc`, `Ctrl Enter`, `?`); the legend bar (`simpleLegend` in `web/legend.ts`) says the keys for where you are, and `?` has a *New card (simple look)* section beside the full look's.

**How.** `web/components/NewCardSimple.tsx` (the page), `web/simple-model.ts` (the little state the column needs: block, chip, picker, options open; `chips`, `howRows`, `howFacts`), `web/simple-keys.ts` (every key; `line-keys.ts` hands the key over while the setting says simple). The composer's `simple` field holds that state. `openComposer` starts in the ticket search for the simple look.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (284), and five scripted Playwright walkthroughs on an isolated server (`docs/walkthroughs/simple-new-card/`: the column and its keys, the Add context popup on each tab, folders typed in, Change ticket, the slim chrome), with screenshots looked at. They expect a server on :7802 seeded the way `walk-simple.cjs` seeds it: a Demo lane of `%TEMP%\cc-demo\web-app` and `payments-api`, the library pointed at `%TEMP%\cc-demo`, demo tickets on, `SHOP` mapped to the lane. Run them after any change to the screen.

**Lessons:** anything inside `role="dialog"` swallows keys, so popups the app's keys drive are `role="group"`; the legend bar keys its nodes by label, so two items with one label leave a stale keycap; a walkthrough pressing `Ctrl+Enter` inside the full look's folder dialog once started a real card, so tests add folders by typing a path into the simple look's Folders tab.

**Next:** the popup should use the page (a wide two-column layout), and *Your note* becomes an opening message picked from saved prompts that fill in the context (`docs/prompts/continue-opening-prompts.md`).

## 60. Slim chrome behind one switch

2026-10-01, the owner, the same redesign: while the screens are stripped back, the frame around them should be quiet too, but nothing should be lost. Every hidden part is still built and still driven by its keys, so any of them comes back by flipping a flag.

**What it does.** `web/slim.ts` holds `SLIM`, five flags, all on: the bottom bar of keycaps (`legend`), the `/` filter box on the line's bar (`filter`), the Tickets and New card buttons there (`lineButtons`; `Shift+T` and `c` still work), the lane's repos row under the bar (`workspaceBar`; `+ − E Shift+E Shift+I F` still work) and the header's Search button (`search`; `Ctrl+K` still works). The legend is still computed and tested (`lineLegendFor`), just not drawn. `?` lists every key as before.

Alongside it, three small things on the same screens:
- The header's breadcrumb reads *Sessions*, with no lane badge beside it: the board is where sessions are managed, and the lane chips on the line's bar already say which one is showing.
- The Inbox column's note reads like the other columns': *Your tickets* or *Ready for QA in your projects*, with the other view as a quiet link (`v` switches), instead of two chips.
- The `?` overlay has a switch for the shortcut hints on the page (`H` there): on or off. *On hover* stays as a choice in `?` `B` (`cycleHints` is still what the dialog uses); `toggleHints` in `web/keys.ts` goes always ↔ never. The overlay itself always keeps its keycaps.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (284; the legend tests still run on the computed bar), and the `walk-chrome.cjs` walkthrough in `docs/walkthroughs/simple-new-card/`: the bar without its buttons and filter, no legend, no repos row, the Inbox note, the `?` switch.

## 61. Lanes

2026-10-01, the owner: a "workspace" is a lane on the board, a named group of repos whose cards share them. Every visible *Workspace* now reads *Lane*: the line's bar and its `W` button, the `?` sections and rows, the legend, the lane dialogs (new, edit, delete, which one), the palette, the recipe editor's tabs, the Tickets dialog's mapping, the new-card screen's layer and messages, the Ship sheet, the card's Context tab, the Welcome screen, and the flash messages.

**Prose only.** Identifiers, message types (`workspace.save`, `workspace.addRepo`, …), setting ids, `Settings`, the SQLite tables and the shared workspace file format are unchanged, so nothing on disk changes and an older page or server still talks to a newer one. A blanket rename across the code broke identifiers once; a pass over string literals with a space in them and JSX text was the safe shape. Two test expectations changed with the words (`legend.test.ts`, `line-model.test.ts`).

**Not renamed, pending the owner's say:** the hook text Claude receives still says *Workspace notes* (shared code in the delivered context; a card started before and after the change would otherwise read differently).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (284).

## 62. The opening message from saved prompts, in a popup that uses the page

2026-10-01, the owner (`docs/prompts/continue-opening-prompts.md`): the simple look's popup sat in a 760px column with most of the panel empty; and the note box was the wrong thing to write first. "I usually write a prompt … like *Please review {jira card(s)} and take that into context, you'll likely need {repo}, {repo} and extracted business logic from {folder}* … these prompts should include the context we provide during the intake of a new session and be something that is editable … select prompts from a dropdown (or freeform input text for that opening message)."

### The popup uses the page
Inset 16px on every side, the content up to 1480px wide. Two columns at a wide window: the ticket and *What Claude can see* on the left, the opening message and the session settings on the right; one column under about 1100px (`min-[1100px]:grid-cols-2`). `↑ ↓` follow the reading order either way: ticket → context → message → settings → Start. The full look is untouched.

### The opening message
*Your note* is gone from the simple look (the full look keeps `packet.note`, the hook's *From you*). In its place, **Opening message**: the first thing Claude is told (`launch.message`, the prompt argument to `claude`; the context itself still arrives through the SessionStart hook). A box of nine lines with a dropdown above it:
- **The dropdown** (`Space`, or the button): *Write your own*, then the saved prompts, the ones for this kind of card first, then the ones for any kind, then the rest, each group by name (`promptsFor`). `↑ ↓ Enter`, `Esc`. It opens on the prompt in use.
- **A prompt picked** is rendered with the placeholders filled from the card as it stands and put in the box, and **follows the card**: add a repo, swap the ticket, type a folder path, and an unedited prompt is rendered again (`followPrompt`, run from the screen whenever the card changes), so the message always matches what was picked. The line under the box says what was filled in and what the card has nothing for yet (*nothing yet for {{folders}}*).
- **Editing the text detaches it**: the button then says *Edited from: Review and plan* and the text stays as typed whatever changes; picking the prompt again renders it afresh. *Write your own* leaves the text alone and stops any following. A prompt deleted while in use leaves its text behind as the card's own. With no prompt picked the message is the old default (*Plan SHOP-155.*), as before.
- **`s`, Save as a prompt:** the text becomes a new prompt, with what the card filled in put back as placeholders (`unrenderPrompt`: longest values first, so one repo becomes `{{repos}}` rather than `{{home}}` and one ticket `{{tickets}}`), opened in the editor to name. Picking it then renders back to the same text.
- **The preview** (`p`) shows the opening message above the hook's text.

### Placeholders
`{{ticket}}` (key and title), `{{tickets}}` (the card's ticket, then the related ones, as a list), `{{repos}}` (names, the one it starts in first; folders from disk are not repos), `{{home}}`, `{{folders}}` (paths), `{{lane}}`, `{{branch}}` (the card's branch name; a QA or review card on a PR's branch names that), `{{kind}}` (Develop / QA / Code review). Case and spaces inside the braces are forgiven. An empty or unknown one renders to nothing and is named (`missing`, `unknown`); **a line whose placeholders all came out empty is left out**, so *Extracted business logic is in {{folders}}.* disappears from a card with no folders instead of leaving a stub. The leftovers of a removed placeholder are tidied (doubled spaces, a space before punctuation, empty brackets). `shared/prompts.ts`: `renderPrompt(template, context)`, `fillers`, `placeholdersIn`, `unrenderPrompt`, `promptsFor`, `PLACEHOLDERS`; the context comes from the composer the way the settings list reads it (`promptContext` in `web/simple-model.ts`).

The message is flattened to one line and capped (6000 characters now, was 1000) where the card is started: it goes to `claude` as an argument.

### Saved prompts
On the server, SQLite `prompts` (`server/store.ts`: `loadPrompts`, `savePrompt`, `deletePrompt`), like settings and workspaces; shared through the lane file later if wanted. `SavedPrompt { id, name, body, kind?: 'build' | 'qa' | 'review', updatedAt }`; no history yet (versioning is after the MVP). Protocol 22: `prompts` (server → page, with `hello` and on change), `prompt.save`, `prompt.delete`; `cleanPrompt` on the server (a name, a body up to 8000 characters, a known kind or none). **Three defaults** are written the first time the store opens (`DEFAULT_PROMPTS`, `prompts.seeded` in `meta`), so they are editable and deletable like any other: *Review and plan* (Develop), *Fix a bug* (Develop), *QA this change* (QA); each uses the placeholders, puts the optional context on its own line, and says the worktree is already made (the card makes it; Claude must not create branches or worktrees itself).

**Editing** (`Shift+E` on the screen, or *Edit prompts*): `web/components/PromptsDialog.tsx`. The list (`↑ ↓`, `n` new, `e` or `Enter` edit, `Delete` twice removes, `Esc`); the editor (name, *offered first for* kind, the body in a mono box, with the placeholder list beside it, each a button that appends it, and a live example rendered from the card that is open; `Ctrl+Enter` saves, `Esc` back). The dialog is in `INPUT_DIALOGS`, so Esc closes it even when focus has fallen out of it.

**Keys:** `Enter` or `e` write, `Space` pick a prompt, `s` save as a prompt, `Shift+E` the prompts; rows in `?` (*New card (simple look)*), the legend bar for the message block and the open list (`simpleLegend`; hidden by `SLIM` but computed and tested). The screen's keycaps are still Esc, Ctrl+Enter and `?` only.

### Have Claude write it
The owner's yes, the same evening. `w` on the message (or the button): the rough words in the box plus the card's context go to a cheap model for one turn and its answer replaces the text, as the card's own (*Your own*), ready to edit. `server/write-prompt.ts`: `query()` from the Agent SDK with `maxTurns: 1`, `tools: []`, `persistSession: false` (no transcript under `~/.claude/projects`), a custom `systemPrompt` (write the message itself in the second person, keep every fact, add nothing the notes and context don't support, name no system or tracker they don't mention, say once that the worktree is already made) and **`settingSources: []` from the temp folder**, so no `settings.json` and no CLAUDE.md is read: the first try without that answered with the name of a Trello board from the owner's own global CLAUDE.md. The model is `CC_CONTROL_WRITE_MODEL`, default `claude-haiku-4-5-20251001`. `writeInstructions(rough, context)` is the one user turn (the notes verbatim, then the context as facts, leaving out what the card has nothing for; pure, tested). Protocol: `prompt.write { reqId, text, context }` → `prompt.written { reqId, text }`; `cleanContext` on the server keeps short strings and lists only. The box is read-only while it writes (`simple.writing`); the rough text stays if the answer doesn't come. Flash messages say what is happening; the request waits up to ninety seconds.

**Verified:** `walk-write.cjs` (run by hand, not part of the regression set: it spends a model turn): `w` on an empty box says to write rough words first; with rough words the button reads *Claude is writing…*, the answer came back in 7–11 seconds, replaced the text, kept the ticket, the API repo and the checkout constraint, named nothing from this machine's settings, and the dropdown says *Your own*. Screenshot looked at.

Versioning: `updatedAt` is kept, nothing else.

**Verified:** unit tests (294 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): the renderer (every placeholder, lists inline, case and spaces, an empty one named and its line dropped, an unknown one reported, the tidying, the ordering by kind, the defaults against a full card, unrender and its tie-breaks); the store (the three defaults written once and kept across a reopen with an edit and a delete; order kept, a new one last). Six Playwright walkthroughs on an isolated server (`docs/walkthroughs/simple-new-card/`, screenshots looked at): `walk-prompts.cjs` is the new one (the inset and the two columns; the list, Develop prompts first; the prompt filled with the ticket, the repos home first, the branch, no folders line; a repo added and a folder typed in and the message following; an edit detaching and holding through a context change; picking again; `s` with the placeholders back and the example beside it; the saved prompt listed, picked and rendering back; `Shift+E`, Delete twice, `e`, Esc; the deleted prompt's text left as the card's own; the `?` rows; one column at 1000px; nothing started). The screenshots also caught what the checks did not: the context picker was rendering over the prompt list (fixed, and a check added). The other five still pass (`walk-simple.cjs` now types the message instead of the note).

**To check at VU:** `git pull`, restart (the store seeds the three prompts on open), `c`: `Space` on the message, pick *Review and plan* with a real ticket and the lane's repos; add a folder through `+` → Folders; read what it rendered before `Ctrl+Enter`. Whether the defaults' wording fits how you brief Claude there is the thing to judge; edit them with `Shift+E`.

## 63. The way back out of an open card

2026-10-01, the owner: "I keep intuitively looking for a back button on the top left of the page that will take us out of a full card view after clicking on one that's already been created." The only way out was *Back to the board · Esc* at the far right of the card's own header, and the app's breadcrumb still read *Sessions* as if nothing were open.

**What it does.**
- **The breadcrumb is honest.** With a card open the top left reads *Sessions / SHOP-155 Save cart…* (the ticket badge and the title), and *Sessions* is the way back, as it already was with a session full screen; a session full screen shows its title there too (`Header` in `web/App.tsx`).
- **A back button at the top left of the card** (`←` with the `Esc` keycap, before the lane badge), in place of the text on the right. Same key, where the eye looks.
- **The browser's own back and forward follow the app** (`web/history.ts`, started from `main.tsx`): the board, a card open on it and a session full screen are places. Opening a card pushes a history entry, so Alt+←, a mouse's back button and the browser's arrow close it the way Esc does, and forward reopens it. Esc, the breadcrumb and the button go *back* in history rather than adding an entry, so nothing piles up; `←` `→` through neighbouring cards and `Ctrl+K` to another session replace the top entry; a session opened from a card is one level deeper (home from it goes back two). Dialogs, tabs and the new-card screen are not in history. `plan(stack, to)` is the pure part: none, back by n, push, or replace.

**Verified:** unit tests (300 pass; `pnpm typecheck` and `tsc --noUnusedLocals` clean): `spotOf` and `plan` (push, Esc back one, a sibling replaces, a session from a card a level deeper and home two back, a session straight from the board then a card replacing it). `walk-back.cjs` on the isolated server with a seeded card (screenshots looked at): the breadcrumb on the board and with the card open; the button at the top left and the old text gone; browser back closes and forward reopens; the breadcrumb's *Sessions* closes and forward still reopens (history in step); the button and Esc close; forward after Esc reopens (Esc went back, not forward). Back from the board's own entry leaves the page, as on any site.

## 64. The lane dialog picks repos the + Context way

2026-10-01, the owner, with a screenshot of the Add context popup: "the selected repo's border here looks bad; also I checked the create new lane popup and didn't see the new +context standard placed there, still looked like the old way to select context to attach to the lane."

**What it does.**
- **The highlighted row** in the Add context popup and the saved-prompts list uses the app's own focused-row style (`is-focus`: the ring and halo every other list has) instead of a one-pixel ring that clipped at the row's rounded corners.
- **The lane dialog's repos are chips**, like *What Claude can see* on the new-card screen: each repo as a chip with *home* on the one new sessions start in (*make home* on the others) and `×`; `← →` along them, `x` takes one out, `h` makes it home. **`+ Repo`** (`Enter`, `Space` or `+` on the row, or the chip) opens a popup in the Add context shape: a title, *Repos* and *Library folders* tabs, a search box, rows with ticks (`↑ ↓`, `Enter` ticks one and keeps the list open, on one already ticked takes it out; `h` makes it home), the footer line and *Done*. *Library folders* holds the folder picker that used to sit behind an underlined link: the folders the library scans; a folder added switches back to *Repos* with its repos listed. `← →` or `Tab` switch tabs; `Esc` closes the popup and puts the keyboard back on the chips; `Esc` again cancels the dialog. A new lane with no library yet opens on *Library folders*. The dialog's key footer and the `?` row say so.

**Not shared yet:** the popup is its own markup inside `WorkspaceDialog` (the new-card one is bound to the composer); the two look the same by construction. Worth one component when a third place needs it.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (300). `walk-lane.cjs` on the isolated server (screenshots looked at): `W`, the chips row with only *+ Repo*, `Enter` opens the popup with its two tabs, typing then `Enter` ticks web-app and the list stays open, a second repo ticked and marked *in the lane*, `Esc` closes the popup not the dialog, two chips with web-app home, `h` moves home, `x` takes one out, `Enter` from the name saves and shows the lane, `Shift+Delete` then `y` removes it. `walk-context.cjs` still passes with the new row style.

## 65. Another folder of repos, for one card only

2026-10-01, the owner (`docs/prompts/continue-context-sources.md`): the Add context popup should "support the ability to add more sources to pick repos from (not adding them directly to the lane though, would just be for this card/session)". The Repos tab listed only the repo library, and the only way to list another folder's repos was `F` on the board, which adds the folder to the library for every lane and card.

**What it does.** On the Repos tab, a last row *+ Another folder of repos…* (`Enter` on it), `b`, or a folder path pasted into the search box and `Enter` (the row then reads *Scan D:\side for repos*): the folder is scanned on the server and its git repos are listed under a heading with the folder's path, after the library's. Nothing is saved: not to the library, not to the lane. `Enter` on one of its repos adds it to the card like any library repo (`toggleSource`); its chip's sub names the folder (*side-api · cc-extra*), so it is clear where it came from. `x` on the heading (or its `×`) takes the folder and its unpicked repos off the list; the repos picked from it stay on the card, still naming the folder. A folder with no git repos in it is refused with a pointer to the Folders tab (that tab is for a folder Claude should read, not a place to find repos); a folder already listed, or the library's own, is refused with a line saying so. The search filters every group; a heading goes while nothing under it matches. The Folders tab does not list a repo picked this way. The draft keeps the folders (`c` picks them up); the started card does not need them (its repos are in the packet already).

**The lane dialog's popup (§64) does not get this:** a lane's repos are the library's by design.

**How.** Protocol 23: `library.peek { reqId, path }` → `library.peeked { reqId, source, repos }` (`peekSource` in `server/repo-library.ts`: `cleanSources`' checks for a real, absolute folder, then `scanSources`; nothing written). `Composer.sources?: RepoSource[]` (`{ path, repos, hidden? }` in `web/line-model.ts`): `addSource`, `removeSource` (keeps a hidden entry of the picked repos behind the chips), `sourceOf`, `looksLikePath`, `sourceRows` (the grouped rows: the library's repos, each source's under a `source` row, then `more`); `sources()` is the same list flat, for the full look. `pickerList` / `pickAt` in `web/simple-keys.ts` follow the rows (`PickerRow.role`), `addTypedSource`, `browseRepoSource`, `addRepoSource`. `chips` in `web/simple-model.ts` names the folder; `cardFolders` leaves these repos out.

**Keys:** `b` (Repos tab), `Enter` on the last row or on a path in the box, `x` on a heading. Rows in `?` (*New card (simple look)*, `b (Repos tab)`), the legend for the Repos tab (`b` always, `x` on a heading; hidden by `SLIM` but computed and tested), the popup's footer line.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (302): the grouped rows, the search over every group, a path in the box filtering nothing, dedup against the list and the library, an empty folder refused, a repo from a source being a card repo and not a folder, taking the source off with the picked repo kept and still naming it, the folder back again, the legend; the server's peek against a temp folder with two fake repos, one without, a missing one and a relative path. `walk-sources.cjs` on the isolated server (two `git init`ed repos under `%TEMP%\cc-extra`, added by pasting the path; screenshots looked at): the refusal for a folder with no repos, the heading and its repos with the highlight on the first, the flash with the count, the duplicate refused, the repo picked and its chip naming the folder, the search over both groups, the Folders tab without it, `x` on the heading with the chip kept, `c` picking the card up, the `?` row, nothing started. The other eight walkthroughs still pass. The walkthrough found two real bugs first: the count flash overwrote a refusal's message, and a typed path reset the highlight (now the walkthrough moves to the row by index; the highlight after an add lands on the folder's first repo).

**Not done:** the Windows picker (`b`) was not driven (Playwright can't); it is the same `fs.pickFolder` path the Folders tab uses.

## 66. The preview reads in the order Claude gets it

2026-10-01, the owner: "When I click on the 'preview what claude gets' button and view that, I don't see the opening message included in the 'Exactly what Claude receives with it' - on this view would it make more sense to not have the opening message and the rest of what exactly claude sees split like we currently do?"

They are two different things, and the preview now says so by putting them in the order they arrive: **1 · The context, first** (what the SessionStart hook returns, before any message) with its token count, then **2 · Then the opening message** (the prompt `claude` starts with: the first user turn) with its own count. Before, the message sat above the hook's text as if it were separate from "exactly what Claude receives", and in the wrong order. `NewCardSimple.tsx` only; the full look's preview is unchanged.

**Verified:** `pnpm typecheck`; `walk-simple.cjs` (30, with a new check that the hook's context comes before the message), screenshot looked at.

## 67. Ticket (change)

2026-10-01, the owner: "where the title says 'TICKET' can you move the change ticket link on the right side to just be (change) next to the 'TICKET' header so its TICKET (change) with the change being easily visible that it's clickable link". Done as said: the heading reads *Ticket (change)*, the link in the accent colour and underlined, the same `Enter` on the block. `walk-replace.cjs` clicks it by its new name.

## 68. The popup says what happened, where it happened

2026-10-01, the owner: "instead of having messages or errors pop up at the top of the app next to 'Sessions' we should show any errors or info like this next to the action that was just attempted. For example I tried to add a new folder of repos that didn't contain any git repos, and it told me a message and just closed the windows explorer and made it seem like nothing happened unless you notice the message at the top."

**What it does.** The Add context popup has a line under its search box (`simple.note`, `role="status"`) that says what the last action came to: a refusal in the warning colour (*No git repos in D:\notes. A folder Claude should read goes on the Folders tab.*, *Not a folder on this machine*, *listed already*, *Only a repo this card added can be taken out*), or a plain word of what happened (*2 repos in D:\side, listed below for this card only. Enter picks one.*, *D:\specs is on the card: Claude can read and edit what is inside.*, *Pick the folder in the Windows dialog (it may have opened behind this window).*, *Nothing picked in the dialog.*, the folder taken off the list). Typing in the box, switching tabs or closing clears it. The header's flash is no longer used for anything the popup does; it still serves the rest of the screen. `say()` and `updatePicker()` in `web/simple-keys.ts` route every picker outcome there (a refusal string from the model becomes a note rather than a flash).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (302); `walk-sources.cjs` reads its messages from the popup now and checks the header does not carry the refusal; `walk-simple`, `walk-folders`, `walk-context` and `walk-replace` still pass. Screenshots looked at: the note under the box on the Repos and Folders tabs.

## 69. The opening message reads in sections, and its box grows with it

2026-10-01, the owner: "Can the opening message text that is created be spaced out better, new lines and such, so it's easy to tell the different sections of the message?" and "that opening message area grows as content grows so the user can easily keep typing into it and see the whole content as they scroll (input shouldn't be scrollable though it should grow and the popup should grow to fit its content)".

**What it does.**
- **The three default prompts** have a blank line between their parts: what to do, where to look (repos, folders), the worktree constraint, how to start. The renderer already kept blank lines (and drops a part whose placeholders are all empty), so a card with no folders reads as three clean paragraphs. A store from before this gets the new spacing once, for a seeded prompt whose words are still the default's (`prompts.spaced` in `meta`); one you edited is left alone.
- **Have Claude write it** asks for the same shape: short paragraphs separated by blank lines, one per concern, in the same order.
- **The lines reach Claude.** `cleanDraft` used to flatten the message to one line (it goes to `claude` as an argument). With the channel on, the launcher gets the whole command as one base64 argument and quotes it itself, so a newline inside the argument survives; the server now keeps the lines and only trims trailing spaces and runs of blank lines. Without a channel (`CC_CONTROL_CHANNEL=0`), `wtArg` still flattens for Windows Terminal's re-quoting, as before.
- **The box grows with its text:** no scrollbar of its own (`overflow-hidden`, the height set from `scrollHeight` on every change, at least 200px); the popup's body scrolls, so the whole message stays readable while typing. The preview's `pre` shows the lines as they are.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (303): `cleanDraft` keeps lines and tidies blank runs; the store respaces an untouched default once and leaves an edited one. On the isolated server: `walk-simple` (30) and `walk-prompts` (35) still pass; an ad hoc check picked a default prompt (three blank-line breaks in the box), typed 25 more lines (the box went from 222px to 791px with no inner scroll, the end still in view), screenshots looked at. Not tried live: a real card started with a multi-line message reaching `claude` through the launcher (same quoting path as before; `Quote` wraps any argument with whitespace).

## 70. The ticket's details in a drawer, and its key a link

2026-10-02, the owner: "in the ticket section we show the acceptance criteria count and comments count, let's give the user a way to quickly see these by clicking a drawer to expand/collapse - we should also make the ticket number clickable to take them to the jira ticket in their browser".

**What it does.** The counts row under the ticket (*Acceptance criteria · 3  Comments · 2  Linked · 1*) is a button with *Show ▾* / *Hide ▴* at its end: `Space` on the ticket block, or a click, opens a drawer under it (`simple.details`) with every acceptance criterion as a list, each comment with its author and date, and the linked tickets with their relation and key; the description shows in full while it is open, and the counts give way to a plain *Details* label until it is closed again (the drawer's own headings say what is there). The ticket's key is a link to the tracker when the ticket has one (`t.url`; demo tickets have none), opening in a new tab; `o` on the block does the same from the keyboard, and on a ticket with no link says so. `Enter` on the block still changes the ticket (it used to share that with `Space`). Rows in `?` (*Enter (ticket)*, *Space (ticket)*, *o (ticket)*), the legend (*Details* / *Hide details*, *Open in the tracker* only with a link; tested).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (303). `walk-simple.cjs` (36): `Space` opens the drawer with the three criteria, both comments with their authors and the linked SHOP-98, the row says *Hide*, `Space` closes it, the key is not a link on a demo ticket, `o` says there is no link; screenshot looked at. `walk-replace`, `walk-context` and `walk-prompts` still pass. The key as a link and `o` opening the browser are only exercised with a real Jira ticket (the demo set has no urls).

## 71. The prompt picker reads as a dropdown

2026-10-02, the owner: "the border highlighting the first option right as you open is disorienting and it's almost hard to even tell that the prompt area is a dropdown at all".

**What it does.** The row above the message box is now *Prompt* and a select-looking control: a bordered button with the prompt's name and a chevron (turning while open), which takes the ring only while the list is open; a faint hint beside it says *Space opens the list*, then *↑ ↓ then Enter · Esc closes*. In the list, the row the keys are on is marked softly (a raised background and a thin accent bar on its left) instead of the hard focus ring; the prompt in use carries a tick (Write your own gets it once the text is yours; the default message has none); Write your own is set off from the saved prompts by a rule. Open, the box behind the list is veiled (a translucent, slightly blurred layer below the control) and the list sits on it as a lifted panel with a darker border, a deep shadow and its own *Saved prompts* heading, so the two never read as one. A click anywhere outside the control and its list closes the list, as a dropdown should (a `mousedown` listener while it is open); the hint beside the control shows only while the list is open. The keys and the walkthrough's locators are unchanged (the control's accessible name is still *Prompt · name*).

**Verified:** `pnpm typecheck`; `walk-prompts.cjs` (38) with checks that no `.is-focus` ring is in the list on open, exactly one row is the keys' row, the control is expanded with its chevron, and no tick shows for the default message; `walk-simple.cjs` (37) still passes; screenshots looked at.

## 72. No Full look link in the header

2026-10-02, the owner: "let's get rid of the 'full view' link at the top too". The simple look's header no longer has the *Full look* button; `Shift+L` and the setting in `?` `B` still switch looks, and the `?` row says so. The full look is otherwise untouched.

## 73. The model beside Start work; no token counts

2026-10-02, the owner: "users will likely want to more easily change their model without having to open the session config area - could we add another convenient spot next to start work?" and "let's get rid of token count in the new session popup too".

**What it does.** A *Model* control sits in the footer, left of *Start work*, in the prompt picker's shape: a select-looking button (*Model Default*, or *Opus* / *Sonnet* / *Haiku*) that opens a list above it with the default first (its full id under it, and whether it is pinned by the server or your Claude Code setting), a tick on the one in use (in the accent colour, with its name in the accent too, never a raised ground: that is what a hovered row gets, and the owner found the two blending together), a click outside closing it. It edits the same field as the Model row in the session settings, so the two always agree; `m` still cycles the model from anywhere (the `?` row already says so). The token counts are gone from the footer and from the preview's two headings.

**Why this shape:** it replaces the model text that already sat there, so it costs no space; a segmented control would be wider and would repeat the settings row's radios.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`; `walk-simple.cjs` (43): the control on the default, the list of four, Sonnet picked and shown on the control and in the settings row, `m` cycling to Haiku, a click outside closing the list; screenshot looked at (the default's long id goes under its name after a first cut truncated it).

## 74. The prompt editor, easier on the eyes

2026-10-02, the owner: "the edit prompt modal is hard on the eyes (at least on dark mode) because of the bold text".

**Cause.** The name box, the kind select and the body sat inside the eyebrow labels (bold, letter-spaced, uppercase) and inherited the 700 weight and the spacing, so the whole editor rendered bold. And the body in the mono face at 12.5px, light on dark, read as bold even at a normal weight.

**What it does.** The controls take their own weight, case and spacing back (`fieldClass`); the body is in the text face at 14px (it is prose with `{{placeholders}}`, not code; the placeholder buttons beside it stay mono); the example box is the text face too, in the secondary colour on a soft ground; the names in the list are medium rather than semibold. Nothing moved and no key changed.

**Verified:** `pnpm typecheck`; computed weights of the textarea, the name box and the example are 400 with normal letter-spacing; dark-mode screenshots of the list and the editor looked at (`colorScheme: 'dark'` and the theme set to dark); `walk-simple` (43) and `walk-prompts` (40) still pass.

## 75. The hand on everything clickable

2026-10-02, the owner: "make sure that things that are clickable make the mouse change to the clickable pointer on hover, site wide".

**Cause.** Tailwind v4's reset leaves buttons on the arrow cursor (v3 gave them the hand), and most of the app's clickable things are buttons.

**What it does.** One rule in `web/styles.css`: every enabled button, link with an href, `role` of button / option / tab / radio / menuitem / switch / checkbox, `label[for]`, select, summary, checkbox and radio input shows the hand; a disabled button or an `aria-disabled` option keeps the arrow. The few plain elements that take clicks (the `?` `B` rows, an approval question and its options, the source heading in the Add context popup) carry `cursor-pointer` themselves; the line's filter label, which only focuses its box, shows the text cursor.

**Verified:** an ad hoc Playwright pass reading the computed cursor: every header button and link, 17 buttons, links, options, tabs and radios on the new-card popup, the ticket's counts row and *(change)*, the Add context rows, the prompts dialog's rows and the `?` `B` rows all answer `pointer`; a disabled button does not. `walk-simple` (43) still passes.

## 76. Keys live in keycaps, not in prose

2026-10-02, the owner, after the two dropdowns lost their *m cycles* and *Enter picks · Esc closes* lines: "get rid of these site wide", and "only the text ones, I still want the ability to hide/show the keyboard shortcuts the way we are".

**What it does.** Visible prose no longer names keys: the Add context popup's footer line and empty states, its rows' subs, the lane dialog's popup footer, the message box's placeholder, the flash and note messages the new-card screen gives (a refusal says *browse for one* rather than *b browses*), the folder picker's messages, the session composer's placeholder, the palette's two action labels, the stack table's message, the Hidden tickets note and the look row in `?` `B`. Where a hint named a key, the sentence now says what to do or what the control is (*the × at the end takes this folder off*). The keycap system is untouched: `<Key>` keycaps everywhere, the legend bar, the `?` overlay and its show/hide switch, the dialogs' key footers, and hover tooltips.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (303); all eight walkthroughs pass (two of `walk-sources.cjs`'s checks matched the old wording and were updated).

## 77. An × in the corner, not Cancel

2026-10-02, the owner: "cancel instead of X in the top right corner of windows is weird and throwing me off". Every dialog's title row (`DialogTitle` in `web/components/Overlay.tsx`) and the new-card screen's header, in both looks, now end in a small × button (`CornerClose`, with *Close* as its name) with the `Esc` keycap beside it, where *Cancel Esc* was. The real Cancel buttons in footers (the lane dialog, the Ship sheet) stay as buttons.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`; `walk-simple`, `walk-prompts`, `walk-lane`, `walk-chrome` pass; screenshots of a dialog and the new-card screen looked at.

## 78. The open card: three directions, and the handoff

2026-10-02, the owner: "new session area is looking wonderful now, I think I'm ready to move on to simplifying the next area of the app which is the view that opens when you open a created card - our goals are the same as the last one". Three directions on a Design canvas (https://claude.ai/artifact/U3vcZqgX5v6yegUAoLyeDb; the same artboards under `docs/futures/open-card/project/`, which open as plain HTML): **A · The status page** (one column read top to bottom, what needs you first, the transcript beside it, tabs gone; the smallest change), **B · Transcript first** (the conversation is the page, a quiet rail for the rest), **C · The journal** (one stream in time order with a sticky "now" strip; the largest build), and a comparison board that recommends starting with A and names the one convention the open card may bend (a pinned live "now" while the rest scrolls). The directions were drafted without the owner's input, so the handoff for the next session, `docs/prompts/continue-open-card.md`, starts there: go through the boards with the owner, take their feedback, and revise the canvas in place (and the repo copies) toward the app's goals before anything is built; then what the finished popup established, the view's code, the keys to keep, and the first commit to make once a direction is picked (a seam to seed a card on the isolated server, so the view can be walked through without starting a real terminal session).

## 79. The open card: the owner's feedback, and four more directions

2026-10-02, the owner, on the three directions: the app is not a new face for a terminal; it is for getting through many Claude Code sessions faster, by developers and non-developers. When someone opens a card they should see what they need to make a quick judgment call, do the one thing the card needs (answer, approve, type to the terminal), and move on to the next card. What they named: the chat (read, send, approve); the diffs grouped by the repo they are in; starting this card's apps on their own ports (each card is its own slice: its worktrees, its own app instances, so a card is tested on its own, with clear instructions on how to test this one); later, hooks into the team's own apps to look up and add records and create test data from the card's context. Claude's to-do list and the session's details can stay out of sight. Merging across cards is for later. They asked for more unique directions.

Four more boards on the same canvas (row 3, with a second comparison board under them; the same files under `docs/futures/open-card/project/`): **D · The review desk** (the diff is the page, one section per repo with its worktree and port, files fold open to hunks, the ask pinned above, the chat a column wide), **E · The inbox** (the board folded into a queue beside the card, the question first, then three glances: chat, changes by repo, try it; `↓` to the next card that needs you without leaving), **F · Chat with a dock** (only the chat and the message box by default; a dock of drawers one key each: Changes, Try it, Verify, Context, with badges for what changed since you last looked; steps and session behind More), **G · The test bench** (this card's apps on their URLs and ports, numbered steps to test it derived from the plan and the ticket's criteria, pass / fail per step where a fail becomes a message to Claude; the team's apps as a section for later). The second comparison board (`Compare2.dc.html`) sets them against what the owner asked for and suggests they are not exclusive: F is a frame, D and G are what two of its drawers would hold, E's queue is a rail that fits beside any of them. Two ideas no earlier board had: a "since you last looked" marker, and test steps that close the loop from a verifier to Claude. The team's apps are named generically on the boards (no internal tool names in the repo). Nothing built; the handoff `docs/prompts/continue-open-card.md` is updated.

**The owner picked F** (2026-10-02): "I like option F but not on the right side, let's make it on the left side and be sure it's streamlined as much as possible to ensure developers are easily able to do what they need to do when developing and working on a card." F was revised in place: the dock on the left edge with the way back on top, then Changes, Try it, Verify, Context, and Ship and More at the bottom; the open drawer beside it; the chat the rest of the page with a one-line header, the ask inline with `y` / `n`, the message box pinned with `c` attaching context; no footer and no action bar. The next session writes F into its own PLAN section and gets a yes before building (`docs/prompts/continue-open-card.md`).

## 80. A card for tests: the seed seam

**The owner (2026-10-02):** "let's go ahead and move forward with that but knowing that we'll need a good chunk of changes as we work through smoke testing." So F is built in pieces, each one testable, starting with the seam the handoff asked for: `walk-back.cjs` needed a started card and the only way to make one was `card.start`, which opens a real Windows Terminal tab and a real Claude session.

**What it does.** `cards.seed` (`server/seed.ts`, pure and tested; `index.ts` wires it) writes a card that looks started: a key and title, the lane, each repo as a packet item with a folders entry (worktrees when given, else the repos' own folders, so Changes groups by repo and asks git for real), boot steps, a to-do list, files, a made-up session id and a channel flag, and one of five states: `plan` (a plan waiting for approval, a note still waiting), `tool` (a tool asking to run), `working`, `idle` (in Try it, with files), `done` (a merged PR). The relayed prompt is seeded too, so `y` / `n` are answerable on the page. A transcript per state is kept in memory by session id and `session.open` serves it instead of asking the SDK. **The owner's server never has it:** the message is refused when `CC_CONTROL_PORT` is the default, and every folder named must exist. `walk-card.cjs` seeds a Demo lane and five cards and screenshots each open; the other walkthroughs can seed what they need the same way.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (309); `walk-card.cjs` on the isolated server: five cards seeded, each opens, the plan card's transcript shows the seeded plan, no console errors; the screenshot of the plan card looked at (today's view, unchanged).

## 81. The open card, direction F: the chat is the page, a dock on the left

**What changed.** `CardView` moved out of `TicketLine.tsx` into `web/components/CardView.tsx` and was rebuilt to the F board (§79): no header block, no tabs, no footer. **The dock** on the left edge (92px): the way back on top (`←` with `Esc`), then Changes `⇧D`, Try it `⇧T`, Verify `v`, Context `⇧C`; at the bottom Ship `s` (named for what it would do: Ship, Ship the rest, Merge, QA report, Findings; gone when there is nothing to ship) and More `m`. Badges: the files the card wrote on Changes, *on* on Try it while the app serves, `+n` on Context for what still waits for the next message, `PR` or `!` on More for an open PR or a report. **The panel** (400px) opens between the dock and the chat; its key toggles it, the × beside its keycap closes it, and `line.panel` keeps it open from card to card (`← →`). On a window under 1024px it lies over the chat. **The chat** is the rest: a one-line header (key, title, stage, kind, *Its tab* `g`, `←` n of N `→`), the transcript kept at the newest line unless you scrolled up, a *new since you last looked* rule where you left it last time (`cc-control.seen` in localStorage, written when the card is left), a status line while nothing is asked (what Claude is doing, the turn's elapsed time), then the ask (Approve / Not yet, Allow / Deny on `y` / `n`, with the plan's text under it, or *Answer in its tab* `g` when the page can't relay it) and the message box with Context `c` and Send `Enter` beside it. While a card boots, the chat shows the boot lines. **The panels:** Changes asks git through `card.changes` (again whenever the files, the ship or the live state change) and lists each repo with its branch and totals, the files under it, the chosen file's diff folded open under its row (`j` `k` move, a click chooses, `f` opens the full-width sheet; `line.at` holds the choice). Try it: this card's app (running, its URL with `o`, Start / Stop `t`, the recipe `e`) and the recipe step by step as before. Verify: a note that the team's apps come later. Context: Added since (with Add `c`), What Claude was given, How it started. More: Steps, the report, the PR, Ship's steps, Where it runs (with the files written), Its session, Done `d`, Remove `Delete`. **Keys:** `Tab` is gone; `⇧D` on the open card is the panel (the board's `⇧D` is still the full sheet); `⇧T`, `v`, `⇧C`, `m` are new; `j` `k` `f` work in the Changes panel; the rest are as they were. The legend's drawer view lists the five panels (the open one as *Close …*) and `t` reads *Start the app* there; `?` has the rows. The other callers that set a tab now set a panel: a started card opens on Context, Try it opens Try it, a ship opens More.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (308; the legend tests follow the dock). `walk-card.cjs` on the isolated server (28 checks) in light, dark and at 900px: the dock's way back at the top left, no panel at first, the ask under the chat with Approve, no tabs, each dock key opens its panel and the same key closes it, Changes groups by repo with real diffs from the demo repos and `j` moves the chosen file, `f` opens the sheet and `Esc` closes only the sheet, the panel stays open across `→`, the tool card's ask names the command with Allow, the working card shows the status line, the idle card's Changes badge counts its files, the done card has no message box and More shows its merged PR, `Esc` returns to the board, a reopened card shows no *new since* line when nothing changed, no console errors; screenshots of the plan card's chat, Changes, More, Try it (dark) and the narrow Changes panel looked at. The regression net: `walk-simple`, `walk-lane`, `walk-chrome`, `walk-context`, `walk-folders`, `walk-replace`, `walk-sources` pass; `walk-back` now seeds its card and passes (15); `walk-prompts` fails one check (*s opens the prompt editor*) on the committed page too, so it is not from this change. **Not tried:** a real card with a channel (answering `y` through the dock's page), a running Try it (the *on* badge), the trust prompt flow.

**Smoke test, round 1 (the owner, 2026-10-02):** the full-width Changes sheet's diff ran past the dialog (the grid's row grew to its content): the panes' grid now has a fixed height with `minmax(0,1fr)` rows and `min-h-0` panes, so the file list and the diff scroll inside it. "Let's give icons to the side tabs as well": each dock item is an icon (a plus for Changes, play for Try it, a shield for Verify, layers for Context, a merge for Ship, dots for More; four new icons in `ui.tsx`), its name and its keycap under it; the open panel's icon takes the accent colour. **Verified:** `walk-card.cjs` (28) and the screenshots of the sheet and the dock looked at.

**Round 1, the icons again** ("+ for changes is weird"): the dock's icons are now a file with a plus and a minus line in it (Changes), an app window with play in it (Try it), a clipboard with a check (Verify), an open book (Context), an upright rocket (Ship) and dots (More). The `play`, `layers` and `ship` paths went. **Verified:** `walk-card.cjs` (28); the dock looked at double size.

**Round 1, the panel's width** ("let's allow the sidebar to slide so the user can easily adjust it themselves"): the panel's right edge is a drag handle (pointer capture; the width follows the pointer), `[` and `]` narrow or widen it by 40px, and the width (280 to 960px, 400 by default) lives in `line.panelW` and `cc-control.panelWidth` in localStorage, so it is remembered per browser. On a narrow window the panel still lies over the chat at full width, with no handle. The legend shows `[ ]` *Panel width* while a panel is open; `?` has the row; README. **Verified:** `pnpm test` (308), `walk-card.cjs` (32: `]` widens by 40px, the drag widens by the distance dragged, `[` narrows back, the width is in localStorage) wide and at 900px; the wider panel's screenshot looked at.

**Round 1, the pop-out** ("change full width to a link that says pop-out with a popout icon and move that to the right side under the diff we're viewing… the diff that is open on the side panel is the one we show when we open the popout"): the *full width* button at the panel's foot is gone; under the open diff, on the right, a *Pop out* link with an arrow-out-of-a-box icon (`popout` in `ui.tsx`) and the `f` keycap. It and `f` call `openChanges(id, at)` with the panel's chosen file, and the modal (`{ kind: 'changes', id, at? }`) hands it to `ChangesSheet`, which starts on it. The legend says *Pop out*. **Verified:** `pnpm test` (308), `walk-card.cjs` (34: the link is under the open diff, `f` pops the sheet out, the sheet opens on the file the panel had chosen); the panel and the sheet looked at.

**Round 1, the Changes sheet** ("make the changes popup wider and bigger, people will be using this to review their code… the top right corners being clipped… improve the styling of the selected look"): `Overlay` has a `wide: 'full'` size (up to 1800px, a 20px margin, no top offset) and the sheet uses it; its panes take the window's height less the header and footer (`calc(100vh - 15rem)`), the file list is up to 340px wide, the diff's type is 12.5px. The chosen file no longer wears the focus ring (its outline and glow were cut by the list's rounded corners): it is a filled row in the accent's soft colour with a 3px accent bar on its left and bold text; the other rows keep a transparent bar so nothing shifts. **Verified:** `walk-card.cjs` (34) light and dark; the sheet looked at in both.

## 82. Try it as services: start them together or one at a time

2026-10-02, the owner: "We may not want to run all of the services we have attached to the session so we should allow the user to select which ones they want and spin them up all at once as well as individually (in case one fails and they need to fix and re-run, so they don't have to stop and restart the entire stack)." Until now a stack ran as one recipe: every picked API's steps, then the UI's, one run per card, and `t` stopped it all.

**The engine.** `RunService` keeps runs by key: a card's id for its own recipe, or `runKey(card, service)` (`<card>#<service>`, `shared/recipes.ts`) for one service of its stack; `CardRun.service` names it (an API's repo, or `ui`). `start(key, …, { cardId, service })`, `stop(key)`, `stopCard(cardId)` (its services in reverse start order), `ofCard`. **A stack session** (`prepareStackSession`, `server/stack.ts`) is what a run of the stack reserves for a card: the picked APIs' and the UI's folders checked, their branches, a port per API (and the UI when it takes one), and the proxy copy written with every picked API's rule; `serviceRecipe(session, service)` builds one service's steps (`serviceSteps` in `shared/stack.ts`: its steps then its own `stop:` steps; `stackSteps` is now built from it) and the UI's carries the app's URL. The server keeps one session per card and ends it (every service stopped, the ports freed, the copy removed) when `t` stops all, a new pick starts, the card goes, or its worktrees are removed. `card.try` takes `service` to start (or start again) one service of the session that is up, while the others keep running on the ports they had; `card.stopRun` takes `service` to stop one alone. `PROTOCOL` is 24.

**The Try it panel** (`StackTry` in `CardView.tsx`) is the picker now; the old modal stays only for a lane with no stack yet (what the repos say). It lists the environment row (`choose`, each value a radio) and every service: a tick for an API (the UI always runs), its name, its state (not started, starting, up, finished, stopped, or why it failed), why it is suggested (changed on this branch, named in the ticket), and its buttons: Open for the UI when it serves, Stop, Start or Again. The row highlighted shows its steps as they run and the last lines of the step that failed. The pick (environment, ticked APIs) is remembered per card in this browser (`cc-control.stackPick`, as before); with none saved yet the suggestion is saved, so `t` can start it. **Keys:** `t` starts every ticked service at once (a new session) or stops them all; `j` `k` move; `Space` ticks the highlighted API or cycles the environment (a change while things run says it takes effect at the next start); `r` starts the highlighted service on its own, or again after a fix; `q` stops it alone. The legend's drawer view shows them while the panel is open on a lane with a stack, and `t` reads *Start all ticked* / *Stop all* there; `?` has the row. The dock's Try it badge says *on* while any service is up; the tile's run line and the board's `t` / `o` follow the card's main run (its own recipe's, else the UI's, else the first service's).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (309: the stack test's new case starts two APIs and the UI as their own runs on the session's ports, stops one alone with its stop: step while the others stay up, starts it again on the same port through the session, refuses a service that wasn't picked, and ends the session with the copy gone and the ports back). `walk-stack.cjs` on the isolated server with stand-in scripts (`standins/*.cjs`): the panel lists the services, `Space` ticks the API, `t` starts both (each up on its own port, the dock says *on*, Open shows on the UI's row), `q` stops the API alone while the UI stays up, `r` starts it again, the session label names the ports, `t` stops them all; screenshots looked at. `walk-card`, `walk-simple`, `walk-back`, `walk-lane`, `walk-context` pass after it. **Not tried:** real Okteto (a service's `okteto up` started again alone: its manifest copy is written again by the forward: step, and `okteto down` ran on stop), the proxy file in edit mode across a single service's restart (the copy is the session's, so nothing changes), two cards' sessions at once.

**To check at VU:** `git pull`, restart. On a card in the lane with the stack: `Shift+T`, tick the API, `t`. Both rows should go to *up* with their ports in the title. `q` on the API: it should run `okteto down` and the UI should keep serving (its calls to that API now fail until `r`). `r`: a new `okteto up -f okteto.cc-control.yml` on the same port; the UI's calls work again without a restart. `t`: everything stops. Say what each row showed and what the terminal output said if a step failed.

## 83. The stack as a form: set up without JSON

2026-10-02, the owner: "Recipe popup is currently pretty complicated, most non-technical users won't be able to configure this on their own and technical users would struggle without claude help. Let's focus on just getting VU setup working easily… Last time I had to manage a whole bunch of different code/configs by copy/pasting in from claude to get things set up the right way, we should reduce this complexity as much as possible." The stack was JSON (or a table of its parts) behind `e` and `Alt+W`; the team-specific lines (the helper that makes the deployment, the kubeconfig per environment, what runs inside the container) had to be typed into `api.steps` by hand.

**What it does.** `e` on a card in a lane of several repos (or any lane with a stack) opens **Set up the stack** (`web/components/StackSetup.tsx`), a form read top to bottom: *Environments* (one line, the first the default); *The UI* (the repo from the lane's, its proxy file, how it starts, where it serves, its path); *The APIs* (a row per other lane repo: a tick, its name on the dev environment, container port, project folder, health path, route); *How an API starts on the dev environment* as plain answers: the command that makes the API's deployment for the branch before `okteto up` and what it asks, what runs inside the container once it is up, whether a kubeconfig per environment is used (the sheet says which `KUBECONFIG_<ENV>` names config.env has set and which are missing), and what to delete on stop. **The step lines are written from the answers** (`apiStepsFrom`, `shared/stack-setup.ts`: `ps: answers:"…" KUBECONFIG=%KUBECONFIG_{{ENV}}% <command>`, `wait:port:{{port}} … okteto up` (the forward of the picked port is added at run time, as before), `wait:http:{{port}}{{health}} … okteto exec -- sh -c "<run>"`, `stop: … okteto down`, `stop: … kubectl delete deployment {{deployment}} -n <namespace>`), shown under a fold and editable by hand; lines not written by the answers (an older stack, the detector's draft, a hand edit) are kept as they are and marked *edited by hand* (`knobsFromSteps` reads the answers back only from lines it wrote). The proxy rule each API adds is a second fold. `Ctrl+Enter` saves through `stack.save` (checked by `validateStack`; errors in the form's words: a missing project folder when the steps use `{{dir}}`, a port that isn't a number, no environment). A lane with no stack starts from what the repos say (`stack.detect`, whose reply now carries the kubeconfig names), else from the default answers. The `tryPick` modal's `e` and `TryPick`'s edit open the sheet too; a single repo keeps its recipe editor. `?` and the README say so; `docs/prompts/continue-try-it-at-vu.md` points at the form.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (314: the answers write the lines and read back as the same answers, the least and the most; lines not theirs are custom; the form from a saved stack lists every lane repo with the stack's ticked and keeps custom lines through a save; a lane with no stack starts from the repos, else the defaults; the stack from the form and its errors). `walk-stack.cjs` (22): `e` opens the sheet filled from the saved stack (the UI repo picked, the API ticked with its route, the stand-in lines kept and marked edited by hand), typing a deploy command writes the lines afresh, `Esc` leaves the field then closes; the sheet looked at. **Not tried:** the real stack at VU through the form; the generated lines against real Okteto (their shape is §42's, which ran there).

**To check at VU:** `e` on a card in the lane: the form should show the stack as saved (its lines under *The step lines*, marked edited by hand). Fill the three answers from those lines (the helper command and its answers, `cd src/{{dir}} && dotnet watch run`, the namespace to delete from), tick the kubeconfig, and compare the written lines with the old ones before saving; if a line the team needs can't be said in the answers, say which.

## 84. A service's output, read in the app

2026-10-02, the owner: "When sessions are running, we should be able to click on that service to show a popout (or whatever makes sense visually) of the console output of that service so we can see logs as we're developing without opening any outside terminals. The goals of the app are to keep users focused on managing sessions within the app, reducing the amount of times they ever need to go to their IDE, their GitHub/Jira, etc." Until now the page saw twelve lines of one step (`step.tail`), sent with the whole run list, and nothing streamed.

**The server.** A run keeps its whole output as one log (`Live.log`, `LogLine { n, t, step, text, mark? }` in `shared/recipes.ts`, the last 3000 lines): every line each step prints, stdout and stderr alike, numbered in order, and a marked line where a step starts (`$ cmd`), exits (`(exited, code N)`) or is stopped (`(stopped)`, written when the run is stopped, before its stop: steps run). A chunk that ends in the middle of a line is kept until the rest arrives, so a line split across two writes is one line (it used to become two). `RunService` takes a `lines` callback and calls it at most every 100 ms with the lines since the last call, or with `reset` when a key starts afresh (`r` on a service); `runs.log(key)` is the whole log. **The protocol** (25): `run.follow { keys }` says which runs this connection wants (the set replaces the last; a new key is answered with `run.log`, the whole log), then `run.lines` as they print. `index.ts` keeps the set per connection and drops it on close.

**The page.** `followRun(key)` in `ws.ts` counts the views following each key and tells the server the set (again on reconnect); `store.logs` holds the lines by key, appended by `n` so a log and a flush that cross on the wire never double a line. `RunLog` (`web/components/RunLog.tsx`) draws them: mono, the marks in the busy colour, kept at the newest line until you scroll up (then a *↓ newest* pill brings it back), each line's time on hover. **In the Try it panel**, the highlighted service's section (a click on a row highlights it, `j` `k` too) shows its steps as before and, under them, its output as it prints (`max-h-[40vh]`), with *Pop out* `f` under it the way the Changes panel has; a single-recipe card gets the same under its recipe. The twelve-line `<pre>` is gone. **The Output sheet** (`OutputSheet.tsx`, `modal: { kind: 'output', id, service? }`, full width like Changes): a tab per run of the card in the panel's order (the APIs, then the UI; `j` `k` or a click switch), the run's status line, a filter box (`/` focuses it, step marks stay so the shape holds, `Esc` leaves it), Wrap `w`, and the service's own Stop `q`, Again `r` and Open `o`; `End` goes back to the newest line; `Esc` closes only the sheet. The legend shows `f` *Output* while the Try it panel is open on a card that can run; `?` has the row; README.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (315: the run's log is numbered from 1 in order with each step marked, a split line is one line, stderr is kept, what the app prints while serving lands, the follower gets every line once in order after a reset, a stop is marked on the step that was up; the legend's Output key). `walk-stack.cjs` (36, light and dark; the stand-in API now logs each request): the API's output shows under its steps with the step marked, a request to its port lands in the panel while it runs, `f` opens the sheet on the API's tab with the same lines, a new request lands in the sheet live, `j` moves to the UI's tab with its own output, `/` filters, `Esc` leaves the box then closes the sheet with the card still open, `q` marks the stop then shows the stop: step and what it printed, `r` starts the output afresh. `walk-card` (34), `walk-back` (16), `walk-lane` (14) pass after it; the panel and the sheet looked at in both themes. **Not tried:** a real dev server's volume (Angular's rebuild output; the 3000-line cap and the 100 ms flush are the guards), ANSI cursor movement beyond colour codes (only colour codes are stripped, as before), two browsers following the same run.

**To check at VU:** `Shift+T` on a card whose stack is up, click the API's row: `okteto up`'s output and then the container's should sit under its steps and keep moving; `f` for the full sheet; type a request through the UI and watch the API's lines land. Say whether the panel's 40vh is enough or the sheet is what gets used, and whether anything prints that the view garbles (progress bars that rewrite a line will show as repeated lines).

## 85. Every card can be typed to: the session is resumed in a new tab when its channel is gone

2026-10-02, the owner: "I often see 'This card's terminal can't be reached from here' and I don't care how the terminal was started, we need to find a way to always be able to talk to the Claude Code session (if it's open then connect to it, if it's been closed then resume it (or ask before resuming), etc.). If a user can't talk to their chat from our app on all sessions and sometimes has to go to the terminal, then why would they ever use our app at all."

**Why it happened.** The page showed the message box only when the card's saved `channel` flag was true, and the flag was only ever written by the channel socket's hello and close. So it was wrong both ways: **stale true** after a server restart or crash (`closeAll` cleared the map before the close events fired, nothing reset the flag at startup; the box showed but every send threw until the tab's script reconnected, or for good if the tab had died meanwhile) and **false for good** once a tab closed, the session ended (`phase: 'ended'` hid the box entirely) or the card had started without a channel. Claude Code offers no way for another program to join a running terminal session (§26), so the only path back into a session whose tab is gone is a new tab on it.

**What it does now.**
- **The flag tells the truth.** `cards.resetChannels()` at server start sets every card's `channel` false (each live tab's script reconnects within 15 s and says hello again); `channels.closeAll()` tells every card its channel is gone before the server exits. On the page an ended session counts as unreachable whatever the flag says.
- **The box stays on every card with a session.** Without a channel its placeholder says *Enter opens a new tab on it and sends*, the button reads *Resume and send*, and a note under it says why (the tab closed or the server restarted; or the session ended) and what sending does. `Enter` focuses it whenever the card has a session (`focusSay`); the legend's `canSay` follows `sessionId`.
- **Sending reopens the tab first.** `card.send` with no channel (or an ended session) calls `cards.reopen(id)`: a new Windows Terminal tab titled with the card's key, in the card's folder, running `claude --resume <sessionId>` with the same `--settings` hooks, channel MCP, permission mode, model and `--add-dir`s, and the card's own token in its environment, so the SessionStart hook (source `resume`) re-links the card without re-sending the packet and the channel script says hello with the same token. The server then waits for that hello (`channels.waitFor`, up to 90 s) and sends the message; the page's request allows 120 s and flashes *Opening a new tab on …'s session; your message goes in once it connects*. The card's boot lines say *Opened a new tab …, resuming session …* and *Waiting for the session to resume* (marked bad after 45 s with *look at the tab (g)*).
- **The guard against two tabs on one session:** `reopen` refuses while the card's hooks spoke within the last two minutes and the session hasn't ended (its tab is alive but has no channel: the message says so and points at `g`). Two `claude` processes on one session would both write its transcript.
- **`g` reopens too:** when no tab with the card's key is found and the card has a session, `card.focusTab` opens one on it instead of failing (the reply carries `note: 'reopened'`; the page flashes that the tab was gone and a new one was opened).
- `tabCommand` with no message passes nothing after the arguments (a resume has no opening message). `CardService.start` now goes through `claudeArgs`, `otherFolders` and `openTab`, which `reopen` shares. README; `?`.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (317: `tabCommand` without a message, both ways; a `waitFor` that times out and one woken by the hello; `closeAll` tells each card; `reopen` refuses a card with no session, a missing folder, and a tab that spoke within two minutes, and `resetChannels` clears the flag). `walk-card.cjs` (35, light and dark): the idle card seeded without a channel keeps its message box with *Resume and send* and the note; the done card (session ended) says sending resumes it; the rest unchanged; `walk-stack` (36) and `walk-back` (16) pass; both cards looked at. **Not tried:** a real resume (the walkthroughs' sessions are made up, so no tab is opened; `reopen` runs the same `wt.exe` path `start` does), a resumed session's channel saying hello with the old token, the two-minute guard against a real tab, `/resume` inside a tab to another session (the channel would then type into that one; unchanged).

**To check at VU:** on a card whose tab you closed: the box should say *Resume and send*; type something and `Enter`: a new tab should open on the session (the trust prompt won't come: the folder is known), the message should land in it within a minute, and the card should follow it (its boot lines name the resumed session). Then restart the server: every card should lose its channel for a moment and get it back within 15 s without a reopen. Say what the tab showed if the message never arrived.

## 86. How it runs: one concept, no "recipe" on screen, the stack form does the whole job

2026-10-02, the owner: "what did we do to simplify the setup for spinning up the stack? I'm still seeing recipes (which I don't like) and think we should find a way to ensure standing up and configuring new APIs and other stuff is easy as possible." And, on the plan: "remember how our okteto stuff is generated for the APIs and how the UI must edit proxy.conf.json to point to those local APIs. We also need to support different sessions running the same APIs on different ports."

**What was already true, and stays.** The per-session mechanics are §82's: a run of a card's stack reserves a local port per picked API and one for the UI from the pool (`CC_CONTROL_PORTS`), writes a copy of each API's okteto manifest with its forward pointed at that port (`forwarded`, kept out of git), and writes a card-specific copy of the UI's proxy.conf.json with each picked API's rule pointed at its port; the repo's file is never touched. Two cards can run the same API at once. Nothing here changes that; this section is about how a person sets it up.

**Where "recipe" still showed** after §83's form: the legend's `e` on every card ("Run recipe"), three `?` rows, the Try it dock tooltip, the new-card screen's context chip ("Run recipe: pnpm install, pnpm dev"), the detect popup `t` opened on a lane with no stack, and the whole single-repo path: the panel's "run recipe" heading, "Edit the recipe / Write a recipe", and the old four-tab dialog (repo, lane, table, stack as JSON) with the step syntax up front. The stack form itself leaked the machinery: a five-column API table, `{{name}}`-style placeholders in the labels, the step lines and proxy rule folds in the middle.

**What it does now.**
- **One name: How it runs.** The legend's `e` reads *How it runs* on the board and the open card; the `?` rows, the dock tooltip, the panel's heading (*How web-app runs*), its button and its empty line say the same; the context chip reads *How it runs: pnpm install, pnpm dev* (`recipeLabel`); the server's refusal when nothing is set up says *e sets it up*. The word recipe stays in the code (`RunRecipe`, `recipe.save`) and nowhere on screen.
- **A single repo gets a form** (`web/components/RunSetup.tsx`, `shared/run-setup.ts`): *Start* (the command that keeps running), *Install first*, *When stopped*, *Where it serves*; the lines are written from the answers (`stepsFromRun`) and read back (`runFromSteps`); lines that say more than the answers can (a `@repo`, a `wait:`, a variable, three commands) are kept as written and marked, with the answers disabled until one is changed. *Advanced: the lines* holds the textarea and the syntax notes. *Back to what the repo says* when something was written by hand. The old `RecipeDialog` (and with it the lane's plain recipe editor, the stack table and the JSON tab) is gone; `StackTable.tsx` with it.
- **The stack form is shorter** (`StackSetup.tsx`): the API table shows a tick, the repo, its name on the dev environment and its route; the UI shows its repo and proxy file; the three answers keep plain labels. *Advanced* (`a`, or the button) reveals container ports, project folders, health paths, the UI's start line, address and path, the placeholders note, the step lines and the proxy rule. A ticked API's values come from its repo (`okteto.yml` for the name and container port, the `.csproj` folder, a health route in its code) through `formFromStack`, so adding an API is: add the repo to the lane, tick it. The answers are the lane's and every API starts that way, which is what "a new API inherits them" meant.
- **The detect popup is gone** (`TryPick.tsx` deleted, the `tryPick` modal with it): `t` on a lane of several repos with no stack opens the stack form filled from what the repos say, with *Save and start*; the server now broadcasts the new stack before answering the save, so `t` after it finds the stack and starts every ticked service. `e` on a single-repo card opens its form (`modal: { kind: 'runSetup', repo }`).
- README: the Try it and stack paragraphs, step 7 of the setup, the `t` / `o` and `e` rows.
- **Found by the walkthrough and fixed:** what you wrote for a repo was stored under its path with backslashes, and a card whose packet kept the path with forward slashes (a seeded card; any path given that way) couldn't find it on `t`, though the page showed it. The store's key now normalises the slashes.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (320: the four answers write the lines and read back, the least and the most; lines with a prefix, a wait, a variable, a note, a stop line first or three commands are custom; the form from a repo's lines and from custom lines, what it saves and its errors; the same repo with either slash finds what was written; the renamed labels in the legend, hints, line-model, recipes and stack tests). `walk-card.cjs` (38): `t` on the Demo lane (two repos, no stack) opens the stack form with *Save and start* and no "recipe" on it, `Esc` leaves it with the card open. `walk-stack.cjs` (44, light and dark): the stack form's ports and folders sit behind Advanced and nothing on it says recipe; a one-repo lane's Try it panel says *How docs-site runs*; `e` opens *How it runs*, typing the start command and the address writes the lines, `Ctrl+Enter` saves, the panel shows the saved line as written by you, `t` starts it the saved way (up at its address), `t` stops it. `walk-back` (16) and `walk-lane` (14) pass; the two forms and the running one-repo card looked at. **Not tried:** the form against the real lane at VU (the saved stack's lines are kept as written, so nothing changes until an answer is changed); *Save and start* on a lane where the repos give no stack at all (the form then starts from the defaults and refuses to save until an API is ticked or a UI picked).

**To check at VU:** `e` on a card in the lane: the form should open with the APIs ticked as before, names and routes filled, and nothing else until `a`. On a card in a lane with a new API repo: add the repo to the lane, `e`, tick it, save, then `Shift+T` should list it. Say which of the hidden values (port, folder, health path) you had to open Advanced for, if any.

## 87. The way in when channels aren't allowed: the launcher types into the tab

2026-10-02, the owner, at VU: "I just got a message from my Claude Code session that channels are not enabled for my organization, so do we have options to get around that? (problem here though was that the 1068 chat was already open and it opened a new terminal alongside it for the same Claude session)."

**Two findings.** (1) Channels are an org policy switch (`channelsEnabled`); nothing in the app can turn them on, so at VU every card was unreachable and §85's reopen was the only path, which made (2) worse: §85's guard only asked whether the card's hooks had spoken in the last two minutes, so an idle tab passed it and a second tab opened on the same session (two `claude` processes writing one transcript).

**What it does now.**
- **The launcher is the way in.** `hooks/cc-control-launch.ps1` already runs inside each card's console (it presses Enter at the channels prompt by writing to the console's input buffer). Now, while `claude` runs, it asks the server what to type (`GET /launcher/poll?wait=`, the card's token in a header like the hooks, a long poll of up to 25 s; short polls during the first 30 s while the prompt may still come) and writes it into the console's input buffer with `WriteConsoleInputW`, each character as its key on this keyboard (`VkKeyScanW`, shift noted) or the character alone: a message then Enter, a new line as backslash then Enter (how Claude Code's prompt takes one), or a prompt's keys (`1` for the first choice, Escape for no). Nothing is typed that the page didn't send. Whatever window is in front, the input buffer belongs to that console.
- **`Typist` (`server/typist.ts`)** keeps a queue per card and the waiting polls: a message waits for a poll (and is refused after 20 s if none comes), a poll waits for a message. Every poll marks the tab alive; the first sets `card.keys` true (a new Card field), a sweeper clears it 45 s after the last poll, and the server start and shutdown reset it. **The order of the ways in:** `card.send` goes through the channel when there is one, else the launcher when it is alive, else reopens the tab (§85) and waits for whichever connects first. `card.answer` with no `requestId` types `1` or Escape through the launcher. `card.focusTab` never reopens while the launcher is alive.
- **The reopen guard is the tab itself.** Before opening a second tab, `reopen` asks Windows Terminal whether a tab titled with the card's key exists (the focus script's new `-Find`, which only looks), and refuses with *g brings it forward* when it does; the two-minute hook check stays as a first look. The launcher's polling is the other signal.
- **The page:** `reachable(card)` (`shared/cards.ts`) is channel or launcher, and not ended; the box reads *Send* either way, with a note under it when the launcher is the way (*Typed into its tab: channels aren't allowed here…*); `askOf` marks an ask `typed` when only the launcher is there, so `y` / `n` and Approve / Deny work (a question is still answered by typing). `cards.seed` takes a `token` on a test server, so a launcher started by hand can prove itself to a seeded card.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (321: the Typist's queue, polls, waits, refusals and the alive signal). **`walk-type.cjs` (9), the real thing:** a card seeded with a token and no channel; the real launcher started in a real Windows Terminal tab the way the server starts it (title `KEY-9`, the card's variables, a stand-in for claude that logs every raw key it gets); within seconds the card said its tab could be typed into; the open card showed *Send* and the note; `Enter` put the cursor in the box; what was typed there arrived in the tab's console as those characters and Enter; a two-line message arrived as backslash + Enter between the lines; allow typed `1` and deny pressed Escape; `g` found the tab and reopened nothing; the stand-in exited on *bye*. `walk-card` (38), `walk-stack` (44), `walk-back` (16) pass after it. **Not tried:** the keys landing in a real `claude` prompt (the stand-in reads raw keys; Claude Code reads the same console input), the org's "channels not enabled" message alongside the dev flag (the flag stays; `CC_CONTROL_CHANNEL=0` drops it), a tab started before this change (its launcher doesn't poll: the tab check keeps it from being doubled, and `g` is the way).

**To check at VU:** `git pull`, restart. Start a new card: within seconds its box should read *Send* with the typed-into-its-tab note (no channel there). Type a message and `Enter`: it should appear in the tab's prompt and send. When Claude asks to run a tool, `y` on the page should pick the first choice in the tab. On the 1068 card (started before this): the box should say *Resume and send* but sending should refuse with *its tab is open … g brings it forward*, not open a second tab; close that tab for real and send again: a new tab on the session, and the message typed into it once its launcher polls. Say what the tab showed if a key landed somewhere else (the first choice is `1` only when the prompt lists choices).

**Smoke test, round 1 (the owner at VU, 2026-10-02):** "it did resume a session in a new terminal tab, I see my message was sent to the terminal but it never actually got sent (also there is this weird flashing on that terminal session)." Two causes, both in the launcher. **The flashing** was PowerShell's progress bar, drawn in the console by every web request (once a second at the start): `$ProgressPreference = 'SilentlyContinue'`. **The message typed but not sent** was Claude Code's paste detection: characters that arrive together read as a paste, and an Enter right behind them is a line break inside the paste, not a send. The launcher now types the text, waits 700 ms for the paste to settle, then presses Enter on its own. Two more things found on the way: it now types nothing until Claude Code's prompt is on screen (the shortcut hint under the input box, or 40 s), since a resumed session takes a few seconds to come up and keys typed before that are lost; and while it waits it keeps polling, with what came queued in order, so the server keeps seeing the tab alive (the first version blocked, went stale, and the next message was refused). **Verified against the real thing:** a tab with the real launcher and the real `claude` (haiku, acceptEdits, this repo's folder so no trust prompt) on the isolated server: the message typed from the page was sent and acted on (it wrote the file it was asked to), then `/exit` typed the same way closed the session. `walk-type.cjs` (9) passes with the stand-in showing the prompt hint. The launcher is read when a tab opens, so this reaches new tabs on `git pull` with no restart; tabs already open keep the old one.

## 88. + Context on the open card: the new-card popup, over the chat

2026-10-02, the owner: "On the chat area when you have a card open, let's have that be +Context like we have other places and have that bring up the same popup those do to add context to the session. Currently clicking Context takes you to an entirely new page and that's not what I'm looking for; users will want to easily add context from a popup."

**What it did.** `c` (and the Context button) on an open card built an add-to composer and the page showed it as the full three-panel screen (*Add context to a running card*), because the simple look's rule was "adding to a running card always uses the full screen". The simple look's own Add context popup (§59: Repos, Folders and Tickets tabs, `role="group"`) only existed on the new-card screen.

**What it does now.** `openAddComposer` opens the same composer with the picker already up (`adding: 'context'`, on Repos, the cursor in its search box), and `NewCardSimple` draws only the picker over the chat when the composer has `addTo` (a backdrop over the card at z-30; a click outside goes back). The picker in that case is titled *Add context to KEY* with an × and `Esc` in its corner, keeps its tabs, search and rows, marks what the card can already use as *has it* (its repos, its own and related tickets; Enter on one says so instead of adding it twice; a ticket another card has is still fine to relate), adds a *A note for Claude* box, shows the error next to the action, and ends with *Add to KEY* (`Ctrl+Enter`), which goes through the same `addToCard` as before (the Context panel opens on *Added since*). `Esc` anywhere in the popup, its search box included, goes back to the chat; `Tab` in the note box no longer switches tabs. The simple look's keys now also run for an add-to composer (`simpleLook()`), with the kind, model, preview, look and prompts keys off while adding. The legend reads *Add to KEY* and *Cancel* on the popup. The buttons on the card read *+ Context* (the message box's and the Context panel's). The full look (`newCardLook: 'full'`) keeps its three-panel add screen. `?` and README.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (321; the legend's *Add to KEY* / *Cancel* on the popup). `walk-card.cjs` (43, light and dark): `c` on the plan card opens *Add context to SHOP-150* over the card with no full screen, the card's repo is marked *has it*, a note and `Ctrl+Enter` add it and close the popup, the note waits under *Added since*, `c` then `Esc` goes back to the chat; the popup looked at in both themes. The simple look's own net after the picker change: `walk-simple` (43), `walk-context` (16), `walk-folders` (14), `walk-sources` (25), `walk-back` (16) pass. **Not tried:** the Folders and Tickets tabs on a running card in the walkthrough (the same code as the new-card screen's, which those walkthroughs cover); the full look's add screen (unchanged).

**To check at VU:** on an open card, `c` or *+ Context*: the popup should open over the chat with the cursor in the search box; tick a repo or a ticket, write a note, `Ctrl+Enter`; the Context panel should list it under *Added since*, and it should go in with the next message typed to the card. Say whether Repos is the right tab to open on, or whether Tickets (or the note) should come first.

## 89. The launcher first: where channels are off by policy, the channel still connects and drops what it sends

2026-10-02, the owner at VU: "it's successfully bringing up a terminal with the claude session to resume but my input text never gets sent", and "remember that channels are disabled for my org at VU and claude keeps telling me this after we start the session, so maybe that's the problem".

**The cause.** It was. Claude Code's binary has the answer: a channel server under an org with `channelsEnabled` off is loaded as a plain MCP server and marked `skip` (`kind: "policy"`), and each channel message that then arrives is shown as *Channels are not enabled for your org · have an administrator set channelsEnabled: true in managed settings* instead of being delivered. So at VU the card's channel script (`hooks/cc-control-channel.mjs`) started, connected and said hello like anywhere else, the server set `channel` true and sent every message through it, and Claude Code showed that notice and dropped it; the launcher in the same tab (§87) was polling the whole time and would have typed it. §87 had assumed the two never met (the flag was observed false at VU before, when the tabs predated the channel script's reconnects).

**What it does now.**
- **The launcher comes first.** `typeInto` (`server/index.ts`) types through the tab's launcher whenever it is alive, and only otherwise through the channel. A relayed permission prompt (one with a `requestId`) still goes back through the channel: Claude Code only relays those when the channel really works. `askOf` marks a hook's ask `typed` whenever the launcher is there and no prompt was relayed, channel flag or not, so `y` / `n` type `1` / Escape at VU; the box's note says *Typed into its tab* whenever the launcher is the way, and the Send button's tooltip says which way it is.
- **One line in server.log per send** (`send KEY: …`): no way in and the reopen, how long the tab took to answer and which of the two came up, how many characters went through the launcher or the channel, or why nothing was sent. At VU, `~\.cc-control\server.log` now says what happened to a message.
- **A seeded card can sit on a real session** (`cards.seed … sessionId`, test servers only), so the resume path can be tried against the real `claude --resume`.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (322: the ask is typed with the channel flag true and the launcher there, not typed without a launcher, relayed with its id when a prompt was relayed, never for a question). **`walk-resume.cjs` (11), the real thing:** a real session made with `claude -p` in this repo's folder, a card seeded on it with its session ended and no way in; on the open card *Resume and send* shows, `Enter` puts the cursor in the box, a typed message and `Enter` send; the server opened a new tab with `claude --resume`, the launcher polled within 1.5 s, the message arrived as a user turn in the session's transcript and was answered, the box emptied, the server log reads *no way in … reopening its tab*, *the tab answered after 1453 ms (channel false, launcher true)*, *34 chars through the launcher*; the channel then connected too (this laptop allows channels) and was not used; `/exit` sent the same way ended the session. `walk-card.cjs` light and dark, `walk-simple`, `walk-type` (the real launcher with the stand-in) pass after it. **Not tried:** the policy itself (no org here has channels off): the binary's strings are the evidence that the channel connects and drops, and the launcher-first order makes the question moot while a launcher runs; a card whose tab predates the launcher's polling still goes through the channel (there, the notice at VU still comes, and closing the tab then sending reopens it the new way).

**To check at VU:** `git pull`, restart the server. On a card with its tab open: type and `Enter`: the message should be typed into the tab and sent, with no *Channels are not enabled* notice; `y` on a tool prompt should pick the first choice. On a card whose tab is closed: *Resume and send*: a new tab, the message typed once the prompt is up. If a message still doesn't arrive, paste the `send KEY:` lines from `~\.cc-control\server.log`.

**Smoke test, round 2 (the owner at VU, 2026-10-02):** "it brought up the claude session in a terminal fine but it took minutes for my text to go through and when it did, it stacked on top of itself and overrode one another, we need to make sure our text is sent immediately." **Found by giving the launcher a log** (`~\.cc-control\launcher.log`, one line per event with the card's id and the seconds since the tab started: polls that were slow or failed, the prompt coming up, each item typed by size, claude's exit) and running `walk-resume` with it: against the real `claude` the launcher **never saw the prompt** ("gave up waiting for the hint" at 40 s, then 8 s more per item), while the stand-in's was seen at once. Two causes, both in `Prompt-Ready`: (1) it read the screen through the script's own stdout handle, which is not the buffer claude draws into (`CONOUT$` is the console's *active* screen buffer: the launcher opens that now); (2) Claude Code 2.1.287's status line reads *plan mode on (shift+tab to cycle) · ? for agents*, and *? for shortcuts* is gone, so the match is now `? for <word>`, `shift+tab to cycle` or the empty box's *Try "*. With both fixed the message is typed 2.8 s after the tab opens (the log: *prompt ready: its hint is on screen* at 2.1 s). **The stacking:** items that had piled up were typed back to back into a prompt still redrawing after the last Enter; each item now waits for the prompt again (up to 8 s, only in a tab whose hint has been seen) and a sent message is followed by 1.2 s. **Also:** the poll is a plain `HttpWebRequest` with `Proxy = $null` instead of `Invoke-WebRequest`, so a managed laptop's system proxy and its auto-detection never hold a request to 127.0.0.1. **Verified:** `walk-resume` (11) three times (the log before and after each fix), `walk-type` (9). The launcher is read when a tab opens: `git pull` is enough for new tabs, no restart needed for this part.

## 90. Changes: every repo of the card, and folding

2026-10-02, the owner at VU: "we need to make sure that the changes tab shows all changes across all relevant repos/worktrees, I only see the UI project at the moment not the API that we also have changes on - we should also make sure we can collapse files and repo groups which I don't think we can atm."

**Why the API was missing.** `ShipService.changes` read the home folder, the card's worktrees, and any other repo of the card *only if the hooks had seen a file written inside it* (`card.files`). A Current-branch card in a lane of two repos whose API edits were made by hand, by a tool the hooks don't report, or in a tab started before the hooks, showed the UI alone. **Now every repo of the card is read** in the folder it works in there (home, each worktree, each other repo in place); a folder that isn't a git repo is still skipped, and a repo with nothing changed shows its header with *Nothing changed here*.

**Folding (the panel, `ChangesPanel` in `CardView.tsx`).** Each repo's header is a button with a chevron: a click folds its files under it (the header then says *n files* beside its totals) and a click unfolds them (`aria-expanded`). The chosen file's row has a chevron too: `Space`, or a second click on it, folds its diff (the row stays chosen); `Space` or a click opens it again. `z` folds or unfolds the chosen file's repo; `Z` unfolds everything when any repo is folded, else folds every repo. `j` / `k` walk the files on screen (a folded repo's are skipped; the panel hands `line-keys` the shown files' indices through `setChangeCount`, and `f` pops the sheet out on the right file through `changeIndex`). The fold state starts afresh on another card. The legend reads *Fold diff* `Space` and *Fold repo* `z` beside *File* and *Pop out*; `?` has the two rows; README has the row. The full-width sheet (`ChangesSheet`) is unchanged apart from listing every repo.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (322: a repo the hooks saw nothing written in is read all the same; the legend's new labels). `walk-card.cjs` (51, light and dark) on the isolated server: the seeded two-repo card lists payments-api with nothing written there, `Space` folds the chosen diff and unfolds it, `z` folds web-app (its files go, the header counts them), `Z` unfolds every repo, a header click folds with the mouse, a second click on the chosen file folds its diff and a third opens it; the folded panel's screenshot looked at. **Not tried:** a lane whose API lives in a worktree of its own at VU (the same path as a home worktree: `ownFolders`).

**To check at VU:** `git pull`, restart. `Shift+D` on the card: the API's repo should have its own header with its files, whether or not Claude wrote them; click the UI's header to fold it, `z` and `Z` from the keyboard; say whether the fold should be remembered from card to card.

## 91. Claude's questions, answered from the card

2026-10-02, the owner: "fixing when claude asks a question, we should find a way to mimic how claude code asks questions and allow the user to select options as claude displays them (in tabs too) and then submit when you're done (just like claude code). Right now it just says 'claude is asking'."

**What the tab shows (worked out against the real thing).** The AskUserQuestion tool's input is one or more questions, each with a short header, 2 to 4 options with descriptions, and whether several may be picked. Claude Code 2.1.287 draws a form: a tab per question and a Submit tab (`Color · Toppings · Submit`), the options numbered, `[ ]` boxes on a multi choice, *Type something* after the options, *Chat about this* last, then *Review your answers* with *1. Submit answers / 2. Cancel*. Its keys, found by pressing them through the launcher with the screen traced (`CC_CONTROL_LAUNCH_TRACE=1` writes every screen change to `~\.cc-control\launcher-trace.log`; `card.keys` on a test server presses named keys): **a digit picks a single choice and the form moves to the next tab on its own; digits toggle a multi choice's boxes, then Tab moves on; *Type something* on a single choice is the digit after the options, the text, Enter; on the Submit tab, Enter chooses Submit answers.** On a multi choice the *Type something* box loses what is typed (the text never reached the review), so the page offers typed text on single choices only.

**What it does now.**
- **The hooks hand over the whole form.** `PermissionRequest` for `AskUserQuestion` keeps `questions` on the card's ask (`readQuestions`, `shared/questions.ts`: checked and bounded; the first question's text stays as `detail` for the tile).
- **The page draws the same form** (`web/components/QuestionForm.tsx`, in place of *Claude is asking* in `Say`): the tabs (`role="tablist"`, a ✓ on an answered one), the question, its options as radios or boxes with their digit keycaps and descriptions, *Type something* on a single choice (`q-other-<n>`: Enter is done with it, Esc leaves it), and on Submit a review of the answers and *Submit answers* `y`. **Keys:** `1`–`9` pick (a single choice moves on), `Tab` / `Shift+Tab` the next / previous question (clicks on the tabs too), `y` submits; `questionHooks` in `line-keys.ts` is how the form takes them while it is up. Not every question answered: `y` goes to the first one missing and says so. The legend reads *Pick* `1 9`, *Next question* `Tab`, *Submit answers* `y`; `?` and README have the row.
- **The answers go back as the form's keys.** `card.answerQuestion { answers: [{ picks, other? }] }` checks them against the questions (`readAnswers`, `answersComplete`), builds the keys (`questionKeys`) and has the tab's launcher press them (`Press-Keys` now knows Tab, Shift+Tab, Space, the arrows and Backspace by name, and `type:` + text to type as it is, so an answer that reads "Enter" is still text). Without a launcher (a tab started before, the channel alone) the button says to answer in its tab.
- **Words instead:** a message typed in the box while the form is up closes the form first (Escape) and goes in as the next prompt, the way *Chat about this* would; the box's placeholder says so.
- A seeded card can be in the `question` state (two questions, one multi choice, a launcher said to be there), for the walkthrough and screenshots.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (325: the keys for each case, the input read and bounded, the answers checked, a multi choice's typed text dropped, the legend's rows). **`walk-question.cjs` (10), the real thing:** a real session resumed from the card's box with a message asking for the two-question form; the form appeared on the card from the hooks with its three tabs; `2`, `1`, `3`, `Tab` showed the review with Green and Cheese, Onion; `y` sent them; Claude's reply named Green, Cheese and Onion; the form left the card. `walk-card.cjs` (59, light and dark): the seeded question card shows the tabs, options with digits and descriptions, a digit moves on to the boxes, digits toggle two and stay, `Tab` reviews, `Shift+Tab` goes back, `y` on the seeded card says its tab can't be reached beside the button (the legend bar is off on that test server, so its rows are the legend test's); the form and its review looked at. `walk-resume` (11), `walk-type` (9), `walk-simple` (43) pass. **Not tried:** a form of three or more questions (the keys are the same per question), a question with no options (`kind: "text"`, newer than the schema the hooks sent here), *Chat about this* itself (Escape and a new prompt stand in for it), a form answered in the tab while the page's form is up (the hooks clear the ask when the tool runs, as for any prompt).

**To check at VU:** `git pull`, restart. When Claude asks a question, the card should show the form with the same tabs as the tab; answer with digits and `Tab`, `y` on Submit; the tab should show the picks go in and Claude continue. Say whether the review step is worth keeping or whether `y` should submit straight from the last question.

## 92. Direction: the app runs the card's session; the terminal is the escape hatch

2026-10-06. The owner, on whether to keep going: the app is to be one central hub users never leave (pick up work from Jira, start a Claude session with the gathered context, see every session's status at a glance, Try it, Ship every repo, later releases and deployments; add context as you go, move to a fresh session that keeps the core context, see diffs across every repo). Not a replacement for Claude Code, but "the highest-performance basic match" so people can talk to their sessions from here.

**Why the chat was slow.** §26 put every card's Claude in a Windows Terminal tab and reached it from the page. Reading is the transcript file re-read on change (a message at a time, no streaming); writing is the channel (off by org policy at VU) or the launcher (§87, §89), which scrapes the console for the prompt hint and injects keystrokes with waits. §85 to §91 are four smoke-test rounds in two days, and it broke once when the CLI changed its status line. Claude Code offers no way to join a running terminal session, so "never leave the app" and "the session lives in a tab" cannot both hold.

**Decision.** A card's session runs inside the server through the SDK (`server/session-manager.ts`: streaming partials, `canUseTool` approvals, modes, resume), as in-app sessions always have. The packet and the card's stage tracking go through the SDK's in-process hooks, so `applyEvent` stays. `g` hands the session to a real terminal with `claude --resume` when someone wants the TUI, and the card follows it there through the HTTP hooks and the mirror. The launcher, channel and typist are retired once VU confirms. Phases A to F, with what to change and how to verify each, are in `docs/prompts/continue-hub.md`; each phase gets its own section from §93.

Not planned: Claude Code feature parity for its own sake; any public deployment.

## 93. Phase A: a card's session runs in the app

2026-10-06. The first phase of §92 (`docs/prompts/continue-hub.md`): `Ctrl+Enter` on the new-card screen starts the card's session inside the server, through the SDK, with no Windows Terminal tab, no channel and no launcher.

**What changed.**
- **Start.** `CardService.start` keeps the branch, worktrees and trust, then (instead of `openTab`) fixes the session id up front, saves the card with `runner: 'app'`, and calls `CardOpts.startSession`, which `index.ts` wires to `SessionManager.create(cwd, message, otherFolders, id)`. The boot lines say *Started Claude in the app in `<folder>` with N more repos*, *Gave Claude the packet with its system prompt*, *Linked session…*. Every start of that session (new, resumed, restarted for a repo) gets the card's options through `SessionManager.setCardSessions`: its mode (the last one it reported, else the card's), its model (an alias such as `haiku` is accepted as is; checked live), the packet and the hooks. `settingSources` is left out, which the SDK documents as "all sources, matching the CLI", so the user's settings, allowlists, skills and MCP servers apply as in their terminal.
- **The packet goes in the system prompt, not a SessionStart hook.** A spike against SDK 0.3.283 showed in-process `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop` callbacks firing, but **`SessionStart` never fires for an in-process callback**. So, as the plan's fallback says: `systemPrompt: { type: 'preset', preset: 'claude_code', append: packetText(...) }`. The SDK records the prompt with the session and re-renders it after compaction and in the fresh conversation `/clear` makes, so the packet is there in every case the hook covered; checked live (Claude named a word that was only in the append). What `/clear` loses is what was added since: `followSession` marks those items unsent, so they ride the next message.
- **The card follows the session through in-process hooks** (`appHooks`, `APP_EVENTS`): `UserPromptSubmit` (which also hands Claude what waits on the card, as before), `PreToolUse`, `PostToolUse`, `Notification` and `Stop` go through `CardService.appEvent` to the same `applyEvent`; `card-events.ts` is untouched. Two events aren't hooks: `PermissionRequest` comes from the permission broker (it has the request id), and `SessionEnd` isn't used (the server decides when a session's CLI stops, and a stopped one resumes on the next message). A turn stopped with `Esc` fires no `Stop`, so the session going idle (`sessionIdle`, from the manager's upsert) ends it on the card as *Stopped*. applyEvent's "in the tab" wording is rewritten for app cards (*Plan ready: approve it with y*).
- **Asks.** `canUseTool` → `PermissionBroker.ask` → `cards.appAsk`, which reads the request like a `PermissionRequest` hook and puts its `requestId` on `live.ask`. A parallel tool's `PreToolUse` no longer takes the ask away while the broker waits. `y` / `n` (`card.answer`) → `broker.respond`; an approved plan also sets the mode to *Ask before edits* and moves the card to Build at once (`answered`: the broker settles before the tool runs, so the hooks' `PostToolUse` can't tell applyEvent the plan was approved). The question form (`card.answerQuestion`) → `broker.respond(reqId, 'allow', question → picked labels)`; `questionKeys` is no longer used for app cards. `askOf` lost `typed`; y / n always go to the server.
- **Chat.** The open card shows the streaming partial (`partials[sessionId]`) under the transcript, the reply word by word. `Esc` on an open card while its turn runs (the session's own status says so, not the card's word for it) sends `session.interrupt`; otherwise it goes back to the board, as before. `session.items` / `session.partial` were already broadcast to every page.
- **Send.** `card.send` → `manager.send(sessionId)`: the message goes straight in, and a session that isn't live (a server restart, or one that ended) is resumed by the send itself. No reopened tab, no `RESUME_WAIT_MS`, no Escape-before-text. `reachable` for an app card: it has a session and it didn't end; an ended one says *Resume and send* and resumes in the app. A terminal card (started before this) is still typed into through its tab while its launcher or channel is there; once its tab is gone (`toApp`: refused while its hooks spoke within two minutes or a tab with its key is open), the message moves its session into the app.
- **Context added later.** On a live session between turns it goes to Claude at once, as a message of its own (`takeWaiting`, marked sent); while Claude works it waits for the next message, as before. A repo added joins the session through `SessionManager.addDirWhenIdle` (the SDK restart in place, same id and transcript; a busy session takes it once idle), so `laterText` no longer asks for `/add-dir` on an app card.
- **Server restart.** On start, an app card that was working or asking becomes *waiting* with the boot line *The server restarted; the next message resumes the session*. A resume never forks a card's session (its fresh file is this server's own work, not a terminal's). Measured: the first send after a restart queued in 26 ms, first partial 1.6 s.
- **`g`** on an app card, between turns: the app stops its query and `reopen(id, fromApp)` opens a Windows Terminal tab with `claude --resume` and the card's hooks, as the escape hatch; the card becomes `runner: 'terminal'` and follows the tab through the HTTP hooks (Phase B makes this the only tab path and retires the launcher). While Claude works, `g` says *Esc stops it first*. The header button reads *In a terminal*.
- **Removing a card's worktrees** stops its app session first, and when git can't delete a folder Windows still holds for a moment it is deleted here, with retries, then pruned (found by the walkthrough: a worktree left behind, unregistered).
- **Legacy, one release:** `CC_CONTROL_CARDS_IN_TERMINAL=1` starts cards in a tab as before (the page's *What happens* follows it). The launcher, channel and typist stay until Phase B; `channel`, `keys` and `relayed` on `Card` are marked legacy.
- **Doctor:** *Card sessions: run in the app*; Windows Terminal is optional (for `g`); the channel line shows only with the legacy flag. **README:** *Talk to the session from here* rewritten, and the rows for `Enter`, `y` / `n`, `Esc`, `g`, `c`, the question form, the trust question, Delete, and the design note on how cards run. **Keys:** no new ones; `?` rows and the legend say what each does now (`Esc` *Stop Claude* while a turn runs, `g` *In a terminal*).
- Server log: `send KEY:` lines stay, plus `first partial after N ms`, `first reply after N ms` and `y → TOOL ran after N ms` (Phase C makes them a budget).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (334: the hook adapter, the app-session events with no token, the broker's ask held through a parallel PreToolUse and answered, the restart notice, /clear following, the session options, `askOf` without `typed`, `reachable` on each phase, `laterText` without `/add-dir`, the launch lines both ways, the seeds, the legend's `Esc` and `g`). **`walk-hub.cjs` (29), the real thing** on an isolated server (Haiku, a fresh DB; it starts and restarts the server itself): a card made on the new-card screen (not seeded) started in 0.3 s with its session linked; the plan streamed in (a partial on the page before the message) and `y` approved it; Claude wrote the file in the card's worktree and the card moved to Try it; a second message streamed and was answered; a Bash prompt was answered with `y` and the folder appeared; the question form was answered with `2` and `y` and Claude received *Green*; `Esc` stopped a long reply in 0.2 s and a second `Esc` went back to the board; the reopened card showed its transcript; after a server restart the card waited and the next message resumed the same session with the earlier conversation; removing its worktree worked. Screenshots light and dark, looked at. `walk-card.cjs` (59, light and dark) passes with its seeds as app cards (a request id on the ask); its *idle, no channel* card stands for a terminal card whose tab is gone. **Measured** (Haiku, server log): send → first partial 0.8 to 1.6 s (5.3 s for the first turn of a new card, which includes the CLI starting and planning); `y` → the tool ran 15 ms (a plan) and 0.9 s (a Bash command, its run included).

**Not tried:** `g` handing an app session to a real tab (the path is the existing `reopen`, now without the alive check; it opens a tab on screen, so Phase B's walkthrough covers it), a card on Opus or Sonnet aliases (Haiku by alias and by id both ran), auto mode, `/clear` typed into a card's box (`followSession` is unit-tested; the manager's own `/clear` following is older and unchanged), adding a repo to a live idle card (`addDirWhenIdle` reuses the in-place restart `addDir` already used), compaction. `walk-resume.cjs` and `walk-type.cjs` weren't run: they test the launcher's way into a tab, which a send no longer takes once the tab is gone (it moves the session into the app); Phase B retires them.

**To check at VU:** `git pull`, restart (it stops whatever runs in the app). Make a card: there should be no tab; the chat should stream; `Enter`, `y` / `n`, the question form and `Esc` should all work on the card; a restart, then a message, should resume it. The org's proxy matters only to Claude Code's own API calls, as in a terminal. If anything breaks, `CC_CONTROL_CARDS_IN_TERMINAL=1` in `config.env` goes back to tabs. After one round there, Phase B retires the launcher and channel.

## 94. Direction: speed first; the other hub phases are tabled

2026-10-06. The owner, after trying §93: the app has to be "fast as fuck" and never leave anyone wanting to switch back to a Claude Code terminal; switching between sessions (implementation, smoke testing, QA, code review, shipping, a session starting with its context) has to be effortless. **Phases B, D, E and F of `docs/prompts/continue-hub.md` are tabled.** The work now is performance and smoothness only, against a measured budget (key to paint, card switch, send to first text, y to tool, new card to first text, a busy board), enforced by a walkthrough. Leads, the budget and how to work are in `docs/prompts/continue-speed.md`; each change gets its own section from §95.

## 95. The speed budget, measured: `walk-perf.cjs` and the before numbers

2026-10-06. The first step of §94: measure everything before changing anything. `docs/walkthroughs/simple-new-card/walk-perf.cjs` starts its own isolated server (:7791, a fresh DB, Haiku), seeds 20 cards with 300-item transcripts in a Demo lane, and measures in the page, against the budget in `docs/prompts/continue-speed.md`. It prints each number with its budget and fails when one is over (`--report` never fails; `--no-real` skips the real card).

**How it measures.**
- **In the page** (an init script): every keydown's timestamp to the frame after the one that paints the result (`requestAnimationFrame`, then a task); a `PerformanceObserver` for long tasks; frame gaps; the bytes and messages the app's WebSocket receives, by message type; main-thread busy time from the DevTools metrics (`TaskDuration`); the JS heap.
- **Three sessions streaming, repeatably, with no API cost:** `perf.stream` (test servers only, like `cards.seed`) turns seeded cards' sessions into phantom live sessions (`SessionManager.phantom`, no CLI under them) and feeds them made-up turns (`server/perf-stream.ts`): a text delta every 25 ms, a tool's `PreToolUse` / `PostToolUse` through `cards.appEvent` every ~3 s, a message landing every ~10 s. The messages go through `SessionManager.feed` → `handle`, the path a real CLI's take, so what the server sends and the page does is the real thing.
- **One real Haiku card** made on the new-card screen: Ctrl+Enter → the card open; first streamed text; y → the tool ran (server log); Enter → the message in the chat; send → first text, with our share split from the model's (the page's time less the server's *first partial* less its *into the CLI* time, a new figure on the `send` log line); Ctrl+K → its session on screen; a server restart → the next message's first text. Plus the eight most recent history sessions opened cold (the server reads their files).
- `cards.seed` takes `size` (made-up earlier turns: reads, edits with diffs, markdown with code blocks). The open card's root and its chat carry `data-card` and `data-chat` for the walk.

**Before** (this laptop, headless Chromium, Haiku; three runs, ranges):

| Interaction | Budget | Before |
|---|---|---|
| A key in the message box → painted, nothing streaming (p95) | 16 | 5 ms |
| … while 3 other cards stream (p95) | 16 | 9 to 10 ms |
| … while the open card streams (p95) | 16 | **18 to 26 ms** (max 34 to 62); main thread **56 to 59 % busy** |
| Enter / → to a card, cold, 300 items (median) | 300 | 38 to 43 ms |
| ← to a card, warm (median) | 100 | 28 to 35 ms |
| Ctrl+K → a session → on screen (warm) | 150 | 13 to 16 ms |
| Enter (send) → your message in the chat | 50 | 11 to 14 ms |
| Send → first text: our overhead | 100 | 8 to 10 ms (the model's own: 3.7 to 6.9 s on Haiku today) |
| y → the tool ran (plan approval) | 100 | 26 to 32 ms |
| Ctrl+Enter on the new-card screen → the card open | 300 | 239 to 241 ms (git worktree included) |
| New card → first streamed text | — | 6.3 s |
| Board, 20 cards, 3 streaming: long tasks over 50 ms | 0 | 0; frames p95 7 ms; main thread 8 to 9 % busy |
| Server restart → next message's first text | 2500 | 1.6 to **2.6 s** (resume 14 ms; the rest is the CLI starting and the model) |
| A history session opened cold (491 items, 505 KB) | — | 34 ms on the server |

**What the bytes say.** On the board with 3 sessions streaming the page receives **159 KB/s** (98 messages/s): `session.partial` resends the whole reply so far on every delta (514 KB in 5 s, growing with the reply's length: O(n²)), and every hook event broadcasts **all 20 cards** (38 KB each). With the open card streaming, 200 KB/s. A page load is 87 KB (the sessions list 46 KB, the cards 39 KB).

**What it means.** On this machine every interaction but one is inside the budget already; the exception is the one that matters most while working: **typing while the open card streams**. The chat re-renders its whole 300-item transcript (react-markdown for each message) on every token, so the main thread is busy more than half the time and a key waits for it. On a slower laptop (the VU one) the same work is two to four times longer, so the margins elsewhere are thinner than they look here. The traffic grows with reply length and card count, which this run's short replies and 20 cards understate.

**Found on the way** (not speed, recorded for later; §98 corrects the cause): when the app stops a card's session (`q.close()`, a worktree removal, a restart), the CLI's MCP servers (started through `npx` / `cmd`) outlive it on Windows. They keep the card's worktree as their working folder, so the folder can't be deleted (*EPERM*), and they pile up: the machine had dozens of orphaned `mcp-server-trello` processes going back to 9/28. The walk stops its card's session before restarting the server and retries the removal; it doesn't fix the cause.

**Verified:** `pnpm typecheck`; `walk-perf.cjs` end to end three times (22 checks pass; the numbers above; it fails on the open-card typing budget, as it should until that is fixed).

## 96. The chat doesn't redraw itself per token; no AudioContext on the first key

2026-10-06. The first fix of the speed push (§94), the one §95 measured over budget: typing while the open card streams.

**Why it was slow.** `Chat` (and `SessionView`) read the streaming partial from the store, so every token re-rendered the whole chat: all 300 transcript items, react-markdown for every message, and the partial itself parsed again from its start. The main thread was 56 to 59 % busy with one card streaming at 40 deltas a second, and a key waited for it.

**What changed.**
- **`Streaming`** (`web/components/Transcript.tsx`): the text Claude is writing is its own component, the only one that reads `partials[id]`; `Chat` and `SessionView` only ask whether there is one. It splits the text into blocks (`web/stream-md.ts`, `streamBlocks`: blank lines outside code fences); finished blocks are memoised and parsed once, only the last one again as it grows. It keeps the chat at the bottom through an `onGrow` callback rather than the chat's own effect on the partial.
- **`Transcript` is memoised**, and so are its parts: blocks and results are computed once per items array, `Item` renders again only for its own item, `Steps` only when its tools or their results change (`sameSteps`; `toBlocks` makes new arrays each time). The chat's "new since you last looked" halves are memoised slices.
- **One store update per frame for partials** (`web/ws.ts`, `queuePartial`): deltas that arrive within a frame are applied together (a 50 ms timer stands in when the tab is hidden and gets no frames). A clear goes at once, so the landed message and the partial never show together.
- **The chimes are WAV clips** (`web/chime.ts`, `chimeWav`, the same notes and envelope rendered to samples) played by an `<audio>` element. The `AudioContext` the first key made (so a chime could play later) blocked the page for **~200 ms** on Windows: the first key pressed after every load (found by the walk's long-task log, placed with its phase marks). Made lazily at the first chime, it froze the page then instead; an `<audio>` element decodes and plays off the main thread. Checked: the clip decodes and plays in Chromium (0.42 s).

**After** (same machine and walk as §95):

| | Before | After |
|---|---|---|
| A key → painted while the open card streams (p95) | 18 to 26 ms (max 34 to 62) | **10 ms** (max 11) |
| Main thread while the open card streams | 56 to 59 % | **20 to 22 %** |
| Long tasks in the whole walk (seeded part) | one of ~200 ms (the first key) | **none** |
| Key → painted, nothing streaming / 3 others streaming | 5 / 9 ms | 5 / 9 ms |
| Card switch cold / warm (median) | 38 to 43 / 28 to 35 ms | 41 / 29 ms |

The other numbers didn't move, as expected: the bytes are §97's.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (340: `streamBlocks` on paragraphs, an unfinished blank line, fences open and closed, and that the blocks rejoin to the text; `chimeWav`'s header, length and peak). `walk-perf.cjs --no-real`: all within budget. `walk-card.cjs` 59/59 light and 59/59 dark (the open card in every state, the partial included).

## 97. Traffic: streaming text as deltas to the page that shows it, one card per change, cards in memory, warm opens send nothing

2026-10-06. The second fix of the speed push (§94), the bytes §95 measured: 159 KB/s on the board with three sessions streaming, 200 KB/s with one of them open, growing with each reply's length and the number of cards.

**What changed.**
- **Streaming text** (`server/partial-stream.ts`, `PartialFanout`): the session manager still reports the whole reply so far per token; the fan-out sends each page only the session it has open (its last `session.open`), only what it hasn't got (`session.partial` gained `from`: append at that offset; absent, the text is all of it), and at most one message per 30 ms per session: the first token at once (so first text isn't delayed), the rest coalesced, a clear at once (the message is landing). Opening a session sends where its reply is now, even nothing (a page that looked elsewhere while a message landed would otherwise keep a stale partial). `/clear` and forks carry the watchers over. The page applies deltas in `queuePartial`; the open card re-opens its session after a reconnect so the server knows again what it shows.
- **One card per change** (`card.upsert`, with `nextKey`): `CardService.changed(card)` names the card it saved, and the page replaces just that one, keeping the other cards' objects (nothing that shows them redraws). The whole list still goes on connect and when a card is deleted. Each hook event of a busy turn used to send all 20 cards (38 KB); now about 2 KB.
- **Cards in memory** (`Store.loadCards` / `loadCard`): read from SQLite once and written through on every save and delete. `get`, `list`, `bySession` and the hook path parsed every card's JSON several times per hook event. Each read hands out shallow copies, so code that changes a card before saving it (`reopen`, `sessionStart`) changes nothing else; a save stores its own parsed copy.
- **Warm opens send nothing** (`web/transcript-merge.ts`): `session.open` says what the page holds (`have`: its count and last uuid), and the server sends only what follows (`session.transcript` gained `from`). Whole transcripts are merged by uuid, keeping the page's own objects, and the store isn't touched when nothing changed. Before, a warm card switch drew the cached chat, then drew all 300 items again when the server's identical copy arrived (new objects, so nothing memoised held), and sent ~50 KB to do it.
- `PROTOCOL` 26. A page from before this on a new server would show streaming text wrongly (it reads each delta as the whole text) until it reloads; a new page on an old server works (it gets whole partials, all cards and whole transcripts, which it still handles).

**After** (same walk; the board with three sessions streaming, five card switches, one open card streaming, a real Haiku reply):

| | Before | After |
|---|---|---|
| Board, 3 streaming | 159 KB/s, 98 messages/s | **2.3 KB/s**, 1 message/s |
| Open card streaming | 200 KB/s | **8 KB/s** (30 messages/s) |
| 5 warm card switches | ~50 KB each, a second full redraw | **924 bytes in all**, no redraw |
| 5 cold card switches | 260 KB | 260 KB (the transcripts themselves) |
| Main thread, open card streaming | 20 % (§96) | 18 to 20 % |
| A real reply on the open card | — | 12 KB/s, of which one 46 KB `sessions` snapshot (below) |

Everything else held: key → paint 5 / 9 / 10 ms (p95: idle, others streaming, the open card streaming); cold / warm switch 41 / 34 ms; Ctrl+K 15 ms; Enter → message 13 ms; our overhead on first text 15 ms; y → ran 22 ms; Ctrl+Enter → card 222 ms; restart → first text 1.6 s. No long tasks.

**Still open, measured:** the history index (`HistoryIndex`) refreshes 1.5 s after any `.jsonl` write, the app's own streaming sessions included: `listSessions(300)` takes ~120 ms here (mostly async; the event loop stalls 11 to 13 ms), and then every page gets the whole sessions list (46 KB). That is one per 1.5 s while anything streams. Next.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (351: the fan-out's windows, clears, mid-reply opens, a page moving between sessions, renames; the store's write-through cache; the transcript merge's tails, races and uuid reuse). `walk-perf.cjs` (24, all within budget), `walk-card.cjs` 59/59 light and dark, `walk-hub.cjs` 29/29 (real Haiku: the plan and replies streamed, y, the question form, Esc, reopen, restart and resume).

## 98. Starting sessions: the CLI starts while you type, worktrees in parallel, no history refresh while a session streams; prewarm tried and dropped

2026-10-06. The third step of the speed push (§94): the numbers left over after §96 and §97 are the starts (new card → first text 5 to 7 s, restart → first text 1.6 to 2.6 s) and one hot path §97 found (the history index refreshing while a session streams).

**What changed.**
- **A card opened while its session isn't running starts it** (`SessionManager.warm`, from `session.open`): after a server restart, or once a session has ended, opening the card resumes its session in the background, so the CLI's start (0.5 to 0.8 s) happens while you type and Enter goes straight in. Only for cards the app runs, not done, with their folder there; never for other sessions (opening a terminal's session must not resume it). A send joins a start in progress. At most two such sessions with no message yet run at once (`WARM_MAX`): opening a third stops the oldest, if it has been up 30 s (`WARM_SETTLE_MS`, so its MCP servers have finished starting). Measured in `walk-hub`: after the restart the message went in "in 0 ms" (not "resumed") and the first text came 0.7 s later.
- **Worktrees are made in parallel** (`makeWorktrees`): each repo's `git worktree add` at once; if one fails, the ones made are taken back as before. Ctrl+Enter → the card open: 222 to 241 ms → **137 to 145 ms** for two repos.
- **No history refresh for the app's own sessions while they run** (`HistoryIndex`, `ownerOfFile`): every `.jsonl` write scheduled `listSessions(300)` (~120 ms here) and then sent every page the whole sessions list (46 KB), once per 1.5 s for as long as anything streamed, the app's own sessions included. Writes to a session the app runs now (its own file, or its subagents') don't refresh; it already knows their state, and retiring a session refreshes once. Writes from terminals still do.
- **Server log:** `send KEY: CLI ready after N ms` (the CLI's first `init`; *started when the card was opened* when the card started it), so a start splits into the CLI's share and the model's.

**Tried and dropped: prewarm.** The SDK's alpha `prewarm()` / `claim()` (0.3.283) parks a started CLI to claim later. A spike against cold `query()` on Haiku in a demo repo, two runs each: init 737 to 763 ms claimed vs 708 to 798 ms cold, first text 1.5 to 1.6 s either way. The claim still waits for the per-folder start (CLAUDE.md, git context, session registration, the user's MCP servers), which is most of it. It also can't resume (no `resume` in a claim, so no help after a restart), can't take a fixed session id (cards link theirs up front), and fixes hooks and `canUseTool` at prewarm. Not worth building on.

**Where the start time goes now.** New card → first text: worktrees ~140 ms, the CLI ready at ~0.8 s, then the model planning with the packet (4 to 6 s on Haiku today). Restart → first text: 1.1 to 2.0 s in the walk, which types its message at once; a person typing for a second or two finds the CLI ready, and waits only for the model.

**Correction to §95.** Stopping a session through the SDK (`q.close()`) normally takes its MCP servers with it: a spike stopped a session both ways (`close()`, and ending its input) and none of its 8 MCP processes outlived it. The orphans come from killing the server's process tree (`taskkill /F`, `Stop-Process`: the walks' restarts, and the way the owner's server has been restarted), and once after a removal soon after a resume. `walk-perf` now stops what its sessions left running (MCP processes it started whose parent is gone) before removing the worktree.

**After** (`walk-perf.cjs`, two runs):

| | Before (§95) | After |
|---|---|---|
| Ctrl+Enter → the card open (2 repos) | 239 to 241 ms | **137 to 145 ms** |
| Server restart → next message's first text | 1.6 to 2.6 s | **1.1 to 2.0 s** (resume 1 ms; the CLI already starting) |
| A real reply's traffic | 12 KB/s incl. a 46 KB `sessions` list | **4.4 KB/s**, no `sessions` list |
| New card → first text | 6.3 s | 5.3 to 6.9 s (the model; the CLI ready at 0.8 s) |

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (352: `ownerOfFile`; the worktree tests in parallel, the rollback included). `walk-perf.cjs` 24/24 within budget; `walk-card.cjs` 59/59 light and dark; `walk-hub.cjs` 29/29 (the restart, then the card opened and its session resumed before the message).

## 99. A slower laptop: the chat opens in pieces, parses each message once, skips what is off screen, and gives frames to typing

2026-10-06. After §96 to §98 every budget held on this laptop, but the VU laptop is slower. `walk-perf.cjs --cpu=4` (DevTools CPU throttling, the page 4× slower) showed what would break there: a warm card switch 193 ms (budget 100), a key while the open card streams 22 to 25 ms (16), the main thread 68 to 70 % busy while it streams.

**What changed.**
- **Each message's markdown is parsed once** (`md()` in `Transcript.tsx`): react-markdown's `Markdown` is a pure function of its text, so its output is kept by text (the 600 most recently drawn). A card opened again, or a chat drawn again, no longer parses its messages again; finished blocks of a streaming reply use it too.
- **A long chat opens in two steps:** the newest 40 blocks at once, the rest in a React transition (`startTransition`), which yields to keys. The chat sits at the bottom, so the older part arrives above the view and the scroll keeps its place. Each card's transcript is keyed by card (and the full-screen one by session), so a switch starts afresh.
- **Blocks off screen skip layout and paint** (`content-visibility: auto` with a remembered size on the chat's blocks, `web/styles.css`): the text being written no longer relays out 300 messages per frame.
- **Typing comes first** (`web/ws.ts`): within 200 ms of a key, streaming text is drawn every 120 ms instead of every frame; it catches up when you pause. Tried and dropped: `useDeferredValue` on the streaming text (each update rendered twice: the main thread went from 68 to 81 %).
- `walk-perf.cjs`: `--cpu=N`; a key in the full-screen session's box (a controlled field, so each key renders the view) is measured too; its real card's first message is unique per run, so Ctrl+K can't pick an older session with the same title.

**After:**

| | 1× before | 1× after | 4× before | 4× after |
|---|---|---|---|---|
| Cold card switch, 300 items (median) | 41 ms | **22 ms** | 222 ms | **63 ms** |
| Warm card switch (median) | 34 ms | **10 ms** | 193 ms | **41 to 48 ms** |
| Longest task while switching | none | none | 270 ms | **105 ms** (the first, cold) |
| A key → painted, the open card streaming (p95) | 9 to 10 ms | 9 ms | 22 to 25 ms | **17 ms** |
| Main thread, the open card streaming | 18 to 20 % | **12 %** | 68 to 70 % | **41 %** |
| A key → painted, nothing streaming / others streaming (p95) | 5 / 9 ms | 5 / 9 ms | 12 to 17 / 13 to 14 ms | 9 / 13 ms |
| A key in the full-screen session's box (p95) | — | 4 ms | — | — |

At 4× one number stays over: a key while the open card streams, 17 ms against 16. Even with nothing streaming a key costs 7 to 9 ms there (the field's own paint), so the margin left is small. At 1× it is 9 ms.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (352). `walk-perf.cjs` 25/25 at 1×; at 4× everything but that one key number. `walk-card.cjs` 59/59 light and dark. `walk-hub.cjs` 29/29; one earlier run failed *the plan streamed in first* because Haiku went straight to the plan tool without writing any text (the server log has no first partial for that turn), the next run passed.

## 100. Tickets past the work show in Done, not the Inbox

2026-10-06. The owner: Jira tickets in *Ready for PO*, *Ready for Prod* or *Done* belong in the Done column, not the Inbox.

**What changed.**
- `DONE_STATUSES` gains *Ready for Prod* (now *Done, Ready for PO, Ready for Prod*; `CC_CONTROL_DONE_STATUSES` still replaces the list). The same list already moved a card to Done when its ticket reached one of them; a card whose ticket reaches *Ready for Prod* now does too.
- A ticket without a card whose status is in the list, or in the tracker's done category, leaves the Inbox and shows in the Done column, above its cards (`finishedTickets`, `lanes(…, done)`). Before, such a ticket stayed in the Inbox when its status wasn't in Jira's done category (*Ready for PO* usually isn't), and one in the done category didn't show at all. The arrows reach it, and `n` / Enter on it still starts a card, as in the Inbox. The same lane filter, search and Inbox view (*Mine* / *Ready for QA*) apply.
- The server sends its list with the tickets (`doneStatuses` on `tickets`), so an override applies on the board as well; a page on an older server uses the default.
- The Done column's note: *Merged, or its ticket is past the work*. A demo ticket in *Ready for PO* (PAY-71) shows the case; the demo's SHOP-98 (*Done*) now shows there too. README's `CC_CONTROL_DONE_STATUSES` row says both.

Not changed: what Jira sends. The default JQL (*assigned to you, not in the done category*) still leaves out done-category tickets, so the Done column shows those only when your own `CC_CONTROL_JIRA_JQL` includes them.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (354: the split by name and category, a ticket with a card left out, an overridden list; the Done column's tickets before its cards and reached by the arrows). On an isolated server with the demo tickets: the Inbox keeps the open ones, Done shows PAY-71 (*Ready for PO*) and SHOP-98 (*Done*), → along the row lands on PAY-71; no page errors; screenshot looked at. `walk-card.cjs` 59/59.

## 101. Changes, popped out: repos as headers that fold

2026-10-06. The owner, on the Changes sheet (`f` from the panel, `Shift+D` on the board): the repos blend in with their files, so it's hard to see they are the parent of the changes under them; let them be collapsed and expanded.

**What changed** (`web/components/ChangesSheet.tsx`).
- Each repo's row is a header: ▾ / ▸, a folder icon, the repo's name in bold, a file count, its + / − totals, and what it is compared against on a line under it. The files under it are indented. The headers stay at the top of the list as it scrolls.
- **Folding**, as in the Changes panel (§90): a click on a header folds or unfolds that repo's files; `z` folds the chosen file's repo, `Z` folds every repo or, when any is folded, unfolds them all. A repo folded under the chosen file hands the choice to the nearest file still shown, and `↑ ↓` / `j k` walk only the files shown. The sheet's key row lists `z` and `Z` when the card has several repos; the `?` row for `z · Z` now says the panel and the sheet.
- The change-kind column is wide enough for *CHANGED*, so the file names line up.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (354). On an isolated server, a seeded card on three demo repos (two with changes, one without) opened with `Shift+D`: three headers; a click folds a repo (7 → 3 files) and a second unfolds it; `Z` folds all and `Z` again unfolds; `z` folds the chosen file's repo and the choice moves to a shown file; `j` past the end stays on shown files; no page errors. Screenshots light and dark, looked at. `walk-card.cjs` 59/59.

## 102. Try it: Open opens a stack's UI

2026-10-06. Found at VU, testing Try it with a lane stack (a local UI against a local API): every service came up, the UI reached the API, the logs came through, but **Open** on the UI said *Nothing running yet: t tries it* while the UI was serving.

**Cause.** `openApp` looked the run up as `runs[cardId]`, the key of a card's single recipe. A stack's runs are keyed per service (`runKey`: `card#ui`, `card#orders-api`, §82), so for a stack card it found nothing. The Open button itself showed, because it checks the UI's own run. `o` on the card and in the Output sheet had the same fault.

**Fix.** `appToOpen` (`shared/recipes.ts`, pure): the run that stands for the card, as the tile and the legend already pick it (`mainRun`: the single recipe's, else the UI's, else the first service's), its URL once up, *starting* while it comes up. `openApp` uses it; a PR still opens when nothing runs, as before.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (355: a stack's UI opens over its API, a single recipe's run, starting, stopped, another card's). Not run here: a real stack (it needs the VU repos and their dev environment). **To check at VU:** `git pull`, `pnpm build`, reload (a page-only change: no restart); start the stack, then Open (or `o`) on the UI opens it in a new tab.

## 103. The Changes panel: several diffs open at once; Pop out in its title

2026-10-06. The owner: the *Pop out* link under each open diff opens the whole change set anyway, so it belongs once, in the panel's title; and more than one file's diff should be open at a time (only the chosen file's could be).

**What changed** (`ChangesPanel` in `web/components/CardView.tsx`).
- **Pop out (`f`)** is in the Changes panel's title bar, beside its key and close button, and no longer under each diff. It opens the full sheet on the file chosen in the panel, as `f` did (`popOutChanges`).
- **Several diffs open at once:** a click on a file opens or closes its diff (and chooses it); `Space` does the same for the chosen file; `j` / `k` move the choice without closing anything. Each file's row shows ▾ / ▸ for its own diff. As before, the first file's diff is open when the panel opens; another card starts afresh.
- The `?` row and the legend say it (`Space`: *Open / close diff*).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (355, the legend's Changes labels). On an isolated server with a seeded card on two demo repos: the panel opens with one diff; no Pop out under it; Pop out in the title; two clicks open two more (three open), a click closes one; `Space` opens and closes the chosen file's diff, the others staying; Pop out and `f` open the full sheet on the chosen file; no page errors. Screenshots light and dark, looked at. `walk-card.cjs`: its two checks of the one-diff behaviour (*Space folds the chosen file's diff*, *a second click on the chosen file folds its diff*) failed against this, as they should, and went out in the first commit by mistake; they now check the new behaviour (Space opens the chosen file's diff beside the first and closes it; a click opens a file's diff and a second closes it): 59/59 light and dark.

## 104. Try it from the board: Start, Stop, Restart and Open on a card's tile

2026-10-06. The owner: quick buttons on the card itself, on the board, to start the environment, stop it, restart it and open the UI.

**What changed.**
- **Buttons under the tile** (`TryButtons` in `web/components/TicketLine.tsx`): *Start* `t` (*Start again* after a failed run); while it runs, *Open* `o` (disabled while it starts), stop `t` and restart `⇧R` (icon and keycap, named for screen readers, so the row fits a board column). They show on cards that can run (a recipe, or a lane that has or can have a stack) in Try it or Ship, on the chosen card, and on any card whose app runs or failed; not on every card, so the board doesn't fill with buttons. The tile was one `<button>`; it is now a box holding the card's button (still `#card-…`, which opens the card) and the row, so the buttons aren't nested in it.
- **The buttons leave you on the board.** `tryIt` gained `stay`: a tile's Start doesn't open the card when the app can start as it is (a single recipe, or a stack with a remembered pick); with no pick yet or no recipe it opens the Try it panel or the stack form, as `t` does, because something needs choosing.
- **Restart, `Shift+R`** (`restartApp` in `web/line-keys.ts`), on the board and on the open card: a single recipe is started again (the server's `runs.start` stops the old run first); a stack is started again with its last pick (`card.try` ends the stack's session first, so ports and proxy copy are made afresh). With nothing running it is `t`. No server change. The legend shows *⇧R Restart* while an app runs; the `?` row says it and the tile buttons. README's `t` row too.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (355; the legend's Restart while running, not otherwise). New `walk-board-try.cjs` (19, light and dark) on an isolated server with the stand-in stack: Start on a Try it card's tile brings both services up without opening the card; Open opens the UI in a new tab; Restart starts both again (new start times, back up); Stop stops both and the tile offers Start; a single-recipe card started from its button, then `⇧R` restarts it, `o` opens it and `t` stops it; a Build card shows the buttons only once chosen; `⇧R` on the open card starts it when nothing runs; the `?` row; no page errors. Screenshots looked at (the first layout wrapped in a board column; the stop and restart buttons are icon and keycap now). `walk-card.cjs` 59/59 light and dark; `walk-hub.cjs` 29/29; `walk-perf.cjs`, three full runs: 25/25; 24/25 (the failing check not captured); and one with Ctrl+K unmeasured (-1 ms: the real Haiku card's session not found) that then hung waiting on the model after the restart. Both misses are on the real card's path (the session view, the model), which this change doesn't touch; `--no-real` (every page and traffic budget) 12/12 within budget.

## 105. Verify: is a field in the set, and a record's values, from the card

2026-10-06. Handed off from the work laptop (diagnosis only there): build the Verify panel (`v`) against two of the team's web tools, called here the *field set* tool and the *record lookup*. Their hosts are not in the repo; they are entered per machine in the panel.

**What the tools are** (as probed at VU). The field set tool is a host per environment (dev, uat), JSON wrapped in `{ Successful, Payload }`: `GET /Home/SetVersion` (the current set, 2 to 2.5 MB) and `GET /Home/ValidateField?<id param>=<id>` (exists, in the set, format, options; an unknown id is `Successful: false`). The record lookup is an MVC form (one host, an Environment dropdown): a POST of Environment, the record id field, AdvancedFetch and FieldsToFetch (CRLF between ids) answers with the page again, plus `table#FieldResults` when the record resolves. Both have write paths (the set tool's add-to-set Save, the lookup's update boxes); the app never calls them.

**What changed.**
- **Server** (`server/verify.ts`): `SetTool` (`validate`; `set`, cached ten minutes per environment, one read at a time, with a refresh; `has`, from the cache) and `LookupTool` (`fetch`: one POST, the page read by `parseLookup` into `{ env, recordId, found, fields: [{ id, value, exists, readOnly }] }`; the raw page never leaves the server). **Every request goes through `guard`**, which lets exactly `GET …/Home/SetVersion` and `GET …/Home/ValidateField` on a configured set host, and the POST of the four form fields to the configured lookup address, through, and throws on anything else. Redirects aren't followed (a followed POST becomes a GET elsewhere). The in-set flag is read from whichever `ExistsIn…` key the tool sends, so the tool's internal name isn't in the code; the set's field id key is named in setup or found (the one string key of an entry that isn't a known one). `parseLookup` is a small tested parser over the table (there is no HTML parser in the dependencies): the hidden `Fields[<id>].Value / .Exists / .ReadOnly` win over the visible cells, a salmon row or *(Field does not exist)* is a missing field, no table means no record, and the update inputs are ignored. Errors are said for a person (`explain`: an untrusted certificate, unreachable, no answer) and never include a body.
- **Certificates:** nothing new. The server already adds the certificates Windows trusts to Node's defaults at start (`server/config.ts`, `trustCertificates`; `CC_CONTROL_CA_FILE` for a PEM), which the TFS calls already rely on. The `SELF_SIGNED_CERT_IN_CHAIN` seen at VU came from a plain `node` probe, which doesn't do that. To confirm at VU.
- **Windows sign-in:** the lookup worked there with default Windows credentials, which Node's fetch can't send. On a 401 asking for Negotiate or NTLM, the request is sent again through PowerShell's `Invoke-WebRequest -UseDefaultCredentials` (`windowsTransport`: the request as JSON on stdin, the answer on stdout, nothing written anywhere; Windows' certificate store applies). The lookup's *Sign-in* setting: Auto (that), As you (always PowerShell), None. Not tried for real: there is no such host here.
- **Settings:** `Settings.verify` (`VerifyConfig`, `cleanVerify`): the set tool's address per environment, its add-to-set page (opened only), the id parameter (default `encompassId`, the vendor's name for a field id) and the set's id key; the lookup's form address, its record id field, what its dropdown calls each environment, and how it signs in. Kept in the machine's SQLite settings, never the repo. Settings are saved key by key, so a cleared form is saved as `{}` (found by the walkthrough: clearing kept the old addresses).
- **Protocol 27:** `verify.check` (ids × environments → `verify.checked`: each id through ValidateField, four at a time, with the cached set's version), `verify.refresh` (→ `verify.set`), `verify.lookup` (→ `verify.found`). Errors go to the page that asked, not the log.
- **The panel** (`web/components/VerifyPanel.tsx`, state in `web/verify-state.ts`):
  - *Is this field in the set?*: the ids box starts with the ids the card names (`idsInText`: dotted upper-case ids such as `CX.SAMPLE.ONE`, and numbers after "field" or "fields", from the title, the ticket, its acceptance and your notes). Check shows Dev and UAT side by side (Prod too when it has an address): in set, not in set or unknown, the format and options, and the field's name. A row that differs between them says what differs (`drift`: known, exists, in the set). Under it, each environment's set version and when it was read.
  - *Look up a record*: the record id, the fields to read (empty: the ids above) and Advanced (off by default); a table of values with read-only marked, a missing field as *does not exist*, or *No record found*. **Values live only in the panel's memory:** not in the card, the store's saved state, the log or anything sent to Claude, and gone on the next card or a reload.
  - *Open the tools*: the set tool's page for the environment, its add-to-set page and the lookup's page, in the browser; nothing is submitted from the app.
  - *Setup* (`u`): the form for the addresses. Until something is set, the panel shows a note that explains it.
- **Keys** (the panel's own, ahead of the card's while it is open): `e` Dev ↔ UAT (for the lookup and the pages); `Shift+P` Prod for the lookup after a second press within 4 s (pressed on Prod: back to Dev); `i` the ids box; `l` the record box; `Enter` checks (and looks up when a record is named); `r` reads the set again; `a` Advanced; `o` / `Shift+O` / `Shift+L` the pages; `u` setup. In a box, `Esc` leaves it, `Enter` in the record box looks up, and `Ctrl+Enter` checks, looks up or saves the form; editing keys (paste) go to the box. There are `?` rows and legend entries: `Enter` reads *Check*, and `e`, `o` and *How it runs* / *Open the app* give way while the panel is open. The dock's Verify tooltip, the `?` dock row and README say what it is now.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (370). New tests cover:
- The envelope and `Successful: false`, the in-set key, the set's id key, the cache's expiry, one read at a time, refresh and an unknown id.
- The parser on found, hidden-input, entity, salmon and no-table pages; the lookup's form, Advanced and Prod.
- The Windows retry on a 401, and none with *None*.
- The guard's allowed and refused requests (Save, AddToSet, `../Save`, another host, a GET to the lookup, an update field, PUT), and that every request the clients make passes it.
- `splitIds`, `idsInText`, `drift`, the URLs and the legend.

**`walk-verify.cjs` (36, light and dark)** runs on an isolated server against `standins/verify-tools.cjs` (made-up dev and uat set hosts and a lookup, each logging every request):
- The panel explains setup, and the ids come from the card's title.
- `u`, the form and `Ctrl+Enter` save to the settings.
- `i`, a made-up id, then `Enter`: three rows. *CX.SAMPLE.ONE* is in Dev's set and not UAT's, and is marked as differing; the made-up id is unknown in both; both set versions show.
- `r` reads both sets again.
- `l`, `5001`, `Enter`: the values (entities decoded, read-only marked) and a missing field. `9999`: *No record found*. `a` posts Advanced.
- `e`; `Shift+P` once (nothing) and twice (Prod, and the lookup posts Prod); back again. `o`, `Shift+O` and `Shift+L` open the right pages. `Ctrl+V` pastes into the ids box. The `?` rows are there.
- **The stand-ins saw only SetVersion, ValidateField and the four-field lookup POST from the server; nothing reached a Save or an update; and the server log has no looked-up value.** No page errors.

Screenshots looked at (the Look up button wrapped; fixed). `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19, `walk-hub.cjs` 29/29. `walk-perf.cjs`: every budget within, except *Ctrl+K → a session* unmeasured (-1 ms) on this run and one of §104's: the palette said *Nothing matches* for the real card's brand-new session. The sessions list isn't refreshed for the app's own running sessions (§98), so a new card's session can be missing from Ctrl+K for a while. That is older than this work; it is an open item. An earlier run failed because a worktree from a walk I had stopped was left behind (`web-app-card-1`); removed.

**Not tried here:** the real hosts, the certificate trust against them, and the Windows sign-in (PowerShell) path; all need the VU laptop.

**To check at VU:**
1. `git pull`. This needs a server restart: ask first, and stop any Try it apps.
2. On a card, `v`, then `u`: enter each environment's set address, the add-to-set page, the lookup's form address and its record id field (the form's own name for it), then Ctrl+Enter.
3. One known field id and one made-up: found vs unknown, Dev beside UAT. `r` refreshes the set; `o` opens the right page.
4. A known dev record with two real ids and a made-up one: two values and one *does not exist*. A wrong record id: *No record found*.
5. If the lookup says it wants a sign-in, set *Sign-in* to *As you*. If a certificate error shows, note which one; `CC_CONTROL_CA_FILE` is the fallback.
6. The server log should have no lookup values and no request lines at all.

**Open** (the handoff's *Not yet*): adding to the set from the app (a write: it needs a confirm design and a ticket field); Prod for the set tool, and how Prod lookups should be guarded beyond the second press; whether drift should also compare format and options; and pulling ids from the diff as well as the ticket.

## 106. Ctrl+V pastes into the card's message box again

2026-10-06. Found while walking §105: **Ctrl+V into an open card's message box pasted nothing.** The box's key handler (`sayKeys`) answers *handled* for every Ctrl or Alt combination, so that the app's keys (Ctrl+Enter, Alt+arrows) don't fire from inside the box, and a handled key gets `preventDefault`, which stops the browser's paste. Ctrl+C, Ctrl+X, Ctrl+Z, Ctrl+A and Ctrl+Backspace were blocked the same way.

**Fix.** `editingKey` (`web/line-model.ts`, pure): Ctrl or Cmd with a, c, v, x, y, z, Backspace or Delete, without Alt (Ctrl+Alt is AltGr on some layouts). `sayKeys` lets those through to the box; everything else it held back before (Ctrl+Enter, Ctrl+arrows, which stay the app's, and Alt) it still holds back. The Verify panel's boxes (§105) let every Ctrl key through, since they have no app keys to guard.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (370, `editingKey`: the editing keys with Ctrl and Cmd, not Enter, arrows, a plain key or Ctrl+Alt). `walk-verify.cjs` pastes into the message box with Ctrl+V (it failed before this fix, with the box left empty). `walk-card.cjs` 59/59 light and dark, `walk-hub.cjs` 29/29 (typing and Enter in the box unchanged).

## 107. Verify: no setup form; the tools by name, from a file on the machine

2026-10-06. The owner, on §105: they don't want to set things up, and the panel should call the two tools by their names. They are internal tools, and this repo is public on GitHub (an unauthenticated API read answers 200), so their names and addresses can't be written into the code without publishing them; `CLAUDE.md` says so too. The owner chose a file on each machine: nothing internal in the repo, no form.

**What changed.**
- **The machine's Verify file** (`server/verify.ts`: `VERIFY_FILE`, `readVerifyFile`, `VerifyFileWatch`): `%USERPROFILE%\.cc-control\verify.json`, or the file `CC_CONTROL_VERIFY_FILE` names, next to `config.env`. It holds what `Settings.verify` held (§105), plus each tool's `name`, cleaned by the same `cleanVerify`. A missing file says nothing; one that isn't JSON or is UTF-16 says why. The server checks it every 3 s (its size and time) and on each Verify request; a change clears the cached sets and goes to every page (`verify.config`, also sent on connect; `PROTOCOL` 28). No restart, no reload.
- **No setup form.** `Settings.verify`, the form, `u` and its `?` row and legend entry are gone. Until the file has something in it, the panel says where the file goes and that README's Verify row shows what goes in it; a lookup without `recordField` says that is what's missing. Errors name the file instead of `u`.
- **The tools by name**: the panel's sections are *Is it in ‹set tool›?* and *Look up in ‹lookup› · Dev*, and its buttons, errors and flashes use the names the file gives (lower case "the field set" / "the record lookup" when it gives none).
- **Adding a field to the set** (what the set tool is mostly used for): a field the check found known but not in an environment's set shows *Add in UAT ↗* (or Dev) under it, which opens that environment's add-to-set page with the id copied to paste there. `Shift+O` opens the page for the chosen environment and copies every id the last check found missing there. Still only opened: adding is done on that page.
- `pnpm run doctor`: a *Verify file* line (where, which tools, which environments), a warning when the lookup has no `recordField`, and a failure when the file can't be read.
- README's Verify row: the file's shape, with `example.invalid` addresses.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (372: the file missing, with a BOM, cleaned of unknown keys and bad URLs, not JSON, UTF-16; read again only when it changes; the lookup's error naming the tool and `recordField`; the legend without *Setup*). `walk-verify.cjs` (38, light and dark): no file, so the panel says where it goes and there is no form; Enter says the set has no address; the file written while the panel is open shows within seconds with the tools by name; the check, drift, refresh, lookup, Prod and pages as before; *Add in UAT ↗* only on the field UAT's set lacks, opening UAT's add-to-set page with the id copied; `Shift+O` copied the missing id; the stand-ins saw only the reads and the lookup form; no values in the server log. Screenshots light and dark, looked at (the fallback names read "The field set" mid-sentence; now lower case). `walk-card.cjs` 59/59 light and dark, `walk-hub.cjs` 29/29, `walk-perf.cjs --no-real` 12/12 (the full run's real card doesn't touch this). `pnpm run doctor` with a sample file prints the line and the `recordField` warning.

**To check at VU:** `git pull`, restart (ask first). Write the file once (the owner has the line to paste; it holds the real addresses and names, so it is not in the repo), fill in `recordField` from the record lookup's form, then `pnpm run doctor` and, on a card, `v`. The rest as in §105. The prompt for a session there, with what to expect at each step and where to look when one fails: `docs/prompts/continue-verify-at-vu.md`.

## 108. Start work: the SDK's CLI missing on a machine

2026-10-06. The owner: *Start work* on a new card failed with "Native CLI binary for win32-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable." The SDK runs its CLI from an optional dependency (`@anthropic-ai/claude-agent-sdk-win32-x64`, a 245 MB `claude.exe`). An install that skips optional dependencies, a feed without that package, or antivirus removing the exe leaves none, and every SDK session fails. This laptop had it, so the failing install was elsewhere.

**What changed.**
- `server/claude-exe.ts`: `findClaude` moved here from `cards.ts` (still exported there). `sdkClaude()` picks the CLI for the SDK's sessions, in this order: `CC_CONTROL_CLAUDE`; then the SDK's own binary if it is on disk (the SDK finds it itself); then `claude.exe` on PATH (your own Claude Code install). Worked out once per server run.
- All three `query()` calls (a card's session, the idle one for models and commands, *Write it for me*) pass it as `pathToClaudeCodeExecutable`.
- `pnpm run doctor`: a *Claude for the app's sessions* line that says which CLI is used and fails when there is neither.

**Verified:** `pnpm typecheck`, `pnpm test` (372). With the SDK's `claude.exe` renamed away: doctor reported the fallback to `~\.local\bin\claude.exe`, and a real one-turn `query()` through `sdkClaude()` answered. Then the binary was put back, and doctor reports the SDK's own again.

**To check at VU:** `git pull`, restart (ask first), `pnpm run doctor`. The new line should say the SDK's own binary or the one on PATH. Then *Start work* on a new card. If it says neither, install Claude Code or set `CC_CONTROL_CLAUDE` in `config.env` to the full path of `claude.exe`.

## 109. Start work uses worktrees already made by hand

2026-10-06. The owner: they ran the commands from a new card's *What happens* preview by hand, which made the card's worktrees (`git worktree add <repo>-<key> -b <branch>`). *Start work* then refused, because those folders already existed, so the card couldn't start.

**What changed.**
- `makeWorktrees` (`server/cards.ts`): a folder already there that is a worktree of that repo on the card's branch is used as it is (`worktreeAt` reads `git worktree list --porcelain`). If something else fails, nothing here undoes it. A branch of the card's name with no worktree is checked out instead of made, unless it is already checked out in another folder; that error says so. A folder on another branch, or one that isn't a worktree, gets an error that says what to do.
- A PR card's copy already there (`git worktree add --detach`, from the preview) is used too.

**Verified:** `pnpm typecheck`, `pnpm test` (375). New tests: a worktree made by hand is used and its files are untouched; a branch made by hand is checked out; a worktree on another branch and a plain folder each get their message; a worktree made by hand stays when another repo fails.

**To check at VU:** `git pull`, restart (ask first), then *Start work* on the card whose worktrees exist. The boot steps should list them and the session should open in the home repo's worktree.

## 110. A card's worktrees get the main checkout's node_modules, as a junction; every removal unlinks it first

2026-10-06. Found at VU: a card's API came up, but its UI didn't: `node_modules\.bin\nx.cmd run …:serve:development …` → *The system cannot find the path specified.* The card's UI runs from its own worktree (§53), and a new worktree has no `node_modules`. The owner's stack started the UI straight from `node_modules\.bin`, without the `if not exist node_modules npm install` line a detected stack gets. Even with that line, a fresh install per card isn't possible: the UI is a large monolith. By hand, the owner has used worktrees with a junction to the main checkout's installed `node_modules`.

**Found on the way (a spike, kept as a test):** with Git for Windows 2.53, `git worktree remove`, with or without `--force`, **follows a `node_modules` junction and deletes what it points at**: the main checkout's packages. `fs.rmSync`, `rmdir /s` and unlinking the junction first don't. An install per worktree was built first and dropped on the owner's word (too big to install per card).

**What changed.**
- **`scripts/link-deps.ts`** (runs as a script; the server imports its functions):
  - `depsState`: nothing to do (no `package.json` naming packages, or `node_modules` already there); a link (the main checkout, found through `git rev-parse --git-common-dir`, has a real `node_modules`); or missing (it has none either).
  - `linkDeps` makes the junction, keeps it out of `git status` through `.git/info/exclude` (`/node_modules`: a `.gitignore` entry of `node_modules/` doesn't match a link), and compares the lockfiles. When this branch's lockfile differs from the main checkout's, it says so: the packages are the main checkout's. Nothing is installed into the shared folder.
  - When the main checkout has no packages either, it says to install there once, and the step fails.
- **When a card's worktrees are made** (the card's start, and a repo added later): each worktree is linked at once. The card's boot list says so, warns when the lockfile differs, and says that removing the worktree with git by hand would empty the main checkout's packages.
- **Try it:** a run's steps get a first step, `node scripts/link-deps.ts`, in each folder that still has no packages (`withDeps` in `RunService.start`, for a single recipe and for every stack service). It links them, or stops the run with what to do instead of *cannot find the path*. Folders that have them get no extra step.
- **Every worktree removal here unlinks first** (`unlinkDeps`): Shift+X / Delete with worktrees (`removeWorktrees`), and taking back worktrees when a card's start fails. The error that tells you to remove a worktree by hand now says to `rmdir` its `node_modules` link first.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (381). New tests cover:
- The states, the main checkout found from a worktree, the link made and seen through, `git status` clean with and without a `.gitignore` entry, and the lockfile comparison.
- The script's exit codes and messages.
- Unlinking first keeps the main checkout's packages through `git worktree remove`, and not unlinking loses them on Windows (the reason, pinned).
- `withDeps`: one step per folder, never for `stop:` or `!` steps, none when nothing is needed.

**`walk-deps.cjs` (12)** runs on an isolated server with a demo UI repo whose start line is `node_modules\.bin\standin-ui.cmd`, its main checkout installed once (`npm ci`):
- A real card (Haiku) started in a worktree gets a junction to the main checkout's `node_modules` at once, the card says so, and `git status` is clean.
- A seeded card on a bare worktree: Try it's run has the link step first, then the UI comes up and serves. Run again, there is no link step.
- **Removing both cards' worktrees through the app leaves the main checkout's `node_modules` whole.**

Also passing: `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19, `walk-hub.cjs` 29/29.

`walk-perf.cjs --no-real` measures *a key while a card streams* at 14 to 23 ms p95 on this machine now, against 16. The §104 page, built from before any of today's Verify work, scatters the same way (8 to 23 ms, failing two runs in three), and this change touches no page code. The machine is noisier than this morning, when the same page measured 9 ms. Found while looking: 48 orphaned MCP server trees (§95, §98) from the test servers stopped with `Stop-Process` today, stopped (only those whose parent was gone).

**To check at VU:** `git pull`, restart (ask first; this is server code). Remove the card whose UI failed, or delete its worktree's empty `node_modules` if there is one, then Try it again: its run should start with *Linked node_modules from the main checkout*, and the UI should come up. A new card should say it linked them. When done with a card, remove its worktrees with Shift+X, not `git worktree remove`.

**Open:** a guard against a session's own `git worktree remove` (a PreToolUse hook on card sessions could refuse it); nested `node_modules` (an app folder with its own); a branch whose lockfile changed really needs its own packages, which this doesn't give it.

## 111. The worktree's node_modules is a folder of hard links, so no removal can empty the main checkout's

2026-10-06. The owner, on §110: the main checkout's node_modules must never be wiped on the VU laptop (it takes about 20 minutes to download again). §110's junction made the app's own removals safe, but `git worktree remove` by hand (or a session running it) would still follow the junction and empty them.

**Tried first (a spike, recorded):**
- `git -c core.symlinks=true worktree remove`: git still follows the junction and empties the main checkout.
- A true directory symlink instead of a junction: can't be made without admin rights or Developer Mode (`EPERM` here; likely the same at VU).
- Measured instead: a clone of hard links. A 100k-file node_modules (a pnpm one) took 13 to 35 s to make and 8 to 19 s to delete, and every file of the source was still there with its link count back to 1. A 4.6k-file npm one took 0.6 s. Its only failures were pnpm files already at NTFS's limit of 1023 names per file; npm's files start with one.

**What changed** (`scripts/link-deps.ts`; §110's names kept).
- **node_modules in the worktree is a real folder whose files are hard links to the main checkout's**: the same data on disk under a second name, no extra space, nothing downloaded. Removing the worktree in any way only removes those names.
- **What isn't linked:**
  - `package.json` files are copied, so a tool that edits one in place edits only the worktree's.
  - A file that can't be linked (the 1023-name limit, another drive) is copied.
  - Links inside node_modules are made again: one into the main checkout's node_modules points into the clone, and one into the main checkout (an npm workspace package) points into the worktree's own copy. One to anywhere else is cloned too, never linked, so nothing a removal could follow leads out of the worktree.
- **Built under `node_modules.cc-control-tmp`, renamed when whole**: a clone cut off half way is thrown away and made again, never taken for finished.
- **One clone per folder at a time** (a lock outside the repo). When a card's worktrees are made, the clone runs in the background (`linkInBackground`); the card says *putting the main checkout's packages in*, then *Put the main checkout's packages in (N files as hard links, S s)*. Try it's first step (`node scripts/link-deps.ts`) waits for a clone still going, says so, then starts the app.
- **A §110 junction already in a worktree** (cards made since §110) counts as needing the clone: it is unlinked first, then the clone takes its place, at the next Try it or by running the script there.
- The lockfile comparison, the *install there once* failure and the `.git/info/exclude` entries (`/node_modules`, `/node_modules.cc-control-tmp`) are as in §110. `unlinkDeps` before each removal here stays, for any junction left.
- **By hand:** with a workspace package linked inside the clone, `git worktree remove` follows that link into the worktree's own folder and then stops with *Directory not empty*, leaving the worktree half deleted. Only the worktree is affected; delete the leftover folder. The app's removal already finishes such a folder with `fs.rmSync`, which doesn't follow links.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (382). New tests use a repo whose installed node_modules holds a package, a `.bin` shim, a workspace package linked from it and a link to a folder outside the repo. They cover:
- The states, including §110's junction counting as needing the clone.
- The clone: a real folder; files with two names, `package.json` with one; the workspace link pointing into the worktree; the outside folder cloned rather than linked; `git status` clean; a second run does nothing.
- **`git worktree remove --force` by hand, no unlink first: every file of the main checkout's install, its workspace package and the outside folder still there.** The same after replacing a §110 junction.
- A half-made clone thrown away and made again, and the missing-packages failure.
- Two scripts at once on one folder make one clone.
- `withDeps`.

**`walk-deps.cjs` (16)** on an isolated server:
- A real card's worktree gets the clone in the background, the card says so twice, and the files are hard links. The local `file:` package links to the worktree's own copy.
- Try it on a bare worktree: the clone step first, then the UI serves. Run again, no step.
- **A worktree given the packages and removed by hand with `git worktree remove --force`: the main checkout's node_modules whole.**
- The cards' worktrees removed through the app: the same.

Also: `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19, `walk-hub.cjs` 29/29. `walk-perf.cjs --no-real`: the key-to-paint numbers are still over (19 to 28 ms p95), as in §110's A/B of the page from before any of this (server code only).

**To check at VU:** `git pull`, restart (ask first). A card made since §110 has a junction: press `t` on it and its run should start by replacing the link (*Took away the old node_modules link…*, then *Put the main checkout's packages in (N files…, S s)*) before the UI starts. A new card says the same on its own, in the background. How long the clone takes on the real UI repo is worth noting: at the rate measured here, around a minute for a few hundred thousand files.

**Open:** a guard against a session's own `git worktree remove` is no longer needed for the packages' sake. Nested `node_modules` (an app folder with its own) still get nothing. A branch whose lockfile changed still runs on the main checkout's packages.

## 112. Try it on a stack: one clone per folder for real, built where no tool looks

2026-10-06. Found at VU, on a lane stack (a local UI and a local API): the run's packages step put the main checkout's packages into the card's UI worktree (101,799 files as hard links, 2,754 copied, 162 s, exit 0), then `nx run …:serve` failed with *Failed to process project graph*: ENOENT on `node_modules.cc-control-tmp/@module-federation/runtime-tools/package.json` and `project.json`, and *no name provided* for fifteen projects under `node_modules.cc-control-tmp/`. That folder is where §111 builds the clone before renaming it to `node_modules`, and that rename had already happened.

**Cause** (reproduced here).
- **The lock let two clones through.** A stack starts every service's run at once (`card.try`), and each run gets a packages step for every folder it runs in without packages. When the API's steps also run in the UI worktree, two `link-deps.ts` scripts start on the same folder at the same moment. The lock was a folder made first, with its pid written a moment later; a script that looked in between found no pid, took the lock for a dead one, removed it and cloned too. Two scripts started together on one worktree both cloned in 2 of 30 rounds here (the loser crashed with ENOENT). At VU the second clone kept writing into `node_modules.cc-control-tmp` after the first had renamed its own, and probably left it there half made, so a plain retry fails the same way.
- **Nx reads that folder.** Nx leaves `node_modules` alone but not `node_modules.cc-control-tmp`: a `project.json` in it showed up in `nx show projects` here (Nx 23.2), and a half-made one gives the errors above. An editor or Claude's own searches would walk it too.

**What changed** (`scripts/link-deps.ts`).
- **The lock is made whole, then renamed into place** (`takeLock`): a folder with the pid already in it, under another name. A rename onto a lock that is there fails, so exactly one script gets it and no one ever sees a lock without its pid. A dead holder's lock is moved aside before it is removed (`clearDeadLock`), so only one waiter clears it, and it is put back if it turns out to be live. A lock with no pid that is under 30 s old counts as held (a script from before this change writing it). The holder removes the lock only while it is still its own.
- **The clone is built in the repo's git folder** (`<git dir>/cc-control-deps/<key>`), where no tool looks, and renamed to `node_modules` when whole. It falls back to the worktree only when the git folder is on another drive. Nothing half made is ever in the worktree.
- **A leftover `node_modules.cc-control-tmp` beside `node_modules`** is a new state, `tidy`: Try it gets the packages step, which removes it (*Removed a half-made copy of the packages an earlier run left…*) and finishes without cloning.
- The waiting message says who it is waiting for: *by the card, or another service of this run*.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (386). New tests: eight scripts at once on one folder make one clone and none fails; the worktree holds nothing named `node_modules…` while the clone is built, and the git folder is empty afterwards; a leftover beside `node_modules` is `tidy`, gets Try it's step and is removed; a lock without a pid counts as held while it is new (this one failed before the change, as did the build-folder and tidy tests). The race repro, two scripts at once on an Nx workspace's worktree: 0 double clones in 60 rounds (2 in 30 before). Nx 23.2 on that worktree: a leftover `project.json` listed as a project, and gone after the step tidies it. **`walk-deps.cjs` (20)** adds a stack whose API and UI both run in one bare worktree: both runs have the packages step, one clones and the other waits (*…waiting for it. The packages are here.*), both come up, nothing is left beside `node_modules` or in the git folder; then a leftover is removed by the next Try it. `walk-card.cjs` 59/59, `walk-board-try.cjs` 19/19, `walk-hub.cjs` 29/29 (one of three runs had one failure, which wasn't captured; the next two were clean). `walk-perf.cjs`, three runs:
- Run 1: 23/25. Over: the key while the open card streams (22 ms) and Ctrl+Enter to the open card (327 ms against 300).
- Run 2: 24/25. Over: only the streaming key (18 ms).
- Run 3: 25/25 (7 ms and 226 ms). The same code passed every budget, so the misses are the machine's noise noted since §110.

**To check at VU:** `git pull`, restart (ask first; this is server code, and Try it runs the script from the repo). Then Try it on the same card. The first step should say it removed the half-made copy (or, if both services needed the packages, one clones and the other waits), then the UI should start. If Nx still names `node_modules.cc-control-tmp`, its daemon kept the old file list: run `npx nx reset` in that worktree once, then Try it again.

**Open:** the clone of the real UI took 162 s (about 630 files a second; here it is 3,000 to 7,000). That is likely the laptop's antivirus checking each new link. It happens in the background when a card is made, so it is mostly hidden; a card made by hand, or before §111, pays it at Try it. A parallel clone (async links, several at a time) might help, but it needs measuring at VU first. An API service whose steps run in the UI worktree also waits for the UI's clone, though it probably doesn't need the packages.

## 113. Try it on a stack: the UI heads the services as the one that always starts; a compiling dev server is up when its build is done

2026-10-07. The owner, from the VU laptop: on the Try it panel, a repo that always starts and can't be ticked or unticked (the UI, the card's home repo) should be shown at the top, with why its box is checked and can't be changed. And the UI showed as up before its server had started: it didn't wait for the *compiled successfully* message.

**Cause of the early "up".** A step with no `wait:` was taken to be up when it printed a localhost URL, when its port opened, or after 20 s of quiet (`server/recipes.ts`). A webpack or Nx dev server does the first two at once, then compiles for a minute or more: the app showed as up, with Open, while it still served nothing useful.

**What changed.**
- **The UI comes first** in the Try it panel's services (`StackTry` in `web/components/CardView.tsx`), above the APIs. Its box is a greyed tick, marked for screen readers as checked and not changeable (`aria-disabled`), not the old `●` that looked like a disabled radio button. Under its name: *Always starts: the UI is the app you try. Tick the APIs below to run them here too; the rest are the shared ‹env› ones.* An API whose repo isn't in the card or its lane says so under its name, so a box that can't be ticked has a reason too. `Space` on the UI row flashes why, where it used to do nothing; the `?` row says the UI comes first and always starts.
- **A compiling dev server is up when its build is done** (`compiles`, `buildLine` in `server/recipes.ts`):
  - A step is held until its build finishes when its command is `nx run …:serve`, `nx serve`, `ng serve`, `webpack serve`, `webpack-dev-server`, `react-scripts start` or `vue-cli-service serve`, or when an app-like step's output says a build started (`[webpack-dev-server]`, *Compiling*, *Building*, *Generating browser application bundles*, *Starting module federation*).
  - Its printed address, its open port and going quiet don't make it up. It is up on a done line: *compiled successfully*, *compiled with warnings*, *bundle generation complete*, *webpack compiled*, *server ready at*, *all remotes started*. The address it printed earlier is the app's.
  - A failed build (*Failed to compile*, *compiled with N errors*, *ERROR in*, *Build failed*) shows on the service as *didn't compile*, in red, and stays starting: a saved fix builds again and the done line makes it up.
  - One that never prints a done line is taken to be up after 15 minutes, and says so. An explicit `wait:` still decides on its own.
  - Output lines are read before their URL (`capture`), so a line that both starts a build and prints the address holds the step.
- **The page shows it:** while it builds, the service says *compiling*, and the step row says *compiling…*, with no Open. README's Try it row says so.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (389). New tests:
- `compiles` on the owner's real line (`node_modules\.bin\nx.cmd run shell:serve:development --proxyConfig=…`) and the others, but not `vite`, `npm run dev`, `nx run app:build` or `dotnet run`.
- `buildLine` on webpack, Angular, esbuild and Nx module-federation lines.
- A stand-in that serves and prints its address at once, fails, then compiles: it isn't up at its address and open port, it shows *compiling…* and then *didn't compile*, and it is up on the compiled line at the address it printed.
- One known only by its `[webpack-dev-server]` line waits too.
- One that never says it compiled is up after the cap, with its note.

**New `walk-try-compile.cjs` (15, light and dark)** on an isolated server, with a stand-in stack whose UI is `standins/ui-compile.cjs` (it serves at once, says *Failed to compile.* at 3 s and *compiled successfully* at 6 s):
- The UI row is first, says *Always starts* and why, names the shared environment, and has a checked box that can't be changed.
- `Space` on it flashes why and changes nothing.
- After `t`, the UI serves and has printed its address but is still starting, and the panel says *compiling*, with no Open; then *didn't compile*; then up with Open, about 6 s in.
- `t` stops it, the `?` row is there, and there are no page errors.

Screenshots looked at: the first layout put an *always starts* pill beside the name, which pushed the status out of the narrow panel; it is now the caption's first words. `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19 light and dark, `walk-deps.cjs` 20/20, `walk-hub.cjs` 29/29, `walk-perf.cjs` 25/25.

**To check at VU:** `git pull`, restart (ask first; this is server code), then Try it on the card. The UI's row should be first and say *Always starts*. Its status should say *compiling* until Nx prints its done line, and only then be up with Open. If it never becomes up, paste the last lines Nx prints once the app is ready: its wording may need adding to `buildLine`, or set `wait:"<that text>"` on the UI's step in the stack setup (`e`).

**Open:** the done and failed lines are a list of known wordings; a dev server that says something else waits out the 15-minute cap (or takes a `wait:`). A rebuild after the app is up (a save) doesn't take it back to *compiling*.

## 114. Two cards on the same API and UI at once: the UI's port, okteto's SSH port and its other forwards are each run's own

2026-10-07. The owner, at VU: with one card's UI and API running, Try it on a second card in the same repos failed. The second API's `okteto up` stopped with *Couldn't connect to your development container: local port 22000 is already in-use in your local machine*, and the second UI stopped at *Port 4216 is already in use. Would you like to use a different port?*

**Cause.**
- **Okteto:** since §54 a run's `okteto up` gets a copy of the manifest whose API forward uses the port picked for that run. The team's helper also writes `remote: 22000`, the local SSH port, into the manifest, plus a debugger forward. The copy kept both, so the second card's `okteto up` clashed on them. Okteto's own default for `remote` is a random free port (its manifest reference).
- **UI:** the stack's UI step was `nx run …:serve --proxyConfig={{proxy}}` with no `--port`, so it served on the project's 4216. The setup warned about a fixed port but didn't fix it, and the dev server's question waits for an answer a step never gives.
- **Found on the way:** `PortPool.take` checked that a port was free, waited on the listening check, then marked it held. Two takes running at once could both get the same port.

**What changed.**
- **The manifest copy** (`rewriteForward` in `shared/okteto.ts`):
  - The `remote:` line is taken out, so okteto picks a free SSH port itself.
  - Every forward besides the API's gets a port of its own from the stack's pool. Before an `okteto up` step starts, `RunService` takes one port per other forward (`sparesFor`, `otherForwards`). The step's output says where they went (*this run's ports for the manifest's other forwards: 5005 → 18002; okteto picks its own SSH port*), so the debugger can be attached there. They are given back with the run, with the copy.
  - `RunService` gets the server's `PortPool` (`server/index.ts`).
- **The UI's port** (`autoUiPort` in `shared/stack.ts`):
  - A UI start step that is a dev server taking `--port` (Nx's serve targets, `ng serve`, `webpack serve`, Vite), with no `--port` and no `{{uiPort}}`, gets `--port {{uiPort}}` added. The run picks the port, the way an `okteto up` already gets `forward:`.
  - A `ui.url` written with a fixed localhost port, as the example and the owner's saved stack have, takes the run's port; the path is still the project file's baseHref.
  - The setup's fixed-port warning now shows only for a start line that can't take `--port` (`npm start`).
- **`PortPool.take`** checks *held* again after the wait.
- **The Try it panel:** the UI's caption and an API's note run under the buttons too. With Open, Stop and Again on the UI's row, the caption had been squeezed into a column a word wide.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (391).
- `rewriteForward` on a manifest shaped like the helper's (`remote: 22000`, the API's forward and two more, CRLF): the API's forward gets the run's port, the others get the spares in order (one with no spare left is kept), the `remote:` line goes, `remotePort:` is left alone, and the rest is byte for byte.
- The pool: six takes at once get twelve different ports. This test failed before the fix.
- Stack tests now expect the picked port where they pinned the fixed one: the example's `nx run shop:serve` gets `--port 18001` and its url that port; the owner's saved stack (url `http://localhost:4200`, no `--port`) gets the run's port on the project's baseHref.
- The existing two-cards test runs a stand-in okteto that holds every forward and the `remote:` port and fails as okteto does on one in use. It now uses a manifest with `remote:` and a debugger forward; both cards come up, each with its own debugger port, and stopping card A frees its ports, the debugger's too. Before the pool fix, this test caught both cards being given the same debugger port.

**New `walk-two-cards.cjs` (15, light and dark).** It starts its own isolated server with these stand-ins first on its `PATH`:
- `okteto`, as above;
- `nx`, which serves on the project's 4216 unless given `--port`, and asks the dev server's question when 4216 is taken;
- a helper that writes `okteto.yml` with `remote: 22000` and a 5005 debugger forward.

The stack is saved as the owner's was: no `--port`, url `:4216`. Card A is started from its Try it panel with `t`, then card B while A runs. The walk checks that:
- both come up;
- each UI is on its own port, not 4216, with `--port` on its step;
- neither manifest copy has `remote:`, and the four forward ports are all different;
- each API answers as its own card's, and each UI's proxy points at its own card's API;
- A's output says where 5005 went;
- after stopping both, their ports answer nothing and the copies are gone;
- there are no page errors.

Screenshots looked at (the squeezed caption; fixed). `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19 light and dark, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15 light and dark, `walk-hub.cjs` 29/29, `walk-perf.cjs` 25/25.

**To check at VU:** `git pull`, restart (ask first; this is server code). Stop both cards' runs first, and run `okteto down` for the second card's deployment if its failed run left it up (okteto said so). Then Try it on card A, and on card B while A runs:
- each UI's step should end `--port 180xx`, on a different port for each card;
- each API's output should say where its other forwards went and that okteto picks the SSH port;
- both should come up, and each UI should show its own card's changes.

If the helper's manifest forwards something else that has to stay on its port, say which.

**Open:**
- A UI started with `npm start` (no `--port`) still serves on its fixed port; the setup says so.
- A module-federation host's remotes may start on their own fixed ports; not seen yet.
- The UI row's *up* text is squeezed out next to three buttons; the dot still shows the state.

## 115. The chat meters its session: branch, context used, cost

2026-10-07. The owner: the card's chat should show the context used (count and percentage), the cost so far, and the current branch.

**What there was.** The server already asked the SDK for the context percentage after each turn (`ctxPct`), but only the full-screen session view showed it, as a *Memory* bar. The card's chat, where the work happens now, showed none of it.

**What changed.**
- **Server** (`server/session-manager.ts`):
  - After each turn's result, `getContextUsage({ detail: 'summary' })` gives the tokens in use and the window they're measured against (`ctxTokens`, `ctxMax`). The summary answers from the last response's usage, with no token-count calls.
  - The result's `total_cost_usd` is the session's running cost estimate (`costUsd`). It is cumulative across turns, and a resumed session continues from its transcript's total. A zero (a crash or startup result) keeps the last value.
  - The folder's branch is read with git when the session starts and after each turn (`readBranch`), so a branch Claude switched to shows. The summary's `branch` prefers it to the transcript's.
  - All of it is carried through a restart, and is sent on `SessionSummary`.
- **Page:** `SessionMeter` (`web/components/SessionMeter.tsx`, formatting in `web/meter.ts`) shows `⎇ branch`, a context bar with *41k / 200k · 21%* (amber from 70%, red from 85%, as the old bar), and *$0.05*. Its title and label say each part in words; the cost is called an estimate at list price, not a bill.
  - It is in the card chat's header, before *In a terminal*. Before the session's first turn it shows the card's branch name.
  - It replaces the *Memory* bar in the full-screen session view.
  - It is display only, so it adds no key.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (393: `fmtTokens`, `fmtCost`, `ctxTone`, `meterTitle`). **`walk-hub.cjs` (30)** adds a check on a real Haiku card: after the second turn, the header shows the card's branch, tokens of the window with the percentage, and a dollar cost (*⎇ card-1-hub-walk-contributing-note 41k / 200k · 21% $0.05*). Screenshot looked at in dark: the long branch took room from the title, so it is capped narrower. `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15, `walk-two-cards.cjs` 15/15, `walk-perf.cjs` 25/25.

**To check at VU:** `git pull`, restart (ask first; this is server code). Send a message on a card. After the reply, the header shows its branch, the context used and the cost. The full-screen view (`Ctrl+Enter`) shows the same.

**Open:** the cost is the SDK's estimate at list price (an organization's contracted rates apply only through managed settings); a session that was never live in the app (history only) shows just its branch.

## 116. Pictures in the card chat

2026-10-07. The owner: the card's chat should take pictures too. The full-screen session's box already did (paste and drop, §22); the card chat's box, where the work happens now, didn't.

**What changed.**
- **The card chat's box** (`Say` in `web/components/CardView.tsx`) takes images three ways:
  - `Ctrl+V` of an image (a screenshot) in the box;
  - dropping image files on the box;
  - `Shift+I` on the open card, or its *Image* button beside *+ Context*, which opens the file picker.
  The images wait as thumbnails over the box, each with ×; `Backspace` in an empty box takes the last one out. They are held per card in the store (`sayImages`), so moving away and back keeps them.
  `Enter` sends them with the text, or alone (*What do you see in this image?*, as the full-screen box says). They come back if the send fails.
- **Limits** (`pickImages` in `web/say-images.ts`, shared with the full-screen box, which now uses its reader too): PNG, JPEG, GIF or WebP, up to 5 per message, 5 MB each, each refusal said in a flash. The server checks the same (`cleanImages`).
- **Server:** `card.send` carries `images` into the app session (`manager.send` already took them); the send log counts them. A card still in a terminal tab can't take them (they can't be typed in), and says to close the tab so the next message moves it into the app. `PROTOCOL` 29: an older server would drop the images without a word.
- **Keys:** `Shift+I` on an open card, a `?` row (*Shift+I · Ctrl+V · drop (card open)*), and *⇧I Image* in the legend beside *Enter Message* for a card the app runs.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (394: `pickImages`, which takes images only, keeps their order, refuses one over 5 MB and stops at 5). **`walk-hub.cjs` (35)** on a real Haiku card:
- a PNG pasted into the box with `Ctrl+V` shows a thumbnail, and `Backspace` in the empty box takes it out;
- `Shift+I` opens the file picker, and a solid red PNG picked there shows;
- after `Enter`, the box and its images empty, and Claude answers *Red* (the server log: *78 chars and 1 image into the app session*).
Screenshot looked at. `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15, `walk-two-cards.cjs` 15/15, `walk-verify.cjs` 38/38, `walk-perf.cjs` 25/25.

**To check at VU:** `git pull`, restart (ask first; this is server code, and the page needs the new protocol). On a card, paste a screenshot into the message box, or press `Shift+I` and pick one, then send it with a question about it.

**Open:** the chat shows a sent image as *[image]* in your message, not as a picture: the transcript keeps the text only. Showing the picture would mean keeping it.

## 117. The card's Claude can read its running services' logs

2026-10-07. The owner: while a card's services run, its chat should have their logs as context, to look through while debugging.

**What changed.**
- **Every run of a card's app or of a stack's service writes its output to disk** (`server/run-logs.ts`, `RunLogFile`):
  - The folder is `<data folder>/runs/logs/<card key>/` (`cardLogsDir`); the file is `<service>.log`, with an API by its repo name, the UI as `ui.log` and a single app as `app.log`.
  - Each line has the time and the step's number, a step starts with `$ <command>`, and the file ends with how the run ended.
  - The run before is kept as `<service>.prev.log`, and a file past 10 MB rolls over to it.
  - It is written in quarter-second batches; the last batch is written at once when the run ends.
  - `RunService` gets the folder by card id (`logDir`); a run that isn't a card's writes nothing.
- **The card's session in the app can read that folder**: it is one of its directories (`CardSession.dirs` into `additionalDirectories`), so `Read` and `Grep` there need no permission.
- **Its system prompt says so** (`logsText`, after the packet): where the files are and how they're named, to look there rather than ask for the output, to use `Read` or `Grep`, and never `tail -f` (the files keep growing while the app runs).
  - Found by the walkthrough: without that last line, Haiku reached for `tail -f` through Bash, which waited on approval and never ended.
  - The card keeps `logsDir`, so the Context panel's *exact text* includes this part for a card the app runs.
- Nothing is copied into the chat on its own: a busy log would fill the context window. Claude reads what it needs when it needs it.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (397). New tests cover:
- the folder and file names, and the prompt text;
- a run's file: the header, timed and numbered lines, the run before kept as `.prev`, and the roll-over past the cap;
- a card's real run writing its output and how it ended, and a run that isn't a card's writing nothing.

One full run of the suite had a failure that wasn't captured, before the last write was made synchronous; seven runs after it were clean.

**`walk-hub.cjs` (37)** on a real Haiku card: a recipe whose app prints a random `LOGMARK-nnnn`, started with `t`, writes it to `runs/logs/CARD-1/app.log`. Asked only what the LOGMARK in the card's Try it logs is, Claude answers with it, without asking for any permission. This passed on two runs in a row; the run before the `tail -f` line was added failed as described above. **`walk-two-cards.cjs` (17, light and dark)**: each card's folder has its API's and UI's output, and each card's API log names its own port. `walk-card.cjs` 59/59 light and dark, `walk-board-try.cjs` 19/19, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15. `walk-perf.cjs` 25/25; the run before it had *Ctrl+K → a session* unmeasured (-1 ms), the known open item from §105.

**To check at VU:** `git pull`, restart (ask first; this is server code). Sessions pick it up when they next start (a restart starts them again). Try it on a card, use the app until something fails, then ask the card's chat what the API's log says about it. The files are in `%USERPROFILE%\.cc-control\runs\logs\<card key>\`.

**Open:** a card's session started before this has no logs folder among its directories until it starts again; logs hold whatever the services print, so a service that logs secrets puts them there too (the folder is on this machine only, outside every repo).

## 118. The card chat's message box can be made taller

2026-10-07. The owner: the card chat's message box stays really small (two rows, fixed); it should be resizable.

**What changed** (`web/say-size.ts`, `Say` in `web/components/CardView.tsx`).
- **It grows with what you type**, up to 60% of the window (`fitHeight`), and is back to its size when emptied (after a send too).
- **Its smallest size is yours to set:**
  - Drag the edge above it (a grip, with the keys on hover); double-click the edge for the usual size.
  - `Ctrl+Shift+↑ / ↓` makes it two lines taller or shorter, in the box or anywhere on the open card.
  - The size is kept in this browser (`localStorage`, a per-viewer convenience) and never goes under one line or past 60% of the window (`clampSay`).
- **Keys:** a `?` row (*Ctrl+Shift+↑ / ↓ (card open)*) and *Ctrl⇧↑ ↓ Box size* in the legend beside *Message*. The edge has `role="separator"` with a label that names the keys.
- **Also fixed:** §117's README line had its path's backslashes doubled. §117's test of a card's run log now waits for both of the app's lines before stopping it: under the full suite's load the second line could come after the stop (seen once, 2026-10-07; five full runs since are clean).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (398: `clampSay` and `fitHeight`), five full runs clean. **`walk-card.cjs` (66, light and dark)**, on the idle card:
- `Ctrl+Shift+↑` twice: 60 → 156 px; `↓` shorter again;
- dragging the edge up 200 px: 315 px; a double-click: back to 60;
- twelve typed lines grow it, but not past 60% of the window; emptied, it is back to its size;
- the size given with `Ctrl+Shift+↑` out of the box is the same after a reload.

Screenshot looked at. `walk-board-try.cjs` 19/19, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15, `walk-two-cards.cjs` 17/17, `walk-hub.cjs` 37/37. `walk-perf.cjs` 25/25. A run before it had *Ctrl+K → a session* unmeasured (-1 ms) and printed no total, as in one run for §117. It is §105's open item (the palette doesn't see a brand-new card session for a while), and it now shows up in about half the runs.

**To check at VU:** a page change. `git pull`, `pnpm build` and a reload are enough, unless the server is behind (§114 to §117 need a restart anyway). Drag the edge above a card's message box, or press `Ctrl+Shift+↑`.

**Open:** the full-screen session's box already grows with its text (to 8 lines) but can't be dragged; *Ctrl+K → a session* in `walk-perf` (above).

## 119. A terminal session writing no longer slows the app; Ctrl+K finds a session by what started it

2026-10-07. The owner: with a terminal up as well, everything is very slow and delayed; without one, it is fast.

**Measured** (new `walk-mirror.cjs`). It copies a large real transcript (29 MB) to a throwaway session beside it, opens that full screen on an isolated server, and appends an assistant message to its transcript every 150 ms, as a terminal writing would. It deletes the copy afterwards. While the stand-in terminal wrote:
- **The page received 8.6 MB in 8 s.** Every re-read sent the whole transcript (about 700 KB, 1,100 items), up to every 0.7 s; the page parsed and merged each one.
- **The server re-read the whole file each time** (`getSessionMessages`, 50 to 70 ms for 20 to 30 MB).
- **The session list was read again and sent to every page** after any write by a session the app doesn't run: `listSessions` over 300 sessions takes about 150 ms here, and the list is 57 KB. This happened every 1.5 s for as long as any terminal session wrote, whichever session the page showed. That is "a terminal up" in general, not only `g`.
- With the page's CPU slowed four times (as a slower laptop's), typing in the box measured 19.7 ms p95 while the terminal wrote.

**What changed.**
- **The mirror sends each page only what follows what it has** (`server/mirror.ts`).
  - It keeps each page's item count and last uuid: set when the page opens the session (`has`), and kept up to date after each send.
  - A change sends `from` that count, which the page already merges (§97). Nothing new sends nothing.
  - A transcript whose start changed (a `/clear`, a compaction) is sent whole, as before.
- **A large transcript is re-read less often:** the wait between reads is the larger of 0.7 s and five times the last read's time.
- **The session list** (`server/history-index.ts`) is read again at most every 10 s for a session it already has whose transcript grows. A new session still shows within 1.5 s; a sooner read already due is kept.
- **Found on the way, the `walk-perf` miss open since §104/§105** (*Ctrl+K → a session* at -1 ms in about half the runs):
  - Claude Code titles a session itself after a turn (an `ai-title` line in its transcript, "Plan CARD-1"). The session list then reports that title, so the words the session was started with were no longer searchable.
  - Sessions now carry their first prompt (`SessionSummary.firstPrompt`, from the history or the live session), and Ctrl+K matches on it when the title doesn't match (it isn't shown).
  - `walk-perf` now says what the palette and the server had when it misses, rather than stopping.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (400). New mirror tests:
- only what follows is sent, from its count;
- nothing is sent when nothing is new;
- the whole transcript goes when its start changed, or to a page the mirror knows nothing about;
- a 30 ms read spaces the next out to about 150 ms.

**`walk-mirror.cjs` (8)**: the page received **0.07 MB** in 8 s (from 8.6 MB) and the session list once or not at all (from 5 times). Every message the terminal wrote showed on the page. Typing p95 while it wrote, with the CPU slowed four times: 15.2 ms (from 19.7). The budgets (key → paint 16 ms, transcript 50 KB/s, the list sent at most once) fail the walk.

`walk-perf.cjs`: Ctrl+K found the new card's session in 3 of 3 runs (17 to 19 ms). One of the three had *Ctrl+Enter → the card open* at 336 ms against 300, the same scatter as §112. `walk-card.cjs` 66/66 light and dark, `walk-board-try.cjs` 19/19, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15, `walk-two-cards.cjs` 17/17, `walk-hub.cjs` 37/37.

**To check at VU:** `git pull`, restart (ask first; this is server code). With a terminal session running, and a card open in the app (its own, or another), typing and the chat should stay quick.

**Open:** a session the app shows while a terminal writes it is still re-read whole from disk at each change (now less often for a big one). Reading only the new lines would mean parsing the transcript ourselves, which the SDK keeps internal.

## 120. The card chat fits its column

2026-10-07. The owner: the card's chat doesn't fit the screen; it has a huge horizontal scroll bar.

**Cause** (reproduced). The chat's column is a CSS grid with an automatic track (`grid` with no columns), and an automatic track is as wide as its widest content. Any long unbroken thing in the transcript made the whole chat that wide: a wide markdown table, a long code line, a long path or URL. With the new `wide` seed (a 14-column table, a 600-character code line, a long path and URL, a long command and its output), the chat scrolled **3,922 px** sideways at 1440 px. Even *Finished its turn* was that wide.

**What changed.**
- The chat's grid is one column that never grows past the chat: `grid-cols-[minmax(0,1fr)]` (`Chat` in `web/components/CardView.tsx`).
- Markdown text wraps a long word, path or URL anywhere (`.md { overflow-wrap: anywhere }` in `web/styles.css`). Code blocks and tables are at most the column's width and scroll inside their own box, as they were meant to. Table cells still break only at spaces, so a heading isn't cut mid-word (seen in the first screenshot: *colum / n_1_h*).
- `cards.seed` takes `wide: true` (test servers only) for that transcript (`wideItems` in `server/seed.ts`).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (400). **New `walk-chat-width.cjs` (6, light and dark)** on an isolated server, a seeded card with the wide transcript, at 1440 and 1024 px, with and without a panel open:
- the page and the chat scroll 0 px sideways (from 3,922 to 4,524), and nothing reaches past the chat's right edge;
- the table and the code line scroll inside their own boxes;
- there are no page errors.

Screenshots looked at, light and dark. `walk-card.cjs` 66/66 light and dark, `walk-hub.cjs` 37/37, `walk-perf.cjs` 25/25.

**To check at VU:** a page change: `git pull`, `pnpm build`, reload. A card whose chat scrolled sideways should fit.

**Open:** at 1024 px with a panel open, the message box is narrow next to its three buttons (*Image*, *+ Context*, *Send*); they could go under it at that width.

## 121. Sign-in on a picked UI port: the choice, and what to find out at VU first

2026-10-07. The owner, at VU: since §114 a card's UI serves on a port of its own (18xxx), and there it can't sign in. The team's identity provider (an OIDC app) rejects the login because `redirect_uri` must be one of the app's registered login redirect URIs, and only the UI's usual port is registered.

**Chosen, pending what VU finds:**
- **First choice: registered UI ports.** Get a few extra localhost ports registered with the OIDC app (the usual one and three more), and take a card's UI port from that set: a pool of its own, `CC_CONTROL_UI_PORTS`, beside the 18000 range. It is the smallest change, every card's UI stays usable at once, and nothing new sits in the request path.
- **Fallback: one front door** on the usual port, a proxy to the chosen card's UI. It needs no registration, but it has to carry the dev server's WebSocket and the redirect back from sign-in, and a browser reaches one card's UI at a time.
- **Dropped: a host name per card** (`card-1.localhost`). Every card on one port needs the front door anyway, plus a wildcard redirect most providers refuse.

**To find out at VU first** (`docs/prompts/continue-signin-at-vu.md`, a diagnosis prompt in the two-laptop shape):
- what the UI sends as `redirect_uri` and where it comes from (its page's address, its environment files, or a runtime config), its flow (PKCE in the browser, or a callback to the API), and whether sign-in is kept per port (browser storage) or in a cookie every localhost port shares;
- whether the API checks the origin (CORS, a header, a token claim), and whether the provider also keeps a trusted-origins list for the browser's token call;
- which localhost redirect URIs are registered now, who administers the app, and whether they'd add the extra ports (login, logout, and trusted origin);
- anything else the UI loads that stays on a fixed port (module-federation remotes; §114's open item).

No code changed. Not run: the walks (a docs-only change); `pnpm typecheck` and `pnpm test` pass.

**Open:** the build waits on the handoff: the ports the owner can get registered, and the redirect's path.

## 122. A card's UI keeps its own port, and a second takes one registered for sign-in

2026-10-07. The handoff from §121's diagnosis at VU:
- **The UI builds its `redirect_uri` from the page's address:** the origin, then the app's base path, then the callback path. The same goes for its sign-out address. Nothing in its config names a port.
- **The provider rejects the 18xxx address at its authorize step** (authorization code with PKCE), before any token call.
- **Each app in the UI's workspace has its own fixed dev port**, and the registered redirect URIs are most likely those ports, each with its own app's path. A provider matches the whole address, so another app's port is no use with this app's path.
- **The API side is fine:** the gateway takes any origin, and the dev proxy uses `changeOrigin`.
- **§114 had made this worse:** it moved every card's UI to the range, even when the UI's own port was free. Since then not even one card could sign in.

The handoff suggested borrowing other apps' registered ports by serving this app under their base paths with a rewritten runtime config. That was turned down: it would run the app disguised as another one (base href, routes, assets, proxy paths), and break in ways that are hard to see.

**What changed.**
- **The UI keeps its own port while it's free** (`PortPool.takeUi` in `server/ports.ts`, `uiHomePort` in `shared/stack.ts`). Its own port is the one its project file gives, else a fixed localhost port in `ui.url`. The step still gets `--port`, now with that port. The first card's UI signs in as it did before §114.
- **A second card's UI takes the first free port of `CC_CONTROL_UI_PORTS`** (`parsePortList`: `4301,4302` or `4301-4303`). These are the ports registered with the sign-in provider, set in the machine's `config.env`, never in the repo.
  - The run's output starts with why: *The UI's own port, ‹n›, is in use by ‹card›, so it runs on ‹m› from CC_CONTROL_UI_PORTS.*
  - A port something else listens on is skipped. Two takes at once never get the same port.
- **All of them taken:** Try it refuses, naming who holds each: *No sign-in port free for the UI: ‹n› (‹card›), ‹m› (‹card›). Stop one, or add one to CC_CONTROL_UI_PORTS.* The run holds nothing; its APIs' ports go back.
- **No list set:** a second card's UI takes a port from the range, as in §114, and its output says the sign-in provider may refuse that port and where to list registered ones.
- `prepareStackSession` takes the card's key to name it. A service's run takes a `note` that starts its output (`RunOptions.note`).
- The doctor says what the UI's ports will be (*UI sign-in ports*). `docs/config.env.example` and README describe the setting.
- No new key: the port shows where it did (the run's label, *UI :4216*), and the refusal comes as Try it's error.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (403). New tests:
- `parsePortList`: lists, ranges, repeats, and things that aren't ports.
- `takeUi`: its own port first, then a listed one, skipping one something else listens on. When all are taken, the error names each holder. A port given back is its own again. With no list, a port from the range, and a note only when its own port was taken.
- Four UIs taken at once get four different ports.
- The stack test now expects the project's own port (4216, or the other app's 4220) where it pinned a range port. A second card gets the range with the note. With a listed port, a second card gets it and a third is refused naming CARD-1 and CARD-2, holding nothing afterwards.

**`walk-two-cards.cjs` (21, light and dark)**, its server with `CC_CONTROL_UI_PORTS=4291`:
- card A's UI keeps 4216, and card B's takes 4291, each with that `--port`;
- B's UI output starts with why;
- a third card is refused on the page (*No sign-in port free for the UI: 4216 (TWO-1), 4291 (TWO-2)…*) and runs nothing;
- both sign-in ports are free after the stops.

Screenshot looked at: the first wording of the refusal was cut off at the end of the header, so it is shorter now.

The other walks: `walk-card.cjs` 66/66 light and dark, `walk-board-try.cjs` 19/19 light and dark, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15 light and dark, `walk-hub.cjs` 37/37, `walk-perf.cjs` 25/25. `pnpm run doctor` wasn't run: it signs in to the trackers. Its new line is type-checked only.

**To check at VU:** `git pull`, restart (ask first; this is server code). Try it on a card: its UI's step should end `--port <its usual port>`, and sign-in should work. Before spare ports are registered, a second card's UI runs on 18xxx and its output says why. Once they are registered, put them in `%USERPROFILE%\.cc-control\config.env` as `CC_CONTROL_UI_PORTS=…` and restart. A second card's UI then takes the first of them and signs in. `pnpm run doctor` lists them.

**Open:**
- The registration request (the owner's): spare localhost ports with the UI's own path, for login and logout redirects, and trusted origins if the provider keeps that list.
- Where sign-in state is kept (browser storage per port, or a cookie shared by every localhost port) wasn't checked at VU; a shared cookie could let two cards' UIs overwrite each other's sign-in.
- The fallback, if registration is refused: one front door on the usual port (§121).

## 123. The front door: every card's UI behind the port its sign-in takes, shown one at a time

2026-10-08. Tried at VU with §122, a second app-summary on another app's registered port was refused by the provider all the same: *the redirect_uri must be a login redirect URI in the app's settings*. A registered address is a port and a path together, so app-summary's path signs in only on its own port. The owner won't ask for more registrations. So every card's UI has to be reached on that one port. The owner still wants to test cards' changes side by side: each card's API and UI running at once, shown one at a time.

**What changed.**
- **A front door** (`FrontDoors` in `server/front-door.ts`). While any card's UI of an app runs, cc-control holds that UI's own port and forwards everything on it to one card's UI:
  - the pages, with the Host kept as the door's;
  - the API calls, which that UI's dev server sends on to its own card's API;
  - set-cookie headers, all of them;
  - live reload's WebSocket.

  It listens on 127.0.0.1 and ::1 (a browser may try `localhost` as either), loopback only.
  - The first card started is shown.
  - When the shown card's UI stops, the door shows another card's. With the last one gone it closes and the port is free.
  - When the door turns to another card, the old card's live-reload sockets are closed.
  - A card's UI that doesn't answer gets a page saying so (*TWO-2's UI isn't answering: it may still be compiling…*), with no stack trace.
- **Every card's UI runs on a port from the range** (`uiPortOf` in `server/stack.ts`) when the UI's own port is known and is free or already the door's.
  - Its output starts with *The UI runs on 18004, behind cc-control's front door on 4216, where its sign-in is registered: o on the card shows it there.*
  - When something else listens on that port (the owner's own dev server), the door can't open and it is as §122.
  - `CC_CONTROL_FRONT_DOOR=0` turns doors off.
- **`o` points the door, then opens the app through it** (`openThroughDoor` in `web/line-keys.ts`, `door.show`).
  - The tab opens at once (a browser lets only the key press open one) and goes to the app when the server says the door has turned.
  - When it turned, the flash says *localhost:4216 now shows TWO-2's UI; a tab already on it shows it after a reload*.
- **Where it shows:**
  - each UI's run carries `door: { port, shown, url }` (`runsMsg` in `server/index.ts`);
  - the tile says *App on localhost:4216* for the card shown and *App behind :4216* for the others;
  - the Try it panel's UI caption says *on :4216 … shows this card's UI*, or *Behind localhost:4216 … o shows this one there*;
  - the `?` row for `o` explains it, and the doctor says the door is on.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (407).
- `front-door.test.ts`:
  - two stand-in UIs behind one door;
  - the request forwarded as asked with the door's Host;
  - both cookies through;
  - a WebSocket to the shown card, closed on a turn, and a new one to the other card;
  - the turn on `show`;
  - a 502 page naming the card when its UI is down;
  - the door showing the card left when one leaves, and closing (the port free) with the last;
  - a port taken by something else refused with why;
  - two joins at once opening one door.
- `stack.test.ts`: two sessions both on range ports behind the project's port, the note, the door turning and closing as sessions end, and §122 when the port is taken.
- `recipes.test.ts`: `o` opens through the door.

**`walk-two-cards.cjs` (26, light and dark)**, with the stack saved as the owner's (`ui.url` on 4216):
- both UIs come up on ports of their own, both behind 4216, which shows card A's (with A's API);
- `o` on card B opens a tab on `localhost:4216` that shows B's UI with B's API, and 4216 serves B's from then on;
- the flash, the panel's *on :4216* and the tiles say so, and the runs say B shown, A not;
- after both stop, 4216 answers nothing.

Screenshots looked at, light and dark:
- the first try put the marker beside the UI's name, which squeezed the name to one letter; it is in the caption now;
- on the tile it pushed Restart off, and the tile said *App at localhost:18004*; the tile's app line now says where the door is.

`walk-card.cjs` 66/66 light and dark, `walk-board-try.cjs` 19/19 light and dark, `walk-deps.cjs` 20/20, `walk-try-compile.cjs` 15/15 light and dark, `walk-hub.cjs` 37/37, `walk-perf.cjs` 25/25.

**To check at VU:** `git pull`, restart (ask first; this is server code). Delete the `CC_CONTROL_UI_PORTS` line from `config.env` first: it isn't needed. Then:
1. Try it on card A. Its UI's step ends `--port 180xx`, and its output says it is behind the front door on 4216. Open (`o`) opens `localhost:4216/<the app's path>`; sign in.
2. Try it on card B while A runs. Then `o` on card B: the tab on 4216 shows B's UI, still signed in, calling B's API.
3. `o` on card A switches back. A tab already on 4216 shows the other card after a reload.
4. Live reload: a saved change in the shown card's UI should reload the page as before.

Before step 1, stop any app-summary you run yourself on 4216; otherwise the door can't open and it is as §122.

**Open:**
- Not seen at VU yet: whether the app's dev server takes the door's Host header (it is `localhost`, which webpack's dev server allows) and whether live reload reconnects through the door after a switch.
- One browser sees one card at a time on the door. Both cards in two tabs at once would need two registered addresses.
- A module-federation host whose remotes load from ports of their own goes around the door for those; not seen (the handoff found everything on the UI's own port).
- §122's `CC_CONTROL_UI_PORTS` stays for doors turned off.

## 124. Direction: the board becomes a canvas of cards, with a quick view under each

2026-10-08. The owner: the home page reads like a kanban board, chosen with business folk in mind (§27), and it doesn't do the job. The job is **switching between sessions**: seeing what is there, what each one is doing and which need you, and getting into one quickly. A card's column comes from a stage the app works out, and people spend their attention on why a card is in its column rather than on the work.

**Chosen direction:**
- **One canvas, a grid of every card**, with no columns. The stage stays as data and as a small marker on the tile.
- **A tile says at a glance** what the session is doing or waiting on.
- **A click or `Enter` opens the card fully**, as today.
- **A quick view, an expandable drawer attached under the card**, does the same actions without leaving the canvas: answer a question or approval, send a message, Try it, see changes and ship.

**Proposed, to settle with the owner before building:**
- stable positions (spatial memory) with attention shown and a jump-to-next-needs-you key, or grouping by status;
- where tickets waiting to start live (a strip above the grid, or behind `⇧T`);
- whether the quick view follows focus;
- what the workspace repo row becomes.

The handoff is `docs/prompts/continue-canvas.md`. It holds the owner's words, the proposed design (the canvas, the order, the quick view, the keys), the steps (canvas, then quick view, then polish, each its own section), and the walks to update (`walk-card`, `walk-board-try`, `walk-hub`, `walk-perf`, `walk-two-cards`, plus a new `walk-canvas`).

No code changed. Not run: the walks (a docs-only change); `pnpm typecheck` and `pnpm test` pass.

## 125. The canvas: what the owner chose, and a mock to look at first

2026-10-08. The owner settled §124's open questions and asked for a mock before any code. The mock is `docs/futures/canvas.html`: self-contained, with demo data only, in the app's own colour tokens. It has light, dark and System themes, a 1024 px width, and a first-time empty state. The keys work in it.

**Chosen:**
- **Stable order.** Newest first, and a card stays where you last saw it. Needing you shows as an amber tile and the count in the bar, which also works as a button. `a` focuses the next card that needs you, and the quick view follows. `<` / `>` or a drag move a card earlier or later. (`Alt+←` is the browser's Back, and `Alt+↑ ↓` already hop between the cards' sessions, so neither could reorder.) Grouping by status was turned down.
- **Tickets to start** sit in a thin strip above the grid. `i` folds it, `v` switches between your tickets and Ready for QA, `n` or `Enter` starts one, and `↑` from the grid's top row goes into it.
- **The quick view follows the focus.** With it open, the arrows and `a` move it to the next card, so `↓ ↓ ↓` looks through each session in turn. It follows cards only, and closes when the focus goes to a ticket or to Done.
- **The workspace repo row goes.** A chip's tooltip names the repos, and the workspace dialog (`E`) holds them. `+` `−` `⇧E` `⇧I` `F` keep working.
- **"Lane" becomes "Workspace"** in every label, in `?`, in the toasts and in the README.
- **Done** is a collapsed group at the end of the grid. `Space` or `Enter` on its header opens it.

**Put to the owner in the mock, to confirm before building:**
- `Enter` in the quick view opens the card fully, as it does on the canvas. `r` (reply) opens the quick view with its message box ready, on the canvas too.
- `Esc` in the quick view only closes it, and never stops Claude, unlike the open card's Esc.
- Digits answer a question shown in the quick view, and otherwise pick the workspace.
- Whether the stage strip (Plan · Build · Try · Ship) earns its space on each tile.

Checked: the mock in headless Chromium, in light and dark, at 1440 and 1024 px, and empty, with the screenshots looked at and no console errors. A script drove it: `Space` opens the quick view under the focused tile's row with its notch on the tile; `a` moves to the next card that needs you; a digit answers a question; and `↓` from the last row reaches Done and closes the quick view. No app code changed, so the walks weren't run.

## 126. Your Move: the home page sorts cards by whose turn it is

2026-10-08. The owner used the canvas mock (§125) and found it jumbled: with many cards, nothing said which ones to focus on. Five more layouts were mocked side by side on the same sessions, with a simulator that changes their states over time. They are in `docs/futures/home-layouts.html`: Your Move, Air Traffic (a timeline row per session), Triage (an inbox of what each session needs), Mission Control (three live slots and a dock) and Test Bench (columns of evidence). The owner chose **Your Move**: "Oh man I fucking love Option #1".

**The idea:** a card's place comes from whose turn it is, never from its stage. That is always true and needs no explaining, and a card changes band only when the turn changes hands, which is the moment worth noticing. The stage stays as data and as a small marker on the tile.

**What the home page is now** (`web/your-move.ts` for the bands, `web/components/YourMove.tsx` for the page; the board's columns are gone):
- **Your move**, the longest wait first, a queue a newcomer joins at the end. It holds a card that:
  - asks (a tool to allow, a plan to approve, a question form, a turn that ended on a question, a prompt only its terminal can answer);
  - failed to start, or whose Try it failed;
  - finished a turn you haven't seen.

  Each tile carries the answer:
  - `y` / `n` (or the buttons) allow or deny, and approve the plan or keep planning;
  - a digit picks the answer to a single plain question;
  - other forms, and a question to reply to, open the card;
  - a finished turn shows what Claude said, with *Seen* (`m`);
  - waiting 10 minutes or more turns an ask's border amber.
- **Claude's move:** cards working on their own, newest first, each with what it is doing, its turn's time and its app line.
- **Parked:** nobody is waiting on these. One chip each, newest first, with the app's address (the front door's, §123) or the PR, and Try it's buttons on cards in Try it or Ship, the chosen card, and any card whose app runs.
- **Tickets to start** (the Inbox) are a strip above the bands. `i` folds it, `v` switches yours / Ready for QA, `n` starts one.
- **Done** is a folded group at the end, holding finished tickets without a card too. `Enter` or a click opens it.
- **The bar** counts *your move* and *Claude working*.

**Unread turns.** The page keeps when you last saw each card, in this browser (`cc-control.seen.v1`). A turn that ended after that is unread. Opening the card, its session full screen, or `m` marks it seen. A browser with no record starts with every card seen, so old cards don't all arrive as unread. It is page-only, so it reaches the owner's app with `pnpm build` and a reload, with no server restart.

**Keys.**
- New: `a` (the next card that needs you, round again), `m`, `y` / `n` and the digits on a tile, `i`, and `Enter` / `Space` on Done.
- The arrows move across the wrapping bands by where the tiles are (`stepBox`: ← → in reading order, ↑ ↓ to the nearest tile of the row above or below).
- Every board key keeps its meaning.
- `?` and the legend (hidden by `SLIM.legend`, still kept right) list them.

**← → on an open card** follow the order the cards had when it was opened (`line.order`). Opening an unread card marks it seen, which moves it to Parked. Without the snapshot, → would skip the next card. `walk-perf` caught it.

**Not done yet:**
- *Ready to try* as one of Your move's needs, with *Looks good* / *Found a problem*. It needs a record of having tried it.
- The rename of *Lane* to *Workspace* (§125).
- The quick view under a tile (§124). Your Move answers on the tile instead, so it may not be wanted.
- New README screenshots: `docs/screenshots/line*.png` still show the board.

Seen in the layouts and worth keeping for later: Test Bench's ↻ when a try is out of date, and Air Traffic as a second view for heavy days.

**Checked** on isolated servers, never :7777:
- `pnpm typecheck`, `npx tsc --noUnusedLocals -p .`, and `pnpm test` (410: `your-move.test.ts` is new; the board's column and arrow tests went with `lanes` and `moveFocus`).
- `walk-card` 66/66, light and dark. The Done card is opened from its group now.
- `walk-hub` 37/37 (a real Haiku card).
- `walk-perf` 25/25, every budget line OK (a key paints in 4–9 ms, p95, against 16).
- `walk-board-try` 19/19: the chips needed Try it's buttons to pass.
- `walk-two-cards` 26/26, light and dark: the chips needed the front door's address.
- The new `walk-your-move` 24/24, light and dark. It covers:
  - the bands, the order, `a` and `m`;
  - opening a card marking it seen;
  - → on an open card skipping none;
  - Done, the tickets strip with `i` and `v`, `0`, and `?`;
  - 1024 px without sideways scrolling.

  Screenshots looked at.

:7788 was already taken by another cc-control server, running since 2026-09-30. It isn't this session's, so it was left alone, and these tests used :7826.

## 127. Your Move at parity with its mock: Ready to try, a parked count, cards that glow as they move, and workspaces

2026-10-08. The owner: "continue working until we're at parity with what the mockup had" (layout 1 in `docs/futures/home-layouts.html`).

**Ready to try** is one of Your move's needs (`readyToTry` in `web/your-move.ts`). A card needs it when:
- its turn ended in Try it (the server moves it there when a turn ends with changes);
- it has an app to start (a run recipe or a workspace, the same test as its Try it buttons, `canTryCard`);
- you haven't tried it since.

An unread turn comes first; once it is seen, the card stays in Your move as *Ready to try*. The tile:
- says whether the app is up (the front door's address, §123), starting, or not running;
- has the Try it buttons under it (`t`, `⇧R`, `o`);
- has *Looks good* (`l`) and *Found a problem* (`p`).

*Looks good* keeps the try in this browser (`cc-control.tried.v1`, like the seen record), and the card parks. *Found a problem* opens a box on the tile. Enter sends *"I tried it and found a problem: …"* to the card's session, the card goes back to Claude's move, and when that turn ends it comes back *Ready to try again: Claude changed it since your last try*. `m` on such a card says how to finish with it.

**Also as in the mock:**
- The bar counts *parked* beside *your move* and *Claude working*.
- Parked is idle the longest first: a card joins at the end when it parks and stays put after.
- A card that changes band slides from where it was and glows for a moment (`useMoves`: positions measured after each commit, animated with the Web Animations API, off under reduced motion).

**Lane → Workspace** (decided in §125):
- every word on screen in `web/` (the bar, `?`, the legend, dialogs, toasts, the palette, the new-card screen, the README);
- the prompt placeholder is `{{workspace}}` now, and prompts saved with `{{lane}}` still fill;
- comments and code names are unchanged.

**Walks changed:**
- `walk-your-move` (30/30, light and dark) now covers:
  - *Ready to try* after `m`;
  - `l` parking a card, with the glow;
  - the try being kept;
  - `p`'s box, opened and closed with Esc;
  - Enter sending the problem: the page's `card.send` is caught before it leaves, so no session is resumed for a seeded card;
  - the bar's parked count, and `?` listing `l` / `p`.
- `walk-two-cards` reads the app's address from the whole tile.
- `walk-perf` opens its first card from the first tile, so → always has a card after it.
- `walk-lane` uses the new words. It still needs a server whose repo library is seeded (`walk-simple`, or `library.setSources`).

**Checked:**
- `pnpm typecheck`, `npx tsc --noUnusedLocals -p .`, `pnpm test` (413).
- `walk-card` 66/66, light and dark.
- `walk-hub` 37/37 (a real Haiku card).
- `walk-perf` 25/25, every budget line OK (a key paints in 4–9 ms, p95, against 16).
- `walk-board-try` 19/19, `walk-two-cards` 26/26 light and dark, `walk-lane` 14/14, `walk-your-move` 30/30 light and dark.
- Screenshots looked at.

**Left from §126:** new README screenshots (`docs/screenshots/line*.png` still show the board).

## 128. Your Move: an empty band keeps one row of room

2026-10-08. The owner: "make each section have a fixed minimum height below it so even when they are empty there is enough space there between the empty content area and the next section. That space should be equal to what it would look like if a card was in that section."

**Measured** on an isolated server, light and dark, at 1440 and 1024 px, each tile at its own height (the grid's stretch turned off): a Your move tile is 139 px (a question) to 235 px (a plan), a Claude's move tile 81.5 px, a parked chip 28.8 px. An empty band's note was about 20 px.

**Now** each band's body has at least the height of its shortest tile (`BAND_MIN` in `YourMove.tsx`: 139, 82 and 29 px), whether it shows tiles or its note. A band that empties keeps its room, the page below doesn't jump, and an empty band is never taller than the same band with one card in it.

**Checked:**
- `pnpm typecheck`, `npx tsc --noUnusedLocals -p .`, `pnpm test` (413).
- `walk-card` 66/66, light and dark; `walk-hub` 37/37; `walk-perf` 25/25, every line OK (a key paints in 5–9 ms, p95).
- `walk-your-move` 32/32, light and dark: two new checks, an empty Parked keeps 29 px and is the same height with its chip.
- Screenshots looked at (dark, 1024 px).

## 129. The mode on the open card: a chip in the chat's header, and Shift+Tab

2026-10-08. The owner: "Need to be able to switch between plan/auto/ask modes easily."

**What was there:** the full-screen session had a mode chip under its box and `Shift+Tab` cycling Asks first → Accepts edits → Plan first → Auto (`cycleMode`, `session.mode`). The new-card screen picks the mode a card starts in. The open card showed no mode and had no key for it.

**Asked, and chosen:** the same four modes as Claude Code, `Shift+Tab` on the open card, and the chip in the chat's header beside the branch, context and cost.

**Now:**
- The card chat's header shows the mode chip (`ModeChip`, shared with the full-screen session) with its `⇧Tab` keycap; a click switches it too.
- `Shift+Tab` on an open card switches its session's mode, in the message box too, and the box keeps the focus. While Claude's question form is up, `Shift+Tab` is still its previous question.
- The chip reads the mode as the session last said, else as the card's hooks said, else the mode it started in (`cardMode`); a session that isn't running keeps the new mode for its next turn (the server already did this).
- **Haiku refuses Auto**, so the cycle goes past it there and says so: *"Auto isn't offered on Haiku, so: Asks first…"* (`modeAfter`). The server's own fallback stays for a model that refuses it some other way.
- A card whose session runs in a terminal says to switch it there.
- `?` has a row for it, and the open card's legend has `⇧Tab Mode` when the app runs its session.

**Checked:**
- `pnpm typecheck`, `npx tsc --noUnusedLocals -p .`, `pnpm test` (414: `modeAfter` / `asMode`, the legend's ⇧Tab).
- `walk-hub` 41/41 on a real Haiku card, four new checks: the header shows Asks first after the approved plan; `Shift+Tab` → Accepts edits as the session reports it; in the box → Plan first, the box keeping the focus; again → past Auto back to Asks first, with the message. One earlier run failed an unrelated step (Haiku answered that no logs existed yet); run again, it passed.
- `walk-card` 66/66, light and dark; `walk-perf` 25/25, every line OK; `walk-your-move` 32/32.
- The header looked at in light and dark (`shots-hub/mode-header*.png`).

## 130. The chat's scrolling: it stays where you read while Claude writes, follows the box's size, and a ↓ back to the newest

2026-10-08. Three items from the owner's list, done together:
- *"As the user increases/decreases the chat input height, the chat should grow above that top border so the user doesn't have to scroll through chat after changing the input size."*
- *"As the chat is being written to, the user should be able to scroll and maintain their scroll position without being constantly brought to the bottom of the chat while the chat is being written still."*
- *"If the user scrolls up in the chat, we should give them a down arrow to go to the bottom of the chat so they can see the most recent messages."*

**Reproduced first** (a seeded card streaming through `perf.stream`, a real mouse wheel in Chromium):
- Scrolling up in 20 px steps, as a trackpad or Chrome's smooth wheel does, never got away from the bottom: 15 steps, still 0 px from it. The chat counted as pinned while within 80 px of the bottom, each step was under that, and the next streamed word scrolled back down. Setting `scrollTop` also cancels a smooth scroll mid-way.
- One 120 px step got away, which is why it seemed to work sometimes.
- The message box growing left `scrollTop` alone, so the chat's bottom slid under the box.

**Now** one hook does it for the card chat and the full-screen session (`useStickToBottom` in `web/stick.ts`; the old copies are gone):
- **Any move up lets go at once:** a scroll that moves up, or a wheel, touch or ↑ / PageUp / Home key up, which also holds following for 300 ms so a smooth scroll can start. Only reaching the bottom yourself pins it again.
- The follow checks too, since a scroll event comes a frame late, so a key's or scrollbar's move up isn't undone before it is seen.
- **The browser's scroll anchoring is off on the chat.** When a turn ended, the streamed text was swapped for the message, and anchoring moved the chat up about 400 px to keep a line in place. That read as you scrolling up and left a ↓ at the bottom. The walk caught it now and then; it has a check of its own now.
- **The box's size:** when the chat gets shorter or taller (the box dragged, `Ctrl+Shift+↑ / ↓`, typed lines, emptied by a send), the chat moves by the same amount, so the line at its bottom stays just above the box. At the bottom, it stays at the bottom.
- **The ↓** (`JumpDown`) floats over the chat's bottom while you are away from it:
  - it counts Claude's messages that landed since (*1 new message*), else says *Newest*;
  - it has a spinner while Claude writes and its `End` keycap;
  - a click or `End` goes to the newest and follows again.

  `End` works on the open card (out of the message box, where End is the end of the line) and in the full-screen session, also when its box has lost the focus. `?` and the card's legend (*End Newest*) list it.

**Also:** the open card's header ran out of room at 1024 px with a panel open once §129's mode chip was in it (`walk-chat-width` caught it: the page scrolled 11 px sideways). The header is a container now, and below 768 px of its own width the `⇧Tab` keycap and the words *In a terminal* hide. The mode chip and the `g` keycap stay.

**Checked:**
- `pnpm typecheck`, `npx tsc --noUnusedLocals -p .`, `pnpm test` (414).
- `walk-card` 66/66, light and dark; `walk-hub` 41/41; `walk-perf` 25/25, every line OK (a key paints in 3–10 ms, p95; the open card streaming 9 ms).
- `walk-your-move` 32/32, light and dark; `walk-chat-width` 6/6, light and dark.
- The new `walk-chat-scroll` 26/26, light and dark, six runs in a row clean after the anchoring fix. On its own server (:7828), with a seeded card streaming, it checks the card chat and the full-screen session for:
  - following at the bottom;
  - eight 15 px wheel steps up staying put while it streams;
  - the ↓ showing and counting a message that lands;
  - the box taller, shorter, typed into and emptied keeping the distance from the bottom (300 → 300 px);
  - the box resized at the bottom keeping the newest line;
  - End and a click going back and following;
  - a turn ending at the bottom leaving no ↓.
- Screenshots of the ↓ looked at, light and dark.

## 131. A card without a ticket is a plain session

2026-10-08. The owner: "I think we should be able to start a new card without a jira card attached, these are just claude session's we're managing afterall."

**What was there:** a card could already start without a ticket (`draftOf` took a typed title), but the screen was built ticket-first:
- the ticket search came first and had the focus, and the title was a box under it;
- the opening message defaulted to *"Plan CARD-1."*, which tells Claude nothing without a ticket;
- so you typed your ask twice, and `Ctrl+Enter` with only a message refused (*"Give the card a title first"*).

**Asked, and chosen:** keep the layout and take the friction out; and a card without a ticket starts lighter, in the repo's current checkout and asking first.

**Now:**
- **No ticket, no made-up message.** The opening message starts empty and asks *"What should Claude do? Just say it: the first line names the card."* (`openingFor`). With a ticket it is as before (*"Plan SHOP-160."*).
- **Say it once.** `Ctrl+Enter` with only a message takes the card's title from its first line, cut at a word past 80 characters (`titleFromMessage`); a title and no message sends the title as the message. With neither, it says *"Say what Claude should do (the opening message), or pick a ticket."*
- **Lighter defaults.** A Develop card without a ticket starts in the repo's current checkout (no worktree, no branch) and in Ask before edits (`kindDefaults(kind, pr, ticket)`). Picking a ticket brings back a ticket card's defaults (a worktree, Plan first); taking it off goes back.
- The simple look forced a worktree for every Develop card. It now does so only with a ticket (`develop`), shows the Branch row behind Change without one, and its settings say what the branch really is (*"the current checkout"*).
- The no-ticket title box says it is optional: *"No ticket? Then it's a plain session: a title if you like, or the opening message's first line names it."*

**Walks changed:** `walk-hub` and `walk-perf` start a card without a ticket that has to plan in a worktree of its own, so they now pick *New worktree* and *Plan first* on the screen, as a person would.

**Checked:**
- `pnpm typecheck`, `npx tsc --noUnusedLocals -p .`, `pnpm test` (414; the composer's tests now cover the empty message, the title from the message, a title as the message, and the defaults flipping with a ticket). One run failed §119's 300 ms timing test; it passed again.
- `walk-card` 66/66, light and dark; `walk-hub` 41/41; `walk-perf` 25/25, every line OK (a key paints in 4–10 ms, p95); `walk-your-move` 32/32, light and dark; `walk-simple` 43/43.
- The new `walk-no-ticket` 10/10, light and dark, on its own server (:7829) with a real Haiku card in the simple look. It checks:
  - the empty message and its question;
  - the current checkout and Ask before edits in the settings;
  - `Ctrl+Enter` with nothing saying what is missing;
  - a message alone starting the card, titled by its first line, with no worktree made;
  - Claude's own reply.

  Screenshots looked at.
- `walk-simple` failed five checks on a server cluttered by earlier tests. On fresh servers it passed 43/43, both on the page before this change and with it.

**Seen, not changed:** the simple look's settings say *"Runs in a Windows Terminal tab"* even though cards now run in the app (§93); that line is hard-coded in `howFacts`.

## 132. Verify: a tab per tool; the record lookup takes the tool's own lists

2026-10-09. Handed off from the work laptop, where the owner checked the tools' real shapes with read-only requests. The panel was one page built around two read-only tools (§105); the owner wants a place to work in each tool, and a third: a scenario runner on the machine that makes test loans (§133). Decided there, not re-opened here: sub-sections, data-driven; the field set tool stays exactly as it was.

**Found on the real page** (no names here): the lookup's ids can have spaces in them (`Group.Name.Role Name`; about ten of the tool's own ~290 default ids do), and `splitIds` split them in two. The lookup was also capped at 40 ids. Its hidden `Fields[<id>].Options[n]` inputs (Advanced) were ignored. `Shift+L` opened the address the form posts to, which may not be a page.

**What changed.**
- **Sections** (`web/verify-model.ts`, pure and tested): `SECTIONS` is `{ id, defaultName, configured(cfg) }` for *Test data* (`builder`), *Record lookup* and *Field set*; a fourth tool is one entry plus one component. The machine file's `name` for each wins. The panel (`VerifyPanel.tsx`) keeps the Dev / UAT / Prod row on top, then a tab strip (`role="tablist"`, a dot for set up or not), then the section: `VerifyBuilder`, `VerifyLookup`, `VerifySet` (the field set's JSX moved over unchanged; its Refresh button moved into its own header). It opens on the first section set up; with none, the file note as before. The section is kept in memory, from card to card.
- **Keys.** `[` and `]` already size the panel, so the sections are **`Alt+←` / `Alt+→`** (with the panel open they no longer act as the browser's back). `e`, `Shift+P` and `Shift+L` work in every section. Field set: `i`, `Enter` (checks only now), `r`, `o`, `Shift+O`. Record lookup: `l`, `i` (its Fields box), `Enter`, `a`, `o` (its page), `f` the list picker, **`Shift+S`** save as list, **`Shift+F`** twice delete it, `/` filter, **`Shift+M`** only empty or missing, **`Shift+Y`** copy. The handoff named `m`, `c` and `s`; those are the More panel, add context and ship on an open card, so they stay that and the panel takes the shifted keys instead. The legend follows the section (`verifySection`), the `?` overlay has a row per section, and the dock's Verify tooltip says what it is now.
- **Ids** (`splitFieldLines`, shared): one per line as it is, inner spaces kept, trimmed, duplicates dropped case-insensitively, `^[A-Za-z0-9][\w .#-]{0,79}$`, at most `LOOKUP_MAX_IDS` = 400; a text with no line break is split on commas and semicolons. The page, the lists file, the server's `verify.lookup` and `LookupTool.fetch` all use it. The field check keeps `splitIds` and its 40.
- **Saved lists** (`~/.cc-control/field-lists.json`, or `CC_CONTROL_FIELD_LISTS_FILE`): `{ "lists": [{ "name", "ids" }] }`, watched like the Verify file (`FileWatch<T>` now takes a reader; `VerifyFileWatch` is one), sent as `verify.lists` on connect and on change. `verify.lists.save` and `verify.lists.delete` write only that file, whole, through a temporary file and a rename; names trimmed to 60, at most 50 lists of at most 400 ids each, ids through `splitFieldLines`; a broken file isn't overwritten. Protocol 30.
- **Results**: `parseLookup` reads `Fields[<id>].Options[n]` in `n` order into `options` (the empty first one, the tool's *clear*, left out). A row shows its option count (the options in its tooltip), *read-only* and *does not exist* as before. A filter over fields and values, *only empty or missing*, and a copy of the rows shown as `field=value` lines (the clipboard only; values still go nowhere else). Under the record box, chips for the last 8 records fetched (id and environment, in memory only); a chip or `↑ ↓` in the box puts the id back and chooses its environment. A Prod lookup adds no chip, so Prod stays two presses away.
- **Config** (`cleanVerify`): `lookup.page` (where `o` and `Shift+L` open; unset, `lookup.url`), `builder: { name, url, ui, start }` (`url` must be localhost, 127.0.0.1 or [::1], else dropped; `start` is only shown, never run), and for §134 `lookup.updateUrl` (same origin as `lookup.url`, else dropped) and `lookup.allowUpdate` (only the literal `true`). `pnpm run doctor`: a line for the lookup's page, the test-data tool, a warning for a `builder.url` off this machine (read from the raw file, since cleaning drops it), and the field lists.
- **Wording**: *"Nothing is written to either tool"* is gone; each section says what is true of its tool (the field set and the record lookup are only read here).

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (425). New tests: `splitFieldLines` (inner spaces, a 296-id list whole, the 401st dropped, CRLF, case-insensitive duplicates, a comma-only paste), `cleanVerify`'s new keys and the loopback check (and lookalikes), `cleanLists`; `parseLookup` on a fixture shaped like the real page (`server/verify.fixture.ts`: three forms, hidden inputs after each row, options, an id with a space, a read-only and a missing row; the same page without Advanced); the lookup sending 400 ids and the check 40; the lists file read, saved over by name in any case, capped, deleted, no temporary file left, a broken file kept; `FileWatch` with the lists reader; the sections, filter, copy lines and recent chips; the legend per section.

**`walk-verify.cjs` (61, light and dark)**: no file, no tabs; the file written, the tabs by name, the lookup first; `Alt+→ ←` round; the check, drift and `r` as before; a lookup through the ids box; a chip; a list saved with `Shift+S` (the id with a space whole, in the file), one added to the file by hand showing within seconds, chosen with `f`; the lookup posting the ids one per line, the space kept; `/`, `Shift+M`, `Shift+Y`; no record; `↑` and a chip bringing back record and environment; Prod (and no Prod chip); `o` on the lookup's page, not its post address; `Shift+F` twice; the `?` rows; the stand-ins saw only the reads and the four-field lookup form; the server log has no value, record id or field id. Screenshots looked at (the tab names wrapped in the 400 px panel; now one line each).

**Not yet:** the scenario runner itself (§133), updates through the lookup (§134).

## 133. Verify: Test data, the scenario runner on this machine

2026-10-09. The second phase of the work-laptop handoff (§132). The owner's scenario runner is an ASP.NET API with a web UI, both on the machine, that creates test loans in Dev or UAT by running a saved scenario. Decided there: drive it through its API from the server (not embedded), and send the loan it makes to the record lookup with one key.

**Its shape, as checked at VU** (made-up values here): JSON, camelCase, enums as strings. `GET api/scenarios` lists the latest version of each (`scenarioId`, `versionNumber`, `name`, `createdAtUtc`, `isLocked`, `tags`). `POST api/scenarios/{id}/versions/{n}/runs` with `{ "environment": "dev" | "uat" }` answers `{ runId }` and runs in the background (any other environment is a 400). `GET api/runs/{runId}` gives the status (`Running`, `Succeeded`, `Failed`), the steps (each with a status and, when it failed, `{ message, exceptionType, stackTrace }`), `finalArtifacts.loanGuids` and `runError`. It has other endpoints (create, versions, copy, lock, delete, resume, tokens) that Verify never calls.

**What changed.**
- **Server** (`server/verify-builder.ts`): `BuilderTool` (`scenarios`, `start(env, id, version)`, `run(runId)`) and its readers, `readScenarios` and `readRun`: camelCase or PascalCase keys, statuses in any case, missing arrays empty, odd entries skipped. A step's error and the run's are their message only, cut at 300 characters; a stack trace is never read. Plain fetch, 10 s, no credentials, never the Windows transport. A refused connection says *"‹name› isn't running here. To start it: ‹start›"* (the file's hint, never run).
- **Guard**: `VerifyRequest` gains `tool` and a JSON body. A `tool: 'builder'` request is checked on its own: the configured `builder.url` must be loopback, and the address, as written, must be exactly `<base>/api/scenarios` or `<base>/api/runs/<[\w-]{1,64}>` (GET, no body), or `<base>/api/scenarios/<id>/versions/<n>/runs` (POST) with a body of exactly `{ environment: 'dev' | 'uat' }`. Everything else is refused: other methods, other paths (create, versions, copy, lock, steps, resume, token, tags), a query, `..`, a lookalike or another host or port, a body with another key, a form. A JSON body to the other tools is refused too.
- **Protocol 31**: `builder.list` → `builder.scenarios`, `builder.start` → `builder.started` (`runId`), `builder.status` → `builder.run`. Errors go to the page that asked.
- **The section** (`VerifyBuilder.tsx`, state in `web/verify-builder.ts`, kept from card to card; the pure parts in `verify-model.ts`): the list read when the section first shows (`r` again), a filter (`/`, by name, `v3`, or a tag), `↑ ↓` / `j k` to choose, a lock badge. **Run** is two presses: the first arms for 4 s and says *"Enter again to create a loan in Dev with ‹scenario›"*, also under the button; a second on the same scenario in the same environment starts it. While it runs the page asks every 2 s (`runPhase`: until it ends, 15 minutes, or three failed asks in a row), with a status chip and the steps (✓ ✗ … · –, a failed step's message under it). On success the loan ids, `Shift+Y` copies them and `f` (or *Fetch in ‹lookup›*) opens the lookup with the id, the run's environment, the chosen list in the Fields box (with none, the box as it is), Advanced off, and fetches; the chip under the record box names the scenario. `o` opens the tool's UI. The tab's dot turns red when the tool didn't answer.
- **Never Prod**: the section shows only Dev and UAT; arriving on it while on Prod switches to Dev with a flash; `Shift+P` there says so and does nothing; the server and the guard refuse any other environment.
- Loan ids and step messages stay in the page's memory: not in a log, a card or a transcript, never sent to Claude.
- Keys: the handoff's `c` for copy is `Shift+Y` here too (`c` adds context on an open card). Legend, `?` rows (two for the section) and README follow.

**Verified:** `pnpm typecheck`, `tsc --noUnusedLocals`, `pnpm test` (432). New: the guard table (the three requests pass for dev and uat; Prod, extra keys, no body, an array, a form, DELETE, PUT, PATCH, create, versions, copy, lock, steps, resume, a run's steps, token, tags, a query, `..`, a GET with a body, a lookalike host, another port or host, an unmarked request, JSON to the lookup, a builder off this machine and none set up are refused); the readers with odd and missing fields (no stack trace survives); `start` sending exactly `{ environment }` to the version's runs, and nothing sent for Prod, a bad id or a bad run id; *not running* with and without the hint; an error answer's title and never its stack; the poll state machine (running, succeeded, failed, timeout, errors) and the two-step key.

**`walk-verify.cjs` (84, light and dark)**, the stand-in now with a made-up scenario runner on 18903 (three scenarios; a run that goes running → succeeded over three polls with a random loan guid, one that fails at step 2 with a message; anything else it is sent is flagged): set up at a dead port, the section says it isn't running with the hint and its dot says so; Prod in the lookup gives way to Dev on entering, with no Prod pill; `r` lists name, tags, lock and version; `Shift+P` does nothing; `/` filters; `↓` chooses; the first `Enter` only arms (no request), the second starts in Dev; the failing run shows *Failed* and its step's message, never the stack; the other goes *Running* then *Succeeded*, polled; `Shift+Y` copies the loan; `o` opens the UI; the run survives moving between sections; `f` lands in the lookup with the loan, Dev, the chosen list, Advanced off, and a chip named after the scenario; **the stand-in saw only the list, a start with `["environment"]` and the run's status from the server, nothing flagged**; the server log has no loan id or step message. Screenshots looked at.

**Not yet:** a Start button that runs the tool's dev command (or reuses Try it): the `start` hint covers it for now.
