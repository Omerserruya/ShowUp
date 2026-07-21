import React from 'react';
import { Box, Typography } from '@mui/material';

// ---------------------------------------------------------------------------
// Self-contained DARK palette for the Operations console. The rest of the app
// is light; this page paints its own dark surface and never touches the global
// MUI theme, so every colour here is explicit rather than theme-derived.
// ---------------------------------------------------------------------------
export const OPS = {
  bg: '#0b0e16',
  panel: '#131926',
  card: '#151b29',
  cardHover: '#1a2231',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  text: '#e6ebf4',
  textDim: '#94a3b8',
  textFaint: '#64748b',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  grey: '#64748b',
  blue: '#60a5fa',
  violet: '#a78bfa',
  mono: '"SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
} as const;

export const statusColor = (
  status: 'healthy' | 'warning' | 'offline' | 'unknown' | string
): string => {
  switch (status) {
    case 'healthy':
      return OPS.green;
    case 'warning':
      return OPS.amber;
    case 'offline':
      return OPS.red;
    case 'unknown':
    default:
      return OPS.grey;
  }
};

// A dark surface card with a subtle border.
export const OpsCard: React.FC<{
  children: React.ReactNode;
  sx?: object;
  accent?: string;
}> = ({ children, sx, accent }) => (
  <Box
    sx={{
      bgcolor: OPS.card,
      border: `1px solid ${OPS.border}`,
      borderTop: accent ? `2px solid ${accent}` : `1px solid ${OPS.border}`,
      borderRadius: 2.5,
      p: 2,
      ...sx,
    }}
  >
    {children}
  </Box>
);

// A single stat tile: small label + big number.
export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  accent?: string;
}> = ({ label, value, sub, color, accent }) => (
  <OpsCard accent={accent} sx={{ p: 1.75 }}>
    <Typography
      sx={{
        color: OPS.textDim,
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        mb: 0.5,
      }}
    >
      {label}
    </Typography>
    <Typography sx={{ color: color || OPS.text, fontSize: '1.7rem', fontWeight: 800, lineHeight: 1.1 }}>
      {value}
    </Typography>
    {sub != null && (
      <Typography sx={{ color: OPS.textFaint, fontSize: '0.72rem', mt: 0.4 }}>{sub}</Typography>
    )}
  </OpsCard>
);

export const StatusDot: React.FC<{ color: string; size?: number; pulse?: boolean }> = ({
  color,
  size = 9,
  pulse,
}) => (
  <Box
    sx={{
      width: size,
      height: size,
      borderRadius: '50%',
      bgcolor: color,
      flexShrink: 0,
      boxShadow: `0 0 0 3px ${color}22`,
      ...(pulse && {
        animation: 'opsPulse 1.8s ease-in-out infinite',
        '@keyframes opsPulse': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.35 },
        },
      }),
    }}
  />
);

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({
  children,
  right,
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, mt: 1, gap: 2 }}>
    <Typography
      sx={{ color: OPS.text, fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.02em' }}
    >
      {children}
    </Typography>
    {right}
  </Box>
);

// A thin horizontal usage bar (CPU / RAM / disk).
export const UsageBar: React.FC<{ label: string; percent: number; detail?: string }> = ({
  label,
  percent,
  detail,
}) => {
  const pct = Math.max(0, Math.min(100, percent));
  const color = pct >= 90 ? OPS.red : pct >= 75 ? OPS.amber : OPS.green;
  return (
    <Box sx={{ mb: 1.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ color: OPS.textDim, fontSize: '0.75rem', fontWeight: 700 }}>{label}</Typography>
        <Typography sx={{ color: OPS.text, fontSize: '0.75rem', fontWeight: 700 }}>
          {pct.toFixed(0)}%{detail ? <span style={{ color: OPS.textFaint }}> · {detail}</span> : null}
        </Typography>
      </Box>
      <Box sx={{ height: 7, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: color, transition: 'width .4s ease' }} />
      </Box>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export const fmtNum = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('en-US');

export const fmtPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${(v <= 1 ? v * 100 : v).toFixed(0)}%`;

export const fmtMs = (v: number | null | undefined): string =>
  v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;

// Compact "3m ago" style age from either seconds or an ISO timestamp.
export const fmtAge = (input: number | string | null | undefined): string => {
  if (input == null) return '—';
  let secs: number;
  if (typeof input === 'number') {
    secs = input;
  } else {
    const t = new Date(input).getTime();
    if (Number.isNaN(t)) return '—';
    secs = (Date.now() - t) / 1000;
  }
  if (secs < 0) secs = 0;
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
};

export const fmtDate = (input: string | null | undefined): string => {
  if (!input) return '—';
  const t = new Date(input);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

export const fmtDateTime = (input: string | null | undefined): string => {
  if (!input) return '—';
  const t = new Date(input);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};
