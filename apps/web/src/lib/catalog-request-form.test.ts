import { describe, expect, it } from 'vitest';
import { addSeasonFormSchema, newSeriesFormSchema } from './catalog-request-form';
import { validate } from './form';

const blankSeason = {
  ordinal: '1',
  title: 'First',
  altTitles: '',
  year: '',
  seasonOfYear: '',
  episodeCount: '',
  synopsis: '',
};
const seasonFields = (index: number, season: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(season).map(([name, value]) => [`seasons.${String(index)}.${name}`, value]),
  );
const blankSeries = { title: 'Show', altTitles: '', synopsis: '', suggestedTags: '' };

describe('newSeriesFormSchema', () => {
  it('needs no season, and leaves out what was left blank', () => {
    expect(validate(newSeriesFormSchema, blankSeries)).toEqual({
      data: { kind: 'new_series', series: { title: 'Show' } },
    });
  });

  it('builds seasons, alternate titles and suggested tags', () => {
    const result = validate(newSeriesFormSchema, {
      ...blankSeries,
      altTitles: 'One, with comma\n\n Two ',
      suggestedTags: 'action, , Slice of life',
      ...seasonFields(0, { ...blankSeason, year: '2021', seasonOfYear: 'spring', episodeCount: '0' }),
    });
    expect(result).toEqual({
      data: {
        kind: 'new_series',
        series: { title: 'Show', altTitles: ['One, with comma', 'Two'] },
        seasons: [{ ordinal: 1, title: 'First', year: 2021, seasonOfYear: 'spring', episodeCount: 0 }],
        suggestedTags: ['action', 'Slice of life'],
      },
    });
  });

  it('puts problems on the season input that has them', () => {
    const result = validate(newSeriesFormSchema, {
      ...blankSeries,
      ...seasonFields(0, blankSeason),
      ...seasonFields(1, { ...blankSeason, ordinal: '2', title: ' ', year: '1800' }),
    });
    expect(result).toMatchObject({
      errors: {
        fields: {
          'seasons.1.title': 'Required.',
          'seasons.1.year': 'Enter a whole number from 1900 to 2999.',
        },
      },
    });
  });

  it('refuses two seasons with one number', () => {
    const result = validate(newSeriesFormSchema, {
      ...blankSeries,
      ...seasonFields(0, blankSeason),
      ...seasonFields(1, blankSeason),
    });
    expect(result).toMatchObject({
      errors: { fields: { 'seasons.1.ordinal': 'Each season needs its own number.' } },
    });
  });
});

describe('addSeasonFormSchema', () => {
  const seriesId = '00000000-0000-4000-8000-000000000000';

  it('files the season against the series', () => {
    expect(validate(addSeasonFormSchema(seriesId), { ...blankSeason, suggestedTags: 'x' })).toEqual({
      data: {
        kind: 'add_season',
        seriesId,
        season: { ordinal: 1, title: 'First' },
        suggestedTags: ['x'],
      },
    });
  });

  it('requires a season number', () => {
    expect(
      validate(addSeasonFormSchema(seriesId), { ...blankSeason, ordinal: '', suggestedTags: '' }),
    ).toMatchObject({
      errors: { fields: { ordinal: 'Enter a whole number from 0 to 100000.' } },
    });
  });
});
