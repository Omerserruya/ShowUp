import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Fade,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import PriceSummary from '../components/PriceSummary';
import AuthLayout, { AuthPanel } from '../components/AuthLayout';
import { getPlan } from '../config/plans';
import { breakdownFromPrice, PriceBreakdown, TAX_RATE } from '../utils/pricing';
import { fireConfetti } from '../utils/confetti';
import { clearWizardDraft } from '../utils/wizardDraft';

const BRAND = '#888cee';
const DEEP = '#6f74e0';

type OrderOut = {
  order_id: string;
  status: string;
  event_id?: string | null;
  plan?: string | null;
  event_name?: string | null;
  event_date?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  amount_subtotal?: number | null;
  amount_discount?: number | null;
  amount_gross?: number | null;
  amount_net?: number | null;
  amount_vat?: number | null;
  tax_rate?: number | null;
  coupon_code?: string | null;
  currency?: string | null;
};

// What the customer gets the moment they pay - shown on the branded left panel.
const afterPayment = [
  'האירוע שלכם נוצר ומוכן לניהול',
  'דף הזמנה אישי מוכן לשיתוף',
  'אפשר לייבא אורחים בכל רגע',
  'ההודעות יוצאות לבד, לפי לוח הזמנים שבחרתם',
];

const trustBadges: { icon: React.ReactNode; label: string }[] = [
  { icon: <WhatsAppIcon sx={{ fontSize: 18 }} />, label: 'WhatsApp רשמי' },
  { icon: <LockRoundedIcon sx={{ fontSize: 18 }} />, label: 'תשלום מאובטח' },
  { icon: <CheckCircleRoundedIcon sx={{ fontSize: 18 }} />, label: 'תשלום חד-פעמי' },
  { icon: <RepeatRoundedIcon sx={{ fontSize: 18, textDecoration: 'line-through' }} />, label: 'בלי מנוי' },
];

