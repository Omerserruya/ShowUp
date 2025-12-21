import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Grid,
  Divider,
  Paper,
  CircularProgress,
  Alert,
  useTheme
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
import CampaignTimeline, { CampaignTimelineItem } from '../components/CampaignTimeline';
import CampaignUpdates, { CampaignUpdate } from '../components/CampaignUpdates';

// Import hooks
import { useOverviewStats, useDailyResponses, useCampaigns, useGuests } from '../hooks/useOverviewData';
import { useEvent } from '../contexts/EventContext';

// Helper function to map API guest to component format
function mapGuestFromAPI(apiGuest: any): any {
  // Map status from API format to component format
  const statusMap: Record<string, 'pending' | 'confirmed' | 'declined' | 'maybe'> = {
    'invited': 'pending',
    'pending': 'pending',
    'attending': 'confirmed',
    'confirmed': 'confirmed',
    'declined': 'declined',
    'maybe': 'maybe'
  };

  return {
    _id: apiGuest.id,
    eventId: apiGuest.event_id,
    name: apiGuest.name,
    phone: apiGuest.phone,
    email: apiGuest.email,
    group: apiGuest.group,
    status: statusMap[apiGuest.status] || 'pending',
    source: 'manual' as const, // Default, could be enhanced with actual source tracking
    note: apiGuest.notes,
    confirmedCount: apiGuest.guest_count || (apiGuest.status === 'confirmed' || apiGuest.status === 'attending' ? 1 : undefined),
    lastResponse: apiGuest.last_response ? new Date(apiGuest.last_response) : undefined, // Keep as Date for sorting
  };
}

