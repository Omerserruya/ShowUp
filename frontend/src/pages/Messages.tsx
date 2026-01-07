import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Stack,
  IconButton,
  Alert,
  useTheme,
  useMediaQuery,
  alpha,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Skeleton,
  LinearProgress,
  Grid,
} from '@mui/material';
import {
  Send as SendIcon,
  Edit as EditIcon,
  Pause as PauseIcon,
  PlayArrow as PlayArrowIcon,
  AccessTime as AccessTimeIcon,
  WhatsApp as WhatsAppIcon,
  FilterList as FilterListIcon,
  CalendarToday as CalendarIcon,
  People as PeopleIcon,
  BarChart as BarChartIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ClockIcon,
  AutoAwesome as SparklesIcon,
  Add as PlusIcon,
  ChevronRight as ChevronRightIcon,
  Create as PencilIcon,
} from '@mui/icons-material';
import { useEvent } from '../contexts/EventContext';
import { useCampaigns, useOverviewStats } from '../hooks/useOverviewData';
import { fetchWithAuth } from '../utils/fetchWithAuth';

// Helper function to process template with variables
const processTemplateText = (template: string, variables: Record<string, string>): string => {
  let processed = template;
  
  // Replace all placeholders - support multiple formats
  Object.entries(variables).forEach(([key, value]) => {
    // Support {{key}}, {{key.key}}, and {{key_key}} formats
    const patterns = [
      `{{${key}}}`,
      `{{${key.replace('_', '.')}}}`,
      `{{${key.replace('.', '_')}}}`,
    ];
    
    patterns.forEach(pattern => {
      // Escape special regex characters in pattern
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      processed = processed.replace(new RegExp(escapedPattern, 'g'), value || pattern);
    });
  });
  
  // Also handle common placeholders that might be in the template
  const commonReplacements: Record<string, string> = {
    '{{guest.name}}': variables['guest.name'] || variables['שם'] || 'דוד כהן',
    '{{event.name}}': variables['event.name'] || variables['שם_אירוע'] || 'האירוע שלי',
    '{{event.date}}': variables['event.date'] || variables['תאריך'] || '15/06/2024',
    '{{event.location}}': variables['event.location'] || variables['מיקום'] || 'גן אירועים רויאל',
  };
  
  Object.entries(commonReplacements).forEach(([placeholder, value]) => {
    processed = processed.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
  });
  
  return processed;
};

// Campaign status types from API
type CampaignStatus = 'sent' | 'pending' | 'paused' | 'scheduled';

interface CampaignFromAPI {
  id: string;
  name: string;
  template: string;
  status: string;
  schedule_time: string | null;
  channel: string;
  created_at: string;
  updated_at: string;
}

interface Campaign {
  id: string;
  name: string;
  template: string;
  status: CampaignStatus;
  scheduleTime: Date | null;
  channel: 'whatsapp' | 'sms' | 'email';
  recipientCount: number; // Will be fetched from guests count
}

