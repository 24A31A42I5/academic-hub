import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

type InvokeOptions = Parameters<typeof supabase.functions.invoke>[1];

export class SessionExpiredError extends Error {
  constructor() {
    super('Your session expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

const isUnauthorized = (error: unknown) => {
  const msg = String((error as { message?: string })?.message ?? error ?? '');
  return msg.includes('401') || msg.toLowerCase().includes('unauthorized');
};

/**
 * Invokes a Supabase edge function with a guaranteed-fresh session.
 *
 * Stale or rotated refresh tokens make the gateway/function return 401
 * ("Unauthorized"). This helper ensures a session exists, retries once after a
 * forced refresh, and surfaces a clear error when the user must sign in again.
 */
export async function invokeEdgeFunction<T = unknown>(
  name: string,
  options?: InvokeOptions
): Promise<{ data: T | null; error: Error | null }> {
  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (!refreshed.session) {
      return { data: null, error: new SessionExpiredError() };
    }
  }

  const first = await supabase.functions.invoke(name, options);
  if (!first.error) return { data: first.data as T, error: null };

  if (!isUnauthorized(first.error)) {
    return { data: first.data as T | null, error: first.error };
  }

  logger.warn?.(`Edge function ${name} returned 401 — refreshing session and retrying`);
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session) {
    return { data: null, error: new SessionExpiredError() };
  }

  const second = await supabase.functions.invoke(name, options);
  if (second.error && isUnauthorized(second.error)) {
    return { data: null, error: new SessionExpiredError() };
  }
  return { data: second.data as T | null, error: second.error ?? null };
}
