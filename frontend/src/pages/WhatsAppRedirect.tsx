import * as React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

/**
 * Redirect target for the WhatsApp demo template's "דברו איתי" button.
 *
 * Meta forbids direct wa.me links inside approved template buttons, so the button
 * points here (on our own domain) and we forward to the sales WhatsApp chat. The
 * number is configured via REACT_APP_WHATSAPP_NUMBER so it can change without
 * re-approving the template.
 */
const SALES_NUMBER = (process.env.REACT_APP_WHATSAPP_NUMBER || '+972-525401686').replace(/\D/g, '');
const PREFILL = encodeURIComponent('היי, ראיתי את הדמו של ShowUp ואשמח לשמוע עוד 🙂');

export default function WhatsAppRedirect() {
  React.useEffect(() => {
    window.location.replace(`https://wa.me/${SALES_NUMBER}?text=${PREFILL}`);
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        textAlign: 'center',
        px: 3,
      }}
    >
      <CircularProgress sx={{ color: '#25D366' }} />
      <Typography variant="body1" color="text.secondary">
        מעבירים אתכם לשיחה בוואטסאפ...
      </Typography>
    </Box>
  );
}
