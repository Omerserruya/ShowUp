import React from 'react';
import { Box, CircularProgress } from "@mui/material";
import { Outlet, Navigate } from 'react-router-dom';
import SideMenu from './SideMenuCustom/SideMenu';
import Header from './Header';
import { useUser } from '../contexts/UserContext';

function Layout() {
  const { user, loading } = useUser();

  // Show loading state while checking user authentication
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Redirect to login if not authenticated
/*  if (!user) {
    return <Navigate to="/login" replace />;
  }
*/
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <SideMenu />
      
      {/* Main content */}
      <Box sx={{ 
        flexGrow: 1, 
        marginLeft: { xs: 0, md: 0 },
        width: { xs: '100%', md: 'calc(100% - 360px)' },
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <Header />
        
        {/* Page Content */}
        <Box sx={{ 
          flexGrow: 1,
          maxWidth: '1100px',
          width: '100%',
          margin: '0',
          mt: 2,
          pl: 10,
          pr: 3,
          pb: 3
        }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}

export default Layout; 