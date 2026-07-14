import React from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import ProgressRing from './ProgressRing';
import { useCountUp } from './useCountUp';

const INK = '#2E3A4A';

/**
 * Card 1 of the analytics row: ONLY the RSVP progress ring, centered with room to
 * breathe. The ring is our visual identity - unchanged palette, thickness, caps,
 * indicator dot, and typography.
 */
export default function RsvpRingCard({ confirmed, total }: { confirmed: number; total: number }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const rate = total > 0 ? Math.round((confirmed / total) * 100) : 0;
  const shownConfirmed = useCountUp(confirmed);

  return (
    <Box
      sx={{
        height: '100%', minHeight: 260, borderRadius: 5, p: { xs: 2.5, sm: 3 },
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: isDark ? alpha('#fff', 0.03) : '#fff',
        border: '1px solid', borderColor: isDark ? alpha('#fff', 0.07) : alpha(INK, 0.07),
        boxShadow: isDark ? 'none' : '0 6px 24px rgba(16,24,40,0.05)',
        opacity: 0, animation: 'ringCardIn .6s cubic-bezier(.2,.8,.2,1) forwards',
        '@keyframes ringCardIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
      }}
    >
      <ProgressRing pct={rate} size={200}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap' }}>
          <Typography component="span" sx={{ fontWeight: 800, fontSize: '2.8rem', lineHeight: 1, letterSpacing: '-0.03em', color: isDark ? 'common.white' : INK, fontVariantNumeric: 'tabular-nums' }}>{shownConfirmed}</Typography>
          <Typography component="span" sx={{ fontWeight: 600, fontSize: '1.4rem', color: 'text.disabled', ml: 0.5 }}>/ {total}</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: 'text.secondary', mt: 0.6 }}>אישרו הגעה</Typography>
      </ProgressRing>
    </Box>
  );
}
