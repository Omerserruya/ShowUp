import React from 'react';
import { Box } from '@mui/material';
import Logo from '../Logo';

/**
 * The application chrome bar - intentionally just the ShowUp logo. Full-width and
 * sticky (the wrapper lives in Layout); the event switcher, avatar and nav live in
 * the rail, so the top bar stays clean and almost invisible.
 */
export default function DashboardHeader() {
  return (
    <Box sx={{ height: 56, display: 'flex', alignItems: 'center' }}>
      <Logo height={28} mr={0} />
    </Box>
  );
}
