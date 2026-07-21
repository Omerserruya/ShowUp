import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box, Stack, Typography, Paper, Button, Chip, TextField, MenuItem,
  FormControl, InputLabel, Select, CircularProgress, Alert, Divider, alpha,
} from '@mui/material';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import SentimentDissatisfiedRoundedIcon from '@mui/icons-material/SentimentDissatisfiedRounded';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useCatalog } from '../hooks/useCatalog';
import { getPlan } from '../config/plans';

const BRAND = '#888cee';
const DEEP = '#6f74e0';

type RedeemStatus = 'available' | 'redeemed' | 'expired' | 'cancelled';

interface RedeemInfo {
  redeemable: boolean;
  status: RedeemStatus;
  source: string;
  plan_id: string;
  max_guests: number | null;
  campaign_rounds: number | null;
  expires_at: string | null;
}

const isLoggedIn = () =>
  !!(localStorage.getItem('access_token') || localStorage.getItem('token'));

// Friendly Hebrew copy for the non-redeemable states.
const NON_REDEEMABLE: Record<string, { title: string; body: string }> = {
  redeemed: {
    title: 'ההזמנה כבר מומשה',
    body: 'הקישור הזה כבר שימש ליצירת אירוע. אם זה האירוע שלכם, התחברו כדי לגשת אליו.',
  },
  expired: {
    title: 'תוקף ההזמנה פג',
    body: 'הקישור הזה כבר אינו בתוקף. פנו למי ששלח לכם אותו כדי לקבל קישור חדש.',
  },
  cancelled: {
    title: 'ההזמנה בוטלה',
    body: 'הקישור הזה בוטל ואינו זמין יותר.',
  },
  not_found: {
    title: 'הקישור לא נמצא',
    body: 'לא מצאנו הזמנה שמתאימה לקישור הזה. ודאו שהעתקתם אותו במלואו.',
  },
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
};

