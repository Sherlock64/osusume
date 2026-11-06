ALTER TABLE "series" DROP CONSTRAINT "series_cover_image_id_image_id_fk";
--> statement-breakpoint
ALTER TABLE "image" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "image" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "image" ADD COLUMN "added_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "image" ADD CONSTRAINT "image_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_one_primary_per_series" ON "image" USING btree ("series_id") WHERE "image"."is_primary";--> statement-breakpoint
CREATE INDEX "image_series_id_added_at_idx" ON "image" USING btree ("series_id","added_at");--> statement-breakpoint
ALTER TABLE "series" DROP COLUMN "cover_image_id";--> statement-breakpoint
ALTER TABLE "image" ADD CONSTRAINT "image_catalog_fields_together" CHECK (("image"."series_id" IS NULL) = ("image"."added_at" IS NULL));--> statement-breakpoint
ALTER TABLE "image" ADD CONSTRAINT "image_primary_in_catalog" CHECK (NOT "image"."is_primary" OR "image"."series_id" IS NOT NULL);