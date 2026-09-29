# cc-control — implementation plan

A slim, local, **keyboard-first** command center for Claude Code sessions.
Pick a session with the arrow keys, press Enter, fire commands from the number pad, talk to it with a hotkey.

Status: **Phase 4 done** (voice, 2026-09-28) · Started 2026-09-28

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
| `Alt+Shift+N` (or `N` in the list) | New session (pick repo → optional first prompt). Not `Ctrl+Shift+N`: Chrome reserves it for an incognito window and pages can't intercept it. |

### Session list (home)
| Key | Action |
|---|---|
| `↑ ↓ ← →` | Move selection (list or grid) |
| `Enter` | Open session |
| `/` | Filter (repo, title, status) |
| `Tab` / `Shift+Tab` | Cycle **Inbox** (needs you) → **Live** → **History** (all past sessions, resumable) |
| `Y` / `A` / `N` | In the Inbox: answer the selected approval without opening the session. (`N` means "no" there; use `Alt+Shift+N` for a new session.) |
| `R` | Rename session |
| `X` | Stop session (with confirmation) |

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
| `Ctrl+.` | Interrupt the running turn |
| **Hold `` ` `` (backtick)** or **Hold `Numpad .`** | **Push-to-talk** voice input. Release to send. Like the numpad, this works only while you aren't mid-message, so backticks still type. `Esc` while holding cancels. |
| `Y` / `A` / `N` | Pending approval: **Y**es once / **A**lways / **N**o. Works when the approval card is focused, which happens automatically. |

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
- Remote/phone access (phase 5) goes over **Tailscale** with a random bearer token that the server prints on start. It is never deployed on Coolify.

## 6. Phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Spike** (½ day) ✅ | Prove the risky bits in a script: SDK streaming input keeps a session alive across turns; `canUseTool` round-trip; auth uses the existing Claude login (`accountInfo()`); `resume` works on a terminal-created session; runs on Windows; Web Speech works on localhost | A script holds a multi-turn session with a manual approval |
| **1. Core** ✅ | Server, SessionManager, WS protocol, session list with full keyboard nav, session view with streaming output and composer, history + resume | Create / resume / chat with 3 sessions using only the keyboard |
| **2. Attention** ✅ | Approval cards (Y/A/N), inbox, `Alt+N`, notifications and sound, tab-title count, interrupt | A blocked session is cleared in ≤ 3 keys from anywhere |
| **3. Command board** ✅ | Groups, numpad slots, send/insert/template modes, editor, per-repo packs, auto slash-commands, import/export | A starter pack is fired entirely from the numpad |
| **4. Voice** ✅ | Push-to-talk, transcript to composer, voice-triggered commands | Hold the key, speak, release, and it's sent |
| **5. Polish** | `Ctrl+K` palette, `?` overlay, rebinding, phone layout, Tailscale + token, context-usage meter | Daily-driver quality |
| Later | Local Whisper, diff viewer for edits, per-session cost, multi-machine, session templates ("new session in rc-hub with /card-author") | — |

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
