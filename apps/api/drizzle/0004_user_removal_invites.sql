-- Adds the invite handling from V1_DECISIONS.md to the delete trigger from 0002:
--   * invites the user requested that are approved but unaccepted are revoked,
--     so their links stop working;
--   * invite rows holding the user's own email are deleted, whoever requested
--     them, so the address does not remain here. A ban keeps it on email_blacklist.
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

  UPDATE invite_request
  SET status = 'revoked', updated_at = now()
  WHERE requester_id = OLD.id AND status = 'approved';

  RETURN OLD;
END;
$$;
