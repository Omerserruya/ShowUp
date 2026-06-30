import React from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';

const BRAND = '#888cee';
const DEEP = '#6f74e0';
const GREEN = '#22c55e';
const GREEN_DEEP = '#16a34a';

export type LifecycleStatus = 'done' | 'next' | 'upcoming';

export interface LifecycleItem {
  id: string;
  title: string;
  dateLabel: string;
  status: LifecycleStatus;
  icon?: string;
}

/**
 * A living vertical timeline of the event's communication lifecycle. Completed
 * steps turn green, the current step glows, upcoming steps stay light. RTL: the
 * rail sits on the right, content flows to its left.
 */
export default function LifecycleTimeline({ items }: { items: LifecycleItem[] }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const muted = isDark ? alpha('#fff', 0.18) : alpha(theme.palette.text.primary, 0.16);

  if (!items.length) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '2.2rem', mb: 1 }}>🗓️</Typography>
        <Typography sx={{ fontWeight: 800, color: 'text.primary', mb: 0.5 }}>הציר עוד מתמלא</Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem', maxWidth: 280, mx: 'auto', lineHeight: 1.6 }}>
          נתזמן את ההזמנות והתזכורות, והכול יופיע כאן לפי הסדר - בלי שתצטרכו לעקוב.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative' }}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const isDone = item.status === 'done';
        const isNext = item.status === 'next';
        const accent = isDone ? GREEN : isNext ? DEEP : muted;

        return (
          <Box
            key={item.id}
            sx={{
              display: 'flex', gap: 1.75, position: 'relative',
              opacity: 0, animation: 'tlIn .5s cubic-bezier(.2,.8,.2,1) forwards', animationDelay: `${i * 70}ms`,
              '@keyframes tlIn': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
            }}
          >
            {/* rail + dot */}
            <Box sx={{ position: 'relative', width: 18, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
              {!last && <Box sx={{ position: 'absolute', top: 20, bottom: -8, width: 2, borderRadius: 2, background: isDone ? `linear-gradient(180deg, ${alpha(GREEN, 0.6)}, ${alpha(GREEN, 0.25)})` : muted }} />}
              <Box
                sx={{
                  mt: '6px', width: 13, height: 13, borderRadius: '50%', zIndex: 1, position: 'relative',
                  background: isDone ? `linear-gradient(135deg, ${GREEN}, ${GREEN_DEEP})` : isNext ? DEEP : 'transparent',
                  border: isDone || isNext ? 'none' : `2px solid ${muted}`,
                  boxShadow: isDone ? `0 0 0 4px ${alpha(GREEN, 0.14)}` : isNext ? `0 0 0 5px ${alpha(DEEP, 0.18)}` : 'none',
                  animation: isNext ? 'dotPulse 2s ease-in-out infinite' : 'none',
                  '@keyframes dotPulse': { '0%,100%': { boxShadow: `0 0 0 4px ${alpha(DEEP, 0.16)}` }, '50%': { boxShadow: `0 0 0 9px ${alpha(DEEP, 0.04)}` } },
                  '&::after': isNext ? { content: '""', position: 'absolute', inset: 4, borderRadius: '50%', bgcolor: '#fff', opacity: 0.85 } : undefined,
                }}
              />
            </Box>

            {/* icon chip */}
            {item.icon && (
              <Box sx={{ flexShrink: 0, width: 36, height: 36, borderRadius: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.05rem', mt: '-2px', bgcolor: alpha(accent, isNext ? 0.16 : 0.1), filter: item.status === 'upcoming' ? 'grayscale(0.4)' : 'none', opacity: item.status === 'upcoming' ? 0.7 : 1, boxShadow: isNext ? `0 0 0 1px ${alpha(DEEP, 0.25)}` : 'none' }}>
                {item.icon}
              </Box>
            )}

            {/* content */}
            <Box sx={{ pb: last ? 0 : 3, flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: isNext ? 800 : 700, fontSize: '0.98rem', color: isDone || isNext ? 'text.primary' : 'text.secondary', lineHeight: 1.3 }}>{item.title}</Typography>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: isDone ? GREEN_DEEP : isNext ? DEEP : 'text.secondary', mt: 0.25 }}>
                {isDone ? `הושלם · ${item.dateLabel}` : isNext ? `הבא בתור · ${item.dateLabel}` : item.dateLabel}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
