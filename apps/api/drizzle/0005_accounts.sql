CREATE TABLE "email_change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"new_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_change_request_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "email_change_request_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "tag" DROP CONSTRAINT "tag_name_unique";--> statement-breakpoint
ALTER TABLE "email_change_request" ADD CONSTRAINT "email_change_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_lower_unique" ON "tag" USING btree (lower("name"));--> statement-breakpoint
-- Usernames become a lowercase lookup key plus the entered capitalization for display.
UPDATE "user"
SET display_username = COALESCE(display_username, username), username = lower(username);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_case" CHECK ("user"."username" = lower("user"."username") AND ("user"."display_username" IS NULL OR lower("user"."display_username") = "user"."username"));;--> statement-breakpoint

-- Keeps the username pair right for every writer: the column stays lowercase, so its
-- unique constraint and lookups ignore case, and what was entered moves to
-- display_username unless the writer set that itself.
CREATE FUNCTION osusume_user_normalize_username()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.display_username := COALESCE(NEW.display_username, NEW.username);
  ELSIF NEW.username IS DISTINCT FROM OLD.username
    AND NEW.display_username IS NOT DISTINCT FROM OLD.display_username THEN
    NEW.display_username := NEW.username;
  END IF;
  NEW.username := lower(NEW.username);
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER user_normalize_username
BEFORE INSERT OR UPDATE ON "user"
FOR EACH ROW
EXECUTE FUNCTION osusume_user_normalize_username();--> statement-breakpoint

-- The first admin's protections all key off is_first_admin, so clearing the flag would
-- remove them. It can be set when the row is created and never changed afterwards.
CREATE FUNCTION osusume_user_first_admin_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_first_admin IS DISTINCT FROM OLD.is_first_admin THEN
    RAISE EXCEPTION 'is_first_admin cannot be changed after creation'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER user_first_admin_immutable
BEFORE UPDATE ON "user"
FOR EACH ROW
EXECUTE FUNCTION osusume_user_first_admin_immutable();--> statement-breakpoint

-- A disabled user cannot gain a session. The share lock orders this against disabling:
-- either the insert waits and then sees disabled_at, or the disable waits and then
-- deletes this session along with the others.
CREATE FUNCTION osusume_session_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM "user" WHERE id = NEW.user_id AND disabled_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A session needs an active user'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER session_before_insert
BEFORE INSERT ON "session"
FOR EACH ROW
EXECUTE FUNCTION osusume_session_before_insert();--> statement-breakpoint

-- Adds to the delete trigger from 0004: Better Auth's verification rows have no foreign
-- key. A password reset token's row holds the user id in `value`.
CREATE OR REPLACE FUNCTION osusume_user_before_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_first_admin THEN
    RAISE EXCEPTION 'The first admin cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  DELETE FROM catalog_request WHERE requester_id = OLD.id AND status = 'pending';
  DELETE FROM invite_request WHERE requester_id = OLD.id AND status = 'pending';
  DELETE FROM invite_request WHERE lower(invitee_email) = lower(OLD.email);
  DELETE FROM verification WHERE value = OLD.id::text;

  UPDATE invite_request
  SET status = 'revoked', updated_at = now()
  WHERE requester_id = OLD.id AND status = 'approved';

  RETURN OLD;
END;
$$;
