import * as React from 'react';
import Box from '@mui/material/Box';

interface LogoProps {
  height?: number | string;
  width?: number | string;
  mr?: number;
}

export default function Logo({ height = 30, width = 'auto', mr = 2 }: LogoProps) {
  return (
    <Box
      component="img"
      src="/logo.png"
      alt="ShowUp Logo"
      sx={{
        height,
        width,
        mr,
        objectFit: 'contain',
      }}
    />
  );
} 