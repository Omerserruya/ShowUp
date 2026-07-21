import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Stack, Button, TextField, MenuItem, Select,
  FormControl, InputLabel, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, Chip, IconButton, Tooltip,
  CircularProgress, Alert, Snackbar, Divider, alpha, useTheme,
} from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { plans, getPlan } from '../../config/plans';

interface EntitlementRow {
  id: string;
  status: string;
  source: string;
  plan_id: string;
  max_guests: number | null;
  campaign_rounds: number | null;
  code: string;
  redemption_link: string;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  redeemed_by_name: string | null;
  redeemed_event_id: string | null;
  created_at: string;
}

const SOURCES = [
  { value: 'beta', label: 'בטא' },
  { value: 'admin', label: 'אדמין' },
  { value: 'promotion', label: 'מבצע' },
  { value: 'partner', label: 'שותף' },
];

const STATUSES = [
  { value: 'available', label: 'זמין' },
  { value: 'redeemed', label: 'מומש' },
  { value: 'expired', label: 'פג תוקף' },
  { value: 'cancelled', label: 'בוטל' },
];

const sourceLabel = (s: string) => SOURCES.find((x) => x.value === s)?.label || s;
const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label || s;
const statusColor = (s: string): 'success' | 'default' | 'warning' | 'error' => {
  if (s === 'available') return 'success';
  if (s === 'redeemed') return 'default';
  if (s === 'expired') return 'warning';
  return 'error';
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
};

