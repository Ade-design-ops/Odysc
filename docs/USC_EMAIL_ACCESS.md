# USC email access

**Active as of November 14, 2026.** The [USC email migration](../backend/supabase/usc-email-access.sql) is applied, the backend defaults to `STUDENT_EMAIL_DOMAIN=usc.edu`, and the Before User Created hook is enabled. A direct non-USC Supabase Auth signup returned the hook's rejection, confirming activation. The old non-USC demo account is blocked; no accounts were deleted.

The policy requires a provider-confirmed email address whose domain is exactly `usc.edu`. Normal email confirmation verifies mailbox access, not current student enrollment. Uppercase `USC.EDU` is accepted; subdomains and lookalikes such as `mail.usc.edu`, `notusc.edu`, and `usc.edu.example.com` are rejected. No university sign-in integration is required for this email-domain rule.

## Enforcement layers

| Layer | Purpose |
| --- | --- |
| Backend `STUDENT_EMAIL_DOMAIN=usc.edu` | Default; validates signup and authenticated student access, including existing accounts. An explicit blank opts out only for isolated tests and does not disable shared Supabase rules. |
| Supabase Before User Created hook | Blocks non-USC account creation even when a client calls Supabase Auth directly. The hook checks the domain before account creation; email confirmation happens afterward. |
| Restrictive profile policy | Requires a currently confirmed USC Auth identity in addition to the existing own-profile policies, including direct Data API requests. |

The additional database policy leaves `student_profiles_read_own`, `student_profiles_insert_own`, `student_profiles_update_own`, and `student_profiles_delete_own` intact. It cannot grant access to another student's profile. A private function reads only the caller's current `auth.users` row and returns a boolean. It also compares the signed JWT email to the current email, so tokens issued before an email change cannot continue using profile access after the change. A changed valid USC email needs a refreshed session.

The signup hook applies to **all newly created Supabase Auth accounts**, including future organizer accounts. It does not trust a role supplied in signup metadata as an exemption. Existing non-USC accounts are not deleted; the backend gate and profile policy deny their protected student access. This migration does not implement organization membership or club management permissions.

The shared club directory remains public. This policy restricts student account features; making the directory itself private would be a separate change. Future shared tables and Storage buckets need their own appropriate access policies. Privileged administrative database/service credentials can bypass RLS and must stay private.

## Configuration to preserve

These settings are active in the shared project. Preserve them during integration; use the same steps for a new project. The backend setting alone cannot prevent direct Supabase signups, and blanking it does not remove the shared hook or profile policy.

1. Have a permitted USC inbox available for confirmation testing. Keep Supabase **Confirm email** enabled. Its built-in sender currently emails only organization team members and permits two messages per hour across the project; configure custom SMTP for ordinary student addresses. See [Supabase's email setup](https://supabase.com/docs/guides/auth/auth-smtp).
2. Keep `odysc_private` out of Supabase Data API's **Exposed schemas** list. The migration is already applied here; for another project, review and apply it as `postgres` after the student onboarding migration. It uses an explicit transaction and can be reapplied; it preserves profile data, club/mock tables, and existing ownership policies.
3. In Supabase Authentication → Hooks, select **Before User Created**, choose the Postgres function `public.odysc_before_user_created_usc_email`, and enable it. If a Before User Created hook already exists, merge its checks with this rule instead of replacing it blindly. Creating the SQL function alone does not enable the hook. See [Supabase's hook documentation](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).
4. Set `STUDENT_EMAIL_DOMAIN=usc.edu` in the backend's ignored environment and restart the backend. Do not add a hidden exception for the example.com demo account. Use an actual confirmed USC test account instead.
5. Add a clear USC email message to the frontend and handle `403 STUDENT_EMAIL_NOT_ALLOWED` for a rejected address and `401 EMAIL_CONFIRMATION_REQUIRED` for an unconfirmed USC address. Keep using `credentials:'include'` and the existing backend callback; the domain rule does not change redirect URLs. See [the authentication handoff](AUTHENTICATION.md).

## Verification status

- Live USC demo sign-in, own onboarding read, draft save/readback, and sign-out passed. Its draft remains incomplete for frontend onboarding.
- All four ownership policies and the restrictive USC profile policy remain present. Live rollback-only verification passed own-profile CRUD and cross-student isolation, and denied non-USC, unconfirmed, anonymous, and stale-email-token identities. Its temporary fixtures were rolled back.
- The hook body was checked as its `postgres` owner, and catalog checks confirmed `supabase_auth_admin` execute permission. The managed database does not permit `SET ROLE supabase_auth_admin`. A direct non-USC Auth signup separately returned the hook's `403` rejection, proving it is active.
- Automated backend tests cover domain lookalikes, confirmation checks, and authenticated API/session behavior without sending real emails.

Operator checks require `psql` on `PATH`, the backend's private connection settings, and its verified TLS CA:

```sh
cd backend
npm run usc:status
npm run usc:verify
```

These invoke `scripts/usc-email-access.mjs --status` and `--verify`. Status inspects metadata; verification runs temporary live database fixtures inside a transaction that is rolled back. Credentials and personal account details stay out of output. Function existence alone does not establish hook activation.

Actual frontend signup/confirmation and password recovery through a real inbox remain deferred until the frontend is ready. The demo account was manually auto-confirmed, so its successful login does not prove inbox delivery. Recheck PDF upload and cross-student PDF isolation with frontend integration. Keep Supabase's email delivery limits in view; ordinary student recipients need custom SMTP.

Supabase documents the [Auth user confirmation fields](https://supabase.com/docs/guides/auth/users) and [restrictive policies and private security-definer functions](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Roll back without removing ownership rules

Only when intentionally rolling back, first disable `public.odysc_before_user_created_usc_email` in Supabase Authentication → Hooks, or restore the previous hook. Set `STUDENT_EMAIL_DOMAIN` to an explicit blank and restart the backend; removing it restores the `usc.edu` default. Then apply the following rollback as the `postgres` role:

```sql
BEGIN;
DROP POLICY IF EXISTS student_profiles_usc_email_required
  ON public.student_profiles;
DROP FUNCTION IF EXISTS public.odysc_before_user_created_usc_email(jsonb);
DROP FUNCTION IF EXISTS odysc_private.has_confirmed_usc_email();
COMMIT;
```

This removes only the USC gate. Keep RLS enabled and keep the four existing own-profile policies and grants. Do not drop `student_profiles`, Auth users, or the private schema: other work may use that schema later. Blanking the backend setting alone does not remove the database restriction or disable the signup hook.
