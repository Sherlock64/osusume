import { describe, expect, it } from 'vitest';
import { nextTheme, type ThemeChoice } from './theme';

describe('nextTheme', () => {
  it.each<[boolean, ThemeChoice[]]>([
    [true, [null, 'light', 'dark', null]],
    [false, [null, 'dark', 'light', null]],
  ])('cycles through all three choices, system dark %s', (systemDark, cycle) => {
    for (let step = 0; step < 3; step += 1) {
      expect(nextTheme(cycle[step] ?? null, systemDark)).toBe(cycle[step + 1]);
    }
  });
});
