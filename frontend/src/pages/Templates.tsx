import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  alpha,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DescriptionIcon from '@mui/icons-material/Description';
import SendIcon from '@mui/icons-material/Send';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Toast from '../components/Toast';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';

interface Template {
  id: string;
  account_id?: string | null;
  event_id?: string | null;
  name: string;
  language: string;
  category?: string | null;
  body: string;
  allowed_vars?: string[] | null;
  lifecycle: string;
  meta_template_id?: string | null;
  rejection_reason?: string | null;
}

// Plain-language status — users should never see "meta_pending" or "HSM".
const STATUS_META: Record<string, { label: string; color: 'default' | 'info' | 'warning' | 'success' }> = {
  draft: { label: 'טיוטה', color: 'default' },
  validated: { label: 'מוכן לשליחה לאישור', color: 'info' },
  meta_pending: { label: 'ממתין לאישור WhatsApp', color: 'warning' },
  approved: { label: 'מאושר', color: 'success' },
  active: { label: 'פעיל', color: 'success' },
  archived: { label: 'בארכיון', color: 'default' },
};

// Variables the user can drop into a template body.
const VARS = [
  { key: 'שם', label: 'שם האורח' },
  { key: 'שם_מזמין', label: 'שם המזמין' },
  { key: 'סוג_אירוע', label: 'סוג האירוע' },
  { key: 'תאריך', label: 'תאריך' },
  { key: 'שעה', label: 'שעה' },
  { key: 'מיקום', label: 'מיקום' },
  { key: 'שם_אירוע', label: 'שם האירוע' },
];

