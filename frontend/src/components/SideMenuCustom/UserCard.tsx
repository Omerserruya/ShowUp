import React from 'react';
import { Box } from '@mui/material';
import UserAvatar from '../UserAvatar';
import OptionsMenu from '../OptionsMenu';
import { useUser } from '../../contexts/UserContext';

export default function UserCard() {
  const { user } = useUser();

    return (
    <Box
        sx={{
        display: 'flex',
          alignItems: 'center',
        p: 2
        }}
      >
      <UserAvatar username={user?.username || 'Guest'} />
        <Box sx={{ ml: 'auto' }}>  {/* Box to push OptionsMenu to the right */}
          <OptionsMenu />
        </Box>
    </Box>
  );
}