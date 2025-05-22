import { useState } from 'react';
import { 
  Box, 
  Typography, 
  Grid,
  Divider,
  Paper
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import QuestionMarkIcon from '@mui/icons-material/QuestionMark';
import {
  Email as EmailIcon,
  MarkEmailRead as MarkEmailReadIcon,
  Campaign as CampaignIcon,
  Favorite as FavoriteIcon,
} from '@mui/icons-material';

// Import our custom components
import StatusCard from '../components/StatusCard';
import EventTimeline from '../components/EventTimeline';
import MessageStatistics from '../components/MessageStatistics';
import RSVPTable from '../components/RSVPTable';

// Import mock data
import { mockGuests, mockRSVPStats } from '../mocks/guestData';
import { mockTimeline, mockMessageStats } from '../mocks/overviewData';

function Overview() {
  return (
    <Box sx={{ p: 4, direction: 'rtl' }}>
      <Typography 
        variant="h4" 
        component="h1" 
        gutterBottom 
        sx={{ 
          fontWeight: 600, 
          color: '#424242',
          mb: 4,
          ml: 1
        }}
      >
        לוח בקרה
      </Typography>
      
      {/* Status Cards */}
      <Grid container spacing={4} sx={{ mb: 4, px: 1 }}>
        {/* Approved Card */}
        <Grid item xs={12} sm={4}>
          <StatusCard
            title="אישרו הגעה"
            description="אנשים שאישרו השתתפות באירוע"
            count={mockRSVPStats.approved}
            color="46, 125, 50" // Green color in RGB
            icon={<CheckCircleOutlineIcon 
              sx={{ 
                color: '#2e7d32', 
                opacity: 0.85
              }} 
            />}
          />
        </Grid>
        
        {/* Declined Card */}
        <Grid item xs={12} sm={4}>
          <StatusCard
            title="ביטלו השתתפות"
            description="אנשים שלא יוכלו להגיע לאירוע"
            count={mockRSVPStats.declined}
            color="198, 40, 40" // Red color in RGB
            icon={<CancelOutlinedIcon 
              sx={{ 
                color: '#c62828', 
                opacity: 0.85
              }} 
            />}
          />
        </Grid>
        
        {/* Pending Card */}
        <Grid item xs={12} sm={4}>
          <StatusCard
            title="טרם הגיבו"
            description="ממתינים לתשובה מהם"
            count={mockRSVPStats.pending}
            color="245, 124, 0" // Amber color in RGB
            icon={<QuestionMarkIcon 
              sx={{ 
                color: '#f57c00', 
                opacity: 0.85
              }} 
            />}
          />
        </Grid>
      </Grid>

      {/* Statistics and Timeline Section - Side by Side */}
      <Box sx={{ mt: 5, mb: 3 }}>
        <Divider sx={{ my: 3 }} />
        
        <Grid container spacing={3}>
          {/* Message Statistics Column */}
          <Grid item xs={12} md={6}>
            <Paper 
              elevation={0} 
              sx={{ 
                p: 2, 
                bgcolor: 'transparent',
                height: '100%'
              }}
            >
              <Typography 
                variant="h6" 
                component="h2" 
                sx={{ 
                  fontWeight: 500, 
                  color: '#424242',
                  mb: 3,
                  ml: 1
                }}
              >
                סטטיסטיקת הודעות
              </Typography>
              
              <MessageStatistics stats={mockMessageStats} maxWidth="100%" />
            </Paper>
          </Grid>
          
          {/* Timeline Column */}
          <Grid item xs={12} md={6}>
            <Paper 
              elevation={0} 
              sx={{ 
                p: 2, 
                bgcolor: 'transparent',
                height: '100%',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <Typography 
                variant="h6" 
                component="h2" 
                sx={{ 
                  fontWeight: 500, 
                  color: '#424242',
                  mb: 3,
                  ml: 1
                }}
              >
                לוח זמנים של האירוע
              </Typography>
              
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <EventTimeline timeline={mockTimeline} maxWidth="100%" />
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Box>

      {/* RSVP Table Section */}
      <Box sx={{ mt: 5 }}>
        <Divider sx={{ my: 3 }} />
        <Typography 
          variant="h6" 
          component="h2" 
          sx={{ 
            fontWeight: 500, 
            color: '#424242',
            mb: 3,
            ml: 1
          }}
        >
          רשימת מוזמנים
        </Typography>
        <RSVPTable guests={mockGuests} />
      </Box>
    </Box>
  );
}

export default Overview; 