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
  Chip,
  useTheme,
  alpha,
} from '@mui/material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

// Landing-page leads: who asked for a sample WhatsApp message / sample call.
interface LeadRow {
  phone: string;
  name: string | null;
  kinds: string[];
  requests: number;
  first_at: string;
  last_at: string;
  signed_up: boolean;
  events: number;
}

const KIND_LABEL: Record<string, string> = { whatsapp: 'הודעה בוואטסאפ', call: 'שיחת טלפון' };

const localPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  const local = d.startsWith('972') ? `0${d.slice(3)}` : d;
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3)}` : local;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });

function Leads() {
  const theme = useTheme();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [new7d, setNew7d] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/leads?days=365');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setLeads(data.leads || []);
      setNew7d(data.new_7d || 0);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת הפניות');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const status = (l: LeadRow) => {
    if (l.events > 0) return <Chip size="small" color="success" label={l.events > 1 ? `פתח ${l.events} אירועים` : 'פתח אירוע'} />;
    if (l.signed_up) return <Chip size="small" color="info" label="נרשם, עוד בלי אירוע" />;
    return <Chip size="small" variant="outlined" label="עוד לא נרשם" />;
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        פניות
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        כל מי שביקש בדף הבית הודעת בדיקה בוואטסאפ או שיחת בדיקה.
        {leads.length > 0 && ` ${leads.length} פניות, ${new7d} מהן בשבוע האחרון.`}
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && leads.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                <TableCell sx={{ fontWeight: 700 }}>שם</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>טלפון</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>ביקש</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>מתי</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>מה קרה אחר כך</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.phone} hover>
                  <TableCell>{l.name || '-'}</TableCell>
                  <TableCell dir="ltr" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <a href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{localPhone(l.phone)}</a>
                  </TableCell>
                  <TableCell>
                    {l.kinds.map((k) => KIND_LABEL[k] || k).join(' + ')}
                    {l.requests > 1 && <Typography component="span" variant="caption" color="text.secondary"> · {l.requests} פעמים</Typography>}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{when(l.last_at)}</TableCell>
                  <TableCell>{status(l)}</TableCell>
                </TableRow>
              ))}
              {leads.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">עדיין אין פניות</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export default Leads;
