import React from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import { useCountUp } from './useCountUp';

export interface KpiCardProps {
  label: string;
  value: number;
  /** Accent for the icon medallion + the contextual note. */
  color: string;
  icon: React.ReactNode;
  /** Small human note under the number, e.g. "תזכורת מחר" / "מעל הממוצע". */
  note?: string;
  /** Optional suffix rendered after the number (e.g. "%"). */
  suffix?: string;
  onClick?: () => void;
  /** Stagger the entrance animation. */
  index?: number;
  /** Visually emphasize this card (the primary KPI). */
  featured?: boolean;
}

/**
 * Large, breathing KPI tile - soft surface, almost no border, gentle hover lift,
 * animated counter. The number is the hero; the icon + note give it meaning.
 */
export default function KpiCard({ label, value, color, icon, note, suffix, onClick, index = 0, featured = false }: KpiCardProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const display = useCountUp(value);

  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        height: '100%',
        p: { xs: 2.5, sm: 3 },
        borderRadius: 4,
        cursor: onClick ? 'pointer' : 'default',
        background: featured
          ? `linear-gradient(135deg, ${alpha(color, isDark ? 0.28 : 0.16)}, ${alpha(color, isDark ? 0.14 : 0.07)})`
          : (isDark ? alpha(color, 0.1) : alpha(color, 0.05)),
        border: '1px solid',
        borderColor: alpha(color, featured ? 0.42 : (isDark ? 0.24 : 0.16)),
        boxShadow: featured ? `0 10px 28px ${alpha(color, isDark ? 0.24 : 0.16)}` : 'none',
        overflow: 'hidden',
        transition: 'transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s ease, border-color .25s ease',
        opacity: 0,
        animation: 'kpiIn .5s cubic-bezier(.2,.8,.2,1) forwards',
        animationDelay: `${index * 70}ms`,
        '@keyframes kpiIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
        '&:hover': onClick ? {
          transform: 'translateY(-4px)',
          boxShadow: isDark ? `0 16px 36px ${alpha('#000', 0.45)}` : `0 16px 34px ${alpha(color, 0.16)}`,
          borderColor: alpha(color, 0.4),
          '& .kpi-medallion': { transform: 'scale(1.06)' },
        } : undefined,
      }}
    >
      {/* faint corner glow - alive, not loud */}
      <Box sx={{ position: 'absolute', top: -40, insetInlineStart: -40, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(color, isDark ? 0.22 : 0.14)}, transparent 70%)`, pointerEvents: 'none' }} />

      <Box
        className="kpi-medallion"
        sx={{
          position: 'relative',
          width: featured ? 52 : 46, height: featured ? 52 : 46, borderRadius: '15px', mb: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color,
          background: `linear-gradient(135deg, ${alpha(color, isDark ? 0.26 : 0.18)}, ${alpha(color, isDark ? 0.12 : 0.07)})`,
          boxShadow: `inset 0 0 0 1px ${alpha(color, 0.18)}`,
          transition: 'transform .25s cubic-bezier(.2,.8,.2,1)',
          '& svg': { fontSize: 24 },
        }}
      >
        {icon}
      </Box>

      <Box sx={{ position: 'relative' }}>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem', fontWeight: 600, mb: 0.5 }}>
          {label}
        </Typography>

        <Typography sx={{ fontWeight: 800, fontSize: featured ? { xs: '2.3rem', sm: '3rem' } : { xs: '2rem', sm: '2.4rem' }, lineHeight: 1.02, letterSpacing: '-0.025em', color: 'text.primary' }}>
          {display}{suffix}
        </Typography>

        {note && (
          <Typography sx={{ mt: 0.75, fontSize: '0.85rem', fontWeight: 600, color: alpha(color, isDark ? 0.95 : 0.85) }}>
            {note}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
