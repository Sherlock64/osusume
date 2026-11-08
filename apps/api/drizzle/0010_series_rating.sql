CREATE TABLE "series_rating" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_rating_user_id_series_id_pk" PRIMARY KEY("user_id","series_id"),
	CONSTRAINT "series_rating_range" CHECK ("series_rating"."rating" BETWEEN 0 AND 5)
);
--> statement-breakpoint
ALTER TABLE "series_rating" ADD CONSTRAINT "series_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_rating" ADD CONSTRAINT "series_rating_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;