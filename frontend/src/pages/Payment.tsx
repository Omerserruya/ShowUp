import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Button, CircularProgress, Paper, Typography } from '@mui/material';

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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderOut | null>(null);

  const canFetch = useMemo(() => Boolean(orderId), [orderId]);

  useEffect(() => {
    if (!canFetch) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'GET' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load order');
        return (await res.json()) as OrderOut;
      })
      .then((data) => {
        if (cancelled) return;
        setOrder(data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load order');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canFetch, orderId]);

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: { xs: 2, sm: 3 }, direction: 'rtl' }}>
      <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
        תשלום
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        שלב התשלום עדיין בבנייה. בינתיים אנחנו רק יוצרים הזמנה ושומרים את ה־orderId כדי לאפשר חזרה.
      </Typography>

      <Paper sx={{ p: 2, borderRadius: 2 }}>
        {!orderId && (
          <Typography color="error" sx={{ fontWeight: 700 }}>
            חסר orderId בכתובת.
          </Typography>
        )}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Typography color="error" sx={{ fontWeight: 700 }}>
            {error}
          </Typography>
        )}

        {order && !loading && !error && (
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            <Typography sx={{ fontWeight: 800 }}>orderId: {order.order_id}</Typography>
            <Typography>סטטוס: {order.status}</Typography>
            {order.plan ? <Typography>חבילה: {order.plan}</Typography> : null}
            {order.event_name ? <Typography>אירוע: {order.event_name}</Typography> : null}
            {order.event_date ? <Typography>תאריך: {new Date(order.event_date).toLocaleString('he-IL')}</Typography> : null}
            {order.first_name || order.last_name ? (
              <Typography>שם: {[order.first_name, order.last_name].filter(Boolean).join(' ')}</Typography>
            ) : null}
            {order.phone ? <Typography>טלפון: {order.phone}</Typography> : null}
            {order.email ? <Typography>אימייל: {order.email}</Typography> : null}
          </Box>
        )}
      </Paper>

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-start', mt: 2 }}>
        <Button variant="outlined" onClick={() => navigate('/wizard')}>
          חזרה ל־Wizard
        </Button>
        <Button variant="contained" disabled>
          לתשלום
        </Button>
      </Box>
    </Box>
  );
}

