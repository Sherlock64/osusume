ALTER TABLE "season_tag" DROP CONSTRAINT "season_tag_tag_id_tag_id_fk";
--> statement-breakpoint
ALTER TABLE "series_tag" DROP CONSTRAINT "series_tag_tag_id_tag_id_fk";
--> statement-breakpoint
ALTER TABLE "season" ALTER COLUMN "year" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "season" ALTER COLUMN "season_of_year" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "season_tag" ADD CONSTRAINT "season_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tag" ADD CONSTRAINT "series_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_request_one_pending_per_email" ON "invite_request" USING btree (lower("invitee_email")) WHERE "invite_request"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "username_change_request_one_pending_per_user" ON "username_change_request" USING btree ("user_id") WHERE "username_change_request"."status" = 'pending';