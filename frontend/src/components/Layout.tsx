import React, { useState } from 'react';
import { Box, CircularProgress, useTheme } from "@mui/material";
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import SideMenu from './SideMenuCustom/SideMenu';
import Header from './Header';
import { useUser } from '../contexts/UserContext';

function Layout() {
  const { user, loading } = useUser();
  const location = useLocation();
  const theme = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const getHeaderContent = () => {
    switch (location.pathname) {
      case '/overview':
      case '/home':
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
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
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
        }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}

export default Layout; 