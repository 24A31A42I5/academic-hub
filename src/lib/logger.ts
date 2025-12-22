/**
 * Secure logging utility that sanitizes output in production
 * In development: full console output
 * In production: minimal safe logging
 */

const isDev = import.meta.env.DEV;

/**
 * Sanitize error objects to prevent information leakage
 */
const sanitizeError = (error: unknown): string => {
  if (error instanceof Error) {
    // Only return generic message in production
    return isDev ? error.message : 'An error occurred';
  }
  return isDev ? String(error) : 'An error occurred';
};

/**
 * Secure logger that only outputs details in development
 */
export const logger = {
  /**
   * Log error - only shows details in development
   */
  error: (message: string, context?: unknown) => {
    if (isDev) {
      console.error(message, context);
    }
    // In production, could send to logging service like Sentry
  },

  /**
   * Log warning - only shows in development
   */
  warn: (message: string, context?: unknown) => {
    if (isDev) {
      console.warn(message, context);
    }
  },

  /**
   * Log info - only shows in development
   */
  info: (message: string, context?: unknown) => {
    if (isDev) {
      console.info(message, context);
    }
  },

  /**
   * Log debug - only shows in development
   */
  debug: (message: string, context?: unknown) => {
    if (isDev) {
      console.debug(message, context);
    }
  },

  /**
   * Get a sanitized error message safe for display to users
   */
  getSafeErrorMessage: sanitizeError,
};
