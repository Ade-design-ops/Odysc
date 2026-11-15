-- Applied to the shared Supabase project on 2026-11-14 with user authorization.
-- Real student profiles use Supabase Auth identities.
-- Keeps public.student_mock and public.clubs unchanged.
-- Optional résumé files require a separate private Storage integration;
-- this migration stores only profile information and onboarding state.

BEGIN;
SET LOCAL search_path = pg_catalog;

-- Deliberately fail if another teammate has already created this table.
-- Do not silently adopt or overwrite a concurrently changed shared schema.
CREATE TABLE public.student_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  academic_year text,
  graduation_year smallint,
  major text NOT NULL DEFAULT '',
  interests varchar(100)[] NOT NULL DEFAULT '{}',
  goals varchar(300)[] NOT NULL DEFAULT '{}',
  bio text NOT NULL DEFAULT '',
  skills varchar(100)[] NOT NULL DEFAULT '{}',
  experience text NOT NULL DEFAULT '',
  onboarding_started_at timestamptz NOT NULL DEFAULT now(),
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_profiles_name_length CHECK (length(full_name) BETWEEN 1 AND 100 AND full_name ~ '[^[:space:]]'),
  CONSTRAINT student_profiles_academic_year CHECK (academic_year IS NULL OR academic_year IN (
    'first_year', 'second_year', 'third_year', 'fourth_year',
    'fifth_year_plus', 'graduate', 'other'
  )),
  CONSTRAINT student_profiles_graduation_year CHECK (graduation_year IS NULL OR graduation_year BETWEEN 2000 AND 2100),
  CONSTRAINT student_profiles_major_length CHECK (length(major) <= 150),
  CONSTRAINT student_profiles_bio_length CHECK (length(bio) <= 1500),
  CONSTRAINT student_profiles_experience_length CHECK (length(experience) <= 4000),
  CONSTRAINT student_profiles_interests_shape CHECK (
    cardinality(interests) <= 20 AND coalesce(array_ndims(interests), 1) = 1
    AND array_position(interests, NULL) IS NULL
  ),
  CONSTRAINT student_profiles_goals_shape CHECK (
    cardinality(goals) <= 10 AND coalesce(array_ndims(goals), 1) = 1
    AND array_position(goals, NULL) IS NULL
  ),
  CONSTRAINT student_profiles_skills_shape CHECK (
    cardinality(skills) <= 30 AND coalesce(array_ndims(skills), 1) = 1
    AND array_position(skills, NULL) IS NULL
  ),
  CONSTRAINT student_profiles_completion_requires_basics CHECK (
    onboarding_completed_at IS NULL OR (
      academic_year IS NOT NULL AND major ~ '[^[:space:]]'
      AND cardinality(interests) > 0
      AND array_to_string(interests, '') ~ '[^[:space:]]'
    )
  )
);

ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;

-- These policies isolate account ownership; the student-only API continues
-- to enforce the app's role checks. No Auth roles are assigned by this draft.
REVOKE ALL ON public.student_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_profiles TO authenticated;

CREATE POLICY student_profiles_read_own
  ON public.student_profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY student_profiles_insert_own
  ON public.student_profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY student_profiles_update_own
  ON public.student_profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY student_profiles_delete_own
  ON public.student_profiles FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMIT;
