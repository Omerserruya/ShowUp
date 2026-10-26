import React from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import { useCountUp } from './useCountUp';

const GREEN = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';
const BRAND = '#5A3DA6';

/**
 * One quiet stat tile. White surface, hairline, a small colored dot to key the
 * metric, and the figure set in ink - color is a label here, never a fill.
 */
function KpiTile({ color, label, value, suffix, onClick, hint }: {
  color: string; label: string; value: number; suffix?: string; onClick?: () => void; hint?: string;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const shown = useCountUp(value);

  return (
    <Box
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      sx={{
        position: 'relative', height: '100%', minHeight: 112,
        p: { xs: 2, sm: 2.25 }, borderRadius: 4,
        bgcolor: isDark ? alpha('#fff', 0.03) : '#fff',
        border: '1px solid', borderColor: isDark ? alpha('#fff', 0.07) : alpha('#2E3A4A', 0.08),
        boxShadow: isDark ? 'none' : '0 6px 24px rgba(16,24,40,0.05)',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
        '&:hover': onClick ? { transform: 'translateY(-2px)', boxShadow: '0 14px 32px rgba(16,24,40,0.09)', borderColor: alpha(color, 0.35) } : undefined,
        '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.85 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mt: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.9rem', sm: '2.1rem' }, lineHeight: 1, letterSpacing: '-0.03em', color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
          {shown}{suffix || ''}
        </Typography>
        {hint && <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.disabled', whiteSpace: 'nowrap' }}>{hint}</Typography>}
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
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : undefined);

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: { xs: 1.5, sm: 2 }, height: '100%' }}>
      <KpiTile color={GREEN} label="אישרו הגעה" value={confirmed} hint={pct(confirmed)} onClick={onFilter ? () => onFilter('confirmed') : undefined} />
      <KpiTile color={AMBER} label="עוד לא ענו" value={waiting} hint={pct(waiting)} onClick={onFilter ? () => onFilter('pending') : undefined} />
      <KpiTile color={RED} label="לא מגיעים" value={declined} hint={pct(declined)} onClick={onFilter ? () => onFilter('declined') : undefined} />
      <KpiTile color={BRAND} label="שיעור אישורים" value={rate} suffix="%" hint={`מתוך ${total}`} />
    </Box>
  );
}
