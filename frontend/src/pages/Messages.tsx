import React, { useState, useEffect, useRef } from 'react';
import Toast from '../components/Toast';
import ResponsiveDialog from '../components/ResponsiveDialog';
import { fireConfetti, fireConfettiOnce } from '../utils/confetti';
import {
  Box,
  Typography,
  Paper,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Stack,
  IconButton,
  Tooltip,
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
  ChevronLeft as ChevronLeftIcon,
  Create as PencilIcon,
  Edit as EditTemplateIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  MailOutline as EmailIcon,
  ImageOutlined as ImageIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useEvent } from '../contexts/EventContext';
import { useUser } from '../contexts/UserContext';
import { saveOrderToken, orderAuthHeaders } from '../utils/orderToken';
import { useCampaigns, useOverviewStats } from '../hooks/useOverviewData';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useCatalog } from '../hooks/useCatalog';
import type { MessagingCatalog, CatalogTemplate } from '../hooks/useCatalog';
import { renderBody, buildPreviewValues, buildEventValues, parseLocation } from '../config/messaging';
import type { PreviewCtx } from '../config/messaging';

// datetime-local inputs expect LOCAL wall-clock components - never a UTC ISO
// slice, which shifts the shown time by the timezone offset.
const toLocalInputValue = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Proper Hebrew for "in N days" (avoids "בעוד 1 ימים").
const inDaysLabel = (n: number): string => {
  if (n <= 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n === 2) return 'בעוד יומיים';
  return `בעוד ${n} ימים`;
};

// Hebrew fallback titles per canonical flow stage (the catalog stage title wins).
const STAGE_LABELS: Record<string, string> = {
  save_the_date: 'שמרו את התאריך',
  invitation: 'הזמנה',
  reminder: 'תזכורת',
  final_reminder: 'תזכורת אחרונה',
  table_assignment: 'שיבוץ שולחנות',
  thank_you: 'תודה',
};

// Lifecycle order for the new-round stage picker (mirrors the backend FlowStage).
const STAGE_ORDER = ['save_the_date', 'invitation', 'reminder', 'final_reminder', 'table_assignment', 'thank_you'];


// WhatsApp message bubble - renders the catalog template body (same definition the
// worker delivers).
const WhatsAppBubble = ({ template, variables, imageUrl }: { template: { title?: string; body: string; preview?: { header?: string } }; variables: Record<string, string>; imageUrl?: string }) => {
  const processedBody = renderBody(template.body, variables);
  const lines = processedBody.split('\n');
  const needsImage = template.preview?.header === 'image';

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
      {needsImage && (
        imageUrl ? (
          <Box
            component="img"
            src={imageUrl}
            alt=""
            sx={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: '6px', mb: 0.75 }}
          />
        ) : (
          <Box
            sx={{
              width: '100%', height: 120, borderRadius: '6px', mb: 0.75,
              bgcolor: 'rgba(0,0,0,0.05)', border: '1px dashed rgba(0,0,0,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
              color: 'rgba(0,0,0,0.4)',
            }}
          >
            <ImageIcon sx={{ fontSize: 20 }} />
            <Typography variant="caption" sx={{ color: 'inherit' }}>תמונה תופיע כאן</Typography>
          </Box>
        )
      )}
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
          {renderBody(template.title, variables)}
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
    </Box>
  );
};

// Campaign message preview component - finds template by ID or campaignLabel
const CampaignMessagePreview = ({
  catalog,
  campaignName,
  campaignTemplate,
  variables
}: {
  catalog: MessagingCatalog;
  campaignName: string;
  campaignTemplate?: string;
  variables: Record<string, string>
}) => {
  // Resolve the catalog template by its canonical id (campaign.template / name).
  const template = catalog.templates.find(t => t.id === campaignTemplate || t.id === campaignName);

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
        {renderBody(campaignTemplate || campaignName, variables)}
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
  channel: 'whatsapp' | 'email';
  /**
   * Number of recipients the campaign was actually sent to.
   * Prefer campaign-specific data from the API; fallback to a general estimate when not available.
   */
  recipientCount: number;
  sentCount?: number; // Number of recipients sent to (from messages_sent)
  readCount?: number; // Number of recipients who read the message (from messages_log)
}

// Resolve the catalog template backing a campaign (by canonical id).
function commTemplate(catalog: MessagingCatalog, campaign: Campaign): CatalogTemplate | undefined {
  return catalog.templates.find((t) => t.id === campaign.template || t.id === campaign.name);
}

// A realistic miniature of a guest communication - headline, message, button,
// status and micro-info. The left-column "queue" is built from these.
// Small uppercase label used in the summary strip.
function StripLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: 'text.secondary', mb: 0.5 }}>
      {children}
    </Typography>
  );
}

// Lightweight icon + text stat used in the sent-campaign analytics row.
function Stat({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {icon}
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>{text}</Typography>
    </Stack>
  );
}

