import React from 'react';
import { Box, Menu, MenuItem, ListItemText, ListItemIcon, Divider, Typography, CircularProgress, alpha, useTheme } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import { useEvent } from '../../contexts/EventContext';
import { useNavigate } from 'react-router-dom';
import { daysUntilEvent } from '../../utils/dates';
import { eventDateISO, eventTypeKey } from '../../adapters/eventSnapshot';

const BRAND = '#9D83E0';
const DEEP = '#5A3DA6';

const TYPE_ICON: Record<string, string> = { wedding: 'favorite', bar: 'menu_book', bat: 'auto_awesome', brit: 'child_care', brita: 'child_friendly', birthday: 'cake', corporate: 'apartment' };
const TYPE_LABEL: Record<string, string> = { wedding: 'חתונה', bar: 'בר מצווה', bat: 'בת מצווה', brit: 'ברית', brita: 'בריתה', birthday: 'יום הולדת', corporate: 'אירוע חברה' };
const HE_MONTHS = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני', 'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];

/** Material Symbol for the event type (design v6 - no emoji in the UI). */
function emojiFor(type?: string, _name?: string): React.ReactNode {
  return <span className="ms" style={{ fontSize: 20, color: DEEP }}>{TYPE_ICON[(type || '').toLowerCase()] || 'celebration'}</span>;
}

function typeDateLine(type?: string, dateISO?: string): string {
  const parts: string[] = [];
  const t = TYPE_LABEL[(type || '').toLowerCase()];
  if (t) parts.push(t);
  if (dateISO) {
    const d = new Date(dateISO);
    if (!isNaN(d.getTime())) parts.push(`${d.getDate()} ${HE_MONTHS[d.getMonth()]}`);
  }
  return parts.join(' · ');
}

function countdownLabel(dateISO?: string): string {
  if (!dateISO) return '';
  const days = daysUntilEvent(dateISO);
  if (days === null) return '';
  if (days > 1) return `עוד ${days} ימים`;
  if (days === 1) return 'מחר!';
  if (days === 0) return 'היום!';
  return 'האירוע מאחורינו';
}

