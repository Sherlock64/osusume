import type { CatalogProposal } from '@osusume/shared';
import { describe, expect, it } from 'vitest';
import {
  imageUploadProblem,
  rejectFormSchema,
  reviewedProposal,
  seasonFormSchema,
  seriesFormSchema,
  suggestionOutcome,
} from './catalog-admin-form';

const SERIES_ID = '00000000-0000-4000-8000-000000000001';
const TAG_ID = '00000000-0000-4000-8000-000000000002';

describe('seriesFormSchema', () => {
  it('sends a cleared synopsis as null', () => {
    expect(seriesFormSchema.parse({ title: ' A ', altTitles: 'B\n\nC', synopsis: ' ' })).toEqual({
      title: 'A',
      altTitles: ['B', 'C'],
      synopsis: null,
    });
  });
});

describe('seasonFormSchema', () => {
  const blank = {
    ordinal: '0',
    title: 'A',
    altTitles: '',
    year: '',
    seasonOfYear: '',
    episodeCount: '',
    synopsis: '',
  };

  it('sends blanks as null, so a PATCH clears them', () => {
    expect(seasonFormSchema.parse(blank)).toEqual({
      ordinal: 0,
      title: 'A',
      altTitles: [],
      year: null,
      seasonOfYear: null,
      episodeCount: null,
      synopsis: null,
    });
  });

  it('refuses a year out of range', () => {
    expect(seasonFormSchema.safeParse({ ...blank, year: '1899' }).success).toBe(false);
  });
});

describe('rejectFormSchema', () => {
  it('leaves a blank note out', () => {
    expect(rejectFormSchema.parse({ decisionNote: '  ' })).toEqual({});
    expect(rejectFormSchema.parse({ decisionNote: ' no ' })).toEqual({ decisionNote: 'no' });
  });
});

describe('imageUploadProblem', () => {
  it('accepts the three formats up to the limit, and a file with no type', () => {
    expect(imageUploadProblem({ size: 10 * 1024 * 1024, type: 'image/webp' })).toBeNull();
    expect(imageUploadProblem({ size: 1, type: '' })).toBeNull();
  });

  it('refuses another format or a larger file', () => {
    expect(imageUploadProblem({ size: 1, type: 'image/gif' })).toMatch(/JPEG, PNG or WebP/);
    expect(imageUploadProblem({ size: 10 * 1024 * 1024 + 1, type: 'image/png' })).toMatch(/10 MB/);
  });
});

describe('reviewedProposal', () => {
  it("attaches a new series' tags to the series and keeps its seasons' own", () => {
    const filed: CatalogProposal = {
      kind: 'new_series',
      series: { title: 'Old' },
      suggestedTags: ['Action'],
    };
    const edited: CatalogProposal = {
      kind: 'new_series',
      series: { title: 'New' },
      seasons: [{ ordinal: 1, title: 'One' }],
    };
    expect(reviewedProposal(filed, edited, [TAG_ID], [[SERIES_ID]])).toEqual({
      kind: 'new_series',
      series: { title: 'New', tagIds: [TAG_ID] },
      seasons: [{ ordinal: 1, title: 'One', tagIds: [SERIES_ID] }],
      suggestedTags: ['Action'],
    });
  });

  it("attaches an added season's tags to the season only", () => {
    const filed: CatalogProposal = {
      kind: 'add_season',
      seriesId: SERIES_ID,
      season: { ordinal: 1, title: 'Old' },
    };
    const edited: CatalogProposal = { ...filed, season: { ordinal: 2, title: 'New' } };
    expect(reviewedProposal(filed, edited, [TAG_ID])).toMatchObject({
      seriesId: SERIES_ID,
      season: { ordinal: 2, title: 'New', tagIds: [TAG_ID] },
    });
  });
});

describe('suggestionOutcome', () => {
  it('finds the existing tag ignoring case', () => {
    const tags = [{ id: TAG_ID, name: 'Action' }];
    expect(suggestionOutcome('ACTION', tags)).toBe('uses the existing tag Action');
    expect(suggestionOutcome('Drama', tags)).toBe('creates a new tag');
  });
});
