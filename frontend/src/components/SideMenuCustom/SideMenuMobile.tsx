import PropTypes from 'prop-types';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer, { drawerClasses } from '@mui/material/Drawer';
import Stack from '@mui/material/Stack';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { useUser } from '../../contexts/UserContext';
import MenuContent from './MenuContent';
import UserAvatar from '../UserAvatar';

interface SideMenuMobileProps {
  open: boolean;
  toggleDrawer: (open: boolean) => () => void;
}


function SideMenuMobile({ open, toggleDrawer }: SideMenuMobileProps) {
  const { setUser, user } = useUser();

const handleLogout = async () => {
  try {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include', // Include cookies in the request
    });

    if (response.ok) {
      setUser(null); // Clear user context
      // Optionally, redirect to login or home
      window.location.href = '/'; // Redirect to login page
    } else {
      console.error('Logout failed:', await response.json());
    }
  } catch (error) {
    console.error('Error during logout:', error);
  }
};

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={toggleDrawer(false)}
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        [`& .${drawerClasses.paper}`]: {
          backgroundImage: 'none',
          backgroundColor: 'background.paper',
        },
      }}
    >
      <Stack
        sx={{
          maxWidth: '70dvw',
          height: '100%',
        }}
      >
        <Stack direction="row" sx={{ p: 2, pb: 0, gap: 1 }}>
          <Stack
            direction="row"
            sx={{ gap: 1, alignItems: 'center', flexGrow: 1, p: 1 }}
          >
            <UserAvatar username={user?.username || 'Guest'} />
          </Stack>
        </Stack>
        <Divider />
        <Stack sx={{ flexGrow: 1 }}>
          <MenuContent />
          <Divider />
        </Stack>
        <Stack sx={{ p: 2 }}>
          <Button variant="outlined" onClick={handleLogout} fullWidth startIcon={<LogoutRoundedIcon />}>
            Logout
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}

SideMenuMobile.propTypes = {
  open: PropTypes.bool,
  toggleDrawer: PropTypes.func.isRequired,
};

export default SideMenuMobile;
