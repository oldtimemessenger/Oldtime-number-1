-- Current Oldtime uses the authenticated API, not legacy public Live RPCs.
-- Retain definitions/data and server access; prohibit untrusted direct writes
-- and unauthenticated invocation of the old cleanup procedure.
BEGIN;
REVOKE EXECUTE ON FUNCTION
  public.increment_listener_count(uuid),
  public.decrement_listener_count(uuid),
  public.increment_speaker_count(uuid),
  public.decrement_speaker_count(uuid),
  public.cleanup_expired_rc_messages()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.increment_listener_count(uuid),
  public.decrement_listener_count(uuid),
  public.increment_speaker_count(uuid),
  public.decrement_speaker_count(uuid),
  public.cleanup_expired_rc_messages()
TO service_role;
ALTER FUNCTION public.increment_listener_count(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_listener_count(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_speaker_count(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_speaker_count(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_expired_rc_messages() SET search_path = public, pg_temp;
COMMIT;
