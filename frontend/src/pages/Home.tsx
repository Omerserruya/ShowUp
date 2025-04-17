import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Typography, Box, Grid, Button, CircularProgress } from '@mui/material';
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
          Welcome back, {user?.username || 'User'}!
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          Stay updated with the latest in tech
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          Current account: {account?.name || 'No account selected'}
        </Typography>
      </Box>

      {/* Tech Talk Section */}
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
          Tech Talk
        </Typography>
        <Typography variant="body1" paragraph>
          Join the conversation about the latest technologies, share your insights, and learn from others.
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
          onClick={() => alert('Coming soon!')}
        >
          Create Post
        </Button>
      </Box>

    


    </Box>
  );
};

export default Home; 