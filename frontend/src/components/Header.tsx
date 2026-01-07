import * as React from 'react';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import { Box, Typography, useTheme } from '@mui/material';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({ title, subtitle, onMenuClick }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        display: 'flex',
        position: 'sticky',
        top: 0,
        zIndex: 1100,
        backgroundColor: theme.palette.mode === 'dark' ? 'background.paper' : '#ffffff',
        borderBottom: '1px solid',
        borderColor: 'divider',
        pl: { xs: 1.5, sm: 4 },
        pr: { xs: 1.5, sm: 1 },
        py: 1.5,
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
            ml: 'auto',
            // leave room for hamburger on the right in mobile
            pr: { xs: 6, sm: 6},
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            textAlign: 'right',
            gap: 0.5,
            width: 'fit-content',
            maxWidth: { xs: 'calc(100% - 72px)', sm: '100%' }, // don't go under the burger on mobile
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
                color: 'text.primary',
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
                color: 'text.secondary',
                fontSize: { xs: '0.75rem', sm: '1rem' },
                display: { xs: 'block', sm: 'block' }
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Mobile: Hamburger menu on right */}
        <Box
          sx={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            display: { xs: 'flex', md: 'none' },
            alignItems: 'center',
          }}
        >
          <IconButton
            onClick={onMenuClick}
            sx={{
              color: 'text.primary',
            }}
          >
            <MenuIcon />
          </IconButton>
        </Box>

        {/* Desktop: Color mode toggle on left */}
        <Box
          sx={{
            position: 'absolute',
            left: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
          }}
        >
          <ColorModeIconDropdown />
        </Box>
      </Stack>
    </Box>
  );
};

export default Header;
