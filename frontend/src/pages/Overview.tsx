import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Grid, CircularProgress, Alert, Button, alpha, useTheme } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';

import RSVPTable from '../components/RSVPTable';
import EventHero from '../components/dashboard/EventHero';
import AssistantInsight from '../components/dashboard/AssistantInsight';
import KpiCard from '../components/dashboard/KpiCard';
import LifecycleTimeline, { LifecycleItem } from '../components/dashboard/LifecycleTimeline';

import { useOverviewStats, useCampaigns, useGuests, useDailyResponses } from '../hooks/useOverviewData';
import { useEvent } from '../contexts/EventContext';
import { fireConfettiOnce } from '../utils/confetti';

const BRAND = '#888cee';
const BLUE = '#3b82f6';

function mapGuestFromAPI(apiGuest: any): any {
  const statusMap: Record<string, 'pending' | 'confirmed' | 'declined' | 'maybe'> = {
    invited: 'pending', pending: 'pending', attending: 'confirmed',
    confirmed: 'confirmed', declined: 'declined', maybe: 'maybe',
  };
  return {
    _id: apiGuest.id,
    eventId: apiGuest.event_id,
    name: apiGuest.name,
    phone: apiGuest.phone,
    email: apiGuest.email,
    group: apiGuest.group,
    status: statusMap[apiGuest.status] || 'pending',
    source: 'manual' as const,
    note: apiGuest.notes,
    confirmedCount: apiGuest.guest_count || (apiGuest.status === 'confirmed' || apiGuest.status === 'attending' ? 1 : undefined),
    lastResponse: apiGuest.last_response ? new Date(apiGuest.last_response) : undefined,
  };
}

