import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Button, CircularProgress, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import InvitationView from '../components/invitation/InvitationView';
import EnvelopeIntro from '../components/invitation/EnvelopeIntro';
import { InvitationData } from '../components/invitation/types';
import { formStyles } from '../components/invitation/rsvpStyle';
import { resolveTheme, resolveLayout, LayoutSpec } from '../components/invitation/theme';
import { fireConfetti } from '../utils/confetti';
import { ensureThemeFonts } from '../utils/fonts';

// Guests revisit the invite (often day-of, in a hurry); the ceremonial envelope
// should greet them once per session, not on every return.
const openedKey = (slug: string) => `inv_opened_${slug}`;
// Remember the guest's last RSVP so a returning guest can see and update it.
const rsvpKey = (slug: string) => `inv_rsvp_${slug}`;

type SavedRsvp = { name: string; phone: string; partySize: number; status: 'confirmed' | 'declined' | 'maybe' };

function loadSavedRsvp(slug: string): SavedRsvp | null {
  try {
    const raw = localStorage.getItem(rsvpKey(slug));
    return raw ? (JSON.parse(raw) as SavedRsvp) : null;
  } catch { return null; }
}

type RsvpStatus = SavedRsvp['status'];

/** Host question ("שאלות לאורחים", e.g. shuttle) asked of confirming guests. */
type PublicQuestion = { id: string; label: string; options: string[] };

/** Map a server RSVP status (canonical or legacy) to the form's choices; null = no answer yet. */
function normalizeRsvpStatus(raw: unknown): RsvpStatus | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'confirmed' || v === 'attending') return 'confirmed';
  if (v === 'declined') return 'declined';
  if (v === 'maybe') return 'maybe';
  return null;
}

function coupleNames(data: InvitationData): string {
  return data.invitation?.hero?.bigText
    || (data.inviters?.length ? data.inviters.map((i) => `${i.fn} ${i.ln}`.trim()).join(' & ') : data.name)
    || '';
}

