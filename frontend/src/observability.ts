/**
 * Frontend observability - Sentry for the React app.
 *
 * Env-driven (never hardcoded), and a clean no-op when REACT_APP_SENTRY_DSN is
 * unset, so local/dev builds run unchanged. We deliberately do NOT trace
 * successful requests or page views (tracesSampleRate 0); Sentry here reports
 * unexpected JS errors and unhandled rejections, with the same correlation id
 * that rides the X-Correlation-ID header into the backend.
 *
 * Nothing sensitive is sent: beforeSend/beforeBreadcrumb strip Bearer tokens and
 * credential query params (?g=, ?token=, ?sig=) from URLs, and send-default-pii
 * is off.
 */
import * as Sentry from '@sentry/react';

const DSN = process.env.REACT_APP_SENTRY_DSN;
const ENVIRONMENT =
  process.env.REACT_APP_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production';
const RELEASE = process.env.REACT_APP_SENTRY_RELEASE || process.env.REACT_APP_GIT_SHA;

const SENSITIVE_QUERY_KEYS = new Set([
  'g', 'token', 'code', 'sig', 'signature', 'secret', 'otp', 'access_token', 'jwt',
]);
const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;

/** Redact credential-bearing query params + JWTs from any URL before it is sent. */
function scrubUrl(url?: string): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.forEach((_v, k) => {
      if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) u.searchParams.set(k, '[redacted]');
    });
    return u.toString().replace(JWT_RE, '[redacted]');
  } catch {
    return url.replace(JWT_RE, '[redacted]').replace(BEARER_RE, '[redacted]');
  }
}

function scrubString(s?: string): string | undefined {
  if (!s) return s;
  return s.replace(JWT_RE, '[redacted]').replace(BEARER_RE, '[redacted]');
}

let started = false;

export function initObservability(): void {
  if (started || !DSN) return;
  started = true;
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    // No performance tracing of successful requests / page views (spec §15).
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Benign noise we never want to see.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'AbortError',
    ],
    beforeSend(event) {
      if (event.request?.url) event.request.url = scrubUrl(event.request.url);
      if (event.request?.headers) delete (event.request.headers as any).Authorization;
      return event;
    },
    beforeBreadcrumb(crumb) {
      // fetch/xhr breadcrumbs carry URLs that may contain tokens.
      if (crumb.data?.url) crumb.data.url = scrubUrl(String(crumb.data.url));
      if (typeof crumb.message === 'string') crumb.message = scrubString(crumb.message);
      return crumb;
    },
  });
  Sentry.setTag('service', 'frontend');
}

/** A fresh correlation id per API call - sent as X-Correlation-ID so the backend
 *  stamps the whole downstream flow with it. */
export function newCorrelationId(): string {
  try {
    return (crypto as any).randomUUID().replace(/-/g, '');
  } catch {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
}

/** Bind the signed-in user to Sentry (id + role; email only when appropriate). */
export function setUserContext(user: { id?: string; role?: string; email?: string } | null): void {
  if (!DSN) return;
  if (!user || !user.id) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id, ...(user.role ? { role: user.role } : {}) });
}

export { Sentry };
