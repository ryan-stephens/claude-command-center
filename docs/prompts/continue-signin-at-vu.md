# Find out why the UI can't sign in on a picked port, at VU

Paste this into a new Claude Code session on the **VU work laptop**, opened in the cc-control clone.

---

You're helping the owner find out what it would take for **cc-control**'s Try it to run a card's UI on a port of its own **and still sign in**. cc-control is a local web app over Claude Code sessions (the Ticket Line board: a card per ticket, its session in the card). Since §114 (`docs/PLAN.md`), two cards can run the same API and UI at once: each card's UI dev server gets `--port <a port from 18000-18999>`. But a UI on such a port can't sign in. The team's identity provider (an OIDC app) rejects the login: `redirect_uri` must be one of the app's registered login redirect URIs, and only the UI's usual port is registered there.

**The plan chosen on the personal laptop**, pending what you find here:
- **First choice:** get a small fixed set of extra localhost ports registered with the OIDC app (say the usual one and three more). cc-control would then pick a card's UI port from that set (a separate pool, `CC_CONTROL_UI_PORTS`), not from the 18000 range.
- **Fallback, if registration is refused or slow:** one front door on the usual port, a small proxy that forwards to the chosen card's UI. Only one card's UI could be reached at a time per browser.

Your job is to answer the questions below, with evidence, so the personal laptop can build the right one.

## This laptop doesn't edit or commit
See `CLAUDE.md`, *Two laptops*: development happens on the personal laptop only. Here you **diagnose and write a handoff** in the shape of `docs/prompts/vu-handoff-template.md`. Don't change code or commit: in cc-control, and in the UI or API repos too.

**The handoff must never include** the identity provider's host or tenant, the app's client id, any client secret or token, any VU URL or host, or the UI's code. Describe them instead: "the provider's authorize address", "the UI's auth config file", "the usual port" (the number of a localhost port is fine).

## Tokens are tight on this machine
- Read only: `CLAUDE.md`; `docs/PLAN.md` §114 (search for `## 114.`; don't read the whole file); `docs/prompts/vu-handoff-template.md`.
- In the UI and API repos, search (`Grep`) for what's named below rather than reading folders.
- Don't run Playwright here. The owner uses the browser; ask what DevTools shows.

## What to find out

### 1. How the UI builds its `redirect_uri`
1. **What it sends.** Have the owner Try it on a card (the UI comes up on 18xxx), open DevTools → Network with *Preserve log* on, and sign in. On the request to the provider's authorize address, what is `redirect_uri`: the 18xxx origin, or the usual port? Ask the same of `post_logout_redirect_uri` if they sign out.
2. **Where it comes from.** In the UI repo, find the OIDC client's setup: search for `redirectUri`, `redirect_uri`, `postLogoutRedirectUri`, `silentRedirectUri`, `silent_redirect_uri`, `window.location.origin`, `location.origin`. Is each one built from the page's address, from the environment files (`environment*.ts` or similar), or from a config file read at runtime? Name the file kinds and say how, not the values.
3. **The flow.** Does the browser exchange the code itself (authorization code with PKCE, a public client: a request to the provider's token address shows in the Network tab), or does the callback go to the API, which exchanges it? Is there silent renew (a hidden iframe or a refresh token)?
4. **Where sign-in is kept.** `localStorage` or `sessionStorage` (each port has its own, so two cards are signed in separately), or a cookie (cookies on localhost are shared by every port, so two cards could overwrite each other's)? DevTools → Application shows which.

### 2. Whether the API checks the origin too
1. **CORS.** In the API repo, find its CORS setup (search `AllowedOrigins`, `WithOrigins`, `Cors`, `Origin`). Is localhost on the usual port listed, a localhost pattern, or anything at all?
2. **Does the browser reach the API directly**, or only through the UI dev server's proxy (the proxy file Try it rewrites)? If only through the proxy, does the proxy set `changeOrigin`, and does the API see the 18xxx origin anyway (an `Origin` or `Referer` header it checks)?
3. **The token.** Does the API check anything about the token that depends on the client or the page's address (audience or authorized-party claims)? It should be the same on any port; say if it isn't.
4. **The provider's own origin check.** If the browser calls the provider's token address (point 1.3), the provider may also keep a list of trusted origins for CORS, separate from the redirect URIs. Does that call fail from 18xxx once the redirect is allowed? (It can only be tested after point 3; until then, say whether the owner can see that list.)

### 3. What can be registered
1. **What's registered now.** If the owner can see the OIDC app's settings (or ask whoever can), which localhost redirect URIs are already there: only the usual port, or several (other developers often add their own)? Give the localhost ports and paths, not the provider's host. If three or more are already there, the first choice needs no request at all.
2. **Who administers the app**, and how long a change usually takes.
3. **Would they add a few fixed localhost ports** (the usual one and three more, numbers the owner picks), with the same path, for each of: login redirect, logout redirect, and the trusted origin if there is one?
4. **Wildcards:** does the provider allow a wildcard port or subdomain in a redirect URI? Usually not; one line saying so is enough.

### 4. Anything else on a fixed port
While the UI is up on 18xxx, does anything else it loads stay on a fixed port (module-federation remotes, a mock server, a websocket)? §114 lists this as unseen.

## The handoff
In the template's shape. Put the answers to 1 to 4 under **Cause**, each marked *checked (how)* or *guess*. Under **What to change**, say which choice the answers point to (registered ports, or the front door), the ports the owner can get, and the path the redirect uses. Under **Open items**, whatever couldn't be found out, such as a registration request still waiting.
