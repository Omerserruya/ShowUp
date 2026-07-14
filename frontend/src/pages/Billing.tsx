import React, { useCallback, useEffect, useState } from 'react';
import { saveOrderToken, orderAuthHeaders } from '../utils/orderToken';
import {
  Box, Typography, Button, LinearProgress, CircularProgress, Alert, Chip, Stack, useTheme, alpha,
  Dialog, DialogTitle, DialogContent, IconButton,
} from '@mui/material';
import UpgradeIcon from '@mui/icons-material/Upgrade';
import GroupsIcon from '@mui/icons-material/Groups';
import CampaignIcon from '@mui/icons-material/Campaign';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';
import { useUser } from '../contexts/UserContext';
import { useIsStarter } from '../hooks/useEntitlement';
import PlanBadge from '../components/PlanBadge';
import { getPlan, getCampaignsForPlan, plans } from '../config/plans';

interface Usage { event_id: string; plan_id: string | null; guests_used: number; rounds_used: number; }

function UsageBar({ icon, label, used, limit, theme }: { icon: React.ReactNode; label: string; used: number; limit: number | null; theme: any }) {
  const unlimited = limit === null || limit === undefined;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const color = pct >= 90 ? theme.palette.error.main : pct >= 75 ? theme.palette.warning.main : theme.palette.primary.main;
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{icon}<Typography sx={{ fontWeight: 600 }}>{label}</Typography></Box>
        <Typography variant="body2" color="text.secondary">{used}{unlimited ? '' : ` / ${limit}`}{unlimited && ' (ללא הגבלה)'}</Typography>
      </Box>
      {!unlimited && (
        <LinearProgress variant="determinate" value={pct} sx={{ height: 10, borderRadius: 5, bgcolor: alpha(color, 0.15), '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 5 } }} />
      )}
    </Box>
  );
}

export default function Billing({ embedded = false }: { embedded?: boolean } = {}) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { selectedEvent } = useEvent();
  const { user } = useUser();
  const isStarter = useIsStarter();
  const planId = (selectedEvent as any)?.planId || (selectedEvent as any)?.plan_id || null;
  const plan = getPlan(planId);
  const planLoading = false;
  // Numeric ₪ value of a plan (prices are strings like "₪99").
  const priceNum = (s?: string) => parseInt((s || '').replace(/[^\d]/g, ''), 10) || 0;
  const currentPrice = priceNum(plan?.price);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [pickError, setPickError] = useState('');

  // Start an in-place plan change: create an order tied to THIS event, then go
  // to checkout. On payment the backend updates this event's plan (no new event).
  const startPlanChange = async (newPlanId: string) => {
    if (!selectedEvent?.id) return;
    // The order must carry buyer identity - provisioning looks the user up by
    // phone. For a logged-in owner we take it from their profile.
    const nameParts = (user?.username || '').trim().split(/\s+/).filter(Boolean);
    const firstName = user?.firstName || nameParts[0] || '';
    const lastName = user?.lastName || nameParts.slice(1).join(' ') || firstName;
    const phone = user?.phone || '';
    if (!phone || !firstName) {
      setPickError('כדי לשנות חבילה יש להשלים שם וטלפון בפרופיל.');
      return;
    }
    setSubmitting(newPlanId);
    setPickError('');
    try {
      const res = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: selectedEvent.id, plan: newPlanId, prev_plan: planId, event_name: selectedEvent.name }),
      });
      if (!res.ok) throw new Error('order failed');
      const data = await res.json();
      const oid = data.order_id || data.orderId;
      if (!oid) throw new Error('no order id');
      // Stash the per-order capability token before any further order call.
      saveOrderToken(oid, data.access_token);
      // Attach identity so payment → provisioning can resolve the owner.
      const idRes = await fetchWithAuth(`/api/orders/${encodeURIComponent(oid)}/identity`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...orderAuthHeaders(oid) },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, phone, email: user?.email || '' }),
      });
      if (!idRes.ok) throw new Error('identity failed');
      localStorage.setItem('pending_order_id', String(oid));
      navigate(`/payment?orderId=${encodeURIComponent(oid)}`);
    } catch {
      setPickError('שגיאה בפתיחת התשלום. נסו שוב.');
      setSubmitting(null);
    }
  };

  const load = useCallback(async () => {
    if (!selectedEvent?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithAuth(`/api/usage?event_id=${selectedEvent.id}`);
      if (!res.ok) throw new Error();
      setUsage(await res.json());
    } catch {
      setError('שגיאה בטעינת נתוני השימוש');
    } finally {
      setLoading(false);
    }
  }, [selectedEvent?.id]);

  useEffect(() => { load(); }, [load]);

  if (!selectedEvent) {
    return <Box sx={{ p: 4, direction: 'rtl', textAlign: 'center' }}><Typography variant="h6" color="text.secondary">אנא בחר אירוע</Typography></Box>;
  }

  const guestLimit = plan?.countLimit ?? null;
  const roundLimit = plan ? getCampaignsForPlan(planId).length : null;
  const nearLimit = guestLimit != null && usage != null && usage.guests_used / guestLimit >= 0.8;

  return (
    <Box sx={{ p: embedded ? 0 : { xs: 2, sm: 4 }, direction: 'rtl', maxWidth: embedded ? 'none' : 720, mx: 'auto' }}>
      {!embedded && <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>החבילה והשימוש שלי</Typography>}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>כמה אורחים וסבבים נותרו בחבילה של האירוע.</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading || planLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <>
          {/* Current plan - flat header, no card */}
          <Box sx={{ mb: 3 }}>
            {isStarter ? (
              <PlanBadge />
            ) : (
              <>
                <Stack useFlexGap direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{plan?.title || 'החבילה שלך'}</Typography>
                  {plan?.isPopular && <Chip size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }} label="הכי נבחרה" />}
                </Stack>
                {plan?.subtitle && <Typography variant="body2" color="text.secondary">{plan.subtitle}</Typography>}
              </>
            )}
          </Box>

          {/* Usage - flat section with a hairline top rule */}
          <Box sx={{ pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
            {usage ? (
              <>
                <UsageBar icon={<GroupsIcon color="primary" />} label="אורחים" used={usage.guests_used} limit={guestLimit} theme={theme} />
                <UsageBar icon={<CampaignIcon color="primary" />} label="סבבי הודעות" used={usage.rounds_used} limit={roundLimit} theme={theme} />
              </>
            ) : (
              // The fetch failed - don't render "0 / X" as if it were real data.
              <Box sx={{ mb: 3, py: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  לא הצלחנו לטעון את נתוני השימוש.
                </Typography>
                <Button variant="outlined" size="small" onClick={load} sx={{ borderRadius: 1.5 }}>
                  נסו שוב
                </Button>
              </Box>
            )}

            {nearLimit && (
              <Alert severity="warning" sx={{ mb: 2 }}>אתם מתקרבים למכסת האורחים. כדאי לשדרג כדי להוסיף עוד.</Alert>
            )}

            <Button fullWidth variant="contained" disableElevation startIcon={<UpgradeIcon />} onClick={() => setPickerOpen(true)} sx={{ borderRadius: 1.5, py: 1.25, boxShadow: 'none', bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }}>
              שינוי חבילה
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5, textAlign: 'center' }}>
            התשלום הוא על אורחים וסבבים - ההודעות עצמן כלולות וללא הגבלה.
          </Typography>
        </>
      )}

      {/* Plan picker → checkout (in-place upgrade of the current event) */}
      <Dialog open={pickerOpen} onClose={() => !submitting && setPickerOpen(false)} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: 3, direction: 'rtl' } }}>
        <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
          בחירת חבילה
          <IconButton onClick={() => !submitting && setPickerOpen(false)} sx={{ position: 'absolute', top: 10, insetInlineEnd: 10, color: 'text.secondary' }}>
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {pickError && <Alert severity="error" sx={{ mb: 2 }}>{pickError}</Alert>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mt: 1 }}>
            {plans.map((p) => {
              const current = p.id === planId;
              const busy = submitting === p.id;
              const delta = priceNum(p.price) - currentPrice;
              const isUpgrade = !current && delta > 0;
              // Starter pays the full plan price - "pay the difference" framing
              // only applies when moving between paid tiers.
              const showDelta = isUpgrade && currentPrice > 0;
              return (
                <Box key={p.id} sx={{
                  p: 2.5, borderRadius: 2.5, border: '1px solid',
                  borderColor: current ? 'primary.main' : 'divider',
                  bgcolor: current ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
                  opacity: !current && !isUpgrade ? 0.55 : 1,
                  display: 'flex', flexDirection: 'column',
                }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{p.title}</Typography>
                    {p.isPopular && <Chip size="small" label="הכי נבחרה" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{p.subtitle}</Typography>
                  {showDelta ? (
                    <Box sx={{ mb: 1.5 }}>
                      <Stack direction="row" alignItems="baseline" spacing={0.75}>
                        <Typography sx={{ fontWeight: 800, fontSize: 26, color: 'primary.main' }}>+₪{delta}</Typography>
                        <Typography variant="caption" color="text.secondary">להשלמת השדרוג</Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>{p.price}</Typography>
                    </Box>
                  ) : (
                    <Typography sx={{ fontWeight: 800, fontSize: 26, mb: 1.5 }}>{p.price}</Typography>
                  )}
                  <Stack spacing={0.75} sx={{ mb: 2.5, flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <GroupsIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">{p.countLimit == null ? 'אורחים ללא הגבלה' : `עד ${p.countLimit} אורחים`}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CampaignIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">{getCampaignsForPlan(p.id).length} סבבי הודעות</Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CheckRoundedIcon sx={{ fontSize: 17, color: 'success.main' }} />
                      <Typography variant="body2" color="text.secondary">כל היכולות כלולות</Typography>
                    </Stack>
                  </Stack>
                  {current ? (
                    <Button fullWidth disabled variant="outlined" startIcon={<CheckRoundedIcon />} sx={{ borderRadius: 1.5, textTransform: 'none' }}>
                      החבילה הנוכחית
                    </Button>
                  ) : isUpgrade ? (
                    <Button fullWidth variant="contained" disableElevation disabled={!!submitting} onClick={() => startPlanChange(p.id)}
                      sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, boxShadow: 'none', bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' } }}>
                      {busy ? <CircularProgress size={20} color="inherit" /> : showDelta ? `שדרוג · ₪${delta}` : `מעבר ל-${p.title} · ${p.price}`}
                    </Button>
                  ) : (
                    <Button fullWidth disabled variant="outlined" sx={{ borderRadius: 1.5, textTransform: 'none' }}>
                      חבילה נמוכה יותר
                    </Button>
                  )}
                </Box>
              );
            })}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5, textAlign: 'center' }}>
            {isStarter
              ? 'חבילת Starter כלולה באדיבות האולם - המחירים כאן הם המחיר המלא של כל חבילה. התשלום מאובטח וחל על האירוע הנוכחי בלבד.'
              : 'בשדרוג משלמים רק את ההפרש מהחבילה הנוכחית. התשלום מאובטח וחל על האירוע הנוכחי בלבד.'}
          </Typography>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
