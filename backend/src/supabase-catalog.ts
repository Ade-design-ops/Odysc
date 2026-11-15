import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { HttpError } from './errors.js';
import type { Club } from './models.js';

const PROJECT_REF = 'cfrkamtsphdlowuiuarn';
export const MAX_DIRECTORY_ROWS = 2000;

export interface CatalogRow {
  id: string;
  name: string;
  website: string | null;
  category: string | null;
  tags: string | null;
}

export type CatalogQuery = (sql: string, values?: readonly unknown[]) => Promise<{ rows: CatalogRow[] }>;
export interface SupabaseCatalogOptions {
  dbUrl: string;
  caFile: string;
  /** For isolated tests only; the runtime uses a TLS-verifying, read-only pg pool. */
  query?: CatalogQuery;
}
export interface SupabaseCatalogService {
  listClubs(filters?: { q?: string; category?: string }): Promise<Club[]>;
  getClub(idOrSlug: string): Promise<Club | undefined>;
  close(): Promise<void>;
}

const SELECT_COLUMNS = `club_id::text AS id, "Name" AS name, "Website" AS website,
  "Organization Type" AS category, "Interest Tags" AS tags`;
const LIST_CLUBS_SQL = `SELECT ${SELECT_COLUMNS}
FROM public.clubs
WHERE ($1::text = '' OR pg_catalog.strpos(
  pg_catalog.lower(pg_catalog.concat_ws(' ', "Name", "Organization Type", "Interest Tags")),
  pg_catalog.lower($1::text)) > 0)
  AND ($2::text = '' OR pg_catalog.lower(COALESCE("Organization Type", '')) = pg_catalog.lower($2::text))
ORDER BY club_id
LIMIT ${MAX_DIRECTORY_ROWS}`;
const GET_CLUB_SQL = `SELECT ${SELECT_COLUMNS}
FROM public.clubs WHERE club_id = $1::bigint LIMIT 1`;

function databaseConfiguration(options: SupabaseCatalogOptions) {
  try {
    const url = new URL(options.dbUrl);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const direct = url.hostname === `db.${PROJECT_REF}.supabase.co`;
    const pooler = url.hostname.endsWith('.pooler.supabase.com') && user.endsWith(`.${PROJECT_REF}`);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler)
      || !user || !password || !options.caFile.trim() || /\[YOUR-PASSWORD\]/i.test(password)) {
      throw new Error('Invalid configuration');
    }
    const port = url.port ? Number(url.port) : 5432;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    // Individual fields intentionally prevent URI sslmode/sslrootcert parameters
    // from overriding the verified TLS configuration below.
    return {
      host: url.hostname, port, user, password,
      database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
    };
  } catch {
    throw new Error('Supabase club directory needs a valid project database URL and CA certificate path.');
  }
}