/** Public, unauthenticated web invitation + open-form RSVP. Route: /i/:slug */
export default function PublicInvitation() {
  const { slug } = useParams<{ slug: string }>();
  // Signed per-guest token from the invite link (/i/:slug?g=...). It is what
  // authorises reading and updating THIS guest's RSVP; without it the form can
  // only create a new one. Absent for forwarded links and walk-ins, which is fine.
  const inviteToken = React.useMemo(
    () => new URLSearchParams(window.location.search).get('g') || '',
    [],
  );
  const [data, setData] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl');
    if (!slug) return;
    const prevTitle = document.title;
    fetch(`/api/public/invite/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (res.status === 404) { setNotFound(true); throw new Error('not found'); }
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((d: InvitationData) => {
        // Load only the font families this invitation's theme actually uses.
        const th = d.invitation?.theme;
        ensureThemeFonts(th?.titleFont, th?.bodyFont, d.invitation?.envelope?.font);
        // The browser tab should carry the celebration, not a generic app name.
        document.title = coupleNames(d) || 'הזמנה לאירוע';
        setData(d);
      })
      .catch(() => { document.title = 'ההזמנה לא נמצאה'; })
      .finally(() => setLoading(false));
    return () => { document.title = prevTitle; };
  }, [slug]);

  if (loading) {
    return <Centered><CircularProgress /></Centered>;
  }
  if (notFound || !data) {
    return (
      <Centered>
        <Typography variant="h5" sx={{ mb: 1 }}>ההזמנה לא נמצאה</Typography>
        <Typography color="text.secondary">ייתכן שהקישור שגוי או שההזמנה אינה פעילה.</Typography>
      </Centered>
    );
  }

  const t = resolveTheme(data.invitation?.theme);
  const layout = resolveLayout(data.invitation?.theme);
  const alreadyOpened = (() => {
    try { return sessionStorage.getItem(openedKey(slug!)) === '1'; } catch { return false; }
  })();
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: t.bg }}>
      <InvitationView
        data={data}
        rsvpSlot={(
          <RsvpForm
            slug={slug!} inviteToken={inviteToken} theme={t} layout={layout}
            questions={(data as InvitationData & { questions?: PublicQuestion[] }).questions || []}
          />
        )}
      />
      {data.invitation?.envelope?.enabled && !alreadyOpened && (
        <EnvelopeIntro
          config={data.invitation}
          names={coupleNames(data)}
          onDone={() => { try { sessionStorage.setItem(openedKey(slug!), '1'); } catch { /* private mode */ } }}
        />
      )}
    </Box>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 3, bgcolor: '#f5efe6' }}>
      {children}
    </Box>
  );
}

function RsvpForm({ slug, inviteToken, theme, layout, questions }: { slug: string; inviteToken: string; theme: ReturnType<typeof resolveTheme>; layout?: LayoutSpec; questions: PublicQuestion[] }) {
  const EDITORIAL = formStyles(theme, layout);
  const saved = React.useMemo(() => loadSavedRsvp(slug), [slug]);
  const [name, setName] = useState(saved?.name || '');
  const [phone, setPhone] = useState(saved?.phone || '');
  const [partySize, setPartySize] = useState(saved?.partySize || 1);
  const [status, setStatus] = useState<'confirmed' | 'declined' | 'maybe'>(saved?.status || 'confirmed');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [wasUpdate, setWasUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // question id -> chosen option label (optional; only sent when confirming).
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const touchedAnswers = React.useRef(false);
  // What the guest picked THIS session must never be overwritten by an old
  // server answer (e.g. picked "לא מגיע/ה", typed the phone, got flipped back).
  const touchedStatus = React.useRef(false);
  const touchedPartySize = React.useRef(false);

  // Returning guest: pre-fill from their existing RSVP so they update it rather
  // than create a duplicate. Authorised by the link's signed token - a phone
  // number is not a credential, so without a token there is nothing to look up.
  const lookupExisting = async () => {
    if (!inviteToken) return;
    try {
      const res = await fetch(`/api/public/invite/${encodeURIComponent(slug)}/rsvp/lookup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      });
      if (!res.ok) return;
      const b = await res.json().catch(() => ({} as any));
      if (b.found) {
        if (b.name && !name.trim()) setName(b.name);
        if (b.party_size && !touchedPartySize.current) setPartySize(b.party_size);
        // The server returns the canonical status, but legacy 'attending' (the
        // WhatsApp flow's spelling) must also read as confirmed. A guest who has
        // not answered yet ('invited') keeps the form default instead of being
        // pre-set to "maybe".
        const prior = normalizeRsvpStatus(b.status);
        if (prior && !touchedStatus.current) setStatus(prior);
        // Only a guest who already answered is "updating"; an invited guest's
        // first answer is a new RSVP.
        setWasUpdate(!!prior);
        if (b.answers && typeof b.answers === 'object' && !touchedAnswers.current) setAnswers(b.answers);
      }
    } catch { /* ignore lookup failures - the form still works */ }
  };

  // Pre-fill as soon as the page opens: the token identifies the guest, so we no
  // longer wait for them to finish typing a phone number.
  React.useEffect(() => { lookupExisting(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [inviteToken]);

  const submit = async () => {
    setError(null);
    if (!name.trim() || phone.trim().length < 5) {
      setError('נא למלא שם וטלפון תקין');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/invite/${encodeURIComponent(slug)}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: inviteToken || undefined,
          name: name.trim(),
          phone: phone.trim(),
          partySize: status === 'confirmed' ? partySize : 1,
          status,
          answers: status === 'confirmed' && Object.keys(answers).length ? answers : undefined,
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        // Backend detail strings can be English/technical - guests get curated Hebrew.
        if (res.status === 403) throw new Error('אישורי ההגעה נסגרו. אם משהו השתנה, דברו ישירות עם בעלי השמחה 💜');
        if (res.status === 409) {
          const code = typeof body?.detail === 'object' ? body.detail?.code : undefined;
          if (code === 'capacity') throw new Error('נגמרו המקומות הפנויים באירוע. שווה לבדוק ישירות מול בעלי השמחה');
          // Same phone already on the guest list: their answer can only be updated
          // from their personal link (a phone number is not a credential).
          throw new Error('המספר הזה כבר רשום ברשימת המוזמנים 💜 כדי לעדכן את התשובה, פתחו את הקישור האישי שקיבלתם בוואטסאפ או השיבו שם להודעה');
        }
        throw new Error('משהו השתבש בשליחה. נסו שוב בעוד רגע');
      }
      setWasUpdate(!!body.updated);
      try {
        localStorage.setItem(rsvpKey(slug), JSON.stringify({ name: name.trim(), phone: phone.trim(), partySize, status }));
      } catch { /* private mode */ }
      setDone(true);
      // The guest's "yes" is the product's happiest moment - celebrate it.
      if (status === 'confirmed') fireConfetti(1800);
    } catch (e: any) {
      setError(e.message || 'שגיאה בשליחת האישור');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <Typography sx={{ ...EDITORIAL.serif, fontSize: 28, mb: 1.5 }}>תודה רבה</Typography>
        <Typography sx={{ ...EDITORIAL.sans, color: EDITORIAL.muted }}>
          {wasUpdate
            ? 'התשובה שלך עודכנה בהצלחה.'
            : status === 'confirmed' ? 'אישור ההגעה נקלט בהצלחה.' : 'תגובתך נקלטה. נתראה בפעם אחרת!'}
        </Typography>
        <Typography
          component="button"
          onClick={() => setDone(false)}
          sx={{ ...EDITORIAL.sans, mt: 2, fontSize: 13, color: EDITORIAL.muted, background: 'none', border: 'none', borderBottom: `1px solid ${theme.line}`, cursor: 'pointer', p: 0, pb: 0.25 }}
        >
          רוצים לעדכן את התשובה?
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ textAlign: 'right' }}>
      <Stack spacing={3}>
        {saved && (
          <Typography sx={{ ...EDITORIAL.sans, fontSize: 13.5, color: EDITORIAL.muted }}>
            כבר שלחתם תשובה מהמכשיר הזה - אפשר לעדכן אותה כאן, פשוט שולחים שוב.
          </Typography>
        )}
        <ToggleButtonGroup
          exclusive fullWidth value={status}
          onChange={(_, v) => { if (v) { touchedStatus.current = true; setStatus(v); } }}
          size="small" sx={EDITORIAL.toggle}
        >
          <ToggleButton value="confirmed">מגיע/ה</ToggleButton>
          <ToggleButton value="maybe">אולי</ToggleButton>
          <ToggleButton value="declined">לא מגיע/ה</ToggleButton>
        </ToggleButtonGroup>

        <TextField variant="standard" label="שם מלא" value={name} onChange={(e) => setName(e.target.value)} fullWidth sx={EDITORIAL.field} />
        <TextField variant="standard" label="טלפון" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth inputMode="tel" sx={EDITORIAL.field} />
        {wasUpdate && !done && (
          <Typography sx={{ ...EDITORIAL.sans, color: EDITORIAL.muted, fontSize: 13 }}>
            כבר שלחתם תשובה - שליחה תעדכן את התשובה הקיימת.
          </Typography>
        )}
        {status === 'confirmed' && (
          <TextField
            select variant="standard" label="מספר אורחים" value={partySize}
            onChange={(e) => { touchedPartySize.current = true; setPartySize(Number(e.target.value)); }} fullWidth sx={EDITORIAL.field}
          >
            {Array.from({ length: Math.max(20, partySize) }, (_, i) => i + 1).map((n) => (
              <MenuItem key={n} value={n}>{n}</MenuItem>
            ))}
          </TextField>
        )}
        {status === 'confirmed' && questions.map((q) => (
          <Box key={q.id} role="radiogroup" aria-label={q.label}>
            <Typography sx={{ ...EDITORIAL.sans, fontSize: 15, fontWeight: 600, mb: 0.5 }}>{q.label}</Typography>
            <RadioGroup
              value={answers[q.id] ?? ''}
              onChange={(e) => { touchedAnswers.current = true; setAnswers((a) => ({ ...a, [q.id]: e.target.value })); }}
            >
              {q.options.map((o) => (
                <FormControlLabel
                  key={o} value={o} label={o}
                  control={<Radio size="small" sx={{ color: EDITORIAL.muted, '&.Mui-checked': { color: theme.accent || undefined } }} />}
                  sx={{ m: 0, gap: 0.5, '& .MuiFormControlLabel-label': { ...EDITORIAL.sans, fontSize: 15 } }}
                />
              ))}
            </RadioGroup>
          </Box>
        ))}
        {error && <Typography sx={{ ...EDITORIAL.sans, color: '#a5462f', fontSize: 14 }}>{error}</Typography>}
        <Button variant="outlined" size="large" onClick={submit} disabled={submitting} sx={EDITORIAL.button}>
          {submitting ? 'שולח…' : 'שליחת אישור'}
        </Button>
      </Stack>
    </Box>
  );
}
