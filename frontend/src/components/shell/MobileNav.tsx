import React, { useState } from 'react';
import { Box, Typography, IconButton, alpha, useTheme } from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useNavigate, useLocation } from 'react-router-dom';
import { mobileNav, primaryNav, accountNav, NavItem } from './navConfig';
import EventSwitcher from './EventSwitcher';
import UserAvatar from '../UserAvatar';
import OptionsMenu from '../OptionsMenu';
import { useUser } from '../../contexts/UserContext';
import { useEvent } from '../../contexts/EventContext';

const BRAND = '#888cee';
const DEEP = '#6f74e0';

export default function MobileNav() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { selectedEvent } = useEvent();
  const [sheetOpen, setSheetOpen] = useState(false);

  const go = (path: string) => { navigate(path); setSheetOpen(false); };
  // Show premium items with a lock marker rather than hiding them.
  const allItems = [...primaryNav, ...accountNav];

  const dockBg = isDark ? alpha('#16161c', 0.82) : alpha('#ffffff', 0.82);

  return (
    <Box sx={{ display: { xs: 'block', md: 'none' } }}>
      {/* Floating dock */}
      <Box sx={{ position: 'fixed', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 1250, width: 'calc(100% - 28px)', maxWidth: 440, display: 'flex', alignItems: 'center', justifyContent: 'space-around', px: 1, py: 0.75, borderRadius: 99, bgcolor: dockBg, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid', borderColor: isDark ? alpha('#fff', 0.08) : alpha('#0f172a', 0.06), boxShadow: `0 12px 34px ${alpha('#0f172a', isDark ? 0.5 : 0.14)}` }}>
        {mobileNav.map((item) => {
          const selected = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          return (
            <Box key={item.path} component="button" aria-current={selected ? 'page' : undefined} aria-label={item.label} onClick={() => go(item.path)} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, py: 0.75, border: 'none', font: 'inherit', cursor: 'pointer', borderRadius: 4, color: selected ? DEEP : 'text.secondary', bgcolor: selected ? alpha(BRAND, 0.12) : 'transparent', transition: 'all .18s ease', '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2 }, '& svg': { fontSize: 23 } }}>
              {item.icon}
              <Typography sx={{ fontSize: '0.62rem', fontWeight: selected ? 800 : 600 }}>{item.label}</Typography>
            </Box>
          );
        })}
        <Box component="button" aria-label="עוד" aria-haspopup="true" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, py: 0.75, border: 'none', font: 'inherit', cursor: 'pointer', bgcolor: 'transparent', borderRadius: 4, color: 'text.secondary', '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2 }, '& svg': { fontSize: 23 } }}>
          <MenuRoundedIcon />
          <Typography sx={{ fontSize: '0.62rem', fontWeight: 600 }}>עוד</Typography>
        </Box>
      </Box>

      {/* Slide-up sheet */}
      <Box sx={{ position: 'fixed', inset: 0, zIndex: 1300, pointerEvents: sheetOpen ? 'auto' : 'none' }}>
        <Box onClick={() => setSheetOpen(false)} sx={{ position: 'absolute', inset: 0, bgcolor: alpha('#0f172a', 0.45), opacity: sheetOpen ? 1 : 0, transition: 'opacity .25s ease' }} />
        <Box dir="rtl" sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, p: 2.5, pb: 4, borderTopLeftRadius: 28, borderTopRightRadius: 28, bgcolor: 'background.paper', transform: sheetOpen ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .32s cubic-bezier(.2,.8,.2,1)', maxHeight: '85vh', overflowY: 'auto' }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: alpha(theme.palette.text.primary, 0.18), mx: 'auto', mb: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1.5 }}>
            <IconButton onClick={() => setSheetOpen(false)} sx={{ color: 'text.secondary' }}><CloseRoundedIcon /></IconButton>
          </Box>

          <EventSwitcher expanded />

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 2.5 }}>
            {allItems.map((item: NavItem) => {
              const selected = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
              return (
                <Box key={item.path} component="button" aria-current={selected ? 'page' : undefined} onClick={() => go(item.path)} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, border: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'start', borderRadius: 3, color: selected ? DEEP : 'text.primary', bgcolor: selected ? alpha(BRAND, 0.12) : alpha(theme.palette.text.primary, 0.035), '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2 }, '& svg': { fontSize: 22, color: selected ? DEEP : 'text.secondary' } }}>
                  {item.icon}
                  <Typography sx={{ flex: 1, fontSize: '0.9rem', fontWeight: selected ? 800 : 600 }}>{item.label}</Typography>
                </Box>
              );
            })}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2.5, p: 1.5, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.035) }}>
            <UserAvatar username={user?.username || 'Guest'} />
            <Typography sx={{ flex: 1, fontSize: '0.9rem', fontWeight: 700 }}>{user?.username || 'אורח'}</Typography>
            <OptionsMenu />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
