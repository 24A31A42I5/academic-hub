import { supabase } from '@/integrations/supabase/client';

/**
 * Extract the storage path within the `handwriting-samples` bucket from
 * either a stored full URL (legacy public URL) or a bare path.
 */
export function getHandwritingStoragePath(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  // Strip query string
  const clean = urlOrPath.split('?')[0];
  // Match anything after `/handwriting-samples/`
  const marker = '/handwriting-samples/';
  const idx = clean.indexOf(marker);
  if (idx >= 0) return clean.substring(idx + marker.length);
  // If it's already a bare path
  return clean;
}

/**
 * Generate a short-lived signed URL for a handwriting sample stored in the
 * private `handwriting-samples` bucket. Returns null if the user is not
 * authorized or the path cannot be resolved.
 */
export async function getHandwritingSignedUrl(
  urlOrPath: string | null | undefined,
  expiresInSeconds = 300,
): Promise<string | null> {
  const path = getHandwritingStoragePath(urlOrPath);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('handwriting-samples')
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    console.error('Failed to create signed URL for handwriting sample:', error);
    return null;
  }
  return data.signedUrl;
}
