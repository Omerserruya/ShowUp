import { Box, Typography } from '@mui/material';
import { breakdownFromPrice, formatILS } from '../utils/pricing';

type Size = 'sm' | 'md' | 'lg';

interface PriceTagProps {
  /** Price as a number or "₪99" string — the final price shown to the customer. */
  price: string | number | null | undefined;
  size?: Size;
  align?: 'center' | 'right' | 'left';
  /** Optional color for the price figure. */
  color?: string;
}

const HEADLINE: Record<Size, 'h3' | 'h4' | 'h5'> = { lg: 'h3', md: 'h4', sm: 'h5' };

/**
 * Premium price display: shows the single fixed price the customer pays. VAT is
 * a system concern (applied at checkout and on the tax invoice) and is
 * intentionally NOT broken out for the customer here.
 */
export default function PriceTag({ price, size = 'lg', align = 'right', color }: PriceTagProps) {
  const b = breakdownFromPrice(price);
  return (
    <Box sx={{ direction: 'rtl', textAlign: align }}>
      <Typography
        variant={HEADLINE[size]}
        component="span"
        sx={{ fontWeight: 800, lineHeight: 1, color: color || 'text.primary' }}
      >
        {formatILS(b.gross)}
      </Typography>
    </Box>
  );
}
