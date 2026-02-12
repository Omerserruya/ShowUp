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
  Divider,
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
  Edit as EditTemplateIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useEvent } from '../contexts/EventContext';
import { useCampaigns, useOverviewStats } from '../hooks/useOverviewData';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { templates, processTemplate, MessageTemplate } from '../config/templates';

// WhatsApp message bubble component (same as in EventWizard)
const WhatsAppBubble = ({ template, variables }: { template: MessageTemplate; variables: Record<string, string> }) => {
  const processedBody = processTemplate(template, variables);
  const lines = processedBody.split('\n');
  
  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: '#ffffff',
        borderRadius: '7.5px',
        p: 1,
        maxWidth: '85%',
        mr: 'auto',
        mb: 0.5,
        boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
        border: '1px solid rgba(0,0,0,0.08)',
        overflow: 'hidden',
        direction: 'rtl',
        textAlign: 'right',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: -8,
          top: 0,
          width: 0,
          height: 0,
          borderTop: '0px solid transparent',
          borderBottom: '20px solid transparent',
          borderRight: `8px solid #ffffff`,
        },
      }}
    >
      {template.title && (
        <Typography 
          variant="subtitle2" 
          fontWeight={700} 
          sx={{ 
            mb: 0.25,
            fontSize: '0.875rem',
            color: '#000',
            textAlign: 'right',
            direction: 'rtl',
            width: '100%',
            display: 'block',
          }}
        >
          {processTemplate({ ...template, body: template.title }, variables)}
        </Typography>
      )}
      {lines.map((line, idx) => (
        <Typography
          key={idx}
          variant="body2"
          sx={{
            color: '#000',
            mb: line.trim() ? 0.25 : 0,
            fontSize: '0.8125rem',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            direction: 'rtl',
            textAlign: 'right',
          }}
        >
          {line || '\u00A0'}
        </Typography>
      ))}
      {template.cta && (
        <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
          <Typography
            variant="body2"
            sx={{
              color: '#0084ff',
              fontWeight: 500,
              fontSize: '0.8125rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              justifyContent: 'flex-end',
            }}
          >
            {template.cta.text}
            {template.cta.link && <span>↗</span>}
          </Typography>
        </Box>
      )}
      {template.buttons && template.buttons.length > 0 && (
        <>
          <Typography
            variant="caption"
            sx={{
              color: 'rgba(0,0,0,0.45)',
              fontSize: '10px',
              display: 'flex',
              justifyContent: 'flex-end',
              mt: 0.25,
              mb: 0.25,
              direction: 'ltr',
            }}
          >
            {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </Typography>
          <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid rgba(0,0,0,0.1)', mx: -1, px: 1 }}>
            {template.buttons.map((button, idx) => (
              <Box key={button.id}>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#0084ff',
                    fontWeight: 400,
                    fontSize: '0.8125rem',
                    textAlign: 'center',
                    py: 0.5,
                  }}
                >
                  {button.text}
                </Typography>
                {idx < template.buttons!.length - 1 && (
                  <Divider 
                    sx={{ 
                      borderColor: 'rgba(0,0,0,0.1)',
                      mx: -1,
                      width: 'calc(100% + 16px)',
                    }} 
                  />
                )}
              </Box>
            ))}
          </Box>
        </>
      )}
      {!template.buttons && (
        <Typography
          variant="caption"
          sx={{
            color: 'rgba(0,0,0,0.45)',
            fontSize: '10px',
            display: 'flex',
            justifyContent: 'flex-end',
            mt: 0.25,
            direction: 'ltr',
          }}
        >
          {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
        </Typography>
      )}
    </Box>
  );
};

// Campaign message preview component - finds template by ID or campaignLabel
const CampaignMessagePreview = ({ 
  campaignName,
  campaignTemplate,
  variables 
}: { 
  campaignName: string;
  campaignTemplate?: string;
  variables: Record<string, string> 
}) => {
  // Try to find template by ID first (campaign.template or campaign.name might be the template ID like "save_date_1")
  let template = templates.find(t => t.id === campaignTemplate || t.id === campaignName);
  
  // If not found by ID, try to find by campaignLabel (campaign name might match campaignLabel like "Save the date")
  if (!template) {
    template = templates.find(t => t.campaignLabel === campaignName && t.isDefault === true);
  }
  
  // If still not found, try to find any template with matching campaignLabel
  if (!template) {
    const matchingTemplates = templates.filter(t => t.campaignLabel === campaignName);
    template = matchingTemplates[0];
  }
  
  // If no template found, fallback to simple text display
  if (!template) {
    return (
      <Typography 
        variant="body2" 
        sx={{ 
          color: '#000',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          direction: 'rtl',
          textAlign: 'right',
        }}
      >
        {campaignTemplate || campaignName}
      </Typography>
    );
  }
  
  return <WhatsAppBubble template={template} variables={variables} />;
};

