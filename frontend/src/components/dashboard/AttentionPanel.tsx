import React from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';

const DEEP = '#6f74e0';
const GREEN = '#22c55e';
const AMBER = '#f59e0b';

export interface AttentionItem {
  icon: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Small circular indicator - green check when calm, amber count when not. */
function Indicator({ count }: { count: number }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const calm = count === 0;
  const color = calm ? GREEN : AMBER;
  return (
    <Box sx={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
      <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${alpha(color, 0.25)}` }} />
      <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', bgcolor: alpha(color, isDark ? 0.22 : 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
        {calm ? <CheckRoundedIcon sx={{ fontSize: 22 }} /> : <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{count}</Typography>}
      </Box>
      {!calm && <Box sx={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${alpha(color, 0.4)}`, animation: 'attPulse 2.4s ease-in-out infinite', '@keyframes attPulse': { '0%,100%': { transform: 'scale(1)', opacity: 0.5 }, '50%': { transform: 'scale(1.15)', opacity: 0 } } }} />}
    </Box>
  );
}

/**
 * Supporting surface: "what should we do next?". A circular indicator is its anchor
 * - a calm green check, or an amber count that quietly pulses. Honest calm state.
 */
export default function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const calm = items.length === 0;

  return (
    <Box
      sx={{
        height: '100%', p: { xs: 2.75, sm: 3.25 }, borderRadius: 5,
        bgcolor: isDark ? alpha('#fff', 0.03) : '#fff',
        border: '1px solid', borderColor: isDark ? alpha('#fff', 0.07) : alpha(theme.palette.text.primary, 0.07),
        boxShadow: isDark ? 'none' : '0 6px 24px rgba(16,24,40,0.05)',
        display: 'flex', flexDirection: 'column',
        opacity: 0, animation: 'attIn .55s cubic-bezier(.2,.8,.2,1) .12s forwards',
        '@keyframes attIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: calm ? 0 : 2.5 }}>
        <Indicator count={items.length} />
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: 'text.primary', lineHeight: 1.2 }}>
            {calm ? 'הכול דבש 🍯' : 'יאללה, סוגרים פינות'}
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.secondary', mt: 0.2 }}>
            {calm ? 'שבו בשקט, אנחנו על זה' : `${items.length} ${items.length === 1 ? 'דבר קטן' : 'דברים קטנים'} ואתם משוחררים`}
          </Typography>
        </Box>
      </Box>

      {calm ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', py: 2 }}>
          <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem', lineHeight: 1.6, maxWidth: 280 }}>
            הכול רץ אוטומטית - אנחנו עוקבים, שולחים ומזכירים. אתם יכולים להירגע.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {items.map((it, i) => (
            <Box
              key={it.text}
              onClick={it.onAction}
              role={it.onAction ? 'button' : undefined}
              tabIndex={it.onAction ? 0 : undefined}
              onKeyDown={it.onAction ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.onAction!(); } } : undefined}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 3,
                cursor: it.onAction ? 'pointer' : 'default',
                bgcolor: isDark ? alpha(AMBER, 0.1) : alpha(AMBER, 0.07),
                borderInlineStart: `3px solid ${alpha(AMBER, 0.5)}`,
                transition: 'background .15s ease',
                '&:hover': it.onAction ? { bgcolor: isDark ? alpha(AMBER, 0.16) : alpha(AMBER, 0.12) } : undefined,
                '&:focus-visible': { outline: `2px solid ${DEEP}`, outlineOffset: 2 },
                opacity: 0, animation: 'itemIn .45s ease forwards', animationDelay: `${0.16 + i * 0.07}s`,
                '@keyframes itemIn': { from: { opacity: 0, transform: 'translateX(-6px)' }, to: { opacity: 1, transform: 'none' } },
              }}
            >
              <Box sx={{ fontSize: '1.3rem', flexShrink: 0 }}>{it.icon}</Box>
              <Typography sx={{ flex: 1, fontWeight: 700, fontSize: '0.95rem', color: 'text.primary', lineHeight: 1.4 }}>{it.text}</Typography>
              {it.actionLabel && it.onAction && (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, flexShrink: 0, color: DEEP, fontWeight: 800, fontSize: '0.85rem' }}>
                  {it.actionLabel}
                  <ArrowBackRoundedIcon sx={{ fontSize: 16 }} />
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
