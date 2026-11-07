export type ThemeChoice = 'light' | 'dark' | null;

const STORAGE_KEY = 'osusume-theme';

declare global {
  interface Window {
    /** From public/theme.js, which owns turning the stored choice into the page's theme. */
    osusumeApplyTheme: () => void;
  }
}

export const systemDarkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function writeTheme(choice: ThemeChoice): void {
  try {
    if (choice === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

/**
 * The toggle's next choice. System goes to the opposite of what is showing, so a click always
 * changes something visible, and the same choice as the system goes back to following it.
 */
export function nextTheme(choice: ThemeChoice, systemDark: boolean): ThemeChoice {
  const system = systemDark ? 'dark' : 'light';
  if (choice === null) return systemDark ? 'light' : 'dark';
  return choice === system ? null : system;
}