export default function EventSwitcher({ expanded, variant = 'rail' }: { expanded: boolean; variant?: 'rail' | 'header' | 'card' }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { selectedEvent, setSelectedEvent, events, loading } = useEvent();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const paid = (selectedEvent as any)?.paymentStatus === 'paid' || (selectedEvent as any)?.paymentStatus === 'free';
  const statusColor = paid ? '#22c55e' : '#f59e0b';
  const countdown = countdownLabel(eventDateISO(selectedEvent) || undefined);

  const trigger = variant === 'card' ? (
      <Box
        component="button"
        aria-label={selectedEvent ? `החלפת אירוע - ${selectedEvent.name}` : 'בחירת אירוע'}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        onClick={(e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
        className="su-hover-ink"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', p: '13px 14px', border: '1.5px solid #E6E2DA', bgcolor: '#FFFFFF', cursor: 'pointer', borderRadius: '16px', textAlign: 'right', font: 'inherit', color: '#16150F' }}
      >
        <Box component="span" sx={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <Box component="span" sx={{ display: 'block', fontSize: 12, letterSpacing: '.06em', color: DEEP, fontWeight: 500 }}>האירוע</Box>
          <Box component="span" sx={{ display: 'block', fontSize: 16, fontWeight: 600, mt: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedEvent ? selectedEvent.name : 'בחרו אירוע'}</Box>
          <Box component="span" sx={{ display: 'block', fontSize: 12.5, color: '#6B6660', mt: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedEvent ? typeDateLine(eventTypeKey(selectedEvent), eventDateISO(selectedEvent) || undefined) : ''}</Box>
        </Box>
        <span className="ms" style={{ fontSize: 19, color: '#6B6660' }}>unfold_more</span>
      </Box>
  ) : variant === 'header' ? (
      <Box
        component="button"
        aria-label={selectedEvent ? `החלפת אירוע - ${selectedEvent.name}` : 'בחירת אירוע'}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        onClick={(e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, maxWidth: 360,
          font: 'inherit', textAlign: 'inherit',
          pl: 1.25, pr: 0.75, py: 0.5, borderRadius: 999, cursor: 'pointer',
          bgcolor: 'transparent', border: '1px solid transparent',
          transition: 'background-color .18s ease, border-color .18s ease',
          '&:hover': { bgcolor: isDark ? alpha('#fff', 0.05) : alpha(BRAND, 0.08), borderColor: alpha(BRAND, 0.25) },
          '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2 },
        }}
      >
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.05rem', bgcolor: alpha(BRAND, isDark ? 0.2 : 0.12) }}>
            {selectedEvent ? emojiFor(eventTypeKey(selectedEvent), selectedEvent.name) : emojiFor()}
          </Box>
          <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', bgcolor: statusColor, border: `2px solid ${isDark ? '#0b0e16' : '#F5F1E9'}` }} />
        </Box>
        <Box sx={{ minWidth: 0, textAlign: 'right' }}>
          <Typography noWrap sx={{ fontSize: '0.92rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.2 }}>
            {selectedEvent ? selectedEvent.name : 'בחרו אירוע'}
          </Typography>
          {selectedEvent && (
            <Typography noWrap sx={{ fontSize: '0.74rem', fontWeight: 600, lineHeight: 1.2, color: countdown.includes('היום') ? DEEP : 'text.secondary' }}>
              {countdown || 'לחצו להחלפה'}
            </Typography>
          )}
        </Box>
        <UnfoldMoreRoundedIcon sx={{ fontSize: 18, color: 'text.disabled', flexShrink: 0 }} />
      </Box>
  ) : (
      <Box
        component="button"
        aria-label={selectedEvent ? `החלפת אירוע - ${selectedEvent.name}` : 'בחירת אירוע'}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        onClick={(e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, width: '100%',
          font: 'inherit', textAlign: 'inherit',
          p: 1, borderRadius: 3, cursor: 'pointer',
          bgcolor: isDark ? alpha('#fff', 0.04) : alpha(BRAND, 0.06),
          border: '1px solid', borderColor: isDark ? alpha('#fff', 0.06) : alpha(BRAND, 0.12),
          transition: 'border-color .2s ease, background-color .2s ease',
          '&:hover': { borderColor: alpha(BRAND, 0.5) },
          '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2 },
        }}
      >
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', background: `linear-gradient(135deg, ${alpha(DEEP, 0.2)}, ${alpha(BRAND, 0.12)})` }}>
            {selectedEvent ? emojiFor(eventTypeKey(selectedEvent), selectedEvent.name) : emojiFor()}
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
  );

  return (
    <>
      {trigger}

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: variant !== 'rail' ? 'right' : 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: variant !== 'rail' ? 'right' : 'left' }}
        PaperProps={{ sx: { mt: 1, minWidth: 280, maxHeight: 440, direction: 'rtl', borderRadius: 3.5, border: '1px solid', borderColor: 'divider', boxShadow: '0 18px 44px rgba(16,24,40,0.18)', overflow: 'hidden', p: 0.75 } }}
      >
        <Typography sx={{ px: 1.5, pt: 1, pb: 1, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', color: 'text.disabled' }}>האירועים שלי</Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} sx={{ color: BRAND }} /></Box>
        ) : events.length > 0 ? (
          events.map((event) => {
            const sel = selectedEvent?.id === event.id;
            const cd = countdownLabel(eventDateISO(event) || undefined);
            return (
              <MenuItem key={event.id} dir="rtl" onClick={() => { setSelectedEvent(event); setAnchorEl(null); }}
                sx={{ py: 1.1, borderRadius: 2.5, my: 0.25, bgcolor: sel ? alpha(BRAND, 0.1) : 'transparent', '&:hover': { bgcolor: alpha(BRAND, 0.08) } }}>
                <ListItemIcon sx={{ minWidth: 40 }}>{emojiFor(eventTypeKey(event), event.name)}</ListItemIcon>
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
          <ListItemText primary="אירוע חדש" sx={{ textAlign: 'right', '& .MuiListItemText-primary': { fontSize: '0.92rem', fontWeight: 800 } }} />
        </MenuItem>
      </Menu>
    </>
  );
}
