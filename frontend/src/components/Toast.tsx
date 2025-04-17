import React from 'react';
import { Snackbar, Alert, AlertProps } from '@mui/material';

interface ToastProps {
  open: boolean;
  message: string;
  severity: AlertProps['severity'];
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ open, message, severity, onClose }) => {
  return (
    <Snackbar
      open={open}
      autoHideDuration={6000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert
        onClose={onClose}
        severity={severity}
        variant="filled"
        sx={{ width: '100%' }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
};

export default Toast; 