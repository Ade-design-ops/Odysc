-- Operator verification of the installed optional USC policy, not an application route.
-- Run with psql --no-psqlrc --set ON_ERROR_STOP=1 as postgres.
-- Every synthetic Auth/profile fixture is in this transaction and is rolled back.
-- Does not send email, create persistent accounts, or read existing student rows.
-- Verifies hook function behavior, not whether Supabase Auth has enabled the hook.
-- Hosted postgres cannot assume supabase_auth_admin: invoke the JSON-only hook
-- as its owner and verify Auth's schema/function permissions through catalogs.

BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id IN (
      '63bc0ec9-2694-40cb-9552-0553c4583dd1',
      '0c72c57b-74de-4528-a62d-9a89495bf4ca',
      '87dd2e18-5b24-4921-a6f9-c70ff214869d',
      'd4a12d79-2ac4-499e-8725-52f90d33a6bb'
    )
  ) THEN
    RAISE EXCEPTION 'ODYSC_VERIFICATION_FIXTURE_COLLISION';
  END IF;
END;
$verify$;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
VALUES
  ('63bc0ec9-2694-40cb-9552-0553c4583dd1', 'authenticated', 'authenticated',
   'odysc-policy-test-63bc0ec9-2694-40cb-9552-0553c4583dd1@usc.edu', now(), now(), now()),
  ('0c72c57b-74de-4528-a62d-9a89495bf4ca', 'authenticated', 'authenticated',
   'odysc-policy-test-0c72c57b-74de-4528-a62d-9a89495bf4ca@usc.edu', now(), now(), now()),
  ('87dd2e18-5b24-4921-a6f9-c70ff214869d', 'authenticated', 'authenticated',
   'odysc-policy-test-87dd2e18-5b24-4921-a6f9-c70ff214869d@usc.edu', NULL, now(), now()),
  ('d4a12d79-2ac4-499e-8725-52f90d33a6bb', 'authenticated', 'authenticated',
   'odysc-policy-test-d4a12d79-2ac4-499e-8725-52f90d33a6bb@example.invalid', now(), now(), now());

INSERT INTO public.student_profiles (user_id, full_name)
VALUES
  ('63bc0ec9-2694-40cb-9552-0553c4583dd1', 'Odysc rollback-only eligible fixture'),
  ('0c72c57b-74de-4528-a62d-9a89495bf4ca', 'Odysc rollback-only other eligible fixture'),
  ('87dd2e18-5b24-4921-a6f9-c70ff214869d', 'Odysc rollback-only unconfirmed fixture'),
  ('d4a12d79-2ac4-499e-8725-52f90d33a6bb', 'Odysc rollback-only non-USC fixture');

DO $verify$
DECLARE
  address text;
  result jsonb;
