import React, { useEffect, useState } from 'react';
import { Box, alpha, useTheme } from '@mui/material';

const PURPLE = '#888cee';
const TEAL = '#34c3a3';

/**
 * Premium two-tone RSVP progress ring: thin, rounded caps, light-grey track,
 * a single purple→turquoise sweep, and a small detached accent dot at the start.
 * Center content is passed as children. No glass, glow, or duplicate ring.
 */
export default function ProgressRing({ pct, size = 190, children }: { pct: number; size?: number; children?: React.ReactNode }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 160); return () => clearTimeout(t); }, []);

  const stroke = size >= 170 ? 13 : 11;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, pct / 100));
  const drawn = mounted ? frac * C : 0;
  const track = isDark ? alpha('#fff', 0.1) : '#ECEEF4';

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="rsvpSweep" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={PURPLE} />
            <stop offset="100%" stopColor={TEAL} />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={c} cy={c} r={r} fill="none"
          stroke="url(#rsvpSweep)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${drawn} ${C}`}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.2,.8,.2,1)' }}
        />
        <circle cx={c} cy={c - r} r={stroke * 0.6} fill={PURPLE} stroke={isDark ? '#1f2433' : '#fff'} strokeWidth={2.5} />
      </svg>
      {children && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {children}
        </Box>
      )}
    </Box>
  );
}
