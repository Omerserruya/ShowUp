import React from 'react';
import { Box, Typography } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { pageMeta } from './navConfig';

/**
 * Each page's own header, in the content flow (no global app bar). The page title
 * is large and warm; content begins right beneath it. Routes without an entry
 * (e.g. the dashboard, which has its own hero) render nothing.
 */
export default function PageHeader() {
  const { pathname } = useLocation();
  const meta = pageMeta[pathname];
  if (!meta) return null;

  return (
    <Box sx={{ mb: { xs: 3, md: 4 } }}>
      <Typography component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: { xs: '1.7rem', md: '2.1rem' }, lineHeight: 1.1, color: 'text.primary' }}>
        {meta.title}
      </Typography>
      {meta.subtitle && (
        <Typography sx={{ mt: 0.75, fontSize: { xs: '0.95rem', md: '1.05rem' }, color: 'text.secondary' }}>
          {meta.subtitle}
        </Typography>
      )}
    </Box>
  );
}
