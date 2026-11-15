-- Applied to the shared project on 2026-11-14; USC profile restrictions are active.
-- The Auth hook was separately enabled and verified by direct signup rejection.
-- Reapplying this migration does not configure Auth hooks or backend settings.
-- Read docs/USC_EMAIL_ACCESS.md before applying it to another project.
-- Requires the existing student-onboarding.sql migration and the postgres role.

BEGIN;
SET LOCAL search_path = pg_catalog;

-- Keep this schema out of Supabase's Data API "Exposed schemas" list.
CREATE SCHEMA IF NOT EXISTS odysc_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA odysc_private FROM PUBLIC, anon;
REVOKE CREATE ON SCHEMA odysc_private FROM authenticated, supabase_auth_admin;
GRANT USAGE ON SCHEMA odysc_private TO authenticated;

-- Return only a boolean for the current caller, never arbitrary user records.
-- The current Auth row prevents a stale USC-domain JWT from retaining profile
-- access after the account's confirmed email has changed to a non-USC address.
CREATE OR REPLACE FUNCTION odysc_private.has_confirmed_usc_email()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS account
    WHERE account.id = (SELECT auth.uid())
      AND account.email_confirmed_at IS NOT NULL
      AND account.email ~* '^[^@[:space:]]+@usc[.]edu$'
      AND pg_catalog.lower(account.email) =
        pg_catalog.lower((SELECT auth.jwt()) ->> 'email')
  );
$function$;

ALTER FUNCTION odysc_private.has_confirmed_usc_email() OWNER TO postgres;
REVOKE ALL ON FUNCTION odysc_private.has_confirmed_usc_email()
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION odysc_private.has_confirmed_usc_email()
  TO authenticated;

-- Restrictive policies are ANDed with the existing permissive own-row policies.
-- Keep all four student_profiles_*_own policies unchanged. This policy grants
-- no ownership access on its own and covers SELECT/INSERT/UPDATE/DELETE.
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_profiles_usc_email_required
  ON public.student_profiles;
CREATE POLICY student_profiles_usc_email_required
  ON public.student_profiles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT odysc_private.has_confirmed_usc_email()))
  WITH CHECK ((SELECT odysc_private.has_confirmed_usc_email()));

-- Separately enable this function as the Before User Created hook in Supabase.
-- This is deliberately SECURITY INVOKER: it only inspects the supplied event.
-- New accounts cannot already be email-confirmed at this stage. Confirmation
-- is checked later by backend access checks and the profile policy above.
-- The hook applies to ALL new Auth accounts, including future organizer users;
-- a self-selected role in user_metadata must never exempt a signup.
CREATE OR REPLACE FUNCTION public.odysc_before_user_created_usc_email(event jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(event -> 'user' -> 'email') = 'string'
      AND (event -> 'user' ->> 'email') ~* '^[^@[:space:]]+@usc[.]edu$'
    THEN '{}'::jsonb
    ELSE pg_catalog.jsonb_build_object(
      'error', pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'Use your USC email address (@usc.edu) to create an account.'
      )
    )
  END;
$function$;

ALTER FUNCTION public.odysc_before_user_created_usc_email(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.odysc_before_user_created_usc_email(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.odysc_before_user_created_usc_email(jsonb)
  TO supabase_auth_admin;

COMMIT;
