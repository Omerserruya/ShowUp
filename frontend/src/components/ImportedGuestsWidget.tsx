import React from 'react';
import { Box, Paper, Typography, Button, alpha } from '@mui/material';
import { WhatsApp as WhatsAppIcon, ArrowForward as ArrowForwardIcon } from '@mui/icons-material';
import { useGuestImportSummary } from '../hooks/useGuestImports';
import { CircularProgress } from '@mui/material';

interface ImportedGuestsWidgetProps {
  onClick: () => void;
}

/**
 * Mobile widget showing count of pending imported guests
 * Displays as a separate widget before filters, styled like the filter widget
 */
export function ImportedGuestsWidget({ onClick }: ImportedGuestsWidgetProps) {
  const { summary, loading } = useGuestImportSummary();

  // Don't render if no pending imports
  if (!loading && summary.pending_count === 0) {
    return null;
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Paper
      component={Button}
      onClick={onClick}
      fullWidth
      sx={{
        p: 2.5,
        mb: 2,
        borderRadius: 2,
        backgroundColor: '#5236F7',
        boxShadow: 'none',
        border: 'none',
        textAlign: 'right',
        textTransform: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        '&:hover': {
          backgroundColor: '#4529D9',
          boxShadow: 'none',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
        <Box
          sx={{
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: 1.5,
            p: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <WhatsAppIcon sx={{ color: 'white', fontSize: 24 }} />
        </Box>
        <Box sx={{ flex: 1, textAlign: 'right' }}>
          <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.5, color: 'white' }}>
            יש לך {summary.pending_count} אורחים שיובאו מ-WhatsApp
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '0.875rem' }}>
            נדרש אישור והשלמת פרטים
          </Typography>
        </Box>
      </Box>
      <ArrowForwardIcon sx={{ color: 'white' }} />
    </Paper>
  );
}
