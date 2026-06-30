/**
 * VAT-aware price helpers.
 *
 * Plan prices in config (e.g. "₪99") are VAT-INCLUSIVE - that is the amount
 * actually charged. For display we show the BEFORE-VAT (net) figure as the
 * headline plus the VAT component and the final total:
 *
 *     net = gross / (1 + TAX_RATE)
 *     vat = gross - net
 *
 * TAX_RATE is read from the environment (REACT_APP_TAX_RATE), never hardcoded
 * at call sites. Default 0.18 (Israeli VAT).
 */

export const TAX_RATE: number = (() => {
  const raw = Number(process.env.REACT_APP_TAX_RATE);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.18;
})();

/** VAT rate as a whole-number percentage, for labels like "מע״מ (18%)". */
export const TAX_RATE_PERCENT: number = Math.round(TAX_RATE * 100);

export interface PriceBreakdown {
  /** VAT-inclusive total actually charged - AFTER any coupon discount. */
  gross: number;
  /** Before-VAT (net) price of the final (discounted) total. */
  net: number;
  /** VAT amount of the final (discounted) total. */
  vat: number;
  /** Tax rate used (fraction). */
  taxRate: number;
  /** VAT-inclusive total BEFORE any discount. Defaults to `gross`. */
  subtotal?: number;
  /** VAT-inclusive coupon discount applied (0 when none). */
  discount?: number;
  /** Applied coupon code, if any. */
  couponCode?: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parse a price given as a number or a string like "₪99", "99", "₪1,299". */
export function parsePrice(price: string | number | null | undefined): number {
  if (typeof price === 'number') return Number.isFinite(price) ? price : 0;
  if (!price) return 0;
  const digits = String(price).replace(/[^\d.]/g, '');
  const n = parseFloat(digits);
  return Number.isFinite(n) ? n : 0;
}

/** Break a VAT-inclusive gross amount into net + vat. */
export function breakdownFromGross(gross: number): PriceBreakdown {
  const g = Math.max(gross || 0, 0);
  const net = TAX_RATE ? g / (1 + TAX_RATE) : g;
  return { gross: round2(g), net: round2(net), vat: round2(g - net), taxRate: TAX_RATE };
}

/** Break a price (number or "₪99" string) into net + vat. */
export function breakdownFromPrice(price: string | number | null | undefined): PriceBreakdown {
  return breakdownFromGross(parsePrice(price));
}

/**
 * Format an ILS amount. Whole numbers render without decimals (₪99); fractional
 * amounts render with exactly two (₪83.90), using Hebrew digit grouping.
 */
export function formatILS(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const isWhole = Math.abs(safe - Math.round(safe)) < 0.005;
  const formatted = isWhole
    ? Math.round(safe).toLocaleString('he-IL')
    : safe.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₪${formatted}`;
}
