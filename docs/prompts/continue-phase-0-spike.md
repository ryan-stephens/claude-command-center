# Continue: cc-control Phase 0 spike

Paste this into a Claude Code session opened in `D:\repos\cc-control`.

---

You're picking up **cc-control** (GitHub: `ryan-stephens/claude-command-center`). It is a slim, local, keyboard-first web app that acts as a command center for Claude Code sessions: arrow keys to pick a session, Enter to open it, number-pad hotkeys to fire saved commands, and push-to-talk voice.

**Read first:** `docs/PLAN.md` (product, keyboard map, architecture, phases, locked decisions) and `CLAUDE.md`.

## Where things stand
- The plan is written and pushed. Locked decisions: React + Vite + TS frontend; Web Speech API for voice with auto-send on key release; Node server using `@anthropic-ai/claude-agent-sdk`; `node:sqlite` for storage; bound to 127.0.0.1 only.
- `package.json` and `pnpm-lock.yaml` exist but are **uncommitted**. The SDK is installed. The `spike` / `spike:voice` scripts point at files that don't exist yet.
- The earlier planning happened in an rc-hub session. **Don't touch `D:\repos\rc-hub`**, because another session is actively working there.

## SDK facts already verified (from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)
These were read from the types but **not yet exercised at runtime**. Proving them is the point of Phase 0.
- `query({ prompt: string | AsyncIterable<SDKUserMessage>, options })` returns `Query` (an AsyncGenerator of `SDKMessage`). Passing an async-iterable input queue should keep one session alive across turns.
- `SDKUserMessage` = `{ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id }`.
- `Query` methods include `interrupt()`, `setPermissionMode()`, `setModel()`, `supportedCommands()` (returns `{ name, description, argumentHint }`), `getContextUsage({ detail })`, `accountInfo()`, `streamInput()` and `close()`.
- `options.canUseTool(toolName, input, { signal, suggestions, blockedPath, ... })` returns `PermissionResult`: `{ behavior: 'allow', updatedInput?, updatedPermissions? }` or `{ behavior: 'deny', message, interrupt? }`. "Always allow" means returning `suggestions` as `updatedPermissions`.
- Useful options: `cwd`, `resume`, `forkSession`, `model`, `permissionMode` (`default|acceptEdits|bypassPermissions|plan|dontAsk|auto`), `includePartialMessages`, `abortController`, `settingSources`. **When `settingSources` is omitted, all settings load, the same as the CLI**, so user allow-rules may auto-approve tools. Pass `[]` to test the approval path cleanly.
- Status event: `{ type: 'system', subtype: 'session_state_changed', state: 'idle' | 'running' | 'requires_action' }`. This drives the list badges.
- Standalone functions: `listSessions({ dir, limit, offset, includeWorktrees })` returns `SDKSessionInfo` (`sessionId`, `summary`, `lastModified`, `customTitle`, `firstPrompt`, …); `getSessionMessages(id, { dir, limit, includeSystemMessages })`; `getSessionInfo(id)`; and a rename function.
- Transcripts are JSONL files under `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` (for example `D--repos-rc-hub`). Entries carry `cwd`, `gitBranch`, `entrypoint`, `version`.
- Environment: Node 24, pnpm 11, Claude Code CLI 2.x on PATH, Windows 11. The `rtk` prefix is not installed, so run commands unprefixed.

## Your task: Phase 0 (PLAN.md §6)
Write `spike/sdk-spike.mjs` (plain ESM, no build step). It should prove each item below and print a PASS/FAIL table. Use a cheap model (Haiku 4.5) and a **fresh temp directory as `cwd`**. **Never resume or write into real rc-hub sessions.**

1. **Auth**: `accountInfo()` shows the SDK runs on the existing Claude login, with no `ANTHROPIC_API_KEY` needed. Report the auth source without dumping personal data.
2. **Multi-turn**: push turn 1 through an async input queue ("remember codeword X"), wait for `result`, push turn 2 ("what was the codeword?"). Same `session_id`, and the codeword comes back.
3. **Approvals**: with `settingSources: []` and `permissionMode: 'default'`, ask for a Bash write. `canUseTool` fires and **allow** creates the file. Ask for a second write, **deny** it, and confirm that file doesn't exist.
4. **Status events**: record which `session_state_changed` states appear (`running` → `idle`, and `requires_action` during the approval).
5. **Interrupt**: start a long turn, call `interrupt()` after the first assistant chunk, then confirm the session still answers a follow-up.
6. **Introspection**: `supportedCommands()` (repeat with default `settingSources` to see user skills and commands) and `getContextUsage()`.
7. **History**: `listSessions({ dir: tempDir })` finds the spike session, and `getSessionMessages` returns its turns.
8. **Resume a terminal-made session**: create one with `claude -p "Remember codeword Y. Reply OK." --output-format json --model haiku` in the temp directory, spawned with `shell: true` on Windows. Take `session_id` from the JSON, resume it via the SDK with `resume`, and confirm codeword Y is returned.
9. **Voice (manual)**: write `spike/voice-server.mjs`, which serves `spike/voice.html` on `http://localhost:7778`. The page uses `webkitSpeechRecognition` with hold-backtick push-to-talk and shows the transcript. The owner tests it by hand in Chrome and Edge; automated Chromium has no speech backend.

Then:
- Record the results, including any surprises or API shapes that differ from the above, in a new `docs/PLAN.md` section called "§9 Phase 0 findings". Adjust the architecture if something failed.
- Commit (conventional commits; stage named paths only, never `git add -A`). **Ask before pushing.**
- Propose the Phase 1 breakdown, as concrete files and components, for the owner to approve.

## Working style
The owner prefers autonomous end-to-end execution with minimal back-and-forth. Ease of use and speed are the product. Keep it slim, keyboard-first, and make everything discoverable on screen.
