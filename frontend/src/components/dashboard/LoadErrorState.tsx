import React from 'react';
import { Box, Typography, Button } from '@mui/material';

/**
 * Full-content error state for a failed data load. A failed fetch must never
 * render as a confident all-zeros screen - it shows this reassurance + retry instead.
 */
export default function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Box sx={{ p: 4, direction: 'rtl', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 400, textAlign: 'center', gap: 1.5 }}>
      <Typography sx={{ fontSize: '2rem' }}>😕</Typography>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>לא הצלחנו לטעון את נתוני האירוע</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 380 }}>
        האישורים שלכם שמורים ובטוחים - זו רק תקלת טעינה זמנית.
      </Typography>
      <Button variant="contained" disableElevation onClick={onRetry} sx={{ mt: 1, borderRadius: 99, px: 3, fontWeight: 700 }}>
        נסו שוב
      </Button>
    </Box>
  );
}
