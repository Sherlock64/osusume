-- Nothing can reach an image outside a catalog any more, so it goes. Its files, if any, stay on the volume.
DELETE FROM "image" WHERE "series_id" IS NULL;--> statement-breakpoint
ALTER TABLE "image" DROP CONSTRAINT "image_catalog_fields_together";--> statement-breakpoint
ALTER TABLE "image" DROP CONSTRAINT "image_primary_in_catalog";--> statement-breakpoint
ALTER TABLE "image" ALTER COLUMN "series_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "image" ALTER COLUMN "added_at" SET NOT NULL;