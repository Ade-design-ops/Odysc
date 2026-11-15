-- Additive shared workflow tables. Applied only after explicit operator review.
-- Existing clubs, mock data, student_profiles, ownership rules and USC hook remain intact.
-- These tables are server-only: all HTTP operations verify Supabase identity and
-- authorize the current actor with parameterized queries inside a transaction.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
CREATE TABLE public.odysc_student_workspaces (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 250000),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.odysc_club_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id bigint NOT NULL REFERENCES public.clubs(club_id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK(email = lower(email) AND email ~ '^[^@[:space:]]+@usc[.]edu$'),
  full_name text NOT NULL CHECK(length(full_name) BETWEEN 1 AND 100), officer_role text NOT NULL CHECK(length(officer_role) BETWEEN 1 AND 100),
  access text NOT NULL DEFAULT 'reviewer' CHECK(access IN ('admin','reviewer')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('active','pending','invited')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(club_id,email), CHECK(status = 'invited' OR user_id IS NOT NULL)
);
CREATE INDEX odysc_memberships_user_idx ON public.odysc_club_memberships(user_id);
CREATE TABLE public.odysc_club_settings (
  club_id bigint PRIMARY KEY REFERENCES public.clubs(club_id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 100000),
  updated_by uuid NOT NULL REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.odysc_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id bigint NOT NULL REFERENCES public.clubs(club_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','interview','accepted','rejected')),
  answers jsonb NOT NULL CHECK(jsonb_typeof(answers) = 'array' AND octet_length(answers::text) <= 100000),
  profile_snapshot jsonb NOT NULL CHECK(jsonb_typeof(profile_snapshot) = 'object' AND octet_length(profile_snapshot::text) <= 25000),
  share_usc_id boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id,club_id), CHECK(share_usc_id OR NOT(profile_snapshot ? 'uscId'))
);
CREATE INDEX odysc_applications_club_idx ON public.odysc_applications(club_id,submitted_at);
CREATE TABLE public.odysc_answer_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.odysc_applications(id) ON DELETE CASCADE,
  club_id bigint NOT NULL REFERENCES public.clubs(club_id) ON DELETE CASCADE,
  prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 2000), answer text NOT NULL CHECK(length(answer) BETWEEN 1 AND 20000), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id,prompt)
);
CREATE TABLE public.odysc_reviews (
  application_id uuid NOT NULL REFERENCES public.odysc_applications(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(scores) = 'object' AND octet_length(scores::text) <= 3000),
  decision text CHECK(decision IN ('advance','decline','accept')), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(application_id,reviewer_id)
);
CREATE TABLE public.odysc_interviews (
  application_id uuid PRIMARY KEY REFERENCES public.odysc_applications(id) ON DELETE CASCADE,
  club_id bigint NOT NULL REFERENCES public.clubs(club_id) ON DELETE CASCADE,
  format text NOT NULL CHECK(format IN ('zoom','teams','meet','in-person')),
  slots timestamptz[] NOT NULL CHECK(cardinality(slots) BETWEEN 1 AND 6), duration_min smallint NOT NULL CHECK(duration_min BETWEEN 5 AND 240),
  link text CHECK(length(link) <= 2000 AND link ~ '^https://'), building_code text CHECK(length(building_code) <= 30), room text CHECK(length(room) <= 100),
  note text CHECK(length(note) <= 2000), booked_at timestamptz, invited_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES auth.users(id),
  CHECK((format = 'in-person' AND building_code IS NOT NULL AND room IS NOT NULL) OR (format <> 'in-person' AND link IS NOT NULL)),
  CHECK(booked_at IS NULL OR booked_at = ANY(slots))
);
CREATE INDEX odysc_interviews_club_booking_idx ON public.odysc_interviews(club_id,booked_at) WHERE booked_at IS NOT NULL;
CREATE TABLE public.odysc_club_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id bigint NOT NULL REFERENCES public.clubs(club_id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), kind text NOT NULL CHECK(kind IN ('Info session','Mixer','Workshop','Coffee chat')),
  starts_at timestamptz NOT NULL, duration_min smallint NOT NULL CHECK(duration_min BETWEEN 5 AND 1440),
  building_code text NOT NULL CHECK(length(building_code) BETWEEN 1 AND 30), room text NOT NULL CHECK(length(room) BETWEEN 1 AND 100), created_by uuid NOT NULL REFERENCES auth.users(id)
);
-- Deny browser Data API access entirely; fixed backend services enforce actor and club permissions.
ALTER TABLE public.odysc_student_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odysc_club_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odysc_club_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odysc_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odysc_answer_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odysc_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odysc_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odysc_club_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.odysc_student_workspaces,public.odysc_club_memberships,public.odysc_club_settings,public.odysc_applications,public.odysc_answer_bank,public.odysc_reviews,public.odysc_interviews,public.odysc_club_events FROM PUBLIC,anon,authenticated;
COMMIT;
