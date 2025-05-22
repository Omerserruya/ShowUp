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

// Import our custom components
import StatusCard from '../components/StatusCard';
import EventTimeline from '../components/EventTimeline';
import MessageStatistics from '../components/MessageStatistics';
import RSVPTable from '../components/RSVPTable';

interface Guest {
  _id: string;
  eventId: string;
  name: string;
  phone: string;
  group?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'imported' | 'whatsapp';
  note?: string;
  reminderSentAt?: Date;
}

function Overview() {
  // Mock data for the status cards
  const [rsvpStats] = useState({
    approved: 24,
    declined: 8,
    pending: 18
  });

  // Mock data for the RSVP table
  const [guests] = useState<Guest[]>([
    {
      _id: '1',
      eventId: 'event1',
      name: 'ישראל ישראלי',
      phone: '050-1234567',
      group: 'משפחת ישראלי',
      status: 'confirmed',
      source: 'whatsapp',
      note: 'מגיע עם בן/בת זוג'
    },
    {
      _id: '2',
      eventId: 'event1',
      name: 'שרה כהן',
      phone: '052-7654321',
      group: 'משפחת כהן',
      status: 'pending',
      source: 'manual',
      note: ''
    },
    {
      _id: '3',
      eventId: 'event1',
      name: 'דוד לוי',
      phone: '054-9876543',
      status: 'declined',
      source: 'imported',
      note: 'לא יכול להגיע'
    },
    {
      _id: '4',
      eventId: 'event1',
      name: 'רחל אברהם',
      phone: '053-4567890',
      group: 'משפחת אברהם',
      status: 'maybe',
      source: 'whatsapp',
      note: 'תאשר בהמשך'
    }
  ]);

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
            count={rsvpStats.approved}
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
            count={rsvpStats.declined}
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
            count={rsvpStats.pending}
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
              
              <MessageStatistics maxWidth="100%" />
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
                <EventTimeline maxWidth="100%" />
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
        <RSVPTable guests={guests} />
      </Box>
    </Box>
  );
}

export default Overview; 