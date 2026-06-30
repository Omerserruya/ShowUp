import React from 'react';
import { Box, Menu, MenuItem, ListItemText, ListItemIcon, Divider, Typography, CircularProgress, alpha, useTheme } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useEvent } from '../../contexts/EventContext';
import { useNavigate } from 'react-router-dom';

const BRAND = '#888cee';
const DEEP = '#6f74e0';

function emojiFor(type?: string, name?: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'wedding') return '💍';
  if (t === 'birthday') return '🎂';
  if (t === 'corporate') return '🎉';
  const n = name || '';
  if (n.includes('חתונה')) return '💍';
  if (n.includes('ברית')) return '👶';
  if (n.includes('מצווה')) return '✡️';
  return '✨';
}

function countdownLabel(dateISO?: string): string {
  if (!dateISO) return '';
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return '';
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days > 1) return `עוד ${days} ימים`;
  if (days === 1) return 'מחר!';
  if (days === 0) return 'היום! 🎉';
  return 'האירוע מאחורינו';
}

export default function EventSwitcher({ expanded }: { expanded: boolean }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { selectedEvent, setSelectedEvent, events, loading } = useEvent();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const paid = (selectedEvent as any)?.paymentStatus === 'paid' || (selectedEvent as any)?.paymentStatus === 'free';
  const statusColor = paid ? '#22c55e' : '#f59e0b';
  const countdown = countdownLabel((selectedEvent as any)?.date);

  return (
    <>
      <Box
        role="button"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25,
          p: 1, borderRadius: 3, cursor: 'pointer',
          bgcolor: isDark ? alpha('#fff', 0.04) : alpha(BRAND, 0.06),
          border: '1px solid', borderColor: isDark ? alpha('#fff', 0.06) : alpha(BRAND, 0.12),
          transition: 'border-color .2s ease, background-color .2s ease',
          '&:hover': { borderColor: alpha(BRAND, 0.5) },
        }}
      >
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', background: `linear-gradient(135deg, ${alpha(DEEP, 0.2)}, ${alpha(BRAND, 0.12)})` }}>
            {selectedEvent ? emojiFor((selectedEvent as any)?.type, selectedEvent.name) : '✨'}
          </Box>
          <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderRadius: '50%', bgcolor: statusColor, border: `2px solid ${isDark ? '#1c1c22' : '#fff'}` }} />
        </Box>

        {/* Detail - fades/clips when the rail is collapsed */}
        <Box sx={{ flex: 1, minWidth: 0, textAlign: 'right', opacity: expanded ? 1 : 0, transition: 'opacity .18s ease', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {selectedEvent ? (
            <>
              <Typography noWrap sx={{ fontSize: '0.92rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.25 }}>{selectedEvent.name}</Typography>
              <Typography noWrap sx={{ fontSize: '0.75rem', fontWeight: 600, color: countdown.includes('היום') ? DEEP : 'text.secondary' }}>
                {countdown || 'לחצו להחלפה'}
              </Typography>
            </>
          ) : (
            <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>בחרו אירוע</Typography>
          )}
        </Box>
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { mt: 1, minWidth: 280, maxHeight: 440, direction: 'rtl', borderRadius: 3.5, border: '1px solid', borderColor: 'divider', boxShadow: '0 18px 44px rgba(16,24,40,0.18)', overflow: 'hidden', p: 0.75 } }}
      >
        <Typography sx={{ px: 1.5, pt: 1, pb: 1, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'text.disabled' }}>החגיגות שלכם</Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} sx={{ color: BRAND }} /></Box>
        ) : events.length > 0 ? (
          events.map((event) => {
            const sel = selectedEvent?.id === event.id;
            const cd = countdownLabel((event as any)?.date);
            return (
              <MenuItem key={event.id} dir="rtl" onClick={() => { setSelectedEvent(event); setAnchorEl(null); }}
                sx={{ py: 1.1, borderRadius: 2.5, my: 0.25, bgcolor: sel ? alpha(BRAND, 0.1) : 'transparent', '&:hover': { bgcolor: alpha(BRAND, 0.08) } }}>
                <ListItemIcon sx={{ minWidth: 40, fontSize: '1.25rem' }}>{emojiFor((event as any)?.type, event.name)}</ListItemIcon>
                <ListItemText primary={event.name} secondary={cd}
                  sx={{ textAlign: 'right', '& .MuiListItemText-primary': { fontSize: '0.92rem', fontWeight: sel ? 800 : 500 }, '& .MuiListItemText-secondary': { fontSize: '0.76rem' } }} />
                {sel && <CheckRoundedIcon sx={{ fontSize: 18, color: DEEP, ml: 1 }} />}
              </MenuItem>
            );
          })
        ) : (
          <MenuItem disabled dir="rtl"><ListItemText primary="עוד אין אירועים" sx={{ textAlign: 'right' }} /></MenuItem>
        )}
        <Divider sx={{ my: 0.5 }} />
        <MenuItem dir="rtl" onClick={() => { setAnchorEl(null); navigate('/wizard'); }}
          sx={{ py: 1.1, borderRadius: 2.5, color: DEEP, '&:hover': { bgcolor: alpha(BRAND, 0.08) } }}>
          <ListItemIcon sx={{ minWidth: 40, color: DEEP }}><AddRoundedIcon /></ListItemIcon>
          <ListItemText primary="חגיגה חדשה" sx={{ textAlign: 'right', '& .MuiListItemText-primary': { fontSize: '0.92rem', fontWeight: 800 } }} />
        </MenuItem>
      </Menu>
    </>
  );
}