export default function Redeem() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { catalog } = useCatalog();

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<RedeemInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null); // holds a NON_REDEEMABLE key or generic

  // Create form
  const [name, setName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [eventType, setEventType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch(`/api/public/redeem/${code}`);
      if (r.status === 404) {
        setLoadError('not_found');
        return;
      }
      if (!r.ok) throw new Error('failed');
      const data: RedeemInfo = await r.json();
      setInfo(data);
    } catch {
      setLoadError('generic');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  const plan = getPlan(info?.plan_id);
  const planTitle = plan?.title || info?.plan_id || 'חבילה';
  const guestsText =
    info?.max_guests == null ? 'ללא הגבלת אורחים' : `עד ${info.max_guests} אורחים`;

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (eventDate) body.event_date = new Date(eventDate).toISOString();
      if (location.trim()) body.location = location.trim();
      if (eventType) body.event_type = eventType;

      const r = await fetchWithAuth(`/api/redeem/${code}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (r.status === 201 || r.ok) {
        const ev = await r.json();
        // Hand the new event to EventContext the same way the app does: persist the
        // desired id, then route into the product; the provider reconciles on load.
        if (ev?.id) localStorage.setItem('selected_event_id', ev.id);
        navigate('/overview');
        return;
      }
      if (r.status === 409) setSubmitError('ההזמנה כבר מומשה. אם זה האירוע שלכם, הוא מופיע במרחב האישי.');
      else if (r.status === 410) setSubmitError('תוקף ההזמנה פג או שהיא בוטלה.');
      else if (r.status === 404) setSubmitError('הקישור לא נמצא. ודאו שהעתקתם אותו במלואו.');
      else setSubmitError('יצירת האירוע נכשלה. נסו שוב.');
    } catch {
      setSubmitError('יצירת האירוע נכשלה. נסו שוב.');
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <Box
      dir="rtl"
      sx={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        p: { xs: 2, sm: 3 }, bgcolor: (t) => t.palette.background.default,
      }}
    >
      <Paper elevation={0} sx={{ width: '100%', maxWidth: 460, p: { xs: 3, sm: 4 }, borderRadius: 4, border: '1px solid', borderColor: (t) => alpha(t.palette.divider, 0.8) }}>
        {children}
      </Paper>
    </Box>
  );

  if (loading) {
    return shell(
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress sx={{ color: BRAND }} />
      </Box>,
    );
  }

  // Non-redeemable (bad status or fetch error).
  const badKey = loadError || (info && !info.redeemable ? info.status : null);
  if (badKey && badKey !== 'generic') {
    const copy = NON_REDEEMABLE[badKey] || NON_REDEEMABLE.not_found;
    return shell(
      <Stack spacing={1.5} alignItems="center" textAlign="center">
        <Box sx={{ width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (t) => alpha(t.palette.text.disabled, 0.12), color: 'text.secondary' }}>
          <SentimentDissatisfiedRoundedIcon />
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: 20 }}>{copy.title}</Typography>
        <Typography variant="body2" color="text.secondary">{copy.body}</Typography>
        {badKey === 'redeemed' && !isLoggedIn() && (
          <Button variant="contained" disableElevation onClick={() => navigate('/login')} sx={{ mt: 1, borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: DEEP } }}>
            התחברות
          </Button>
        )}
      </Stack>,
    );
  }

  if (badKey === 'generic' || !info) {
    return shell(
      <Stack spacing={2} alignItems="center" textAlign="center">
        <Alert severity="error" sx={{ width: '100%', borderRadius: 2 }}>לא הצלחנו לטעון את ההזמנה. נסו שוב.</Alert>
        <Button onClick={load} sx={{ fontWeight: 700, color: BRAND }}>נסו שוב</Button>
      </Stack>,
    );
  }

  // Redeemable — celebratory header + (login CTA | create form).
  return shell(
    <Stack spacing={2.5}>
      <Stack spacing={1.25} alignItems="center" textAlign="center">
        <Box sx={{ width: 60, height: 60, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(BRAND, 0.12), color: BRAND }}>
          <CardGiftcardRoundedIcon sx={{ fontSize: 30 }} />
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: 22 }}>קיבלת אירוע במתנה!</Typography>
        <Typography variant="body2" color="text.secondary">
          מישהו רכש עבורכם אירוע ב-ShowUp. הפעילו אותו והתחילו לתכנן.
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', justifyContent: 'center', gap: 0.75, mt: 0.5 }}>
          <Chip label={`חבילת ${planTitle}`} sx={{ bgcolor: alpha(BRAND, 0.12), color: DEEP, fontWeight: 700 }} />
          <Chip variant="outlined" label={guestsText} />
          {info.campaign_rounds != null && (
            <Chip variant="outlined" label={`${info.campaign_rounds} סבבי הודעות`} />
          )}
        </Stack>
        {info.expires_at && (
          <Typography variant="caption" color="text.secondary">
            ניתן לממש עד {fmtDate(info.expires_at)}
          </Typography>
        )}
      </Stack>

      <Divider />

      {!isLoggedIn() ? (
        <Stack spacing={1.5} alignItems="center">
          <Typography variant="body2" color="text.secondary" textAlign="center">
            כדי לממש את המתנה צריך להתחבר קודם. נחזיר אתכם לכאן מיד לאחר ההתחברות.
          </Typography>
          <Button
            fullWidth variant="contained" disableElevation
            onClick={() => navigate('/login', { state: { next: `/redeem/${code}` } })}
            sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: DEEP }, py: 1.1 }}
          >
            התחברות כדי לממש
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2}>
          {submitError && (
            <Alert severity="error" onClose={() => setSubmitError(null)} sx={{ borderRadius: 2 }}>{submitError}</Alert>
          )}
          <TextField size="small" label="שם האירוע" value={name} onChange={(e) => setName(e.target.value)} fullWidth required />
          <TextField size="small" label="תאריך האירוע (לא חובה)" type="datetime-local" value={eventDate}
            onChange={(e) => setEventDate(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
          <TextField size="small" label="מיקום (לא חובה)" value={location} onChange={(e) => setLocation(e.target.value)} fullWidth />
          <FormControl fullWidth size="small">
            <InputLabel>סוג האירוע (לא חובה)</InputLabel>
            <Select label="סוג האירוע (לא חובה)" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              <MenuItem value=""><em>בחירה מאוחר יותר</em></MenuItem>
              {catalog.event_types.map((t) => (
                <MenuItem key={t.key} value={t.key}>{t.name_he}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            fullWidth variant="contained" disableElevation onClick={submit}
            disabled={!name.trim() || submitting}
            startIcon={!submitting ? <CelebrationRoundedIcon /> : undefined}
            sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: DEEP }, py: 1.1 }}
          >
            {submitting ? <CircularProgress size={22} sx={{ color: '#fff' }} /> : 'הפעילו את האירוע'}
          </Button>
        </Stack>
      )}
    </Stack>,
  );
}
