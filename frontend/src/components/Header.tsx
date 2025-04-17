import * as React from 'react';
import Stack from '@mui/material/Stack';
import NavbarBreadcrumbs from './NavbarBreadcrumbs';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import Search from './Search';
import { Box } from '@mui/material';

export default function Header() {
  return (
    <Box
      sx={{
        display: 'flex',
        position: 'sticky',
        top: 0,
        zIndex: 1100,
        backgroundColor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        px: 3,
        py: 0.75
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

        <Box sx={{ 
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <Search />
        </Box>
        <Box sx={{ position: 'absolute', left: 0 }}>
          <ColorModeIconDropdown />
        </Box>
      </Stack>
    </Box>
  );
}
