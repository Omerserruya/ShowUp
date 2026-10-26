import React from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import SideNav from './shell/SideNav';
import MobileNav from './shell/MobileNav';
import AppHeader from './shell/AppHeader';
import { SnapshotProvider } from '../contexts/SnapshotContext';
import AssistantWidget from './AssistantWidget';
import KeyboardShortcuts from './KeyboardShortcuts';
import { useUser } from '../contexts/UserContext';
import { useBanner } from '../contexts/BannerContext';
import { useEvent } from '../contexts/EventContext';
import { useVenueAdmin } from '../hooks/useVenueAdmin';

// Browser-tab titles per section, matching the nav labels so tabs, history and
// bookmarks are distinguishable.
const DOC_TITLES: Record<string, string> = {
  '/overview': 'סקירה',
  '/insights': 'תמונת מצב',
  '/guests': 'מוזמנים',
  '/guests/imported': 'אישור אורחים',
  '/invitation': 'ההזמנה',
  '/messages': 'סבבי שליחה',
  '/seating': 'הושבה',
  '/recap': 'סיכום החגיגה',
  '/settings': 'הגדרות',
  '/venue': 'ניהול האולם',
  '/admin/operations': 'מרכז תפעול',
  '/admin/users': 'ניהול משתמשים',
  '/admin/events': 'ניהול אירועים',
  '/admin/plans': 'חבילות ומהדורות',
  '/admin/entitlements': 'הזמנות למימוש',
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
  const { isBannerVisible } = useBanner();

  React.useEffect(() => {
    const section = DOC_TITLES[location.pathname];
    document.title = section ? `${section} · ShowUp` : 'ShowUp';
  }, [location.pathname]);

  const centeredLoader = (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <CircularProgress sx={{ color: '#9D83E0' }} />
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

  const fullBleed = location.pathname.startsWith('/seating') || location.pathname.startsWith('/invitation');
  return (
    <SnapshotProvider>
      <Box
        dir="rtl"
        className="su-scope"
        sx={{ position: 'relative', minHeight: '100dvh', bgcolor: '#F5F1E9', pt: isBannerVisible ? '48px' : 0 }}
      >
        {/* Design v6 backdrop: the ShowUp seal, very faint, plus a dot grid. */}
        <Box aria-hidden="true" sx={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <Box component="img" src="/brand/seal.png" alt="" sx={{ position: 'absolute', top: '50%', left: '34%', width: '120vmax', height: '120vmax', m: '-60vmax 0 0 -60vmax', objectFit: 'contain', opacity: 0.05, filter: 'grayscale(0.2)', display: { xs: 'none', md: 'block' } }} />
          <Box sx={{ position: 'absolute', inset: 0, opacity: 0.3, backgroundImage: 'radial-gradient(rgba(22,21,15,.09) .9px,transparent 1px)', backgroundSize: '46px 46px' }} />
        </Box>

        <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', minHeight: '100dvh' }}>
          <SideNav />
          <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
            <AppHeader />
            <Box
              sx={{
                maxWidth: fullBleed ? 'none' : 1240,
                mx: 'auto',
                px: fullBleed ? { xs: 2.25, md: 2 } : { xs: 2.25, md: 4 },
                pt: { xs: 2.5, md: 3.25 },
                pb: { xs: '110px', md: 8 }, // room for the mobile tab bar
              }}
            >
              <Outlet />
            </Box>
          </Box>
        </Box>

        <MobileNav />
        <AssistantWidget />
        <KeyboardShortcuts />
      </Box>
    </SnapshotProvider>
  );
}

export default Layout;
