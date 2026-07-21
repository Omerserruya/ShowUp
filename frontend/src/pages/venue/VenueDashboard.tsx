import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Button, Chip, Card, CardContent, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Select, FormControl, InputLabel,
  CircularProgress, Alert, Divider, Tooltip, alpha, useTheme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { useVenueAdmin, VenueSummary } from '../../hooks/useVenueAdmin';
import { useCatalog } from '../../hooks/useCatalog';
import VenueEntitlements from '../../components/venue/VenueEntitlements';
import { eventTypeLabel } from '../../config/messaging';

const BRAND = '#888cee';

interface VenueEvent {
  id: string;
  name: string;
  event_type: string | null;
  event_date: string | null;
  plan_id: string | null;
  public_slug: string | null;
  invitation_published: boolean;
  owner_name: string | null;
  owner_phone: string | null;
  total_guests: number;
  confirmed_guests: number;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '-';
  }
};

export default function VenueDashboard() {
  const { catalog } = useCatalog();
  const theme = useTheme();
  const { venues, loading: venuesLoading } = useVenueAdmin();
  const [venueId, setVenueId] = useState<string | null>(null);
  const [events, setEvents] = useState<VenueEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Default to the first venue once loaded.
  useEffect(() => {
    if (!venueId && venues.length) setVenueId(venues[0].id);
  }, [venues, venueId]);

  const venue: VenueSummary | undefined = useMemo(
    () => venues.find((v) => v.id === venueId),
    [venues, venueId],
  );

  const loadEvents = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}/events`);
      if (!r.ok) throw new Error('failed');
      setEvents(await r.json());
    } catch {
      setError('לא הצלחנו לטעון את האירועים של האולם.');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const capacityText = () => {
    if (!venue) return '';
    if (venue.event_capacity == null) return `${venue.events_used} אירועים החודש · ללא הגבלה`;
    return `${venue.events_used} מתוך ${venue.event_capacity} אירועים החודש`;
  };
  const isFull = !!venue && venue.event_capacity != null && venue.events_used >= venue.event_capacity;

  // Summary rollups across the venue's events (client-side aggregate).
  const totalGuests = useMemo(() => events.reduce((s, e) => s + (e.total_guests || 0), 0), [events]);
  const confirmedGuests = useMemo(() => events.reduce((s, e) => s + (e.confirmed_guests || 0), 0), [events]);
  const summaryTiles = [
    { label: 'החודש', value: venue?.event_capacity == null ? `${venue?.events_used ?? 0}` : `${venue?.events_used ?? 0}/${venue?.event_capacity}` },
    { label: 'סה״כ אירועים', value: venue?.events_used_total ?? events.length },
    { label: 'סה״כ אורחים', value: totalGuests },
    { label: 'אישרו הגעה', value: confirmedGuests },
  ];

  if (venuesLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress sx={{ color: BRAND }} />
      </Box>
    );
  }

  return (
    <Box dir="rtl">
      {/* Header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 44, height: 44, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(BRAND, 0.12), color: BRAND }}>
            <StorefrontRoundedIcon />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>
              {venue?.name || 'ניהול האולם'}
            </Typography>
            <Typography variant="body2" color="text.secondary">{capacityText()}</Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center">
          {venues.length > 1 && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>אולם</InputLabel>
              <Select label="אולם" value={venueId || ''} onChange={(e) => setVenueId(e.target.value)}>
                {venues.map((v) => (
                  <MenuItem key={v.id} value={v.id}>{v.name || 'אולם'}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Tooltip title={isFull ? 'מכסת האירועים מלאה' : ''}>
            <span>
              <Button
                variant="contained" disableElevation startIcon={<AddRoundedIcon />}
                onClick={() => setCreateOpen(true)} disabled={isFull}
                sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#6f74e0' } }}
              >
                אירוע חדש
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Summary tiles */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5, mb: 3 }}>
        {summaryTiles.map((t) => (
          <Card key={t.label} variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent sx={{ py: 1.5 }}>
              <Typography sx={{ fontSize: 22, fontWeight: 800, color: BRAND, lineHeight: 1.1 }}>{t.value}</Typography>
              <Typography variant="caption" color="text.secondary">{t.label}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {isFull && (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
          מכסת האירועים החודשית של האולם מלאה. פנו ל-ShowUp כדי להגדיל את המכסה.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

      {/* Events */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress sx={{ color: BRAND }} /></Box>
      ) : events.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 3, textAlign: 'center', py: 6, borderStyle: 'dashed' }}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>עוד אין אירועים</Typography>
          <Typography variant="body2" color="text.secondary">צרו את האירוע הראשון של האולם ושלחו לבעלי האירוע גישה בוואטסאפ.</Typography>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {events.map((ev) => (
            <Card key={ev.id} variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent sx={{ py: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 16 }} noWrap>{ev.name}</Typography>
                      <Chip size="small" label={eventTypeLabel(catalog, ev.event_type || '')} sx={{ bgcolor: alpha(BRAND, 0.1), color: '#6f74e0', fontWeight: 700 }} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {fmtDate(ev.event_date)}
                      {ev.owner_name ? ` · ${ev.owner_name}` : ''}
                      {ev.owner_phone ? ` · ${ev.owner_phone}` : ''}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={2} alignItems="center">
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1 }}>
                        {ev.confirmed_guests}<Typography component="span" variant="caption" color="text.secondary"> / {ev.total_guests}</Typography>
                      </Typography>
                      <Typography variant="caption" color="text.secondary">אישרו</Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem />
                    <Chip
                      size="small"
                      label={ev.invitation_published ? 'ההזמנה פורסמה' : 'טיוטה'}
                      color={ev.invitation_published ? 'success' : 'default'}
                      variant={ev.invitation_published ? 'filled' : 'outlined'}
                    />
                    {ev.invitation_published && ev.public_slug && (
                      <Tooltip title="פתחו את ההזמנה">
                        <Button
                          size="small" endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 16 }} />}
                          href={`/i/${ev.public_slug}`} target="_blank" rel="noreferrer"
                          sx={{ fontWeight: 700, color: BRAND }}
                        >
                          הזמנה
                        </Button>
                      </Tooltip>
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Redemption-link pool for this venue */}
      {venueId && <VenueEntitlements venueId={venueId} />}

      {venueId && (
        <CreateEventDialog
          open={createOpen}
          venueId={venueId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); loadEvents(); }}
        />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------

function CreateEventDialog({
  open, venueId, onClose, onCreated,
}: { open: boolean; venueId: string; onClose: () => void; onCreated: () => void }) {
  const { catalog } = useCatalog();
  const [form, setForm] = useState({
    event_type: 'wedding', name: '', event_date: '',
    owner_first_name: '', owner_last_name: '', owner_phone: '', owner_email: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const canSubmit = form.name.trim() && form.owner_first_name.trim() && form.owner_phone.trim();

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: form.event_type,
          name: form.name.trim(),
          event_date: form.event_date ? new Date(form.event_date).toISOString() : null,
          owner_first_name: form.owner_first_name.trim(),
          owner_last_name: form.owner_last_name.trim(),
          owner_phone: form.owner_phone.trim(),
          owner_email: form.owner_email.trim() || null,
        }),
      });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        setErr(body.detail || 'מכסת האירועים של האולם מלאה.');
        return;
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setErr(body.detail || 'יצירת האירוע נכשלה. נסו שוב.');
        return;
      }
      // reset for next time
      setForm({ event_type: 'wedding', name: '', event_date: '', owner_first_name: '', owner_last_name: '', owner_phone: '', owner_email: '' });
      onCreated();
    } catch {
      setErr('יצירת האירוע נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 4, direction: 'rtl' } }}>
      <DialogTitle sx={{ fontWeight: 800 }}>אירוע חדש</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          ניצור עבור בעל האירוע מרחב אישי, ונשלח לו הודעת פתיחה בוואטסאפ.
        </Typography>
        {err && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{err}</Alert>}
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel>סוג האירוע</InputLabel>
            <Select label="סוג האירוע" value={form.event_type}
              onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}>
              {catalog.event_types.map((t) => <MenuItem key={t.key} value={t.key}>{t.name_he}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="שם האירוע" value={form.name} onChange={set('name')} fullWidth required />
          <TextField size="small" label="תאריך האירוע" type="datetime-local" value={form.event_date}
            onChange={set('event_date')} fullWidth InputLabelProps={{ shrink: true }} />
          <Divider>פרטי בעל האירוע</Divider>
          <Stack direction="row" spacing={2}>
            <TextField size="small" label="שם פרטי" value={form.owner_first_name} onChange={set('owner_first_name')} fullWidth required />
            <TextField size="small" label="שם משפחה" value={form.owner_last_name} onChange={set('owner_last_name')} fullWidth />
          </Stack>
          <TextField size="small" label="טלפון נייד" value={form.owner_phone} onChange={set('owner_phone')} fullWidth required placeholder="05X-XXXXXXX" />
          <TextField size="small" label="אימייל (לא חובה)" value={form.owner_email} onChange={set('owner_email')} fullWidth type="email" />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ color: 'text.secondary', fontWeight: 600 }}>ביטול</Button>
        <Button onClick={submit} disabled={!canSubmit || saving} variant="contained" disableElevation
          sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#6f74e0' } }}>
          {saving ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'צרו אירוע'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
