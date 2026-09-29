// Starter workflows a new workspace can begin with. Plain labels on purpose: these are the
// number-pad keys a non-developer will read. Slots 1–3 and 7–9 are the same everywhere, so
// muscle memory carries between workspaces; 4–6 fit the kind of project.

import type { Command } from './protocol.ts';

export interface WorkflowTemplate {
  id: string;
  label: string;
  description: string;
  commands: Command[];
}

const common: Command[] = [
  { slot: 1, label: 'Continue', body: 'Continue.', mode: 'send' },
  { slot: 2, label: 'Summarise', body: 'Summarise what you did in 3 short bullets, in plain language.', mode: 'send' },
  { slot: 3, label: 'Explain…', body: 'Explain {{what}} in this project: where it lives and how it works, in plain language.', mode: 'template' },
  { slot: 7, label: 'Review my changes', body: 'Review the changes you made for bugs and risks. Explain anything I should know in plain language.', mode: 'send' },
  { slot: 8, label: 'What changed?', body: 'Run `git status` and `git diff --stat` and tell me, in plain language, what is changed and not yet committed.', mode: 'send' },
  { slot: 9, label: 'Commit my work', body: 'Commit your changes with a clear conventional commit message. Stage only the files you changed.', mode: 'send' },
];

const withCommon = (specific: Command[]): Command[] => [...common, ...specific].sort((a, b) => a.slot - b.slot);

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'web',
    label: 'Web app',
    description: 'Dev server, build errors, tests',
    commands: withCommon([
      { slot: 4, label: 'Start dev server', body: 'Start the dev server in the background and tell me the URL.', mode: 'send' },
      { slot: 5, label: 'Fix build errors', body: 'Run the build. If it fails, fix the errors and run it again until it passes. Report what you changed.', mode: 'send' },
      { slot: 6, label: 'Run the tests', body: 'Run the tests and summarise any failures in plain language.', mode: 'send' },
    ]),
  },
  {
    id: 'api',
    label: 'API service',
    description: 'Run it, try the endpoints, tests',
    commands: withCommon([
      { slot: 4, label: 'Start the server', body: 'Start the server in the background and confirm it responds.', mode: 'send' },
      { slot: 5, label: 'Try the endpoints', body: 'List the API endpoints, call each safe (read-only) one against the running server, and report what works.', mode: 'send' },
      { slot: 6, label: 'Run the tests', body: 'Run the tests and summarise any failures in plain language.', mode: 'send' },
    ]),
  },
  {
    id: 'docs',
    label: 'Docs',
    description: 'Proofread, check links, tidy',
    commands: withCommon([
      { slot: 4, label: 'Proofread', body: 'Proofread the docs I am working on for spelling, grammar and unclear sentences. Fix them and list what you changed.', mode: 'send' },
      { slot: 5, label: 'Check links', body: 'Check the links in the docs and fix or report any that are broken.', mode: 'send' },
      { slot: 6, label: 'Write a section…', body: 'Write a new section about {{topic}}, in the same style as the rest of the docs.', mode: 'template' },
    ]),
  },
  { id: 'blank', label: 'Blank', description: 'Start empty', commands: [] },
];
