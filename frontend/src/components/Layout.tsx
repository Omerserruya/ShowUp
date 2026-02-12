import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, useTheme, Paper, BottomNavigation, BottomNavigationAction, alpha } from "@mui/material";
import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import SideMenu from './SideMenuCustom/SideMenu';
import Header from './Header';
import { useUser } from '../contexts/UserContext';
import { useBanner } from '../contexts/BannerContext';
import HomeIcon from '@mui/icons-material/Home';
import PeopleIcon from '@mui/icons-material/People';
import SendIcon from '@mui/icons-material/Send';
import PersonIcon from '@mui/icons-material/Person';

function Layout() {
  const { user, loading } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bottomNavValue, setBottomNavValue] = useState(location.pathname);
  const { isBannerVisible } = useBanner();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    setBottomNavValue(location.pathname);
  }, [location.pathname]);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const getHeaderContent = () => {
    switch (location.pathname) {
      case '/overview':
        return {
          title: 'לוח בקרה',
          subtitle: 'סקירה כללית של האירוע שלך',
        };
      case '/guests':
        return {
          title: 'רשימת אורחים',
          subtitle: 'ניהול האורחים והסטטוסים שלהם',
        };
      case '/messages':
        return {
          title: 'ניהול קמפיינים',
          subtitle: 'הודעות, תזכורות ועדכונים לאורחים',
        };
      case '/seating':
        return {
          title: 'סידור מושבים',
          subtitle: 'תכנון ישיבה ומיקום האורחים',
        };
      case '/profile':
        return {
          title: 'הפרופיל שלי',
          subtitle: 'פרטי החשבון וההגדרות שלך',
        };
      case '/admin/users':
        return {
          title: 'ניהול משתמשים',
          subtitle: 'צפייה, עריכה ומחיקה של משתמשים במערכת',
        };
      case '/admin/events':
        return {
          title: 'ניהול אירועים',
          subtitle: 'צפייה בכל האירועים, אורחים וקמפיינים',
        };
      case '/admin/purchases':
        return {
          title: 'רכישות ובילינג',
          subtitle: 'ניהול תשלומים וחבילות',
        };
      case '/admin/settings':
        return {
          title: 'הגדרות מערכת',
          subtitle: 'הגדרות כלליות של המערכת',
        };
      default:
        return {
          title: 'לוח בקרה',
          subtitle: 'סקירה כללית של האירוע שלך',
        };
    }
  };

  const headerContent = getHeaderContent();

  // Show loading state while checking user authentication
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Redirect to login if not authenticated
  if (!loading && !user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', pt: isBannerVisible ? '48px' : 0 }}>
      {/* Sidebar - Desktop permanent, Mobile drawer */}
      <SideMenu mobileOpen={mobileOpen} onMobileClose={handleDrawerToggle} />

      {/* Main content */}
      <Box sx={{
        flexGrow: 1,
        marginLeft: { xs: 0, md: 0 },
        width: { xs: '100%', md: 'calc(100% - 280px)' },
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: isDark ? 'background.default' : 'grey.50',
      }}>
        {/* Top app header (sticky) */}
        <Header
          title={headerContent.title}
          subtitle={headerContent.subtitle}
          onMenuClick={handleDrawerToggle}
        />

        {/* Page Content */}
        <Box sx={{
          flexGrow: 1,
          width: '100%',
          margin: '0',
          pb: { xs: 10, md: 0 }, // space for bottom nav on mobile
        }}>
          <Outlet />
        </Box>

        {/* Floating bottom navigation - mobile only */}
        <Box
          sx={{
            display: { xs: 'flex', md: 'none' },
            justifyContent: 'center',
            alignItems: 'center',
            pb: 2,
          }}
        >
          <Paper
            elevation={0}
            sx={{
              position: 'fixed',
              zIndex: (theme) => theme.zIndex.appBar + 1,
              bottom: isBannerVisible ? 56 : 16,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100% - 24px)',
              maxWidth: 420,
              borderRadius: 4,
              px: 0.5,
              py: 0.5,
              backdropFilter: 'blur(16px)',
              bgcolor: isDark
                ? alpha(theme.palette.background.paper, 0.85)
                : alpha('#ffffff', 0.9),
              border: '1px solid',
              borderColor: isDark
                ? alpha(theme.palette.divider, 0.3)
                : alpha(theme.palette.divider, 0.2),
              boxShadow: isDark
                ? `0 8px 32px ${alpha('#000', 0.4)}`
                : `0 8px 32px ${alpha('#0f172a', 0.12)}`,
            }}
          >
            <BottomNavigation
              showLabels
              value={bottomNavValue}
              onChange={(_, newValue) => {
                setBottomNavValue(newValue);
                if (newValue === '/overview' || newValue === '/guests' || newValue === '/messages' || newValue === '/profile') {
                  navigate(newValue);
                }
              }}
              sx={{
                bgcolor: 'transparent',
                height: 56,
                '& .MuiBottomNavigationAction-root': {
                  color: 'text.secondary',
                  minWidth: 'auto',
                  borderRadius: 2.5,
                  mx: 0.25,
                  transition: 'all 0.2s ease',
                  '&.Mui-selected': {
                    color: 'primary.main',
                    bgcolor: isDark
                      ? alpha(theme.palette.primary.main, 0.12)
                      : alpha(theme.palette.primary.main, 0.08),
                  },
                  '& .MuiBottomNavigationAction-label': {
                    fontSize: '0.7rem',
                    fontWeight: 500,
                    '&.Mui-selected': {
                      fontSize: '0.7rem',
                      fontWeight: 600,
                    },
                  },
                },
              }}
            >
              <BottomNavigationAction
                label="ראשי"
                value="/overview"
                icon={<HomeIcon sx={{ fontSize: 22 }} />}
              />
              <BottomNavigationAction
                label="אורחים"
                value="/guests"
                icon={<PeopleIcon sx={{ fontSize: 22 }} />}
              />
              <BottomNavigationAction
                label="קמפיינים"
                value="/messages"
                icon={<SendIcon sx={{ fontSize: 22 }} />}
              />
              <BottomNavigationAction
                label="אני"
                value="/profile"
                icon={<PersonIcon sx={{ fontSize: 22 }} />}
              />
            </BottomNavigation>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}

export default Layout;