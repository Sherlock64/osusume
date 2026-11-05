import type { SeasonOfYear, Tag } from '@osusume/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.ts';
import { image, season, seasonTag, series, seriesTag, tag } from '../db/schema.ts';
import { ApiError, isUniqueViolation } from '../lib/errors.ts';

type Reader = Database | Transaction;

export const seriesNotFound = () => new ApiError(404, 'series_not_found', 'No such series.');
export const seasonNotFound = () => new ApiError(404, 'season_not_found', 'No such season.');

const ordinalTaken = () =>
  new ApiError(409, 'ordinal_taken', 'This series already has a season with that ordinal.');

/** Runs a transaction that writes seasons, turning a taken ordinal into a clean refusal. */
export async function refusingTakenOrdinal<Result>(run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error, 'season_series_id_ordinal_unique')) throw ordinalTaken();
    throw error;
  }
}

/** Refuses an ordinal already used in a series, ahead of the constraint. */
export async function assertOrdinalFree(
  tx: Transaction,
  seriesId: string,
  ordinal: number,
): Promise<void> {
  const [taken] = await tx
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.seriesId, seriesId), eq(season.ordinal, ordinal)));
  if (taken) throw ordinalTaken();
}

/** Refuses tag ids outside the vocabulary. Hold the catalog lock. */
export async function assertTagsExist(tx: Transaction, ids: readonly string[]): Promise<void> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const found = await tx.select({ id: tag.id }).from(tag).where(inArray(tag.id, wanted));
  if (found.length !== wanted.length) {
    throw new ApiError(400, 'unknown_tag', 'A chosen tag is not in the tag vocabulary.');
  }
}

/**
 * The tag with this name ignoring case, created with this spelling if there is none. A tag that
 * exists keeps its own spelling.
 */
export async function findOrCreateTag(tx: Transaction, name: string): Promise<string> {
  await tx.insert(tag).values({ name }).onConflictDoNothing();
  const [row] = await tx
    .select({ id: tag.id })
    .from(tag)
    .where(sql`lower(${tag.name}) = lower(${name})`);
  if (!row) throw new Error('tag was not found or created');
  return row.id;
}

/** Refuses a cover that is not an uploaded image. */
export async function assertImagesExist(tx: Transaction, ids: readonly string[]): Promise<void> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const found = await tx.select({ id: image.id }).from(image).where(inArray(image.id, wanted));
  if (found.length !== wanted.length) {
    throw new ApiError(400, 'unknown_image', 'A chosen cover image does not exist.');
  }
}

export async function setSeriesTags(tx: Transaction, seriesId: string, tagIds: readonly string[]) {
  await tx.delete(seriesTag).where(eq(seriesTag.seriesId, seriesId));
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) {
    await tx.insert(seriesTag).values(unique.map((tagId) => ({ seriesId, tagId })));
  }
}

export async function setSeasonTags(tx: Transaction, seasonId: string, tagIds: readonly string[]) {
  await tx.delete(seasonTag).where(eq(seasonTag.seasonId, seasonId));
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) {
    await tx.insert(seasonTag).values(unique.map((tagId) => ({ seasonId, tagId })));
  }
}

export interface SeriesEntry {
  title: string;
  altTitles?: string[] | undefined;
  synopsis?: string | null | undefined;
  coverImageId?: string | null | undefined;
  tagIds?: string[] | undefined;
}

export interface SeasonEntry {
  ordinal: number;
  title: string;
  altTitles?: string[] | undefined;
  year?: number | null | undefined;
  seasonOfYear?: SeasonOfYear | null | undefined;
  episodeCount?: number | null | undefined;
  synopsis?: string | null | undefined;
  coverImageId?: string | null | undefined;
  tagIds?: string[] | undefined;
}

/** Inserts a series and its tags. Check the tags and cover first. */
export async function insertSeries(tx: Transaction, entry: SeriesEntry): Promise<string> {
  const [row] = await tx
    .insert(series)
    .values({
      title: entry.title,
      altTitles: entry.altTitles ?? [],
      synopsis: entry.synopsis ?? null,
      coverImageId: entry.coverImageId ?? null,
    })
    .returning({ id: series.id });
  if (!row) throw new Error('series was not created');
  await setSeriesTags(tx, row.id, entry.tagIds ?? []);
  return row.id;
}

/** Inserts a season and its own tags. Check the series, tags and cover first. */
export async function insertSeason(
  tx: Transaction,
  seriesId: string,
  entry: SeasonEntry,
): Promise<string> {
  const [row] = await tx
    .insert(season)
    .values({
      seriesId,
      ordinal: entry.ordinal,
      title: entry.title,
      altTitles: entry.altTitles ?? [],
      year: entry.year ?? null,
      seasonOfYear: entry.seasonOfYear ?? null,
      episodeCount: entry.episodeCount ?? null,
      synopsis: entry.synopsis ?? null,
      coverImageId: entry.coverImageId ?? null,
    })
    .returning({ id: season.id });
  if (!row) throw new Error('season was not created');
  await setSeasonTags(tx, row.id, entry.tagIds ?? []);
  return row.id;
}

