import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, LinearProgress } from '@mui/material';
import { useCountUp } from './dashboard/useCountUp';

// Pastel status palette - reads clearly on the purple plate.
const P_GREEN = '#9ff0c2';
const P_AMBER = '#ffe08a';
const P_RED = '#ffb3b3';

interface Seg { value: number; color: string }

/** A clean multi-segment donut: only the arcs (no track), pastel, with gaps
 *  between segments and rounded ends. */
function StatusDonut({ segments, size = 104 }: { segments: Seg[]; size?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 160); return () => clearTimeout(t); }, []);

  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const GAP = 11;
  const live = segments.filter((s) => s.value > 0);
  const total = live.reduce((a, s) => a + s.value, 0) || 1;
  const single = live.length === 1;

  let acc = 0;
  const arcs = live.map((s) => {
    const frac = s.value / total;
    const startLen = acc * C;
    acc += frac;
    return { color: s.color, len: frac * C, startLen };
  });

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {arcs.map((a, i) => {
          const drawn = mounted ? Math.max(a.len - (single ? 0 : GAP), 0.001) : 0;
          return (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={a.color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${drawn} ${C}`} strokeDashoffset={-a.startLen}
              style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1)', transitionDelay: `${i * 120}ms` }} />
          );
        })}
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', lineHeight: 1, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{total}</Typography>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: 'rgba(255,255,255,0.8)', mt: 0.25 }}>מוזמנים</Typography>
      </Box>
    </Box>
  );
}

function StatRow({ color, label, value }: { color: string; label: string; value: number }) {
  const shown = useCountUp(value);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, py: 0.6 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{shown}</Typography>
    </Box>
  );
}

function QuickAction({ emoji, label, onClick, disabled }: { emoji: string; label: string; onClick: (e: React.MouseEvent<HTMLElement>) => void; disabled?: boolean }) {
  return (
    <Button onClick={onClick} disabled={disabled} fullWidth
      sx={{
        borderRadius: 99, py: 0.85, px: 1, gap: 0.75, bgcolor: '#fff', color: '#5f64d6',
        fontWeight: 700, fontSize: { xs: '0.8rem', sm: '0.9rem' }, textTransform: 'none',
        boxShadow: '0 4px 14px rgba(16,24,40,0.16)',
        transition: 'transform .18s ease, box-shadow .18s ease',
        '&:hover': { bgcolor: '#fff', transform: 'translateY(-2px)', boxShadow: '0 10px 24px rgba(16,24,40,0.24)' },
      }}>
      <Box component="span" sx={{ fontSize: '1rem' }}>{emoji}</Box>{label}
    </Button>
  );
}

/** The one-line, dynamic status - what's happening right now. */
function statusFor(total: number, confirmed: number, declined: number, pending: number, daysUntil?: number | null) {
  if (total === 0) return { c: '#fbbf24', t: 'בואו נתחיל - מעלים את רשימת האורחים ואנחנו ממשיכים מכאן.' };
  if (typeof daysUntil === 'number' && daysUntil >= 0 && daysUntil <= 7) {
    return { c: '#60a5fa', t: daysUntil === 0 ? 'הגיע היום הגדול! 🎉' : `נשארו ${daysUntil} ימים - זמן לבדיקות אחרונות.` };
  }
  const answered = confirmed + declined;
  if (answered === 0) return { c: '#34d399', t: 'הכול מוכן. בלחיצה אחת כולם מקבלים את ההזמנה.' };
  if (pending > 0 && pending >= Math.ceil(total * 0.35)) return { c: '#fb923c', t: `${pending} עדיין מתלבטים... אולי זה הזמן לתזכורת 😉` };
  if (pending > 0) return { c: '#60a5fa', t: `כמעט סיימנו - נשארו ${pending} תשובות.` };
  return { c: '#34d399', t: 'כולם ענו 🎉 אפשר להירגע.' };
}

export interface GuestsSummaryProps {
  confirmed: number;
  pending: number;
  declined: number;
  totalInvited: number;
  capacity: number | null;
  daysUntil?: number | null;
  onAdd: () => void;
  onImport: () => void;
  onExport: (e: React.MouseEvent<HTMLElement>) => void;
  exportLoading: boolean;
}

/**
 * The Guests "hero" - a compact, full-width plate that splits the page top/bottom.
 * Hierarchy: page title, then a single dynamic status line (what's happening now),
 * then the response donut + breakdown, capacity, and quick actions.
 */
export default function GuestsSummary({ confirmed, pending, declined, totalInvited, capacity, daysUntil, onAdd, onImport, onExport, exportLoading }: GuestsSummaryProps) {
  const capPct = capacity && capacity > 0 ? Math.min(100, (totalInvited / capacity) * 100) : 0;
  const segments: Seg[] = [
    { value: confirmed, color: P_GREEN },
    { value: pending, color: P_AMBER },
    { value: declined, color: P_RED },
  ];
  const status = statusFor(totalInvited, confirmed, declined, pending, daysUntil);

  return (
    <Box
      sx={{
        mx: { xs: -2.25, sm: -4 },
        mt: { xs: -2.5, md: -3.5 },
        mb: { xs: 2.5, sm: 3 },
        px: { xs: 2.5, sm: 4.5, md: 6 },
        pt: { xs: 1.75, sm: 2.25 },
        pb: { xs: 2.25, sm: 2.75 },
        backgroundColor: '#6f74e0',
        borderRadius: { xs: '0 0 64px 64px', sm: '0 0 88px 88px' },
        color: '#fff',
      }}
    >
      <Box sx={{ maxWidth: 1040, mx: 'auto', display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 1.75 } }}>
        {/* hero header: title + dynamic status line */}
        <Box>
          <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '1.85rem' }, letterSpacing: '-0.025em', lineHeight: 1.05 }}>
            האורחים שלכם
          </Typography>
          <Typography sx={{ fontSize: { xs: '0.82rem', sm: '0.9rem' }, color: 'rgba(255,255,255,0.8)', mt: 0.3 }}>
            מי הוזמן, מי אישר, ומי עוד מתלבט
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.85 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: status.c, flexShrink: 0, boxShadow: `0 0 0 4px ${status.c}33` }} />
            <Typography sx={{ fontSize: { xs: '0.86rem', sm: '0.92rem' }, fontWeight: 600, color: 'rgba(255,255,255,0.95)' }}>{status.t}</Typography>
          </Box>
        </Box>

        {/* responses: donut + breakdown */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 2.5, sm: 4.5 }, flexWrap: 'wrap', justifyContent: { xs: 'center', md: 'flex-start' } }}>
          <StatusDonut segments={segments} />
          <Box sx={{ flex: 1, minWidth: 230, maxWidth: 400 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.02em', color: 'rgba(255,255,255,0.82)', mb: 0.75 }}>
              💍 איך הם הגיבו להזמנה?
            </Typography>
            <StatRow color={P_GREEN} label="מגיעים" value={confirmed} />
            <StatRow color={P_AMBER} label="ממתינים" value={pending} />
            <StatRow color={P_RED} label="לא מגיעים" value={declined} />
          </Box>
        </Box>

        {/* capacity */}
        <Box sx={{ bgcolor: 'rgba(255,255,255,0.14)', borderRadius: 3, px: 1.75, py: 1.25 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.85, gap: 2 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
              {totalInvited}{capacity !== null ? ` / ${capacity}` : ''}
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.85)' }}>
              {capacity !== null ? `קיבולת: ${capacity} הזמנות` : 'קיבולת: ללא הגבלה'}
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={capPct}
            sx={{ height: 6, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.25)', '& .MuiLinearProgress-bar': { borderRadius: 4, backgroundColor: '#fff', transition: 'transform 1s cubic-bezier(.2,.8,.2,1)' } }} />
        </Box>

        {/* quick actions */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: { xs: 1, sm: 1.5 } }}>
          <QuickAction emoji="➕" label="הוספת אורחים" onClick={onAdd} />
          <QuickAction emoji="📥" label="ייבוא רשימה" onClick={onImport} />
          <QuickAction emoji="⬇️" label={exportLoading ? 'מייצא...' : 'ייצוא'} onClick={onExport} disabled={exportLoading} />
        </Box>
      </Box>
    </Box>
  );
}
