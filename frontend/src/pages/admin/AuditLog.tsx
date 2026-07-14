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
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface AuditEntry {
  id: string;
  account_id: string | null;
  actor_type: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  data: any;
  occurred_at: string | null;
}

function AuditLog() {
  const theme = useTheme();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(rowsPerPage),
      });
      const res = await fetchWithAuth(`/api/admin/audit-log?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת יומן ביקורת');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const shortId = (id: string | null) => {
    if (!id) return '';
    return id.length > 8 ? `${id.slice(0, 8)}…` : id;
  };

  const dataString = (data: any) => {
    if (data === null || data === undefined) return '';
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  };

  const truncate = (s: string, max = 60) =>
    s.length > max ? `${s.slice(0, max)}…` : s;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        יומן ביקורת
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
        {loading && entries.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell sx={{ fontWeight: 700 }}>זמן</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>פעולה</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>סוג ישות</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>מבצע</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>פרטים</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry) => {
                  const full = dataString(entry.data);
                  return (
                    <TableRow key={entry.id} hover>
                      <TableCell>
                        {entry.occurred_at
                          ? new Date(entry.occurred_at).toLocaleString('he-IL')
                          : '-'}
                      </TableCell>
                      <TableCell>{entry.action}</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        {entry.entity_type || '-'}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        {(entry.actor_type || '-')} {shortId(entry.actor_id)}
                      </TableCell>
                      <TableCell
                        sx={{ display: { xs: 'none', md: 'table-cell' }, fontFamily: 'monospace', fontSize: '0.75rem' }}
                        title={full}
                      >
                        {truncate(full)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {entries.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">לא נמצאו רשומות</Typography>
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

export default AuditLog;