function MsgPreview({ catalog, campaign, variables }: { catalog: MessagingCatalog; campaign: Campaign; variables: Record<string, string> }) {
  const tpl = commTemplate(catalog, campaign);
  const title = tpl?.title ? renderBody(tpl.title, variables) : '';
  // Custom (free-text) messages keep their {{tokens}} in storage; render them
  // here with preview values so the display stays human-readable.
  const body = renderBody(tpl ? tpl.body : (campaign.template || ''), variables);
  const btnText = '';
  return (
    <Box sx={{ position: 'relative', maxWidth: 340 }}>
      {/* faint layers behind → "stacked" hint */}
      <Box sx={{ position: 'absolute', inset: 0, borderRadius: 2.5, bgcolor: '#ece5dd', transform: 'translate(7px, 7px)', opacity: 0.35, zIndex: 0 }} />
      <Box sx={{ position: 'absolute', inset: 0, borderRadius: 2.5, bgcolor: '#ece5dd', transform: 'translate(3.5px, 3.5px)', opacity: 0.6, zIndex: 0 }} />
      {/* front preview - real message, cropped + faded */}
      <Box sx={{ position: 'relative', zIndex: 1, borderRadius: 2.5, bgcolor: '#ece5dd', p: 1, maxHeight: 120, overflow: 'hidden', direction: 'rtl', textAlign: 'right', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', maskImage: 'linear-gradient(180deg,#000 66%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 66%,transparent)' }}>
        <Box sx={{ bgcolor: '#fff', borderRadius: '7.5px', p: 1, boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)' }}>
          {title && <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#111', mb: 0.25 }}>{title}</Typography>}
          <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{body}</Typography>
          {btnText && (
            <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid rgba(0,0,0,0.08)', textAlign: 'center' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: '#0084ff' }}>{btnText}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function Messages() {
  const { catalog } = useCatalog();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { selectedEvent } = useEvent();
  const { user } = useUser();
  const navigate = useNavigate();
  const { campaigns: apiCampaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const { stats } = useOverviewStats();
  
  // State
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [sendNowDialogOpen, setSendNowDialogOpen] = useState(false);
  const [sendNowCampaign, setSendNowCampaign] = useState<Campaign | null>(null);
  const [editedTime, setEditedTime] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [selectingTemplateFor, setSelectingTemplateFor] = useState<string | null>(null);
  // Which communication is selected (shows actions) and which is hovered - shared
  // between the left card stack and the right timeline for cross-highlighting.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStage, setCreateStage] = useState('');
  const [createName, setCreateName] = useState('');
  const [createTemplateId, setCreateTemplateId] = useState('');
  const [createTime, setCreateTime] = useState('');
  const [createImageUrl, setCreateImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const createImageInputRef = useRef<HTMLInputElement>(null);
  // Paid extra-round purchase (shown when the round is beyond the plan's included set).
  const [purchase, setPurchase] = useState<{ price: number; band: string; recipients: number } | null>(null);
  const [buying, setBuying] = useState(false);
  const [creating, setCreating] = useState(false);
  const showToast = (message: string, severity: 'success' | 'error' | 'info' = 'info') => setToast({ open: true, message, severity });

  // THE one API→UI campaign mapper - every list refresh must go through it so
  // status normalization (pending+time → scheduled, processing → sent) and the
  // recipient-count fallbacks stay consistent.
  const mapApiCampaign = (apiCampaign: CampaignFromAPI): Campaign => {
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
      channel: apiCampaign.channel as 'whatsapp' | 'email',
      recipientCount: specificRecipientCount,
      sentCount: undefined, // Will be loaded separately
      readCount: undefined, // Will be loaded separately
    };
  };

  // Fetch delivery stats for sent campaigns.
  // Only fetch if we know the endpoint exists (check once and cache result)
  const fetchCampaignStats = async (list: Campaign[]) => {
    const sentCampaigns = list.filter(c => c.status === 'sent');
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

  // Map API campaigns to local format and fetch stats
  useEffect(() => {
    if (!apiCampaigns || apiCampaigns.length === 0) {
      setCampaigns([]);
      return;
    }

    const mapped = apiCampaigns.map(mapApiCampaign);
    setCampaigns(mapped);
    fetchCampaignStats(mapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (sentDiffDays <= 0) return 'היום';
      if (sentDiffDays === 1) return 'אתמול';
      if (sentDiffDays === 2) return 'לפני יומיים';
      return `לפני ${sentDiffDays} ימים`;
    }
    
    if (campaign.status === 'paused') {
      return `הייתה אמורה להישלח ב-${scheduleDate.toLocaleDateString('he-IL')}`;
    }
    
    if (diffDays < 0) return 'עבר הזמן';
    return inDaysLabel(diffDays);
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


  const isNext = (campaign: Campaign, allCampaigns: Campaign[]): boolean => {
    if (campaign.status !== 'scheduled') return false;
    const scheduled = allCampaigns
      .filter(c => c.status === 'scheduled' && c.scheduleTime)
      .sort((a, b) => new Date(a.scheduleTime!).getTime() - new Date(b.scheduleTime!).getTime());
    return scheduled.length > 0 && scheduled[0].id === campaign.id;
  };

  // The real details of the selected event, as messaging preview context.
  const eventCtx = (): PreviewCtx => {
    if (!selectedEvent) return {};
    const inviters = (selectedEvent as any)?.inviters || [];
    const host = Array.isArray(inviters) && inviters.length > 0
      ? inviters.map((inv: any) => `${inv.fn || ''} ${inv.ln || ''}`.trim()).filter(Boolean).join(' ו-')
      : undefined;
    return {
      eventName: selectedEvent.name || undefined,
      eventDate: selectedEvent.date
        ? new Date(selectedEvent.date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : undefined,
      eventTime: selectedEvent.date
        ? new Date(selectedEvent.date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
        : undefined,
      venue: parseLocation(selectedEvent.location).name || undefined,
      venueAddress: parseLocation(selectedEvent.location).address || undefined,
      host,
    };
  };

  // Get template variables from event
  // Preview values from the ONE catalog (samples overridden by the selected event),
  // keyed by canonical names + legacy Hebrew tokens. DISPLAY ONLY - never persist
  // a body rendered with these (the guest-scope samples are fake).
  const getTemplateVariables = (): Record<string, string> => buildPreviewValues(catalog, eventCtx());

  // Real event values ONLY (no samples) - safe to bake into a stored custom
  // message: guest-scope tokens ({{guest_name}}, {{rsvp_link}}…) stay intact and
  // are resolved per guest by the worker at send time.
  const getEventOnlyVariables = (): Record<string, string> => buildEventValues(catalog, eventCtx());

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
    setEditedTime(campaign.scheduleTime ? toLocalInputValue(new Date(campaign.scheduleTime)) : '');
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
      showToast('שגיאה בהשהיית הקמפיין', 'error');
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
      showToast('שגיאה בחידוש הקמפיין', 'error');
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
    // The scheduler only claims status='pending' rows - a paused campaign must be
    // resumed in the same PUT or "send now" would silently never send.
    const payload: { schedule_time: string; status?: string } = { schedule_time: sendAt.toISOString() };
    if (sendNowCampaign.status === 'paused') payload.status = 'pending';
    setUpdating(sendNowCampaign.id);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${sendNowCampaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to schedule campaign for send');
      setCampaigns(prev => prev.map(c =>
        c.id === sendNowCampaign.id
          ? { ...c, scheduleTime: sendAt, status: 'scheduled' as CampaignStatus }
          : c
      ));
      setSendNowDialogOpen(false);
      setSendNowCampaign(null);
      // Celebrate the first campaign ever sent; fire a normal burst on later sends.
      if (!fireConfettiOnce('first_campaign_sent')) {
        fireConfetti();
      }
      showToast('הקמפיין נשלח! ההודעות בדרך 🎉', 'success');
    } catch (error) {
      console.error('Error sending campaign:', error);
      showToast('שגיאה בתזמון השליחה', 'error');
    } finally {
      setUpdating(null);
    }
  };

  const saveEdit = async () => {
    if (!editingCampaign) return;

    setSaving(true);
    try {
      const updateData: any = {
        schedule_time: editedTime ? new Date(editedTime).toISOString() : null,
      };

      const response = await fetchWithAuth(`/api/campaigns/${editingCampaign.id}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Update campaign error:', errorText);
        throw new Error(`Failed to update campaign: ${response.status} ${errorText}`);
      }

      await response.json();

      // Refresh campaigns list to get updated data - through the shared mapper,
      // so statuses stay normalized and stats reload.
      const campaignsResponse = await fetchWithAuth(`/api/campaigns?event_id=${selectedEvent?.id}`);
      if (campaignsResponse.ok) {
        const campaignsData: CampaignFromAPI[] = await campaignsResponse.json();
        const mapped = campaignsData.map(mapApiCampaign);
        setCampaigns(mapped);
        fetchCampaignStats(mapped);
      } else {
        // Fallback: update local state
        setCampaigns(prev => prev.map(c =>
          c.id === editingCampaign.id
            ? { ...c, scheduleTime: editedTime ? new Date(editedTime) : c.scheduleTime }
            : c
        ));
      }

      setEditDialogOpen(false);
      setEditingCampaign(null);
    } catch (error) {
      console.error('Error updating campaign:', error);
      showToast('שגיאה בעדכון הקמפיין', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Templates the UI may offer for sending - never suggest one that can't be
  // delivered (draft lifecycle / no approved Meta mapping); the backend rejects
  // those with a 400 anyway.
  const sendableTemplates = catalog.templates.filter((t) => t.sendable);

  // Hebrew display name for a template's stage (used as the default round name).
  const stageTitle = (flowStage: string): string =>
    catalog.stages.find((s) => s.id === flowStage)?.title || STAGE_LABELS[flowStage] || 'סבב חדש';

  const eventType = (selectedEvent?.type as string) || 'wedding';

  // Stages that actually have a deliverable template for this event, ordered by
  // the lifecycle (STAGE_ORDER). A new round starts by choosing one of these.
  const stagesForCreate = STAGE_ORDER.filter((sid) =>
    sendableTemplates.some((t) => t.flow_stage === sid),
  );

  // Deliverable templates belonging to the chosen stage.
  const templatesForCreateStage = (stageId: string): CatalogTemplate[] =>
    sendableTemplates.filter((t) => t.flow_stage === stageId);

  const createTemplateObj = catalog.templates.find((t) => t.id === createTemplateId);
  const createNeedsImage = createTemplateObj?.preview?.header === 'image';

  const applyCreateStage = (stageId: string) => {
    setCreateStage(stageId);
    const tpls = templatesForCreateStage(stageId);
    const tpl = tpls.find((t) => t.is_default) || tpls[0];
    setCreateTemplateId(tpl?.id || '');
    setCreateName(stageTitle(stageId));
    setCreateImageUrl('');
  };

  // New-round creation ("סבב חדש")
  const openCreate = () => {
    setCreateTime('');
    setCreateImageUrl('');
    const firstStage = stagesForCreate[0] || '';
    if (firstStage) applyCreateStage(firstStage);
    else { setCreateStage(''); setCreateTemplateId(''); setCreateName('סבב חדש'); }
    setCreateOpen(true);
  };

  const handleCreateTemplateChange = (templateId: string) => {
    setCreateTemplateId(templateId);
    setCreateImageUrl('');
    const tpl = catalog.templates.find((t) => t.id === templateId);
    if (tpl) setCreateName(stageTitle(tpl.flow_stage));
  };

  // Upload a header image for an image-header round. Reuses the invitation
  // presigned-upload flow (S3), returns the public object URL.
  const uploadCreateImage = async (file?: File | null) => {
    if (!file || !selectedEvent?.id) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      showToast('סוג קובץ לא נתמך - ניתן להעלות תמונות בלבד', 'error');
      return;
    }
    setUploadingImage(true);
    try {
      const presign = await fetchWithAuth('/api/uploads/generate-upload-url', {
        method: 'POST',
        body: JSON.stringify({ event_id: selectedEvent.id, filename: file.name, content_type: file.type, folder: 'campaigns' }),
      });
      if (!presign.ok) throw new Error('presign');
      const { url, fields, object_url, max_bytes } = await presign.json();
      if (max_bytes && file.size > max_bytes) {
        showToast(`הקובץ גדול מדי - מקסימום ${Math.round(max_bytes / 1024 / 1024)}MB`, 'error');
        return;
      }
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v as string));
      form.append('file', file);
      const up = await fetch(url, { method: 'POST', body: form });
      if (!up.ok) throw new Error('upload');
      setCreateImageUrl(object_url);
    } catch {
      showToast('העלאת התמונה נכשלה. נסו שוב.', 'error');
    } finally {
      setUploadingImage(false);
    }
  };

  const confirmCreate = async () => {
    if (!selectedEvent?.id || !createTemplateId || !createName.trim()) return;
    // An image-header template must have an image before it can go out.
    if (createNeedsImage && !createImageUrl) {
      showToast('התבנית הזו כוללת תמונה - נא להעלות תמונה לפני יצירת הסבב.', 'error');
      return;
    }
    setCreating(true);
    try {
      const body: any = {
        event_id: selectedEvent.id,
        name: createName.trim(),
        template: createTemplateId,
        channel: 'whatsapp',
        status: 'pending',
      };
      if (createNeedsImage && createImageUrl) body.header_image_url = createImageUrl;
      if (createTime) body.schedule_time = new Date(createTime).toISOString();
      const res = await fetchWithAuth(`/api/campaigns?event_id=${selectedEvent.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Extra round beyond the plan's included set - the round must be paid for
      // first. Surface the price and route to checkout instead of erroring.
      if (res.status === 402) {
        const err = await res.json().catch(() => ({} as any));
        const d = err?.detail || {};
        if (d.code === 'extra_round_required') {
          setPurchase({ price: d.price_gross, band: d.band_label, recipients: d.recipients });
          return;
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to create campaign');
      }
      // Refresh the list so the new round appears with server-computed audience size.
      const listRes = await fetchWithAuth(`/api/campaigns?event_id=${selectedEvent.id}&order_by=schedule_time&page_size=100`);
      if (listRes.ok) {
        const data: CampaignFromAPI[] = await listRes.json();
        const mapped = data.map(mapApiCampaign);
        setCampaigns(mapped);
        fetchCampaignStats(mapped);
      }
      setCreateOpen(false);
      showToast(createTime ? 'הסבב נוצר ותוזמן 🎉' : 'הסבב נוצר - אפשר לתזמן אותו מתי שתרצו', 'success');
    } catch (error) {
      console.error('Error creating campaign:', error);
      showToast('שגיאה ביצירת הסבב. נסו שוב.', 'error');
    } finally {
      setCreating(false);
    }
  };

  // Buy the extra round: create a paid order, attach the owner's identity, and go
  // to checkout. On payment the event gets one round credit and the round can be
  // created (now within the included + paid allowance).
  const startExtraRoundPurchase = async () => {
    if (!selectedEvent?.id) return;
    const nameParts = (user?.username || '').trim().split(/\s+/).filter(Boolean);
    const firstName = user?.firstName || nameParts[0] || '';
    const lastName = user?.lastName || nameParts.slice(1).join(' ') || firstName;
    const phone = user?.phone || '';
    if (!phone || !firstName) {
      showToast('כדי לרכוש סבב יש להשלים שם וטלפון בפרופיל.', 'error');
      return;
    }
    setBuying(true);
    try {
      const res = await fetchWithAuth('/api/orders/extra-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: selectedEvent.id, audience: 'everyone' }),
      });
      if (!res.ok) throw new Error('order');
      const data = await res.json();
      const oid = data.order_id;
      saveOrderToken(oid, data.access_token);
      const idRes = await fetchWithAuth(`/api/orders/${encodeURIComponent(oid)}/identity`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...orderAuthHeaders(oid) },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, phone, email: user?.email || '' }),
      });
      if (!idRes.ok) throw new Error('identity');
      localStorage.setItem('pending_order_id', String(oid));
      navigate(`/payment?orderId=${encodeURIComponent(oid)}`);
    } catch {
      showToast('שגיאה בפתיחת התשלום. נסו שוב.', 'error');
      setBuying(false);
    }
  };

  // Expand/collapse handlers
  const handleToggleExpand = (campaignId: string) => {
    setExpandedCampaignId(expandedCampaignId === campaignId ? null : campaignId);
  };

  const handleDelete = (campaign: Campaign) => {
    setDeleteTarget(campaign);
  };

  const confirmDelete = async () => {
    const campaign = deleteTarget;
    if (!campaign) return;
    setDeleteTarget(null);
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
      showToast('הקמפיין נמחק', 'success');
    } catch (error) {
      console.error('Error deleting campaign:', error);
      showToast('שגיאה במחיקת הקמפיין', 'error');
    } finally {
      setUpdating(null);
    }
  };

  // Inline custom message editing (no popup) - "create custom like in the wizard".
  const openCustom = (campaign: Campaign) => {
    const tpl = commTemplate(catalog, campaign);
    const isCustom = campaign.template && !catalog.templates.find(t => t.id === campaign.template);
    // Pre-fill with REAL event values only: guest-scope tokens ({{guest_name}},
    // {{rsvp_link}}…) must stay as placeholders in the saved text, otherwise every
    // guest would receive the literal sample name and a dead link. The worker
    // substitutes them per guest at send time.
    setCustomText(isCustom ? campaign.template : (tpl ? renderBody(tpl.body, getEventOnlyVariables()) : ''));
    setCustomFor(campaign.id);
  };
  const saveCustom = async () => {
    if (!customFor) return;
    const id = customFor;
    setUpdating(id);
    try {
      const r = await fetchWithAuth(`/api/campaigns/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: customText }) });
      if (!r.ok) throw new Error('failed');
      setCampaigns(prev => prev.map(c => (c.id === id ? { ...c, template: customText } : c)));
      setCustomFor(null);
    } catch {
      showToast('שגיאה בשמירת ההודעה', 'error');
    } finally {
      setUpdating(null);
    }
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
      showToast('שגיאה בעדכון התבנית. נסה שוב.', 'error');
    } finally {
      setUpdating(null);
    }
  };

  // Single chronological timeline (earliest → latest; undated last).
  const timelineCampaigns = [...filteredCampaigns].sort((a, b) => {
    const ta = a.scheduleTime ? new Date(a.scheduleTime).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.scheduleTime ? new Date(b.scheduleTime).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  // Shared timeline action-button styles.
  // gap + RTL-correct icon spacing so the startIcon never overlaps the label.
  const tlBtnBase = { borderRadius: 1.5, px: 1.75, py: 0.6, fontSize: '0.8125rem', fontWeight: 600, textTransform: 'none' as const, gap: 0.5, '& .MuiButton-startIcon': { marginRight: 0, marginLeft: 0 } };
  const tlBtn = {
    primary: { ...tlBtnBase, bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' }, '&:disabled': { bgcolor: 'action.disabled', color: 'white' } },
    neutral: { ...tlBtnBase, bgcolor: 'action.hover', color: 'text.primary', '&:hover': { bgcolor: 'action.selected' }, '&:disabled': { bgcolor: 'action.disabledBackground', color: 'text.disabled' } },
    warn: { ...tlBtnBase, border: '1px solid', borderColor: 'warning.main', color: 'warning.dark', bgcolor: 'transparent', '&:hover': { bgcolor: alpha(theme.palette.warning.main, 0.1), borderColor: 'warning.dark' } },
    danger: { ...tlBtnBase, border: '1px solid', borderColor: 'error.main', color: 'error.main', bgcolor: 'transparent', '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.08), borderColor: 'error.dark' } },
  };
  
  // Calculate statistics
  const totalCampaigns = campaigns.length;
  const totalSent = campaigns.filter(c => c.status === 'sent').length; // number of campaigns that were sent
  const scheduledCount = campaigns.filter(c => c.status === 'scheduled').length;
  // Days until the next future communication (for the info strip).
  const nextUpcoming = campaigns
    .filter(c => c.scheduleTime && new Date(c.scheduleTime).getTime() > Date.now())
    .sort((a, b) => new Date(a.scheduleTime!).getTime() - new Date(b.scheduleTime!).getTime())[0];
  const nextInDays = nextUpcoming ? Math.max(0, Math.ceil((new Date(nextUpcoming.scheduleTime!).getTime() - Date.now()) / 86400000)) : null;
  // אחוז מענה = אורחים שאישרו או דחו (בשני המקרים הגיבו) מתוך סה"כ מוזמנים
  const responseRate = stats && stats.total > 0 
    ? Math.round(((stats.approved + stats.declined) / stats.total) * 100)
    : 0;
  
  // For sent campaigns: read rate = (read_count / recipient_count) - webhook updates read per message
  const getCampaignReadRate = (campaign: Campaign): number => {
    if (campaign.status !== 'sent') return 0;
    const sentCount = campaign.sentCount ?? campaign.recipientCount ?? 0;
    if (sentCount <= 0) return 0;
    return Math.round(((campaign.readCount ?? 0) / sentCount) * 100);
  };

  // Summary-strip metrics.
  const sentList = campaigns.filter(c => c.status === 'sent');
  const completed = sentList.length;
  const journeyPct = totalCampaigns > 0 ? Math.round((completed / totalCampaigns) * 100) : 0;
  const avgReadRate = sentList.length ? Math.round(sentList.reduce((a, c) => a + getCampaignReadRate(c), 0) / sentList.length) : 0;
  const totalGuests = (stats?.total && stats.total > 0) ? stats.total : Math.max(0, ...campaigns.map(c => c.recipientCount || 0));
  // Count only confirmed deliveries; planned recipients are not "reached".
  const guestsReached = Math.max(0, ...sentList.map(c => c.sentCount ?? 0));
  // Only claim measured analytics when at least one sent campaign has real
  // delivery stats - otherwise the strip must show "-", not a fake 0.
  const hasAnyDeliveryStats = sentList.some(c => c.sentCount != null);

  const primary = theme.palette.primary.main;

  if (campaignsLoading) {
    return (
      <Box sx={{ maxWidth: '72rem', mx: 'auto', px: { xs: 2, sm: 4 }, py: { xs: 3, sm: 6 }, direction: 'rtl' }}>
        <Skeleton variant="text" width={140} height={20} sx={{ mb: 2 }} />
        <Skeleton variant="text" width="45%" height={72} sx={{ mb: 2, borderRadius: 1 }} />
        <Skeleton variant="text" width="70%" height={24} />
        <Skeleton variant="text" width="60%" height={24} sx={{ mb: 4 }} />
        <Stack direction="row" spacing={5} sx={{ mb: 6 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} variant="text" width={64} height={48} />)}
        </Stack>
        {[0, 1, 2].map((i) => (
          <Stack key={i} direction="row" spacing={1.5} sx={{ mb: 3 }}>
            <Skeleton variant="circular" width={40} height={40} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="30%" height={18} />
              <Skeleton variant="text" width="55%" height={28} />
            </Box>
          </Stack>
        ))}
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
    <Box sx={{ direction: 'rtl', pb: { xs: 20, sm: 0 } }}>
      {/* Compact action row (no large page title) */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>קמפיינים</Typography>
        <Button
          startIcon={<PlusIcon sx={{ fontSize: 18 }} />}
          variant="contained"
          disableElevation
          onClick={openCreate}
          sx={{ borderRadius: 1.5, px: 2, py: 0.65, fontWeight: 600, fontSize: '0.85rem', textTransform: 'none', boxShadow: 'none', bgcolor: 'primary.main', gap: 0.5, '& .MuiButton-startIcon': { marginRight: 0, marginLeft: 0 }, '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' } }}
        >
          סבב חדש
        </Button>
      </Stack>

      {/* Summary strip - one surface, meaningful sections, Stripe-style */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', mb: 3 }}>
        {([
          (
            <>
              <StripLabel>סבבים</StripLabel>
              <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: 'text.primary' }}>{totalCampaigns}</Typography>
            </>
          ),
          (
            <>
              <StripLabel>הבא בתור</StripLabel>
              {nextUpcoming ? (<>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }} noWrap>{nextUpcoming.name}</Typography>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>{inDaysLabel(nextInDays ?? 0)}</Typography>
              </>) : (<Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.secondary' }}>אין</Typography>)}
            </>
          ),
          (
            <>
              <StripLabel>התקדמות</StripLabel>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary', mb: 0.5 }}>{completed} / {totalCampaigns} הושלמו</Typography>
              <LinearProgress variant="determinate" value={journeyPct} sx={{ height: 5, borderRadius: 99, bgcolor: alpha(primary, 0.12), '& .MuiLinearProgress-bar': { bgcolor: primary, borderRadius: 99 } }} />
            </>
          ),
          (
            <>
              <StripLabel>שיעור קריאה ממוצע</StripLabel>
              <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: 'text.primary' }}>{hasAnyDeliveryStats ? `${avgReadRate}%` : '-'}</Typography>
            </>
          ),
          (
            <>
              <StripLabel>אורחים שנחשפו</StripLabel>
              <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: 'text.primary' }}>
                {hasAnyDeliveryStats ? (
                  <>{guestsReached}<Typography component="span" sx={{ fontSize: 15, fontWeight: 500, color: 'text.secondary' }}> / {totalGuests}</Typography></>
                ) : '-'}
              </Typography>
            </>
          ),
        ]).map((content, i) => (
          <Box key={i} sx={{ flex: { xs: '1 1 45%', md: '1 1 0' }, minWidth: 0, px: { xs: 2, sm: 2.5 }, py: 1.75, borderInlineStart: i === 0 ? 'none' : '1px solid', borderColor: 'divider' }}>
            {content}
          </Box>
        ))}
      </Box>

      {/* The communication journey */}
      {timelineCampaigns.length === 0 ? (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', py: 4 }}>
          <Box sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(primary, 0.1), color: 'primary.main' }}>
            <SparklesIcon />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', mb: 0.5 }}>מסע התקשורת שלכם מתחיל כאן</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>צרו את הסבב הראשון ואנחנו נלווה את האורחים באופן אוטומטי לאורך כל הדרך.</Typography>
            <Button startIcon={<PlusIcon sx={{ fontSize: 18 }} />} variant="contained" disableElevation onClick={openCreate} sx={{ borderRadius: 1.5, px: 2.25, py: 0.75, fontWeight: 600, textTransform: 'none', boxShadow: 'none', bgcolor: 'primary.main', gap: 0.5, '& .MuiButton-startIcon': { marginRight: 0, marginLeft: 0 }, '&:hover': { bgcolor: 'primary.dark' } }}>צרו סבב ראשון</Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ position: 'relative' }}>
          {timelineCampaigns.map((campaign, i) => {
            const active = (hoveredId ?? selectedId) === campaign.id;
            const selected = selectedId === campaign.id;
            const isSent = campaign.status === 'sent';
            const isPaused = campaign.status === 'paused';
            const isLoading = updating === campaign.id;
            const isLast = i === timelineCampaigns.length - 1;
            const dt = campaign.scheduleTime ? new Date(campaign.scheduleTime) : null;
            const sc = getStatusColor(campaign);
            const readRate = getCampaignReadRate(campaign);
            // Only claim "delivered" when real delivery stats exist; the planned
            // recipient count must not masquerade as confirmed deliveries.
            const hasDeliveryStats = campaign.sentCount != null;
            const delivered = campaign.sentCount ?? campaign.recipientCount ?? 0;
            const read = campaign.readCount ?? 0;
            const unread = Math.max(0, delivered - read);
            // Inline template reselect (like the wizard): the alternatives for this round.
            const curTpl = commTemplate(catalog, campaign);
            const isCustomMsg = !!campaign.template && !catalog.templates.find(t => t.id === campaign.template);
            // Alternatives for this round = the other variants of the same stage -
            // sendable ones only (never cycle into a template that can't deliver).
            const group = curTpl ? sendableTemplates.filter(t => t.flow_stage === curTpl.flow_stage) : [];
            let tplList = group.length ? group : sendableTemplates;
            // Keep the currently-selected template visible even if it's no longer sendable.
            if (curTpl && !tplList.some(t => t.id === curTpl.id)) tplList = [curTpl, ...tplList];
            const curTplIdx = Math.max(0, tplList.findIndex(t => t.id === (campaign.template || campaign.name)));
            const goTemplate = (dir: number) => {
              if (!tplList.length) return;
              const n = (curTplIdx + dir + tplList.length) % tplList.length;
              handleTemplateSelect(campaign, tplList[n].id);
            };
            return (
              <Box
                key={campaign.id}
                role="button"
                tabIndex={0}
                aria-expanded={selected}
                onMouseEnter={() => setHoveredId(campaign.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => setSelectedId(selected ? null : campaign.id)}
                onKeyDown={(e) => {
                  // Only the row itself - Enter/Space on the revealed inner buttons must not re-toggle.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(selected ? null : campaign.id);
                  }
                }}
                sx={{ display: 'flex', gap: { xs: 1.5, sm: 2 }, cursor: 'pointer', position: 'relative', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2, borderRadius: 1 } }}
              >
                {/* Rail: date + node + connecting line (right side in RTL) */}
                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                  <Box sx={{ width: 46, textAlign: 'left', pt: 0.25 }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1, color: active ? 'primary.main' : 'text.primary' }}>
                      {dt ? dt.toLocaleDateString('he-IL', { day: '2-digit' }) : '-'}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                      {dt ? dt.toLocaleDateString('he-IL', { month: 'short' }) : ''}
                    </Typography>
                    {dt && <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>{dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</Typography>}
                  </Box>
                  <Box sx={{ position: 'relative', width: 18, display: 'flex', justifyContent: 'center' }}>
                    {!isLast && <Box sx={{ position: 'absolute', top: 16, bottom: -8, width: 2, bgcolor: 'divider' }} />}
                    <Box sx={{
                      position: 'relative', zIndex: 1, width: 12, height: 12, borderRadius: '50%', mt: '4px',
                      bgcolor: active ? primary : (isSent ? primary : 'background.paper'),
                      border: '2px solid', borderColor: isSent || active ? primary : alpha(primary, 0.4),
                      transition: 'all .2s ease',
                    }} />
                  </Box>
                </Box>

                {/* Communication block */}
                <Box sx={{ flex: 1, minWidth: 0, pb: isLast ? 1 : 3, position: 'relative' }}>
                  {isLoading && <Box sx={{ position: 'absolute', inset: 0, bgcolor: alpha(theme.palette.background.default, 0.6), display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}><CircularProgress size={26} /></Box>}

                  {/* Quick actions - top-left corner icons (when selected) */}
                  {selected && !isSent && (
                    <Box onClick={(e) => e.stopPropagation()} sx={{ position: 'absolute', top: -2, left: 0, display: 'flex', gap: 0.25, zIndex: 4 }}>
                      {isPaused ? (
                        <Tooltip title="חידוש"><IconButton size="small" onClick={() => handleResume(campaign)} disabled={isLoading} sx={{ color: 'text.secondary' }}><PlayArrowIcon fontSize="small" /></IconButton></Tooltip>
                      ) : (
                        <Tooltip title="השהיה"><IconButton size="small" onClick={() => handlePause(campaign)} disabled={isLoading} sx={{ color: 'text.secondary' }}><PauseIcon fontSize="small" /></IconButton></Tooltip>
                      )}
                      <Tooltip title="מחיקה"><IconButton size="small" onClick={() => handleDelete(campaign)} disabled={isLoading} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </Box>
                  )}

                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, mb: 0.5, pl: selected && !isSent ? 8 : 0 }}>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }} noWrap>{campaign.name}</Typography>
                    <Chip label={getStatusLabel(campaign)} size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600, bgcolor: alpha(sc.color, 0.12), color: sc.color }} />
                  </Stack>

                  {isSent ? (
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 1.25 }}>
                      {hasDeliveryStats ? (
                        <>
                          <Stat icon={<CheckCircleIcon sx={{ fontSize: 15, color: 'success.main' }} />} text={`נמסר ל-${delivered}`} />
                          <Stat icon={<PeopleIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={`נקרא ע"י ${read}`} />
                          <Stat icon={<BarChartIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={`שיעור פתיחה ${readRate}%`} />
                          {unread > 0 && <Stat icon={<ClockIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={`${unread} טרם נקראו`} />}
                        </>
                      ) : (
                        <>
                          <Stat icon={<CheckCircleIcon sx={{ fontSize: 15, color: 'success.main' }} />} text={`${campaign.recipientCount} נמענים מתוכננים`} />
                          <Stat icon={<ClockIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text="נתוני מסירה יתעדכנו בקרוב" />
                        </>
                      )}
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 1.25 }}>
                      <Stat icon={<PeopleIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={`${campaign.recipientCount} נמענים`} />
                      <Stat icon={<ClockIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={dt ? dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : 'לא מתוזמן'} />
                    </Stack>
                  )}

                  {isSent && hasDeliveryStats && delivered > 0 && (
                    <Box sx={{ maxWidth: 340, height: 5, borderRadius: 99, bgcolor: alpha(theme.palette.divider, 0.7), overflow: 'hidden', mb: 1.25 }}>
                      <Box sx={{ height: '100%', width: `${readRate}%`, bgcolor: primary, borderRadius: 99, transition: 'width .6s ease' }} />
                    </Box>
                  )}

                  {customFor === campaign.id ? (
                    /* Inline custom message editor (no popup) */
                    <Box onClick={(e) => e.stopPropagation()} sx={{ maxWidth: 360 }}>
                      <TextField multiline minRows={4} fullWidth size="small" value={customText} onChange={(e) => setCustomText(e.target.value)} autoFocus
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5, fontSize: 13, direction: 'rtl' } }} />
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Button onClick={saveCustom} disabled={isLoading} variant="contained" disableElevation sx={tlBtn.primary}>שמירה</Button>
                        <Button onClick={() => setCustomFor(null)} sx={tlBtn.neutral}>ביטול</Button>
                      </Stack>
                    </Box>
                  ) : (
                    <MsgPreview catalog={catalog} campaign={campaign} variables={getTemplateVariables()} />
                  )}

                  {/* Reselect / customise the message inline (like the wizard) */}
                  {selected && !isSent && customFor !== campaign.id && (
                    <Stack direction="row" spacing={0.5} alignItems="center" onClick={(e) => e.stopPropagation()} sx={{ mt: 1, maxWidth: 360 }}>
                      <IconButton size="small" onClick={() => goTemplate(1)} disabled={tplList.length < 2} sx={{ color: 'text.secondary' }}><ChevronRightIcon fontSize="small" /></IconButton>
                      <Typography variant="caption" sx={{ flex: 1, textAlign: 'center', color: 'text.secondary', fontWeight: 600 }} noWrap>
                        {isCustomMsg ? 'הודעה מותאמת אישית' : `${tplList[curTplIdx]?.title || 'תבנית'}${tplList.length > 1 ? ` · ${curTplIdx + 1}/${tplList.length}` : ''}`}
                      </Typography>
                      <IconButton size="small" onClick={() => goTemplate(-1)} disabled={tplList.length < 2} sx={{ color: 'text.secondary' }}><ChevronLeftIcon fontSize="small" /></IconButton>
                      <Button onClick={() => openCustom(campaign)} startIcon={<EditIcon sx={{ fontSize: 15 }} />} sx={{ ...tlBtn.neutral, flexShrink: 0 }}>מותאם</Button>
                    </Stack>
                  )}

                  {/* Primary actions */}
                  {selected && !isSent && customFor !== campaign.id && (
                    <Stack direction="row" spacing={1} onClick={(e) => e.stopPropagation()} sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                      <Button onClick={() => handleSendNow(campaign)} disabled={isLoading} startIcon={<SendIcon sx={{ fontSize: 16 }} />} sx={tlBtn.primary}>שליחה עכשיו</Button>
                      <Button onClick={() => handleEditTime(campaign)} disabled={isLoading} startIcon={<AccessTimeIcon sx={{ fontSize: 16 }} />} sx={tlBtn.neutral}>שינוי מועד</Button>
                    </Stack>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}


      {/* Edit-time Dialog */}
      <ResponsiveDialog
        open={editDialogOpen}
        onClose={() => {
          if (!saving) {
            setEditDialogOpen(false);
            setEditingCampaign(null);
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>מתי לשלוח?</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
              בחרו את המועד שבו הסבב יישלח לאורחים. אפשר לעדכן בכל רגע כל עוד ההודעות טרם יצאו.
            </Typography>
            <TextField
              type="datetime-local"
              label="תאריך ושעת שליחה"
              value={editedTime}
              onChange={(e) => setEditedTime(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
              disabled={saving}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
            />
            {editingCampaign?.status === 'paused' && (
              <Alert severity="warning">
                הסבב מושהה - גם אחרי שינוי המועד הוא לא יישלח עד שתחדשו אותו.
              </Alert>
            )}
            {editingCampaign && (
              <Typography variant="body2" color="text.secondary">
                זמן נוכחי: {editingCampaign.scheduleTime ? new Date(editingCampaign.scheduleTime).toLocaleString('he-IL') : 'לא מתוזמן'}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => {
            setEditDialogOpen(false);
            setEditingCampaign(null);
          }} disabled={saving} sx={{ borderRadius: 1.5, textTransform: 'none', color: 'text.secondary' }}>
            ביטול
          </Button>
          <Button
            variant="contained"
            disableElevation
            onClick={saveEdit}
            disabled={saving || !editedTime}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, px: 2.5, bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }}
          >
            {saving ? <CircularProgress size={20} /> : 'שמירת המועד'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Send Now Confirmation Dialog */}
      <ResponsiveDialog
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
        <DialogTitle sx={{ fontWeight: 700 }}>
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
                    catalog={catalog}
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
      </ResponsiveDialog>

      {/* Delete confirmation */}
      <ResponsiveDialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>מחיקת סבב</DialogTitle>
        <DialogContent>
          <Typography>
            האם למחוק את הסבב "{deleteTarget?.name}"? לא ניתן לבטל פעולה זו.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>ביטול</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>
            מחק
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* New round creation */}
      <ResponsiveDialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>סבב חדש</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {/* Step 1 - pick the STAGE (save-the-date / invitation / reminder / …). */}
            <FormControl fullWidth size="small">
              <InputLabel id="create-stage-label">שלב בתקשורת</InputLabel>
              <Select
                labelId="create-stage-label"
                label="שלב בתקשורת"
                value={createStage}
                onChange={(e) => applyCreateStage(e.target.value as string)}
              >
                {stagesForCreate.map((sid) => (
                  <MenuItem key={sid} value={sid}>{stageTitle(sid)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {/* Step 2 - pick the template within that stage. */}
            <FormControl fullWidth size="small" disabled={!createStage}>
              <InputLabel id="create-template-label">תבנית ההודעה</InputLabel>
              <Select
                labelId="create-template-label"
                label="תבנית ההודעה"
                value={createTemplateId}
                onChange={(e) => handleCreateTemplateChange(e.target.value as string)}
              >
                {/* Only deliverable templates for the chosen stage. */}
                {templatesForCreateStage(createStage).map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.title}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              fullWidth
              label="שם הסבב"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
            {/* Image-header templates require an image. */}
            {createNeedsImage && (
              <Box>
                <input
                  ref={createImageInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => { uploadCreateImage(e.target.files?.[0]); e.target.value = ''; }}
                />
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<ImageIcon sx={{ fontSize: 18 }} />}
                    onClick={() => createImageInputRef.current?.click()}
                    disabled={uploadingImage}
                    sx={{ fontWeight: 600 }}
                  >
                    {uploadingImage ? 'מעלה…' : createImageUrl ? 'החלפת תמונה' : 'העלאת תמונה'}
                  </Button>
                  <Typography variant="caption" color={createImageUrl ? 'success.main' : 'text.secondary'}>
                    {createImageUrl ? 'תמונה נבחרה ✓' : 'התבנית הזו כוללת תמונה בראש ההודעה - חובה להעלות אחת.'}
                  </Typography>
                </Stack>
              </Box>
            )}
            <TextField
              size="small"
              fullWidth
              type="datetime-local"
              label="מועד שליחה (לא חובה)"
              InputLabelProps={{ shrink: true }}
              value={createTime}
              onChange={(e) => setCreateTime(e.target.value)}
              helperText="בלי מועד, הסבב יישמר כטיוטה ותוכלו לתזמן או לשלוח אותו מתי שתרצו."
            />
            {createTemplateObj ? (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>כך ההודעה תיראה לאורחים:</Typography>
                <WhatsAppBubble template={createTemplateObj} variables={getTemplateVariables()} imageUrl={createImageUrl || undefined} />
              </Box>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>ביטול</Button>
          <Button
            variant="contained"
            onClick={confirmCreate}
            disabled={creating || !createName.trim() || !createTemplateId || (createNeedsImage && !createImageUrl)}
            sx={{ backgroundColor: 'primary.main', '&:hover': { backgroundColor: 'primary.dark' } }}
          >
            {creating ? 'יוצר…' : 'יצירת סבב'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Paid extra-round purchase */}
      <ResponsiveDialog open={!!purchase} onClose={() => !buying && setPurchase(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>סבב נוסף</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1.5 }}>
            כל הסבבים הכלולים בחבילה שלכם נוצלו. אפשר להוסיף סבב נוסף בתשלום חד-פעמי.
          </Typography>
          {purchase && (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1.6rem', color: 'primary.main' }}>₪{purchase.price}</Typography>
              <Typography variant="body2" color="text.secondary">· {purchase.band}</Typography>
            </Box>
          )}
          {purchase && (
            <Typography variant="caption" color="text.secondary">
              המחיר נקבע לפי מספר הנמענים בסבב ({purchase.recipients}). לאחר התשלום הסבב ייווצר וניתן יהיה לתזמן ולשלוח.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPurchase(null)} disabled={buying}>ביטול</Button>
          <Button
            variant="contained"
            onClick={startExtraRoundPurchase}
            disabled={buying}
            sx={{ backgroundColor: 'primary.main', '&:hover': { backgroundColor: 'primary.dark' } }}
          >
            {buying ? 'מעבר לתשלום…' : 'המשך לתשלום'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
      />
    </Box>
  );
}

export default Messages;
