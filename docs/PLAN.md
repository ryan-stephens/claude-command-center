# cc-control — implementation plan

A slim, local, **keyboard-first** command center for Claude Code sessions.
Pick a session with the arrow keys, press Enter, fire commands from the number pad, talk to it with a hotkey.

Status: **planning** · Started 2026-09-28

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
| `Alt+N` | Jump to the next session that **needs attention** |
| `Ctrl+Shift+N` | New session (pick repo → optional first prompt) |

### Session list (home)
| Key | Action |
|---|---|
| `↑ ↓ ← →` | Move selection (list or grid) |
| `Enter` | Open session |
| `/` | Filter (repo, title, status) |
| `Tab` | Switch between **Live** and **History** (all past sessions, resumable) |
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
| `↑ ↓ ← →` + `Enter` | Move around the board and fire the focused command |
| `i` or `Enter` (on the board) | Focus the composer |
| `Enter` / `Shift+Enter` (in the composer) | Send / newline |
| `Ctrl+.` | Interrupt the running turn |
| **Hold `` ` `` (backtick)** or **Hold `Numpad .`** | **Push-to-talk** voice input. Release to send. |
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
| **0. Spike** (½ day) | Prove the risky bits in a script: SDK streaming input keeps a session alive across turns; `canUseTool` round-trip; auth uses the existing Claude login (`accountInfo()`); `resume` works on a terminal-created session; runs on Windows; Web Speech works on localhost | A script holds a multi-turn session with a manual approval |
| **1. Core** | Server, SessionManager, WS protocol, session list with full keyboard nav, session view with streaming output and composer, history + resume | Create / resume / chat with 3 sessions using only the keyboard |
| **2. Attention** | Approval cards (Y/A/N), inbox, `Alt+N`, notifications and sound, tab-title count, interrupt | A blocked session is cleared in ≤ 3 keys from anywhere |
| **3. Command board** | Groups, numpad slots, send/insert/template modes, editor, per-repo packs, auto slash-commands, import/export | A starter pack is fired entirely from the numpad |
| **4. Voice** | Push-to-talk, transcript to composer, voice-triggered commands | Hold the key, speak, release, and it's sent |
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