export default function Templates() {
  const theme = useTheme();
  const { selectedEvent } = useEvent();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });
  const showToast = (message: string, severity: 'success' | 'error' | 'info' = 'info') => setToast({ open: true, message, severity });

  const loadTemplates = useCallback(async () => {
    if (!selectedEvent?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithAuth(`/api/events/${selectedEvent.id}/templates`);
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setTemplates((data as Template[]).filter((t) => t.lifecycle !== 'deleted'));
    } catch (e) {
      setError('שגיאה בטעינת התבניות');
    } finally {
      setLoading(false);
    }
  }, [selectedEvent?.id]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleCreate = async () => {
    if (!selectedEvent?.id || !newName.trim() || !newBody.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/events/${selectedEvent.id}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), body: newBody.trim(), language: 'he' }),
      });
      if (!res.ok) throw new Error('failed');
      setCreateOpen(false);
      setNewName('');
      setNewBody('');
      showToast('התבנית נוצרה כטיוטה', 'success');
      loadTemplates();
    } catch (e) {
      showToast('שגיאה ביצירת התבנית', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Move a draft all the way to "waiting for WhatsApp approval" in one click.
  const handleSubmitForApproval = async (t: Template) => {
    setBusyId(t.id);
    try {
      if (t.lifecycle === 'draft') {
        const v = await fetchWithAuth(`/api/templates/${t.id}/validate`, { method: 'POST' });
        if (!v.ok) {
          const err = await v.json().catch(() => ({}));
          throw new Error(err.detail || 'validate failed');
        }
      }
      const res = await fetchWithAuth(`/api/templates/${t.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'meta_pending' }),
      });
      if (!res.ok) throw new Error('transition failed');
      showToast('התבנית נשלחה לאישור WhatsApp', 'success');
      loadTemplates();
    } catch (e: any) {
      showToast(typeof e?.message === 'string' && e.message.includes('{{') ? `יש משתנה לא מוכר בתבנית` : 'שגיאה בשליחה לאישור', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleActivate = async (t: Template) => {
    setBusyId(t.id);
    try {
      const res = await fetchWithAuth(`/api/templates/${t.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'active' }),
      });
      if (!res.ok) throw new Error('failed');
      showToast('התבנית הופעלה', 'success');
      loadTemplates();
    } catch (e) {
      showToast('שגיאה בהפעלת התבנית', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleClone = async (t: Template) => {
    if (!selectedEvent?.id) return;
    setBusyId(t.id);
    try {
      const res = await fetchWithAuth(`/api/events/${selectedEvent.id}/templates/${t.id}/clone`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      showToast('התבנית שוכפלה לאירוע שלך', 'success');
      loadTemplates();
    } catch (e) {
      showToast('שגיאה בשכפול התבנית', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (!selectedEvent) {
    return (
      <Box sx={{ p: 4, direction: 'rtl', textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">אנא בחר אירוע כדי לנהל תבניות</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, direction: 'rtl' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>תבניות הודעה</Typography>
          <Typography variant="body2" color="text.secondary">
            ההודעות שנשלחות לאורחים. WhatsApp מאשרת כל תבנית לפני שאפשר לשלוח אותה — בדרך כלל עד 24 שעות.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} sx={{ borderRadius: 2 }}>
          תבנית חדשה
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : templates.length === 0 ? (
        <Paper elevation={0} sx={{ mt: 3, p: 6, textAlign: 'center', borderRadius: 3, border: '1px dashed', borderColor: 'divider', background: alpha(theme.palette.primary.main, 0.03) }}>
          <DescriptionIcon sx={{ fontSize: 56, color: 'primary.main', opacity: 0.6 }} />
          <Typography variant="h6" sx={{ mt: 2, fontWeight: 600 }}>עדיין אין תבניות</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            צרו את ההזמנה הראשונה שלכם — אנחנו נדאג שהיא תאושר ל-WhatsApp 🎉
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} sx={{ borderRadius: 2 }}>
            צור תבנית ראשונה
          </Button>
        </Paper>
      ) : (
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {templates.map((t) => {
            const status = STATUS_META[t.lifecycle] || { label: t.lifecycle, color: 'default' as const };
            const isGlobal = !t.event_id;
            return (
              <Grid item xs={12} sm={6} md={4} key={t.id}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 2.5, height: '100%', borderRadius: 3, border: '1px solid', borderColor: 'divider',
                    display: 'flex', flexDirection: 'column', transition: 'box-shadow .2s, transform .2s',
                    '&:hover': { boxShadow: theme.shadows[3], transform: 'translateY(-2px)' },
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t.name}</Typography>
                    <Chip size="small" label={status.label} color={status.color} variant={status.color === 'default' ? 'outlined' : 'filled'} />
                  </Box>
                  {isGlobal && <Chip size="small" label="תבנית מערכת" variant="outlined" sx={{ alignSelf: 'flex-start', mb: 1 }} />}
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ whiteSpace: 'pre-wrap', flexGrow: 1, mb: 1.5, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {t.body}
                  </Typography>

                  {t.rejection_reason && (
                    <Alert severity="error" sx={{ mb: 1.5, py: 0 }} icon={<InfoOutlinedIcon fontSize="inherit" />}>
                      WhatsApp דחתה: {t.rejection_reason}
                    </Alert>
                  )}

                  <Stack direction="row" spacing={1} sx={{ mt: 'auto' }}>
                    {isGlobal ? (
                      <Button size="small" startIcon={<ContentCopyIcon />} disabled={busyId === t.id} onClick={() => handleClone(t)}>
                        שכפל לאירוע
                      </Button>
                    ) : (
                      <>
                        {(t.lifecycle === 'draft' || t.lifecycle === 'validated') && (
                          <Button size="small" variant="contained" startIcon={busyId === t.id ? <CircularProgress size={14} /> : <SendIcon />} disabled={busyId === t.id} onClick={() => handleSubmitForApproval(t)}>
                            שלח לאישור
                          </Button>
                        )}
                        {t.lifecycle === 'approved' && (
                          <Button size="small" variant="contained" color="success" startIcon={<PlayArrowIcon />} disabled={busyId === t.id} onClick={() => handleActivate(t)}>
                            הפעל
                          </Button>
                        )}
                        {t.lifecycle === 'meta_pending' && (
                          <Tooltip title="WhatsApp בודקת את ההודעה">
                            <span><Button size="small" disabled>בבדיקה…</Button></span>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </Stack>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>תבנית הודעה חדשה</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="שם התבנית" value={newName} onChange={(e) => setNewName(e.target.value)} fullWidth placeholder="לדוגמה: הזמנה לחתונה" />
            <TextField label="תוכן ההודעה" value={newBody} onChange={(e) => setNewBody(e.target.value)} fullWidth multiline minRows={5} placeholder={'שלום {{שם}}, הוזמנת לאירוע של {{שם_מזמין}} בתאריך {{תאריך}} 🎉'} />
            <Box>
              <Typography variant="caption" color="text.secondary">לחצו כדי להוסיף משתנה אישי:</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {VARS.map((v) => (
                  <Chip key={v.key} size="small" label={v.label} onClick={() => setNewBody((b) => `${b}{{${v.key}}}`)} sx={{ cursor: 'pointer' }} />
                ))}
              </Box>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>ביטול</Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving || !newName.trim() || !newBody.trim()} startIcon={saving ? <CircularProgress size={16} /> : undefined}>
            צור טיוטה
          </Button>
        </DialogActions>
      </Dialog>

      <Toast open={toast.open} message={toast.message} severity={toast.severity} onClose={() => setToast((p) => ({ ...p, open: false }))} />
    </Box>
  );
}
