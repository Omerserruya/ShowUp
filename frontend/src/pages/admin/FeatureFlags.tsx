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
  TextField,
  Button,
  Stack,
  Switch,
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface FlagRow {
  key: string;
  enabled: boolean;
  description: string;
  updated_at: string | null;
}

function FeatureFlags() {
  const theme = useTheme();

  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New flag form
  const [newKey, setNewKey] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/feature-flags');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setFlags(data.flags);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת דגלים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const handleToggle = async (flag: FlagRow) => {
    try {
      const res = await fetchWithAuth(`/api/admin/feature-flags/${flag.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !flag.enabled, description: flag.description }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchFlags();
    } catch (e: any) {
      setError(e?.message || 'שגיאה בעדכון דגל');
    }
  };

  const handleAdd = async () => {
    const key = newKey.trim();
    if (!key) {
      setError('יש להזין מפתח דגל');
      return;
    }
    setAdding(true);
    try {
      const res = await fetchWithAuth(`/api/admin/feature-flags/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, description: newDescription.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewKey('');
      setNewDescription('');
      fetchFlags();
    } catch (e: any) {
      setError(e?.message || 'שגיאה בהוספת דגל');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        דגלי מערכת (Feature Flags)
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Add flag row */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'background.paper' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <TextField
            label="מפתח דגל"
            placeholder="example_flag"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            size="small"
            disabled={adding}
            sx={{ flex: 1 }}
          />
          <TextField
            label="תיאור"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            size="small"
            disabled={adding}
            sx={{ flex: 2 }}
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            disabled={adding || !newKey.trim()}
          >
            {adding ? <CircularProgress size={20} /> : 'הוסף דגל'}
          </Button>
        </Stack>
      </Paper>

      <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
        {loading && flags.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                <TableCell sx={{ fontWeight: 700 }}>מפתח</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>תיאור</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>פעיל</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {flags.map((flag) => (
                <TableRow key={flag.key} hover>
                  <TableCell dir="ltr" sx={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {flag.key}
                  </TableCell>
                  <TableCell>{flag.description}</TableCell>
                  <TableCell>
                    <Switch checked={flag.enabled} onChange={() => handleToggle(flag)} />
                  </TableCell>
                </TableRow>
              ))}
              {flags.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">לא נמצאו דגלים</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </TableContainer>
    </Box>
  );
}

export default FeatureFlags;
