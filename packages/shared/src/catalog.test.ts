import { describe, expect, it } from 'vitest';
import {
  catalogProposalSchema,
  catalogRequestDecisionSchema,
  createSeasonSchema,
  createSeriesSchema,
  imageParamSchema,
  seriesListQuerySchema,
  tagNameSchema,
  updateSeasonSchema,
  updateSeriesSchema,
} from './catalog.ts';

const id = '3f2b8c1e-8a55-4a57-9a10-0c8d7f6e5d4c';

describe('editable fields', () => {
  it('needs only a title on a series, and an ordinal and title on a season', () => {
    expect(createSeriesSchema.safeParse({ title: 'x' }).success).toBe(true);
    expect(createSeasonSchema.safeParse({ seriesId: id, ordinal: 1, title: 'x' }).success).toBe(true);
    expect(createSeasonSchema.safeParse({ seriesId: id, title: 'x' }).success).toBe(false);
  });

  it('leaves out what a PATCH does not send, so nothing is overwritten by a default', () => {
    expect(updateSeriesSchema.parse({ synopsis: null })).toEqual({ synopsis: null });
    expect(updateSeasonSchema.parse({ episodeCount: 3 })).toEqual({ episodeCount: 3 });
  });

  it('refuses an empty PATCH', () => {
    expect(updateSeriesSchema.safeParse({}).success).toBe(false);
    expect(updateSeasonSchema.safeParse({}).success).toBe(false);
  });

  it('has no format field', () => {
    expect(createSeasonSchema.parse({ seriesId: id, ordinal: 1, title: 'x', format: 'TV' })).not.toHaveProperty(
      'format',
    );
  });
});

describe('tagNameSchema', () => {
  it('trims and keeps the capitalization', () => {
    expect(tagNameSchema.parse('  Slice of Life ')).toBe('Slice of Life');
    expect(tagNameSchema.safeParse('   ').success).toBe(false);
  });
});

describe('catalogProposalSchema', () => {
  const season = { ordinal: 1, title: 'One' };

  it('takes each kind', () => {
    expect(
      catalogProposalSchema.safeParse({
        kind: 'new_series',
        series: { title: 'x' },
        seasons: [{ ...season, episodeCount: 12, tagIds: [id] }],
        suggestedTags: ['New tag'],
      }).success,
    ).toBe(true);
    expect(catalogProposalSchema.safeParse({ kind: 'add_season', seriesId: id, season }).success).toBe(true);
  });

  it('needs a season, and unique ordinals, in a new series', () => {
    const series = { title: 'x' };
    expect(catalogProposalSchema.safeParse({ kind: 'new_series', series, seasons: [] }).success).toBe(false);
    expect(
      catalogProposalSchema.safeParse({ kind: 'new_series', series, seasons: [season, season] }).success,
    ).toBe(false);
  });
});

describe('catalogRequestDecisionSchema', () => {
  it('needs a note to reject and none to approve', () => {
    expect(catalogRequestDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(catalogRequestDecisionSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(catalogRequestDecisionSchema.safeParse({ decision: 'reject', decisionNote: ' ' }).success).toBe(false);
    expect(catalogRequestDecisionSchema.safeParse({ decision: 'reject', decisionNote: 'No' }).success).toBe(true);
  });
});

describe('query and path schemas', () => {
  it('trims a search and takes a tag id only', () => {
    expect(seriesListQuerySchema.parse({ q: '  a  ' }).q).toBe('a');
    expect(seriesListQuerySchema.safeParse({ tag: 'action' }).success).toBe(false);
  });

  it('takes named image sizes only', () => {
    expect(imageParamSchema.safeParse({ id, size: 'medium' }).success).toBe(true);
    expect(imageParamSchema.safeParse({ id, size: 'original' }).success).toBe(false);
  });
});
