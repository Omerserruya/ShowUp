import React from 'react';
import { Typography, Box, Button } from '@mui/material';
import { useUser } from '../contexts/UserContext';
import { useAccount } from '../contexts/AccountContext';
import AddIcon from '@mui/icons-material/Add';

const Home = () => {
  const { user } = useUser();
  const { account } = useAccount();

  return (
    <Box>
      {/* Welcome Section */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          ברוך הבא, {user?.username || 'משתמש'}!
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          חשבון נוכחי: {account?.name || 'לא נבחר חשבון'}
        </Typography>
      </Box>

      {/* Quick Actions Section */}
      <Box 
        sx={{ 
          mb: 4, 
          background: (theme) => `linear-gradient(45deg, ${theme.palette.primary.main} 30%, ${theme.palette.primary.dark} 90%)`,
          color: 'white', 
          p: 3, 
          borderRadius: 2,
          boxShadow: 2,
          maxWidth: 800,
          width: '100%'
        }}
      >
        <Typography variant="h5" gutterBottom>
          פעולות מהירות
        </Typography>
        <Typography variant="body1" paragraph>
          ניהול אירועים, הזמנות אורחים, ושליחת הודעות - הכל במקום אחד.
        </Typography>
        <Button 
          variant="contained" 
          sx={{ 
            bgcolor: 'white',
            color: 'primary.main',
            '&:hover': {
              bgcolor: 'grey.100'
            }
          }}
          startIcon={<AddIcon />}
          onClick={() => window.location.href = '/events/new'}
        >
          צור אירוע חדש
        </Button>
      </Box>
    </Box>
  );
};

export default Home; 