BEGIN
  IF has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') IS DISTINCT FROM true
     OR has_function_privilege('supabase_auth_admin',
       'public.odysc_before_user_created_usc_email(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ODYSC_AUTH_ADMIN_HOOK_PERMISSIONS_MISSING';
  END IF;
  IF (SELECT prosecdef FROM pg_proc
      WHERE oid = 'public.odysc_before_user_created_usc_email(jsonb)'::regprocedure)
      IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ODYSC_HOOK_MUST_BE_SECURITY_INVOKER';
  END IF;
  FOREACH address IN ARRAY ARRAY['policy-fixture@usc.edu', 'POLICY-FIXTURE@USC.EDU'] LOOP
    result := public.odysc_before_user_created_usc_email(
      jsonb_build_object('user', jsonb_build_object('email', address))
    );
    IF result IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'ODYSC_HOOK_REJECTED_VALID_USC';
    END IF;
  END LOOP;
  FOREACH address IN ARRAY ARRAY[
    NULL::text, '', 'policy-fixture@gmail.com', 'policy-fixture@notusc.edu',
    'policy-fixture@usc.edu.example.com', 'policy-fixture@alumni.usc.edu',
    'policy-fixture@@usc.edu', '@usc.edu', ' policy-fixture@usc.edu',
    'policy-fixture@usc.edu ', E'policy-fixture\n@usc.edu'
  ] LOOP
    result := public.odysc_before_user_created_usc_email(jsonb_build_object(
      'user', jsonb_build_object('email', address,
        'user_metadata', jsonb_build_object('role', 'organizer', 'email_verified', true))
    ));
    IF result #>> '{error,http_code}' IS DISTINCT FROM '403' THEN
      RAISE EXCEPTION 'ODYSC_HOOK_ACCEPTED_INVALID_DOMAIN';
    END IF;
  END LOOP;
  IF public.odysc_before_user_created_usc_email('{}'::jsonb) #>> '{error,http_code}'
       IS DISTINCT FROM '403' THEN
    RAISE EXCEPTION 'ODYSC_HOOK_ACCEPTED_MISSING_EMAIL';
  END IF;
END;
$verify$;

SET LOCAL ROLE authenticated;
DO $verify$
DECLARE
  changed integer;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', '63bc0ec9-2694-40cb-9552-0553c4583dd1', 'role', 'authenticated',
    'email', 'odysc-policy-test-63bc0ec9-2694-40cb-9552-0553c4583dd1@usc.edu'
  )::text, true);
  IF odysc_private.has_confirmed_usc_email() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ODYSC_ELIGIBLE_IDENTITY_DENIED';
  END IF;
  IF (SELECT count(*) FROM public.student_profiles WHERE user_id IN (
    '63bc0ec9-2694-40cb-9552-0553c4583dd1', '0c72c57b-74de-4528-a62d-9a89495bf4ca',
    '87dd2e18-5b24-4921-a6f9-c70ff214869d', 'd4a12d79-2ac4-499e-8725-52f90d33a6bb'
  )) <> 1 THEN
    RAISE EXCEPTION 'ODYSC_PROFILE_READ_ISOLATION_FAILED';
  END IF;

  UPDATE public.student_profiles SET major = 'Must not change'
    WHERE user_id = '0c72c57b-74de-4528-a62d-9a89495bf4ca';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'ODYSC_OTHER_PROFILE_UPDATE_ALLOWED'; END IF;
  DELETE FROM public.student_profiles WHERE user_id = '0c72c57b-74de-4528-a62d-9a89495bf4ca';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'ODYSC_OTHER_PROFILE_DELETE_ALLOWED'; END IF;
  BEGIN
    INSERT INTO public.student_profiles (user_id, full_name)
    VALUES ('0c72c57b-74de-4528-a62d-9a89495bf4ca', 'Must not insert');
    RAISE EXCEPTION 'ODYSC_OTHER_PROFILE_INSERT_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.student_profiles SET major = 'Physics'
    WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 OR (SELECT major FROM public.student_profiles
    WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1') IS DISTINCT FROM 'Physics' THEN
    RAISE EXCEPTION 'ODYSC_OWN_PROFILE_UPDATE_DENIED';
  END IF;
  DELETE FROM public.student_profiles WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'ODYSC_OWN_PROFILE_DELETE_DENIED'; END IF;
  INSERT INTO public.student_profiles (user_id, full_name)
    VALUES ('63bc0ec9-2694-40cb-9552-0553c4583dd1', 'Odysc rollback-only recreated fixture');
  IF (SELECT count(*) FROM public.student_profiles
    WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1') <> 1 THEN
    RAISE EXCEPTION 'ODYSC_OWN_PROFILE_INSERT_DENIED';
  END IF;

  BEGIN
    PERFORM public.odysc_before_user_created_usc_email('{"user":{"email":"fixture@usc.edu"}}'::jsonb);
    RAISE EXCEPTION 'ODYSC_AUTHENTICATED_HOOK_EXECUTION_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$verify$;

DO $verify$
DECLARE
  fixture_id uuid;
  fixture_email text;
  changed integer;
BEGIN
  FOR fixture_id, fixture_email IN VALUES
    ('87dd2e18-5b24-4921-a6f9-c70ff214869d'::uuid,
     'odysc-policy-test-87dd2e18-5b24-4921-a6f9-c70ff214869d@usc.edu'),
    ('d4a12d79-2ac4-499e-8725-52f90d33a6bb'::uuid,
     'odysc-policy-test-d4a12d79-2ac4-499e-8725-52f90d33a6bb@example.invalid')
  LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', fixture_id, 'role', 'authenticated', 'email', fixture_email,
      'user_metadata', jsonb_build_object('email_verified', true)
    )::text, true);
    IF odysc_private.has_confirmed_usc_email() IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'ODYSC_INELIGIBLE_IDENTITY_ACCEPTED';
    END IF;
    IF EXISTS (SELECT 1 FROM public.student_profiles WHERE user_id = fixture_id) THEN
      RAISE EXCEPTION 'ODYSC_INELIGIBLE_PROFILE_READ_ALLOWED';
    END IF;
    UPDATE public.student_profiles SET major = 'Must not change' WHERE user_id = fixture_id;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 0 THEN RAISE EXCEPTION 'ODYSC_INELIGIBLE_PROFILE_UPDATE_ALLOWED'; END IF;
    DELETE FROM public.student_profiles WHERE user_id = fixture_id;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 0 THEN RAISE EXCEPTION 'ODYSC_INELIGIBLE_PROFILE_DELETE_ALLOWED'; END IF;
    BEGIN
      INSERT INTO public.student_profiles (user_id, full_name) VALUES (fixture_id, 'Must not insert');
      RAISE EXCEPTION 'ODYSC_INELIGIBLE_PROFILE_INSERT_ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$verify$;
