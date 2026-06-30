import React from 'react';
import { Box, Button, CircularProgress, Typography, useTheme } from '@mui/material';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import AppRail from './shell/AppRail';
import MobileNav from './shell/MobileNav';
import PageHeader from './shell/PageHeader';
import AssistantWidget from './AssistantWidget';
import KeyboardShortcuts from './KeyboardShortcuts';
import { useUser } from '../contexts/UserContext';
import { useBanner } from '../contexts/BannerContext';
import { useEvent } from '../contexts/EventContext';

/**
 * The authenticated app shell - rebuilt from first principles. No top AppBar and
 * no Drawer: a glass rail floats above the page (desktop) / a dock floats at the
 * bottom (mobile), and each page owns its header in the content flow.
 */
function Layout() {
  const { user, loading } = useUser();
  const { events, eventsLoaded, error: eventsError, fetchEvents } = useEvent();
  const location = useLocation();
  const theme = useTheme();
  const { isBannerVisible } = useBanner();
  const isDark = theme.palette.mode === 'dark';

  const centeredLoader = (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <CircularProgress sx={{ color: '#888cee' }} />
    </Box>
  );

  // Auth gate
  if (loading) return centeredLoader;
  if (!loading && !user) return <Navigate to="/login" replace />;

  // Event-resolution guard (shared by every event-scoped page).
  const path = location.pathname;
  const eventOptional = path.startsWith('/profile') || path.startsWith('/admin');

  if (!eventOptional) {
    if (!eventsLoaded) return centeredLoader;
    if (events.length === 0) {
      if (eventsError) {
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center', alignItems: 'center', height: '100vh', px: 3, textAlign: 'center', direction: 'rtl' }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>לא הצלחנו לטעון את האירועים</Typography>
            <Typography color="text.secondary">בדקו את החיבור ונסו שוב.</Typography>
            <Button variant="contained" onClick={() => fetchEvents()}>נסו שוב</Button>
          </Box>
        );
      }
      // Unfinished order → resume at checkout; otherwise onboarding.
      const pendingOrderId = localStorage.getItem('pending_order_id');
      if (pendingOrderId) return <Navigate to={`/payment?orderId=${encodeURIComponent(pendingOrderId)}`} replace />;
      return <Navigate to="/wizard" replace />;
    }
  }

  return (
    <Box
      dir="rtl"
      sx={{
        minHeight: '100dvh',
        bgcolor: isDark ? 'background.default' : '#ffffff',
        pt: isBannerVisible ? '48px' : 0,
      }}
    >
      <AppRail />
      <MobileNav />

      {/* Content - no chrome above it; the page header lives inside. */}
      <Box
        component="main"
        sx={{
          // Clear the floating rail on desktop (it sits at the right edge).
          pr: { xs: 0, md: '108px' },
          pl: { xs: 0, md: 2 },
        }}
      >
        <Box
          sx={{
            maxWidth: 1280,
            mx: 'auto',
            px: { xs: 2.25, sm: 4 },
            pt: { xs: 3, md: 5 },
            pb: { xs: '120px', md: 6 }, // room for the mobile dock
          }}
        >
          <PageHeader />
          <Outlet />
        </Box>
      </Box>

      <AssistantWidget />
      <KeyboardShortcuts />
    </Box>
  );
}

export default Layout;
