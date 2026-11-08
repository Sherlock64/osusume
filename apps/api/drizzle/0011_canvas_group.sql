CREATE TABLE "canvas_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_group_member" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "canvas_group_member_user_id_series_id_pk" PRIMARY KEY("user_id","series_id")
);
--> statement-breakpoint
ALTER TABLE "canvas_group" ADD CONSTRAINT "canvas_group_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_group_member" ADD CONSTRAINT "canvas_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_group_member" ADD CONSTRAINT "canvas_group_member_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_group_member" ADD CONSTRAINT "canvas_group_member_group_id_canvas_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."canvas_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_group_user_id_idx" ON "canvas_group" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "canvas_group_member_group_id_idx" ON "canvas_group_member" USING btree ("group_id");