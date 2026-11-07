DROP INDEX "image_series_id_added_at_idx";--> statement-breakpoint
CREATE INDEX "image_series_id_created_at_idx" ON "image" USING btree ("series_id","created_at");--> statement-breakpoint
ALTER TABLE "image" DROP COLUMN "mime";--> statement-breakpoint
ALTER TABLE "image" DROP COLUMN "added_at";--> statement-breakpoint
ALTER TABLE "season" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "season" DROP COLUMN "source_id";--> statement-breakpoint
ALTER TABLE "series" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "series" DROP COLUMN "source_id";