RESET ROLE;

-- Change only the synthetic current Auth row. Old JWTs must fail immediately.
UPDATE auth.users SET email = 'odysc-policy-test-changed@example.invalid'
WHERE id = '63bc0ec9-2694-40cb-9552-0553c4583dd1';
SET LOCAL ROLE authenticated;
DO $verify$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', '63bc0ec9-2694-40cb-9552-0553c4583dd1', 'role', 'authenticated',
    'email', 'odysc-policy-test-63bc0ec9-2694-40cb-9552-0553c4583dd1@usc.edu'
  )::text, true);
  IF odysc_private.has_confirmed_usc_email() IS DISTINCT FROM false OR EXISTS (
    SELECT 1 FROM public.student_profiles WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1'
  ) THEN RAISE EXCEPTION 'ODYSC_STALE_USC_JWT_ACCEPTED_AFTER_DOMAIN_CHANGE'; END IF;
END;
$verify$;
RESET ROLE;

UPDATE auth.users SET email = 'odysc-policy-test-new-usc-address@usc.edu'
WHERE id = '63bc0ec9-2694-40cb-9552-0553c4583dd1';
SET LOCAL ROLE authenticated;
DO $verify$
BEGIN
  IF odysc_private.has_confirmed_usc_email() IS DISTINCT FROM false OR EXISTS (
    SELECT 1 FROM public.student_profiles WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1'
  ) THEN RAISE EXCEPTION 'ODYSC_STALE_JWT_ACCEPTED_AFTER_USC_EMAIL_CHANGE'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', '63bc0ec9-2694-40cb-9552-0553c4583dd1', 'role', 'authenticated',
    'email', 'odysc-policy-test-new-usc-address@usc.edu'
  )::text, true);
  IF odysc_private.has_confirmed_usc_email() IS DISTINCT FROM true OR (
    SELECT count(*) FROM public.student_profiles WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1'
  ) <> 1 THEN RAISE EXCEPTION 'ODYSC_REFRESHED_USC_IDENTITY_DENIED'; END IF;
END;
$verify$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $verify$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN
    PERFORM 1 FROM public.student_profiles WHERE user_id = '63bc0ec9-2694-40cb-9552-0553c4583dd1';
    RAISE EXCEPTION 'ODYSC_ANONYMOUS_PROFILE_ACCESS_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM odysc_private.has_confirmed_usc_email();
    RAISE EXCEPTION 'ODYSC_ANONYMOUS_PRIVATE_FUNCTION_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.odysc_before_user_created_usc_email('{"user":{"email":"fixture@usc.edu"}}'::jsonb);
    RAISE EXCEPTION 'ODYSC_ANONYMOUS_HOOK_EXECUTION_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$verify$;
RESET ROLE;

-- Must remain ROLLBACK. A connection closed on an earlier error also rolls back.
ROLLBACK;
SELECT 'usc_email_access_verification_passed_and_rolled_back' AS status;
