import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Button, LinearProgress, CircularProgress, Alert, Chip, Stack, useTheme, alpha,
} from '@mui/material';
import UpgradeIcon from '@mui/icons-material/Upgrade';
import GroupsIcon from '@mui/icons-material/Groups';
import CampaignIcon from '@mui/icons-material/Campaign';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';
import { getPlan, getCampaignsForPlan } from '../config/plans';

interface Usage { event_id: string; plan_id: string | null; guests_used: number; rounds_used: number; }

function UsageBar({ icon, label, used, limit, theme }: { icon: React.ReactNode; label: string; used: number; limit: number | null; theme: any }) {
  const unlimited = limit === null || limit === undefined;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const color = pct >= 90 ? theme.palette.error.main : pct >= 75 ? theme.palette.warning.main : theme.palette.primary.main;
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{icon}<Typography sx={{ fontWeight: 600 }}>{label}</Typography></Box>
        <Typography variant="body2" color="text.secondary">{used}{unlimited ? '' : ` / ${limit}`}{unlimited && ' (ללא הגבלה)'}</Typography>
      </Box>
      {!unlimited && (
        <LinearProgress variant="determinate" value={pct} sx={{ height: 10, borderRadius: 5, bgcolor: alpha(color, 0.15), '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 5 } }} />
      )}
    </Box>
  );
}

export default function Billing() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { selectedEvent } = useEvent();
  const planId = (selectedEvent as any)?.planId || (selectedEvent as any)?.plan_id || null;
  const plan = getPlan(planId);
  const planLoading = false;
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!selectedEvent?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithAuth(`/api/usage?event_id=${selectedEvent.id}`);
      if (!res.ok) throw new Error();
      setUsage(await res.json());
    } catch {
      setError('שגיאה בטעינת נתוני השימוש');
    } finally {
      setLoading(false);
    }
  }, [selectedEvent?.id]);

  useEffect(() => { load(); }, [load]);

  if (!selectedEvent) {
    return <Box sx={{ p: 4, direction: 'rtl', textAlign: 'center' }}><Typography variant="h6" color="text.secondary">אנא בחר אירוע</Typography></Box>;
  }

  const guestLimit = plan?.countLimit ?? null;
  const roundLimit = plan ? getCampaignsForPlan(planId).length : null;
  const nearLimit = guestLimit != null && usage != null && usage.guests_used / guestLimit >= 0.8;

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, direction: 'rtl', maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>החבילה והשימוש שלי</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>כמה אורחים וסבבים נותרו בחבילה של האירוע.</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading || planLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <>
          <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: '1px solid', borderColor: 'divider', mb: 2, background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.06)}, ${alpha(theme.palette.secondary.main, 0.05)})` }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{plan?.title || 'החבילה שלך'}</Typography>
              {plan?.isPopular && <Chip size="small" color="secondary" label="הכי נבחרה" />}
            </Stack>
            {plan?.subtitle && <Typography variant="body2" color="text.secondary">{plan.subtitle}</Typography>}
          </Paper>

          <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
            <UsageBar icon={<GroupsIcon color="primary" />} label="אורחים" used={usage?.guests_used ?? 0} limit={guestLimit} theme={theme} />
            <UsageBar icon={<CampaignIcon color="primary" />} label="סבבי הודעות" used={usage?.rounds_used ?? 0} limit={roundLimit} theme={theme} />

            {nearLimit && (
              <Alert severity="warning" sx={{ mb: 2 }}>אתם מתקרבים למכסת האורחים. כדאי לשדרג כדי להוסיף עוד.</Alert>
            )}

            <Button fullWidth variant="contained" startIcon={<UpgradeIcon />} onClick={() => navigate('/')} sx={{ borderRadius: 2, py: 1.25 }}>
              שדרג חבילה
            </Button>
          </Paper>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
            התשלום הוא על אורחים וסבבים - ההודעות עצמן כלולות וללא הגבלה.
          </Typography>
        </>
      )}
    </Box>
  );
}
