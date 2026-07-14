import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Button, TextField, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, FormControl, InputLabel, CircularProgress, Alert,
  Chip, alpha, useTheme,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import PersonAddAlt1RoundedIcon from '@mui/icons-material/PersonAddAlt1Rounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { useVenueAdmin } from '../../hooks/useVenueAdmin';

const BRAND = '#888cee';

interface VenueBranding {
  logo?: string | null;
  color?: string | null;
}

interface VenueDetails {
  id: string;
  name: string | null;
  billing_email: string | null;
  status: string | null;
  event_capacity: number | null;
  events_used: number;
  events_used_total: number;
  events_remaining: number | null;
  partner_coupon_code: string | null;
  branding: VenueBranding | null;
}

interface VenueStats {
  total_events: number;
  published_events: number;
  upgraded_events: number;
  upgrade_rate: number;
  total_guests: number;
  confirmed_guests: number;
}

interface VenueMember {
  membership_id: string;
  user_id: string;
  role: string;
  name: string | null;
  phone: string | null;
  is_self: boolean;
}

const roleLabel = (role: string) => {
  switch (role) {
    case 'owner': return 'בעלים';
    case 'manager': return 'מנהל';
    case 'viewer': return 'צופה';
    default: return role;
  }
};

function SectionPaper({ title, caption, children }: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <Paper elevation={0} variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 16, mb: caption ? 0.5 : 2 }}>{title}</Typography>
      {caption && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{caption}</Typography>
      )}
      {children}
    </Paper>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{
      flex: '1 1 120px', minWidth: 120, textAlign: 'center',
      p: 1.5, borderRadius: 2, bgcolor: alpha(BRAND, 0.06),
    }}>
      <Typography sx={{ fontWeight: 800, fontSize: 22, lineHeight: 1.1 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

export default function VenueSettings() {
  const theme = useTheme();
  const { venues, loading: venuesLoading } = useVenueAdmin();
  const venueId = venues[0]?.id;

  const [details, setDetails] = useState<VenueDetails | null>(null);
  const [stats, setStats] = useState<VenueStats | null>(null);
  const [members, setMembers] = useState<VenueMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [coupon, setCoupon] = useState('');
  const [savingCoupon, setSavingCoupon] = useState(false);

  const [logo, setLogo] = useState('');
  const [color, setColor] = useState('');
  const [savingBranding, setSavingBranding] = useState(false);

  // Add member form
  const [newPhone, setNewPhone] = useState('');
  const [newFirstName, setNewFirstName] = useState('');
  const [newRole, setNewRole] = useState<'manager' | 'viewer'>('manager');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    setError(null);
    try {
      const [dRes, sRes, mRes] = await Promise.all([
        fetchWithAuth(`/api/venues/${venueId}`),
        fetchWithAuth(`/api/venues/${venueId}/stats`),
        fetchWithAuth(`/api/venues/${venueId}/members`),
      ]);
      if (!dRes.ok) throw new Error('failed');
      const d: VenueDetails = await dRes.json();
      setDetails(d);
      setCoupon(d.partner_coupon_code || '');
      setLogo(d.branding?.logo || '');
      setColor(d.branding?.color || '');
      if (sRes.ok) setStats(await sRes.json());
      if (mRes.ok) setMembers(await mRes.json());
    } catch {
      setError('לא הצלחנו לטעון את הגדרות האולם.');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const loadMembers = useCallback(async () => {
    if (!venueId) return;
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}/members`);
      if (r.ok) setMembers(await r.json());
    } catch {
      /* ignore */
    }
  }, [venueId]);

  const saveCoupon = async () => {
    if (!venueId) return;
    setSavingCoupon(true);
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}`, {
        method: 'PATCH',
        body: JSON.stringify({ partner_coupon_code: coupon.trim() || null }),
      });
      if (!r.ok) throw new Error('failed');
    } catch {
      setError('שמירת הקופון נכשלה. נסו שוב.');
    } finally {
      setSavingCoupon(false);
    }
  };

  const saveBranding = async () => {
    if (!venueId) return;
    setSavingBranding(true);
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}`, {
        method: 'PATCH',
        body: JSON.stringify({ branding: { logo: logo.trim() || null, color: color.trim() || null } }),
      });
      if (!r.ok) throw new Error('failed');
    } catch {
      setError('שמירת המיתוג נכשלה. נסו שוב.');
    } finally {
      setSavingBranding(false);
    }
  };

  const addMember = async () => {
    if (!venueId || !newPhone.trim()) return;
    setAddingMember(true);
    setMemberError(null);
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}/members`, {
        method: 'POST',
        body: JSON.stringify({
          phone: newPhone.trim(),
          first_name: newFirstName.trim(),
          role: newRole,
        }),
      });
      if (r.status === 409) {
        setMemberError('המשתמש כבר חבר בצוות האולם.');
        return;
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setMemberError(body.detail || 'הוספת חבר הצוות נכשלה. נסו שוב.');
        return;
      }
      setNewPhone('');
      setNewFirstName('');
      setNewRole('manager');
      await loadMembers();
    } catch {
      setMemberError('הוספת חבר הצוות נכשלה. נסו שוב.');
    } finally {
      setAddingMember(false);
    }
  };

  const removeMember = async (membershipId: string) => {
    if (!venueId) return;
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/venues/${venueId}/members/${membershipId}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('failed');
      await loadMembers();
    } catch {
      setError('הסרת חבר הצוות נכשלה. נסו שוב.');
    }
  };

  const upgradeRateText = useMemo(() => {
    if (!stats) return '-';
    const rate = stats.upgrade_rate;
    if (rate == null) return '-';
    // Accept either 0..1 fraction or 0..100 percentage.
    const pct = rate <= 1 ? rate * 100 : rate;
    return `${Math.round(pct)}%`;
  }, [stats]);

  if (venuesLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress sx={{ color: BRAND }} />
      </Box>
    );
  }

  if (!venueId) {
    return (
      <Box dir="rtl" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
        <Alert severity="warning" sx={{ borderRadius: 2 }}>אין לך הרשאת ניהול אולם</Alert>
      </Box>
    );
  }

  return (
    <Box dir="rtl" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
      {/* Header */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
        <Box sx={{
          width: 44, height: 44, borderRadius: 3, display: 'flex', alignItems: 'center',
          justifyContent: 'center', bgcolor: alpha(BRAND, 0.12), color: BRAND,
        }}>
          <SettingsRoundedIcon />
        </Box>
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>הגדרות האולם</Typography>
          {details?.name && (
            <Typography variant="body2" color="text.secondary">{details.name}</Typography>
          )}
        </Box>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>
      )}

      {loading && !details ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress sx={{ color: BRAND }} />
        </Box>
      ) : (
        <Stack spacing={2.5}>
          {/* 1) Details + upgrade stats */}
          <SectionPaper title="פרטי האולם">
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <Box sx={{ flex: '1 1 200px', minWidth: 180 }}>
                  <Typography variant="caption" color="text.secondary">שם האולם</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{details?.name || '-'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 200px', minWidth: 180 }}>
                  <Typography variant="caption" color="text.secondary">אימייל לחיוב</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{details?.billing_email || '-'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 120px', minWidth: 120 }}>
                  <Typography variant="caption" color="text.secondary">סטטוס</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <Chip
                      size="small"
                      label={details?.status === 'active' ? 'פעיל' : (details?.status || '-')}
                      color={details?.status === 'active' ? 'success' : 'default'}
                      variant={details?.status === 'active' ? 'filled' : 'outlined'}
                    />
                  </Box>
                </Box>
              </Stack>

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  סטטיסטיקת שדרוגים (בטא)
                </Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <Tile label="מכסה חודשית" value={details?.event_capacity ?? 'ללא הגבלה'} />
                  <Tile label="נותרו החודש" value={details?.events_remaining ?? '∞'} />
                  <Tile label='סה"כ אירועים' value={stats?.total_events ?? '-'} />
                  <Tile label="שדרגו" value={stats?.upgraded_events ?? '-'} />
                  <Tile label="שיעור שדרוג" value={upgradeRateText} />
                </Stack>
              </Box>
            </Stack>
          </SectionPaper>

          {/* 2) Partner coupon */}
          <SectionPaper
            title="קופון שותף"
            caption="הקופון חייב להיות מוגדר במערכת כדי להעניק הנחה"
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
              <TextField
                size="small"
                label="קוד קופון"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                fullWidth
                disabled={savingCoupon}
              />
              <Button
                variant="contained" disableElevation onClick={saveCoupon} disabled={savingCoupon}
                sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#6f74e0' }, minWidth: 100 }}
              >
                {savingCoupon ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'שמירה'}
              </Button>
            </Stack>
          </SectionPaper>

          {/* 3) Branding (future) */}
          <SectionPaper title="מיתוג" caption="מיתוג - יופעל בהמשך">
            <Stack spacing={1.5}>
              <TextField
                size="small"
                label="כתובת לוגו (URL)"
                value={logo}
                onChange={(e) => setLogo(e.target.value)}
                fullWidth
                disabled={savingBranding}
              />
              <TextField
                size="small"
                label="צבע ראשי"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                fullWidth
                placeholder="#888cee"
                disabled={savingBranding}
              />
              <Box>
                <Button
                  variant="contained" disableElevation onClick={saveBranding} disabled={savingBranding}
                  sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#6f74e0' }, minWidth: 100 }}
                >
                  {savingBranding ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'שמירה'}
                </Button>
              </Box>
            </Stack>
          </SectionPaper>

          {/* 4) Team members */}
          <SectionPaper title="חברי צוות">
            {memberError && (
              <Alert severity="error" onClose={() => setMemberError(null)} sx={{ mb: 2, borderRadius: 2 }}>
                {memberError}
              </Alert>
            )}
            <Stack
              direction={{ xs: 'column', sm: 'row' }} spacing={1.5}
              alignItems={{ sm: 'flex-start' }} sx={{ mb: 2 }}
            >
              <TextField
                size="small" label="טלפון" value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                fullWidth disabled={addingMember} placeholder="05X-XXXXXXX"
              />
              <TextField
                size="small" label="שם פרטי" value={newFirstName}
                onChange={(e) => setNewFirstName(e.target.value)}
                fullWidth disabled={addingMember}
              />
              <FormControl size="small" sx={{ minWidth: 130 }} disabled={addingMember}>
                <InputLabel>תפקיד</InputLabel>
                <Select
                  label="תפקיד" value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'manager' | 'viewer')}
                >
                  <MenuItem value="manager">מנהל</MenuItem>
                  <MenuItem value="viewer">צופה</MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="contained" disableElevation onClick={addMember}
                disabled={addingMember || !newPhone.trim()}
                startIcon={!addingMember ? <PersonAddAlt1RoundedIcon /> : undefined}
                sx={{ borderRadius: 2, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#6f74e0' }, minWidth: 110, whiteSpace: 'nowrap' }}
              >
                {addingMember ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'הוסף'}
              </Button>
            </Stack>

            <TableContainer component={Paper} elevation={0} variant="outlined" sx={{ borderRadius: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    <TableCell sx={{ fontWeight: 700 }}>שם</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>טלפון</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>תפקיד</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="left">פעולות</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.membership_id} hover>
                      <TableCell>{m.name || '-'}{m.is_self ? ' (אני)' : ''}</TableCell>
                      <TableCell dir="ltr" sx={{ textAlign: 'right' }}>{m.phone || '-'}</TableCell>
                      <TableCell>
                        <Chip
                          size="small" label={roleLabel(m.role)}
                          color={m.role === 'owner' ? 'primary' : 'default'}
                          variant={m.role === 'owner' ? 'filled' : 'outlined'}
                        />
                      </TableCell>
                      <TableCell align="left">
                        {!m.is_self && m.role !== 'owner' && (
                          <IconButton size="small" color="error" onClick={() => removeMember(m.membership_id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {members.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 3 }}>
                        <Typography color="text.secondary">עוד אין חברי צוות</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionPaper>
        </Stack>
      )}
    </Box>
  );
}
