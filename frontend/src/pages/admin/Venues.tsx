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
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Tooltip,
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Edit as EditIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface VenueRow {
  id: string;
  name: string;
  type: string;
  status: string;
  event_capacity: number | null;
  events_used: number;
  partner_coupon_code: string | null;
  branding: any;
  created_at: string | null;
}

function Venues() {
  const theme = useTheme();

  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editVenue, setEditVenue] = useState<VenueRow | null>(null);
  const [editCapacity, setEditCapacity] = useState('');
  const [editCoupon, setEditCoupon] = useState('');
  const [saving, setSaving] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAdminPhone, setCreateAdminPhone] = useState('');
  const [createAdminFirstName, setCreateAdminFirstName] = useState('');
  const [createAdminLastName, setCreateAdminLastName] = useState('');
  const [createCapacity, setCreateCapacity] = useState('');
  const [createCoupon, setCreateCoupon] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteVenue, setDeleteVenue] = useState<VenueRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchVenues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/venues');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setVenues(data.venues);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת אולמות');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  const handleToggleStatus = async (venue: VenueRow) => {
    const nextStatus = venue.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetchWithAuth(`/api/admin/venues/${venue.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchVenues();
    } catch (e: any) {
      setError(e?.message || 'שגיאה בעדכון סטטוס');
    }
  };

  const handleOpenCreate = () => {
    setCreateName('');
    setCreateAdminPhone('');
    setCreateAdminFirstName('');
    setCreateAdminLastName('');
    setCreateCapacity('');
    setCreateCoupon('');
    setCreateOpen(true);
  };

  const handleSaveCreate = async () => {
    setCreating(true);
    try {
      const cap = createCapacity.trim();
      const res = await fetchWithAuth('/api/admin/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          admin_phone: createAdminPhone.trim(),
          admin_first_name: createAdminFirstName.trim() || undefined,
          admin_last_name: createAdminLastName.trim() || undefined,
          event_capacity: cap === '' ? null : Number(cap),
          partner_coupon_code: createCoupon.trim() === '' ? null : createCoupon.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCreateOpen(false);
      fetchVenues();
    } catch (e: any) {
      setError(e?.message || 'שגיאה ביצירת אולם');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (venue: VenueRow) => {
    setDeleteVenue(venue);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteVenue) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/venues/${deleteVenue.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
      setDeleteOpen(false);
      setDeleteVenue(null);
      fetchVenues();
    } catch (e: any) {
      setError(e?.message || 'שגיאה במחיקת אולם');
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = (venue: VenueRow) => {
    setEditVenue(venue);
    setEditCapacity(venue.event_capacity != null ? String(venue.event_capacity) : '');
    setEditCoupon(venue.partner_coupon_code || '');
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editVenue) return;
    setSaving(true);
    try {
      const trimmed = editCapacity.trim();
      const res = await fetchWithAuth(`/api/admin/venues/${editVenue.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_capacity: trimmed === '' ? null : Number(trimmed),
          partner_coupon_code: editCoupon.trim() === '' ? null : editCoupon.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditOpen(false);
      setEditVenue(null);
      fetchVenues();
    } catch (e: any) {
      setError(e?.message || 'שגיאה בעדכון אולם');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          אולמות
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          אולם חדש
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        מכסה = אירועים לחודש
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
        {loading && venues.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                <TableCell sx={{ fontWeight: 700 }}>שם</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>סטטוס</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>מכסה חודשית</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>בשימוש</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>קופון שותף</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>פעולות</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {venues.map((venue) => (
                <TableRow key={venue.id} hover>
                  <TableCell>{venue.name}</TableCell>
                  <TableCell>
                    <Chip
                      label={venue.status === 'active' ? 'פעיל' : 'מושהה'}
                      size="small"
                      color={venue.status === 'active' ? 'success' : 'error'}
                      variant="filled"
                    />
                  </TableCell>
                  <TableCell>
                    {venue.event_capacity != null ? venue.event_capacity : 'ללא הגבלה'}
                  </TableCell>
                  <TableCell>{venue.events_used}</TableCell>
                  <TableCell>{venue.partner_coupon_code || '-'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title={venue.status === 'active' ? 'השהה' : 'הפעל מחדש'}>
                        <IconButton
                          size="small"
                          color={venue.status === 'active' ? 'error' : 'success'}
                          onClick={() => handleToggleStatus(venue)}
                        >
                          {venue.status === 'active' ? (
                            <BlockIcon fontSize="small" />
                          ) : (
                            <CheckCircleIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="עריכה">
                        <IconButton size="small" onClick={() => handleEdit(venue)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="מחיקה">
                        <IconButton size="small" color="error" onClick={() => handleDelete(venue)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {venues.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">לא נמצאו אולמות</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Create Dialog */}
      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>אולם חדש</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="שם האולם"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              fullWidth
              required
              disabled={creating}
            />
            <TextField
              label="טלפון מנהל האולם"
              placeholder="+9725..."
              value={createAdminPhone}
              onChange={(e) => setCreateAdminPhone(e.target.value)}
              fullWidth
              required
              disabled={creating}
              inputProps={{ dir: 'ltr' }}
              helperText="המנהל יתחבר עם מספר זה (קוד חד-פעמי)"
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="שם פרטי (מנהל)"
                value={createAdminFirstName}
                onChange={(e) => setCreateAdminFirstName(e.target.value)}
                fullWidth
                disabled={creating}
              />
              <TextField
                label="שם משפחה (מנהל)"
                value={createAdminLastName}
                onChange={(e) => setCreateAdminLastName(e.target.value)}
                fullWidth
                disabled={creating}
              />
            </Stack>
            <TextField
              label="מכסה חודשית (ריק = ללא הגבלה)"
              type="number"
              value={createCapacity}
              onChange={(e) => setCreateCapacity(e.target.value)}
              fullWidth
              disabled={creating}
            />
            <TextField
              label="קופון שותף (אופציונלי)"
              value={createCoupon}
              onChange={(e) => setCreateCoupon(e.target.value)}
              fullWidth
              disabled={creating}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveCreate}
            disabled={creating || !createName.trim() || !createAdminPhone.trim()}
          >
            {creating ? <CircularProgress size={20} /> : 'צור'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>מחיקת אולם</DialogTitle>
        <DialogContent>
          <Typography>
            האם למחוק את האולם <strong>{deleteVenue?.name}</strong>?
          </Typography>
          {!!deleteVenue?.events_used && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              פעולה זו תמחק גם {deleteVenue.events_used} אירועים משויכים וכל הנתונים שלהם.
            </Typography>
          )}
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            פעולה זו אינה ניתנת לביטול.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>
            ביטול
          </Button>
          <Button variant="contained" color="error" onClick={confirmDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={20} /> : 'מחק'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={() => !saving && setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>עריכת אולם</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="מכסה חודשית (ריק = ללא הגבלה)"
              type="number"
              value={editCapacity}
              onChange={(e) => setEditCapacity(e.target.value)}
              fullWidth
              disabled={saving}
            />
            <TextField
              label="קופון שותף"
              value={editCoupon}
              onChange={(e) => setEditCoupon(e.target.value)}
              fullWidth
              disabled={saving}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={saving}>
            ביטול
          </Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'שמור'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Venues;