function Messages() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { selectedEvent } = useEvent();
  const { campaigns: apiCampaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const { stats } = useOverviewStats();
  
  // State
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [recipientCount, setRecipientCount] = useState<number>(0);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editType, setEditType] = useState<'time' | 'message' | null>(null);
  const [sendNowDialogOpen, setSendNowDialogOpen] = useState(false);
  const [sendNowCampaign, setSendNowCampaign] = useState<Campaign | null>(null);
  const [editedTime, setEditedTime] = useState<string>('');
  const [editedMessage, setEditedMessage] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  // Fetch recipient count (total guests)
  useEffect(() => {
    if (!selectedEvent?.id) return;

    fetchWithAuth(`/api/guests?event_id=${selectedEvent.id}&page_size=1`)
      .then(res => res.json())
      .then(data => {
        // Get total from API if available, otherwise use array length
        const total = Array.isArray(data) ? data.length : 0;
        // For now, we'll use a reasonable default or fetch all guests count
        fetchWithAuth(`/api/guests?event_id=${selectedEvent.id}&page_size=1000`)
          .then(res => res.json())
          .then(allGuests => {
            setRecipientCount(Array.isArray(allGuests) ? allGuests.length : 0);
          })
          .catch(() => setRecipientCount(150)); // Fallback
      })
      .catch(() => setRecipientCount(150)); // Fallback
  }, [selectedEvent?.id]);

  // Map API campaigns to local format
  useEffect(() => {
    if (!apiCampaigns || apiCampaigns.length === 0) {
      setCampaigns([]);
      return;
    }

    const mapped = apiCampaigns.map((apiCampaign: CampaignFromAPI) => {
      // Map status from API to local status
      let status: CampaignStatus = 'pending';
      if (apiCampaign.status === 'sent') {
        status = 'sent';
      } else if (apiCampaign.status === 'paused') {
        status = 'paused';
      } else if (apiCampaign.schedule_time) {
        status = 'scheduled';
      }

      return {
        id: apiCampaign.id,
        name: apiCampaign.name,
        template: apiCampaign.template,
        status,
        scheduleTime: apiCampaign.schedule_time ? new Date(apiCampaign.schedule_time) : null,
        channel: apiCampaign.channel as 'whatsapp' | 'sms' | 'email',
        recipientCount,
      };
    });

    setCampaigns(mapped);
  }, [apiCampaigns, recipientCount]);

  // Helper functions
  const getTimeLabel = (campaign: Campaign): string => {
    if (!campaign.scheduleTime) return 'לא מתוזמן';
    
    const now = new Date();
    const scheduleDate = new Date(campaign.scheduleTime);
    const diffMs = scheduleDate.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (campaign.status === 'sent') {
      const sentDiffMs = now.getTime() - scheduleDate.getTime();
      const sentDiffDays = Math.floor(sentDiffMs / (1000 * 60 * 60 * 24));
      if (sentDiffDays < 0) return 'היום';
      return sentDiffDays === 0 ? 'היום' : `לפני ${sentDiffDays} ימים`;
    }
    
    if (campaign.status === 'paused') {
      return `הייתה אמורה להישלח ב-${scheduleDate.toLocaleDateString('he-IL')}`;
    }
    
    if (diffDays < 0) return 'עבר הזמן';
    if (diffDays === 0) return 'היום';
    return `בעוד ${diffDays} ימים`;
  };

  const getStatusLabel = (campaign: Campaign): string => {
    switch (campaign.status) {
      case 'sent':
        return 'נשלחה';
      case 'scheduled':
        return 'מתוזמנת';
      case 'paused':
        return 'מושהית';
      case 'pending':
        return 'ממתינה';
      default:
        return 'לא ידוע';
    }
  };

  const getStatusColor = (campaign: Campaign): { bg: string; color: string } => {
    switch (campaign.status) {
      case 'sent':
        return { bg: alpha('#22c55e', 0.1), color: '#16a34a' };
      case 'scheduled':
        return { bg: alpha('#3b82f6', 0.1), color: '#2563eb' };
      case 'paused':
        return { bg: alpha('#f59e0b', 0.1), color: '#d97706' };
      case 'pending':
        return { bg: alpha('#6b7280', 0.1), color: '#4b5563' };
      default:
        return { bg: '#f3f4f6', color: '#6b7280' };
    }
  };

  const isPast = (campaign: Campaign): boolean => {
    if (!campaign.scheduleTime) return false;
    return new Date(campaign.scheduleTime) < new Date() && campaign.status === 'sent';
  };

  const isNext = (campaign: Campaign, allCampaigns: Campaign[]): boolean => {
    if (campaign.status !== 'scheduled') return false;
    const scheduled = allCampaigns
      .filter(c => c.status === 'scheduled' && c.scheduleTime)
      .sort((a, b) => new Date(a.scheduleTime!).getTime() - new Date(b.scheduleTime!).getTime());
    return scheduled.length > 0 && scheduled[0].id === campaign.id;
  };

  // Get template variables from event
  const getTemplateVariables = (): Record<string, string> => {
    if (!selectedEvent) {
      return {
        'guest.name': 'דוד כהן',
        'event.name': 'האירוע שלי',
        'event.date': '15/06/2024',
        'event.location': 'גן אירועים רויאל',
        'name': 'דוד כהן',
        'eventName': 'האירוע שלי',
        'eventDate': '15/06/2024',
        'location': 'גן אירועים רויאל',
        'שם': 'דוד כהן',
        'שם_אירוע': 'האירוע שלי',
        'תאריך': '15/06/2024',
        'מיקום': 'גן אירועים רויאל',
      };
    }

    const eventDate = selectedEvent.date 
      ? new Date(selectedEvent.date).toLocaleDateString('he-IL', { 
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric' 
        })
      : '{{תאריך}}';

    const eventTypeMap: Record<string, string> = {
      'wedding': 'חתונה',
      'birthday': 'יום הולדת',
      'corporate': 'אירוע חברה',
      'custom': 'אירוע',
    };

    return {
      // English format with dots
      'guest.name': 'דוד כהן',
      'event.name': selectedEvent.name || '{{שם_אירוע}}',
      'event.date': eventDate,
      'event.location': selectedEvent.location || '{{מיקום}}',
      // English format without dots
      'name': 'דוד כהן',
      'eventName': selectedEvent.name || '{{שם_אירוע}}',
      'eventDate': eventDate,
      'location': selectedEvent.location || '{{מיקום}}',
      // Hebrew format
      'שם': 'דוד כהן',
      'שם_אירוע': selectedEvent.name || '{{שם_אירוע}}',
      'תאריך': eventDate,
      'מיקום': selectedEvent.location || '{{מיקום}}',
      'סוג_אירוע': eventTypeMap[selectedEvent.type || 'custom'] || 'אירוע',
    };
  };

  // Filter campaigns
  const filteredCampaigns = campaigns.filter(campaign => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'sent') return campaign.status === 'sent';
    if (filterStatus === 'scheduled') return campaign.status === 'scheduled';
    if (filterStatus === 'paused') return campaign.status === 'paused';
    return true;
  });

  // Handlers
  const handleEditTime = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setEditType('time');
    setEditedTime(campaign.scheduleTime ? new Date(campaign.scheduleTime).toISOString().slice(0, 16) : '');
    setEditDialogOpen(true);
  };

  const handleEditMessage = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setEditType('message');
    setEditedMessage(campaign.template);
    setEditDialogOpen(true);
  };

  const handlePause = async (campaign: Campaign) => {
    setUpdating(campaign.id);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${campaign.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'paused' }),
      });
      if (!response.ok) throw new Error('Failed to pause campaign');
      const updated = await response.json();
      setCampaigns(prev => prev.map(c => 
        c.id === campaign.id ? { ...c, status: 'paused' as CampaignStatus } : c
      ));
    } catch (error) {
      console.error('Error pausing campaign:', error);
      alert('שגיאה בהשהיית הקמפיין');
    } finally {
      setUpdating(null);
    }
  };

  const handleResume = async (campaign: Campaign) => {
    setUpdating(campaign.id);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${campaign.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'pending' }),
      });
      if (!response.ok) throw new Error('Failed to resume campaign');
      setCampaigns(prev => prev.map(c => 
        c.id === campaign.id ? { ...c, status: 'scheduled' as CampaignStatus } : c
      ));
    } catch (error) {
      console.error('Error resuming campaign:', error);
      alert('שגיאה בחידוש הקמפיין');
    } finally {
      setUpdating(null);
    }
  };

  const handleSendNow = (campaign: Campaign) => {
    setSendNowCampaign(campaign);
    setSendNowDialogOpen(true);
  };

  const confirmSendNow = async () => {
    if (!sendNowCampaign) return;
    
    setUpdating(sendNowCampaign.id);
    try {
      // TODO: Implement actual send now API call
      // For now, we'll update the status to sent
      const response = await fetchWithAuth(`/api/campaigns/${sendNowCampaign.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'sent' }),
      });
      if (!response.ok) throw new Error('Failed to send campaign');
      
      setCampaigns(prev => prev.map(c => 
        c.id === sendNowCampaign.id 
          ? { ...c, status: 'sent' as CampaignStatus }
          : c
      ));
      
      setSendNowDialogOpen(false);
      setSendNowCampaign(null);
    } catch (error) {
      console.error('Error sending campaign:', error);
      alert('שגיאה בשליחת הקמפיין');
    } finally {
      setUpdating(null);
    }
  };

  const saveEdit = async () => {
    if (!editingCampaign || !editType) return;

    setSaving(true);
    try {
      const updateData: any = {};
      
      if (editType === 'time') {
        updateData.schedule_time = editedTime ? new Date(editedTime).toISOString() : null;
      } else if (editType === 'message') {
        updateData.template = editedMessage;
      }

      const response = await fetchWithAuth(`/api/campaigns/${editingCampaign.id}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      if (!response.ok) throw new Error('Failed to update campaign');
      
      const updated = await response.json();
      
      setCampaigns(prev => prev.map(c => 
        c.id === editingCampaign.id 
          ? {
              ...c,
              scheduleTime: editType === 'time' && editedTime ? new Date(editedTime) : c.scheduleTime,
              template: editType === 'message' ? editedMessage : c.template,
              status: updated.schedule_time ? 'scheduled' as CampaignStatus : c.status,
            }
          : c
      ));

      setEditDialogOpen(false);
      setEditingCampaign(null);
      setEditType(null);
    } catch (error) {
      console.error('Error updating campaign:', error);
      alert('שגיאה בעדכון הקמפיין');
    } finally {
      setSaving(false);
    }
  };

  // Group campaigns
  const pastCampaigns = filteredCampaigns.filter(c => isPast(c));
  const upcomingCampaigns = filteredCampaigns.filter(c => !isPast(c));
  
  // Calculate statistics
  const totalCampaigns = campaigns.length;
  const sentCampaigns = campaigns.filter(c => c.status === 'sent').length;
  const totalSent = sentCampaigns * recipientCount; // Total messages sent
  const responseRate = stats && stats.total > 0 
    ? Math.round(((stats.approved + stats.declined) / stats.total) * 100)
    : 0;
  
  // Calculate response percentage for each campaign (mock for now)
  const getCampaignResponseRate = (campaign: Campaign): number => {
    if (campaign.status === 'sent') {
      // For sent campaigns, use overall response rate or calculate based on recipients
      return responseRate;
    }
    return 0;
  };

  if (campaignsLoading) {
    return (
      <Box sx={{ p: { xs: 2, sm: 4 }, direction: 'rtl' }}>
        <Skeleton variant="text" width="40%" height={60} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2, borderRadius: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2, borderRadius: 2 }} />
      </Box>
    );
  }

  if (campaignsError) {
    return (
      <Box sx={{ p: { xs: 2, sm: 4 }, direction: 'rtl' }}>
        <Alert severity="error">{campaignsError}</Alert>
      </Box>
    );
  }

  return (
    <Box 
      sx={{ 
        maxWidth: '64rem',
        mx: 'auto',
        px: { xs: 2, sm: 4 },
        py: { xs: 3, sm: 6 },
        pb: { xs: 24, sm: 6 },
        direction: 'rtl',
      }}
    >
      {/* Header Card with Description */}
      <Paper
        elevation={0}
        sx={{
          background: 'linear-gradient(to bottom right, rgba(147, 51, 234, 0.1), rgba(236, 72, 153, 0.1))',
          border: '1px solid',
          borderColor: alpha('#9333ea', 0.2),
          borderRadius: 3,
          p: 3,
          mb: 3,
        }}
      >
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Box
            sx={{
              bgcolor: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(10px)',
              borderRadius: '50%',
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SendIcon sx={{ fontSize: 24, color: '#9333ea' }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', mb: 1 }}>
              עמוד קמפיינים
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
              עמוד הקמפיינים מאפשר לך לנהל את סבבי ההודעות שנשלחים לאורחים לאורך חיי האירוע – מההזמנה הראשונית ועד לתזכורות ועדכונים חשובים.
      </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Statistics Cards */}
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        <Grid item xs={4}>
          <Paper
            elevation={0}
            sx={{
              bgcolor: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(10px)',
              border: '1px solid',
              borderColor: alpha('#9333ea', 0.2),
              borderRadius: 3,
              p: 2,
              textAlign: 'center',
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#9333ea', mb: 0.5 }}>
              {totalCampaigns}
      </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              קמפיינים
                </Typography>
          </Paper>
        </Grid>
        <Grid item xs={4}>
          <Paper
            elevation={0}
            sx={{
              bgcolor: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(10px)',
              border: '1px solid',
              borderColor: alpha('#3b82f6', 0.2),
              borderRadius: 3,
              p: 2,
              textAlign: 'center',
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#3b82f6', mb: 0.5 }}>
              {totalSent}
                </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              נשלחו
                </Typography>
          </Paper>
        </Grid>
        <Grid item xs={4}>
          <Paper
            elevation={0}
            sx={{
              bgcolor: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(10px)',
              border: '1px solid',
              borderColor: alpha('#22c55e', 0.2),
              borderRadius: 3,
              p: 2,
              textAlign: 'center',
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#22c55e', mb: 0.5 }}>
              {responseRate}%
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              אחוז מענה
            </Typography>
          </Paper>
          </Grid>
      </Grid>

      {/* Create Campaign Button */}
          <Button
        fullWidth
        variant="contained"
        startIcon={<PlusIcon />}
        sx={{
          background: 'linear-gradient(to right, #9333ea, #ec4899)',
          color: 'white',
          height: 56,
          fontSize: '1rem',
          fontWeight: 500,
          borderRadius: 3,
          boxShadow: '0 10px 30px rgba(147, 51, 234, 0.2)',
          mb: 3,
          '&:hover': {
            background: 'linear-gradient(to right, #7e22ce, #db2777)',
            boxShadow: '0 10px 30px rgba(147, 51, 234, 0.3)',
          },
          '& .MuiButton-startIcon': {
            marginRight: 0,
            marginLeft: 0.5,
          },
        }}
      >
        יצירת קמפיין חדש
          </Button>

      {/* My Campaigns Section */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 2, px: 0.5 }}>
          הקמפיינים שלי
      </Typography>

        <Stack spacing={2}>
          {/* Past Campaigns (Sent) */}
          {pastCampaigns.map((campaign) => {
            const statusColors = getStatusColor(campaign);
            const responseRate = getCampaignResponseRate(campaign);
            return (
              <Paper
                key={campaign.id}
                elevation={0}
                sx={{
                  p: 2.5,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: alpha('#9333ea', 0.2),
                  borderRadius: 3,
                  transition: 'all 0.3s',
                  '&:hover': {
                    boxShadow: '0 10px 30px rgba(147, 51, 234, 0.15)',
                  },
                }}
              >
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Box
                    sx={{
                      borderRadius: 2,
                      p: 1.5,
                      background: 'linear-gradient(to bottom right, rgba(147, 51, 234, 0.1), rgba(236, 72, 153, 0.1))',
                    }}
                  >
                    <CheckCircleIcon sx={{ fontSize: 24, color: '#22c55e' }} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        {campaign.name}
                      </Typography>
                  <Chip
                        label={getStatusLabel(campaign)}
                        size="small"
                        sx={{
                          bgcolor: statusColors.bg,
                          color: statusColors.color,
                          border: '1px solid',
                          borderColor: statusColors.color,
                          fontWeight: 500,
                        }}
                      />
                    </Stack>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                      {campaign.template.substring(0, 100)}...
                    </Typography>
                    <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <CalendarIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {campaign.scheduleTime ? new Date(campaign.scheduleTime).toLocaleDateString('he-IL') : 'לא מתוזמן'}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <PeopleIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {campaign.recipientCount} נמענים
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <BarChartIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {responseRate}% הגיבו
                        </Typography>
                      </Stack>
                    </Stack>
                    <Box sx={{ mt: 1.5 }}>
                      <Box
                        sx={{
                          height: 8,
                          bgcolor: alpha('#e5e7eb', 0.5),
                          borderRadius: '999px',
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          sx={{
                            height: '100%',
                            width: `${responseRate}%`,
                            background: 'linear-gradient(to right, #9333ea, #ec4899)',
                            borderRadius: '999px',
                            transition: 'width 0.5s',
                          }}
                        />
                      </Box>
                    </Box>
                  </Box>
                  <IconButton
                    size="small"
                    sx={{
                      flexShrink: 0,
                      '&:hover': {
                        bgcolor: alpha('#9333ea', 0.1),
                      },
                    }}
                  >
                    <ChevronRightIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                  </IconButton>
                </Stack>
              </Paper>
            );
          })}

          {/* Upcoming Campaigns */}
          {upcomingCampaigns.map((campaign) => {
            const statusColors = getStatusColor(campaign);
            const isNextCampaign = isNext(campaign, filteredCampaigns);
            const isPaused = campaign.status === 'paused';
            const isLoading = updating === campaign.id;

            return (
              <Paper
                key={campaign.id}
                elevation={0}
                sx={{
                  p: 2.5,
                  backgroundColor: isNextCampaign 
                    ? 'rgba(147, 51, 234, 0.1)' 
                    : 'rgba(255, 255, 255, 0.8)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: isNextCampaign 
                    ? alpha('#9333ea', 0.5)
                    : alpha('#9333ea', 0.2),
                  borderRadius: 3,
                  boxShadow: isNextCampaign 
                    ? '0 10px 30px rgba(147, 51, 234, 0.25), 0 0 0 2px rgba(147, 51, 234, 0.2)'
                    : 'none',
                  transition: 'all 0.3s',
                  position: 'relative',
                  '&:hover': {
                    boxShadow: isNextCampaign
                      ? '0 10px 30px rgba(147, 51, 234, 0.3), 0 0 0 2px rgba(147, 51, 234, 0.3)'
                      : '0 10px 30px rgba(147, 51, 234, 0.15)',
                  },
                }}
              >
                {isNextCampaign && (
                  <Box
                    sx={{
                      mb: 1.5,
                      bgcolor: 'rgba(255, 255, 255, 0.8)',
                      backdropFilter: 'blur(10px)',
                      px: 1.5,
                      py: 0.75,
                      borderRadius: '999px',
                      width: 'fit-content',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                    }}
                  >
                    <SparklesIcon sx={{ fontSize: 16, color: '#9333ea' }} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#9333ea' }}>
                      הקמפיין הבא בתור
                    </Typography>
                  </Box>
                )}
                {isLoading && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: alpha('#fff', 0.8),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 3,
                      zIndex: 1,
                    }}
                  >
                    <CircularProgress size={40} />
                  </Box>
                )}
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Box
                    sx={{
                      borderRadius: 2,
                      p: 1.5,
                      background: isNextCampaign
                        ? 'linear-gradient(to bottom right, rgba(147, 51, 234, 0.2), rgba(236, 72, 153, 0.2))'
                        : 'linear-gradient(to bottom right, rgba(147, 51, 234, 0.1), rgba(236, 72, 153, 0.1))',
                    }}
                  >
                    {campaign.status === 'sent' ? (
                      <CheckCircleIcon sx={{ fontSize: 24, color: '#22c55e' }} />
                    ) : campaign.status === 'scheduled' ? (
                      <SendIcon sx={{ fontSize: 24, color: '#3b82f6' }} />
                    ) : (
                      <ClockIcon sx={{ fontSize: 24, color: '#9333ea' }} />
                    )}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        {campaign.name}
                      </Typography>
                      <Chip
                        label={getStatusLabel(campaign)}
                        size="small"
                        sx={{
                          bgcolor: statusColors.bg,
                          color: statusColors.color,
                          border: '1px solid',
                          borderColor: statusColors.color,
                          fontWeight: 500,
                        }}
                      />
                    </Stack>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                      {campaign.template.substring(0, 100)}...
                    </Typography>
                    <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <CalendarIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {campaign.scheduleTime ? new Date(campaign.scheduleTime).toLocaleDateString('he-IL') : 'לא מתוזמן'}
                        </Typography>
                      </Stack>
                    </Stack>
                    {isNextCampaign && campaign.status === 'scheduled' && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<PencilIcon sx={{ fontSize: 14 }} />}
                        onClick={() => handleEditMessage(campaign)}
                        disabled={isLoading}
                        sx={{
                          mt: 1.5,
                          height: 32,
                          fontSize: '0.75rem',
                          borderColor: alpha('#9333ea', 0.3),
                          color: '#9333ea',
                          '&:hover': {
                            bgcolor: alpha('#9333ea', 0.1),
                            borderColor: alpha('#9333ea', 0.5),
                            color: '#7e22ce',
                          },
                          '& .MuiButton-startIcon': {
                            marginRight: 0,
                            marginLeft: 0.25,
                          },
                        }}
                      >
                        ערוך קמפיין
                      </Button>
                    )}
                  </Box>
                  <IconButton
                    size="small"
                    sx={{
                      flexShrink: 0,
                      '&:hover': {
                        bgcolor: alpha('#9333ea', 0.1),
                      },
                    }}
                  >
                    <ChevronRightIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                  </IconButton>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      </Box>

      {filteredCampaigns.length === 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 4,
            textAlign: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(10px)',
            borderRadius: 3,
            border: '1px solid',
            borderColor: alpha('#9333ea', 0.2),
          }}
        >
          <Typography variant="body1" color="text.secondary">
            אין קמפיינים להצגה
          </Typography>
        </Paper>
      )}

      {/* What Can You Do Here Card */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          backgroundColor: 'rgba(255, 255, 255, 0.6)',
          backdropFilter: 'blur(10px)',
          border: '1px solid',
          borderColor: alpha('#9333ea', 0.2),
          borderRadius: 3,
          mt: 3,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 2 }}>
          מה אפשר לעשות כאן?
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: '#9333ea',
                mt: 0.75,
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              ליצור קמפיין חדש לשליחת הודעות לאורחים
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: '#9333ea',
                mt: 0.75,
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              לתזמן שליחה מראש (למשל: תזכורת שבוע לפני האירוע)
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: '#9333ea',
                mt: 0.75,
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              לעקוב אחרי סטטוס כל קמפיין – ממתין, נשלח או הושלם
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: '#9333ea',
                mt: 0.75,
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              לראות אילו אורחים קיבלו את ההודעה ואילו עדיין לא הגיבו
            </Typography>
          </Stack>
        </Stack>
      </Paper>

      {/* Edit Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => {
          if (!saving) {
            setEditDialogOpen(false);
            setEditingCampaign(null);
            setEditType(null);
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editType === 'time' ? 'שינוי זמן שליחה' : 'עריכת הודעה'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            {editType === 'time' ? (
              <>
                <Alert severity="info">
                  שים לב: שינוי הזמן ישפיע על כל המוזמנים. הקמפיין יישלח בזמן החדש שתבחר.
                </Alert>
              <TextField
                  type="datetime-local"
                  label="תאריך ושעת שליחה"
                  value={editedTime}
                  onChange={(e) => setEditedTime(e.target.value)}
                fullWidth
                  InputLabelProps={{ shrink: true }}
                  disabled={saving}
              />
                {editingCampaign && (
                  <Typography variant="body2" color="text.secondary">
                    זמן נוכחי: {editingCampaign.scheduleTime ? new Date(editingCampaign.scheduleTime).toLocaleString('he-IL') : 'לא מתוזמן'}
                  </Typography>
                )}
              </>
            ) : (
              <>
                <Alert severity="info">
                  שים לב: שינוי ההודעה ישפיע על כל המוזמנים. הקמפיין יישלח עם התוכן החדש.
                </Alert>
                <TextField
                  label="תוכן ההודעה"
                  multiline
                  rows={6}
                  value={editedMessage}
                  onChange={(e) => setEditedMessage(e.target.value)}
                  fullWidth
                  disabled={saving}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setEditDialogOpen(false);
            setEditingCampaign(null);
            setEditType(null);
          }} disabled={saving}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={saveEdit}
            disabled={saving || (editType === 'time' ? !editedTime : !editedMessage)}
          >
            {saving ? <CircularProgress size={20} /> : 'שמור שינויים'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Send Now Confirmation Dialog */}
      <Dialog
        open={sendNowDialogOpen}
        onClose={() => {
          if (!updating) {
            setSendNowDialogOpen(false);
            setSendNowCampaign(null);
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          שליחה מיידית
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">
              אתה עומד לשלוח את ההודעה עכשיו, במקום בזמן המתוכנן.
            </Alert>
            {sendNowCampaign && (
              <>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {sendNowCampaign.name}
                </Typography>
                  <Box
                    sx={{
                      p: 2,
                      backgroundColor: alpha('#2196f3', 0.08),
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: alpha('#2196f3', 0.2),
                    }}
                  >
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {processTemplateText(sendNowCampaign.template, getTemplateVariables())}
                    </Typography>
                  </Box>
              <Typography variant="body2" color="text.secondary">
                  ההודעה תישלח ל-<strong>{sendNowCampaign.recipientCount}</strong> מוזמנים עכשיו.
              </Typography>
                {sendNowCampaign.scheduleTime && (
              <Typography variant="body2" color="text.secondary">
                    זמן מתוכנן: {new Date(sendNowCampaign.scheduleTime).toLocaleString('he-IL')}
              </Typography>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setSendNowDialogOpen(false);
            setSendNowCampaign(null);
          }} disabled={updating !== null}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={confirmSendNow}
            startIcon={updating ? <CircularProgress size={16} /> : <SendIcon />}
            disabled={updating !== null}
            sx={{
              backgroundColor: '#5236F7',
              '&:hover': {
                backgroundColor: '#4328E8',
              },
            }}
          >
            {updating ? 'שולח...' : 'שלח עכשיו'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Messages; 