/** Only decode clear array/delimiter formats; retain whole multiword interests. */
export function parseDirectoryTags(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  let values: string[];
  try {
    const parsed: unknown = JSON.parse(raw);
    values = Array.isArray(parsed) && parsed.every(value => typeof value === 'string')
      ? parsed as string[] : raw.split(/[,;|\r\n]+/);
  } catch {
    values = raw.split(/[,;|\r\n]+/);
  }
  const seen = new Set<string>();
  return values.map(value => value.trim()).filter(value => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function directoryWebsite(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  let value = raw.trim();
  // A plain domain/path is unambiguous enough to add https. Other incomplete
  // or multi-value strings remain unavailable instead of becoming broken links.
  if (/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(value)) {
    value = `https://${value}`;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    if (/\s/.test(value)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function mapDirectoryClub(row: CatalogRow): Club {
  // The shared directory supplies only these five columns. Empty metadata
  // means unavailable; it must not imply actual forms, contacts, or ownership.
  return {
    id: row.id,
    slug: `usc-club-${row.id}`,
    name: row.name.trim(),
    category: row.category?.trim() ?? '',
    tags: parseDirectoryTags(row.tags),
    websiteUrl: directoryWebsite(row.website),
    ownerId: '', description: '', contactEmail: '', instagramUrl: null,
    applicationDeadline: null, acceptingApplications: false, questions: [],
    isDemo: false, createdAt: '', updatedAt: '',
  };
}

function directoryId(idOrSlug: string): string | undefined {
  const candidate = idOrSlug.startsWith('usc-club-') ? idOrSlug.slice('usc-club-'.length) : idOrSlug;
  if (!/^-?\d+$/.test(candidate)) return undefined;
  try {
    const id = BigInt(candidate);
    return id >= -9223372036854775808n && id <= 9223372036854775807n ? id.toString() : undefined;
  } catch {
    return undefined;
  }
}

function unavailable() {
  return new HttpError(503, 'The club directory is temporarily unavailable. Try again shortly.', 'DIRECTORY_UNAVAILABLE');
}

export async function registerSupabaseCatalog(app: FastifyInstance, options: SupabaseCatalogOptions): Promise<SupabaseCatalogService> {
  const configuration = databaseConfiguration(options);
  let pool: Pool | undefined;
  let query: CatalogQuery;
  if (options.query) {
    query = options.query;
  } else {
    let ca: string;
    try { ca = readFileSync(options.caFile, 'utf8'); }
    catch { throw new Error('The Supabase club directory CA certificate could not be read.'); }
    pool = new Pool({
      ...configuration,
      ssl: { ca, rejectUnauthorized: true },
      max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000,
      statement_timeout: 10000, query_timeout: 12000,
      application_name: 'odysc-club-directory',
      options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000 -c search_path=pg_catalog',
    });
    // pg emits idle connection errors independently of a request. Suppress raw
    // connection details; the next request returns the fixed 503 response.
    pool.on('error', () => {});
    query = async (sql, values) => {
      const client = await pool!.connect();
      let discard = false;
      try {
        await client.query('BEGIN READ ONLY');
        const result = await client.query<CatalogRow>(sql, values ? [...values] : undefined);
        await client.query('ROLLBACK');
        return { rows: result.rows };
      } catch (error) {
        discard = true;
        try { await client.query('ROLLBACK'); } catch { /* Discard the failed connection. */ }
        throw error;
      } finally {
        client.release(discard);
      }
    };
  }
  let closed = false;
  const service: SupabaseCatalogService = {
    async listClubs(filters = {}) {
      if (closed) throw unavailable();
      try {
        const result = await query(LIST_CLUBS_SQL, [filters.q?.trim() ?? '', filters.category?.trim() ?? '']);
        return result.rows.map(mapDirectoryClub);
      } catch { throw unavailable(); }
    },
    async getClub(idOrSlug) {
      const id = directoryId(idOrSlug);
      if (!id) return undefined;
      if (closed) throw unavailable();
      try {
        const result = await query(GET_CLUB_SQL, [id]);
        return result.rows[0] ? mapDirectoryClub(result.rows[0]) : undefined;
      } catch { throw unavailable(); }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (pool) await pool.end();
    },
  };

  app.get<{ Querystring: { q?: string; category?: string } }>('/api/v1/clubs', {
    schema: {
      tags: ['Clubs'], summary: 'Browse the shared USC club directory',
      querystring: Type.Object({
        q: Type.Optional(Type.String({ maxLength: 200 })),
        category: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      }, { additionalProperties: false }),
    },
  }, async request => {
    const clubs = await service.listClubs(request.query);
    return {
      clubs,
      limit: MAX_DIRECTORY_ROWS,
      ...(clubs.length === MAX_DIRECTORY_ROWS ? { notice: `Showing at most ${MAX_DIRECTORY_ROWS} clubs. Refine your search to narrow the directory.` } : {}),
    };
  });
  app.get<{ Params: { clubId: string } }>('/api/v1/clubs/:clubId', {
    schema: {
      tags: ['Clubs'], summary: 'Get a directory club by its ID or stable slug',
      params: Type.Object({ clubId: Type.String({ minLength: 1, maxLength: 160 }) }),
    },
  }, async request => {
    const club = await service.getClub(request.params.clubId);
    if (!club) throw new HttpError(404, 'Club not found.', 'NOT_FOUND');
    return {
      club, events: [],
      notice: 'Application forms, deadlines, contact emails, and events are not available in this directory yet.',
    };
  });
  app.get('/api/v1/events', {
    schema: { tags: ['Events'], summary: 'Shared club events are not available yet' },
  }, async () => ({ events: [], notice: 'Club events have not been added to the shared directory yet.' }));
  return service;
}
