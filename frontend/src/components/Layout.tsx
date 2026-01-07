import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, useTheme, Paper, BottomNavigation, BottomNavigationAction } from "@mui/material";
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
        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : '#f6f7fb',
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
          pb: { xs: 8, md: 0 }, // space for bottom nav on mobile
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
            elevation={6}
            sx={{
              position: 'fixed',
              zIndex: (theme) => theme.zIndex.appBar + 1,
              bottom: isBannerVisible ? 56 : 16,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100% - 16px)',
              maxWidth: 480,
              borderRadius: 999,
              px: 1.5,
              py: 0.75,
              backdropFilter: 'blur(10px)',
              backgroundColor: 'rgba(255,255,255,0.94)',
              boxShadow: '0 10px 30px rgba(15,23,42,0.15)',
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
                background: 'transparent',
              }}
            >
              <BottomNavigationAction
                label="ראשי"
                value="/overview"
                icon={<HomeIcon />}
              />
              <BottomNavigationAction
                label="אורחים"
                value="/guests"
                icon={<PeopleIcon />}
              />
              <BottomNavigationAction
                label="קמפיינים"
                value="/messages"
                icon={<SendIcon />}
              />
              <BottomNavigationAction
                label="אני"
                value="/profile"
                icon={<PersonIcon />}
              />
            </BottomNavigation>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}

export default Layout; 