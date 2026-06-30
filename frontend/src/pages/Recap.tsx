import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import HelpRoundedIcon from '@mui/icons-material/HelpRounded';
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import { useEvent } from '../contexts/EventContext';
import { useOverviewStats } from '../hooks/useOverviewData';
import { fetchWithAuth } from '../utils/fetchWithAuth';

function StatTile({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <Paper
      elevation={0}
      sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', height: '100%' }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{ color, display: 'flex' }}>{icon}</Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

export default function Recap() {
  const navigate = useNavigate();
  const { selectedEvent } = useEvent();
  const { stats, loading } = useOverviewStats();
  const [exporting, setExporting] = React.useState(false);

  const eventDateRaw = (selectedEvent as any)?.event_date || (selectedEvent as any)?.date;
  const eventDate = eventDateRaw ? new Date(eventDateRaw) : null;
  const isPast = eventDate ? eventDate.getTime() < Date.now() : false;

  const handleExport = async () => {
    if (!selectedEvent?.id) return;
    setExporting(true);
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
      // best-effort; errors are non-blocking on a recap screen
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
    return (
      <Box sx={{ p: 4, direction: 'rtl', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  const approved = stats?.approved || 0;
  const declined = stats?.declined || 0;
  const pending = stats?.pending || 0;
  const totalGuests = stats?.total_guests || 0;
  const responded = approved + declined;
  const responseRate = totalGuests > 0 ? Math.round((responded / totalGuests) * 100) : 0;

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, direction: 'rtl', maxWidth: 900, mx: 'auto' }}>
      {/* Hero */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 4 },
          borderRadius: 4,
          mb: 3,
          textAlign: 'center',
          background: 'linear-gradient(135deg, #6D28D9 0%, #EC4899 100%)',
          color: '#fff',
        }}
      >
        <CelebrationRoundedIcon sx={{ fontSize: 48, mb: 1 }} />
        <Typography variant="h4" sx={{ fontWeight: 800, mb: 0.5 }}>
          {isPast ? 'סיכום האירוע' : 'הנה איך האירוע נראה עד עכשיו'}
        </Typography>
        <Typography variant="subtitle1" sx={{ opacity: 0.9 }}>
          {selectedEvent.name}
        </Typography>
        {!isPast && (
          <Chip
            label="האירוע עדיין לא התקיים - זו תצוגה מקדימה"
            size="small"
            sx={{ mt: 1.5, bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }}
          />
        )}
        <Box sx={{ mt: 3 }}>
          <Typography variant="h2" sx={{ fontWeight: 800, lineHeight: 1 }}>{approved}</Typography>
          <Typography variant="body1" sx={{ opacity: 0.9 }}>אורחים אישרו הגעה</Typography>
        </Box>
      </Paper>

      {/* Stat tiles */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <StatTile icon={<CheckCircleRoundedIcon />} label="אישרו" value={approved} color="#16A34A" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatTile icon={<CancelRoundedIcon />} label="לא הגיעו" value={declined} color="#DC2626" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatTile icon={<HelpRoundedIcon />} label="לא הגיבו" value={pending} color="#F59E0B" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatTile icon={<PeopleRoundedIcon />} label="אחוז מענה" value={responseRate} color="#6D28D9" />
        </Grid>
      </Grid>

      {/* Post-event actions */}
      <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>מה הלאה?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {isPast
            ? 'תודו לאורחים שהגיעו וסכמו את האירוע.'
            : 'אפשר כבר עכשיו להכין הודעת תודה לאחרי האירוע ולייצא את רשימת האורחים.'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            variant="contained"
            startIcon={<FavoriteRoundedIcon />}
            onClick={() => navigate('/messages')}
            sx={{ flex: 1 }}
          >
            שלח תודה לאורחים
          </Button>
          <Button
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={16} /> : <FileDownloadRoundedIcon />}
            onClick={handleExport}
            disabled={exporting}
            sx={{ flex: 1 }}
          >
            ייצא רשימת אורחים
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
