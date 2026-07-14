import { Box, Divider, Typography } from '@mui/material';
import { breakdownFromPrice, formatILS, PriceBreakdown } from '../utils/pricing';

interface PriceSummaryProps {
  /** Price as a number or "₪99" string. Ignored if `breakdown` is given. */
  price?: string | number | null;
  /** Pre-computed breakdown (e.g. from the order API) - avoids recomputing. */
  breakdown?: PriceBreakdown;
  /** Label for the grand-total row. Default "סה״כ לתשלום". */
  totalLabel?: string;
}

/**
 * Checkout summary: shows the fixed price and, when a coupon is applied, the
 * discount and the final total. VAT is NOT broken out for the customer - it is a
 * system calculation surfaced at the payment step and on the tax invoice.
 */
export default function PriceSummary({ price, breakdown, totalLabel = 'סה״כ לתשלום' }: PriceSummaryProps) {
  const b = breakdown ?? breakdownFromPrice(price);

  const discount = b.discount ?? 0;
  const hasDiscount = discount > 0;
  const subtotal = b.subtotal ?? b.gross;

  const Row = ({
    label,
    value,
    strong,
    accent,
  }: { label: string; value: string; strong?: boolean; accent?: boolean }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', direction: 'rtl', gap: 2 }}>
      <Typography
        variant={strong ? 'subtitle1' : 'body2'}
        sx={{
          fontWeight: strong ? 800 : 500,
          color: accent ? 'success.main' : strong ? 'text.primary' : 'text.secondary',
        }}
      >
        {label}
      </Typography>
      <Typography
        variant={strong ? 'h6' : 'body2'}
        sx={{
          fontWeight: strong ? 800 : 600,
          color: accent ? 'success.main' : strong ? 'text.primary' : 'text.secondary',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {hasDiscount && <Row label="מחיר" value={formatILS(subtotal)} />}
      {hasDiscount && (
        <Row
          label={
            b.adjustmentKind === 'credit'
              ? 'זיכוי על החבילה הנוכחית'
              : b.couponCode
              ? `הנחה (${b.couponCode})`
              : 'הנחה'
          }
          value={`−${formatILS(discount)}`}
          accent
        />
      )}
      {hasDiscount && <Divider sx={{ my: 0.5 }} />}
      <Row label={totalLabel} value={formatILS(b.gross)} strong />
    </Box>
  );
}
