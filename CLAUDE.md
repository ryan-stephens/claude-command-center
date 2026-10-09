# cc-control — notes for Claude

- Plan and phase status: `docs/PLAN.md`. Update it in the same commit when scope changes.
- Local-only tool: the server binds to 127.0.0.1. Never add public deployment (it is effectively a remote shell).
- v1 (`server/`, `web/`): keyboard-first is the product. Every new UI action needs a key binding and an entry in the `?` overlay.
- v2 (`v2/`, PLAN §137) is the second draft, built beside v1: sessions run in the user's own Claude Code client, the app launches, shows stacks, hands Claude tools (MCP) and ships. No keyboard-first rule there; reuse v1's server modules rather than copying them. Its walk: `docs/walkthroughs/v2/walk-v2.cjs`.
- Built on `@anthropic-ai/claude-agent-sdk`. Check its `sdk.d.ts` before assuming an API shape.
- Windows 11 dev box; Node 24 (`node:sqlite` is used instead of native SQLite bindings). Package manager: pnpm.
- Conventional commits; stage named paths, never `git add -A`.
- MVP pace (PLAN §136): before a commit, `pnpm typecheck` + `pnpm test` + the walk for the feature you touched (one theme). The full walk set and `walk-perf` only when the change touches those areas or before a showcase. Then push.

## Two laptops
Development happens on the personal laptop only. The VU work laptop can't push, so sessions there don't edit or commit; they diagnose and write a handoff prompt (what happened, cause, what to change, how to check it back there, open items) with no VU code, URLs, proxy entries, ticket contents, tokens or internal tool names. The shape is `docs/prompts/vu-handoff-template.md`.
