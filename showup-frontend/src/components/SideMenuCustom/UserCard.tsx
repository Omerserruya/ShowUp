import Stack from '@mui/material/Stack';
import OptionsMenu from '../OptionsMenu';
import UserAvatar from '../UserAvatar';

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
        <OptionsMenu />
      </Stack>
    )
}