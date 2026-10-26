import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, alpha, useTheme } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useCountUp } from './dashboard/useCountUp';

const GREEN = '#5A3DA6';
const AMBER = '#C9B8F3';
const RED = '#D8D3C9';
const DEEP = '#5A3DA6';

interface Seg { value: number; color: string }

/** A small multi-segment ring - arcs only, rounded ends, a light track. */
function StatusRing({ segments, size = 64, track }: { segments: Seg[]; size?: number; track: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 120); return () => clearTimeout(t); }, []);

  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const GAP = 6;
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
        <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {arcs.map((a, i) => {
          const drawn = mounted ? Math.max(a.len - (single ? 0 : GAP), 0.001) : 0;
          return (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={a.color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${drawn} ${C}`} strokeDashoffset={-a.startLen}
              style={{ transition: 'stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)', transitionDelay: `${i * 100}ms` }} />
          );
        })}
      </svg>
    </Box>
  );
}

function Figure({ label, value, color, first }: { label: string; value: number; color?: string; first?: boolean }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const shown = useCountUp(value);
  return (
    <Box
      sx={{
        display: 'flex', flexDirection: 'column', gap: 0.35, minWidth: 0,
        px: { xs: 1, sm: 2.5 },
        borderInlineStart: { xs: 'none', sm: first ? 'none' : '1px solid' },
        borderColor: isDark ? alpha('#fff', 0.1) : alpha('#2E3A4A', 0.1),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {color && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />}
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}>{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: { xs: '1.35rem', sm: '1.5rem' }, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em', color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {shown}
      </Typography>
    </Box>
  );
}

/** The one-line, dynamic status - what's happening right now. */
function statusFor(total: number, confirmed: number, declined: number, pending: number, daysUntil?: number | null) {
  if (total === 0) return { c: AMBER, t: 'מעלים את רשימת האורחים, ואנחנו ממשיכים מכאן.' };
  if (typeof daysUntil === 'number' && daysUntil >= 0 && daysUntil <= 7) {
    return { c: DEEP, t: daysUntil === 0 ? 'היום הגדול הגיע.' : `נשארו ${daysUntil} ימים. זמן לבדיקות אחרונות.` };
  }
  const answered = confirmed + declined;
  if (answered === 0) return { c: GREEN, t: 'הרשימה מוכנה. בלחיצה אחת כולם מקבלים את ההזמנה.' };
  if (pending > 0 && pending >= Math.ceil(total * 0.35)) return { c: AMBER, t: `${pending} עדיין לא ענו. אולי זה הזמן לתזכורת.` };
  if (pending > 0) return { c: DEEP, t: `כמעט סיימנו. נשארו ${pending} תשובות.` };
  return { c: GREEN, t: 'כולם ענו. אפשר להירגע.' };
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
 * The Guests page header: a calm masthead (title, one status line, actions)
 * and a single stat strip beneath it. Sits directly on the page - no plate.
 */
export default function GuestsSummary({ confirmed, pending, declined, totalInvited, capacity, daysUntil, onAdd, onImport, onExport, exportLoading }: GuestsSummaryProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const capPct = capacity && capacity > 0 ? Math.min(100, (totalInvited / capacity) * 100) : 0;
  const segments: Seg[] = [
    { value: confirmed, color: GREEN },
    { value: pending, color: AMBER },
    { value: declined, color: RED },
  ];
  const status = statusFor(totalInvited, confirmed, declined, pending, daysUntil);
  const hairline = isDark ? alpha('#fff', 0.08) : alpha('#2E3A4A', 0.08);

  return (
    <Box sx={{ mb: { xs: 2.5, sm: 3 } }}>
      {/* masthead */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ minWidth: 0 }}>
          {/* The page title lives in the app header (design v6). */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: status.c, flexShrink: 0 }} />
            <Typography sx={{ fontSize: { xs: '0.92rem', md: '1rem' }, color: 'text.secondary' }}>{status.t}</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button
            onClick={onAdd}
            variant="contained"
            disableElevation
            startIcon={<AddRoundedIcon />}
            sx={{ borderRadius: 999, px: 2.25, fontWeight: 700, '& .MuiButton-startIcon': { ml: 0.5, mr: -0.25 } }}
          >
            הוספת אורחים
          </Button>
          <Button
            onClick={onImport}
            variant="outlined"
            startIcon={<UploadFileRoundedIcon />}
            sx={{ borderRadius: 999, px: 2, fontWeight: 600, color: 'text.primary', borderColor: hairline, '&:hover': { borderColor: alpha(DEEP, 0.5), bgcolor: alpha(DEEP, 0.04) }, '& .MuiButton-startIcon': { ml: 0.5, mr: -0.25 } }}
          >
            ייבוא רשימה
          </Button>
          <Button
            onClick={onExport}
            disabled={exportLoading}
            variant="text"
            startIcon={<FileDownloadOutlinedIcon />}
            sx={{ borderRadius: 999, px: 1.5, fontWeight: 600, color: 'text.secondary', '& .MuiButton-startIcon': { ml: 0.5, mr: -0.25 } }}
          >
            {exportLoading ? 'מייצא...' : 'ייצוא'}
          </Button>
        </Box>
      </Box>

      {/* stat strip: ring + inline figures + capacity */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: { xs: 2, sm: 1 },
          px: { xs: 2, sm: 2.5 }, py: { xs: 2, sm: 2 },
          borderRadius: 4,
          bgcolor: isDark ? alpha('#fff', 0.03) : '#fff',
          border: '1px solid', borderColor: hairline,
          boxShadow: isDark ? 'none' : '0 6px 24px rgba(16,24,40,0.05)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <StatusRing segments={segments} track={isDark ? alpha('#fff', 0.08) : '#ECEEF4'} />
          <Box sx={{ display: { xs: 'grid', sm: 'flex' }, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5, flex: 1 }}>
            <Figure label="מוזמנים" value={totalInvited} first />
            <Figure label="מגיעים" value={confirmed} color={GREEN} />
            <Figure label="עוד לא ענו" value={pending} color={AMBER} />
            <Figure label="לא מגיעים" value={declined} color={RED} />
          </Box>
        </Box>

        {capacity !== null ? (
          <Box sx={{ minWidth: { xs: '100%', sm: 200 }, maxWidth: 260, flexShrink: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.75 }}>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary' }}>קיבולת החבילה</Typography>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                {`${totalInvited} / ${capacity}`}
              </Typography>
            </Box>
            <Box sx={{ height: 6, borderRadius: 4, bgcolor: isDark ? alpha('#fff', 0.08) : '#ECEEF4', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${capPct}%`, borderRadius: 4, bgcolor: capPct >= 95 ? AMBER : DEEP, transition: 'width 1s cubic-bezier(.2,.8,.2,1)' }} />
            </Box>
          </Box>
        ) : (
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.disabled', flexShrink: 0, px: 0.5, display: { xs: 'none', md: 'block' } }}>ללא הגבלת אורחים בחבילה</Typography>
        )}
      </Box>
    </Box>
  );
}
