import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

function AdminSettings() {
  return (
    <Box sx={{ padding: 0 }}>
      <Typography variant="h4" gutterBottom>
        הגדרות מערכת
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
          הגדרות המערכת יופיעו כאן
        </Typography>
      </Paper>
    </Box>
  );
}

export default AdminSettings; 