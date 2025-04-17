import * as React from 'react';
import Box from '@mui/material/Box';

export default function Logo() {
  return (
    <Box
      component="img"
      src="/logo.png"
      alt="ShowUp Logo"
      sx={{
        height: 30,
        width: 'auto',
        mr: 2,
        objectFit: 'contain',
      }}
    />
  );
} 