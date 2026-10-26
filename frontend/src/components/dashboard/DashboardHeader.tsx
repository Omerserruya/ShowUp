import React from 'react';
import { Box, Button, Typography, alpha, useTheme } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import Logo from '../Logo';
import EventSwitcher from '../shell/EventSwitcher';
import UserAvatar from '../UserAvatar';
import OptionsMenu from '../OptionsMenu';
import { useUser } from '../../contexts/UserContext';

const SUPPORT_WA = (process.env.REACT_APP_WHATSAPP_NUMBER || '+972-525401686').replace(/\D/g, '');

/**
 * The application chrome bar. Reading order (RTL): the logo, then the event you
 * are working on (name + countdown, click to switch), and on the far side help
 * and the signed-in user. The rail keeps navigation; this bar answers "where am I
 * and who am I" without hovering anything.
 */
export default function DashboardHeader() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useUser();
  // Admin / venue consoles are not event-scoped - no event pill there.
  const eventScoped = !pathname.startsWith('/admin') && !pathname.startsWith('/venue');
  const hairline = isDark ? alpha('#fff', 0.1) : alpha('#2E3A4A', 0.12);

  return (
    <Box sx={{ height: { xs: 56, md: 62 }, display: 'flex', alignItems: 'center', gap: { xs: 1.5, md: 2.5 } }}>
      <Box
        role="link"
        tabIndex={0}
        aria-label="ShowUp - הבית"
        onClick={() => navigate('/overview')}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/overview'); } }}
        sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: 1, '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 4 } }}
      >
        <Logo height={28} mr={0} />
      </Box>

      {/* Event context - desktop only; the mobile sheet carries the switcher. */}
      {eventScoped && (
        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Box sx={{ width: '1px', height: 26, bgcolor: hairline }} />
          <EventSwitcher expanded variant="header" />
        </Box>
      )}

      <Box sx={{ flex: 1 }} />

      {/* Help + user - desktop only. */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1 }}>
        <Button
          component="a"
          href={`https://wa.me/${SUPPORT_WA}`}
          target="_blank"
          rel="noopener noreferrer"
          startIcon={<WhatsAppIcon sx={{ fontSize: 18 }} />}
          sx={{
            color: 'text.secondary', fontWeight: 600, fontSize: '0.86rem', borderRadius: 999, px: 1.5,
            '& .MuiButton-startIcon': { ml: 0.5, mr: -0.25 },
            '&:hover': { color: 'text.primary', bgcolor: alpha('#2E3A4A', isDark ? 0.08 : 0.05) },
          }}
        >
          צריכים עזרה?
        </Button>
        <Box sx={{ width: '1px', height: 26, bgcolor: hairline, mx: 0.5 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <UserAvatar username={user?.username || 'אורח'} size={32} showUsername={false} />
          <Typography noWrap sx={{ fontSize: '0.86rem', fontWeight: 700, color: 'text.primary', maxWidth: 160 }}>
            {user?.username || 'אורח'}
          </Typography>
          <OptionsMenu />
        </Box>
      </Box>
    </Box>
  );
}
