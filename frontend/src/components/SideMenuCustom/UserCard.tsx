import Stack from '@mui/material/Stack';
import OptionsMenu from '../OptionsMenu';
import UserAvatar from '../UserAvatar';
import Box from '@mui/material/Box';

export default function UserCard(){
    return (
        <Stack
        direction="row"
        sx={{
          p: 2,
          gap: 1,
          alignItems: 'center',
        }}
      >
       <UserAvatar />
        <Box sx={{ ml: 'auto' }}>  {/* Box to push OptionsMenu to the right */}
          <OptionsMenu />
        </Box>
      </Stack>
    )
}