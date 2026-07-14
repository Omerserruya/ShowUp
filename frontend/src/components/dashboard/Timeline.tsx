import React from 'react';
import { Box, Typography, Button, alpha, useTheme } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';

const BRAND = '#888cee';
const DEEP = '#6f74e0';
const GREEN = '#16a34a';
const RED = '#ef4444';

export type TimelineTone = 'confirmed' | 'declined' | 'system' | 'recommend';

export interface TimelineEntry {
  id: string;
  timeLabel: string;
  text: string;
  tone: TimelineTone;
  name?: string;
  icon?: string;
  onClick?: () => void;
}

const TONE_COLOR: Record<TimelineTone, string> = { confirmed: GREEN, declined: RED, system: '#64748b', recommend: DEEP };

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}

/**
 * "What's happening?" - the event progressing in real time. Timestamps, avatars on
 * a rail, and a forward-looking last step so the story ends in the future.
 */
export default function Timeline({ entries, onSeeAll, emptyHint }: { entries: TimelineEntry[]; onSeeAll: () => void; emptyHint: string }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const rail = isDark ? alpha('#fff', 0.1) : alpha(theme.palette.text.primary, 0.1);

  return (
    <Box
      sx={{
        height: '100%', p: { xs: 2.5, sm: 3 }, borderRadius: 5,
        bgcolor: isDark ? alpha('#fff', 0.03) : '#fff',
        border: '1px solid', borderColor: isDark ? alpha('#fff', 0.07) : alpha(theme.palette.text.primary, 0.07),
        boxShadow: isDark ? 'none' : '0 6px 24px rgba(16,24,40,0.05)',
        display: 'flex', flexDirection: 'column',
        opacity: 0, animation: 'tlIn .55s cubic-bezier(.2,.8,.2,1) .2s forwards',
        '@keyframes tlIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: entries.length ? 2 : 0 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.01em', color: 'text.primary' }}>מה קורה באירוע</Typography>
        {entries.length > 0 && (
          <Button onClick={onSeeAll} endIcon={<ArrowBackRoundedIcon sx={{ fontSize: 17 }} />}
            sx={{ color: BRAND, fontWeight: 700, fontSize: '0.85rem', textTransform: 'none', '&:hover': { bgcolor: alpha(BRAND, 0.08) } }}>
            כל האורחים
          </Button>
        )}
      </Box>

      {entries.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4, textAlign: 'center' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 2, opacity: 0.5 }}>
            {[0, 1, 2].map((i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${rail}` }} />
                <Box sx={{ width: 60 + i * 22, height: 6, borderRadius: 99, bgcolor: rail }} />
              </Box>
            ))}
          </Box>
          <Typography sx={{ color: 'text.secondary', maxWidth: 300, lineHeight: 1.6 }}>{emptyHint}</Typography>
        </Box>
      ) : (
        <Box>
          {entries.map((e, i) => {
            const last = i === entries.length - 1;
            const color = TONE_COLOR[e.tone];
            const recommend = e.tone === 'recommend';
            return (
              <Box
                key={e.id}
                onClick={e.onClick}
                role={e.onClick ? 'button' : undefined}
                tabIndex={e.onClick ? 0 : undefined}
                onKeyDown={e.onClick ? (ev: React.KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); e.onClick!(); } } : undefined}
                sx={{
                  display: 'flex', gap: 1.5, position: 'relative',
                  cursor: e.onClick ? 'pointer' : 'default',
                  '&:focus-visible': { outline: `2px solid ${DEEP}`, outlineOffset: 2, borderRadius: 2 },
                  opacity: 0, animation: 'rowIn .45s ease forwards', animationDelay: `${0.26 + i * 0.06}s`,
                  '@keyframes rowIn': { from: { opacity: 0, transform: 'translateX(-6px)' }, to: { opacity: 1, transform: 'none' } },
                }}
              >
                <Box sx={{ position: 'relative', width: 36, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                  {!last && <Box sx={{ position: 'absolute', top: 38, bottom: -4, width: 2, borderRadius: 2, bgcolor: rail }} />}
                  {e.name ? (
                    <Box sx={{ position: 'relative', zIndex: 1, width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 800, color, bgcolor: alpha(color, isDark ? 0.22 : 0.12), border: `2px solid ${alpha(color, 0.32)}` }}>
                      {initials(e.name)}
                    </Box>
                  ) : (
                    <Box sx={{ position: 'relative', zIndex: 1, width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', bgcolor: alpha(color, isDark ? 0.2 : 0.1), border: `2px solid ${alpha(color, recommend ? 0.4 : 0.25)}` }}>
                      {e.icon || '•'}
                    </Box>
                  )}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0, pb: last ? 0 : 2.25, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ fontWeight: recommend ? 800 : 700, fontSize: '0.92rem', color: recommend ? DEEP : 'text.primary', lineHeight: 1.4 }}>
                    {e.text}
                  </Typography>
                  <Typography sx={{ flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums', mt: 0.1 }}>{e.timeLabel}</Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
