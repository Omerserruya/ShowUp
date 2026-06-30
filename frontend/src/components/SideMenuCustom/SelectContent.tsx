import * as React from 'react';
import { Box, Menu, MenuItem, ListItemText, ListItemIcon, Divider, Typography, IconButton, CircularProgress, alpha, useTheme } from '@mui/material';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useEvent } from '../../contexts/EventContext';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

const BRAND = '#888cee';
const DEEP = '#6f74e0';
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

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

function formatDate(dateString?: string) {
  if (!dateString) return '';
  const d = dayjs(dateString);
  if (!d.isValid()) return '';
  return `${d.date()} ב${HE_MONTHS[d.month()]} ${d.year()}`;
}

export default function SelectContent() {
  const { selectedEvent, setSelectedEvent, events, loading } = useEvent();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleSelect = (id: string) => {
    const evt = events.find((e) => e.id === id);
    if (evt) setSelectedEvent(evt);
    setAnchorEl(null);
  };

  return (
    <Box sx={{ px: 1.5, mb: 1.5 }}>
      <Box
        onClick={(e) => setAnchorEl(e.currentTarget)}
        role="button"
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25,
          p: 1.25, borderRadius: 3, cursor: 'pointer',
          border: '1px solid', borderColor: isDark ? alpha('#fff', 0.08) : alpha(theme.palette.text.primary, 0.08),
          bgcolor: isDark ? alpha('#fff', 0.03) : alpha(BRAND, 0.05),
          transition: 'border-color .15s ease, background-color .15s ease',
          '&:hover': { borderColor: alpha(BRAND, 0.45) },
        }}
      >
        <Box sx={{ width: 38, height: 38, borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', background: `linear-gradient(135deg, ${alpha(DEEP, 0.18)}, ${alpha(BRAND, 0.12)})` }}>
          {selectedEvent ? emojiFor((selectedEvent as any)?.type, selectedEvent.name) : '✨'}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', color: 'text.disabled' }}>האירוע שלכם</Typography>
          {selectedEvent ? (
            <>
              <Typography noWrap sx={{ fontSize: '0.95rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.3 }}>{selectedEvent.name}</Typography>
              {formatDate((selectedEvent as any)?.date) && (
                <Typography noWrap sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{formatDate((selectedEvent as any)?.date)}</Typography>
              )}
            </>
          ) : (
            <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>בחרו אירוע</Typography>
          )}
        </Box>
        <IconButton size="small" sx={{ color: 'text.secondary' }}><UnfoldMoreRoundedIcon sx={{ fontSize: 18 }} /></IconButton>
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { mt: 1, minWidth: 260, maxHeight: 420, direction: 'rtl', borderRadius: 3, border: '1px solid', borderColor: 'divider', boxShadow: '0 12px 32px rgba(16,24,40,0.14)', overflow: 'hidden' } }}
      >
        <Typography sx={{ px: 2, pt: 1.5, pb: 1, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'text.disabled' }}>האירועים שלכם</Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} sx={{ color: BRAND }} /></Box>
        ) : events.length > 0 ? (
          events.map((event) => {
            const sel = selectedEvent?.id === event.id;
            return (
              <MenuItem key={event.id} dir="rtl" onClick={() => handleSelect(event.id)} sx={{ py: 1.25, borderRadius: 2, mx: 0.75, my: 0.25, '&:hover': { bgcolor: alpha(BRAND, 0.08) } }}>
                <ListItemIcon sx={{ minWidth: 36, fontSize: '1.15rem' }}>{emojiFor((event as any)?.type, event.name)}</ListItemIcon>
                <ListItemText
                  primary={event.name}
                  secondary={formatDate((event as any)?.date)}
                  sx={{ textAlign: 'right', '& .MuiListItemText-primary': { fontSize: '0.92rem', fontWeight: sel ? 700 : 500 }, '& .MuiListItemText-secondary': { fontSize: '0.78rem' } }}
                />
                {sel && <CheckRoundedIcon sx={{ fontSize: 18, color: DEEP, ml: 1 }} />}
              </MenuItem>
            );
          })
        ) : (
          <MenuItem disabled dir="rtl"><ListItemText primary="עוד אין אירועים" sx={{ textAlign: 'right' }} /></MenuItem>
        )}

        <Divider sx={{ my: 0.5 }} />
        <MenuItem dir="rtl" onClick={() => { setAnchorEl(null); navigate('/wizard'); }} sx={{ py: 1.25, mx: 0.75, my: 0.25, borderRadius: 2, color: DEEP, '&:hover': { bgcolor: alpha(BRAND, 0.08) } }}>
          <ListItemIcon sx={{ minWidth: 36, color: DEEP }}><AddRoundedIcon /></ListItemIcon>
          <ListItemText primary="אירוע חדש" sx={{ textAlign: 'right', '& .MuiListItemText-primary': { fontSize: '0.92rem', fontWeight: 700 } }} />
        </MenuItem>
      </Menu>
    </Box>
  );
}
