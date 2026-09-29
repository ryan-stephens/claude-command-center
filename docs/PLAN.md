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
| `Alt+Shift+N` (or `N` in the list) | New session (pick repo → optional first prompt). Not `Ctrl+Shift+N`: Chrome reserves it for an incognito window and pages can't intercept it. |

### Home (since §17: three columns plus the repo library)
| Key | Action |
|---|---|
| `← →` | Move between columns: **workspaces → sessions → preview** |
| `↑ ↓` `Home` `End` | Choose in the focused column |
| `1–9` / `0` | Jump to workspace 1–9 / everything outside your workspaces (number row or numpad) |
| `Enter` | Open the selected session (in the workspace column: go to its sessions) |
| `N` | New session in the current workspace |
| `W` | New workspace; `E` / `Delete` in the workspace column edit / delete it |
| `+` / `−` | Add a repo to the current workspace / remove one (every session in it can use them all) |
| `Tab` | Go to the repo library (`← →` choose, `Enter` add to this workspace, `N` new session in it, `F` source folders); `Tab` or `Esc` back |
| `/` | Filter sessions (title, repo, branch) |
| `C` / `Shift+C` | Fold what you're in: the workspace column (to a rail), the selected session's group, the repo library / open every group |
| `Y` / `A` / `N` | In the preview column: answer the selected session's approval without opening it |
| `R` | Rename session |
| `X` | End session (with confirmation) |

### Folder picker
The folders dialog (`F` in the library), the workspace editor's "add a folder", and "Another folder…" (`Ctrl+O`) in the new-session and add-a-repo pickers all use it.

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