/** Premium surface used for the dashboard's content cards. */
function SectionCard({ title, action, tint, children }: { title: string; action?: React.ReactNode; tint?: string; children: React.ReactNode }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box
      sx={{
        height: '100%',
        p: { xs: 2.5, sm: 3.5 },
        borderRadius: 4,
        bgcolor: tint ? tint : (isDark ? alpha('#fff', 0.03) : '#fff'),
        border: '1px solid',
        borderColor: isDark ? alpha('#fff', 0.06) : alpha(theme.palette.text.primary, 0.05),
        boxShadow: isDark ? 'none' : '0 4px 22px rgba(16,24,40,0.05)',
        opacity: 0,
        animation: 'cardIn .55s cubic-bezier(.2,.8,.2,1) forwards',
        animationDelay: '120ms',
        '@keyframes cardIn': { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'none' } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.01em', color: 'text.primary' }}>{title}</Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}

function daysBetween(future: Date, now: Date) {
  return Math.floor((future.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function roundDateLabel(iso: string, now: Date) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Math.abs(daysBetween(d, now));
  const future = d > now;
  if (diff === 0) return 'היום';
  return future ? `בעוד ${diff} ימים` : `לפני ${diff} ימים`;
}

function Overview() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { selectedEvent } = useEvent();
  const { stats, loading: statsLoading, error: statsError } = useOverviewStats();
  const { campaigns, loading: campaignsLoading } = useCampaigns();
  const { guests, loading: guestsLoading } = useGuests(1, 8, '');
  const { data: daily } = useDailyResponses('week');

  React.useEffect(() => {
    if (selectedEvent?.id && (stats?.approved || 0) >= 1) {
      fireConfettiOnce(`first_guest_confirmed_${selectedEvent.id}`);
    }
  }, [selectedEvent?.id, stats?.approved]);

  if (!selectedEvent) {
    return (
      <Box sx={{ p: 4, direction: 'rtl', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Typography variant="h6" color="text.secondary">בוחרים אירוע כדי לראות מה קורה בו</Typography>
      </Box>
    );
  }

  if (statsLoading || campaignsLoading || guestsLoading) {
    return (
      <Box sx={{ p: 4, direction: 'rtl', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress sx={{ color: BRAND }} />
      </Box>
    );
  }

  const now = new Date();
  const approved = stats?.approved || 0;
  const declined = stats?.declined || 0;
  const pending = stats?.pending || 0;
  const totalInvited = stats?.total || 0;
  const totalGuests = stats?.total_guests || 0;
  const answered = approved + declined;
  const responseRate = totalGuests > 0 ? Math.round((answered / totalGuests) * 100) : 0;

  const eventDate = (selectedEvent as any)?.event_date || (selectedEvent as any)?.date;
  const daysUntil = eventDate && !isNaN(new Date(eventDate).getTime()) ? daysBetween(new Date(eventDate), now) : null;

  // Today's fresh confirmations (for the "+X today" note).
  const todayKey = now.toISOString().slice(0, 10);
  const todayConfirmed = (daily?.data || []).find((d) => (d.date || '').slice(0, 10) === todayKey)?.confirmed || 0;

  // Upcoming / next reminder round.
  const upcoming = campaigns
    .filter((c: any) => c.schedule_time && new Date(c.schedule_time) > now && c.status !== 'sent' && c.status !== 'paused')
    .sort((a: any, b: any) => new Date(a.schedule_time).getTime() - new Date(b.schedule_time).getTime());
  const nextRound: any = upcoming[0];

  // Guest list (recent responders).
  const mappedGuests = guests.map(mapGuestFromAPI);

  // ---- Lifecycle timeline ----
  const lifecycle: LifecycleItem[] = [];
  if (totalGuests > 0) {
    lifecycle.push({ id: 'invited', title: 'ההזמנות יצאו לדרך', dateLabel: `${totalGuests} הזמנות`, status: 'done', icon: '📨' });
  }
  const scheduled = campaigns
    .filter((c: any) => c.schedule_time)
    .sort((a: any, b: any) => new Date(a.schedule_time).getTime() - new Date(b.schedule_time).getTime());
  const nextId = nextRound?.id;
  scheduled.forEach((c: any) => {
    const past = new Date(c.schedule_time) <= now;
    const status: LifecycleItem['status'] = c.id === nextId ? 'next' : (c.status === 'sent' || past) ? 'done' : 'upcoming';
    const icon = /תודה/.test(c.name || '') ? '❤️' : /תזכורת/.test(c.name || '') ? '🔔' : '📣';
    lifecycle.push({ id: c.id, title: c.name, dateLabel: roundDateLabel(c.schedule_time, now), status, icon });
  });
  if (eventDate && !isNaN(new Date(eventDate).getTime())) {
    lifecycle.push({
      id: 'event-day',
      title: selectedEvent.name,
      dateLabel: roundDateLabel(eventDate, now),
      status: !nextRound && (daysUntil ?? 1) >= 0 ? 'next' : 'upcoming',
      icon: '🎉',
    });
  }

  // ---- Assistant insight ----
  let insight: { eyebrow?: string; text: string; meta?: string; actionLabel?: string; onAction?: () => void };
  if (totalGuests === 0) {
    insight = {
      eyebrow: 'בואו נתחיל',
      text: 'עוד רגע מתחילים - מוסיפים את רשימת המוזמנים, ומכאן אנחנו דואגים לשליחה, למעקב ולתזכורות.',
      meta: '⏱ שתי דקות ואתם בפנים',
      actionLabel: 'הוספת אורחים',
      onAction: () => navigate('/guests'),
    };
  } else if (pending > 0 && nextRound) {
    insight = {
      eyebrow: 'אנחנו על זה',
      text: `נשארו ${pending} אנשים שעוד לא ענו. אל דאגה - נזכיר להם בעצמנו, אתם לא צריכים לעשות כלום.`,
      meta: `📨 תזכורת ${roundDateLabel(nextRound.schedule_time, now)}`,
      actionLabel: 'צפייה בתזכורת',
      onAction: () => navigate('/messages'),
    };
  } else if (pending > 0) {
    insight = {
      text: `${pending} עדיין לא ענו, ואין תזכורת מתוזמנת. הדודה עוד לא ענתה 😉 - שווה לתזמן תזכורת.`,
      meta: 'מומלץ: מחר בערב',
      actionLabel: 'תזמון תזכורת',
      onAction: () => navigate('/messages'),
    };
  } else {
    insight = {
      eyebrow: 'הכול בשליטה',
      text: `כולם ענו - ${approved} מגיעים לחגוג 🎉 אנחנו נדאג לשאר. אפשר להתחיל לסדר מי יושב ליד מי.`,
      actionLabel: 'סידור מושבים',
      onAction: () => navigate('/seating'),
    };
  }

  return (
    <Box sx={{ direction: 'rtl' }}>
      <EventHero
        name={selectedEvent.name}
        dateISO={eventDate}
        totalInvited={totalInvited}
        confirmed={approved}
        pending={pending}
        declined={declined}
        totalGuests={totalGuests}
        type={(selectedEvent as any)?.type}
        state={selectedEvent.state}
        paymentStatus={selectedEvent.paymentStatus}
        daysUntil={daysUntil}
      />

      {statsError && <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }}>{statsError}</Alert>}

      <Box sx={{ mb: { xs: 2.5, sm: 3.5 } }}>
        <AssistantInsight {...insight} />
      </Box>

      {/* KPI cards - response rate is the primary KPI (featured, first) */}
      <Grid container spacing={{ xs: 2, sm: 2.5 }} sx={{ mb: { xs: 2.5, sm: 3.5 } }}>
        <Grid item xs={6} md={3}>
          <KpiCard index={0} featured label="שיעור תגובה" value={responseRate} suffix="%" color={BRAND} icon={<FavoriteRoundedIcon />}
            note={responseRate >= 70 ? 'מעל הממוצע 🔥' : 'בדרך הנכונה'} />
        </Grid>
        <Grid item xs={6} md={3}>
          <KpiCard index={1} label="אישרו הגעה" value={approved} color="#22c55e" icon={<CheckCircleRoundedIcon />}
            note={todayConfirmed > 0 ? `+${todayConfirmed} היום` : 'מגיעים לחגוג'} onClick={() => navigate('/guests?filter=confirmed')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <KpiCard index={2} label="טרם ענו" value={pending} color="#f59e0b" icon={<HourglassTopRoundedIcon />}
            note={nextRound ? `תזכורת ${roundDateLabel(nextRound.schedule_time, now)}` : 'ממתינים לתשובה'} onClick={() => navigate('/guests?filter=pending')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <KpiCard index={3} label="לא יגיעו" value={declined} color="#ef4444" icon={<CancelRoundedIcon />}
            note={declined > 0 ? 'נתראה בפעם הבאה' : 'אף ביטול 🤞'} onClick={() => navigate('/guests?filter=declined')} />
        </Grid>
      </Grid>

      {/* Timeline (right) + guests (left) */}
      <Grid container spacing={{ xs: 2.5, sm: 3 }}>
        <Grid item xs={12} md={5}>
          <SectionCard title="מה קורה באירוע" tint={isDark ? alpha(BLUE, 0.1) : alpha(BLUE, 0.04)}>
            <LifecycleTimeline items={lifecycle} />
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={7}>
          <SectionCard
            title="מי כבר ענה"
            action={
              <Button onClick={() => navigate('/guests')} endIcon={<ArrowBackRoundedIcon sx={{ fontSize: 18 }} />}
                sx={{ color: BRAND, fontWeight: 700, textTransform: 'none', '&:hover': { bgcolor: alpha(BRAND, 0.08) } }}>
                כל האורחים
              </Button>
            }
          >
            {mappedGuests.length > 0 ? (
              <RSVPTable guests={mappedGuests} loading={guestsLoading} />
            ) : (
              <Box sx={{ py: 5, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '2.6rem', mb: 1 }}>{totalGuests === 0 ? '🎉' : '📨'}</Typography>
                <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', mb: 0.75, color: 'text.primary' }}>
                  {totalGuests === 0 ? 'עוד רגע מתחילים' : 'הדודה עוד לא ענתה 😉'}
                </Typography>
                <Typography sx={{ color: 'text.secondary', maxWidth: 360, mx: 'auto', mb: 2.5, lineHeight: 1.6 }}>
                  {totalGuests === 0
                    ? 'נוסיף את רשימת האורחים - ומכאן אנחנו שולחים את ההזמנות ורודפים אחרי האישורים. שלא תדעו אקסלים.'
                    : 'שלחנו את ההזמנות. ברגע שמישהו עונה בוואטסאפ, רואים אותו כאן מיד.'}
                </Typography>
                {totalGuests === 0 && (
                  <Button onClick={() => navigate('/guests')} startIcon={<PersonAddRoundedIcon />} variant="contained" disableElevation
                    sx={{ borderRadius: 2.5, px: 3, py: 1, fontWeight: 700, textTransform: 'none', background: `linear-gradient(90deg, #6f74e0, ${BRAND})`,
                      '&:hover': { background: `linear-gradient(90deg, #6f74e0, #6f74e0)` } }}>
                    הוספת אורחים
                  </Button>
                )}
              </Box>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Overview;
