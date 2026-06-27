import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';

type OrderOut = {
  order_id: string;
  status: string;
  plan?: string | null;
  event_name?: string | null;
  event_date?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export default function Payment() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const orderId = params.get('orderId') || '';
  const canceled = params.get('canceled') === '1';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderOut | null>(null);

  // iCount PayPage state
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        if (data.status === 'paid') setPaid(true);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load order');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canFetch, orderId]);

  // Poll order status while a payment is in progress; iCount provisions via IPN callback.
  useEffect(() => {
    if (!payUrl || paid) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as OrderOut;
        if (data.status === 'paid') {
          setPaid(true);
          if (pollRef.current) clearInterval(pollRef.current);
          setTimeout(() => navigate('/overview'), 1800);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [payUrl, paid, orderId, navigate]);

  const startPayment = async () => {
    setPayLoading(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/pay/icount`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 503
            ? 'תשלומים (iCount) אינם מוגדרים בשרת עדיין. יש להזין פרטי iCount ב-.env.'
            : body.detail || 'שגיאה בפתיחת התשלום',
        );
      }
      if (!body.url) throw new Error('iCount לא החזיר כתובת תשלום');
      setPayUrl(body.url);
    } catch (e: any) {
      setPayError(e.message);
    } finally {
      setPayLoading(false);
    }
  };

  if (paid) {
    return (
      <Box sx={{ maxWidth: 720, mx: 'auto', p: 3, direction: 'rtl', textAlign: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>התשלום התקבל! 🎉</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>מעבירים אותך ללוח הבקרה…</Typography>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', p: { xs: 2, sm: 3 }, direction: 'rtl' }}>
      <Typography variant="h5" sx={{ fontWeight: 900, mb: 2 }}>תשלום</Typography>

      {!orderId && <Alert severity="error" sx={{ mb: 2 }}>חסר orderId בכתובת.</Alert>}
      {canceled && !payUrl && <Alert severity="warning" sx={{ mb: 2 }}>התשלום בוטל. אפשר לנסות שוב.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {payError && <Alert severity="error" sx={{ mb: 2 }}>{payError}</Alert>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress /></Box>
      )}

      {order && !loading && (
        <Paper sx={{ p: 2, borderRadius: 2, mb: 2 }}>
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            {order.plan ? <Typography>חבילה: <strong>{order.plan}</strong></Typography> : null}
            {order.event_name ? <Typography>אירוע: {order.event_name}</Typography> : null}
            {order.event_date ? <Typography>תאריך: {new Date(order.event_date).toLocaleString('he-IL')}</Typography> : null}
            {(order.first_name || order.last_name) ? (
              <Typography>שם: {[order.first_name, order.last_name].filter(Boolean).join(' ')}</Typography>
            ) : null}
            {order.phone ? <Typography>טלפון: {order.phone}</Typography> : null}
          </Box>
        </Paper>
      )}

      {/* Embedded iCount PayPage iframe */}
      {payUrl ? (
        <Paper sx={{ p: 1, borderRadius: 2, overflow: 'hidden' }}>
          <Box
            component="iframe"
            title="iCount payment"
            src={payUrl}
            sx={{ width: '100%', height: { xs: 560, sm: 640 }, border: 'none' }}
          />
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
          <Button variant="outlined" onClick={() => navigate('/wizard')}>חזרה</Button>
          <Button variant="contained" onClick={startPayment} disabled={!orderId || payLoading}>
            {payLoading ? <CircularProgress size={22} color="inherit" /> : 'מעבר לתשלום'}
          </Button>
        </Box>
      )}
    </Box>
  );
}
