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
import PeopleIcon from '@mui/icons-material/People';
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
import DailyResponseChart from '../components/DailyResponseChart';
import ResponsePieChart from '../components/ResponsePieChart';
import CampaignTimeline from '../components/CampaignTimeline';
import CampaignUpdates from '../components/CampaignUpdates';

// Import mock data
import { mockGuests, mockRSVPStats } from '../mocks/guestData';
import { mockTimeline, mockMessageStats } from '../mocks/overviewData';

function Overview() {
  return (
    <Box sx={{ p: 4, direction: 'rtl' }}>
      {/* Status Cards */}
      <Grid container spacing={4} sx={{ mb: 4 }}>
        {/* Approved Card */}
        <Grid item xs={12} sm={6} md={3}>
          <StatusCard
            title="אישרו הגעה"
            description="אנשים שאישרו השתתפות באירוע"
            count={mockRSVPStats.approved}
            color="linear-gradient(135deg, #22c55e 0%, #16a34a 100%)" // Green gradient - can use hex, rgb, rgba, gradients, or named colors
            icon={<CheckCircleOutlineIcon 
              sx={{ 
                color: '#ffffff'
              }} 
            />}
          />
        </Grid>
        
        {/* Declined Card */}
        <Grid item xs={12} sm={6} md={3}>
          <StatusCard
            title="ביטלו השתתפות"
            description="אנשים שלא יוכלו להגיע לאירוע"
            count={mockRSVPStats.declined}
            color="linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" // Red gradient
            icon={<CancelOutlinedIcon 
              sx={{ 
                color: '#ffffff'
              }} 
            />}
          />
        </Grid>
        
        {/* Pending Card */}
        <Grid item xs={12} sm={6} md={3}>
          <StatusCard
            title="טרם הגיבו"
            description="ממתינים לתשובה מהם"
            count={mockRSVPStats.pending}
            color="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" // Amber/Orange gradient
            icon={<QuestionMarkIcon 
              sx={{ 
                color: '#ffffff'
              }} 
            />}
          />
        </Grid>
        
        {/* Total Invited Guests Card */}
        <Grid item xs={12} sm={6} md={3}>
          <StatusCard
            title="סה״כ מוזמנים"
            description="מספר המוזמנים הכולל לאירוע"
            count={mockRSVPStats.approved + mockRSVPStats.declined + mockRSVPStats.pending}
            color="linear-gradient(135deg, #a855f7 0%, #9333ea 100%)" // Purple gradient
            icon={<PeopleIcon 
              sx={{ 
                color: '#ffffff'
              }} 
            />}
          />
        </Grid>
      </Grid>

      {/* Daily Response Charts Section */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Daily Response Line Chart - 2/3 width */}
        <Grid item xs={12} md={8}>
          <DailyResponseChart />
        </Grid>
        
        {/* Response Pie Chart - 1/3 width */}
        <Grid item xs={12} md={4}>
          <ResponsePieChart />
        </Grid>
      </Grid>

  

      {/* Campaign timeline & updates (1/3 right, 2/3 left) */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Right column: campaign timeline (1/3) */}
        <Grid item xs={12} md={4}>
          <CampaignTimeline />
        </Grid>

        {/* Left column: campaign updates (2/3) */}
        <Grid item xs={12} md={8}>
          <CampaignUpdates />
        </Grid>
      </Grid>

      {/* RSVP Table Section */}
      <Paper 
        elevation={0}
        sx={{
          p: 3,
          bgcolor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e5e7eb',
        }}
      >
        <Typography 
          variant="h5" 
          component="h2" 
          sx={{ 
            fontWeight: 600, 
            color: '#424242',
            mb: 1,
            ml: 1
          }}
        >
          רשימת אורחים
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            color: 'text.secondary',
            mb: 3,
            ml: 1
          }}
        >
          אורחים אחרונים שענו
        </Typography>
        <RSVPTable guests={mockGuests} />
      </Paper>
    </Box>
  );
}

export default Overview; 