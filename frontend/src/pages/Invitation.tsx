import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Divider, FormControlLabel, Grid, IconButton, InputAdornment,
  MenuItem, Paper, Snackbar, Stack, Switch, TextField, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import UploadIcon from '@mui/icons-material/Upload';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';
import { useEntitlements } from '../hooks/useEntitlements';
import InvitationView from '../components/invitation/InvitationView';
import { InvitationConfig, InvitationData, DEFAULT_INVITATION } from '../components/invitation/types';

const FONTS = [
  { value: 'serif', label: 'קלאסי (Serif)' },
  { value: 'Heebo, sans-serif', label: 'Heebo' },
  { value: 'Assistant, sans-serif', label: 'Assistant' },
  { value: 'cursive', label: 'כתב יד' },
];
const TEXTURES = [
  { value: 'linen', label: 'בד פשתן' },
  { value: 'paper', label: 'נייר' },
  { value: 'none', label: 'חלק' },
];

export default function Invitation() {
  const { selectedEvent } = useEvent();
  const eventId = selectedEvent?.id;
  const { hasFeature } = useEntitlements(selectedEvent?.planId);
  const canCustomize = hasFeature('invitation_customization');

  const [cfg, setCfg] = useState<InvitationConfig>(DEFAULT_INVITATION);
  const [eventMeta, setEventMeta] = useState<InvitationData | null>(null);
  const [slug, setSlug] = useState('');
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    fetchWithAuth(`/api/events/${eventId}`)
      .then((r) => r.json())
      .then((ev) => {
        setCfg({ ...DEFAULT_INVITATION, ...(ev.invitation || {}) });
        setSlug(ev.publicSlug || ev.public_slug || '');
        setPublished(!!(ev.invitationPublished ?? ev.invitation_published));
        setEventMeta({
          name: ev.name,
          event_date: ev.event_date,
          location: ev.location,
          inviters: ev.inviters || [],
          invitation: ev.invitation || {},
        });
      })
      .catch(() => setError('שגיאה בטעינת ההזמנה'))
      .finally(() => setLoading(false));
  }, [eventId]);

  const previewData: InvitationData = useMemo(
    () => ({ ...(eventMeta as InvitationData), invitation: cfg, slug }),
    [eventMeta, cfg, slug],
  );

  // ---- updaters ----
  const setEnvelope = (k: string, v: any) => setCfg((c) => ({ ...c, envelope: { ...c.envelope, [k]: v } }));
  const setHero = (k: string, v: any) => setCfg((c) => ({ ...c, hero: { ...c.hero, [k]: v } }));
  const setDetails = (k: string, v: any) => setCfg((c) => ({ ...c, details: { ...c.details, [k]: v } }));

  const save = async () => {
    if (!eventId) return;
    setSaving(true); setError(null);
    try {
      const r = await fetchWithAuth(`/api/events/${eventId}/invitation`, {
        method: 'PUT', body: JSON.stringify(cfg),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'שגיאה בשמירה');
      setToast('ההזמנה נשמרה');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (next: boolean) => {
    if (!eventId) return;
    setSaving(true); setError(null);
    try {
      // Save the latest design first so the public page reflects it.
      await fetchWithAuth(`/api/events/${eventId}/invitation`, { method: 'PUT', body: JSON.stringify(cfg) });
      const r = await fetchWithAuth(`/api/events/${eventId}/invitation/publish`, {
        method: 'POST', body: JSON.stringify({ published: next, slug: slug || undefined }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'שגיאה בפרסום');
      const ev = await r.json();
      setSlug(ev.publicSlug || ev.public_slug || '');
      setPublished(!!(ev.invitationPublished ?? ev.invitation_published));
      setToast(next ? 'ההזמנה פורסמה' : 'הפרסום בוטל');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File) => {
    try {
      const presign = await fetchWithAuth('/api/uploads/generate-upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content_type: file.type, folder: 'invitations' }),
      });
      if (!presign.ok) throw new Error('upload url failed');
      const { upload_url } = await presign.json();
      const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('upload failed');
      // The object URL is the presigned PUT URL without its query string.
      setHero('imageUrl', upload_url.split('?')[0]);
      setToast('התמונה הועלתה');
    } catch {
      setError('העלאת התמונה נכשלה — אפשר להדביק קישור לתמונה במקום');
    }
  };

  const publicUrl = slug ? `${window.location.origin}/i/${slug}` : '';

  if (!eventId) return <Box sx={{ p: 4 }}><Typography>בחר/י אירוע כדי לערוך הזמנה.</Typography></Box>;
  if (loading) return <Box sx={{ p: 4 }}><Typography>טוען…</Typography></Box>;

  return (
    <Box sx={{ p: { xs: 2, md: 4 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>הזמנה דיגיטלית</Typography>
          <Typography color="text.secondary">עצב/י דף הזמנה לשיתוף + אישור הגעה אונליין</Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button variant="outlined" onClick={save} disabled={saving}>שמירה</Button>
          <Button variant="contained" onClick={() => togglePublish(!published)} disabled={saving}>
            {published ? 'ביטול פרסום' : 'פרסום'}
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {published && publicUrl && (
        <Alert severity="success" sx={{ mb: 3 }}
          action={
            <Stack direction="row">
              <IconButton size="small" onClick={() => { navigator.clipboard.writeText(publicUrl); setToast('הקישור הועתק'); }}><ContentCopyIcon fontSize="small" /></IconButton>
              <IconButton size="small" href={publicUrl} target="_blank"><OpenInNewIcon fontSize="small" /></IconButton>
            </Stack>
          }>
          ההזמנה פורסמה: <strong>{publicUrl}</strong>
        </Alert>
      )}

      <Grid container spacing={4}>
        {/* Editor controls */}
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>קישור ציבורי</Typography>
                <TextField fullWidth size="small" label="כתובת (slug)" value={slug}
                  onChange={(e) => setSlug(e.target.value)} placeholder="matan-and-ido"
                  helperText="ישמש בכתובת /i/<slug>" />
              </Box>

              <Divider />
              <Typography variant="subtitle1" fontWeight={700}>המעטפה</Typography>
              <Stack direction="row" spacing={2}>
                <TextField label="צבע" type="color" value={cfg.envelope?.color || '#f5efe6'}
                  onChange={(e) => setEnvelope('color', e.target.value)} sx={{ width: 90 }} size="small"
                  InputLabelProps={{ shrink: true }} />
                <TextField select label="מרקם" value={cfg.envelope?.texture || 'linen'}
                  onChange={(e) => setEnvelope('texture', e.target.value)} fullWidth size="small" disabled={!canCustomize}>
                  {TEXTURES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </TextField>
              </Stack>
              <TextField label="טקסט על המעטפה" value={cfg.envelope?.envelopeText || ''}
                onChange={(e) => setEnvelope('envelopeText', e.target.value)} fullWidth size="small" />
              <TextField label="טקסט בתוך הבול" value={cfg.envelope?.stampText || ''}
                onChange={(e) => setEnvelope('stampText', e.target.value)} fullWidth size="small" />

              <Divider />
              <Typography variant="subtitle1" fontWeight={700}>תמונה וכותרת</Typography>
              <TextField label="קישור לתמונה" value={cfg.hero?.imageUrl || ''}
                onChange={(e) => setHero('imageUrl', e.target.value)} fullWidth size="small"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton component="label" size="small">
                        <UploadIcon fontSize="small" />
                        <input hidden type="file" accept="image/*"
                          onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
                      </IconButton>
                    </InputAdornment>
                  ),
                }} />
              <TextField label="כותרת גדולה" value={cfg.hero?.bigText || ''}
                onChange={(e) => setHero('bigText', e.target.value)} fullWidth size="small" />

              <Divider />
              <Typography variant="subtitle1" fontWeight={700}>טקסט אישי</Typography>
              <TextField label="ברכה / טקסט אישי" value={cfg.personalText || ''}
                onChange={(e) => setCfg((c) => ({ ...c, personalText: e.target.value }))}
                fullWidth multiline minRows={3} size="small" />

              <Divider />
              <Typography variant="subtitle1" fontWeight={700}>גופן ופרטים</Typography>
              <TextField select label="גופן" value={cfg.fontFamily || 'serif'}
                onChange={(e) => setCfg((c) => ({ ...c, fontFamily: e.target.value }))} fullWidth size="small" disabled={!canCustomize}>
                {FONTS.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
              </TextField>
              <FormControlLabel control={<Switch checked={cfg.details?.showDate !== false} onChange={(e) => setDetails('showDate', e.target.checked)} />} label="הצג תאריך" />
              <FormControlLabel control={<Switch checked={cfg.details?.showTime !== false} onChange={(e) => setDetails('showTime', e.target.checked)} />} label="הצג שעה" />
              <FormControlLabel control={<Switch checked={cfg.details?.showLocation !== false} onChange={(e) => setDetails('showLocation', e.target.checked)} />} label="הצג מיקום" />
              <FormControlLabel control={<Switch checked={cfg.rsvpEnabled !== false} onChange={(e) => setCfg((c) => ({ ...c, rsvpEnabled: e.target.checked }))} />} label="אפשר אישור הגעה" />

              {!canCustomize && (
                <Alert severity="info">חלק מאפשרויות העיצוב (מרקם, גופנים) זמינות בחבילות בתשלום.</Alert>
              )}
            </Stack>
          </Paper>
        </Grid>

        {/* Live preview */}
        <Grid item xs={12} md={7}>
          <Typography variant="overline" color="text.secondary">תצוגה מקדימה</Typography>
          <Paper variant="outlined" sx={{ overflow: 'hidden', bgcolor: '#faf7f2', mt: 1 }}>
            {eventMeta && <InvitationView data={previewData} forceOpen rsvpSlot={<PreviewRsvpStub />} />}
          </Paper>
        </Grid>
      </Grid>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast || ''} />
    </Box>
  );
}

function PreviewRsvpStub() {
  return (
    <Box sx={{ p: 2, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.85)', textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
      <Typography variant="subtitle1">טופס אישור הגעה</Typography>
      <Typography variant="caption" color="text.secondary">(יוצג למוזמנים בדף הציבורי)</Typography>
    </Box>
  );
}
