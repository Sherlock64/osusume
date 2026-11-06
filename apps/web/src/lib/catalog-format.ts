import type { SeasonOfYear } from '@osusume/shared';

export const seasonOfYearLabels: Record<SeasonOfYear, string> = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
};

/** "Spring 2021", or as much of it as is known. Null when both are blank. */
export function formatAired(year: number | null, seasonOfYear: SeasonOfYear | null): string | null {
  const parts = [
    seasonOfYear === null ? null : seasonOfYearLabels[seasonOfYear],
    year === null ? null : String(year),
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(' ');
}
