import React from 'react';
import { Box, Button, CircularProgress, Typography, useTheme } from '@mui/material';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import AppRail from './shell/AppRail';
import MobileNav from './shell/MobileNav';
import PageHeader from './shell/PageHeader';
import DashboardHeader from './dashboard/DashboardHeader';
import AssistantWidget from './AssistantWidget';
import KeyboardShortcuts from './KeyboardShortcuts';
import { useUser } from '../contexts/UserContext';
import { useBanner } from '../contexts/BannerContext';
import { useEvent } from '../contexts/EventContext';
import { useVenueAdmin } from '../hooks/useVenueAdmin';

// Browser-tab titles per section, matching the nav labels so tabs, history and
// bookmarks are distinguishable.
const DOC_TITLES: Record<string, string> = {
  '/overview': 'הבית',
  '/guests': 'האורחים',
  '/guests/imported': 'אישור אורחים',
  '/invitation': 'ההזמנה',
  '/messages': 'תזכורות',
  '/seating': 'הושבה',
  '/recap': 'סיכום החגיגה',
  '/settings': 'הגדרות',
  '/venue': 'ניהול האולם',
  '/admin/users': 'ניהול משתמשים',
  '/admin/events': 'ניהול אירועים',
  '/admin/plans': 'חבילות ומהדורות',
  '/admin/purchases': 'רכישות ובילינג',
  '/admin/settings': 'הגדרות מערכת',
};

/**
 * The authenticated app shell - rebuilt from first principles. No top AppBar and
 * no Drawer: a glass rail floats above the page (desktop) / a dock floats at the
 * bottom (mobile), and each page owns its header in the content flow.
 */
function Layout() {
  const { user, loading, isAdmin } = useUser();
  const { events, eventsLoaded, error: eventsError, fetchEvents } = useEvent();
  const { isVenueAdmin, loading: venueAdminLoading } = useVenueAdmin();
  const location = useLocation();
  const theme = useTheme();
  const { isBannerVisible } = useBanner();
  const isDark = theme.palette.mode === 'dark';

  React.useEffect(() => {
    const section = DOC_TITLES[location.pathname];
    document.title = section ? `${section} · ShowUp` : 'ShowUp';
  }, [location.pathname]);

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
  const eventOptional = path.startsWith('/profile') || path.startsWith('/settings') || path.startsWith('/admin') || path.startsWith('/venue');

  if (!eventOptional) {
    if (!eventsLoaded) return centeredLoader;
    if (events.length === 0) {
      // A platform admin legitimately has no personal events - don't force the
      // create-event onboarding wizard; send them to the admin dashboard.
      if (isAdmin) return <Navigate to="/admin" replace />;
      // A venue admin may legitimately have zero personal events - send them to
      // their venue dashboard instead of the create-event wizard.
      if (venueAdminLoading) return centeredLoader;
      if (isVenueAdmin) return <Navigate to="/venue" replace />;
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
        background: isDark ? theme.palette.background.default : '#ffffff',
        pt: isBannerVisible ? '48px' : 0,
      }}
    >
      <AppRail />
      <MobileNav />

      {/* Content area - clears the floating rail on desktop. */}
      <Box
        component="main"
        sx={{
          pr: { xs: 0, md: '108px' },
          pl: { xs: 0, md: 2 },
        }}
      >
        {/* Application chrome - full-width, sticks to the top of the content. */}
        <Box
          sx={{
            position: 'sticky',
            top: isBannerVisible ? '48px' : 0,
            zIndex: 1100,
            bgcolor: isDark ? '#0b0e16' : '#ffffff',
            borderBottom: '1px solid',
            borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(46,58,74,0.07)',
          }}
        >
          <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2.25, sm: 4 } }}>
            <DashboardHeader />
          </Box>
        </Box>

        <Box
          sx={{
            maxWidth: 1280,
            mx: 'auto',
            px: { xs: 2.25, sm: 4 },
            pt: { xs: 2.5, md: 3.5 },
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
