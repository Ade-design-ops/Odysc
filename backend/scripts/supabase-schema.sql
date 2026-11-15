BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog;

-- Catalog metadata only: no application records, stored résumés, bucket rows,
-- connection values, comments, defaults, function bodies, or policy expressions.
WITH app_tables AS (
  SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name,
         c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm')
    AND n.nspname NOT LIKE 'pg_%'
    AND n.nspname NOT IN (
      'information_schema', 'auth', 'storage', 'realtime', '_realtime',
      'supabase_functions', 'supabase_migrations', 'extensions', 'graphql',
      'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron'
    )
), columns AS (
  SELECT t.schema_name, t.table_name, a.attnum AS position, a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         NOT a.attnotnull AS nullable,
         a.attidentity AS identity_kind, a.attgenerated AS generated_kind,
         a.atthasdef AS has_default
  FROM app_tables t
  JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
  WHERE a.attnum > 0 AND NOT a.attisdropped
), constraints AS (
  SELECT t.schema_name, t.table_name, con.conname AS constraint_name,
         con.contype AS constraint_type,
         ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, position)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
               ORDER BY k.position) AS columns,
         rn.nspname AS referenced_schema, rc.relname AS referenced_table,
         CASE WHEN con.contype = 'f' THEN
           ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, position)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
                 ORDER BY k.position)
         ELSE NULL END AS referenced_columns
  FROM app_tables t
  JOIN pg_catalog.pg_constraint con ON con.conrelid = t.oid
  LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
  LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
  WHERE con.contype IN ('p', 'f', 'u')
), enum_values AS (
  SELECT n.nspname AS schema_name, ty.typname AS type_name, e.enumlabel AS value,
         e.enumsortorder AS position
  FROM pg_catalog.pg_enum e
  JOIN pg_catalog.pg_type ty ON ty.oid = e.enumtypid
  JOIN pg_catalog.pg_namespace n ON n.oid = ty.typnamespace
  WHERE EXISTS (
    SELECT 1 FROM app_tables t
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_catalog.pg_type used ON used.oid = a.atttypid
    WHERE used.oid = ty.oid OR used.typelem = ty.oid
  )
), policies AS (
  SELECT p.schemaname AS schema_name, p.tablename AS table_name,
         p.policyname AS policy_name, p.permissive, p.roles, p.cmd AS command
  FROM pg_catalog.pg_policies p
  JOIN app_tables t ON t.schema_name = p.schemaname AND t.table_name = p.tablename
)
SELECT json_build_object(
  'transactionReadOnly', current_setting('transaction_read_only'),
  'tables', COALESCE((SELECT json_agg(row_to_json(t) ORDER BY t.schema_name,t.table_name)
    FROM (SELECT schema_name,table_name,relkind AS kind,relrowsecurity AS rls_enabled,relforcerowsecurity AS rls_forced FROM app_tables) t), '[]'::json),
  'columns', COALESCE((SELECT json_agg(row_to_json(c) ORDER BY c.schema_name,c.table_name,c.position) FROM columns c), '[]'::json),
  'constraints', COALESCE((SELECT json_agg(row_to_json(c) ORDER BY c.schema_name,c.table_name,c.constraint_name) FROM constraints c), '[]'::json),
  'enumValues', COALESCE((SELECT json_agg(row_to_json(e) ORDER BY e.schema_name,e.type_name,e.position) FROM enum_values e), '[]'::json),
  'policies', COALESCE((SELECT json_agg(row_to_json(p) ORDER BY p.schema_name,p.table_name,p.policy_name) FROM policies p), '[]'::json)
);
ROLLBACK;
