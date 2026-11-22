import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box, Stack, Typography, Paper, Button, Chip, TextField, MenuItem,
  FormControl, InputLabel, Select, CircularProgress, Alert, Divider, alpha, ClickAwayListener,
  Checkbox, FormControlLabel, Link,
} from '@mui/material';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import SentimentDissatisfiedRoundedIcon from '@mui/icons-material/SentimentDissatisfiedRounded';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useCatalog } from '../hooks/useCatalog';
import { getPlan } from '../config/plans';
import { usePlacesAutocomplete } from '../hooks/usePlacesAutocomplete';
import dayjs from 'dayjs';
import { israelTimeToISOUTC } from '../utils/israelTime';
import { EMPTY_SUBJECTS, EventSubjects, HOST_NAMES_HINT, SUBJECT_FIELDS, deriveEventFromSubjects, hasHostNames } from '../config/eventSubjects';
import SubjectFields from '../components/SubjectFields';
import { TERMS_VERSION } from '../config/legal';

const BRAND = '#9D83E0';
const DEEP = '#5A3DA6';

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
  // Same event step as the wizard (minus the package, which the gift fixes):
  // type -> who it is for -> name (suggested from them) -> date, time, place.
  // The message rounds are created from our schedule once the date is known.
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [subjects, setSubjects] = useState<EventSubjects>(EMPTY_SUBJECTS);
  const [agreed, setAgreed] = useState(false);
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  // Same Google Places search as the event wizard; a picked place is sent the
  // way the wizard sends it (JSON name/address/coordinates), free text as typed.
  const places = usePlacesAutocomplete();
  const [showPlaces, setShowPlaces] = useState(false);
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

  // Picking the type / typing the names suggests the event name, until it is edited.
  const suggest = (type: string, s: EventSubjects) => {
    if (!nameEdited) setName(deriveEventFromSubjects(type, s).name);
  };
  const pickType = (type: string) => { setEventType(type); suggest(type, subjects); };
  const setSubject = (patch: Partial<EventSubjects>) => {
    const next = { ...subjects, ...patch };
    setSubjects(next);
    suggest(eventType, next);
  };

  const submit = async () => {
    if (!name.trim() || !eventType || !hasHostNames(subjects) || !agreed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      // The chosen day + hour are Israel time, exactly like the wizard.
      if (eventDate) body.event_date = israelTimeToISOUTC(dayjs(eventDate), eventTime || '19:00');
      const derived = deriveEventFromSubjects(eventType, subjects);
      if (SUBJECT_FIELDS[eventType]) body.subjects = subjects;
      if (derived.inviterName) body.inviters = [{ fn: derived.inviterName, ln: '' }];
      const picked = places.location;
      if (picked && places.inputValue === picked.address) {
        body.location = JSON.stringify({ name: picked.name, address: picked.address, coordinates: picked.coordinates });
      } else if (places.inputValue.trim()) {
        body.location = places.inputValue.trim();
      }
      if (eventType) body.event_type = eventType;
      body.terms_version = TERMS_VERSION;

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
      else if (r.status === 422) {
        const d = (await r.json().catch(() => ({})))?.detail;
        setSubmitError(d?.message || HOST_NAMES_HINT);
      }
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
          <Button variant="contained" disableElevation onClick={() => navigate('/login')} sx={{ mt: 1, borderRadius: 2, fontWeight: 700, bgcolor: '#C9B8F3', color: '#16150F', '&:hover': { bgcolor: '#BBA6EE' } }}>
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
            sx={{ borderRadius: 2, fontWeight: 700, bgcolor: '#C9B8F3', color: '#16150F', '&:hover': { bgcolor: '#BBA6EE' }, py: 1.1 }}
          >
            התחברות כדי לממש
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2}>
          {submitError && (
            <Alert severity="error" onClose={() => setSubmitError(null)} sx={{ borderRadius: 2 }}>{submitError}</Alert>
          )}
          <FormControl fullWidth size="small" required>
            <InputLabel>מה חוגגים?</InputLabel>
            <Select label="מה חוגגים?" value={eventType} onChange={(e) => pickType(e.target.value)}>
              {catalog.event_types.map((t) => (
                <MenuItem key={t.key} value={t.key}>{t.name_he}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <SubjectFields eventType={eventType} subjects={subjects} onChange={setSubject} accent={DEEP} />
          {eventType && !hasHostNames(subjects) && (
            <Typography variant="caption" color="text.secondary">{HOST_NAMES_HINT}</Typography>
          )}
          <TextField size="small" label="שם האירוע" value={name} fullWidth required
            onChange={(e) => { setName(e.target.value); setNameEdited(true); }}
            helperText={!nameEdited && name ? 'הצעה לפי השמות - אפשר לשנות' : undefined} />
          <Stack direction="row" spacing={1.5}>
            <TextField size="small" label="תאריך האירוע" type="date" value={eventDate}
              onChange={(e) => setEventDate(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
            <TextField size="small" label="שעה" type="time" value={eventTime}
              onChange={(e) => setEventTime(e.target.value)} sx={{ width: 140, flexShrink: 0 }} InputLabelProps={{ shrink: true }} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: '-8px !important' }}>
            עם תאריך, סבבי ההודעות לאורחים נקבעים מיד לפי לוח הזמנים שלנו. אפשר לשנות אותם אחר כך.
          </Typography>
          <ClickAwayListener onClickAway={() => setShowPlaces(false)}>
            <Box sx={{ position: 'relative' }}>
              <TextField
                size="small" label="מיקום (לא חובה)" fullWidth autoComplete="off"
                inputRef={places.inputRef}
                placeholder={places.isLoaded ? 'שם האולם או כתובת' : undefined}
                value={places.inputValue}
                onChange={(e) => { places.setInputValue(e.target.value); setShowPlaces(true); }}
                onFocus={() => setShowPlaces(true)}
                inputProps={{ maxLength: 200 }}
              />
              {showPlaces && places.suggestions.length > 0 && (
                <Paper elevation={4} sx={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1300, mt: 0.5, maxHeight: 260, overflowY: 'auto', borderRadius: 2 }}>
                  {places.suggestions.map((sug) => (
                    <MenuItem key={sug.placeId} onClick={() => { places.selectSuggestion(sug.placeId); setShowPlaces(false); }}
                      sx={{ display: 'block', whiteSpace: 'normal', py: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{sug.primaryText}</Typography>
                      {sug.secondaryText && <Typography variant="caption" color="text.secondary">{sug.secondaryText}</Typography>}
                    </MenuItem>
                  ))}
                </Paper>
              )}
            </Box>
          </ClickAwayListener>
          <FormControlLabel
            control={<Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} size="small" />}
            label={
              <Typography variant="body2">
                קראתי ואני מסכים/ה{' '}
                <Link href="/terms" target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>לתנאי השימוש</Link>
                {' '}ול<Link href="/privacy" target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>מדיניות הפרטיות</Link>.
              </Typography>
            }
          />
          <Button
            fullWidth variant="contained" disableElevation onClick={submit}
            disabled={!name.trim() || !eventType || !hasHostNames(subjects) || !agreed || submitting}
            startIcon={!submitting ? <CelebrationRoundedIcon /> : undefined}
            sx={{ borderRadius: 2, fontWeight: 700, bgcolor: '#C9B8F3', color: '#16150F', '&:hover': { bgcolor: '#BBA6EE' }, py: 1.1 }}
          >
            {submitting ? <CircularProgress size={22} sx={{ color: '#fff' }} /> : 'הפעילו את האירוע'}
          </Button>
        </Stack>
      )}
    </Stack>,
  );
}
