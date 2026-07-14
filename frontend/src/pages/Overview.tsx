import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Grid, Skeleton, Button } from '@mui/material';

import EventHero from '../components/dashboard/EventHero';
import LoadErrorState from '../components/dashboard/LoadErrorState';
import SectionHeader from '../components/dashboard/SectionHeader';
import RsvpRingCard from '../components/dashboard/RsvpRingCard';
import KpiCards from '../components/dashboard/KpiCards';
import AttentionPanel, { AttentionItem } from '../components/dashboard/AttentionPanel';
import Timeline, { TimelineEntry } from '../components/dashboard/Timeline';

import { useOverviewStats, useCampaigns, useGuests } from '../hooks/useOverviewData';
import { useEvent } from '../contexts/EventContext';
import { fireConfettiOnce } from '../utils/confetti';
import { daysUntilEvent } from '../utils/dates';

const HE_DAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

function whenLabel(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${HE_DAYS[d.getDay()]} · ${hh}:${mm}`;
}
function futureChip(d: Date, now: Date) {
  // Calendar-day distance - elapsed-ms math would label tomorrow-morning "היום".
  const diff = daysUntilEvent(d, now);
  if (diff === null || diff <= 0) return 'היום';
  if (diff === 1) return 'מחר';
  // Beyond a week a bare weekday name is ambiguous - anchor it to a date.
  if (diff > 6) return `${HE_DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
  return HE_DAYS[d.getDay()];
}
function pastChip(d: Date, now: Date) {
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days <= 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  return `${d.getDate()}.${d.getMonth() + 1}`;
}
const VERB: Record<string, string> = { confirmed: 'אישרו הגעה', attending: 'אישרו הגעה', declined: 'לא יגיעו', maybe: 'אולי יגיעו' };

function Overview() {
  const navigate = useNavigate();
  const { selectedEvent } = useEvent();
  const [statsRetry, setStatsRetry] = React.useState(0);
  const { stats, loading: statsLoading, error: statsError } = useOverviewStats(statsRetry);
  const { campaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns(statsRetry);
  // The `_refresh_` suffix is stripped by useGuests before hitting the API - it
  // only exists to re-run the fetch when the user retries after a failure.
  const { guests, loading: guestsLoading, error: guestsError } = useGuests(1, 6, statsRetry ? `_refresh_${statsRetry}` : '');

  React.useEffect(() => {
    if (!selectedEvent?.id || (stats?.approved || 0) < 1) return;
    // Celebrate only while the event is still ahead - a retroactive burst on a
    // long-finished event reads as a glitch, not a moment.
    const iso = (selectedEvent as any)?.event_date || (selectedEvent as any)?.date;
    const d = iso ? daysUntilEvent(iso) : null;
    if (d !== null && d < 0) return;
    fireConfettiOnce(`first_guest_confirmed_${selectedEvent.id}`);
  }, [selectedEvent?.id, stats?.approved]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedEvent) {
    return (
      <Box sx={{ p: 4, direction: 'rtl', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Typography variant="h6" color="text.secondary">בוחרים אירוע כדי לראות מה קורה בו</Typography>
      </Box>
    );
  }
  if (statsLoading || campaignsLoading || guestsLoading) {
    // A layout-shaped skeleton previews the control center instead of a blank
    // page + spinner - the dashboard should feel instant and composed.
    return (
      <Box sx={{ direction: 'rtl' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 3, px: 1, py: 1.5, mb: 2.5 }}>
          <Box>
            <Skeleton variant="text" width={260} height={52} />
            <Skeleton variant="text" width={180} height={24} />
            <Skeleton variant="text" width={210} height={20} />
          </Box>
          <Skeleton variant="text" width={140} height={64} />
        </Box>
        <Skeleton variant="text" width={280} height={32} sx={{ mb: 2 }} />
        <Grid container spacing={{ xs: 2.5, sm: 3 }} sx={{ mb: 3.5 }}>
          <Grid item xs={12} md={4} sx={{ order: { xs: 0, md: 2 }, display: 'flex', justifyContent: 'center' }}>
            <Skeleton variant="circular" width={200} height={200} />
          </Grid>
          <Grid item xs={12} md={8} sx={{ order: { xs: 1, md: 1 } }}>
            <Grid container spacing={2}>
              {[0, 1, 2, 3].map((i) => (
                <Grid item xs={6} key={i}><Skeleton variant="rounded" height={104} sx={{ borderRadius: 3 }} /></Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
        <Skeleton variant="text" width={280} height={32} sx={{ mb: 2 }} />
        <Grid container spacing={{ xs: 2.5, sm: 3 }}>
          <Grid item xs={12} md={5}><Skeleton variant="rounded" height={180} sx={{ borderRadius: 3 }} /></Grid>
          <Grid item xs={12} md={7}><Skeleton variant="rounded" height={180} sx={{ borderRadius: 3 }} /></Grid>
        </Grid>
      </Box>
    );
  }

  // A failed load must not render as a confident all-zeros dashboard - a swallowed
  // campaigns/guests failure would also fabricate warnings like "אין תזכורת מתוזמנת".
  if (statsError || campaignsError || guestsError) {
    return <LoadErrorState onRetry={() => setStatsRetry((k) => k + 1)} />;
  }

  const now = new Date();
  const approved = stats?.approved || 0;
  const declined = stats?.declined || 0;
  const pending = stats?.pending || 0;
  const totalGuests = stats?.total_guests || 0;

  const eventDate = (selectedEvent as any)?.event_date || (selectedEvent as any)?.date;
  const daysUntil = eventDate ? daysUntilEvent(eventDate, now) : null;
  const eventOver = daysUntil !== null && daysUntil < 0;

  const upcoming = campaigns
    .filter((c: any) => c.schedule_time && new Date(c.schedule_time) > now && c.status !== 'sent' && c.status !== 'paused')
    .sort((a: any, b: any) => new Date(a.schedule_time).getTime() - new Date(b.schedule_time).getTime());
  const nextRound: any = upcoming[0];
  const nextReminderShort = nextRound ? futureChip(new Date(nextRound.schedule_time), now) : undefined;

  let statusTone: 'good' | 'attention' | 'start';
  let statusLabel: string;
  if (eventOver) { statusTone = 'good'; statusLabel = 'האירוע מאחוריכם 💜'; }
  else if (totalGuests === 0) { statusTone = 'start'; statusLabel = 'מתחילים'; }
  else if (pending === 0) { statusTone = 'good'; statusLabel = 'הכול מוכן'; }
  else if (nextRound) { statusTone = 'good'; statusLabel = 'הכול בשליטה'; }
  else { statusTone = 'attention'; statusLabel = 'דורש תשומת לב'; }

  // After the event, "what's next" is no longer logistics - it's the recap.
  const next = eventOver
    ? { eyebrow: 'הצעד הבא', label: 'סיכום החגיגה', onAction: () => navigate('/recap') }
    : nextRound
    ? { eyebrow: 'התזכורת הבאה', label: whenLabel(nextRound.schedule_time), onAction: () => navigate('/messages') }
    : totalGuests === 0
    ? { eyebrow: 'הצעד הבא', label: 'שליחת ההזמנות', onAction: () => navigate('/guests') }
    : pending > 0
    ? { eyebrow: 'הצעד הבא', label: 'תזמון תזכורת', onAction: () => navigate('/messages') }
    : { eyebrow: 'הצעד הבא', label: 'סידור מושבים', onAction: () => navigate('/seating') };

  const attention: AttentionItem[] = [];
  if (eventOver) {
    attention.push({ icon: '💌', text: 'שווה לשלוח תודה לאורחים ולראות את הסיכום', actionLabel: 'לסיכום', onAction: () => navigate('/recap') });
  } else if (totalGuests === 0) {
    attention.push({ icon: '📋', text: 'רשימת המוזמנים עדיין ריקה', actionLabel: 'הוספה', onAction: () => navigate('/guests') });
  } else if (pending > 0 && !nextRound) {
    attention.push({ icon: '🔔', text: `${pending} לא ענו ואין תזכורת מתוזמנת`, actionLabel: 'תזמון', onAction: () => navigate('/messages') });
  }
  if (selectedEvent.paymentStatus && selectedEvent.paymentStatus !== 'paid' && selectedEvent.state !== 'active') {
    attention.push({ icon: '💳', text: 'התשלום עדיין לא הושלם', actionLabel: 'השלמה', onAction: () => navigate('/billing') });
  }

  const raw: { ts: number; entry: TimelineEntry }[] = [];
  const sentCampaign = campaigns
    .filter((c: any) => c.schedule_time && (c.status === 'sent' || new Date(c.schedule_time) <= now))
    .sort((a: any, b: any) => new Date(a.schedule_time).getTime() - new Date(b.schedule_time).getTime())[0];
  if (sentCampaign) {
    const d = new Date(sentCampaign.schedule_time);
    raw.push({ ts: d.getTime(), entry: { id: 'sent', tone: 'system', icon: '📨', text: 'ההזמנות נשלחו', timeLabel: pastChip(d, now) } });
  }
  guests.forEach((g: any) => {
    if (!g.last_response || (g.status !== 'confirmed' && g.status !== 'attending' && g.status !== 'declined' && g.status !== 'maybe')) return;
    const d = new Date(g.last_response);
    if (isNaN(d.getTime())) return;
    const tone = (g.status === 'declined' ? 'declined' : g.status === 'maybe' ? 'system' : 'confirmed') as TimelineEntry['tone'];
    raw.push({ ts: d.getTime(), entry: { id: g.id, name: g.name, tone, text: `${g.name} ${VERB[g.status] || 'השיבו'}`, timeLabel: pastChip(d, now) } });
  });
  raw.sort((a, b) => a.ts - b.ts);
  const entries: TimelineEntry[] = raw.slice(-4).map((r) => r.entry);
  if (eventOver) {
    entries.push({ id: 'recap', tone: 'recommend', icon: '🎉', text: 'האירוע חגג! כל המספרים והרגעים מחכים בסיכום', timeLabel: 'סיכום', onClick: () => navigate('/recap') });
  } else if (nextRound) {
    entries.push({ id: 'next', tone: 'recommend', icon: '🔔', text: `תזכורת תישלח אוטומטית ${nextReminderShort}`, timeLabel: nextReminderShort || '', onClick: () => navigate('/messages') });
  } else if (totalGuests > 0 && pending > 0) {
    entries.push({ id: 'rec', tone: 'recommend', icon: '💡', text: 'ממליצים לתזמן תזכורת למי שטרם ענה', timeLabel: 'הצעד הבא', onClick: () => navigate('/messages') });
  } else if (totalGuests > 0 && pending === 0) {
    entries.push({ id: 'seat', tone: 'recommend', icon: '🪑', text: 'כולם ענו - אפשר להתחיל לסדר מושבים', timeLabel: 'הצעד הבא', onClick: () => navigate('/seating') });
  }
  const timelineHint = 'ברגע שתעלו את רשימת המוזמנים, כל הזמנה, אישור ותגובה יופיעו כאן - כמו יומן חי של האירוע.';

  return (
    <Box sx={{ direction: 'rtl' }}>
      {/* 1. When is my event? - state only */}
      <EventHero
        name={selectedEvent.name}
        dateISO={eventDate}
        daysUntil={daysUntil}
        type={(selectedEvent as any)?.type}
        state={selectedEvent.state}
        paymentStatus={selectedEvent.paymentStatus}
        statusTone={statusTone}
        statusLabel={statusLabel}
        nextEyebrow={next.eyebrow}
        nextLabel={next.label}
        onNext={next.onAction}
        lifecycleStage={totalGuests === 0 ? 0 : pending > 0 ? 1 : 2}
      />

      {/* 2. How many confirmed? - ring (left) + 2×2 KPI cards (right).
          With zero guests there is nothing to count - a 0/0 ring and four zero
          tiles read as a broken dashboard, so we onboard instead. */}
      {totalGuests === 0 && !eventOver ? (
        <Box sx={{ textAlign: 'center', py: { xs: 4, sm: 6 }, px: 2, mb: { xs: 2.5, sm: 3.5 } }}>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.35rem', sm: '1.6rem' }, letterSpacing: '-0.02em', mb: 1 }}>
            הכול מתחיל ברשימת המוזמנים
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 420, mx: 'auto', lineHeight: 1.6, mb: 3 }}>
            מעלים את הרשימה - ואנחנו כבר נדאג להזמנות, לתזכורות ולספירת האישורים.
          </Typography>
          <Button variant="contained" disableElevation onClick={() => navigate('/guests')} sx={{ borderRadius: 99, px: 3.5, py: 1, fontWeight: 700 }}>
            הוספת מוזמנים
          </Button>
        </Box>
      ) : (
        <>
          <SectionHeader emoji="💌" title="מצב האישורים" subtitle="כמה כבר אמרו 'באים', וכמה עוד מותחים אותנו" />
          <Grid container spacing={{ xs: 2.5, sm: 3 }} alignItems="stretch" sx={{ mb: { xs: 2.5, sm: 3.5 } }}>
            <Grid item xs={12} md={4} sx={{ order: { xs: 0, md: 2 } }}>
              <RsvpRingCard confirmed={approved} total={totalGuests} />
            </Grid>
            <Grid item xs={12} md={8} sx={{ order: { xs: 1, md: 1 } }}>
              <KpiCards confirmed={approved} waiting={pending} declined={declined} total={totalGuests} onFilter={(status) => navigate(`/guests?filter=${status}`)} />
            </Grid>
          </Grid>
        </>
      )}

      {/* 3. What should we do next?  ·  4. What's happening? (asymmetric) */}
      <SectionHeader emoji="💓" title="הדופק של האירוע" subtitle="מה דורש אתכם - ומה כבר קורה מאחורי הקלעים" />
      <Grid container spacing={{ xs: 2.5, sm: 3 }} alignItems="stretch">
        <Grid item xs={12} md={5}>
          <AttentionPanel items={attention} />
        </Grid>
        <Grid item xs={12} md={7}>
          <Timeline entries={entries} onSeeAll={() => navigate('/guests')} emptyHint={timelineHint} />
        </Grid>
      </Grid>
    </Box>
  );
}

export default Overview;
