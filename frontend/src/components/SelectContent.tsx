import React from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

function SelectContent() {
  const navigate = useNavigate();

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        בחר סוג אירוע
      </Typography>
      
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Paper 
          elevation={3} 
          sx={{ 
            p: 3, 
            flex: 1,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            cursor: 'pointer',
            '&:hover': {
              boxShadow: 6
            }
          }}
          onClick={() => navigate('/events/new?type=wedding')}
        >
          <Typography variant="h6" gutterBottom>
            חתונה
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center">
            ניהול אירועי חתונה
          </Typography>
        </Paper>

        <Paper 
          elevation={3} 
          sx={{ 
            p: 3, 
            flex: 1,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            cursor: 'pointer',
            '&:hover': {
              boxShadow: 6
            }
          }}
          onClick={() => navigate('/events/new?type=birthday')}
        >
          <Typography variant="h6" gutterBottom>
            יום הולדת
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center">
            ניהול אירועי יום הולדת
          </Typography>
        </Paper>

        <Paper 
          elevation={3} 
          sx={{ 
            p: 3, 
            flex: 1,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            cursor: 'pointer',
            '&:hover': {
              boxShadow: 6
            }
          }}
          onClick={() => navigate('/events/new?type=corporate')}
        >
          <Typography variant="h6" gutterBottom>
            אירוע חברה
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center">
            ניהול אירועי חברה
          </Typography>
        </Paper>

        <Paper 
          elevation={3} 
          sx={{ 
            p: 3, 
            flex: 1,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            cursor: 'pointer',
            '&:hover': {
              boxShadow: 6
            }
          }}
          onClick={() => navigate('/events/new?type=custom')}
        >
          <Typography variant="h6" gutterBottom>
            אירוע מותאם
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center">
            אירוע מותאם אישית
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}

export default SelectContent; 