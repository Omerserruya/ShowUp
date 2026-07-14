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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Alert,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface UserRow {
  id: string;
  phone: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_verified: boolean;
  last_login: string | null;
  created_at: string | null;
}

function Users() {
  const theme = useTheme();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('user');
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createFirstName, setCreateFirstName] = useState('');
  const [createLastName, setCreateLastName] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createRole, setCreateRole] = useState('user');
  const [creating, setCreating] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(rowsPerPage),
      });
      if (search) params.set('search', search);
      const res = await fetchWithAuth(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUsers(data.users);
      setTotal(data.total);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת משתמשים');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleOpenCreate = () => {
    setCreateFirstName('');
    setCreateLastName('');
    setCreatePhone('');
    setCreateEmail('');
    setCreateRole('user');
    setCreateOpen(true);
  };

  const handleSaveCreate = async () => {
    setCreating(true);
    try {
      const res = await fetchWithAuth('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: createFirstName.trim(),
          last_name: createLastName.trim(),
          phone: createPhone.trim(),
          email: createEmail.trim(),
          role: createRole,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCreateOpen(false);
      fetchUsers();
    } catch (e: any) {
      setError(e?.message || 'שגיאה ביצירת משתמש');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (user: UserRow) => {
    setEditUser(user);
    setEditFirstName(user.first_name);
    setEditLastName(user.last_name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${editUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: editFirstName,
          last_name: editLastName,
          email: editEmail,
          role: editRole,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditOpen(false);
      setEditUser(null);
      fetchUsers();
    } catch (e: any) {
      setError(e?.message || 'שגיאה בעדכון משתמש');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (user: UserRow) => {
    setDeleteUser(user);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${deleteUser.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
      setDeleteOpen(false);
      setDeleteUser(null);
      fetchUsers();
    } catch (e: any) {
      setError(e?.message || 'שגיאה במחיקת משתמש');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>משתמשים</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          משתמש חדש
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
          placeholder="חיפוש לפי שם, טלפון או אימייל..."
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

      {/* Users Table */}
      <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 2 }}>
        {loading && users.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell sx={{ fontWeight: 700 }}>שם</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>טלפון</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>אימייל</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>תפקיד</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>מאומת</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>התחברות אחרונה</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>פעולות</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell>
                      {user.first_name} {user.last_name}
                    </TableCell>
                    <TableCell dir="ltr" sx={{ textAlign: 'right' }}>{user.phone}</TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{user.email}</TableCell>
                    <TableCell>
                      <Chip
                        label={user.role === 'admin' ? 'מנהל' : 'משתמש'}
                        size="small"
                        color={user.role === 'admin' ? 'primary' : 'default'}
                        variant={user.role === 'admin' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      <Chip
                        label={user.is_verified ? 'כן' : 'לא'}
                        size="small"
                        color={user.is_verified ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      {user.last_login
                        ? new Date(user.last_login).toLocaleDateString('he-IL')
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton size="small" onClick={() => handleEdit(user)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDelete(user)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">לא נמצאו משתמשים</Typography>
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
        <DialogTitle>משתמש חדש</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="שם פרטי"
              value={createFirstName}
              onChange={(e) => setCreateFirstName(e.target.value)}
              fullWidth
              required
              disabled={creating}
            />
            <TextField
              label="שם משפחה"
              value={createLastName}
              onChange={(e) => setCreateLastName(e.target.value)}
              fullWidth
              disabled={creating}
            />
            <TextField
              label="טלפון"
              placeholder="+9725..."
              value={createPhone}
              onChange={(e) => setCreatePhone(e.target.value)}
              fullWidth
              required
              disabled={creating}
              inputProps={{ dir: 'ltr' }}
            />
            <TextField
              label="אימייל"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              fullWidth
              disabled={creating}
              inputProps={{ dir: 'ltr' }}
            />
            <FormControl fullWidth disabled={creating}>
              <InputLabel>תפקיד</InputLabel>
              <Select value={createRole} label="תפקיד" onChange={(e) => setCreateRole(e.target.value)}>
                <MenuItem value="user">משתמש</MenuItem>
                <MenuItem value="admin">מנהל</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveCreate}
            disabled={creating || !createFirstName.trim() || !createPhone.trim()}
          >
            {creating ? <CircularProgress size={20} /> : 'צור'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={() => !saving && setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>עריכת משתמש</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="שם פרטי"
              value={editFirstName}
              onChange={(e) => setEditFirstName(e.target.value)}
              fullWidth
              disabled={saving}
            />
            <TextField
              label="שם משפחה"
              value={editLastName}
              onChange={(e) => setEditLastName(e.target.value)}
              fullWidth
              disabled={saving}
            />
            <TextField
              label="אימייל"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              fullWidth
              disabled={saving}
            />
            <FormControl fullWidth disabled={saving}>
              <InputLabel>תפקיד</InputLabel>
              <Select value={editRole} label="תפקיד" onChange={(e) => setEditRole(e.target.value)}>
                <MenuItem value="user">משתמש</MenuItem>
                <MenuItem value="admin">מנהל</MenuItem>
              </Select>
            </FormControl>
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
        <DialogTitle>מחיקת משתמש</DialogTitle>
        <DialogContent>
          <Typography>
            האם אתה בטוח שברצונך למחוק את המשתמש{' '}
            <strong>{deleteUser?.first_name} {deleteUser?.last_name}</strong>?
          </Typography>
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
    </Box>
  );
}

export default Users;
