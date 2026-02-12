import * as React from 'react';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import { Box, Typography, useTheme, alpha } from '@mui/material';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({ title, subtitle, onMenuClick }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 1100,
        bgcolor: isDark
          ? alpha(theme.palette.background.paper, 0.8)
          : alpha('#ffffff', 0.85),
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid',
        borderColor: 'divider',
        pl: { xs: 1.5, sm: 4 },
        pr: { xs: 1.5, sm: 2 },
        py: 1.5,
        minHeight: { xs: 56, sm: 64 },
      }}
    >
      {/* Right side: hamburger (mobile) + title */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        {/* Mobile: Hamburger menu */}
        <IconButton
          onClick={onMenuClick}
          sx={{
            display: { xs: 'flex', md: 'none' },
            color: 'text.primary',
          }}
        >
          <MenuIcon />
        </IconButton>

        {/* Page title & subtitle */}
        <Box sx={{ minWidth: 0 }}>
          {title && (
            <Typography
              variant="h4"
              component="h1"
              noWrap
              sx={{
                fontWeight: 700,
                color: 'text.primary',
                fontSize: { xs: '1.15rem', sm: '1.5rem' },
                lineHeight: 1.3,
              }}
            >
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography
              variant="body2"
              noWrap
              sx={{
                color: 'text.secondary',
                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                mt: 0.25,
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
      </Stack>

      {/* Left side: Color mode toggle (desktop) */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <ColorModeIconDropdown />
      </Box>
    </Box>
  );
};

export default Header;