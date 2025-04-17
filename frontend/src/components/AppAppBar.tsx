import * as React from 'react';
import { styled, alpha, Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Drawer from '@mui/material/Drawer';
import MenuIcon from '@mui/icons-material/Menu';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useNavigate } from 'react-router-dom';
import { useColorScheme } from '@mui/material/styles';
import ColorModeIconDropdown from '../components/ColorModeIconDropdown';
import Logo from './Logo';
import Typography from '@mui/material/Typography';

const StyledToolbar = styled(Toolbar)(({ theme }: { theme: Theme & { vars?: any } }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
  borderRadius: `calc(${theme.shape.borderRadius}px + 8px)`,
  backdropFilter: 'blur(24px)',
  border: '1px solid',
  borderColor: (theme.vars || theme).palette.divider,
  backgroundColor: theme.vars
    ? `rgba(${theme.vars.palette.background.defaultChannel} / 0.4)`
    : alpha(theme.palette.background.default, 0.4),
  boxShadow: (theme.vars || theme).shadows[1],
  padding: '8px 12px',
}));

const menuItems = [
  { title: 'תכונות', href: '#features' },
  { title: 'תעריפים', href: '#pricing' },
  { title: 'שאלות נפוצות', href: '#faq' },
];

export default function AppAppBar() {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const { mode, setMode } = useColorScheme();

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

  const handleLoginClick = () => {
    navigate('/login');
  };

  const handleRegisterClick = () => {
    navigate('/register');
  };

  return (
    <AppBar
      position="fixed"
      enableColorOnDark
      sx={{
        boxShadow: 0,
        bgcolor: 'transparent',
        backgroundImage: 'none',
        mt: 'calc(var(--template-frame-height, 0px) + 28px)',
      }}
    >
      <Container maxWidth="lg">
        <StyledToolbar variant="dense" disableGutters>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Logo />
            <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1 }}>
              {menuItems.map((item) => (
                <Button
                  key={item.title}
                  color="primary"
                  variant="text"
                  size="small"
                  component="a"
                  href={item.href}
                >
                  {item.title}
                </Button>
              ))}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button 
              color="primary" 
              variant="outlined" 
              size="small"
              onClick={handleLoginClick}
              sx={{
                borderWidth: 2,
                '&:hover': {
                  borderWidth: 2,
                },
              }}
            >
              התחברות
            </Button>
            <Button 
              color="primary" 
              variant="contained" 
              size="small"
              onClick={handleRegisterClick}
            >
              הרשמה
            </Button>
            <ColorModeIconDropdown size="small" />
          </Box>
          <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 1 }}>
            <ColorModeIconDropdown size="medium" />
            <IconButton aria-label="Menu button" onClick={toggleDrawer(true)}>
              <MenuIcon />
            </IconButton>
            <Drawer
              anchor="top"
              open={open}
              onClose={toggleDrawer(false)}
              PaperProps={{
                sx: {
                  mt: 'calc(var(--template-frame-height, 0px) + 28px)',
                  borderRadius: 0,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                },
              }}
            >
              <Box
                sx={{
                  p: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Logo />
                  <IconButton aria-label="Close menu" onClick={toggleDrawer(false)}>
                    <CloseRoundedIcon />
                  </IconButton>
                </Box>
                <Divider sx={{ my: 1 }} />
                {menuItems.map((item) => (
                  <MenuItem
                    key={item.title}
                    component="a"
                    href={item.href}
                    onClick={toggleDrawer(false)}
                  >
                    {item.title}
                  </MenuItem>
                ))}
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button 
                    color="primary" 
                    variant="outlined" 
                    fullWidth
                    onClick={handleLoginClick}
                    sx={{
                      borderWidth: 2,
                      '&:hover': {
                        borderWidth: 2,
                      },
                    }}
                  >
                    התחברות
                  </Button>
                  <Button 
                    color="primary" 
                    variant="contained" 
                    fullWidth
                    onClick={handleRegisterClick}
                  >
                    הרשמה
                  </Button>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                    מצב תצוגה
                  </Typography>
                  <ColorModeIconDropdown size="small" />
                </Box>
              </Box>
            </Drawer>
          </Box>
        </StyledToolbar>
      </Container>
    </AppBar>
  );
}
