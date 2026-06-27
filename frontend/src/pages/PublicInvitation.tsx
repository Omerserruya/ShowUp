import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Button, CircularProgress, MenuItem, Stack, TextField, Typography, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import InvitationView from '../components/invitation/InvitationView';
import { InvitationData } from '../components/invitation/types';

/** Public, unauthenticated web invitation + open-form RSVP. Route: /i/:slug */
export default function PublicInvitation() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl');
    if (!slug) return;
    fetch(`/api/public/invite/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (res.status === 404) { setNotFound(true); throw new Error('not found'); }
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((d: InvitationData) => setData(d))
      .catch(() => { /* handled via notFound/loading */ })
      .finally(() => setLoading(false));
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

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#faf7f2' }}>
      <InvitationView data={data} rsvpSlot={<RsvpForm slug={slug!} />} />
    </Box>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 3, bgcolor: '#faf7f2' }}>
      {children}
    </Box>
  );
}

function RsvpForm({ slug }: { slug: string }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [status, setStatus] = useState<'confirmed' | 'declined' | 'maybe'>('confirmed');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          name: name.trim(),
          phone: phone.trim(),
          partySize: status === 'confirmed' ? partySize : 1,
          status,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || 'שגיאה בשליחת האישור');
      }
      setDone(true);
    } catch (e: any) {
      setError(e.message || 'שגיאה בשליחת האישור');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Box sx={{ p: 3, borderRadius: 3, bgcolor: 'rgba(124,58,237,0.06)', textAlign: 'center' }}>
        <Typography variant="h6" sx={{ mb: 1 }}>תודה רבה! 🎉</Typography>
        <Typography color="text.secondary">
          {status === 'confirmed' ? 'אישור ההגעה נקלט בהצלחה.' : 'תגובתך נקלטה. נתראה בפעם אחרת!'}
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
        <Button variant="contained" size="large" onClick={submit} disabled={submitting}>
          {submitting ? 'שולח…' : 'שליחת אישור'}
        </Button>
      </Stack>
    </Box>
  );
}