// Campaign status types from API (normalized)
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
  // Optional fields that may contain recipients info
  recipient_count?: number;
  recipients?: any[];
}

interface Campaign {
  id: string;
  name: string;
  template: string;
  status: CampaignStatus;
  scheduleTime: Date | null;
  channel: 'whatsapp' | 'sms' | 'email';
  /**
   * Number of recipients the campaign was actually sent to.
   * Prefer campaign-specific data from the API; fallback to a general estimate when not available.
   */
  recipientCount: number;
  sentCount?: number; // Number of recipients sent to (from messages_sent)
  readCount?: number; // Number of recipients who read the message (from messages_log)
}

function Messages() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { selectedEvent } = useEvent();
  const { campaigns: apiCampaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const { stats } = useOverviewStats();
  
  // State
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
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
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [selectingTemplateFor, setSelectingTemplateFor] = useState<string | null>(null);

  // Map API campaigns to local format and fetch stats
  useEffect(() => {
    if (!apiCampaigns || apiCampaigns.length === 0) {
      setCampaigns([]);
      return;
    }

    const mapped = apiCampaigns.map((apiCampaign: CampaignFromAPI) => {
      // Map status from API to local status
      // Treat "processing" from backend as "sent" in the UI once sending has been triggered
      let status: CampaignStatus = 'pending';
      if (apiCampaign.status === 'sent' || apiCampaign.status === 'processing') {
        status = 'sent';
      } else if (apiCampaign.status === 'paused') {
        status = 'paused';
      } else if (apiCampaign.schedule_time) {
        status = 'scheduled';
      }

      // Derive per-campaign recipient count:
      // - Prefer explicit recipient_count from API
      // - Then fall back to length of recipients list if available
      // - Finally, fall back to the general recipientCount estimate
      const specificRecipientCount =
        typeof apiCampaign.recipient_count === 'number'
          ? apiCampaign.recipient_count
          : Array.isArray(apiCampaign.recipients)
          ? apiCampaign.recipients.length
          : (stats?.total_guests || 0);

      return {
        id: apiCampaign.id,
        name: apiCampaign.name,
        template: apiCampaign.template,
        status,
        scheduleTime: apiCampaign.schedule_time ? new Date(apiCampaign.schedule_time) : null,
        channel: apiCampaign.channel as 'whatsapp' | 'sms' | 'email',
        recipientCount: specificRecipientCount,
        sentCount: undefined, // Will be loaded separately
        readCount: undefined, // Will be loaded separately
      };
    });

    setCampaigns(mapped);

    // Fetch stats for sent campaigns
    // Only fetch if we know the endpoint exists (check once and cache result)
    const fetchStats = async () => {
      const sentCampaigns = mapped.filter(c => c.status === 'sent');
      if (sentCampaigns.length === 0) return;
      
      // Try to fetch stats for the first campaign to check if endpoint exists
      // If it returns 404, we'll skip all subsequent requests to avoid console noise
      let endpointExists: boolean | null = null;
      
      for (const campaign of sentCampaigns) {
        try {
          const statsRes = await fetchWithAuth(`/api/campaigns/${campaign.id}/stats`);
          
          if (statsRes.status === 404) {
            // First 404 means endpoint doesn't exist yet - skip all remaining requests
            if (endpointExists === null) {
              endpointExists = false;
              // Silently skip - endpoint not implemented yet
              break;
            }
            continue;
          }
          
          // If we got here, endpoint exists
          if (endpointExists === null) {
            endpointExists = true;
          }
          
          if (statsRes.ok) {
            const stats = await statsRes.json();
            setCampaigns(prev => prev.map(c => 
              c.id === campaign.id 
                ? { ...c, sentCount: stats.sent_count || 0, readCount: stats.read_count || 0 }
                : c
            ));
          }
        } catch (error) {
          // Network errors or other issues - log only if endpoint was confirmed to exist
          if (endpointExists === true) {
            console.warn(`Failed to fetch stats for campaign ${campaign.id}:`, error);
          }
          // If endpoint doesn't exist, silently skip
          if (endpointExists === null) {
            endpointExists = false;
            break;
          }
        }
      }
    };

    fetchStats();
  }, [apiCampaigns, stats?.total_guests]);

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
        return { bg: alpha(theme.palette.success.main, 0.1), color: theme.palette.success.main };
      case 'scheduled':
        return { bg: alpha(theme.palette.info.main, 0.1), color: theme.palette.info.main };
      case 'paused':
        return { bg: alpha(theme.palette.warning.main, 0.1), color: theme.palette.warning.main };
      case 'pending':
        return { bg: alpha(theme.palette.text.secondary, 0.1), color: theme.palette.text.secondary };
      default:
        return { bg: alpha(theme.palette.text.disabled, 0.1), color: theme.palette.text.disabled };
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
        'שם_מזמין': 'דוד ושרה',
        'שעה': '18:00',
      };
    }

    const eventDate = selectedEvent.date 
      ? new Date(selectedEvent.date).toLocaleDateString('he-IL', { 
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric' 
        })
      : '{{תאריך}}';

    const eventTime = selectedEvent.date
      ? new Date(selectedEvent.date).toLocaleTimeString('he-IL', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '18:00';

    // Extract inviter names from event
    const inviters = (selectedEvent as any)?.inviters || [];
    const inviterNames = Array.isArray(inviters) && inviters.length > 0
      ? inviters.map((inv: any) => `${inv.fn || ''} ${inv.ln || ''}`.trim()).filter(Boolean).join(' ו-')
      : 'דוד ושרה';

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
      'שם_מזמין': inviterNames,
      'שעה': eventTime,
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      });
      if (!response.ok) throw new Error('Failed to resume campaign');
      setCampaigns(prev => prev.map(c =>
        c.id === campaign.id ? { ...c, status: 'pending' as CampaignStatus } : c
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
    // Set schedule_time to ~30 seconds from now so the scheduler/worker will send it soon
    const sendAt = new Date(Date.now() + 30 * 1000);
    setUpdating(sendNowCampaign.id);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${sendNowCampaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_time: sendAt.toISOString() }),
      });
      if (!response.ok) throw new Error('Failed to schedule campaign for send');
      setCampaigns(prev => prev.map(c =>
        c.id === sendNowCampaign.id
          ? { ...c, scheduleTime: sendAt, status: 'scheduled' as CampaignStatus }
          : c
      ));
      setSendNowDialogOpen(false);
      setSendNowCampaign(null);
    } catch (error) {
      console.error('Error sending campaign:', error);
      alert('שגיאה בתזמון השליחה');
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

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Update campaign error:', errorText);
        throw new Error(`Failed to update campaign: ${response.status} ${errorText}`);
      }
      
      const updated = await response.json();
      console.log('Updated campaign:', updated);
      
      // Refresh campaigns list to get updated data
      const campaignsResponse = await fetchWithAuth(`/api/campaigns?event_id=${selectedEvent?.id}`);
      if (campaignsResponse.ok) {
        const campaignsData = await campaignsResponse.json();
        const mapped = campaignsData.map((apiCampaign: CampaignFromAPI) => ({
          id: apiCampaign.id,
          name: apiCampaign.name,
          template: apiCampaign.template,
          channel: apiCampaign.channel,
          scheduleTime: apiCampaign.schedule_time ? new Date(apiCampaign.schedule_time) : null,
          status: apiCampaign.status as CampaignStatus,
          recipientCount: apiCampaign.recipient_count || 0,
          sentCount: undefined, // Will be fetched separately if needed
        }));
        setCampaigns(mapped);
      } else {
        // Fallback: update local state
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
      }

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

  // Expand/collapse handlers
  const handleToggleExpand = (campaignId: string) => {
    setExpandedCampaignId(expandedCampaignId === campaignId ? null : campaignId);
  };

  const handleDelete = async (campaign: Campaign) => {
    if (!window.confirm(`האם אתה בטוח שברצונך למחוק את הקמפיין "${campaign.name}"?`)) {
      return;
    }

    setUpdating(campaign.id);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${campaign.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete campaign');
      
      setCampaigns(prev => prev.filter(c => c.id !== campaign.id));
      if (expandedCampaignId === campaign.id) {
        setExpandedCampaignId(null);
      }
    } catch (error) {
      console.error('Error deleting campaign:', error);
      alert('שגיאה במחיקת הקמפיין');
    } finally {
      setUpdating(null);
    }
  };

  const handleChangeTemplate = (campaign: Campaign) => {
    // Open the campaign if it's not expanded
    if (expandedCampaignId !== campaign.id) {
      setExpandedCampaignId(campaign.id);
    }
    // Toggle template selection
    setSelectingTemplateFor(selectingTemplateFor === campaign.id ? null : campaign.id);
  };

  const handleTemplateSelect = async (campaign: Campaign, templateId: string) => {
    if (campaign.template === templateId) {
      setSelectingTemplateFor(null);
      return;
    }
    setUpdating(campaign.id);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: templateId }),
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error('Update template error:', response.status, errText);
        throw new Error(errText || 'Failed to update template');
      }
      setCampaigns(prev => prev.map(c =>
        c.id === campaign.id ? { ...c, template: templateId } : c
      ));
      setSelectingTemplateFor(null);
    } catch (error) {
      console.error('Error updating template:', error);
      alert('שגיאה בעדכון התבנית. נסה שוב.');
    } finally {
      setUpdating(null);
    }
  };

  // Group campaigns
  const pastCampaigns = filteredCampaigns.filter(c => isPast(c));
  const upcomingCampaigns = filteredCampaigns.filter(c => !isPast(c));
  
  // Calculate statistics
  const totalCampaigns = campaigns.length;
  const totalSent = campaigns.filter(c => c.status === 'sent').length; // number of campaigns that were sent
  // אחוז מענה = אורחים שאישרו או דחו (בשני המקרים הגיבו) מתוך סה"כ מוזמנים
  const responseRate = stats && stats.total > 0 
    ? Math.round(((stats.approved + stats.declined) / stats.total) * 100)
    : 0;
  
  // For sent campaigns: read rate = (read_count / recipient_count) — webhook updates read per message
  const getCampaignReadRate = (campaign: Campaign): number => {
    if (campaign.status !== 'sent') return 0;
    const sentCount = campaign.sentCount ?? campaign.recipientCount ?? 0;
    if (sentCount <= 0) return 0;
    return Math.round(((campaign.readCount ?? 0) / sentCount) * 100);
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
          background: `linear-gradient(to bottom right, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
          border: '1px solid',
          borderColor: alpha(theme.palette.primary.main, 0.2),
          borderRadius: 3,
          p: 3,
          mb: 3,
        }}
      >
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Box
            sx={{
              bgcolor: alpha(theme.palette.background.paper, 0.8),
              backdropFilter: 'blur(10px)',
              borderRadius: '50%',
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SendIcon sx={{ fontSize: 24, color: 'primary.main' }} />
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
              bgcolor: alpha(theme.palette.background.paper, 0.8),
              backdropFilter: 'blur(10px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.2),
              borderRadius: 3,
              p: 2,
              textAlign: 'center',
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5 }}>
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
              bgcolor: alpha(theme.palette.background.paper, 0.8),
              backdropFilter: 'blur(10px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.info.main, 0.2),
              borderRadius: 3,
              p: 2,
              textAlign: 'center',
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 700, color: 'info.main', mb: 0.5 }}>
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
              bgcolor: alpha(theme.palette.background.paper, 0.8),
              backdropFilter: 'blur(10px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.success.main, 0.2),
              borderRadius: 3,
              p: 2,
              textAlign: 'center',
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 700, color: 'success.main', mb: 0.5 }}>
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
          background: `linear-gradient(to right, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
          color: 'white',
          height: 56,
          fontSize: '1rem',
          fontWeight: 500,
          borderRadius: 3,
          boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.2)}`,
          mb: 3,
          '&:hover': {
            background: `linear-gradient(to right, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
            boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.3)}`,
          },
          '& .MuiButton-startIcon': {
            marginRight: 0,
            marginLeft: 0.5,
          },
        }}
      >
        הוסף סבב הודעות
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
            const readRate = getCampaignReadRate(campaign);
            return (
              <Paper
                key={campaign.id}
                elevation={0}
                sx={{
                  p: 1,
                  backgroundColor: alpha(theme.palette.background.paper, 0.8),
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: alpha(theme.palette.primary.main, 0.2),
                  borderRadius: 3,
                  transition: 'all 0.3s',
                  '&:hover': {
                    boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.15)}`,
                  },
                }}
              >
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Box
                    sx={{
                      borderRadius: 2,
                      p: 1.5,
                      background: `linear-gradient(to bottom right, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
                    }}
                  >
                    <CheckCircleIcon sx={{ fontSize: 24, color: 'success.main' }} />
                  </Box>
                  <Box
                    sx={{
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start"  sx={{ mb: 1 }}>
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
                          {campaign.recipientCount} נשלח ל
                        </Typography>
                      </Stack>
                      {campaign.status === 'sent' && campaign.recipientCount > 0 && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <BarChartIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {readRate}% ראו
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                    <Box sx={{ mt: 1.5 }}>
                      <Box
                        sx={{
                          height: 8,
                          bgcolor: alpha(theme.palette.divider, 0.5),
                          borderRadius: '999px',
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          sx={{
                            height: '100%',
                            width: `${readRate}%`,
                            background: `linear-gradient(to right, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                            borderRadius: '999px',
                            transition: 'width 0.5s',
                          }}
                        />
                      </Box>
                    </Box>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (campaign.status !== 'sent') {
                        handleToggleExpand(campaign.id);
                      }
                    }}
                    sx={{
                      flexShrink: 0,
                      transform: expandedCampaignId === campaign.id ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                      },
                    }}
                  >
                    <ChevronRightIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                  </IconButton>
                </Stack>
                {/* Expanded content */}
                {expandedCampaignId === campaign.id && campaign.status !== 'sent' && (
                  <Box
                    sx={{
                      pt: 2,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    {/* Template selection gallery */}
                    {selectingTemplateFor === campaign.id ? (() => {
                      // Match by template id first, then by campaign name / campaignLabel
                      const currentTemplate = templates.find(t => t.id === campaign.template || t.id === campaign.name);
                      const campaignLabel = currentTemplate?.campaignLabel || campaign.name;
                      let campaignTemplates = templates.filter(t => t.campaignLabel === campaignLabel);
                      const templateVariables = getTemplateVariables();
                      const currentTemplateId = campaign.template || campaign.name;

                      // If no templates in same group, show all templates so user can always change
                      if (campaignTemplates.length === 0) {
                        campaignTemplates = [...templates];
                      }

                      return (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.primary' }}>
                            בחר תבנית
                          </Typography>
                          <Box
                            sx={{
                              display: 'flex',
                              gap: 2,
                              overflowX: 'auto',
                              overflowY: 'hidden',
                              pb: 2,
                              mx: -0.5,
                              px: 0.5,
                              width: '100%',
                              maxWidth: '100%',
                              scrollSnapType: 'x proximity',
                              WebkitOverflowScrolling: 'touch',
                              touchAction: 'pan-x',
                              minHeight: 280,
                              '&::-webkit-scrollbar': {
                                height: 8,
                              },
                              '&::-webkit-scrollbar-track': {
                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                borderRadius: 3,
                              },
                              '&::-webkit-scrollbar-thumb': {
                                bgcolor: alpha(theme.palette.primary.main, 0.3),
                                borderRadius: 3,
                                '&:hover': {
                                  bgcolor: alpha(theme.palette.primary.main, 0.5),
                                },
                              },
                              scrollbarWidth: 'thin',
                            }}
                          >
                            {campaignTemplates.map((template) => {
                              const isSelected = template.id === currentTemplateId;
                              const isDefault = template.isDefault === true;
                              
                              return (
                                <Paper
                                  key={template.id}
                                  variant="outlined"
                                  onClick={() => handleTemplateSelect(campaign, template.id)}
                                  sx={{
                                    p: 1.5,
                                    cursor: updating === campaign.id ? 'default' : 'pointer',
                                    borderWidth: isSelected ? 2 : 1,
                                    borderColor: isSelected ? 'primary.main' : isDefault ? 'success.main' : 'divider',
                                    bgcolor: isSelected ? 'primary.main' + '08' : isDefault ? 'success.main' + '05' : 'transparent',
                                    transition: 'all 0.2s ease',
                                    minWidth: 240,
                                    width: 240,
                                    flexShrink: 0,
                                    scrollSnapAlign: 'start',
                                    position: 'relative',
                                    opacity: updating === campaign.id ? 0.6 : 1,
                                    '&:hover': {
                                      borderColor: updating === campaign.id ? undefined : 'primary.main',
                                      bgcolor: updating === campaign.id ? undefined : 'primary.main' + '05',
                                    },
                                  }}
                                >
                                  {isDefault && (
                                    <Chip
                                      label="ברירת מחדל"
                                      size="small"
                                      color="success"
                                      sx={{
                                        position: 'absolute',
                                        top: 8,
                                        left: 8,
                                        fontSize: '10px',
                                        height: 20,
                                        zIndex: 1,
                                      }}
                                    />
                                  )}
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexDirection: 'row-reverse', direction: 'rtl' }}>
                                    <Typography variant="body2" fontWeight={600} sx={{ textAlign: 'right', direction: 'rtl', flex: 1, fontSize: '0.8125rem' }}>
                                      {template.name}
                                    </Typography>
                                    {isSelected && (
                                      <Chip
                                        label="נבחר"
                                        size="small"
                                        color="primary"
                                        sx={{ height: 20, fontSize: '0.7rem', ml: 1 }}
                                      />
                                    )}
                                  </Box>
                                  
                                  {/* WhatsApp preview */}
                                  <Box
                                    sx={{
                                      bgcolor: '#ece5dd',
                                      p: 1,
                                      borderRadius: 1,
                                      minHeight: 100,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      justifyContent: 'flex-end',
                                    }}
                                  >
                                    <WhatsAppBubble template={template} variables={templateVariables} />
                                  </Box>
                                </Paper>
                              );
                            })}
                          </Box>
                          <Button
                            variant="text"
                            onClick={() => setSelectingTemplateFor(null)}
                            sx={{ mt: 1, color: 'text.secondary' }}
                          >
                            ביטול
                          </Button>
                        </Box>
                      );
                    })() : (
                      /* Action buttons - Filter style */
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                        <Button
                          onClick={() => handleSendNow(campaign)}
                          disabled={updating === campaign.id}
                          sx={{
                            borderRadius: 3,
                            px: 2.5,
                            py: 0.75,
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            textTransform: 'none',
                            bgcolor: 'primary.main',
                            color: 'white',
                            border: 'none',
                            '&:hover': {
                              bgcolor: 'primary.dark',
                            },
                            '&:disabled': {
                              bgcolor: 'action.disabled',
                              color: 'white',
                            },
                          }}
                        >
                          שלח עכשיו
                        </Button>
                        <Button
                          onClick={() => handleChangeTemplate(campaign)}
                          disabled={updating === campaign.id}
                          sx={{
                            borderRadius: 3,
                            px: 2.5,
                            py: 0.75,
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            textTransform: 'none',
                            bgcolor: 'action.hover',
                            color: 'text.primary',
                            border: 'none',
                            '&:hover': {
                              bgcolor: 'action.selected',
                            },
                            '&:disabled': {
                              bgcolor: 'action.disabledBackground',
                              color: 'text.disabled',
                            },
                          }}
                        >
                          שנה תבנית
                        </Button>
                        <Button
                          onClick={() => handleDelete(campaign)}
                          disabled={updating === campaign.id}
                          sx={{
                            borderRadius: 3,
                            px: 2.5,
                            py: 0.75,
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            textTransform: 'none',
                            border: '1px solid',
                            borderColor: 'error.main',
                            bgcolor: 'transparent',
                            color: 'error.main',
                            '&:hover': {
                              bgcolor: alpha(theme.palette.error.main, 0.08),
                              borderColor: 'error.dark',
                            },
                            '&:disabled': {
                              borderColor: 'action.disabled',
                              color: 'text.disabled',
                              bgcolor: 'transparent',
                            },
                          }}
                        >
                          מחק
                        </Button>
                      </Stack>
                    )}
                  </Box>
                )}
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
                    ? alpha(theme.palette.primary.main, 0.1)
                    : alpha(theme.palette.background.paper, 0.8),
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: isNextCampaign 
                    ? alpha(theme.palette.primary.main, 0.5)
                    : alpha(theme.palette.primary.main, 0.2),
                  borderRadius: 3,
                  boxShadow: isNextCampaign
                    ? `0 10px 30px ${alpha(theme.palette.primary.main, 0.25)}, 0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`
                    : 'none',
                  transition: 'all 0.3s',
                  position: 'relative',
                  '&:hover': {
                    boxShadow: isNextCampaign
                      ? `0 10px 30px ${alpha(theme.palette.primary.main, 0.3)}, 0 0 0 2px ${alpha(theme.palette.primary.main, 0.3)}`
                      : `0 10px 30px ${alpha(theme.palette.primary.main, 0.15)}`,
                  },
                }}
              >
                {isNextCampaign && (
                  <Box
                    sx={{
                      mb: 1.5,
                      bgcolor: alpha(theme.palette.background.paper, 0.8),
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
                    <SparklesIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
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
                      backgroundColor: alpha(theme.palette.background.paper, 0.8),
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
                <Stack direction="row" spacing={0.5} alignItems="flex-start">
                  <Box
                    sx={{
                      borderRadius: 2,
                      p: 1.5,
                      background: isNextCampaign
                        ? `linear-gradient(to bottom right, ${alpha(theme.palette.primary.main, 0.2)}, ${alpha(theme.palette.secondary.main, 0.2)})`
                        : `linear-gradient(to bottom right, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
                    }}
                  >
                    {campaign.status === 'sent' ? (
                      <CheckCircleIcon sx={{ fontSize: 24, color: 'success.main' }} />
                    ) : campaign.status === 'scheduled' ? (
                      <SendIcon sx={{ fontSize: 24, color: 'info.main' }} />
                    ) : (
                      <ClockIcon sx={{ fontSize: 24, color: 'primary.main' }} />
                    )}
                  </Box>
                  <Box
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      pr: { xs: 1, sm: 1 }, // keep text away from right purple square
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 0.5 }}>
                      <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary' }}>
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
                    {/* Short meta description under title: date + recipients */}
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'primary.main',
                        fontWeight: 500,
                        mb: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        direction: 'rtl',
                        textAlign: 'right',
                      }}
                    >
                      <span>
                        📅{' '}
                        {campaign.scheduleTime
                          ? new Date(campaign.scheduleTime).toLocaleDateString('he-IL')
                          : 'לא מתוזמן'}
                      </span>
                      <span>·</span>
                      <span>
                        👥 {campaign.recipientCount} יישלח ל
                      </span>
                    </Typography>
                    {/* WhatsApp-style message preview - only when expanded (both mobile and desktop) */}
                    {expandedCampaignId === campaign.id && (
                      <Box
                        sx={{
                          bgcolor: '#ece5dd',
                          borderRadius: '7.5px',
                          p: 1,
                          mb: 2,
                          maxWidth: '90%',
                          mr: 'auto',
                        }}
                      >
                        <CampaignMessagePreview 
                          campaignName={campaign.name}
                          campaignTemplate={campaign.template}
                          variables={getTemplateVariables()} 
                        />
                      </Box>
                    )}
                    {/* Extra meta row was here; info moved under title for cleaner layout */}
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (campaign.status !== 'sent') {
                        handleToggleExpand(campaign.id);
                      }
                    }}
                    sx={{
                      flexShrink: 0,
                      transform: expandedCampaignId === campaign.id ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                      },
                    }}
                  >
                    <ChevronRightIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                  </IconButton>
                </Stack>
                {/* Expanded content */}
                {expandedCampaignId === campaign.id && campaign.status !== 'sent' && (
                  <Box
                    sx={{
                      mt: 2,
                      pt: 2,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    {selectingTemplateFor === campaign.id ? (() => {
                      const currentTemplate = templates.find(t => t.id === campaign.template || t.id === campaign.name);
                      const campaignLabel = currentTemplate?.campaignLabel || campaign.name;
                      let campaignTemplates = templates.filter(t => t.campaignLabel === campaignLabel);
                      const templateVariables = getTemplateVariables();
                      const currentTemplateId = campaign.template || campaign.name;
                      if (campaignTemplates.length === 0) campaignTemplates = [...templates];
                      return (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.primary' }}>
                            בחר תבנית
                          </Typography>
                          <Box
                            sx={{
                              display: 'flex',
                              gap: 2,
                              overflowX: 'auto',
                              overflowY: 'hidden',
                              pb: 2,
                              mx: -0.5,
                              px: 0.5,
                              width: '100%',
                              maxWidth: '100%',
                              scrollSnapType: 'x proximity',
                              WebkitOverflowScrolling: 'touch',
                              touchAction: 'pan-x',
                              minHeight: 280,
                              '&::-webkit-scrollbar': { height: 8 },
                              '&::-webkit-scrollbar-track': { bgcolor: alpha(theme.palette.primary.main, 0.1), borderRadius: 3 },
                              '&::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.primary.main, 0.3), borderRadius: 3 },
                              scrollbarWidth: 'thin',
                            }}
                          >
                            {campaignTemplates.map((template) => {
                              const isSelected = template.id === currentTemplateId;
                              const isDefault = template.isDefault === true;
                              return (
                                <Paper
                                  key={template.id}
                                  variant="outlined"
                                  onClick={() => handleTemplateSelect(campaign, template.id)}
                                  sx={{
                                    p: 1.5,
                                    cursor: updating === campaign.id ? 'default' : 'pointer',
                                    borderWidth: isSelected ? 2 : 1,
                                    borderColor: isSelected ? 'primary.main' : isDefault ? 'success.main' : 'divider',
                                    bgcolor: isSelected ? 'primary.main' + '08' : isDefault ? 'success.main' + '05' : 'transparent',
                                    minWidth: 240,
                                    width: 240,
                                    flexShrink: 0,
                                    scrollSnapAlign: 'start',
                                    '&:hover': { borderColor: updating === campaign.id ? undefined : 'primary.main', bgcolor: updating === campaign.id ? undefined : 'primary.main' + '05' },
                                  }}
                                >
                                  {isDefault && <Chip label="ברירת מחדל" size="small" color="success" sx={{ position: 'absolute', top: 8, left: 8, fontSize: '10px', height: 20, zIndex: 1 }} />}
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexDirection: 'row-reverse', direction: 'rtl' }}>
                                    <Typography variant="body2" fontWeight={600} sx={{ textAlign: 'right', direction: 'rtl', flex: 1, fontSize: '0.8125rem' }}>{template.name}</Typography>
                                    {isSelected && <Chip label="נבחר" size="small" color="primary" sx={{ height: 20, fontSize: '0.7rem', ml: 1 }} />}
                                  </Box>
                                  <Box sx={{ bgcolor: '#ece5dd', p: 1, borderRadius: 1, minHeight: 100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                    <WhatsAppBubble template={template} variables={templateVariables} />
                                  </Box>
                                </Paper>
                              );
                            })}
                          </Box>
                          <Button variant="text" onClick={() => setSelectingTemplateFor(null)} sx={{ mt: 1, color: 'text.secondary' }}>
                            ביטול
                          </Button>
                        </Box>
                      );
                    })() : (
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                      <Button
                        onClick={() => handleSendNow(campaign)}
                        disabled={isLoading}
                        sx={{
                          borderRadius: 3,
                          px: 2.5,
                          py: 0.75,
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          textTransform: 'none',
                          bgcolor: 'primary.main',
                          color: 'white',
                          border: 'none',
                          '&:hover': {
                            bgcolor: 'primary.dark',
                          },
                          '&:disabled': {
                            bgcolor: 'action.disabled',
                            color: 'white',
                          },
                        }}
                      >
                        שלח עכשיו
                      </Button>
                      <Button
                        onClick={() => handleChangeTemplate(campaign)}
                        disabled={isLoading}
                        sx={{
                          borderRadius: 3,
                          px: 2.5,
                          py: 0.75,
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          textTransform: 'none',
                          bgcolor: 'action.hover',
                          color: 'text.primary',
                          border: 'none',
                          '&:hover': {
                            bgcolor: 'action.selected',
                          },
                          '&:disabled': {
                            bgcolor: 'action.disabledBackground',
                            color: 'text.disabled',
                          },
                        }}
                      >
                        שנה תבנית
                      </Button>
                      {campaign.status === 'paused' ? (
                        <Button
                          onClick={() => handleResume(campaign)}
                          disabled={isLoading}
                          sx={{
                            borderRadius: 3,
                            px: 2.5,
                            py: 0.75,
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            textTransform: 'none',
                            bgcolor: 'action.hover',
                            color: 'text.primary',
                            border: 'none',
                            '&:hover': { bgcolor: 'action.selected' },
                            '&:disabled': { bgcolor: 'action.disabledBackground', color: 'text.disabled' },
                          }}
                        >
                          המשך
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handlePause(campaign)}
                          disabled={isLoading}
                          sx={{
                            borderRadius: 3,
                            px: 2.5,
                            py: 0.75,
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            textTransform: 'none',
                            border: '1px solid',
                            borderColor: 'warning.main',
                            bgcolor: 'transparent',
                            color: 'warning.dark',
                            '&:hover': {
                              bgcolor: alpha(theme.palette.warning.main, 0.1),
                              borderColor: 'warning.dark',
                            },
                            '&:disabled': {
                              borderColor: 'action.disabled',
                              color: 'text.disabled',
                              bgcolor: 'transparent',
                            },
                          }}
                        >
                          השהה
                        </Button>
                      )}
                      <Button
                        onClick={() => handleDelete(campaign)}
                        disabled={isLoading}
                        sx={{
                          borderRadius: 3,
                          px: 2.5,
                          py: 0.75,
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          textTransform: 'none',
                          border: '1px solid',
                          borderColor: 'error.main',
                          bgcolor: 'transparent',
                          color: 'error.main',
                          '&:hover': {
                            bgcolor: alpha(theme.palette.error.main, 0.08),
                            borderColor: 'error.dark',
                          },
                          '&:disabled': {
                            borderColor: 'action.disabled',
                            color: 'text.disabled',
                            bgcolor: 'transparent',
                          },
                        }}
                      >
                        מחק
                      </Button>
                    </Stack>
                    )}
                  </Box>
                )}
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
            backgroundColor: alpha(theme.palette.background.paper, 0.8),
            backdropFilter: 'blur(10px)',
            borderRadius: 3,
            border: '1px solid',
            borderColor: alpha(theme.palette.primary.main, 0.2),
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
          backgroundColor: alpha(theme.palette.background.paper, 0.6),
          backdropFilter: 'blur(10px)',
          border: '1px solid',
          borderColor: alpha(theme.palette.primary.main, 0.2),
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
                bgcolor: 'primary.main',
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
                bgcolor: 'primary.main',
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
                bgcolor: 'primary.main',
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
                bgcolor: 'primary.main',
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
            <Alert severity="info">
              זמן השליחה של הקמפיין ייעודכן לעוד כחצי דקה, וההודעה תישלח אוטומטית אז.
            </Alert>
            {sendNowCampaign && (
              <>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {sendNowCampaign.name}
                </Typography>
                {/* WhatsApp-style message preview */}
                <Box
                  sx={{
                    bgcolor: '#ece5dd',
                    borderRadius: '7.5px',
                    p: 1.5,
                    mb: 2,
                    maxWidth: '90%',
                    mr: 'auto',
                  }}
                >
                  <CampaignMessagePreview 
                    campaignName={sendNowCampaign.name}
                    campaignTemplate={sendNowCampaign.template}
                    variables={getTemplateVariables()} 
                  />
                </Box>
              <Typography variant="body2" color="text.secondary">
                  ההודעה תישלח ל-<strong>{sendNowCampaign.recipientCount}</strong> מוזמנים בעוד כחצי דקה.
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
              backgroundColor: 'primary.main',
              '&:hover': {
                backgroundColor: 'primary.dark',
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
