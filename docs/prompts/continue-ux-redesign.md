# Continue: cc-control UX redesign

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're picking up **cc-control** (GitHub: `ryan-stephens/claude-command-center`), a local web app that acts as a command center for Claude Code sessions. It works: all planned phases are built, hardened by an independent review, and pushed. **The job now is UX.** Make it as intuitive as an Apple product, so that a **non-technical person could use it to get coding work done with Claude**, without losing any functionality.

## Read first
- `CLAUDE.md` (project rules) and `README.md` (what the product is today).
- `docs/PLAN.md`: §1 principles, §3 keymap, §5 architecture, and §9–§16, the build notes for each phase. They are long; skim them for decisions and gotchas.
- Look at `docs/screenshots/*.png` to see the current UI before reading any component code.

## Where things stand
- **Stack:**
  - Node 24 server (`server/`, TypeScript run directly via type stripping, no build step), built on `@anthropic-ai/claude-agent-sdk`.
  - React + Zustand + Tailwind v4 SPA (`web/`).
  - Shared protocol in `shared/protocol.ts`.
  - `node:sqlite` for settings and commands.
- **Features to keep** (all working):
  - session list (Inbox / Live / History), resume and fork of history sessions
  - streaming transcript and composer
  - Y/A/N approval cards, the attention inbox and `Alt+N`
  - a numpad command board with global, per-repo (`.cc-control/commands.json`) and slash-command groups
  - templates, push-to-talk voice (Web Speech), the `Ctrl+K` palette, rebindable shortcuts
  - the live activity line (thinking / tool + timer / background tasks)
  - Esc-to-stop, Ctrl+B to background, per-task stop
  - phone layout, notifications and sound, the context meter, a first-run welcome card
- **Checks:** `pnpm typecheck`, `pnpm test` (25 `node:test` tests) and `pnpm build` must stay green. CI runs them on every push.

## The goal
The owner's words: *"improve the UI/UX of this tool until we land on something we can use intuitively, easily understand what we're looking at (lists make that hard) and ensure we have full functionality, but make it as easy as possible to use. Something as easy and intuitive as iOS products, something non-technical users would be able to code with."*

It is being prepared to **showcase to the owner's organization**. Favour clarity, calm and polish over new features, and don't add heavy integrations (local Whisper, Tailscale and the like are parked).

## Known pain points (verify, then add your own)
- **The home screen is a dense table.** Status, title, path, branch, context %, and age are all the same weight. It's hard to see at a glance what needs you, what's working, and what's done.
- **Jargon everywhere:** "idle", "requires_action", "elsewhere", "fork", "ctx 16%", "HEAD", "slash", "repo pack", "MINE / REPO / SLASH", tool names like `Bash` and `Read`, raw shell commands in approval cards.
- **Approvals show a raw command** (`node -e "…"`) with Yes / Always / No, and no plain-language explanation of what will happen or how risky it is.
- **The transcript** mixes chat with noisy tool rows and full Windows paths.
- **Starting a session means typing a full folder path.** There's no friendly project picker, name or icon.
- **The command board is numbers-first** (numpad slots) and hard to understand if you don't use a numpad.
- **Keyboard hints are everywhere** (hint bar, kbd chips on every control). Great for power users; noise for everyone else.
- **Dark-only, small type, lots of low-contrast grey.**

## Direction to explore (proposals, not mandates)
- **Home:** cards or sections grouped by what matters: *Needs you* → *Working* → *Done recently*, with projects (folders) as friendly, named, iconed things. Keep a list or table view as an option.
- **Plain language:** "Waiting for your OK", "Working on it…", "Done", "Running a command", "Reading files".
- **Approvals that explain themselves:** what Claude wants to do, in plain words; which files or commands it touches; and a clear safe or careful signal. Raw details go behind "Show details".
- **One obvious primary action per screen** (for example a big "Ask Claude…" composer). Progressive disclosure for everything else.
- **Commands as friendly shortcuts:** name, icon and description, tap or click first. Number keys stay as accelerators.
- **Keep power-user speed:** every action still has a key, and `?` and `Ctrl+K` stay. Hints become quieter (on hover or focus, or a "Show shortcuts" toggle).
- **A light theme**, larger type and touch targets, and accessibility (contrast, focus rings, screen-reader labels).

## How to work
1. **Audit first.** Walk the app as a non-technical first-time user: start a session, ask for a change, approve something, stop it, find old work. Screenshot every screen and state, and write findings ranked by how much they confuse. Put them in `docs/UX-AUDIT.md`.
2. **Propose 2–3 design directions** with visual mockups: an HTML Artifact is ideal, or static HTML under `docs/`. Show the home screen, a session, an approval and a new session in each. **Let the owner pick before building.**
3. **Build iteratively**, one screen or flow at a time. Keep the behaviour, protocol and tests intact. Add tests for any new pure logic (plain-language labels, grouping, risk classification).
4. **Verify like a user.** Use scripted walkthroughs with screenshots, and check desktop at 1440×900 and phone at 390×844.

## Testing setup (learned the hard way)
- **Never disturb the owner's running app on `:7777`, or their browser window.**
  - Run a test server with `CC_CONTROL_PORT=7788 CC_CONTROL_DB="$TEMP/cc-test.db" CC_CONTROL_MODEL=claude-haiku-4-5-20251001 node server/index.ts`.
  - Drive it with a standalone headless Playwright script. Playwright lives at `C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright`; launch it with `executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'`.
  - The shared Playwright MCP browser may be in use by the owner.
- **Stay on the Live tab and your own test folders in scripts.** History lists the owner's real sessions. Opening or sending to them is not OK, and a past test script did open one by accident.
- **Screenshots for docs must contain demo data only.**
  - Use the throwaway repos in `%TEMP%\cc-demo\{web-app,payments-api,docs-site}`, or recreate them.
  - Use a separate DB, and the Live tab or a filter.
  - Check every image for real session titles before committing.
- **Testing voice, approvals and the model:**
  - Headless Chromium has no speech recognition; inject a fake `SpeechRecognition` **and** `webkitSpeechRecognition`.
  - Y/A/N are ignored for 400 ms after an approval card appears (on purpose), so pause before pressing them in scripts.
  - The CLI refuses long foreground `sleep`; use `node -e "setTimeout(…)"`.
  - The owner's global settings auto-allow some tools, so not every tool call produces an approval card.
- **Don't touch `D:\repos\rc-hub`.** Another session works there, and test prompts sometimes wander into it; deny those.

## Rules
- Conventional commits; stage named paths, never `git add -A`. Update `docs/PLAN.md` (a new section) in the same commit when behaviour changes.
- Commit at each milestone. Ask before pushing unless the owner has said to push.
- Local-only security stays as is: loopback bind, Host and Origin checks. Never add public deployment.
- The owner prefers autonomous, end-to-end work with minimal back-and-forth, **except** the design-direction choice in step 2, which is theirs.

## Done when
A non-technical person, with no docs and no keyboard shortcuts, can:
- open the app and understand at a glance what's going on
- start work in one of their projects
- ask for a change and follow what Claude is doing in plain language
- confidently approve or deny actions
- stop it
- find and continue earlier work

All of that is verified by a scripted walkthrough with screenshots, and every existing capability is still reachable, including by keyboard for power users.
