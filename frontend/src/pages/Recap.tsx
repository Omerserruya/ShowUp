import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import { useTheme, alpha } from '@mui/material/styles';
import LoadErrorState from '../components/dashboard/LoadErrorState';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useEvent } from '../contexts/EventContext';
import { useOverviewStats } from '../hooks/useOverviewData';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { daysUntilEvent } from '../utils/dates';
import { fireConfettiOnce } from '../utils/confetti';

/** One metric in the flat, hairline-separated recap strip. */
function StripStat({ value, label, accent, first }: { value: number; label: string; accent?: string; first?: boolean }) {
  return (
    <Box sx={{
      flex: { xs: '1 1 50%', sm: '1 1 0' }, minWidth: 0,
      px: { xs: 2.5, sm: 3 }, py: 2.5,
      borderInlineStart: first ? 'none' : '1px solid', borderColor: 'divider',
    }}>
      <Typography sx={{ fontSize: { xs: 30, sm: 34 }, fontWeight: 800, lineHeight: 1, color: accent || 'text.primary' }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: 0.3 }}>{label}</Typography>
    </Box>
  );
}

export default function Recap() {
  const navigate = useNavigate();
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const { selectedEvent } = useEvent();
  const [retryKey, setRetryKey] = React.useState(0);
  const { stats, loading, error } = useOverviewStats(retryKey);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState(false);

  const eventDateRaw = (selectedEvent as any)?.event_date || (selectedEvent as any)?.date;
  const eventDate = eventDateRaw ? new Date(eventDateRaw) : null;
  // Shared calendar-day helper - must agree with the Overview hero countdown.
  const daysUntil = eventDateRaw ? daysUntilEvent(eventDateRaw) : null;
  const isPast = daysUntil !== null && daysUntil < 0;

  // The recap is the emotional payoff - celebrate it once, on the first visit after the event.
  React.useEffect(() => {
    if (isPast && !loading && selectedEvent?.id && (stats?.approved || 0) > 0) {
      fireConfettiOnce(`recap_seen_${selectedEvent.id}`);
    }
  }, [isPast, loading, selectedEvent?.id, stats?.approved]);
  const dateLabel = eventDate
    ? eventDate.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const handleExport = async () => {
    if (!selectedEvent?.id) return;
    setExporting(true);
    setExportError(false);
    try {
      const res = await fetchWithAuth(`/api/guests/export?event_id=${selectedEvent.id}&export_format=xlsx`);
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedEvent.name || 'event'}-guests.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      // Non-blocking on a recap screen, but a silent stop reads as a broken button.
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  if (!selectedEvent) {
    return (
      <Box sx={{ p: 4, direction: 'rtl', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Typography variant="h6" color="text.secondary">בחרו אירוע כדי לראות את הסיכום</Typography>
      </Box>
    );
  }

  if (loading) {
    // A layout-shaped skeleton of the header + stat strip, mirroring Overview's
    // composed loading pattern - not a bare spinner.
    return (
      <Box sx={{ direction: 'rtl', maxWidth: 820, mx: 'auto', py: { xs: 2, sm: 3 } }}>
        <Stack alignItems="center" sx={{ textAlign: 'center', mb: { xs: 4, sm: 5 } }}>
          <Skeleton variant="circular" width={64} height={64} sx={{ mb: 2.5 }} />
          <Skeleton variant="text" width={110} height={22} sx={{ mb: 1.5 }} />
          <Skeleton variant="text" width={150} height={78} />
          <Skeleton variant="text" width={190} height={34} sx={{ mt: 1 }} />
          <Skeleton variant="text" width={230} height={22} sx={{ mt: 0.5 }} />
        </Stack>
        <Skeleton variant="rounded" height={100} sx={{ borderRadius: 3 }} />
      </Box>
    );
  }

  // A failed stats load must not render as a confident all-zeros recap
  // ("0 אורחים חגגו איתכם") - same reassurance + retry screen as Overview.
  if (error) {
    return <LoadErrorState onRetry={() => setRetryKey((k) => k + 1)} />;
  }

  const approved = stats?.approved || 0;
  const declined = stats?.declined || 0;
  const pending = stats?.pending || 0;
  const totalGuests = stats?.total_guests || 0;
  const responded = approved + declined;
  const responseRate = totalGuests > 0 ? Math.round((responded / totalGuests) * 100) : 0;

  // ── Before the event: a warm anticipation screen, not a recap. ──────────────
  if (!isPast) {
    const countdown = daysUntil == null
      ? null
      : daysUntil <= 0 ? 'האירוע מתקיים היום 🎉'
      : daysUntil === 1 ? 'מחר הרגע הגדול'
      : `בעוד ${daysUntil} ימים`;

    return (
      <Box sx={{ direction: 'rtl', maxWidth: 620, mx: 'auto', textAlign: 'center', py: { xs: 4, sm: 7 } }}>
        <Box sx={{
          width: 84, height: 84, mx: 'auto', mb: 3, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: alpha(primary, 0.1), color: 'primary.main',
        }}>
          <CelebrationRoundedIcon sx={{ fontSize: 40 }} />
        </Box>

        <Typography sx={{ fontSize: { xs: 28, sm: 34 }, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em', mb: 1.5 }}>
          החגיגה עוד לפניכם
        </Typography>

        {countdown && (
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'primary.main', mb: 1 }}>{countdown}</Typography>
        )}
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: 4 }}>
          {selectedEvent.name}{dateLabel ? ` · ${dateLabel}` : ''}
        </Typography>

        <Typography variant="body1" sx={{ color: 'text.secondary', lineHeight: 1.8, mb: 4, maxWidth: 460, mx: 'auto' }}>
          כאן יופיע הסיכום המלא של האירוע - מי הגיע, אחוזי המענה ורגעים לזכור - ברגע שהחגיגה תסתיים.
          {approved > 0 && (
            <> וכבר עכשיו <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>{approved} אורחים אישרו הגעה</Box>.</>
          )}
        </Typography>

        <Button
          variant="contained"
          size="large"
          disableElevation
          endIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate('/overview')}
          sx={{ borderRadius: 2, px: 3.5, py: 1.25, fontWeight: 700, gap: 0.5, '& .MuiButton-endIcon': { mx: 0 } }}
        >
          מעבר ללוח הבקרה
        </Button>
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 2 }}>
          עקבו אחרי האישורים וההתקדמות בלוח הבקרה עד ליום הגדול.
        </Typography>
      </Box>
    );
  }

  // ── After the event: the recap. ─────────────────────────────────────────────
  return (
    <Box sx={{ direction: 'rtl', maxWidth: 820, mx: 'auto', py: { xs: 2, sm: 3 } }}>
      {/* Editorial header - flat, no gradient */}
      <Stack alignItems="center" sx={{ textAlign: 'center', mb: { xs: 4, sm: 5 } }}>
        <Box sx={{
          width: 64, height: 64, mb: 2.5, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: alpha(primary, 0.1), color: 'primary.main',
        }}>
          <CelebrationRoundedIcon sx={{ fontSize: 32 }} />
        </Box>
        <Typography sx={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: 'text.secondary', mb: 1.5 }}>
          סיכום האירוע
        </Typography>
        <Typography sx={{ fontSize: { xs: 56, sm: 72 }, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', color: 'primary.main' }}>
          {approved}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 600, mt: 1 }}>אורחים חגגו איתכם</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {selectedEvent.name}{dateLabel ? ` · ${dateLabel}` : ''}
        </Typography>
      </Stack>

      {/* Flat stat strip */}
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'stretch',
        border: '1px solid', borderColor: 'divider', borderRadius: 3,
        bgcolor: 'background.paper', mb: { xs: 4, sm: 5 },
        // On xs the strip wraps 2×2 - the first cell of each row must not carry
        // a leading divider.
        // borderInlineStartColor is not palette-resolved by the sx system, so the
        // divider color must be baked into the shorthand with a resolved value.
        '& > div:nth-of-type(2n+1)': { borderInlineStart: { xs: 'none', sm: `1px solid ${theme.palette.divider}` } },
        '& > div:first-of-type': { borderInlineStart: 'none' },
      }}>
        <StripStat first value={approved} label="אישרו הגעה" accent={theme.palette.success.main} />
        <StripStat value={declined} label="לא הגיעו" />
        <StripStat value={pending} label="לא הגיבו" />
        <StripStat value={responseRate} label="אחוז מענה" accent={primary} />
      </Box>

      {/* What's next */}
      <Box sx={{ pt: { xs: 4, sm: 5 }, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>מה הלאה?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          תודו לאורחים שהגיעו ושמרו את רשימת האורחים לזיכרון.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            variant="contained"
            disableElevation
            startIcon={<FavoriteRoundedIcon />}
            onClick={() => navigate('/messages')}
            sx={{ flex: 1, borderRadius: 2, py: 1.15, fontWeight: 700, gap: 0.5, '& .MuiButton-startIcon': { mx: 0 } }}
          >
            שליחת תודה לאורחים
          </Button>
          <Button
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={16} /> : <FileDownloadRoundedIcon />}
            onClick={handleExport}
            disabled={exporting}
            sx={{ flex: 1, borderRadius: 2, py: 1.15, fontWeight: 700, gap: 0.5, '& .MuiButton-startIcon': { mx: 0 } }}
          >
            ייצוא רשימת אורחים
          </Button>
        </Stack>
        {exportError && (
          <Typography variant="caption" sx={{ display: 'block', color: 'error.main', fontWeight: 600, mt: 1 }}>
            הייצוא נכשל, נסו שוב
          </Typography>
        )}
        <Button
          startIcon={<InsightsRoundedIcon />}
          onClick={() => navigate('/overview')}
          sx={{ mt: 2, color: 'text.secondary', fontWeight: 600, gap: 0.5, '& .MuiButton-startIcon': { mx: 0 } }}
        >
          חזרה ללוח הבקרה
        </Button>
      </Box>
    </Box>
  );
}
