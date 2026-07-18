import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Button, Stack, Chip, Avatar, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress, Alert, Select, FormControl,
  InputLabel, Tooltip, useTheme, alpha,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import GroupIcon from '@mui/icons-material/Group';
import Toast from '../components/Toast';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';

interface Member {
  id: string;
  user_id: string | null;
  role: string;
  status: string;
  is_self: boolean;
  name?: string | null;
  phone?: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'בעל/ת האירוע',
  manager: 'מנהל/ת',
  editor: 'שותף/ה לתכנון',
  viewer: 'צופה',
  guest_coordinator: 'רכז/ת אורחים',
};

const ASSIGNABLE = [
  { value: 'manager', label: 'מנהל/ת', desc: 'ניהול מלא, ללא גישה לתשלומים' },
  { value: 'editor', label: 'שותף/ה לתכנון', desc: 'עריכת אורחים וקמפיינים' },
  { value: 'guest_coordinator', label: 'רכז/ת אורחים', desc: 'ניהול אורחים בלבד' },
  { value: 'viewer', label: 'צופה', desc: 'צפייה בלבד' },
];

export default function Team({ embedded = false }: { embedded?: boolean } = {}) {
  const theme = useTheme();
  const { selectedEvent } = useEvent();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('editor');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });
  const showToast = (m: string, s: 'success' | 'error' | 'info' = 'info') => setToast({ open: true, message: m, severity: s });

  const load = useCallback(async () => {
    if (!selectedEvent?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithAuth(`/api/members?event_id=${selectedEvent.id}`);
      if (!res.ok) throw new Error();
      setMembers(await res.json());
    } catch {
      setError('שגיאה בטעינת חברי הצוות');
    } finally {
      setLoading(false);
    }
  }, [selectedEvent?.id]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async () => {
    if (!selectedEvent?.id || !phone.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: selectedEvent.id, phone: phone.trim(), role }),
      });
      if (res.status === 409) { showToast('כבר חבר/ת צוות או שכבר נשלחה הזמנה', 'info'); return; }
      if (res.status === 400) { showToast('מספר הטלפון לא תקין', 'error'); return; }
      if (!res.ok) throw new Error();
      const created = await res.json();
      setInviteOpen(false);
      setPhone('');
      setRole('editor');
      showToast(
        created?.status === 'invited'
          ? 'הזמנה נשלחה בוואטסאפ! ברגע שיתחברו לראשונה הם יצטרפו לצוות אוטומטית'
          : 'השותף/ה נוסף/ה לצוות ועודכן/ה בוואטסאפ',
        'success',
      );
      load();
    } catch {
      showToast('שגיאה בהוספת חבר/ת צוות', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (m: Member, newRole: string) => {
    setBusyId(m.id);
    try {
      const res = await fetchWithAuth(`/api/members/${m.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error();
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, role: newRole } : x)));
      showToast('ההרשאה עודכנה', 'success');
    } catch {
      showToast('שגיאה בעדכון ההרשאה', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveConfirm = async () => {
    const m = memberToRemove;
    if (!m) return;
    setBusyId(m.id);
    try {
      const res = await fetchWithAuth(`/api/members/${m.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
      showToast('חבר/ת הצוות הוסר/ה', 'success');
    } catch {
      showToast('שגיאה בהסרת חבר/ת הצוות', 'error');
    } finally {
      setBusyId(null);
      setRemoveDialogOpen(false);
      setMemberToRemove(null);
    }
  };

  if (!selectedEvent) {
    return <Box sx={{ p: 4, direction: 'rtl', textAlign: 'center' }}><Typography variant="h6" color="text.secondary">אנא בחר אירוע כדי לנהל את הצוות</Typography></Box>;
  }

  return (
    <Box sx={{ p: embedded ? 0 : { xs: 2, sm: 4 }, direction: 'rtl' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          {!embedded && <Typography variant="h4" sx={{ fontWeight: 700 }}>חברי צוות</Typography>}
          <Typography variant="body2" color="text.secondary">הזמינו בני משפחה או מתכננת לעזור בניהול האירוע. כל אחד מקבל בדיוק את ההרשאות שמתאימות לו.</Typography>
        </Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setInviteOpen(true)} sx={{ borderRadius: 2 }}>הזמן שותף/ה</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <Box>
          {members.map((m, i) => {
            const isOwner = m.role === 'owner';
            const isPendingInvite = m.status === 'invited';
            const display = m.name || (m.is_self ? 'את/ה' : (isPendingInvite ? (m.phone || 'הזמנה ממתינה') : 'חבר/ת צוות'));
            return (
              <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2, borderTop: i ? '1px solid' : 'none', borderColor: 'divider' }}>
                <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.15), color: 'primary.main' }}>
                  {(m.name || '?').charAt(0)}
                </Avatar>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {display}{m.is_self && ' (את/ה)'}
                  </Typography>
                  {m.phone && <Typography variant="body2" color="text.secondary">{m.phone}</Typography>}
                </Box>
                {isPendingInvite ? (
                  <>
                    <Chip label={`ממתין/ה להצטרפות · ${ROLE_LABELS[m.role] || m.role}`} size="small"
                      sx={{ bgcolor: alpha(theme.palette.warning.main, 0.14), color: 'warning.dark', fontWeight: 600 }} />
                    <Tooltip title="ביטול ההזמנה">
                      <span>
                        <IconButton color="error" disabled={busyId === m.id} onClick={() => { setMemberToRemove(m); setRemoveDialogOpen(true); }}>
                          <DeleteOutlineIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                ) : isOwner || m.is_self ? (
                  <Chip label={ROLE_LABELS[m.role] || m.role} color={isOwner ? 'primary' : 'default'} />
                ) : (
                  <>
                    <FormControl size="small" sx={{ minWidth: 150 }} disabled={busyId === m.id}>
                      <Select value={m.role} onChange={(e) => handleRoleChange(m, e.target.value)}>
                        {ASSIGNABLE.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <Tooltip title="הסר מהצוות">
                      <span>
                        <IconButton color="error" disabled={busyId === m.id} onClick={() => { setMemberToRemove(m); setRemoveDialogOpen(true); }}>
                          <DeleteOutlineIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                )}
              </Box>
            );
          })}
          {members.length === 0 && (
            <Box sx={{ p: 6, textAlign: 'center' }}>
              <GroupIcon sx={{ fontSize: 48, color: 'primary.main', opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }} color="text.secondary">עדיין רק את/ה כאן. הזמן/ני שותף/ה לעזור!</Typography>
            </Box>
          )}
        </Box>
      )}

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>הזמנת שותף/ה</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="מספר טלפון" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth placeholder="050-1234567" helperText="נשלח הזמנה בוואטסאפ - גם אם עוד אין להם חשבון ShowUp" />
            <FormControl fullWidth>
              <InputLabel>הרשאה</InputLabel>
              <Select value={role} label="הרשאה" onChange={(e) => setRole(e.target.value)}>
                {ASSIGNABLE.map((r) => (
                  <MenuItem key={r.value} value={r.value}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.label}</Typography>
                      <Typography variant="caption" color="text.secondary">{r.desc}</Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInviteOpen(false)}>ביטול</Button>
          <Button variant="contained" onClick={handleInvite} disabled={saving || !phone.trim()} startIcon={saving ? <CircularProgress size={16} /> : undefined}>שליחת הזמנה</Button>
        </DialogActions>
      </Dialog>

      {/* Remove member confirm dialog */}
      <Dialog
        open={removeDialogOpen}
        onClose={() => !busyId && setRemoveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle>הסרת חבר/ת צוות</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            להסיר את &quot;{memberToRemove?.name || memberToRemove?.phone || 'חבר/ת הצוות'}&quot; מצוות האירוע?
            הגישה שלו/ה לאירוע תבוטל מיידית.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setRemoveDialogOpen(false)} disabled={!!busyId}>
            ביטול
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleRemoveConfirm}
            disabled={!!busyId}
            startIcon={busyId ? <CircularProgress size={18} color="inherit" /> : <DeleteOutlineIcon />}
          >
            {busyId ? 'מסיר...' : 'הסר מהצוות'}
          </Button>
        </DialogActions>
      </Dialog>

      <Toast open={toast.open} message={toast.message} severity={toast.severity} onClose={() => setToast((p) => ({ ...p, open: false }))} />
    </Box>
  );
}
