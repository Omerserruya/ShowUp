import React from 'react';
import { Box, Typography, Grid, alpha, useTheme } from '@mui/material';
import { useCountUp } from './useCountUp';

const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const PURPLE = '#888cee';

const SHADE: Record<string, string> = { [GREEN]: '#15a34a', [AMBER]: '#d97706', [RED]: '#dc2626', [PURPLE]: '#6f74e0' };

/**
 * A standalone KPI tile - no outer container. Its visual anchor lives BEHIND the
 * number: a soft level-fill encoding this metric's share of the guest list, plus
 * a corner glow in the same hue. Tinted, never plain white.
 */
function KpiTile({ color, label, value, suffix, fraction, onClick }: {
  color: string; label: string; value: number; suffix?: string; fraction: number; onClick?: () => void;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const shown = useCountUp(value);
  const pct = Math.max(0, Math.min(100, fraction * 100));

  return (
    <Box
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      sx={{
        position: 'relative', overflow: 'hidden', height: '100%', minHeight: 118,
        p: { xs: 2, sm: 2.25 }, borderRadius: 4,
        bgcolor: alpha(color, isDark ? 0.13 : 0.07),
        border: '1px solid', borderColor: alpha(color, isDark ? 0.3 : 0.16),
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .18s ease, box-shadow .18s ease',
        '&:hover': onClick ? { transform: 'translateY(-2px)', boxShadow: `0 14px 30px ${alpha(color, 0.24)}` } : undefined,
        '&:focus-visible': { outline: `2px solid ${SHADE[color] || color}`, outlineOffset: 2 },
      }}
    >
      <Box
        sx={{
          position: 'absolute', insetInline: 0, bottom: 0, height: `${pct}%`,
          bgcolor: alpha(color, isDark ? 0.2 : 0.12),
          transformOrigin: 'bottom',
          animation: 'fillRise 1.2s cubic-bezier(.2,.8,.2,1) forwards',
          '@keyframes fillRise': { from: { transform: 'scaleY(0)' }, to: { transform: 'scaleY(1)' } },
        }}
      />

      <Box sx={{ position: 'relative' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.85, mb: 0.75 }}>
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: 'text.secondary' }}>{label}</Typography>
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.9rem', sm: '2.2rem' }, lineHeight: 1, letterSpacing: '-0.03em', color: SHADE[color] || color, fontVariantNumeric: 'tabular-nums' }}>
          {shown}{suffix || ''}
        </Typography>
      </Box>
    </Box>
  );
}

export interface KpiCardsProps {
  confirmed: number;
  waiting: number;
  declined: number;
  total: number;
  onFilter?: (status: 'confirmed' | 'pending' | 'declined') => void;
}

/** The four KPIs as a bare 2×2 grid - no wrapping card. */
export default function KpiCards({ confirmed, waiting, declined, total, onFilter }: KpiCardsProps) {
  const rate = total > 0 ? Math.round((confirmed / total) * 100) : 0;
  const frac = (n: number) => (total > 0 ? n / total : 0);

  return (
    <Grid container spacing={{ xs: 1.5, sm: 2 }} sx={{ height: '100%' }} alignItems="stretch">
      <Grid item xs={6}>
        <KpiTile color={GREEN} label="אישרו הגעה" value={confirmed} fraction={frac(confirmed)} onClick={onFilter ? () => onFilter('confirmed') : undefined} />
      </Grid>
      <Grid item xs={6}>
        <KpiTile color={AMBER} label="ממתינים" value={waiting} fraction={frac(waiting)} onClick={onFilter ? () => onFilter('pending') : undefined} />
      </Grid>
      <Grid item xs={6}>
        <KpiTile color={RED} label="לא מגיעים" value={declined} fraction={frac(declined)} onClick={onFilter ? () => onFilter('declined') : undefined} />
      </Grid>
      <Grid item xs={6}>
        <KpiTile color={PURPLE} label="שיעור אישורים" value={rate} suffix="%" fraction={rate / 100} />
      </Grid>
    </Grid>
  );
}
