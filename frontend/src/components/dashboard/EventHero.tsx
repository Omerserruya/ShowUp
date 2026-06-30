import React, { useEffect, useState } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import EventStatusBadge from '../EventStatusBadge';
import { useCountUp } from './useCountUp';

const BRAND = '#888cee';
const DEEP = '#6f74e0';
const SOFT = '#aab0f4';
// Donut palette — soft, flat, pastel (per the reference).
const CONFIRMED = '#5BC4A8'; // mint / teal — מגיעים
const WAITING = '#C9A8E0';   // lavender — טרם ענו
const DECLINED = '#2E4756';  // navy — לא מגיעים
const REMAIN = '#D6DCDC';    // light gray — יתרה
const NUM_DARK = '#2E4756';  // center number

const HE_DAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

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

export interface EventHeroProps {
  name: string;
  dateISO?: string;
  totalInvited: number;
  confirmed: number;
  pending: number;
  declined: number;
  totalGuests: number;
  type?: string;
  state?: any;
  paymentStatus?: any;
  daysUntil?: number | null;
}

export default function EventHero({ name, dateISO, totalInvited, confirmed, pending, declined, totalGuests, type, state, paymentStatus, daysUntil }: EventHeroProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const emoji = emojiForType(type, name);

  // --- RSVP donut (inlined; the hero card is the only container) ---
  const [ringMounted, setRingMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRingMounted(true), 140); return () => clearTimeout(t); }, []);
  const shownConfirmed = useCountUp(confirmed);

  const size = 160, stroke = 14, r = (size - stroke) / 2, C = 2 * Math.PI * r, GAP = 8;
  const remaining = Math.max(0, totalGuests - confirmed - pending - declined);
  const gray = isDark ? alpha('#fff', 0.12) : REMAIN;
  const segments = [
    { key: 'c', value: confirmed, color: CONFIRMED },
    { key: 'p', value: pending, color: WAITING },
    { key: 'd', value: declined, color: DECLINED },
    { key: 'r', value: remaining, color: gray },
  ].filter((s) => s.value > 0);
  const denom = confirmed + pending + declined + remaining;
  const multi = segments.length > 1;
  let acc = 0;
  const arcs = segments.map((s) => {
    const frac = denom > 0 ? s.value / denom : 0;
    const startLen = acc * C;
    acc += frac;
    return { ...s, frac, startLen };
  });

  let dateLine = '';
  if (dateISO) {
    const d = new Date(dateISO);
    if (!isNaN(d.getTime())) {
      dateLine = `${HE_DAYS[d.getDay()]} · ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
      if (typeof daysUntil === 'number' && daysUntil >= 0) dateLine += daysUntil === 0 ? ' · היום!' : ` · עוד ${daysUntil} ימים`;
    }
  }

  let status: string;
  if (totalGuests === 0) status = 'עוד רגע מתחילים — שלא תדעו אקסלים 🎉';
  else if (pending === 0) status = 'הכול מוכן. נשאר רק לספור את הימים 🎉';
  else status = `${pending} עוד לא ענו — אנחנו על זה 😉`;

  return (
    <Box
      sx={{
        position: 'relative', overflow: 'hidden', borderRadius: 5,
        p: { xs: 2.5, sm: 3.5 }, mb: { xs: 2.5, sm: 3 },
        background: isDark
          ? `linear-gradient(120deg, ${alpha(DEEP, 0.3)} 0%, ${alpha(BRAND, 0.13)} 60%, ${alpha(SOFT, 0.06)} 100%)`
          : `linear-gradient(120deg, ${alpha(BRAND, 0.12)} 0%, ${alpha(SOFT, 0.06)} 60%, ${alpha('#ffffff', 0)} 100%)`,
        boxShadow: isDark ? 'none' : `0 12px 34px ${alpha(BRAND, 0.1)}`,
        opacity: 0, animation: 'heroIn .6s cubic-bezier(.2,.8,.2,1) forwards',
        '@keyframes heroIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: { xs: 2.5, sm: 4 }, flexWrap: 'wrap',
      }}
    >
      {/* event info (right in RTL) */}
      <Box sx={{ flex: 1, minWidth: 240 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', mb: 0.75 }}>
          <Typography sx={{ fontSize: { xs: '1.5rem', sm: '1.8rem' }, lineHeight: 1, animation: 'heroFloat 5s ease-in-out infinite', '@keyframes heroFloat': { '0%,100%': { transform: 'translateY(0) rotate(0)' }, '50%': { transform: 'translateY(-3px) rotate(-4deg)' } } }}>{emoji}</Typography>
          <Typography component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.025em', fontSize: { xs: '1.5rem', sm: '2rem' }, lineHeight: 1.1, color: 'text.primary' }}>{name}</Typography>
          <EventStatusBadge state={state} paymentStatus={paymentStatus} />
        </Box>
        {(dateLine || totalInvited > 0) && (
          <Typography sx={{ color: 'text.secondary', fontSize: { xs: '0.9rem', sm: '1rem' }, fontWeight: 600 }}>
            {[dateLine, totalInvited > 0 ? `${totalInvited} מוזמנים` : ''].filter(Boolean).join('  •  ')}
          </Typography>
        )}
        <Typography sx={{ mt: 1.5, fontSize: { xs: '1.05rem', sm: '1.25rem' }, fontWeight: 800, letterSpacing: '-0.01em', color: DEEP }}>{status}</Typography>
      </Box>

      {/* RSVP donut — sits directly on the left; no card, no wrapper */}
      <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {denom === 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={gray} strokeWidth={stroke} />}
          {arcs.map((a, i) => {
            const segLen = a.frac * C;
            const drawn = ringMounted ? Math.max(segLen - (multi ? GAP : 0), 0.001) : 0;
            return (
              <circle
                key={a.key}
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={a.color} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={`${drawn} ${C}`}
                strokeDashoffset={-a.startLen}
                style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1)', transitionDelay: `${i * 120}ms` }}
              />
            );
          })}
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap' }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: '2rem', lineHeight: 1, letterSpacing: '-0.02em', color: isDark ? 'common.white' : NUM_DARK }}>
              {shownConfirmed}
            </Typography>
            <Typography component="span" sx={{ fontWeight: 500, fontSize: '1.15rem', color: 'text.disabled', ml: 0.5 }}>
              / {totalGuests}
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.secondary', mt: 0.6 }}>מגיעים לאירוע!</Typography>
        </Box>
      </Box>
    </Box>
  );
}
