-- Search support. pg_trgm is a trusted extension, so the database owner can
-- install it without being a superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- The text covered by the title search indexes on series and season.
-- array_to_string is only marked STABLE, so an index cannot call it directly.
-- With text input its result is fixed, which makes IMMUTABLE correct here.
CREATE FUNCTION osusume_title_search_text(title text, alt_titles text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT title || ' ' || array_to_string(alt_titles, ' ') $$;
