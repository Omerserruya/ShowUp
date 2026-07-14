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
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface CouponRow {
  code: string;
  type: string;
  value: number;
  label: string | null;
}

function Coupons() {
  const theme = useTheme();

  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [defaultVenueCoupon, setDefaultVenueCoupon] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/coupons');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCoupons(data.coupons || []);
      setDefaultVenueCoupon(data.default_venue_coupon || '');
      setNote(data.note || '');
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת קופונים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  const typeLabel = (type: string) => {
    if (type === 'percent') return 'אחוז';
    if (type === 'amount' || type === 'fixed') return 'סכום';
    return type;
  };

  const valueLabel = (c: CouponRow) =>
    c.type === 'percent' ? `${c.value}%` : `${c.value}₪`;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        קופונים
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && coupons.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            {note && (
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {note}
              </Typography>
            )}
            <Typography variant="body2">
              קופון ברירת מחדל לאולמות: {defaultVenueCoupon || '-'}
            </Typography>
          </Alert>

          <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell sx={{ fontWeight: 700 }}>קוד</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>סוג</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>ערך</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>תיאור</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {coupons.map((coupon) => (
                  <TableRow key={coupon.code} hover>
                    <TableCell dir="ltr" sx={{ textAlign: 'right' }}>{coupon.code}</TableCell>
                    <TableCell>{typeLabel(coupon.type)}</TableCell>
                    <TableCell>{valueLabel(coupon)}</TableCell>
                    <TableCell>{coupon.label || '-'}</TableCell>
                  </TableRow>
                ))}
                {coupons.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">לא נמצאו קופונים</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}

export default Coupons;
