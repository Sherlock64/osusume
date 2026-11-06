CREATE TYPE "public"."canvas_link_kind" AS ENUM('recommend', 'avoid');--> statement-breakpoint
CREATE TABLE "canvas_link" (
	"user_id" uuid NOT NULL,
	"series_low_id" uuid NOT NULL,
	"series_high_id" uuid NOT NULL,
	"kind" "canvas_link_kind" NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_link_user_id_series_low_id_series_high_id_pk" PRIMARY KEY("user_id","series_low_id","series_high_id"),
	CONSTRAINT "canvas_link_ordered_pair" CHECK ("canvas_link"."series_low_id" < "canvas_link"."series_high_id")
);
--> statement-breakpoint
CREATE TABLE "canvas_position" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_position_user_id_series_id_pk" PRIMARY KEY("user_id","series_id")
);
--> statement-breakpoint
ALTER TABLE "canvas_link" ADD CONSTRAINT "canvas_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_link" ADD CONSTRAINT "canvas_link_series_low_id_series_id_fk" FOREIGN KEY ("series_low_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_link" ADD CONSTRAINT "canvas_link_series_high_id_series_id_fk" FOREIGN KEY ("series_high_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_position" ADD CONSTRAINT "canvas_position_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_position" ADD CONSTRAINT "canvas_position_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;