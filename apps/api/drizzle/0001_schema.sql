CREATE TYPE "public"."catalog_request_kind" AS ENUM('new_series', 'add_season');--> statement-breakpoint
CREATE TYPE "public"."catalog_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."friendship_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."invite_request_status" AS ENUM('pending', 'approved', 'rejected', 'revoked', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."list_status" AS ENUM('plan_to_watch', 'watching', 'completed', 'on_hold', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."season_of_year" AS ENUM('winter', 'spring', 'summer', 'fall');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."username_change_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."visibility_tier" AS ENUM('private', 'friends', 'members', 'public');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp (3) with time zone,
	"refresh_token_expires_at" timestamp (3) with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid,
	"kind" "catalog_request_kind" NOT NULL,
	"series_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "catalog_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"decision_note" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_blacklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"banned_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" "friendship_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_not_self" CHECK ("friendship"."requester_id" <> "friendship"."addressee_id")
);
--> statement-breakpoint
CREATE TABLE "image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_storageKey_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "invite_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid,
	"invitee_email" text NOT NULL,
	"status" "invite_request_status" DEFAULT 'pending' NOT NULL,
	"token_hash" text,
	"expires_at" timestamp (3) with time zone,
	"decided_by" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_request_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "list_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"status" "list_status" NOT NULL,
	"note" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_entry_user_id_season_id_unique" UNIQUE("user_id","season_id")
);
--> statement-breakpoint
CREATE TABLE "list_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"visibility" "visibility_tier" DEFAULT 'private' NOT NULL,
	"public_slug" text,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_settings_publicSlug_unique" UNIQUE("public_slug"),
	CONSTRAINT "list_settings_slug_only_while_public" CHECK (("list_settings"."visibility" = 'public') = ("list_settings"."public_slug" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"alt_titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"year" integer NOT NULL,
	"season_of_year" "season_of_year" NOT NULL,
	"episode_count" integer,
	"synopsis" text,
	"cover_image_id" uuid,
	"source" text,
	"source_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_series_id_ordinal_unique" UNIQUE("series_id","ordinal"),
	CONSTRAINT "season_episode_count_not_negative" CHECK ("season"."episode_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "season_tag" (
	"season_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "season_tag_season_id_tag_id_pk" PRIMARY KEY("season_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"alt_titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"synopsis" text,
	"cover_image_id" uuid,
	"source" text,
	"source_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_tag" (
	"series_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "series_tag_series_id_tag_id_pk" PRIMARY KEY("series_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" text NOT NULL,
	"display_username" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"is_first_admin" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_username_unique" UNIQUE("username"),
	CONSTRAINT "user_first_admin_stays_active_admin" CHECK (NOT "user"."is_first_admin" OR ("user"."role" = 'admin' AND "user"."disabled_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "username_change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_username" text NOT NULL,
	"status" "username_change_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_request" ADD CONSTRAINT "catalog_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_request" ADD CONSTRAINT "catalog_request_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_request" ADD CONSTRAINT "catalog_request_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_blacklist" ADD CONSTRAINT "email_blacklist_banned_by_user_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_addressee_id_user_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image" ADD CONSTRAINT "image_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_request" ADD CONSTRAINT "invite_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_request" ADD CONSTRAINT "invite_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entry" ADD CONSTRAINT "list_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entry" ADD CONSTRAINT "list_entry_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_settings" ADD CONSTRAINT "list_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_cover_image_id_image_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_tag" ADD CONSTRAINT "season_tag_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_tag" ADD CONSTRAINT "season_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_cover_image_id_image_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tag" ADD CONSTRAINT "series_tag_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tag" ADD CONSTRAINT "series_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_change_request" ADD CONSTRAINT "username_change_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_change_request" ADD CONSTRAINT "username_change_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "catalog_request_requester_id_idx" ON "catalog_request" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "catalog_request_status_idx" ON "catalog_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_blacklist_email_unique" ON "email_blacklist" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "friendship_pair_unique" ON "friendship" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "friendship_addressee_id_idx" ON "friendship" USING btree ("addressee_id");--> statement-breakpoint
CREATE INDEX "friendship_requester_id_idx" ON "friendship" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "invite_request_requester_id_idx" ON "invite_request" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "invite_request_status_idx" ON "invite_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "invite_request_invitee_email_idx" ON "invite_request" USING btree (lower("invitee_email"));--> statement-breakpoint
CREATE INDEX "list_entry_season_id_idx" ON "list_entry" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "season_title_trgm_idx" ON "season" USING gin (osusume_title_search_text("title", "alt_titles") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "season_title_fts_idx" ON "season" USING gin (to_tsvector('simple'::regconfig, osusume_title_search_text("title", "alt_titles")));--> statement-breakpoint
CREATE INDEX "season_tag_tag_id_idx" ON "season_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "series_title_trgm_idx" ON "series" USING gin (osusume_title_search_text("title", "alt_titles") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "series_title_fts_idx" ON "series" USING gin (to_tsvector('simple'::regconfig, osusume_title_search_text("title", "alt_titles")));--> statement-breakpoint
CREATE INDEX "series_tag_tag_id_idx" ON "series_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "user_single_first_admin" ON "user" USING btree ("is_first_admin") WHERE "user"."is_first_admin";--> statement-breakpoint
CREATE INDEX "username_change_request_user_id_idx" ON "username_change_request" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "username_change_request_status_idx" ON "username_change_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");