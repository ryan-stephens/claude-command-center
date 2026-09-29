// Light / dark: follows the OS unless the user picks one. A per-browser preference, so localStorage.

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'cc-control.theme';
const ORDER: ThemePref[] = ['system', 'light', 'dark'];

export function loadTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
}

/** system → light → dark → system. Returns the new preference. */
export function nextTheme(pref: ThemePref): ThemePref {
  return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
}

export const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: match Windows', light: 'Theme: light', dark: 'Theme: dark' };
