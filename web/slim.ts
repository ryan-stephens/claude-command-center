// The slim chrome (2026-10-01, the owner, while the UI is redesigned around the simple new-card
// screen): the parts of the frame that are hidden for now, each still built and still driven by its
// keys, so any of them comes back by flipping its flag (or restyled in its own time). Nothing here
// changes what the keys do; ? still lists every one.

export const SLIM = {
  /** The bar of keycaps at the bottom of every screen. */
  legend: true,
  /** The / filter box on the Ticket Line's bar. */
  filter: true,
  /** The Tickets and New card buttons on the Ticket Line's bar (Shift+T and c still work). */
  lineButtons: true,
  /** The workspace's repos row under it: Add, Remove, Edit, Share, Import, Library folders (their keys still work). */
  workspaceBar: true,
  /** The Search button in the header (Ctrl+K still works). */
  search: true,
} as const;
