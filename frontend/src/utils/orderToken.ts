// Per-order capability token.
//
// Orders are created before the buyer has an authenticated session, so the
// backend authorizes order reads/mutations by a secret token (returned exactly
// once from POST /api/orders) rather than a JWT. We stash it keyed by order id
// and attach it as `X-Order-Token` on every later order call. When iCount
// redirects back to /payment it carries the token in the `t` query param, so a
// fresh page load after the redirect can recover it.

const key = (orderId: string) => `order_token_${orderId}`;

export function saveOrderToken(orderId?: string | null, token?: string | null): void {
  if (orderId && token) {
    try { localStorage.setItem(key(orderId), token); } catch { /* ignore */ }
  }
}

export function getOrderToken(orderId?: string | null): string | null {
  if (!orderId) return null;
  try { return localStorage.getItem(key(orderId)); } catch { return null; }
}

/** Headers to authorize an order call; empty object when no token is known. */
export function orderAuthHeaders(orderId?: string | null): Record<string, string> {
  const t = getOrderToken(orderId);
  return t ? { 'X-Order-Token': t } : {};
}
