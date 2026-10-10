// Command Center v2: the shapes the server and the page share. A session is the unit of work: a
// ticket (or a plain ask), worktrees in the repos it touches, a context pack Claude reads, a stack
// of one UI and any number of APIs, the tools Claude calls (test loans, field checks, ship), and
// the PRs it ships. Claude itself runs where the user already works (a terminal, VS Code, Claude
// Desktop); hooks report its state here. Nothing in v2 replicates Claude Code's chat.

export type Opener = 'terminal' | 'vscode' | 'desktop';
export const OPENERS: Opener[] = ['terminal', 'vscode', 'desktop'];

/** What Claude is doing, from its hooks. needs-you: a permission prompt or a question; done: its turn ended. */
export type ClaudeState = 'starting' | 'working' | 'needs-you' | 'done' | 'ended';

export interface ClaudeStatus {
  state: ClaudeState;
  /** One line: "wants to run Bash: pnpm db:migrate", "editing fees.ts", "turn ended". */
  text: string;
  at: number;
  /** Claude Code's own session id, from its SessionStart hook: what --resume takes. */
  claudeId?: string;
}

export interface TicketInfo {
  key: string;
  title: string;
  url?: string;
  description: string;
  acceptance: string[];
  /** The other tickets and PRs it links to, as one line each. */
  links: string[];
}

export interface SessionRepo {
  /** The repo's own folder (the main checkout). */
  repo: string;
  name: string;
  /** Where the session works on it: its worktree. */
  dir: string;
}

export interface LoanMade {
  loan: string;
  env: 'dev' | 'uat';
  scenario: string;
  at: number;
}

export interface FieldCheckResult {
  loan: string;
  env: 'dev' | 'uat';
  /** The saved field list it read, when it read one. */
  list?: string;
  total: number;
  /** Fields that read as expected (all of them found, when nothing was expected). */
  matched: number;
  /** Fields that didn't: missing, or not the expected value. */
  differs: { id: string; expected?: string; actual?: string }[];
  at: number;
}

export type EvidenceKind = 'tests' | 'tried' | 'loan' | 'fields' | 'note' | 'screenshot';

/**
 * A data check (§139): a test loan made (or one given), fields filled through the record lookup,
 * waited on until they apply, then read and compared. Asked for by you from the Switchboard or by
 * Claude through the toolbelt; run by the server, step by step, in Dev or UAT only.
 */
export interface DataCheckAsk {
  env: 'dev' | 'uat';
  /** Make a new loan from this scenario... */
  scenario?: string;
  /** ...or use this one. */
  loan?: string;
  /** Field id → the value to fill in ('' clears it). */
  set?: Record<string, string>;
  /** A saved field list to read as well. */
  list?: string;
  /** More field ids to read. */
  fields?: string[];
  /** Field id → the value it should have (what is set is expected too). */
  expect?: Record<string, string>;
}

export type DataStepName = 'loan' | 'set' | 'apply' | 'check';
export type DataStepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

export interface DataCheck {
  id: string;
  ask: DataCheckAsk;
  by: 'you' | 'claude';
  state: 'running' | 'passed' | 'differs' | 'failed';
  steps: { name: DataStepName; state: DataStepState; text: string }[];
  loan?: string;
  result?: FieldCheckResult;
  /** What each field read as at the end (null: not there). */
  values?: Record<string, string | null>;
  /** The lookup's progress page for the update, when it gave one. */
  watchUrl?: string;
  startedAt: number;
  endedAt?: number;
}

export interface Evidence {
  kind: EvidenceKind;
  text: string;
  at: number;
  ok: boolean;
}

export interface ShippedPr {
  repo: string;
  number: number;
  url: string;
  state?: 'OPEN' | 'MERGED' | 'CLOSED';
  review?: string;
  checks?: 'pass' | 'fail' | 'pending' | 'none';
}

export interface Session {
  id: string;
  /** SHOP-160, or a slug of the ask when there is no ticket. */
  key: string;
  title: string;
  ticket?: TicketInfo;
  workspaceId: string;
  repos: SessionRepo[];
  /** Where Claude starts: the first repo's worktree. */
  home: string;
  branch: string;
  createdAt: number;
  opener: Opener;
  firstMessage: string;
  claude: ClaudeStatus;
  loans: LoanMade[];
  fields: FieldCheckResult[];
  /** Data checks, newest last (the last few kept). */
  checks?: DataCheck[];
  evidence: Evidence[];
  prs: ShippedPr[];
  /** When the review request was posted, and where. */
  posted?: { at: number; channel?: string };
  /** The values the stack was last started with (env: dev). */
  stackValues?: Record<string, string>;
}

export type Health = 'starting' | 'up' | 'unhealthy' | 'failed' | 'stopped';

export interface ServiceView {
  /** The API's repo name, or "ui". */
  name: string;
  kind: 'api' | 'ui';
  port?: number;
  /** "local :5041", "okteto · forwarded :5047". */
  where: string;
  health: Health;
  /** Since when it has been in this health. */
  since: number;
  /** "no answer 20 s", "compiling", "exited (code 1)". */
  note?: string;
}

export interface StackView {
  sessionId: string;
  values: Record<string, string>;
  services: ServiceView[];
  /** The UI's address (through the front door when it is behind one). */
  uiUrl?: string;
  door?: { home: number; shown: boolean };
}

export interface DoorView {
  home: number;
  /** The session it shows. */
  shown?: string;
  /** Every session whose UI is behind it, with its own port. */
  members: { sessionId: string; key: string; port: number }[];
}

export interface Leftover {
  id: string;
  key: string;
  /** "2 stop steps (okteto down …)", "a proxy file put back". */
  text: string;
}

export interface WorkspaceView {
  id: string;
  name: string;
  repos: { path: string; name: string }[];
  /** The stack's APIs, by repo name, when the workspace has a stack. */
  apis: string[];
  ui?: string;
  choose: Record<string, string[]>;
}

export interface Snapshot {
  sessions: Session[];
  stacks: Record<string, StackView>;
  doors: DoorView[];
  leftovers: Leftover[];
  workspaces: WorkspaceView[];
  config: {
    jira: boolean;
    slack?: { channel: string };
    loans: boolean;
    fields: boolean;
    /** Fields can be filled through the record lookup on this machine (Dev and UAT). */
    updates: boolean;
    fieldLists: string[];
    port: number;
  };
}

/** One line in the Launchpad's ticket picker. */
export interface TicketPick {
  key: string;
  title: string;
  status: string;
  url?: string;
  updatedAt: number;
  /** Assigned to you and still workable; else found by a search. */
  mine: boolean;
}

/** The picker's answer: your tickets, and (for a search) what Jira found. */
export interface TicketPicks {
  mine: TicketPick[];
  found: TicketPick[];
  /** Where they came from: Jira, or the demo set on a machine without Jira. */
  source: 'jira' | 'demo';
  problem?: string;
}

/** What the Launchpad builds before anything happens. */
export interface Preflight {
  key: string;
  title: string;
  branch: string;
  ticket?: TicketInfo;
  repos: { path: string; name: string; on: boolean; why: string }[];
  apis: { name: string; on: boolean; why: string }[];
  firstMessage: string;
  contextPreview: string;
  problem?: string;
}

/** What the Ship dock shows before anything is pushed. */
export interface ShipPlan {
  title: string;
  body: string;
  repos: { name: string; branch: string; ahead: number; dirty: number; host?: string; pr?: ShippedPr; blocker?: string }[];
  evidence: Evidence[];
  slack?: { channel: string; text: string };
  blockers: string[];
}
