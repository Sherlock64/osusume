import type { AnyColumn, SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { season, series, titleSearchText, titleSearchVector } from '../db/schema.ts';

/** Text matched literally by ILIKE. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Whether a row's title or alternate titles match: a literal piece of them, a misspelling
 * (`<%` compares against the closest run of words), or all the words in any order. Each
 * condition is one the trigram or full-text index on these expressions can serve.
 */
function matchesTitle(title: AnyColumn, altTitles: AnyColumn, q: string): SQL {
  const text = titleSearchText(title, altTitles);
  const vector = titleSearchVector(title, altTitles);
  return sql`(${text} ILIKE ${`%${escapeLike(q)}%`} OR ${q}::text <% ${text} OR ${vector} @@ plainto_tsquery('simple'::regconfig, ${q}))`;
}

function titleScore(title: AnyColumn, altTitles: AnyColumn, q: string): SQL {
  const text = titleSearchText(title, altTitles);
  return sql`(word_similarity(${q}::text, ${text}) + similarity(${q}::text, ${text}))`;
}

/**
 * Series that match themselves or through a season. A UNION rather than OR EXISTS, so that each
 * side can use its table's indexes.
 */
export function seriesMatchingSearch(q: string): SQL {
  return sql`${series.id} IN (
    SELECT ${series.id} FROM ${series} WHERE ${matchesTitle(series.title, series.altTitles, q)}
    UNION
    SELECT ${season.seriesId} FROM ${season} WHERE ${matchesTitle(season.title, season.altTitles, q)}
  )`;
}

/**
 * How well a series matches, as an integer so it survives a pagination cursor exactly: its own
 * titles or its best season's, whichever is closer.
 */
export function seriesRelevance(q: string): SQL<number> {
  const bestSeason = sql`(
    SELECT max(${titleScore(season.title, season.altTitles, q)})
    FROM ${season}
    WHERE ${season.seriesId} = ${series.id}
  )`;
  return sql<number>`round(greatest(${titleScore(series.title, series.altTitles, q)}, ${bestSeason}) * 1000)::int`;
}
