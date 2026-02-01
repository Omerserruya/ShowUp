import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Card,
  CardContent,
  Stack,
  InputAdornment,
  useTheme,
  alpha,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
} from '@mui/material';
import {
  Edit as EditIcon,
  Lock as LockIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  CalendarToday as CalendarIcon,
  Badge as BadgeIcon,
  Event as EventIcon,
  ArrowForward as ArrowForwardIcon,
  DeleteOutline as DeleteOutlineIcon,
} from '@mui/icons-material';
import { useUser } from '../contexts/UserContext';
import { useEvent } from '../contexts/EventContext';
import type { Event } from '../contexts/EventContext';
import UserAvatar from '../components/UserAvatar';
import Toast from '../components/Toast';
import api from '../utils/api';

const COUNTRY_CODES = [
  { code: '+972', label: 'ישראל' },
  { code: '+1', label: 'ארה"ב/קנדה' },
  { code: '+44', label: 'בריטניה' },
  { code: '+49', label: 'גרמניה' },
  { code: '+33', label: 'צרפת' },
  { code: '+39', label: 'איטליה' },
  { code: '+34', label: 'ספרד' },
  { code: '+61', label: 'אוסטרליה' },
  { code: '+81', label: 'יפן' },
  { code: '+91', label: 'הודו' },
  { code: '+7', label: 'רוסיה' },
  { code: '+86', label: 'סין' },
] as const;

function parseE164(phone: string): { code: string; local: string } {
  if (!phone?.trim() || !phone.startsWith('+')) return { code: '+972', local: '' };
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return { code: '+972', local: '' };
  if (digits.startsWith('972') && digits.length >= 12) {
    const nine = digits.slice(3, 12);
    const local = `0${nine.slice(0, 2)}-${nine.slice(2)}`;
    return { code: '+972', local };
  }
  const match = COUNTRY_CODES.find(c => digits.startsWith(c.code.replace(/\D/g, '')));
  if (match) {
    const codeDigits = match.code.replace(/\D/g, '');
    const local = digits.slice(codeDigits.length);
    if (match.code === '+972' && local.length === 9)
      return { code: '+972', local: `0${local.slice(0, 2)}-${local.slice(2)}` };
    return { code: match.code, local };
  }
  return { code: '+972', local: digits.slice(3) };
}

function toE164(countryCode: string, local: string): string {
  const digits = local.replace(/\D/g, '');
  if (!digits.length) return '';
  const codeDigits = countryCode.replace(/\D/g, '');
  if (countryCode === '+972' && digits.length >= 9) {
    const nine = digits.length > 9 ? digits.slice(-9) : digits;
    return `+972${nine}`;
  }
  return `+${codeDigits}${digits}`;
}

function formatPhoneDisplay(phone: string): string {
  if (!phone?.trim()) return '—';
  const p = parseE164(phone);
  return p.local ? `${p.code} ${p.local}` : phone;
}

interface User {
  _id: string;
  username: string;
  email: string;
  phone?: string;
  role?: string;
  createdAt?: string;
  avatarUrl?: string;
  authProvider?: 'google' | 'github' | 'local';
}

