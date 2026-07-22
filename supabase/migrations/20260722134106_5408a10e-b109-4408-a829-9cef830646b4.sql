
CREATE TABLE IF NOT EXISTS public.internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only service_role should ever read/write this. No grants to anon/authenticated.
GRANT ALL ON public.internal_secrets TO service_role;
ALTER TABLE public.internal_secrets ENABLE ROW LEVEL SECURITY;
-- No policies -> anon/authenticated cannot read or write. service_role bypasses RLS.

INSERT INTO public.internal_secrets (name, value)
VALUES ('deadline_reminder', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- Recreate the cron job to send the stored secret as x-cron-secret header.
DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN
    SELECT jobid FROM cron.job
    WHERE command ILIKE '%deadline-reminder%' OR jobname ILIKE '%deadline%'
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'deadline-reminder-hourly',
  '0 * * * *',
  $cron$
  SELECT extensions.http_post(
    url := 'https://dgbjcjcxdiyugbcbkrpp.supabase.co/functions/v1/deadline-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public.internal_secrets WHERE name = 'deadline_reminder')
    ),
    body := jsonb_build_object('trigger', 'cron', 'at', now())
  );
  $cron$
);
