import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface QueueInfo {
  messages: number;
  consumers: number;
  messages_unacknowledged: number;
}

interface HealthData {
  queues: { [name: string]: QueueInfo } | { error: string };
  messaging: { sent_total: number | null; sent_24h: number | null };
}

function isQueuesError(
  q: HealthData['queues']
): q is { error: string } {
  return q != null && typeof (q as { error?: unknown }).error === 'string';
}

function Monitoring() {
  const theme = useTheme();

  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/health');
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת נתוני ניטור');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const formatValue = (v: number | null): string =>
    v == null ? '-' : v.toLocaleString('he-IL');

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          ניטור מערכת
        </Typography>
        <IconButton onClick={fetchHealth} disabled={loading} aria-label="רענן">
          <RefreshIcon />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : data ? (
        <>
          {/* Queues */}
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            תורים
          </Typography>
          {isQueuesError(data.queues) ? (
            <Alert severity="warning" sx={{ mb: 3 }}>
              {data.queues.error}
            </Alert>
          ) : (
            <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2, mb: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    <TableCell sx={{ fontWeight: 700 }}>תור</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>הודעות</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>ממתינות</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>צרכנים</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(data.queues).map(([name, info]) => (
                    <TableRow key={name} hover>
                      <TableCell>{name}</TableCell>
                      <TableCell>{info.messages}</TableCell>
                      <TableCell>{info.messages_unacknowledged}</TableCell>
                      <TableCell>{info.consumers}</TableCell>
                    </TableRow>
                  ))}
                  {Object.keys(data.queues).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">אין תורים</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Messaging */}
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            הודעות
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 2,
            }}
          >
            <Paper
              elevation={0}
              sx={{
                p: 2.5,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.05),
              }}
            >
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {formatValue(data.messaging.sent_total)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                סה"כ נשלחו
              </Typography>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                p: 2.5,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.05),
              }}
            >
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {formatValue(data.messaging.sent_24h)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                נשלחו ב-24 שעות
              </Typography>
            </Paper>
          </Box>

          {/* Delivery planner */}
          <PlannerPanel />
        </>
      ) : null}
    </Box>
  );
}

interface PlannerData {
  configured: boolean;
  last_run: {
    ran_at: string | null;
    strategy: string;
    total_planned: number;
    total_moved: number;
    total_unplaced: number;
    delayed_campaigns: number;
    estimated_completion: string | null;
    metrics: {
      safety_margin_percent?: number;
      channels?: Record<string, {
        capacity_per_day: number;
        reserved_per_day: number;
        raw_daily_capacity: number;
        planned_total: number;
        heatmap?: Record<string, { planned: number; capacity: number; utilization_percent: number }>;
      }>;
    } | null;
  } | null;
  queue: Record<string, { releases: number; messages: number }>;
  pending_messages: number;
  in_flight_messages: number;
}

function PlannerPanel() {
  const theme = useTheme();
  const [p, setP] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth('/api/admin/planner')
      .then((r) => (r.ok ? r.json() : null))
      .then(setP)
      .catch(() => setP(null))
      .finally(() => setLoading(false));
  }, []);

  const stat = (value: string | number, label: string, tint = theme.palette.primary.main) => (
    <Paper elevation={0} sx={{ p: 2.5, borderRadius: 2, bgcolor: alpha(tint, 0.05) }}>
      <Typography variant="h4" sx={{ fontWeight: 700 }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Paper>
  );

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
        מתזמן שליחה גלובלי
      </Typography>
      {loading ? (
        <CircularProgress size={22} />
      ) : !p || !p.configured || !p.last_run ? (
        <Alert severity="info">המתזמן עדיין לא הריץ מחזור תכנון (אין נתונים).</Alert>
      ) : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 2, mb: 2 }}>
            {stat(p.last_run.total_planned.toLocaleString('he-IL'), 'הודעות מתוכננות')}
            {stat(p.last_run.total_moved.toLocaleString('he-IL'), 'הוזזו מהיום המבוקש', theme.palette.warning.main)}
            {stat(p.last_run.total_unplaced.toLocaleString('he-IL'), 'ללא שיבוץ (חריגה)', theme.palette.error.main)}
            {stat(p.last_run.delayed_campaigns.toLocaleString('he-IL'), 'קמפיינים שנדחו', theme.palette.warning.main)}
            {stat(p.pending_messages.toLocaleString('he-IL'), 'ממתינות בתור')}
            {stat(p.last_run.estimated_completion || '-', 'סיום משוער')}
          </Box>

          {/* Per-channel capacity + upcoming heatmap */}
          {Object.entries(p.last_run.metrics?.channels || {}).map(([channel, ch]) => {
            const days = Object.entries(ch.heatmap || {}).sort(([a], [b]) => a.localeCompare(b)).slice(0, 14);
            return (
              <Paper key={channel} elevation={0} sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  {channel} · קיבולת {ch.capacity_per_day.toLocaleString('he-IL')}/יום
                  {' · '}שמורה {ch.reserved_per_day.toLocaleString('he-IL')}
                  {p.last_run?.metrics?.safety_margin_percent != null && ` (${p.last_run.metrics.safety_margin_percent}%)`}
                </Typography>
                {days.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">אין ימים מתוכננים</Typography>
                ) : (
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    {days.map(([day, cell]) => {
                      const pct = Math.min(100, cell.utilization_percent);
                      const over = pct >= 95;
                      return (
                        <Box key={day} sx={{ width: 34, textAlign: 'center' }}>
                          <Box
                            title={`${day}: ${cell.planned}/${cell.capacity} (${cell.utilization_percent}%)`}
                            sx={{
                              height: 56, borderRadius: 1, display: 'flex', alignItems: 'flex-end',
                              bgcolor: alpha(theme.palette.text.primary, 0.06), overflow: 'hidden',
                            }}
                          >
                            <Box sx={{
                              width: '100%', height: `${Math.max(4, pct)}%`,
                              bgcolor: over ? theme.palette.error.main : theme.palette.primary.main,
                            }} />
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>
                            {day.slice(5)}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Paper>
            );
          })}
          <Typography variant="caption" color="text.secondary">
            אסטרטגיה: {p.last_run.strategy} · עודכן {p.last_run.ran_at ? new Date(p.last_run.ran_at).toLocaleString('he-IL') : '-'}
          </Typography>
        </>
      )}
    </Box>
  );
}

export default Monitoring;
