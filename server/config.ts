// Machine settings, loaded before anything else reads them (server/boot.ts applies them, and
// server/index.ts imports that first).
//
// - Settings file: CC_CONTROL_* variables (and any other) from ~/.cc-control/config.env, or the file
//   CC_CONTROL_CONFIG names. Variables already set in the environment win, so a one-off
//   `CC_CONTROL_PORT=7788 node server/index.ts` still works. Keeps tokens (Jira, Azure DevOps) out of
//   shell profiles and in one place per machine.
// - Certificates: Node trusts only its own bundled roots, so company servers with an internal CA
//   (tfs.company.local, jira.company.local) fail with "unable to get local issuer certificate". The
//   certificates Windows trusts are added to Node's defaults, plus CC_CONTROL_CA_FILE (PEM) if set.
//   CC_CONTROL_SYSTEM_CA=0 turns the Windows ones off.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { parseEnv } from 'node:util';

export interface ConfigState {
  /** The settings file read, if any. */
  file?: string;
  /** The names it set (values never kept here: some are tokens). */
  set: string[];
  /** Names it didn't set because the environment already had them. */
  kept: string[];
  /** How many extra certificates were trusted, and any problem doing so. */
  systemCerts: number;
  caFile?: string;
  problem?: string;
}

export const config: ConfigState = { set: [], kept: [], systemCerts: 0 };

export const CONFIG_FILE = process.env.CC_CONTROL_CONFIG || join(homedir(), '.cc-control', 'config.env');

/** A setting that holds a secret: never handed to a terminal tab, a Try it step or a session. */
export const SECRET = /^CC_CONTROL_\w*(TOKEN|SECRET|PASSWORD|KEY)$/;

/** The environment minus every secret setting, for anything this server starts. */
export function withoutSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET.test(k)));
}

/** Read the settings file into the environment without overriding what is already set. */
export function loadConfig(file = CONFIG_FILE, env: NodeJS.ProcessEnv = process.env): ConfigState {
  const state: ConfigState = { set: [], kept: [], systemCerts: 0 };
  if (existsSync(file)) {
    state.file = file;
    try {
      const text = readFileSync(file, 'utf8');
      // PowerShell 5.1's Out-File writes UTF-16: every other byte is NUL, and nothing parses.
      if (text.includes('\u0000')) throw new Error('it is saved as UTF-16; save it as UTF-8 (in PowerShell: Set-Content -Encoding utf8, or Notepad → Save as → UTF-8)');
      const vars = parseEnv(text.replace(/^\uFEFF/, ''));
      for (const [k, v] of Object.entries(vars)) {
        if (env[k] !== undefined && env[k] !== '') state.kept.push(k);
        else { env[k] = v; state.set.push(k); }
      }
      const empty = Object.keys(vars).filter((k) => k.startsWith('CC_CONTROL_') && !vars[k]);
      if (empty.length) state.problem = `${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} set to nothing in ${file} (a value with # in it needs quotes).`;
    } catch (e) {
      state.problem = `Couldn't read ${file}: ${(e as Error).message}`;
    }
  }
  return state;
}

/** Trust the certificates Windows trusts (and CC_CONTROL_CA_FILE) for every https request. */
export function trustCertificates(env: NodeJS.ProcessEnv = process.env): Pick<ConfigState, 'systemCerts' | 'caFile' | 'problem'> {
  const extra: string[] = [];
  let problem: string | undefined;
  // Node 24 has these; on anything older, say so rather than fail while loading.
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return { systemCerts: 0, problem: `Node ${process.versions.node} can't add certificates; cc-control needs Node 24.` };
  }
  if (env.CC_CONTROL_SYSTEM_CA !== '0') {
    try { extra.push(...tls.getCACertificates('system')); } catch (e) { problem = `Couldn't read the system certificates: ${(e as Error).message}`; }
  }
  const caFile = env.CC_CONTROL_CA_FILE;
  if (caFile) {
    try {
      const pem = readFileSync(caFile, 'utf8');
      extra.push(...(pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []));
    } catch (e) {
      problem = `Couldn't read CC_CONTROL_CA_FILE (${caFile}): ${(e as Error).message}`;
    }
  }
  if (extra.length) {
    const defaults = tls.getCACertificates('default');
    tls.setDefaultCACertificates([...new Set([...defaults, ...extra])]);
  }
  return { systemCerts: extra.length, ...(caFile ? { caFile } : {}), ...(problem ? { problem } : {}) };
}

/** Load the settings file and trust the certificates; what the server and pnpm run doctor call first. */
export function applyConfig(): ConfigState {
  Object.assign(config, loadConfig());
  const certs = trustCertificates();
  config.systemCerts = certs.systemCerts;
  if (certs.caFile) config.caFile = certs.caFile;
  if (certs.problem) config.problem = [config.problem, certs.problem].filter(Boolean).join(' ');
  return config;
}
