import {
  ALT_TITLES_MAX,
  EPISODE_COUNT_MAX,
  ORDINAL_MAX,
  SUGGESTED_TAGS_MAX,
  SYNOPSIS_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  YEAR_MAX,
  YEAR_MIN,
  seasonOfYearSchema,
  type CatalogProposal,
} from '@osusume/shared';
import { z } from 'zod';

/*
 * Catalog request forms arrive as flat strings, with a new series' seasons named like
 * `seasons.0.title` so that errors land on the right input. These schemas check those strings and
 * build the proposal the api takes, leaving out whatever was left blank.
 */

const isWholeNumber = (value: string, min: number, max: number) =>
  /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

const optionalNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => value === '' || isWholeNumber(value, min, max), {
      error: `Enter a whole number from ${String(min)} to ${String(max)}.`,
    })
    .transform((value) => (value === '' ? null : Number(value)));

const splitList = (value: string, separator: string | RegExp) =>
  value
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== '');

export const titleField = z.string().trim().min(1).max(TITLE_MAX_LENGTH);
export const synopsisField = z.string().trim().max(SYNOPSIS_MAX_LENGTH);

/** One title per line, since a title can hold a comma. */
export const altTitlesField = z
  .string()
  .refine(
    (value) => {
      const titles = splitList(value, '\n');
      return titles.length <= ALT_TITLES_MAX && titles.every((title) => title.length <= TITLE_MAX_LENGTH);
    },
    { error: `At most ${String(ALT_TITLES_MAX)} titles of ${String(TITLE_MAX_LENGTH)} characters.` },
  )
  .transform((value) => splitList(value, '\n'));

const suggestedTagsField = z
  .string()
  .refine(
    (value) => {
      const tags = splitList(value, ',');
      return tags.length <= SUGGESTED_TAGS_MAX && tags.every((tag) => tag.length <= TAG_NAME_MAX_LENGTH);
    },
    { error: `At most ${String(SUGGESTED_TAGS_MAX)} tags of ${String(TAG_NAME_MAX_LENGTH)} characters.` },
  )
  .transform((value) => splitList(value, ','));

export const seasonForm = z.object({
  ordinal: z
    .string()
    .trim()
    .refine((value) => isWholeNumber(value, 0, ORDINAL_MAX), {
      error: `Enter a whole number from 0 to ${String(ORDINAL_MAX)}.`,
    })
    .transform(Number),
  title: titleField,
  altTitles: altTitlesField,
  year: optionalNumber(YEAR_MIN, YEAR_MAX),
  seasonOfYear: z.union([seasonOfYearSchema, z.literal('')]),
  episodeCount: optionalNumber(0, EPISODE_COUNT_MAX),
  synopsis: synopsisField,
});

type SeasonForm = z.output<typeof seasonForm>;

function toProposedSeason(season: SeasonForm) {
  const { altTitles, year, seasonOfYear, episodeCount, synopsis } = season;
  return {
    ordinal: season.ordinal,
    title: season.title,
    ...(altTitles.length === 0 ? {} : { altTitles }),
    ...(year === null ? {} : { year }),
    ...(seasonOfYear === '' ? {} : { seasonOfYear }),
    ...(episodeCount === null ? {} : { episodeCount }),
    ...(synopsis === '' ? {} : { synopsis }),
  };
}

const withSuggestedTags = (tags: string[]) => (tags.length === 0 ? {} : { suggestedTags: tags });

/** Moves `seasons.0.title`-style values into a `seasons` array, in the order of their numbers. */
export function nestSeasonFields(values: unknown): unknown {
  const nested: Record<string, unknown> = {};
  const seasons = new Map<number, Record<string, unknown>>();
  for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
    const match = /^seasons\.(\d+)\.(.+)$/.exec(name);
    if (match === null) {
      nested[name] = value;
      continue;
    }
    const index = Number(match[1]);
    const season = seasons.get(index) ?? {};
    season[match[2] ?? ''] = value;
    seasons.set(index, season);
  }
  // Removing a season in the middle can't leave a gap: inputs are numbered by position.
  nested.seasons = [...seasons.entries()].sort(([a], [b]) => a - b).map(([, season]) => season);
  return nested;
}

export const newSeriesFormSchema = z.preprocess(
  nestSeasonFields,
  z
    .object({
      title: titleField,
      altTitles: altTitlesField,
      synopsis: synopsisField,
      suggestedTags: suggestedTagsField,
      seasons: z.array(seasonForm),
    })
    .superRefine(({ seasons }, context) => {
      const seen = new Set<number>();
      seasons.forEach((season, index) => {
        if (seen.has(season.ordinal)) {
          context.addIssue({
            code: 'custom',
            path: ['seasons', index, 'ordinal'],
            message: 'Each season needs its own number.',
          });
        }
        seen.add(season.ordinal);
      });
    })
    .transform((form): CatalogProposal => {
      const { altTitles, synopsis } = form;
      return {
        kind: 'new_series',
        series: {
          title: form.title,
          ...(altTitles.length === 0 ? {} : { altTitles }),
          ...(synopsis === '' ? {} : { synopsis }),
        },
        ...(form.seasons.length === 0 ? {} : { seasons: form.seasons.map(toProposedSeason) }),
        ...withSuggestedTags(form.suggestedTags),
      };
    }),
);

export const addSeasonFormSchema = (seriesId: string) =>
  seasonForm.extend({ suggestedTags: suggestedTagsField }).transform(
    ({ suggestedTags, ...season }): CatalogProposal => ({
      kind: 'add_season',
      seriesId,
      season: toProposedSeason(season),
      ...withSuggestedTags(suggestedTags),
    }),
  );
