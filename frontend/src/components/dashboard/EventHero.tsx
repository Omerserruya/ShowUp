import React from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EventStatusBadge from '../EventStatusBadge';
import { useCountUp } from './useCountUp';

const BRAND = '#888cee';
const DEEP = '#6f74e0';

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const STAGES = ['יצאו הזמנות', 'אוספים אישורים', 'הכול מוכן'];

const TONE_DOT: Record<'good' | 'attention' | 'start', string> = {
  good: '#22c55e', attention: '#f59e0b', start: '#94a3b8',
};

function emojiForType(type?: string, name?: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'wedding') return '💍';
  if (t === 'birthday') return '🎂';
  if (t === 'corporate') return '🎉';
  const n = name || '';
  if (n.includes('חתונה')) return '💍';
  if (n.includes('יום הולדת')) return '🎂';
  if (n.includes('ברית') || n.includes('בריתה')) return '👶';
  if (n.includes('בר מצווה') || n.includes('בת מצווה')) return '✡️';
  return '✨';
}

/** A minimal lifecycle marker - three nodes on a thin rail, the current one lit. */
function HeroLifecycle({ stage }: { stage: number }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const muted = isDark ? alpha('#fff', 0.2) : alpha('#2E3A4A', 0.18);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.85 }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {STAGES.map((_, i) => {
          const on = i <= stage;
          const active = i === stage;
          return (
            <React.Fragment key={i}>
              {i > 0 && <Box sx={{ width: 26, height: 2, borderRadius: 2, bgcolor: on ? BRAND : muted, transition: 'background .5s ease' }} />}
              <Box sx={{ width: active ? 11 : 9, height: active ? 11 : 9, borderRadius: '50%', bgcolor: on ? BRAND : 'transparent', border: on ? 'none' : `2px solid ${muted}`, boxShadow: active ? `0 0 0 4px ${alpha(BRAND, 0.16)}` : 'none', transition: 'all .4s ease' }} />
            </React.Fragment>
          );
        })}
      </Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.01em', color: DEEP }}>
        {STAGES[Math.max(0, Math.min(stage, STAGES.length - 1))]}
      </Typography>
    </Box>
  );
}

export interface EventHeroProps {
  name: string;
  dateISO?: string;
  daysUntil?: number | null;
  type?: string;
  state?: any;
  paymentStatus?: any;
  statusTone: 'good' | 'attention' | 'start';
  statusLabel: string;
  nextEyebrow: string;
  nextLabel: string;
  onNext?: () => void;
  lifecycleStage: number;
}

/**
 * The hero communicates the STATE of the event - name, countdown, current status,
 * and the next automatic action. No card background: it sits directly on the page.
 */
export default function EventHero({
  name, dateISO, daysUntil, type, state, paymentStatus,
  statusTone, statusLabel, nextEyebrow, nextLabel, onNext, lifecycleStage,
}: EventHeroProps) {
  const emoji = emojiForType(type, name);
  const shownDays = useCountUp(typeof daysUntil === 'number' && daysUntil > 0 ? daysUntil : 0);

  let dateLabel = '';
  if (dateISO) {
    const d = new Date(dateISO);
    if (!isNaN(d.getTime())) dateLabel = `${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
  }
  const showCountdown = typeof daysUntil === 'number' && daysUntil >= 0;

  return (
    <Box
      sx={{
        position: 'relative',
        px: { xs: 0.5, sm: 1 }, py: { xs: 1, sm: 1.5 }, mb: { xs: 2, sm: 2.5 },
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: { xs: 2.5, sm: 4 }, flexWrap: 'wrap',
        opacity: 0, animation: 'heroIn .6s cubic-bezier(.2,.8,.2,1) forwards',
        '@keyframes heroIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
      }}
    >
      {/* event state (start / right) */}
      <Box sx={{ minWidth: 220 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          <Box component="span" sx={{ fontSize: '1.3rem', lineHeight: 1 }}>{emoji}</Box>
          <Typography component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.025em', fontSize: { xs: '1.9rem', sm: '2.5rem' }, lineHeight: 1.1, display: 'inline-block', color: 'text.primary' }}>
            {name}
          </Typography>
          <EventStatusBadge state={state} paymentStatus={paymentStatus} />
        </Box>

        {/* current status - one short line */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.85 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TONE_DOT[statusTone], boxShadow: `0 0 0 3px ${alpha(TONE_DOT[statusTone], 0.16)}`, flexShrink: 0 }} />
          <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: 'text.primary' }}>{statusLabel}</Typography>
        </Box>

        {/* next automatic action - short, scannable */}
        <Box
          onClick={onNext}
          role={onNext ? 'button' : undefined}
          tabIndex={onNext ? 0 : undefined}
          onKeyDown={onNext ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNext(); } } : undefined}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75,
            cursor: onNext ? 'pointer' : 'default', color: 'text.secondary',
            transition: 'color .15s ease', '&:hover': onNext ? { color: DEEP } : undefined,
            '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2, borderRadius: 1 },
          }}
        >
          <Typography component="span" sx={{ fontSize: '0.85rem', fontWeight: 700, color: DEEP }}>{nextEyebrow}:</Typography>
          <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 600 }}>{nextLabel}</Typography>
          {onNext && <ArrowBackRoundedIcon sx={{ fontSize: 15 }} />}
        </Box>
      </Box>

      {/* countdown + lifecycle marker - the hero's left side */}
      <Box sx={{ textAlign: 'center', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 1.5, sm: 2 } }}>
        {typeof daysUntil === 'number' && daysUntil < 0 && (
          <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '1.9rem' }, letterSpacing: '-0.02em', color: DEEP }}>היה בלתי נשכח 💜</Typography>
        )}
        {showCountdown && (daysUntil === 0 ? (
          <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.8rem', sm: '2.3rem' }, letterSpacing: '-0.02em', color: DEEP }}>היום הגדול! 🎉</Typography>
        ) : (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 0.6 }}>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: 'text.secondary' }}>עוד</Typography>
              <Typography sx={{ fontWeight: 800, fontSize: { xs: '2.6rem', sm: '3.1rem' }, lineHeight: 0.85, letterSpacing: '-0.03em', color: DEEP }}>{shownDays}</Typography>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: 'text.secondary' }}>{daysUntil === 1 ? 'יום' : 'ימים'}</Typography>
            </Box>
            {dateLabel && <Typography sx={{ mt: 0.75, fontSize: '0.88rem', fontWeight: 600, color: 'text.secondary' }}>{dateLabel}</Typography>}
          </Box>
        ))}
        <HeroLifecycle stage={lifecycleStage} />
      </Box>
    </Box>
  );
}
