import * as React from 'react';
import Stack from '@mui/material/Stack';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import { Box, Typography } from '@mui/material';

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  return (
    <Box
      sx={{
        display: 'flex',
        position: 'sticky',
        top: 0,
        zIndex: 1100,
        // Let the page background show through so header blends with page
        backgroundColor: 'white',
        borderBottom: '1px solid',
        borderColor: 'divider',
        pl: { xs: 1, sm: 4 }, // Left padding (right side in RTL)
        pr: { xs: 1, sm: 1 }, // Right padding (left side in RTL) - minimal to stick title to right
        py: 1.5, // make header taller
      }}
    >
      <Stack
        direction="row"
        sx={{
          width: '100%',
          alignItems: 'center',
          position: 'relative',
        }}
        spacing={2}
      >
        {/* Page title & subtitle (center/right in RTL) */}
        <Box
          sx={{
            flexGrow: 0,
            flexShrink: 0,
            ml: 'auto', // push text block to the far right
            mr: { xs: 0, sm: 0 }, // Remove right margin on mobile to stick to edge
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            textAlign: 'right',
            gap: 0.5,
          }}
        >
          {title && (
            <Typography
              variant="h4"
              component="h1"
              sx={{ fontWeight: 700, color: '#0f172a' }}
            >
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography
              variant="subtitle1"
              sx={{ color: '#6b7280' }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Color mode toggle aligned to left */}
        <Box sx={{ position: 'absolute', left: 0 }}>
          <ColorModeIconDropdown />
        </Box>
      </Stack>
    </Box>
  );
};

export default Header;
