import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface SystemStats {
  venues: { total: number; suspended: number; active: number };
  events: { total: number; active: number; published: number };
  guests: { total: number };
  campaigns: { total: number };
}

interface UserStats {
  users: { total: number; admins: number; suspended: number; verified: number };
  subscriptions: { paid: number; by_status: { [status: string]: number } };
}

interface Tile {
  label: string;
  value: number;
}

function SystemDashboard() {
  const theme = useTheme();

  const [stats, setStats] = useState<SystemStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    let anySuccess = false;
    const errors: string[] = [];

    const [statsRes, userStatsRes] = await Promise.allSettled([
      fetchWithAuth('/api/admin/stats'),
      fetchWithAuth('/api/admin/user-stats'),
    ]);

    if (statsRes.status === 'fulfilled') {
      try {
        if (!statsRes.value.ok) throw new Error(await statsRes.value.text());
        setStats(await statsRes.value.json());
        anySuccess = true;
      } catch (e: any) {
        errors.push(e?.message || 'שגיאה בטעינת נתוני מערכת');
      }
    } else {
      errors.push('שגיאה בטעינת נתוני מערכת');
    }

    if (userStatsRes.status === 'fulfilled') {
      try {
        if (!userStatsRes.value.ok) throw new Error(await userStatsRes.value.text());
        setUserStats(await userStatsRes.value.json());
        anySuccess = true;
      } catch (e: any) {
        errors.push(e?.message || 'שגיאה בטעינת נתוני משתמשים');
      }
    } else {
      errors.push('שגיאה בטעינת נתוני משתמשים');
    }

    if (!anySuccess) {
      setError(errors.join(' | ') || 'שגיאה בטעינת נתונים');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const tiles: Tile[] = [];
  if (stats) {
    tiles.push(
      { label: 'אולמות פעילים', value: stats.venues.active },
      { label: 'אולמות מושהים', value: stats.venues.suspended },
      { label: 'סה"כ אירועים', value: stats.events.total },
      { label: 'אירועים פעילים', value: stats.events.active },
      { label: 'הזמנות שפורסמו', value: stats.events.published },
      { label: 'סה"כ אורחים', value: stats.guests.total },
      { label: 'קמפיינים', value: stats.campaigns.total },
    );
  }
  if (userStats) {
    tiles.push(
      { label: 'סה"כ משתמשים', value: userStats.users.total },
      { label: 'מנהלים', value: userStats.users.admins },
      { label: 'משתמשים מאומתים', value: userStats.users.verified },
      { label: 'מנויים בתשלום', value: userStats.subscriptions.paid },
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        לוח בקרה מערכת
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 2,
          }}
        >
          {tiles.map((tile) => (
            <Paper
              key={tile.label}
              elevation={0}
              sx={{
                p: 2.5,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.05),
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
              }}
            >
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {tile.value.toLocaleString('he-IL')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tile.label}
              </Typography>
            </Paper>
          ))}
          {tiles.length === 0 && (
            <Typography color="text.secondary">אין נתונים להצגה</Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

export default SystemDashboard;