/** Tags are shown in name order, ignoring case. */
function byName(a: Tag, b: Tag): number {
  const [left, right] = [a.name.toLowerCase(), b.name.toLowerCase()];
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The union of a series' tags and a season's own. */
function unionOfTags(first: readonly Tag[], second: readonly Tag[]): Tag[] {
  const byId = new Map([...first, ...second].map((row) => [row.id, row]));
  return [...byId.values()].sort(byName);
}

function groupTags(rows: readonly (Tag & { ownerId: string })[]): Map<string, Tag[]> {
  const grouped = new Map<string, Tag[]>();
  for (const { ownerId, id, name } of rows) {
    grouped.set(ownerId, [...(grouped.get(ownerId) ?? []), { id, name }]);
  }
  for (const tags of grouped.values()) tags.sort(byName);
  return grouped;
}

async function tagsOfSeries(db: Reader, seriesIds: readonly string[]) {
  if (seriesIds.length === 0) return new Map<string, Tag[]>();
  const rows = await db
    .select({ ownerId: seriesTag.seriesId, id: tag.id, name: tag.name })
    .from(seriesTag)
    .innerJoin(tag, eq(seriesTag.tagId, tag.id))
    .where(inArray(seriesTag.seriesId, [...seriesIds]));
  return groupTags(rows);
}

async function tagsOfSeasons(db: Reader, seasonIds: readonly string[]) {
  if (seasonIds.length === 0) return new Map<string, Tag[]>();
  const rows = await db
    .select({ ownerId: seasonTag.seasonId, id: tag.id, name: tag.name })
    .from(seasonTag)
    .innerJoin(tag, eq(seasonTag.tagId, tag.id))
    .where(inArray(seasonTag.seasonId, [...seasonIds]));
  return groupTags(rows);
}

/** How many seasons each series has, and the date of its earliest dated season. */
async function datesOfSeries(
  db: Reader,
  seriesIds: readonly string[],
): Promise<Map<string, SeriesDates>> {
  if (seriesIds.length === 0) return new Map();
  const rows = await db
    .select({
      seriesId: season.seriesId,
      seasonCount: sql<number>`count(*)::int`,
      firstYear: sql<number | null>`min(${season.year})`,
      firstSeasonOfYear: sql<SeasonOfYear | null>`(array_agg(${season.seasonOfYear} ORDER BY ${season.year}, ${season.seasonOfYear} NULLS LAST) FILTER (WHERE ${season.year} IS NOT NULL))[1]`,
    })
    .from(season)
    .where(inArray(season.seriesId, [...seriesIds]))
    .groupBy(season.seriesId);
  return new Map(rows.map((row) => [row.seriesId, row]));
}

interface SeriesDates {
  seasonCount: number;
  firstYear: number | null;
  firstSeasonOfYear: SeasonOfYear | null;
}

/**
 * The sort key for a series' date, never null: year and season of year as one integer, from its
 * earliest dated season. Newest first puts a blank season of year after that year's others, and
 * a series with no dated season, keyed 0, after everything.
 *
 * Nested in a second sql template on purpose. In a single-table select, Drizzle strips the table
 * name from columns directly in a selected expression, which would break this correlated query.
 */
export const seriesDateKey = () => {
  const earliest = sql`(
    SELECT ${season.year} * 10 + coalesce(array_position(enum_range(NULL::season_of_year), ${season.seasonOfYear}), 0)
    FROM ${season}
    WHERE ${season.seriesId} = ${series.id} AND ${season.year} IS NOT NULL
    ORDER BY ${season.year}, ${season.seasonOfYear} NULLS LAST
    LIMIT 1
  )`;
  return sql<number>`coalesce(${earliest}, 0)`;
};

type SeriesRow = typeof series.$inferSelect;
type SeasonRow = typeof season.$inferSelect;

/** Series as the api shows them in lists. */
export async function toSeriesSummaries(db: Reader, rows: readonly SeriesRow[]) {
  const ids = rows.map((row) => row.id);
  const tags = await tagsOfSeries(db, ids);
  const dates = await datesOfSeries(db, ids);
  return rows.map((row) => {
    const date = dates.get(row.id);
    return {
      id: row.id,
      title: row.title,
      altTitles: row.altTitles,
      synopsis: row.synopsis,
      coverImageId: row.coverImageId,
      tags: tags.get(row.id) ?? [],
      seasonCount: date?.seasonCount ?? 0,
      firstYear: date?.firstYear ?? null,
      firstSeasonOfYear: date?.firstSeasonOfYear ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

function toSeason(row: SeasonRow, seriesTags: readonly Tag[], ownTags: readonly Tag[]) {
  return {
    id: row.id,
    seriesId: row.seriesId,
    ordinal: row.ordinal,
    title: row.title,
    altTitles: row.altTitles,
    year: row.year,
    seasonOfYear: row.seasonOfYear,
    episodeCount: row.episodeCount,
    synopsis: row.synopsis,
    coverImageId: row.coverImageId,
    ownTags: [...ownTags],
    effectiveTags: unionOfTags(seriesTags, ownTags),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadSeriesDetail(db: Reader, id: string) {
  const [row] = await db.select().from(series).where(eq(series.id, id));
  if (!row) throw seriesNotFound();
  const [summary] = await toSeriesSummaries(db, [row]);
  if (!summary) throw seriesNotFound();
  const seasons = await db
    .select()
    .from(season)
    .where(eq(season.seriesId, id))
    .orderBy(asc(season.ordinal));
  const ownTags = await tagsOfSeasons(db, seasons.map((entry) => entry.id));
  return {
    ...summary,
    seasons: seasons.map((entry) => toSeason(entry, summary.tags, ownTags.get(entry.id) ?? [])),
  };
}

export async function loadSeasonDetail(db: Reader, id: string) {
  const [found] = await db
    .select({ season, seriesTitle: series.title })
    .from(season)
    .innerJoin(series, eq(season.seriesId, series.id))
    .where(eq(season.id, id));
  if (!found) throw seasonNotFound();
  const seriesTags = await tagsOfSeries(db, [found.season.seriesId]);
  const ownTags = await tagsOfSeasons(db, [id]);
  return {
    ...toSeason(found.season, seriesTags.get(found.season.seriesId) ?? [], ownTags.get(id) ?? []),
    series: { id: found.season.seriesId, title: found.seriesTitle },
  };
}
