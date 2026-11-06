-- Runs on every delete from "user": removal, ban and account self-deletion.
-- Foreign keys handle the rest (see the comment at the top of src/db/schema.ts).
-- They cannot do these two, which depend on row contents:
--   * the first admin can never be deleted;
--   * a user's pending requests are deleted, while their decided requests stay
--     with requester_id set to null.
CREATE FUNCTION osusume_user_before_delete()
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

  RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER user_before_delete
BEFORE DELETE ON "user"
FOR EACH ROW
EXECUTE FUNCTION osusume_user_before_delete();
