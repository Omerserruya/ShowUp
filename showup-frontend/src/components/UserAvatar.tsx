import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Stack } from '@mui/material';

export default  function UserAvatar() {
    return (
        <Stack
        direction="row"
        sx={{
          p: 0,
          gap: 1,
          alignItems: 'center',
        }}
      >
        <Avatar
        sizes="small"
        alt="ziley Carter"
        src="/static/images/avatar/7.jpg"
        sx={{ width: 36, height: 36 }}
    />
    <Box sx={{ mr: 'auto' }}>
        <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: '16px' }}>
        Riley Carter
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        riley@email.com
        </Typography>
    </Box>
    </Stack>
    );
}