// Helper function to map campaigns to timeline items
function mapCampaignsToTimeline(campaigns: any[]): CampaignTimelineItem[] {
  const now = new Date();
  
  return campaigns
    .filter(c => c.schedule_time) // Only include campaigns with schedule_time
    .map(c => {
      const scheduleDate = new Date(c.schedule_time);
      const isPast = scheduleDate <= now;
      const daysDiff = Math.floor(Math.abs((scheduleDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      
      let dateLabel = '';
      if (isPast) {
        dateLabel = daysDiff === 0 ? 'היום' : `לפני ${daysDiff} ימים`;
      } else {
        dateLabel = daysDiff === 0 ? 'היום' : `בעוד ${daysDiff} ימים`;
      }
      
      // A campaign is completed only if it's sent AND the schedule_time has passed
      const status: 'completed' | 'upcoming' = (c.status === 'sent' && isPast) ? 'completed' : 'upcoming';
      
      return {
        id: c.id,
        dateLabel,
        title: c.name,
        status
      };
    })
    .sort((a, b) => {
      // Sort by status (completed first) then by date
      if (a.status !== b.status) {
        return a.status === 'completed' ? -1 : 1;
      }
      return 0;
    });
}

// Helper function to map campaigns to updates
function mapCampaignsToUpdates(campaigns: any[]): CampaignUpdate[] {
  const now = new Date();
  
  return campaigns
    .filter(c => c.schedule_time) // Only show campaigns with schedule_time
    .slice(0, 3) // Take latest 3
    .map(c => {
      const scheduleDate = new Date(c.schedule_time);
      const isPast = scheduleDate <= now;
      const daysDiff = Math.floor(Math.abs((scheduleDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      
      let timeAgo = '';
      let sentLabel = '';
      let description = '';
      
      if (isPast) {
        // Campaign already happened
        if (c.status === 'sent') {
          sentLabel = 'נשלח';
          description = `${c.name} נשלחה דרך ${c.channel === 'whatsapp' ? 'WhatsApp' : c.channel}`;
          timeAgo = daysDiff === 0 ? 'היום' : `לפני ${daysDiff} ימים`;
        } else {
          // Was scheduled but not sent yet
          sentLabel = 'לא נשלח';
          description = `${c.name} תוכננה להישלח דרך ${c.channel === 'whatsapp' ? 'WhatsApp' : c.channel}`;
          timeAgo = daysDiff === 0 ? 'היום' : `לפני ${daysDiff} ימים`;
        }
      } else {
        // Campaign is in the future
        sentLabel = 'תשלח';
        description = `${c.name} תישלח דרך ${c.channel === 'whatsapp' ? 'WhatsApp' : c.channel}`;
        timeAgo = daysDiff === 0 ? 'היום' : `בעוד ${daysDiff} ימים`;
      }
      
      // Determine type based on campaign name
      let type: 'primary' | 'reminder' | 'info' = 'primary';
      if (c.name.includes('תזכורת')) {
        type = 'reminder';
      } else if (c.name.includes('עדכון') || c.name.includes('מיקום')) {
        type = 'info';
      }
      
      return {
        id: c.id,
        title: c.name,
        description,
        sentLabel,
        readLabel: isPast && c.status === 'sent' ? 'נקרא' : undefined,
        sentCount: 0, // TODO: Get from campaign stats when available
        readCount: isPast && c.status === 'sent' ? 0 : undefined, // TODO: Get from campaign stats when available
        repliedCount: isPast && c.status === 'sent' ? 0 : undefined, // TODO: Get from campaign stats when available
        timeAgo,
        type
      };
    });
}

function Overview() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { selectedEvent } = useEvent();
  const [dailyPeriod, setDailyPeriod] = useState<'week' | 'month'>('week');
  const { stats, loading: statsLoading, error: statsError } = useOverviewStats();
  const { data: dailyData, loading: dailyLoading } = useDailyResponses(dailyPeriod);
  const { campaigns, loading: campaignsLoading } = useCampaigns();
  const { guests, loading: guestsLoading } = useGuests(1, 10, '');

  // Show loading state if no event selected
  if (!selectedEvent) {
    return (
      <Box sx={{ p: 4, direction: 'rtl', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Typography variant="h6" color="text.secondary">
          אנא בחר אירוע כדי לראות את הסקירה הכללית
        </Typography>
      </Box>
    );
  }

  // Show loading state
  if (statsLoading || dailyLoading || campaignsLoading || guestsLoading) {
    return (
      <Box sx={{ p: 4, direction: 'rtl', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Map data
  const mappedGuests = guests.map(mapGuestFromAPI);
  const timelineItems = mapCampaignsToTimeline(campaigns);
  const campaignUpdates = mapCampaignsToUpdates(campaigns);

  // Prepare pie chart data
  const pieData = stats ? [
    { name: 'אישרו הגעה', value: stats.approved, color: '#4ade80' },
    { name: 'ביטלו השתתפות', value: stats.declined, color: '#f87171' },
    { name: 'טרם אישרו', value: stats.pending, color: '#fb923c' },
  ] : [];

  return (
    <Box sx={{ p: { xs: 1, sm: 4 }, direction: 'rtl' }}>
      {statsError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {statsError}
        </Alert>
      )}

      {/* Status Cards */}
      <Grid container spacing={{ xs: 1, sm: 1.5 }} sx={{ mb: 4 }}>
        {/* Approved Card */}
        <Grid item xs={6} sm={6} md={3}>
          <StatusCard
            title="אישרו הגעה"
            description="אנשים שאישרו השתתפות באירוע"
            count={stats?.approved || 0}
            color="linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
            icon={<CheckCircleOutlineIcon sx={{ color: '#ffffff' }} />}
            onClick={() => navigate('/guests?filter=confirmed')}
          />
        </Grid>
        
        {/* Declined Card */}
        <Grid item xs={6} sm={6} md={3}>
          <StatusCard
            title="ביטלו השתתפות"
            description="אנשים שלא יוכלו להגיע לאירוע"
            count={stats?.declined || 0}
            color="linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
            icon={<CancelOutlinedIcon sx={{ color: '#ffffff' }} />}
            onClick={() => navigate('/guests?filter=declined')}
          />
        </Grid>
        
        {/* Pending Card */}
        <Grid item xs={6} sm={6} md={3}>
          <StatusCard
            title="טרם הגיבו"
            description="ממתינים לתשובה מהם"
            count={stats?.pending || 0}
            color="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
            icon={<QuestionMarkIcon sx={{ color: '#ffffff' }} />}
            onClick={() => navigate('/guests?filter=pending')}
          />
        </Grid>
        
        {/* Total Invited Guests Card */}
        <Grid item xs={6} sm={6} md={3}>
          <StatusCard
            title="סה״כ מוזמנים"
            description="מספר המוזמנים הכולל לאירוע"
            count={stats?.total || 0}
            color="linear-gradient(135deg, #a855f7 0%, #9333ea 100%)"
            icon={<PeopleIcon sx={{ color: '#ffffff' }} />}
            onClick={() => navigate('/guests?filter=all')}
          />
        </Grid>
      </Grid>

      {/* Daily Response Charts Section */}
      <Grid container spacing={3} sx={{ mb: 4, display: { xs: 'none', md: 'flex' } }}>
        {/* Daily Response Bar Chart - 2/3 width */}
        <Grid item xs={12} md={8}>
          <DailyResponseChart 
            data={dailyData?.data || []} 
            milestones={dailyData?.milestones || []}
            period={dailyPeriod}
            onChangePeriod={setDailyPeriod}
          />
        </Grid>
        
        {/* Response Pie Chart - 1/3 width */}
        <Grid item xs={12} md={4}>
          <ResponsePieChart data={pieData} />
        </Grid>
      </Grid>

      {/* Campaign timeline & updates (1/3 right, 2/3 left) */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Right column: campaign timeline (1/3) */}
        <Grid item xs={12} md={4}>
          <CampaignTimeline items={timelineItems} />
        </Grid>

        {/* Left column: campaign updates (2/3) */}
        <Grid item xs={12} md={8}>
          <CampaignUpdates items={campaignUpdates} />
        </Grid>
      </Grid>

      {/* RSVP Table Section */}
      <Paper 
        elevation={0}
        sx={{
          borderRadius: { xs: 0, sm: 2 },
          backgroundColor: 'white',
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'divider',
          borderWidth: '1px',
          overflow: 'hidden',
          p: { xs: 1, sm: 2, md: 3 },
          px: { xs: 2, sm: 2, md: 3 }, // Horizontal padding
          mx: { xs: -1, sm: 0 }, // Negative margin on mobile to extend to edges
          width: { xs: 'calc(100% + 16px)', sm: '100%' } // Extend width on mobile
        }}
      >
        <Typography 
          variant="h5" 
          component="h2" 
          sx={{ 
            fontWeight: 600, 
            color: 'text.primary',
            mb: 1,
            ml: { xs: 0, sm: 1 }
          }}
        >
          רשימת אורחים
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            color: 'text.secondary',
            mb: 3,
            ml: { xs: 0, sm: 1 }
          }}
        >
          אורחים אחרונים שענו
        </Typography>
        <RSVPTable guests={mappedGuests} loading={guestsLoading} />
      </Paper>
    </Box>
  );
}

export default Overview; 