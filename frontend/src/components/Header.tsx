import * as React from 'react';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import { Box, Typography } from '@mui/material';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({ title, subtitle, onMenuClick }) => {
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
            mr: 0, // Stick to right edge
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            textAlign: 'right',
            gap: 0.5,
            width: 'fit-content', // Only take needed width
          }}
        >
          {title && (
            <Typography
              variant="h4"
              component="h1"
              sx={{ 
                textAlign: 'right',
                width: '100%',
                fontWeight: 700, 
                color: '#0f172a',
                fontSize: { xs: '1.25rem', sm: '2.125rem' }
              }}
            >
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography
              variant="subtitle1"
              sx={{ 
                color: '#6b7280',
                fontSize: { xs: '0.75rem', sm: '1rem' },
                display: { xs: 'block', sm: 'block' }
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Mobile: Hamburger menu, Desktop: Color mode toggle */}
        <Box sx={{ position: 'absolute', left: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton
            onClick={onMenuClick}
            sx={{
              display: { xs: 'flex', md: 'none' },
              color: '#0f172a',
            }}
          >
            <MenuIcon />
          </IconButton>
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <ColorModeIconDropdown />
          </Box>
        </Box>
      </Stack>
    </Box>
  );
};

export default Header;
