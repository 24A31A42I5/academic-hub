-- Attempt to remediate linter WARN: extension in public
-- pg_net does not support ALTER EXTENSION ... SET SCHEMA, so re-install it into a dedicated schema.
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_net'
      AND n.nspname = 'public'
  ) THEN
    -- Recreate in extensions schema
    EXECUTE 'DROP EXTENSION pg_net CASCADE';
    EXECUTE 'CREATE EXTENSION pg_net WITH SCHEMA extensions';
  END IF;
END $$;