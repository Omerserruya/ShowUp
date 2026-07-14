import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useUser } from '../contexts/UserContext';
import { useVenueAdmin } from '../hooks/useVenueAdmin';

/** Guards the /venue area: only users who administer at least one venue may enter. */
export default function VenueRoute({ children }: { children: React.ReactNode }) {
  const { user, loading: userLoading } = useUser();
  const { isVenueAdmin, loading } = useVenueAdmin();

  if (userLoading || loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress sx={{ color: '#888cee' }} />
      </Box>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isVenueAdmin) return <Navigate to="/overview" replace />;
  return <>{children}</>;
}
