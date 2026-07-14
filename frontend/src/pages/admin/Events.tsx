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
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Switch,
  FormControlLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Collapse,
  List,
  ListItem,
  ListItemText,
  Divider,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  People as PeopleIcon,
  Campaign as CampaignIcon,
} from '@mui/icons-material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { parseLocation } from '../../config/messaging';

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  event_date: string | null;
  location: string | null;
  active: boolean;
  guest_count: number;
  campaign_count: number;
  created_at: string | null;
}

interface GuestRow {
  id: string;
  name: string;
  phone: string;
  status: string;
  group: string;
  import_count: number;
  guest_count: number | null;
}

interface CampaignRow {
  id: string;
  name: string;
  template: string;
  channel: string;
  status: string;
  schedule_time: string | null;
  recipient_count: number;
}

function Events() {
  const theme = useTheme();

  const [events, setEvents] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedGuests, setExpandedGuests] = useState<GuestRow[]>([]);
  const [expandedCampaigns, setExpandedCampaigns] = useState<CampaignRow[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEvent, setDeleteEvent] = useState<EventRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('wedding');
  const [createDate, setCreateDate] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [createPaid, setCreatePaid] = useState(true);
  const [createOwnerPhone, setCreateOwnerPhone] = useState('');
  const [createOwnerFirst, setCreateOwnerFirst] = useState('');
  const [createOwnerLast, setCreateOwnerLast] = useState('');
  const [creating, setCreating] = useState(false);

  const handleOpenCreate = () => {
    setCreateName('');
    setCreateType('wedding');
    setCreateDate('');
    setCreateLocation('');
    setCreatePaid(true);
    setCreateOwnerPhone('');
    setCreateOwnerFirst('');
    setCreateOwnerLast('');
    setCreateOpen(true);
  };

  const handleSaveCreate = async () => {
    setCreating(true);
    try {
      const res = await fetchWithAuth('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          event_type: createType || null,
          event_date: createDate ? new Date(createDate).toISOString() : null,
          location: createLocation.trim() || null,
          paid: createPaid,
          owner_phone: createOwnerPhone.trim() || null,
          owner_first_name: createOwnerFirst.trim() || null,
          owner_last_name: createOwnerLast.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCreateOpen(false);
      fetchEvents();
    } catch (e: any) {
      setError(e?.message || 'שגיאה ביצירת אירוע');
    } finally {
      setCreating(false);
    }
  };

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(rowsPerPage),
      });
      if (search) params.set('search', search);
      const res = await fetchWithAuth(`/api/admin/events?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setEvents(data.events);
      setTotal(data.total);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת אירועים');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleExpand = async (eventId: string) => {
    if (expandedId === eventId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(eventId);
    setExpandLoading(true);
    try {
      const [guestsRes, campaignsRes] = await Promise.all([
        fetchWithAuth(`/api/admin/events/${eventId}/guests?page_size=50`),
        fetchWithAuth(`/api/admin/events/${eventId}/campaigns?page_size=50`),
      ]);
      if (guestsRes.ok) {
        const gData = await guestsRes.json();
        setExpandedGuests(gData.guests || []);
      }
      if (campaignsRes.ok) {
        const cData = await campaignsRes.json();
        setExpandedCampaigns(cData.campaigns || []);
      }
    } catch {
      // Silently handle
    } finally {
      setExpandLoading(false);
    }
  };

  const handleEdit = (event: EventRow) => {
    setEditEvent(event);
    setEditName(event.name);
    setEditLocation(event.location || '');
    setEditActive(event.active);
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editEvent) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/events/${editEvent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          location: editLocation,
          active: editActive,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditOpen(false);
      setEditEvent(null);
      fetchEvents();
    } catch (e: any) {
      setError(e?.message || 'שגיאה בעדכון אירוע');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (event: EventRow) => {
    setDeleteEvent(event);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteEvent) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/events/${deleteEvent.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
      setDeleteOpen(false);
      setDeleteEvent(null);
      if (expandedId === deleteEvent.id) setExpandedId(null);
      fetchEvents();
    } catch (e: any) {
      setError(e?.message || 'שגיאה במחיקת אירוע');
    } finally {
      setDeleting(false);
    }
  };

  const statusLabels: Record<string, string> = {
    invited: 'הוזמן',
    pending: 'ממתין',
    attending: 'מגיע',
    confirmed: 'אישר',
    declined: 'סירב',
    maybe: 'אולי',
  };

  const campaignStatusLabels: Record<string, string> = {
    pending: 'ממתין',
    sent: 'נשלח',
    paused: 'מושהה',
    processing: 'בעיבוד',
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>אירועים</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          אירוע חדש
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Search */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'background.paper' }}>
        <TextField
          fullWidth
          placeholder="חיפוש לפי שם אירוע..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          size="small"
        />
      </Paper>

      {/* Events Table */}
      <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
        {loading && events.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell sx={{ fontWeight: 700, width: 40 }} />
                  <TableCell sx={{ fontWeight: 700 }}>שם האירוע</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>תאריך</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>מיקום</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>פעיל</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>אורחים</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>קמפיינים</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>פעולות</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((event) => (
                  <React.Fragment key={event.id}>
                    <TableRow hover>
                      <TableCell>
                        <IconButton size="small" onClick={() => handleExpand(event.id)}>
                          {expandedId === event.id ? (
                            <ExpandLessIcon fontSize="small" />
                          ) : (
                            <ExpandMoreIcon fontSize="small" />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {event.name}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        {event.event_date
                          ? new Date(event.event_date).toLocaleDateString('he-IL')
                          : '-'}
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        {parseLocation(event.location).name || '-'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={event.active ? 'פעיל' : 'לא פעיל'}
                          size="small"
                          color={event.active ? 'success' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>{event.guest_count}</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                        {event.campaign_count}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          <IconButton size="small" onClick={() => handleEdit(event)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => handleDelete(event)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </TableCell>
                    </TableRow>

                    {/* Expanded Row - Guests & Campaigns */}
                    <TableRow>
                      <TableCell colSpan={8} sx={{ py: 0, border: 0 }}>
                        <Collapse in={expandedId === event.id} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 2, px: 1 }}>
                            {expandLoading ? (
                              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <CircularProgress size={24} />
                              </Box>
                            ) : (
                              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                                {/* Guests */}
                                <Box sx={{ flex: 1 }}>
                                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                    <PeopleIcon fontSize="small" color="primary" />
                                    <Typography variant="subtitle2" fontWeight={700}>
                                      אורחים ({expandedGuests.length})
                                    </Typography>
                                  </Stack>
                                  {expandedGuests.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">
                                      אין אורחים
                                    </Typography>
                                  ) : (
                                    <Paper variant="outlined" sx={{ maxHeight: 250, overflow: 'auto' }}>
                                      <List dense disablePadding>
                                        {expandedGuests.map((g, i) => (
                                          <React.Fragment key={g.id}>
                                            {i > 0 && <Divider />}
                                            <ListItem>
                                              <ListItemText
                                                primary={g.name}
                                                secondary={`${g.phone} | ${statusLabels[g.status] || g.status}`}
                                              />
                                              <Chip
                                                label={`${g.guest_count ?? g.import_count}`}
                                                size="small"
                                                variant="outlined"
                                              />
                                            </ListItem>
                                          </React.Fragment>
                                        ))}
                                      </List>
                                    </Paper>
                                  )}
                                </Box>

                                {/* Campaigns */}
                                <Box sx={{ flex: 1 }}>
                                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                    <CampaignIcon fontSize="small" color="primary" />
                                    <Typography variant="subtitle2" fontWeight={700}>
                                      קמפיינים ({expandedCampaigns.length})
                                    </Typography>
                                  </Stack>
                                  {expandedCampaigns.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">
                                      אין קמפיינים
                                    </Typography>
                                  ) : (
                                    <Paper variant="outlined" sx={{ maxHeight: 250, overflow: 'auto' }}>
                                      <List dense disablePadding>
                                        {expandedCampaigns.map((c, i) => (
                                          <React.Fragment key={c.id}>
                                            {i > 0 && <Divider />}
                                            <ListItem>
                                              <ListItemText
                                                primary={c.name}
                                                secondary={`${campaignStatusLabels[c.status] || c.status} | ${c.recipient_count} נמענים`}
                                              />
                                              {c.schedule_time && (
                                                <Typography variant="caption" color="text.secondary">
                                                  {new Date(c.schedule_time).toLocaleDateString('he-IL')}
                                                </Typography>
                                              )}
                                            </ListItem>
                                          </React.Fragment>
                                        ))}
                                      </List>
                                    </Paper>
                                  )}
                                </Box>
                              </Stack>
                            )}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                ))}
                {events.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">לא נמצאו אירועים</Typography>
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
              labelRowsPerPage="שורות בעמוד:"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} מתוך ${count}`}
            />
          </>
        )}
      </TableContainer>

      {/* Create Dialog */}
      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>אירוע חדש</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="שם האירוע"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              fullWidth
              required
              disabled={creating}
            />
            <FormControl fullWidth disabled={creating}>
              <InputLabel>סוג אירוע</InputLabel>
              <Select value={createType} label="סוג אירוע" onChange={(e) => setCreateType(e.target.value)}>
                <MenuItem value="wedding">חתונה</MenuItem>
                <MenuItem value="brit">ברית</MenuItem>
                <MenuItem value="brita">בריתה</MenuItem>
                <MenuItem value="bar">בר מצווה</MenuItem>
                <MenuItem value="bat">בת מצווה</MenuItem>
                <MenuItem value="birthday">יום הולדת</MenuItem>
                <MenuItem value="corporate">אירוע חברה</MenuItem>
                <MenuItem value="other">אחר</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="תאריך ושעה"
              type="datetime-local"
              value={createDate}
              onChange={(e) => setCreateDate(e.target.value)}
              fullWidth
              disabled={creating}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="מיקום"
              value={createLocation}
              onChange={(e) => setCreateLocation(e.target.value)}
              fullWidth
              disabled={creating}
            />
            <FormControlLabel
              control={<Switch checked={createPaid} onChange={(e) => setCreatePaid(e.target.checked)} disabled={creating} />}
              label={createPaid ? 'משולם (paid)' : 'לא משולם (unpaid)'}
            />

            <Divider textAlign="right" sx={{ pt: 1 }}>
              <Typography variant="caption" color="text.secondary">בעל/ת האירוע</Typography>
            </Divider>
            <TextField
              label="טלפון בעל/ת האירוע"
              placeholder="+9725..."
              value={createOwnerPhone}
              onChange={(e) => setCreateOwnerPhone(e.target.value)}
              fullWidth
              disabled={creating}
              inputProps={{ dir: 'ltr' }}
              helperText="ריק = האירוע ישויך אליך (המנהל). אחרת ייווצר משתמש חדש כבעלים."
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="שם פרטי"
                value={createOwnerFirst}
                onChange={(e) => setCreateOwnerFirst(e.target.value)}
                fullWidth
                disabled={creating || !createOwnerPhone.trim()}
              />
              <TextField
                label="שם משפחה"
                value={createOwnerLast}
                onChange={(e) => setCreateOwnerLast(e.target.value)}
                fullWidth
                disabled={creating || !createOwnerPhone.trim()}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            ביטול
          </Button>
          <Button variant="contained" onClick={handleSaveCreate} disabled={creating || !createName.trim()}>
            {creating ? <CircularProgress size={20} /> : 'צור'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={() => !saving && setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>עריכת אירוע</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="שם האירוע"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              fullWidth
              disabled={saving}
            />
            <TextField
              label="מיקום"
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              fullWidth
              disabled={saving}
            />
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">פעיל:</Typography>
              <Chip
                label={editActive ? 'פעיל' : 'לא פעיל'}
                color={editActive ? 'success' : 'default'}
                onClick={() => setEditActive(!editActive)}
                variant={editActive ? 'filled' : 'outlined'}
              />
            </Stack>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>מחיקת אירוע</DialogTitle>
        <DialogContent>
          <Typography>
            האם אתה בטוח שברצונך למחוק את האירוע{' '}
            <strong>{deleteEvent?.name}</strong>?
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            פעולה זו תמחק גם את כל האורחים והקמפיינים של האירוע.
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
    </Box>
  );
}

export default Events;