export default function Payment() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const orderId = params.get('orderId') || '';
  const canceled = params.get('canceled') === '1';
  // iCount redirects back here with paid=1 after a successful charge.
  const returnedPaid = params.get('paid') === '1';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderOut | null>(null);

  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const celebrated = useRef(false);

  const canFetch = useMemo(() => Boolean(orderId), [orderId]);

  // Load the order
  useEffect(() => {
    if (!canFetch) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/orders/${encodeURIComponent(orderId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load order');
        return (await res.json()) as OrderOut;
      })
      .then((data) => {
        if (cancelled) return;
        setOrder(data);
        if (data.status === 'paid') {
          // Open the freshly created event on the dashboard, not a stale one.
          if (data.event_id) localStorage.setItem('selected_event_id', String(data.event_id));
          localStorage.removeItem('pending_order_id'); // checkout finished
          setDone(true);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load order');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canFetch, orderId]);

  // After returning from a successful payment, wait for the server to provision
  // the order (iCount IPN -> provision_order sets status='paid'), then go home.
  useEffect(() => {
    if (!returnedPaid || done || !orderId) return;
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
        if (res.ok) {
          const data = (await res.json()) as OrderOut;
          if (data.status === 'paid') {
            // Select the newly provisioned event so the dashboard opens it directly.
            if (data.event_id) localStorage.setItem('selected_event_id', String(data.event_id));
            localStorage.removeItem('pending_order_id'); // checkout finished
            setDone(true);
            if (pollRef.current) clearInterval(pollRef.current);
            setTimeout(() => navigate('/overview'), 1800);
            return;
          }
        }
      } catch {
        /* keep polling */
      }
      if (tries >= 12) {
        if (pollRef.current) clearInterval(pollRef.current);
        navigate('/overview');
      }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [returnedPaid, done, orderId, navigate]);

  // Celebrate the moment payment is confirmed (once) and retire the wizard draft.
  useEffect(() => {
    if ((done || returnedPaid) && !celebrated.current) {
      celebrated.current = true;
      clearWizardDraft();
      fireConfetti(2200);
    }
  }, [done, returnedPaid]);

  const startPayment = async () => {
    setPayLoading(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/pay/icount`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 503
            ? 'תשלומים (iCount) אינם מוגדרים בשרת עדיין.'
            : body.detail || 'שגיאה בפתיחת התשלום',
        );
      }
      if (!body.url) throw new Error('iCount לא החזיר כתובת תשלום');
      window.location.href = body.url;
    } catch (e: any) {
      setPayError(e.message);
      setPayLoading(false);
    }
  };

  // Success / provisioning screen (post-payment).
  if (done || returnedPaid) {
    return (
      <Fade in timeout={500}>
        <Box sx={{ maxWidth: 720, mx: 'auto', p: 3, direction: 'rtl', textAlign: 'center', minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ width: 84, height: 84, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 3, bgcolor: alpha(theme.palette.success.main, 0.12), color: 'success.main' }}>
            <CheckCircleRoundedIcon sx={{ fontSize: 52 }} />
          </Box>
          <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>שולם! מכאן זה עלינו 🎉</Typography>
          <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 420 }}>
            {done
              ? 'הכול מוכן. מעבירים אתכם ללוח הבקרה כדי להתחיל לארגן את האירוע.'
              : 'מאמתים את התשלום ומכינים לכם את האירוע… עוד רגע קט.'}
          </Typography>
          <CircularProgress />
        </Box>
      </Fade>
    );
  }

  const plan = order?.plan ? getPlan(order.plan) : undefined;
  const breakdown: PriceBreakdown | undefined =
    order && order.amount_gross != null
      ? {
          gross: order.amount_gross,
          net: order.amount_net ?? 0,
          vat: order.amount_vat ?? 0,
          taxRate: order.tax_rate ?? TAX_RATE,
          subtotal: order.amount_subtotal ?? order.amount_gross,
          discount: order.amount_discount ?? 0,
          couponCode: order.coupon_code ?? undefined,
        }
      : plan
      ? breakdownFromPrice(plan.price)
      : undefined;

  const buyerName = [order?.first_name, order?.last_name].filter(Boolean).join(' ');
  const eventDateLabel = order?.event_date
    ? new Date(order.event_date).toLocaleString('he-IL', { dateStyle: 'long', timeStyle: 'short' })
    : null;

  const DetailRow = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ color: BRAND, display: 'flex' }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{value}</Typography>
      </Box>
    </Box>
  );

  // ---- Left branded panel: what happens after payment + trust badges ----
  const leftPanel = (
    <AuthPanel>
      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: '1.7rem', lineHeight: 1.2, mb: 3 }}>
          מה קורה ברגע שמסיימים
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
          {afterPayment.map((t) => (
            <Box key={t} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
              <CheckCircleRoundedIcon sx={{ fontSize: 22, color: '#fff', mt: '1px', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '1.05rem', lineHeight: 1.5 }}>{t}</Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 4 }}>
          {trustBadges.map((b) => (
            <Box
              key={b.label}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 0.75,
                borderRadius: 999,
                bgcolor: alpha('#ffffff', 0.16),
                border: `1px solid ${alpha('#ffffff', 0.28)}`,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {b.icon}
              {b.label}
            </Box>
          ))}
        </Box>
      </Box>
    </AuthPanel>
  );

  return (
    <AuthLayout panel={leftPanel}>
      <Box sx={{ direction: 'rtl', textAlign: 'right' }}>
        <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '2rem', md: '2.4rem' }, lineHeight: 1.15 }}>
          🎉 כמעט שם!
        </Typography>
        <Typography sx={{ color: 'text.secondary', mt: 1.5, mb: 4, fontSize: '1.05rem', lineHeight: 1.6 }}>
          עוד צעד קטן אחד, ומכאן אנחנו דואגים לאירוע שלכם.
        </Typography>

        {!orderId && <Alert severity="error" sx={{ mb: 2 }}>חסר מזהה הזמנה בכתובת.</Alert>}
        {canceled && <Alert severity="warning" sx={{ mb: 2 }}>התשלום בוטל, לא חויבתם. אפשר לנסות שוב מתי שבא לכם.</Alert>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {payError && <Alert severity="error" sx={{ mb: 2 }}>{payError}</Alert>}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {order && !loading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Package card */}
            <Box sx={{ borderRadius: 4, overflow: 'hidden', bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`, boxShadow: `0 16px 44px ${alpha(BRAND, 0.16)}` }}>
              <Box sx={{ p: 3, color: '#fff', background: `linear-gradient(135deg, ${DEEP}, ${BRAND})`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="overline" sx={{ opacity: 0.85, letterSpacing: 1 }}>החבילה שלכם</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.1 }}>{plan?.title || order.plan}</Typography>
                  {plan?.subtitle && <Typography variant="body2" sx={{ opacity: 0.92, mt: 0.5 }}>{plan.subtitle}</Typography>}
                </Box>
                {plan?.isPopular && (
                  <Chip label="הכי פופולרי" size="small" sx={{ fontWeight: 700, color: '#fff', bgcolor: 'rgba(255,255,255,0.22)' }} />
                )}
              </Box>
              <Box sx={{ p: 3 }}>
                {plan?.features?.length ? (
                  <Box sx={{ display: 'grid', gap: 1, mb: 2.5 }}>
                    {plan.features.slice(0, 4).map((f) => (
                      <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        <CheckCircleRoundedIcon sx={{ fontSize: 19, color: BRAND }} />
                        <Typography variant="body2">{f}</Typography>
                      </Box>
                    ))}
                  </Box>
                ) : null}
                {breakdown ? <PriceSummary breakdown={breakdown} /> : (
                  <Typography color="text.secondary">לא נמצא מחיר לחבילה.</Typography>
                )}
              </Box>
            </Box>

            {/* Event + customer details */}
            <Box sx={{ borderRadius: 3, border: `1px solid ${theme.palette.divider}`, p: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'text.secondary', mb: 2 }}>פרטי האירוע</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
                {order.event_name && <DetailRow icon={<EventRoundedIcon fontSize="small" />} label="האירוע" value={order.event_name} />}
                {eventDateLabel && <DetailRow icon={<CalendarMonthRoundedIcon fontSize="small" />} label="תאריך ושעה" value={eventDateLabel} />}
                {buyerName && <DetailRow icon={<PersonRoundedIcon fontSize="small" />} label="לחשבון של" value={buyerName} />}
                {order.phone && <DetailRow icon={<CreditCardRoundedIcon fontSize="small" />} label="טלפון" value={order.phone} />}
              </Box>
            </Box>

            {/* Primary CTA */}
            <Button
              fullWidth
              variant="contained"
              startIcon={!payLoading ? <LockRoundedIcon /> : undefined}
              onClick={startPayment}
              disabled={!orderId || payLoading}
              sx={{
                py: 1.5,
                borderRadius: 2.5,
                fontSize: '1.05rem',
                fontWeight: 700,
                textTransform: 'none',
                color: '#fff',
                bgcolor: '#111827',
                boxShadow: 'none',
                '&:hover': { bgcolor: '#000', boxShadow: '0 12px 28px rgba(0,0,0,0.28)' },
                '&.Mui-disabled': { bgcolor: alpha('#111827', 0.4), color: '#fff' },
              }}
            >
              {payLoading ? <CircularProgress size={24} color="inherit" /> : 'מעבר לתשלום מאובטח'}
            </Button>

            {/* Payment trust */}
            <Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2, color: 'text.secondary' }}>
                {[
                  { icon: <LockRoundedIcon sx={{ fontSize: 16 }} />, t: 'SSL' },
                  { icon: <VerifiedUserRoundedIcon sx={{ fontSize: 16 }} />, t: 'תקן PCI' },
                  { icon: <CreditCardRoundedIcon sx={{ fontSize: 16 }} />, t: 'סליקה ב‑iCount' },
                ].map((x) => (
                  <Box key={x.t} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {x.icon}
                    <Typography variant="caption">{x.t}</Typography>
                  </Box>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1.25 }}>
                מקבלים Visa · Mastercard · American Express · Apple Pay
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}>
                התשלום מתבצע בעמוד מאובטח של iCount. בסיום תחזרו לכאן אוטומטית.
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </AuthLayout>
  );
}
