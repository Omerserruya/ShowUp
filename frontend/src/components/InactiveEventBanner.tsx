import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Alert, IconButton, Typography, Button, Portal } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PaymentIcon from '@mui/icons-material/Payment';
import { useEvent } from '../contexts/EventContext';
import { useBanner } from '../contexts/BannerContext';

const InactiveEventBanner: React.FC = () => {
  const { selectedEvent } = useEvent();
  const { isBannerVisible } = useBanner();
  const navigate = useNavigate();

  const handleDismiss = () => {
    if (selectedEvent) {
      const dismissedKey = `event_inactive_dismissed_${selectedEvent.id}`;
      localStorage.setItem(dismissedKey, 'true');
      // Dispatch custom event to notify BannerContext
      window.dispatchEvent(new Event('banner-dismissed'));
    }
  };

  const handlePaymentClick = () => {
    // "הסדר תשלום" must land on an actual payment surface: resume an open
    // checkout if one exists, otherwise the billing tab.
    const pendingOrderId = localStorage.getItem('pending_order_id');
    if (pendingOrderId) {
      navigate(`/payment?orderId=${encodeURIComponent(pendingOrderId)}`);
    } else {
      navigate('/settings?tab=billing');
    }
  };

  if (!isBannerVisible) {
    return null;
  }

  return (
    <Portal>
      <Box
        sx={{
          width: '100vw',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1300,
          backgroundColor: '#fff',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Alert
          severity="warning"
          sx={{
            borderRadius: 0,
            alignItems: 'center',
            py: 0.75,
            '& .MuiAlert-message': {
              width: '100%',
              py: 0,
            },
            '& .MuiAlert-icon': {
              py: 0,
              alignItems: 'center',
            },
          }}
          action={
            <IconButton
              aria-label="close"
              color="inherit"
              size="small"
              onClick={handleDismiss}
              sx={{ ml: 1, p: 0.5 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          }
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', pr: 4, gap: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.875rem' }}>
              האירוע שלך לא פעיל. יש להסדיר תשלום כדי להמשיך להשתמש בשירות.
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<PaymentIcon />}
              onClick={handlePaymentClick}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                px: 2,
                py: 0.5,
                fontSize: '0.875rem',
                minWidth: 'auto',
              }}
            >
              הסדר תשלום
            </Button>
          </Box>
        </Alert>
      </Box>
    </Portal>
  );
};

export default InactiveEventBanner;

