import * as React from 'react';
import { styled } from '@mui/material/styles';
import MuiDrawer, { drawerClasses } from '@mui/material/Drawer';
import { Box, IconButton, Typography, alpha, useTheme } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import MenuContent from './MenuContent';
import UserCard from './UserCard';
import SelectContent from './SelectContent';
import { useBanner } from '../../contexts/BannerContext';

const drawerWidth = 280;

const Drawer = styled(MuiDrawer)({
  width: drawerWidth,
  flexShrink: 0,
  boxSizing: 'border-box',
  [`& .${drawerClasses.paper}`]: { width: drawerWidth, boxSizing: 'border-box' },
});

interface SideMenuProps { mobileOpen?: boolean; onMobileClose?: () => void; }

export default function SideMenu({ mobileOpen = false, onMobileClose }: SideMenuProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { isBannerVisible } = useBanner();

  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.paper' }}>
      {/* Mobile close */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, justifyContent: 'flex-end', p: 1 }}>
        <IconButton onClick={onMobileClose} sx={{ color: 'text.secondary' }}><CloseRoundedIcon /></IconButton>
      </Box>

      {/* Wordmark */}
      <Box sx={{ px: 3, pt: { xs: 0, md: 3 }, pb: 2.5, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '11px', background: 'linear-gradient(135deg, #6f74e0, #888cee)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: '1.1rem', boxShadow: `0 6px 14px ${alpha('#888cee', 0.4)}` }}>S</Box>
        <Box>
          <Typography sx={{ fontWeight: 900, fontSize: '1.2rem', letterSpacing: '-0.01em', lineHeight: 1, color: 'text.primary' }}>ShowUp</Typography>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>אישורי הגעה, בלי כאב ראש</Typography>
        </Box>
      </Box>

      {/* Scrollable area */}
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-thumb': { borderRadius: 6, backgroundColor: alpha(theme.palette.text.primary, 0.12) } }}>
        <SelectContent />
        <MenuContent onItemClick={onMobileClose} />
      </Box>

      {/* Bottom: user */}
      <Box sx={{ flexShrink: 0, p: 1.5, borderTop: '1px solid', borderColor: isDark ? alpha('#fff', 0.06) : alpha(theme.palette.text.primary, 0.06) }}>
        <UserCard />
      </Box>
    </Box>
  );

  return (
    <>
      <MuiDrawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        anchor="right"
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { boxSizing: 'border-box', width: '100%', maxWidth: '100vw', bgcolor: 'background.paper', borderRight: 'none' } }}
      >
        {content}
      </MuiDrawer>

      <Drawer
        variant="permanent"
        anchor="right"
        sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { bgcolor: 'background.paper', borderRight: '1px solid', borderColor: isDark ? alpha('#fff', 0.06) : alpha(theme.palette.text.primary, 0.06), width: drawerWidth, zIndex: 1200, pt: isBannerVisible ? '48px' : 0 } }}
      >
        {content}
      </Drawer>
    </>
  );
}