export default function Entitlements() {
  const theme = useTheme();

  const [items, setItems] = useState<EntitlementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Create form
  const [cSource, setCSource] = useState('beta');
  const [cPlan, setCPlan] = useState<string>(plans[0]?.id || 'basic');
  const [cCount, setCCount] = useState('1');
  const [cMaxGuests, setCMaxGuests] = useState('');
  const [cRounds, setCRounds] = useState('');
  const [cExpires, setCExpires] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ code: string; redemption_link: string }[]>([]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(rowsPerPage),
      });
      if (statusFilter) params.set('status', statusFilter);
      if (sourceFilter) params.set('source', sourceFilter);
      const res = await fetchWithAuth(`/api/admin/entitlements?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת ההזמנות');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, statusFilter, sourceFilter]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setToast('הקישור הועתק');
    } catch {
      setToast('העתקה נכשלה');
    }
  };

  const createEntitlements = async () => {
    const count = parseInt(cCount, 10);
    if (!count || count < 1 || count > 500) {
      setCreateError('כמות חייבת להיות בין 1 ל-500');
      return;
    }
    setCreating(true);
    setCreateError(null);
    setGenerated([]);
    try {
      const body: Record<string, unknown> = { source: cSource, plan_id: cPlan, count };
      if (cMaxGuests.trim()) body.max_guests = parseInt(cMaxGuests, 10);
      if (cRounds.trim()) body.campaign_rounds = parseInt(cRounds, 10);
      if (cExpires) body.expires_at = new Date(cExpires).toISOString();

      const res = await fetchWithAuth('/api/admin/entitlements', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setGenerated(data.entitlements || []);
      setToast(`נוצרו ${data.count ?? (data.entitlements || []).length} הזמנות`);
      setPage(0);
      fetchList();
    } catch (e: any) {
      setCreateError(e?.message || 'יצירת ההזמנות נכשלה');
    } finally {
      setCreating(false);
    }
  };

  const rowAction = async (id: string, action: 'expire' | 'cancel') => {
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/entitlements/${id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      fetchList();
    } catch (e: any) {
      setError(e?.message || 'הפעולה נכשלה');
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        הזמנות למימוש
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        יצירת קישורי מימוש שמעניקים אירוע במתנה. כל קישור מייצר אירוע יחיד בעת המימוש.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>
      )}

      {/* Create form */}
      <Paper elevation={0} variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3, mb: 3 }}>
        <Typography sx={{ fontWeight: 700, mb: 2 }}>יצירת הזמנות חדשות</Typography>
        {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }} alignItems="flex-start">
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>מקור</InputLabel>
            <Select label="מקור" value={cSource} onChange={(e) => setCSource(e.target.value)}>
              {SOURCES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>חבילה</InputLabel>
            <Select label="חבילה" value={cPlan} onChange={(e) => setCPlan(e.target.value)}>
              {plans.map((p) => <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="כמות" type="number" value={cCount}
            onChange={(e) => setCCount(e.target.value)} sx={{ width: 100 }}
            inputProps={{ min: 1, max: 500 }} />
          <TextField size="small" label="מקס' אורחים" type="number" value={cMaxGuests}
            onChange={(e) => setCMaxGuests(e.target.value)} sx={{ width: 130 }} placeholder="ברירת מחדל" />
          <TextField size="small" label="סבבי הודעות" type="number" value={cRounds}
            onChange={(e) => setCRounds(e.target.value)} sx={{ width: 130 }} placeholder="ברירת מחדל" />
          <TextField size="small" label="תפוגה" type="date" value={cExpires}
            onChange={(e) => setCExpires(e.target.value)} sx={{ width: 170 }} InputLabelProps={{ shrink: true }} />
          <Button
            variant="contained" disableElevation onClick={createEntitlements} disabled={creating}
            startIcon={!creating ? <AddRoundedIcon /> : undefined}
            sx={{ borderRadius: 2, fontWeight: 700, minWidth: 120 }}
          >
            {creating ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'יצירה'}
          </Button>
        </Stack>

        {generated.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              הקישורים שנוצרו ({generated.length}) - העתיקו והפיצו:
            </Typography>
            <Stack spacing={0.75}>
              {generated.map((g) => (
                <Stack key={g.code} direction="row" spacing={1} alignItems="center"
                  sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05), borderRadius: 2, px: 1.5, py: 0.75 }}>
                  <Typography dir="ltr" sx={{ flex: 1, fontFamily: 'monospace', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                    {g.redemption_link}
                  </Typography>
                  <Tooltip title="העתקת קישור">
                    <IconButton size="small" onClick={() => copyLink(g.redemption_link)}>
                      <ContentCopyRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </Paper>

      {/* Filters */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>סטטוס</InputLabel>
          <Select label="סטטוס" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
            <MenuItem value=""><em>הכל</em></MenuItem>
            {STATUSES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>מקור</InputLabel>
          <Select label="מקור" value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}>
            <MenuItem value=""><em>הכל</em></MenuItem>
            {SOURCES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>

      <TableContainer component={Paper} elevation={0} variant="outlined" sx={{ borderRadius: 3 }}>
        {loading && items.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell sx={{ fontWeight: 700 }}>סטטוס</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>מקור</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>חבילה</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>אורחים</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>סבבים</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>מומש ע"י</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>נוצר</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="left">פעולות</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id} hover>
                    <TableCell>
                      <Chip size="small" label={statusLabel(it.status)} color={statusColor(it.status)}
                        variant={it.status === 'available' ? 'filled' : 'outlined'} />
                    </TableCell>
                    <TableCell>{sourceLabel(it.source)}</TableCell>
                    <TableCell>{getPlan(it.plan_id)?.title || it.plan_id}</TableCell>
                    <TableCell>{it.max_guests == null ? 'ללא הגבלה' : it.max_guests}</TableCell>
                    <TableCell>{it.campaign_rounds ?? '-'}</TableCell>
                    <TableCell>
                      {it.redeemed_by_name || it.redeemed_by_user_id ? (
                        <Stack spacing={0.25}>
                          <Typography variant="body2">{it.redeemed_by_name || it.redeemed_by_user_id}</Typography>
                          <Typography variant="caption" color="text.secondary">{fmtDate(it.redeemed_at)}</Typography>
                          {it.redeemed_event_id && (
                            <Button size="small" endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
                              href={`/admin/events?event=${it.redeemed_event_id}`} target="_blank" rel="noreferrer"
                              sx={{ justifyContent: 'flex-start', px: 0, minWidth: 0, fontWeight: 600 }}>
                              לאירוע
                            </Button>
                          )}
                        </Stack>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{fmtDate(it.created_at)}</TableCell>
                    <TableCell align="left">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="העתקת קישור">
                          <IconButton size="small" onClick={() => copyLink(it.redemption_link)}>
                            <ContentCopyRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {it.status === 'available' && (
                          <>
                            <Tooltip title="סימון כפג תוקף">
                              <IconButton size="small" color="warning" onClick={() => rowAction(it.id, 'expire')}>
                                <ScheduleRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="ביטול">
                              <IconButton size="small" color="error" onClick={() => rowAction(it.id, 'cancel')}>
                                <BlockRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">לא נמצאו הזמנות</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10, 25, 50, 100]}
              onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
              labelRowsPerPage="שורות בעמוד:"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} מתוך ${count}`}
            />
          </>
        )}
      </TableContainer>

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={toast || ''}
      />
    </Box>
  );
}
