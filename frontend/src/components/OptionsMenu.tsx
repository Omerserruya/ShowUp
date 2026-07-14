import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { styled } from '@mui/material/styles';
import Divider, { dividerClasses } from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MuiMenuItem from '@mui/material/MenuItem';
import { paperClasses } from '@mui/material/Paper';
import { listClasses } from '@mui/material/List';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon, { listItemIconClasses } from '@mui/material/ListItemIcon';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import MenuButton from './MenuButton';
import { useUser } from '../contexts/UserContext';

const MenuItem = styled(MuiMenuItem)({
  margin: '2px 0',
});

export default function OptionsMenu() {
  const [anchorEl, setAnchorEl] = React.useState(null);
  const open = Boolean(anchorEl);
  const handleClick = (event: { currentTarget: React.SetStateAction<null>; }) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(null);
  };
  const { setUser, isAdmin } = useUser();
  const navigate = useNavigate();

  const go = (path: string) => {
    handleClose();
    navigate(path);
  };

  const handleLogout = async () => {
    try {
      // Use fetch with proper credentials to ensure cookies are sent
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include', // Important: Include cookies in the request
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Always clear local storage and user context regardless of server response
      localStorage.removeItem('user_id');
      setUser(null);
      
      if (response.ok) {
        window.location.href = '/login';
      } else {
        console.error('Logout failed:', await response.json());
        // Still redirect to login page even if server logout fails
        window.location.href = '/login';
      }
    } catch (error) {
      console.error('Error during logout:', error);
      // Still clear user data and redirect on error
      localStorage.removeItem('user_id');
      setUser(null);
      window.location.href = '/login';
    }
  };
  
  return (
    <React.Fragment>
      <MenuButton
        aria-label="תפריט משתמש"
        onClick={handleClick}
        sx={{ borderColor: 'transparent '}}
      >
        <MoreVertRoundedIcon />
      </MenuButton>
      <Menu
        anchorEl={anchorEl}
        id="menu"
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { direction: 'rtl' } } }}
        sx={{
          [`& .${listClasses.root}`]: {
            padding: '4px',
          },
          [`& .${paperClasses.root}`]: {
            padding: 0,
          },
          [`& .${dividerClasses.root}`]: {
            margin: '4px -4px',
          },
          [`& .${listItemIconClasses.root}`]: {
            minWidth: 0,
            marginInlineEnd: 1,
          },
        }}
      >
        <MenuItem onClick={() => go('/settings?tab=profile')}>
          <ListItemIcon><PersonRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>הפרופיל שלי</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => go('/settings')}>
          <ListItemIcon><SettingsRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>הגדרות</ListItemText>
        </MenuItem>
        {isAdmin && <Divider />}
        {isAdmin && (
          <MenuItem onClick={() => go('/admin/users')}>
            <ListItemIcon><AdminPanelSettingsRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>ניהול מערכת</ListItemText>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={handleLogout}>
          <ListItemIcon><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>התנתקות</ListItemText>
        </MenuItem>
      </Menu>
    </React.Fragment>
  );
}
