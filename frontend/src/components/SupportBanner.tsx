import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, CircularProgress, Portal, Typography, alpha, useTheme } from '@mui/material';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import LogoutIcon from '@mui/icons-material/Logout';
import { useSupport } from '../contexts/SupportContext';

/**
 * The strip that makes an admin support session impossible to forget.
 *
 * An admin inside a support session sees the owner's dashboard verbatim - that
 * is the whole point - so the ONLY thing standing between "helping a customer"
 * and "thinking these are my own numbers" is this banner. It is fixed, full
 * width, unmissable, not dismissable, and always one click from leaving.
 */
const SupportBanner: React.FC = () => {
  const { session, exitSupport } = useSupport();
  const [leaving, setLeaving] = React.useState(false);
  const navigate = useNavigate();
  const theme = useTheme();

  if (!session) return null;

  const handleExit = async () => {
    setLeaving(true);
    try {
      await exitSupport();
      navigate('/admin/events');
    } finally {
      setLeaving(false);
    }
  };

  const who = session.owner_name ? ` · בעל/ת האירוע: ${session.owner_name}` : '';

  return (
    <Portal>
      <Box
        dir="rtl"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 1400, // above the inactive-event banner and the app rail
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          color: '#fff',
          background: 'linear-gradient(90deg, #4b3fb5 0%, #7a5cf0 100%)',
          borderBottom: `1px solid ${alpha('#000', 0.15)}`,
          boxShadow: theme.shadows[3],
        }}
      >
        <SupportAgentIcon fontSize="small" />
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 14,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          מצב תמיכה · אתם צופים באירוע "{session.event_name || 'ללא שם'}"{who}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          onClick={handleExit}
          disabled={leaving}
          startIcon={leaving ? <CircularProgress size={14} color="inherit" /> : <LogoutIcon fontSize="small" />}
          sx={{
            color: '#fff',
            fontWeight: 700,
            borderRadius: 999,
            px: 2,
            backgroundColor: alpha('#fff', 0.18),
            '&:hover': { backgroundColor: alpha('#fff', 0.3) },
          }}
        >
          יציאה ממצב תמיכה
        </Button>
      </Box>
    </Portal>
  );
};

export default SupportBanner;
