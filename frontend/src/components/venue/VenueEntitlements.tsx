import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Card, CardContent, Button, Chip, TextField,
  MenuItem, Select, FormControl, InputLabel, IconButton, Tooltip,
  CircularProgress, Alert, Snackbar, Divider, alpha,
} from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import EmailRoundedIcon from '@mui/icons-material/EmailRounded';
import AddLinkRoundedIcon from '@mui/icons-material/AddLinkRounded';
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { plans, getPlan } from '../../config/plans';

const BRAND = '#888cee';
const DEEP = '#6f74e0';

interface VenueEntitlement {
  id: string;
  status: string;
  plan_id: string;
  max_guests: number | null;
  campaign_rounds: number | null;
  code: string;
  redemption_link: string;
  redeemed_at: string | null;
  redeemed_event_id: string | null;
  created_at: string;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '-';
  }
};

export default function VenueEntitlements({ venueId }: { venueId: string }) {
  const [items, setItems] = useState<VenueEntitlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Generate control
  const [gPlan, setGPlan] = useState<string>(plans[0]?.id || 'basic');
  const [gCount, setGCount] = useState('1');
  const [gMaxGuests, setGMaxGuests] = useState('');
  const [gRounds, setGRounds] = useState('');
  const [gExpires, setGExpires] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}/entitlements`);
      if (!r.ok) throw new Error('failed');
      const data = await r.json();
      setItems(data.items || []);
    } catch {
      setError('לא הצלחנו לטעון את קישורי המימוש.');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    load();
  }, [load]);

  const available = useMemo(() => items.filter((i) => i.status === 'available'), [items]);
  const others = useMemo(() => items.filter((i) => i.status !== 'available'), [items]);

  // Available links grouped by plan for the summary counts.
  const byPlan = useMemo(() => {
    const m = new Map<string, number>();
    available.forEach((i) => m.set(i.plan_id, (m.get(i.plan_id) || 0) + 1));
    return Array.from(m.entries());
  }, [available]);

  const statusText = (s: string) => {
    if (s === 'redeemed') return 'מומש';
    if (s === 'expired') return 'פג תוקף';
    if (s === 'cancelled') return 'בוטל';
    return s;
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setToast('הקישור הועתק');
    } catch {
      setToast('העתקה נכשלה');
    }
  };

  const shareWhatsApp = (link: string) => {
    window.open(`https://wa.me/?text=${encodeURIComponent('הזמנה לאירוע: ' + link)}`, '_blank', 'noopener');
  };

  const shareEmail = (link: string) => {
    const subject = encodeURIComponent('הזמנה לאירוע ב-ShowUp');
    const body = encodeURIComponent('קיבלת אירוע במתנה! לחצו על הקישור כדי לממש:\n' + link);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const generate = async () => {
    const count = parseInt(gCount, 10);
    if (!count || count < 1) {
      setGenError('בחרו כמות תקינה');
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const body: Record<string, unknown> = { plan_id: gPlan, count };
      if (gMaxGuests.trim()) body.max_guests = parseInt(gMaxGuests, 10);
      if (gRounds.trim()) body.campaign_rounds = parseInt(gRounds, 10);
      if (gExpires) body.expires_at = new Date(gExpires).toISOString();

      const r = await fetchWithAuth(`/api/venues/${venueId}/entitlements`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setGenError(b.detail || 'יצירת הקישורים נכשלה. נסו שוב.');
        return;
      }
      setToast(`נוצרו ${count} קישורי מימוש`);
      setGCount('1');
      setGMaxGuests('');
      setGRounds('');
      setGExpires('');
      load();
    } catch {
      setGenError('יצירת הקישורים נכשלה. נסו שוב.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(BRAND, 0.12), color: BRAND }}>
          <CardGiftcardRoundedIcon fontSize="small" />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 18 }}>הזמנות למימוש</Typography>
          <Typography variant="body2" color="text.secondary">
            צרו קישורים שמעניקים אירוע במתנה - שלחו אותם לבעלי האירוע בוואטסאפ או במייל.
          </Typography>
        </Box>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

      {/* Generate control */}
      <Card variant="outlined" sx={{ borderRadius: 3, mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 700, mb: 1.5 }}>צור קישורי מימוש</Typography>
          {genError && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{genError}</Alert>}
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }} alignItems="flex-start">
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>חבילה</InputLabel>
              <Select label="חבילה" value={gPlan} onChange={(e) => setGPlan(e.target.value)}>
                {plans.map((p) => <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField size="small" label="כמות" type="number" value={gCount}
              onChange={(e) => setGCount(e.target.value)} sx={{ width: 90 }} inputProps={{ min: 1 }} />
            <TextField size="small" label="מקס' אורחים" type="number" value={gMaxGuests}
              onChange={(e) => setGMaxGuests(e.target.value)} sx={{ width: 130 }} placeholder="ברירת מחדל" />
            <TextField size="small" label="סבבי הודעות" type="number" value={gRounds}
              onChange={(e) => setGRounds(e.target.value)} sx={{ width: 130 }} placeholder="ברירת מחדל" />
            <TextField size="small" label="תפוגה" type="date" value={gExpires}
              onChange={(e) => setGExpires(e.target.value)} sx={{ width: 170 }} InputLabelProps={{ shrink: true }} />
            <Button
              variant="contained" disableElevation onClick={generate} disabled={generating}
              startIcon={!generating ? <AddLinkRoundedIcon /> : undefined}
              sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: DEEP }, minWidth: 120 }}
            >
              {generating ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'יצירה'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {loading && items.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress sx={{ color: BRAND }} /></Box>
      ) : (
        <>
          {/* Available summary by plan */}
          {byPlan.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              {byPlan.map(([planId, count]) => (
                <Chip key={planId} label={`${getPlan(planId)?.title || planId}: ${count} זמינים`}
                  sx={{ bgcolor: alpha(BRAND, 0.1), color: DEEP, fontWeight: 700 }} />
              ))}
            </Stack>
          )}

          {/* Available links */}
          {available.length === 0 ? (
            <Card variant="outlined" sx={{ borderRadius: 3, textAlign: 'center', py: 4, borderStyle: 'dashed' }}>
              <Typography variant="body2" color="text.secondary">אין כרגע קישורי מימוש זמינים. צרו קישורים חדשים למעלה.</Typography>
            </Card>
          ) : (
            <Stack spacing={1}>
              {available.map((it) => (
                <Card key={it.id} variant="outlined" sx={{ borderRadius: 3 }}>
                  <CardContent sx={{ py: 1.5 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.25, flexWrap: 'wrap', gap: 0.5 }}>
                          <Chip size="small" label={getPlan(it.plan_id)?.title || it.plan_id}
                            sx={{ bgcolor: alpha(BRAND, 0.1), color: DEEP, fontWeight: 700 }} />
                          <Chip size="small" variant="outlined"
                            label={it.max_guests == null ? 'ללא הגבלה' : `עד ${it.max_guests} אורחים`} />
                          {it.campaign_rounds != null && (
                            <Chip size="small" variant="outlined" label={`${it.campaign_rounds} סבבים`} />
                          )}
                        </Stack>
                        <Typography dir="ltr" variant="caption" color="text.secondary"
                          sx={{ display: 'block', fontFamily: 'monospace', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}>
                          {it.redemption_link}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="העתקת קישור">
                          <IconButton size="small" onClick={() => copyLink(it.redemption_link)}>
                            <ContentCopyRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="שיתוף בוואטסאפ">
                          <IconButton size="small" sx={{ color: '#25D366' }} onClick={() => shareWhatsApp(it.redemption_link)}>
                            <WhatsAppIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="שיתוף במייל">
                          <IconButton size="small" onClick={() => shareEmail(it.redemption_link)}>
                            <EmailRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}

          {/* Redeemed / expired / cancelled */}
          {others.length > 0 && (
            <>
              <Divider sx={{ my: 2.5 }} />
              <Typography sx={{ fontWeight: 700, mb: 1 }}>קישורים שכבר נוצלו</Typography>
              <Stack spacing={1}>
                {others.map((it) => (
                  <Card key={it.id} variant="outlined" sx={{ borderRadius: 3, opacity: 0.75 }}>
                    <CardContent sx={{ py: 1.25 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                          <Chip size="small" variant="outlined" label={getPlan(it.plan_id)?.title || it.plan_id} />
                          <Chip size="small"
                            label={statusText(it.status)}
                            color={it.status === 'redeemed' ? 'success' : it.status === 'expired' ? 'warning' : 'default'}
                            variant={it.status === 'redeemed' ? 'filled' : 'outlined'} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {it.status === 'redeemed' ? `מומש ב-${fmtDate(it.redeemed_at)}` : `נוצר ב-${fmtDate(it.created_at)}`}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </>
          )}
        </>
      )}

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
