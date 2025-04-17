import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

function Visualization() {
  return (
    <Box sx={{ padding: 0 }}>
      <Typography variant="h4" gutterBottom>
        Visualization
      </Typography>
      
      <Paper 
        elevation={3} 
        sx={{ 
          padding: 8, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          minHeight: '300px'
        }}
      >
        <Typography variant="h4" color="primary" gutterBottom>
          Coming Soon!
        </Typography>
        <Typography variant="body1" color="text.secondary" align="center">
          The Visualization feature is currently under development and will be available in a future update.
        </Typography>
      </Paper>
    </Box>
  );
}

export default Visualization; 