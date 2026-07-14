import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface OrderRow {
  order_id: string;
  status: string;
  plan: string;
  prev_plan: string | null;
  coupon_code: string | null;
  event_id: string | null;
  event_name: string | null;
  buyer: string | null;
  phone: string | null;
  order_date: string | null;
}

function Subscriptions() {
  const theme = useTheme();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(rowsPerPage),
      });
      const res = await fetchWithAuth(`/api/admin/orders?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setOrders(data.orders || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת רכישות');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        מנויים / רכישות
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
        {loading && orders.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell sx={{ fontWeight: 700 }}>תאריך</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>אירוע</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>רוכש</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>טלפון</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>תוכנית</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>סטטוס</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>קופון</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.order_id} hover>
                    <TableCell>
                      {order.order_date
                        ? new Date(order.order_date).toLocaleDateString('he-IL')
                        : '-'}
                    </TableCell>
                    <TableCell>{order.event_name || '-'}</TableCell>
                    <TableCell>{order.buyer || '-'}</TableCell>
                    <TableCell dir="ltr" sx={{ textAlign: 'right', display: { xs: 'none', sm: 'table-cell' } }}>
                      {order.phone || '-'}
                    </TableCell>
                    <TableCell>{order.plan}</TableCell>
                    <TableCell>
                      <Chip
                        label={order.status}
                        size="small"
                        color={order.status === 'paid' ? 'success' : 'default'}
                        variant={order.status === 'paid' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      {order.coupon_code || '-'}
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">לא נמצאו רכישות</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100]}
              labelRowsPerPage="שורות בעמוד:"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} מתוך ${count}`}
            />
          </>
        )}
      </TableContainer>
    </Box>
  );
}

export default Subscriptions;
