import React, { useEffect } from 'react';
import { Box, Typography, Paper, Grid, Button, CircularProgress, Alert } from '@mui/material';
import { useEvent } from '../contexts/EventContext';
import { useNavigate } from 'react-router-dom';

function Overview() {
  const { events, loading, error, fetchEvents } = useEvent();
  const navigate = useNavigate();

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ padding: 3 }}>
      <Typography variant="h4" gutterBottom>
        סקירה כללית
      </Typography>
      
      <Grid container spacing={3}>
        {events.length === 0 ? (
          <Grid item xs={12}>
            <Paper 
              elevation={3} 
              sx={{ 
                padding: 4, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                minHeight: '300px'
              }}
            >
              <Typography variant="h5" color="text.secondary" gutterBottom>
                אין אירועים כרגע
              </Typography>
              <Button 
                variant="contained" 
                color="primary" 
                onClick={() => navigate('/admin/events')}
                sx={{ mt: 2 }}
              >
                צור אירוע חדש
              </Button>
            </Paper>
          </Grid>
        ) : (
          events.map((event) => (
            <Grid item xs={12} sm={6} md={4} key={event.id}>
              <Paper 
                elevation={3} 
                sx={{ 
                  padding: 3,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <Typography variant="h6" gutterBottom>
                  {event.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {event.description}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  תאריך: {new Date(event.date).toLocaleDateString('he-IL')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  מיקום: {event.location}
                </Typography>
                <Box sx={{ mt: 'auto', pt: 2 }}>
                  <Button 
                    variant="outlined" 
                    color="primary" 
                    fullWidth
                    onClick={() => navigate(`/events/${event.id}`)}
                  >
                    צפה בפרטים
                  </Button>
                </Box>
              </Paper>
            </Grid>
          ))
        )}
      </Grid>
    </Box>
  );
}

export default Overview; 