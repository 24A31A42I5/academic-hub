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
 * supabase-js reports every non-2xx as the opaque "Edge Function returned a
 * non-2xx status code". The real reason lives in the attached Response body, so
 * read it and rewrite the message to something the user can act on.
 */
const withResolvedMessage = async (error: Error | null): Promise<Error | null> => {
  if (!error) return null;
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return error;
  try {
    const body = await context.clone().json();
    const detail = body?.error ?? body?.message;
    if (typeof detail === 'string' && detail.trim()) {
      const resolved = new Error(detail);
      resolved.name = error.name;
      return resolved;
    }
  } catch {
    /* body was not JSON — keep the original message */
  }
  return error;
};


/**
 * Invokes a Supabase edge function with a guaranteed-fresh session.
 *
 * Stale or rotated refresh tokens make the gateway/function return 401
 * ("Unauthorized"). This helper ensures a session exists, retries once after a
 * forced refresh, and surfaces a clear error when the user must sign in again.
 */
export async function invokeEdgeFunction<T = any>(
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

  // The generic supabase-js message hides the status, so inspect the Response.
  const firstStatus = (first.error as { context?: unknown }).context instanceof Response
    ? ((first.error as { context: Response }).context).status
    : undefined;

  if (firstStatus !== 401 && !isUnauthorized(first.error)) {
    return { data: first.data as T | null, error: await withResolvedMessage(first.error) };
  }

  logger.warn?.(`Edge function ${name} returned 401 — refreshing session and retrying`);
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session) {
    return { data: null, error: new SessionExpiredError() };
  }

  const second = await supabase.functions.invoke(name, options);
  if (second.error) {
    const secondStatus = (second.error as { context?: unknown }).context instanceof Response
      ? ((second.error as { context: Response }).context).status
      : undefined;
    if (secondStatus === 401 || isUnauthorized(second.error)) {
      return { data: null, error: new SessionExpiredError() };
    }
    return { data: second.data as T | null, error: await withResolvedMessage(second.error) };
  }
  return { data: second.data as T | null, error: null };

}