interface FormErrors {
  username?: string;
  email?: string;
  phone?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

const ROLE_LABELS: Record<string, string> = {
  user: 'משתמש',
  admin: 'מנהל',
  User: 'משתמש',
  Admin: 'מנהל',
};

export default function Profile() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user: contextUser, refreshUserDetails } = useUser();
  const { events, deleteEvent, setSelectedEvent, loading: eventsLoading } = useEvent();
  const user = contextUser as User;

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState('+972');
  const [phoneLocal, setPhoneLocal] = useState('');

  const [deleteEventDialogOpen, setDeleteEventDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState<'error' | 'warning' | 'info' | 'success'>('error');

  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<FormErrors>({});
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  useEffect(() => {
    if (user?._id) {
      setUsername(user.username || '');
      setEmail(user.email || '');
      const parsed = parseE164(user.phone || '');
      setPhoneCountryCode(parsed.code);
      setPhoneLocal(parsed.local);
    }
  }, [user?._id]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    if (!username.trim()) newErrors.username = 'נא להזין שם משתמש';
    if (!email.trim()) newErrors.email = 'נא להזין אימייל';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'כתובת אימייל לא תקינה';
    const localDigits = phoneLocal.replace(/\D/g, '');
    if (phoneLocal.trim() && phoneCountryCode === '+972') {
      const valid972 = localDigits.length === 9 || (localDigits.length === 10 && localDigits[0] === '0');
      if (!valid972) newErrors.phone = 'נא להזין מספר ישראלי תקין (9 ספרות, עם או בלי 0 בתחילה)';
    } else if (phoneLocal.trim() && !/^[\d\s\-]+$/.test(phoneLocal)) newErrors.phone = 'מספר טלפון לא תקין';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?._id || !validateForm()) return;
    try {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(false);
      const phoneE164 = toE164(phoneCountryCode, phoneLocal);
      await api.put(`/users/${user._id}`, { username, email, phone: phoneE164 || undefined });
      await refreshUserDetails();
      setSaveSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (error) {
      console.error('Failed to update user:', error);
      setSaveError('שמירת השינויים נכשלה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setUsername(user?.username || '');
    setEmail(user?.email || '');
    const parsed = parseE164(user?.phone || '');
    setPhoneCountryCode(parsed.code);
    setPhoneLocal(parsed.local);
    setErrors({});
  };

  const handleGoToEvent = (event: Event) => {
    setSelectedEvent(event);
    navigate('/overview');
  };

  const handleDeleteEventClick = (event: Event) => {
    setEventToDelete(event);
    setDeleteEventDialogOpen(true);
  };

  const handleDeleteEventConfirm = async () => {
    if (!eventToDelete) return;
    const id = eventToDelete.id;
    setDeletingEventId(id);
    try {
      await deleteEvent(id);
      setDeleteEventDialogOpen(false);
      setEventToDelete(null);
      setToastMessage('האירוע נמחק');
      setToastSeverity('success');
      setToastOpen(true);
    } catch {
      setToastMessage('מחיקת האירוע נכשלה. נסה שוב.');
      setToastSeverity('error');
      setToastOpen(true);
    } finally {
      setDeletingEventId(null);
    }
  };

  const handleResetPassword = async () => {
    const err: FormErrors = {};
    if (!currentPassword) err.currentPassword = 'נא להזין סיסמה נוכחית';
    if (!newPassword) err.newPassword = 'נא להזין סיסמה חדשה';
    else if (newPassword.length < 8) err.newPassword = 'הסיסמה חייבת להכיל לפחות 8 תווים';
    if (!confirmPassword) err.confirmPassword = 'נא לאמת את הסיסמה החדשה';
    else if (newPassword !== confirmPassword) err.confirmPassword = 'הסיסמאות לא תואמות';
    setPasswordErrors(err);
    if (Object.keys(err).length > 0) return;

    setIsResettingPassword(true);
    try {
      await api.post('/users/reset-password', { currentPassword, newPassword });
      setToastMessage('הסיסמה עודכנה בהצלחה');
      setToastSeverity('success');
      setToastOpen(true);
      setResetPasswordDialogOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
    } catch (error: any) {
      if (error.response?.status === 401) {
        setPasswordErrors({ currentPassword: 'הסיסמה הנוכחית שגויה' });
      } else {
        setToastMessage('עדכון הסיסמה נכשל. נסה שוב.');
        setToastSeverity('error');
        setToastOpen(true);
      }
    } finally {
      setIsResettingPassword(false);
    }
  };

  if (!user) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('he-IL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';
  const roleLabel = user.role ? ROLE_LABELS[user.role] || user.role : 'משתמש';

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 560,
        mx: 'auto',
        px: 2,
        py: { xs: 2, sm: 3 },
        pb: 4,
      }}
    >
      {/* Page title */}
      <Typography
        variant="h4"
        component="h1"
        fontWeight={700}
        gutterBottom
        sx={{ color: 'text.primary', letterSpacing: '-0.02em' }}
      >
        הפרופיל שלי
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        נהל את פרטי החשבון והאבטחה
      </Typography>

      {/* Inline feedback */}
      {(saveSuccess || saveError) && (
        <Alert
          severity={saveSuccess ? 'success' : 'error'}
          onClose={() => (saveSuccess ? setSaveSuccess(false) : setSaveError(null))}
          sx={{ mb: 3 }}
        >
          {saveSuccess ? 'הפרטים נשמרו בהצלחה' : saveError}
        </Alert>
      )}

      {/* Profile header card */}
      <Card
        variant="outlined"
        sx={{
          mb: 3,
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: alpha(theme.palette.primary.main, 0.04),
          borderColor: alpha(theme.palette.primary.main, 0.12),
        }}
      >
        <CardContent sx={{ pt: 3, pb: 3, px: 3 }}>
          <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap">
            <UserAvatar
              username={user.username}
              avatarUrl={user.avatarUrl}
              size={96}
              showUsername={false}
              userFromProps={true}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {user.username || 'משתמש'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {user.email}
              </Typography>
              {user.phone && (
                <Typography variant="body2" color="text.secondary">
                  {formatPhoneDisplay(user.phone)}
                </Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Details card */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 3, bgcolor: '#fff' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>
              פרטי חשבון
            </Typography>
            {!isEditing ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditIcon />}
                onClick={() => setIsEditing(true)}
              >
                עריכה
              </Button>
            ) : null}
          </Stack>

          <form onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              {isEditing ? (
                <>
                  <TextField
                    fullWidth
                    label="שם משתמש"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    error={!!errors.username}
                    helperText={errors.username}
                    required
                    size="medium"
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonIcon color="action" fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    fullWidth
                    label="אימייל"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={!!errors.email}
                    helperText={errors.email}
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <EmailIcon color="action" fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <FormControl sx={{ minWidth: 120 }} size="medium">
                      <InputLabel>קוד אזור</InputLabel>
                      <Select
                        value={phoneCountryCode}
                        label="קוד אזור"
                        onChange={(e) => setPhoneCountryCode(e.target.value)}
                      >
                        {COUNTRY_CODES.map((c) => (
                          <MenuItem key={c.code} value={c.code}>
                            {c.code} {c.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <TextField
                      fullWidth
                      label="מספר טלפון"
                      value={phoneLocal}
                      onChange={(e) => setPhoneLocal(e.target.value)}
                      error={!!errors.phone}
                      helperText={errors.phone}
                      placeholder={phoneCountryCode === '+972' ? '050-1234567' : ''}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <PhoneIcon color="action" fontSize="small" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Stack>
                </>
              ) : (
                <>
                  <DetailRow icon={<PersonIcon />} label="שם משתמש" value={user.username || '—'} />
                  <DetailRow icon={<EmailIcon />} label="אימייל" value={user.email || '—'} />
                  <DetailRow icon={<PhoneIcon />} label="טלפון" value={formatPhoneDisplay(user.phone || '')} />
                </>
              )}

              <DetailRow icon={<BadgeIcon />} label="תפקיד" value={roleLabel} />
              <DetailRow icon={<CalendarIcon />} label="חבר/ה מאז" value={memberSince} />
            </Stack>

            {isEditing && (
              <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ mt: 3 }}>
                <Button variant="outlined" onClick={handleCancelEdit} disabled={saving}>
                  ביטול
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={saving}
                  startIcon={saving ? <CircularProgress size={18} color="inherit" /> : null}
                >
                  {saving ? 'שומר...' : 'שמירה'}
                </Button>
              </Stack>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Security card */}
      {user.authProvider === 'local' && (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              אבטחה
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              התחברת עם אימייל וסיסמה. ניתן לשנות סיסמה כאן.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<LockIcon />}
              onClick={() => setResetPasswordDialogOpen(true)}
            >
              שינוי סיסמה
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Events I own */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 3, bgcolor: '#fff' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <EventIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              אירועים בבעלותי
            </Typography>
          </Stack>
          {eventsLoading ? (
            <Stack alignItems="center" py={4}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                טוען אירועים...
              </Typography>
            </Stack>
          ) : events.length === 0 ? (
            <Box
              sx={{
                py: 4,
                px: 2,
                textAlign: 'center',
                borderRadius: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.04),
              }}
            >
              <EventIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body1" color="text.secondary">
                אין לך עדיין אירועים
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                צור אירוע ראשון דרך האשף
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1.5}>
              {events.map((event) => (
                <Card
                  key={event.id}
                  variant="outlined"
                  sx={{
                    borderRadius: 1.5,
                    overflow: 'hidden',
                    transition: 'box-shadow 0.2s, border-color 0.2s',
                    '&:hover': {
                      boxShadow: 1,
                      borderColor: alpha(theme.palette.primary.main, 0.3),
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'row',
                      direction: 'rtl',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      py: 1.5,
                      px: 2,
                      gap: 2,
                    }}
                  >
                    {/* כפתורים בשמאל (ב־RTL: האלמנט השני) */}
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                      <Button
                        variant="contained"
                        size="small"
                        endIcon={<ArrowForwardIcon />}
                        onClick={() => handleGoToEvent(event)}
                        sx={{ textTransform: 'none', minWidth: 90 }}
                      >
                        עבור אל
                      </Button>
                      <IconButton
                        aria-label="מחק אירוע"
                        size="small"
                        color="error"
                        onClick={() => handleDeleteEventClick(event)}
                        sx={{
                          '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.08) },
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    {/* טקסט בימין (ב־RTL: האלמנט הראשון) */}
                    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {event.name}
                      </Typography>
                      {event.date && (
                        <Stack direction="row" alignItems="center" spacing={0.5} justifyContent="flex-end" sx={{ mt: 0.5 }}>
                          <CalendarIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          <Typography variant="body2" color="text.secondary">
                            {new Date(event.date).toLocaleDateString('he-IL', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </Typography>
                        </Stack>
                      )}
                    </Box>
                  </Box>
                </Card>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Delete event confirm dialog */}
      <Dialog
        open={deleteEventDialogOpen}
        onClose={() => !deletingEventId && setDeleteEventDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle>מחיקת אירוע</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            למחוק את האירוע &quot;{eventToDelete?.name}&quot;? פעולה זו לא ניתנת לביטול וכל הנתונים
            הקשורים לאירוע יימחקו.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button
            onClick={() => setDeleteEventDialogOpen(false)}
            disabled={!!deletingEventId}
          >
            ביטול
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteEventConfirm}
            disabled={!!deletingEventId}
            startIcon={deletingEventId ? <CircularProgress size={18} color="inherit" /> : <DeleteOutlineIcon />}
          >
            {deletingEventId ? 'מוחק...' : 'מחק אירוע'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog
        open={resetPasswordDialogOpen}
        onClose={() => {
          setResetPasswordDialogOpen(false);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setPasswordErrors({});
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>שינוי סיסמה</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="סיסמה נוכחית"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              error={!!passwordErrors.currentPassword}
              helperText={passwordErrors.currentPassword}
              required
              autoComplete="current-password"
            />
            <TextField
              fullWidth
              label="סיסמה חדשה"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              error={!!passwordErrors.newPassword}
              helperText={passwordErrors.newPassword}
              required
              autoComplete="new-password"
            />
            <TextField
              fullWidth
              label="אימות סיסמה חדשה"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={!!passwordErrors.confirmPassword}
              helperText={passwordErrors.confirmPassword}
              required
              autoComplete="new-password"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              setResetPasswordDialogOpen(false);
              setCurrentPassword('');
              setNewPassword('');
              setConfirmPassword('');
              setPasswordErrors({});
            }}
          >
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={handleResetPassword}
            disabled={isResettingPassword}
            startIcon={isResettingPassword ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {isResettingPassword ? 'מעדכן...' : 'עדכן סיסמה'}
          </Button>
        </DialogActions>
      </Dialog>

      <Toast open={toastOpen} message={toastMessage} severity={toastSeverity} onClose={() => setToastOpen(false)} />
    </Box>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ py: 0.5 }}>
      <Box sx={{ color: 'text.secondary', mt: 0.5 }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          {label}
        </Typography>
        <Typography variant="body1">{value}</Typography>
      </Box>
    </Stack>
  );
}
