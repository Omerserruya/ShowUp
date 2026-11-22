import React, { useState } from 'react';
import { Box, Button, Chip, CircularProgress, Stack, TextField, Typography, alpha, useTheme } from '@mui/material';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';

/**
 * A phone-call round on the messages timeline (voice-service via core
 * /events/{id}/call-rounds). Rounds are planned automatically from the event
 * date (shared/domain/round_plan.py); the owner can move or cancel one that has
 * not started. Who gets called is decided when the round starts: whoever still
 * has not answered at that moment.
 */
export type CallRound = {
  id: string;
  status: 'scheduled' | 'running' | 'done' | 'canceled';
  start_at: string;
  total: number;
  auto: boolean;
  populated: boolean;
  confirmed: number;
  declined: number;
  maybe: number;
  unreached: number;
  pending: number;
};

const STATUS: Record<CallRound['status'], { label: string; color: string }> = {
  scheduled: { label: 'מתוכנן', color: '#5A3DA6' },
  running: { label: 'מתקשרים עכשיו', color: '#1E6B3F' },
  done: { label: 'הסתיים', color: '#6B6660' },
  canceled: { label: 'בוטל', color: '#8E887C' },
};

// datetime-local value in the viewer's (Israel) local time
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function CallRoundRow({
  round, pendingGuests, isLast, onMove, onCancel,
}: {
  round: CallRound;
  pendingGuests: number;
  isLast: boolean;
  onMove: (id: string, startAt: string) => Promise<string | null>;
  onCancel: (id: string) => Promise<string | null>;
}) {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [value, setValue] = useState(toLocalInput(round.start_at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dt = new Date(round.start_at);
  const st = STATUS[round.status] || STATUS.scheduled;
  const open = round.status === 'scheduled' && !round.populated;
  const answered = round.confirmed + round.declined + round.maybe;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true); setErr(null);
    const e = await fn();
    setBusy(false);
    if (e) setErr(e); else { setEditing(false); setConfirmCancel(false); }
  };

  return (
    <Box sx={{ display: 'flex', gap: { xs: 1.5, sm: 2 }, position: 'relative', opacity: round.status === 'canceled' ? 0.6 : 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
        <Box sx={{ width: 46, textAlign: 'left', pt: 0.25 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1, color: 'text.primary' }}>{dt.toLocaleDateString('he-IL', { day: '2-digit' })}</Typography>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{dt.toLocaleDateString('he-IL', { month: 'short' })}</Typography>
          <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>{dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</Typography>
        </Box>
        <Box sx={{ position: 'relative', width: 18, display: 'flex', justifyContent: 'center' }}>
          {!isLast && <Box sx={{ position: 'absolute', top: 16, bottom: -8, width: 2, bgcolor: 'divider' }} />}
          <Box sx={{ position: 'relative', zIndex: 1, width: 18, height: 18, borderRadius: '50%', mt: '1px', bgcolor: round.status === 'done' ? primary : 'background.paper', border: '2px solid', borderColor: alpha(primary, round.status === 'done' ? 1 : 0.5), color: round.status === 'done' ? '#fff' : primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PhoneInTalkIcon sx={{ fontSize: 10 }} />
          </Box>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, pb: isLast ? 1 : 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>סבב שיחות טלפון</Typography>
          <Chip label={st.label} size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600, bgcolor: alpha(st.color, 0.12), color: st.color }} />
        </Stack>

        {open ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
            נתקשר לכל מי שעוד לא ענה או ענה "אולי" עד אז{pendingGuests > 0 ? ` (כרגע ${pendingGuests} אורחים)` : ''}.
            {round.auto ? ' המועד נקבע לפי תאריך האירוע וזז איתו אם התאריך משתנה.' : ' המועד נקבע ידנית.'}
          </Typography>
        ) : round.status === 'canceled' ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>הסבב בוטל ולא יתקשר לאף אחד.</Typography>
        ) : round.total === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>כשהגיע המועד כולם כבר ענו, אז לא היה למי להתקשר.</Typography>
        ) : (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
            {round.total} אורחים בסבב · {answered} ענו בטלפון ({round.confirmed} מגיעים, {round.declined} לא מגיעים{round.maybe ? `, ${round.maybe} עוד לא בטוחים` : ''})
            {round.pending > 0 ? ` · ${round.pending} עוד בתור` : ''}{round.unreached > 0 ? ` · ${round.unreached} לא ענו לשיחה` : ''}
          </Typography>
        )}

        {open && !editing && !confirmCancel && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
            <Button size="small" onClick={() => setEditing(true)} sx={{ borderRadius: 1.5, px: 1.5, fontWeight: 600, textTransform: 'none', bgcolor: 'action.hover', color: 'text.primary' }}>שינוי מועד</Button>
            <Button size="small" onClick={() => setConfirmCancel(true)} sx={{ borderRadius: 1.5, px: 1.5, fontWeight: 600, textTransform: 'none', color: 'error.main' }}>ביטול הסבב</Button>
          </Stack>
        )}
        {editing && (
          <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 360 }}>
            <TextField type="datetime-local" size="small" value={value} onChange={(e) => setValue(e.target.value)} inputProps={{ 'aria-label': 'מועד הסבב' }} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.5 }}>
              שיחות יוצאות רק בין 10:00 ל־20:00, בשישי עד 13:00 ולא בשבת. מועד מחוץ לשעות האלה יתחיל בשעה המותרת הבאה.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={busy || !value} onClick={() => run(() => onMove(round.id, new Date(value).toISOString()))} sx={{ borderRadius: 1.5, px: 1.75, fontWeight: 600, textTransform: 'none', bgcolor: '#C9B8F3', color: '#16150F', '&:hover': { bgcolor: '#BBA6EE' } }}>
                {busy ? <CircularProgress size={16} /> : 'שמירה'}
              </Button>
              <Button size="small" onClick={() => { setEditing(false); setValue(toLocalInput(round.start_at)); setErr(null); }} sx={{ textTransform: 'none', color: 'text.secondary' }}>ביטול</Button>
            </Stack>
          </Box>
        )}
        {confirmCancel && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25, flexWrap: 'wrap', rowGap: 1 }}>
            <Typography sx={{ fontSize: 13 }}>לבטל את סבב השיחות?</Typography>
            <Button size="small" disabled={busy} onClick={() => run(() => onCancel(round.id))} sx={{ textTransform: 'none', fontWeight: 600, color: 'error.main' }}>כן, לבטל</Button>
            <Button size="small" onClick={() => setConfirmCancel(false)} sx={{ textTransform: 'none', color: 'text.secondary' }}>לא</Button>
          </Stack>
        )}
        {err && <Typography role="alert" sx={{ fontSize: 12.5, color: 'error.main', mt: 0.75 }}>{err}</Typography>}
      </Box>
    </Box>
  );
}
