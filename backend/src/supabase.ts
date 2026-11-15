import { z } from 'zod';
import { HttpError } from './errors.js';
import { academicYears, emptyProfile, type Profile, type User } from './models.js';

export interface SupabaseOptions {
  url: string;
  publishableKey: string;
  fetch?: typeof globalThis.fetch;
  /** Defaults to confirmed USC email access. Empty is an explicit local-test opt-out. */
  studentEmailDomain?: string;
}

const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullish(),
  email_confirmed_at: z.string().nullish(),
  created_at: z.string().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
  app_metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type SupabaseAuthUser = z.infer<typeof authUserSchema>;

const profileRowSchema = z.object({
  user_id: z.string().uuid(), full_name: z.string(),
  academic_year: z.enum(academicYears).nullable(), graduation_year: z.number().int().nullable(),
  major: z.string(), interests: z.array(z.string()), goals: z.array(z.string()),
  bio: z.string(), skills: z.array(z.string()), experience: z.string(),
  onboarding_started_at: z.string(), onboarding_completed_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
}).passthrough();
export type StoredStudentProfile = z.infer<typeof profileRowSchema>;

function invalidResponse(): never {
  throw new HttpError(502, 'Supabase returned a response the backend could not validate.', 'SUPABASE_RESPONSE_ERROR');
}

export function mapAuthUser(value: unknown): User {
  const parsed = authUserSchema.safeParse(value);
  if (!parsed.success) return invalidResponse();
  const source = parsed.data;
  // App metadata, when assigned by trusted server tooling, takes precedence.
  // An ordinary signup's student role is not permission to access other users.
  const role = source.app_metadata?.role ?? source.user_metadata?.role;
  if (role !== undefined && role !== 'student') {
    throw new HttpError(403, 'Student onboarding requires a student account.', 'FORBIDDEN');
  }
  const name = source.user_metadata?.name ?? source.user_metadata?.full_name;
  return {
    id: source.id, email: source.email ?? '', name: typeof name === 'string' ? name.trim().slice(0, 100) : '',
    role: 'student', createdAt: source.created_at ?? new Date().toISOString(),
  };
}

export function toApiProfile(row: StoredStudentProfile | null): Profile {
  if (!row) return emptyProfile();
  return {
    major: row.major, academicYear: row.academic_year, graduationYear: row.graduation_year,
    bio: row.bio, interests: row.interests, skills: row.skills,
    experience: row.experience, goals: row.goals,
  };
}

export function missingBasics(user: User, profile: Profile): string[] {
  return [
    ...(!user.name.trim() ? ['name'] : []), ...(!profile.academicYear ? ['academicYear'] : []),
    ...(!profile.major.trim() ? ['major'] : []),
    ...(!profile.interests.some(interest => interest.trim()) ? ['interests'] : []),
  ];
}

export function profileRow(user: User, profile: Profile, existing: StoredStudentProfile | null, completedAt?: string | null): StoredStudentProfile {
  if (!user.name.trim()) throw new HttpError(400, 'Add your name before saving your profile.', 'MISSING_ONBOARDING_FIELDS');
  const now = new Date().toISOString();
  return {
    user_id: user.id, full_name: user.name.trim(), major: profile.major,
    academic_year: profile.academicYear, graduation_year: profile.graduationYear,
    bio: profile.bio, interests: profile.interests, skills: profile.skills,
    experience: profile.experience, goals: profile.goals,
    onboarding_started_at: existing?.onboarding_started_at ?? now,
    onboarding_completed_at: missingBasics(user, profile).length ? null
      : completedAt === undefined ? existing?.onboarding_completed_at ?? null : completedAt,
    created_at: existing?.created_at ?? now, updated_at: now,
  };
}

interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class SupabaseGateway {
  private readonly origin: string;
  private readonly publishableKey: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly studentEmailDomain: string;

  constructor(options: SupabaseOptions) {
    const url = new URL(options.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw new Error('SUPABASE_URL must be a valid HTTPS project origin.');
    }
    const key = options.publishableKey.trim();
    if (!key || key.startsWith('sb_secret_')) throw new Error('Configure a Supabase publishable or legacy anon key, not a secret key.');
    // A legacy service-role JWT would silently bypass owner policies.
    if (key.split('.').length === 3) {
      try {
        const payload: unknown = JSON.parse(Buffer.from(key.split('.')[1]!, 'base64url').toString('utf8'));
        if (payload && typeof payload === 'object' && 'role' in payload && payload.role === 'service_role') {
          throw new Error('privileged_key');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'privileged_key') throw new Error('Configure a publishable or anon key rather than a service-role key.');
      }
    }
    this.origin = url.origin;
    this.publishableKey = key;
    this.fetcher = options.fetch ?? globalThis.fetch;
    const domain = (options.studentEmailDomain ?? 'usc.edu').trim().toLowerCase();
    if (domain && domain !== 'usc.edu') throw new Error('STUDENT_EMAIL_DOMAIN must be empty or usc.edu.');
    this.studentEmailDomain = domain;
  }

  assertStudentEmail(email: string): void {
    if (!this.studentEmailDomain) return;
    const parsed = z.string().email().safeParse(email.trim());
    const parts = email.trim().toLowerCase().split('@');
    if (!parsed.success || parts.length !== 2 || parts[1] !== this.studentEmailDomain) {
      throw new HttpError(403, 'Use your USC email address ending in @usc.edu.', 'STUDENT_EMAIL_NOT_ALLOWED');
    }
  }

  /** Validate provider-owned email fields; editable metadata is never proof. */
  studentUser(value: unknown, options: { allowUnconfirmed?: boolean } = {}): User {
    const parsed = authUserSchema.safeParse(value);
    if (!parsed.success) return invalidResponse();
    const user = mapAuthUser(parsed.data);
    this.assertStudentEmail(user.email);
    if (this.studentEmailDomain && !options.allowUnconfirmed) {
      const confirmedAt = parsed.data.email_confirmed_at;
      if (!confirmedAt || !Number.isFinite(Date.parse(confirmedAt))) {
        throw new HttpError(401, 'Confirm your USC email before signing in.', 'EMAIL_CONFIRMATION_REQUIRED');
      }
    }
    return user;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Supabase requests require a project-relative path.');
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}${path}`, {
        method: options.method ?? 'GET', signal: AbortSignal.timeout(10_000), redirect: 'error',
        headers: {
          apikey: this.publishableKey,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new HttpError(502, 'Supabase could not be reached. Try again.', 'SUPABASE_UNAVAILABLE');
    }
    let data: unknown;
    if (response.status !== 204) {
      try { data = await response.json(); } catch { return invalidResponse(); }
    }
    if (!response.ok) {
      const errorData = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      // Auth uses error_code alongside a numeric code; PostgREST uses code.
      const code = typeof errorData.error_code === 'string' ? errorData.error_code : errorData.code;
      if (code === 'email_not_confirmed') throw new HttpError(401, 'Confirm your email before signing in.', 'EMAIL_CONFIRMATION_REQUIRED');
      if (['invalid_credentials', 'bad_jwt', 'session_not_found', 'session_expired'].includes(String(code))) {
        throw new HttpError(401, 'Your sign-in details or session could not be verified.', 'UNAUTHORIZED');
      }
      if (response.status === 401) throw new HttpError(401, 'Your sign-in details or session could not be verified.', 'UNAUTHORIZED');
      if (response.status === 403) throw new HttpError(403, 'You do not have permission to access this profile.', 'FORBIDDEN');
      if (response.status === 429) throw new HttpError(429, 'Too many requests. Please try again shortly.', 'RATE_LIMITED');
      if (['23505', 'user_already_exists', 'email_exists'].includes(String(code)) || response.status === 409) throw new HttpError(409, 'A record already exists for this account.', 'CONFLICT');
      if (code === 'PGRST205' || code === '42P01') throw new HttpError(503, 'The required Supabase table is not available yet.', 'SUPABASE_SCHEMA_NOT_READY');
      if (response.status === 400 || response.status === 422 || code === '23514') throw new HttpError(400, 'Supabase could not accept these details. Check the entered values.', 'INVALID_DETAILS');
      throw new HttpError(502, 'Supabase could not complete the request. Try again.', 'SUPABASE_REQUEST_FAILED');
    }
    return data as T;
  }

  async getIdentity(token: string): Promise<{ user: User; token: string }> {
    if (!token || token.length > 16_384) throw new HttpError(401, 'Sign in with a Bearer token.', 'UNAUTHORIZED');
    const data = await this.request('/auth/v1/user', { token });
    return { user: this.studentUser(data), token };
  }

  async getProfile(token: string, userId: string): Promise<StoredStudentProfile | null> {
    const query = new URLSearchParams({ user_id: `eq.${userId}`, select: '*', limit: '1' });
    const data = await this.request(`/rest/v1/student_profiles?${query}`, { token });
    const parsed = z.array(profileRowSchema).max(1).safeParse(data);
    if (!parsed.success || parsed.data.some(row => row.user_id !== userId)) return invalidResponse();
    return parsed.data[0] ?? null;
  }

  async saveProfile(token: string, row: StoredStudentProfile): Promise<StoredStudentProfile> {
    const data = await this.request('/rest/v1/student_profiles?on_conflict=user_id', {
      method: 'POST', token, body: row,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    });
    const parsed = z.array(profileRowSchema).length(1).safeParse(data);
    if (!parsed.success || parsed.data[0]!.user_id !== row.user_id) return invalidResponse();
    return parsed.data[0]!;
  }
}
