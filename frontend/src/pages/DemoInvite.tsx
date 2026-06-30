import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Button, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import InvitationView from '../components/invitation/InvitationView';
import { InvitationData, DEFAULT_INVITATION } from '../components/invitation/types';

/**
 * Public, no-auth DEMO invitation. Lets a prospect experience exactly what a guest
 * receives - the envelope, the invite, and a working RSVP form. Nothing is persisted;
 * the RSVP "submit" is faked client-side. Reached from the landing-page demo CTA via a
 * WhatsApp link. Route: /demo/invite?type=wedding&name=...
 */

type DemoPreset = {
  title: string;        // e.g. "החתונה של"
  bigText: string;      // hosts headline on the invite
  inviters: Array<{ fn: string; ln: string }>;
  personalText: string;
  location: string;
};

const PRESETS: Record<string, DemoPreset> = {
  wedding: {
    title: 'החתונה של',
    bigText: 'דנה ❤ יוסי',
    inviters: [{ fn: 'דנה', ln: 'לוי' }, { fn: 'יוסי', ln: 'כהן' }],
    personalText: 'בשמחה ובאהבה נשמח לחגוג איתכם את יום נישואינו. נא לאשר הגעה 💍',
    location: 'אולמי הגן הקסום, ראשון לציון',
  },
  'bar-mitzvah': {
    title: 'בר המצווה של',
    bigText: 'איתי עולה לתורה 🕎',
    inviters: [{ fn: 'משפחת', ln: 'אברהמי' }],
    personalText: 'נתכבד בנוכחותכם בחגיגת בר המצווה לבננו איתי. נא לאשר הגעה.',
    location: 'אולם שמחות "הדר", פתח תקווה',
  },
  'bat-mitzvah': {
    title: 'בת המצווה של',
    bigText: 'מאיה בת מצווה ✨',
    inviters: [{ fn: 'משפחת', ln: 'דהן' }],
    personalText: 'נשמח לחגוג יחד את בת המצווה של מאיה. נא לאשר הגעה.',
    location: 'גן האירועים "לה ויה", נתניה',
  },
  brit: {
    title: 'הברית של',
    bigText: 'מזל טוב, נולד לנו בן! 👶',
    inviters: [{ fn: 'משפחת', ln: 'מזרחי' }],
    personalText: 'בשעה טובה ומוצלחת - נשמח לראותכם בברית. נא לאשר הגעה.',
    location: 'בית הכנסת הגדול, ירושלים',
  },
  corporate: {
    title: 'האירוע של',
    bigText: 'ShowUp · ערב השקה 🚀',
    inviters: [{ fn: 'צוות', ln: 'ShowUp' }],
    personalText: 'אתם מוזמנים לערב ההשקה השנתי שלנו. נא לאשר הגעה.',
    location: 'מתחם "הנגר", תל אביב',
  },
};

function demoDateISO(): string {
  // ~30 days from now at 19:30 - purely for display.
  const d = new Date();
  d.setDate(d.getDate() + 30);
  d.setHours(19, 30, 0, 0);
  return d.toISOString();
}

export default function DemoInvite() {
  const [params] = useSearchParams();
  const type = (params.get('type') || 'wedding').toLowerCase();
  const guestName = params.get('name') || '';
  const preset = PRESETS[type] || PRESETS.wedding;

  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl');
  }, []);

  const data: InvitationData = useMemo(() => ({
    name: guestName || 'אורח/ת יקר/ה',
    event_date: demoDateISO(),
    location: JSON.stringify({ label: preset.location }),
    inviters: preset.inviters,
    invitation: {
      ...DEFAULT_INVITATION,
      hero: { ...DEFAULT_INVITATION.hero, bigText: preset.bigText },
      envelope: { ...DEFAULT_INVITATION.envelope, envelopeText: preset.title },
      personalText: preset.personalText,
      rsvpEnabled: true,
    },
  }), [guestName, preset]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#faf7f2' }}>
      {/* Subtle demo ribbon so it's clear this is a sample */}
      <Box
        sx={{
          position: 'sticky', top: 0, zIndex: 10,
          textAlign: 'center', py: 0.75, px: 2,
          background: 'linear-gradient(90deg,#3b82f6,#a855f7)',
          color: '#fff', fontSize: 13, fontWeight: 600,
        }}
      >
        זוהי הזמנת דמו - כך בדיוק יחווה זאת האורח שלכם ✨
      </Box>
      <InvitationView data={data} rsvpSlot={<DemoRsvpForm />} />
    </Box>
  );
}

/** Local-only RSVP - mirrors the real public form but persists nothing. */
function DemoRsvpForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [status, setStatus] = useState<'confirmed' | 'declined' | 'maybe'>('confirmed');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!name.trim() || phone.trim().length < 5) {
      setError('נא למלא שם וטלפון תקין');
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <Box sx={{ p: 3, borderRadius: 3, bgcolor: 'rgba(124,58,237,0.06)', textAlign: 'center' }}>
        <Typography variant="h6" sx={{ mb: 1 }}>תודה רבה! 🎉</Typography>
        <Typography color="text.secondary">
          {status === 'confirmed' ? 'אישור ההגעה נקלט (בדמו זה לא נשמר).' : 'תגובתך נקלטה. נתראה בפעם אחרת!'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2.5, md: 3 }, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.85)', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', textAlign: 'right' }}>
      <Typography variant="h6" sx={{ mb: 2, textAlign: 'center' }}>אישור הגעה</Typography>
      <Stack spacing={2}>
        <ToggleButtonGroup
          exclusive fullWidth value={status}
          onChange={(_, v) => v && setStatus(v)}
          color="primary" size="small"
        >
          <ToggleButton value="confirmed">מגיע/ה</ToggleButton>
          <ToggleButton value="maybe">אולי</ToggleButton>
          <ToggleButton value="declined">לא מגיע/ה</ToggleButton>
        </ToggleButtonGroup>

        <TextField label="שם מלא" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" />
        <TextField label="טלפון" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth size="small" inputMode="tel" />
        {status === 'confirmed' && (
          <TextField
            select label="מספר אורחים" value={partySize}
            onChange={(e) => setPartySize(Number(e.target.value))} fullWidth size="small"
          >
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <MenuItem key={n} value={n}>{n}</MenuItem>
            ))}
          </TextField>
        )}
        {error && <Typography color="error" sx={{ fontSize: 14 }}>{error}</Typography>}
        <Button variant="contained" size="large" onClick={submit}>שליחת אישור</Button>
      </Stack>
    </Box>
  );
}
