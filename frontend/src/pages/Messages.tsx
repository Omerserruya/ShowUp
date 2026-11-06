import React, { useState, useEffect, useCallback, useRef } from 'react';
import { featureFlags } from '../config/featureFlags';
import Toast from '../components/Toast';
import ResponsiveDialog from '../components/ResponsiveDialog';
import { fireConfetti, fireConfettiOnce } from '../utils/confetti';
import {
  Box,
  Typography,
  Paper,
  Button,
  Drawer,
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
  Skeleton,
  LinearProgress,
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
  CheckCircle as CheckCircleIcon,
  Visibility as VisibilityIcon,
  Reply as ReplyIcon,
  ErrorOutline as ErrorOutlineIcon,
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
  Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useEvent } from '../contexts/EventContext';
import { useUser } from '../contexts/UserContext';
import { saveOrderToken, orderAuthHeaders } from '../utils/orderToken';
import { useCampaigns, useOverviewStats } from '../hooks/useOverviewData';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useCatalog, isSendableFor } from '../hooks/useCatalog';
import type { MessagingCatalog, CatalogTemplate } from '../hooks/useCatalog';
import { renderBody, buildPreviewValues, buildEventValues, parseLocation } from '../config/messaging';
import type { PreviewCtx } from '../config/messaging';
import CallRoundRow, { type CallRound } from '../components/v6/CallRoundRow';

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
  invitation: 'אישור הגעה ראשוני',
  reminder: 'אישור הגעה נוסף',
  final_reminder: 'תזכורת לאירוע',
  table_assignment: 'הודעת שולחן',
  thank_you: 'תודה אחרי האירוע',
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

/**
 * One template in the new-round gallery: a real (truncated) render of the
 * message, not just its name. Seeing the copy is the whole point - a list of
 * titles told the owner nothing about what their guests would receive.
 */
function TemplateCard({
  template, variables, selected, disabled, disabledReason, onSelect,
}: {
  template: CatalogTemplate;
  variables: Record<string, string>;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: () => void;
}) {
  const body = renderBody(template.body, variables).replace(/\n{2,}/g, '\n');
  const hasImage = template.preview?.header === 'image';
  return (
    <Box
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(); }
      }}
      sx={{
        position: 'relative',
        border: '1.5px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: 2,
        p: 1.5,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        bgcolor: (t) => (selected ? alpha(t.palette.primary.main, 0.06) : 'background.paper'),
        transition: 'border-color .15s ease, background-color .15s ease',
        '&:hover': disabled ? undefined : { borderColor: 'primary.main' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'text.primary', flex: 1, minWidth: 0 }} noWrap>
          {template.title}
        </Typography>
        {hasImage && <ImageIcon sx={{ fontSize: 15, color: 'text.secondary' }} />}
        {selected && <CheckCircleIcon sx={{ fontSize: 17, color: 'primary.main' }} />}
      </Stack>
      <Typography
        sx={{
          fontSize: 11.5, lineHeight: 1.55, color: 'text.secondary', whiteSpace: 'pre-wrap',
          display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
      >
        {body}
      </Typography>
      <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
        {template.is_default && (
          <Chip label="מומלץ" size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }} color="primary" variant="outlined" />
        )}
        {template.description && (
          <Chip label={template.description} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem', maxWidth: '100%' }} />
        )}
      </Stack>
      {disabled && disabledReason && (
        <Typography sx={{ mt: 0.75, fontSize: 10.5, color: 'text.disabled', fontWeight: 600 }}>
          {disabledReason}
        </Typography>
      )}
    </Box>
  );
}

// Campaign status types from API (normalized)
//   draft   - saved, never auto-sends (no time / waiting for the host)
//   failed  - the worker gave up (see statusReason)
//   empty   - finalized as 'sent' but reached nobody (empty audience)
//   sending - processing / sending right now
type CampaignStatus = 'sent' | 'pending' | 'paused' | 'scheduled' | 'draft' | 'failed' | 'empty' | 'sending';

// Hebrew explanation for a worker/scheduler status_reason (free text or code).
// Order matters: the first match wins.
const REASON_TEXT: Array<[RegExp, string]> = [
  [/no_guests|no_recipients|empty audience/i, 'אין מוזמנים ברשימה שמתאימים לסבב'],
  [/capacity_unplaced|capacity|unplaced/i, 'לא נכנס למכסת השליחה היומית'],
  [/invalid_template|template_invalid|did not resolve|template/i, 'התבנית לא תקינה או עדיין לא אושרה לשליחה'],
  [/event_passed|event date has passed/i, 'מועד האירוע כבר עבר'],
  [/event_inactive|event inactive/i, 'האירוע עדיין לא פעיל'],
  [/event not found|event_not_found/i, 'האירוע לא נמצא'],
  [/image/i, 'חסרה תמונה להודעה'],
  [/audience selection failed|audience/i, 'שגיאה בבחירת קהל היעד'],
  [/processing failed|stuck in processing|never completed|requeued/i, 'תקלה טכנית בשליחה - אפשר לנסות שוב'],
];

function reasonText(reason?: string | null): string | null {
  if (!reason) return null;
  const hit = REASON_TEXT.find(([re]) => re.test(reason));
  return hit ? hit[1] : null;
}

// Error body of a refused campaign PUT -> a Hebrew message for the toast.
async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const d = body?.detail;
    if (d && typeof d === 'object' && typeof d.message === 'string') return d.message;
    if (typeof d === 'string' && /[\u0590-\u05FF]/.test(d)) return d;
  } catch {
    // non-JSON body
  }
  return fallback;
}

interface CampaignFromAPI {
  id: string;
  name: string;
  template: string;
  status: string;
  schedule_time: string | null;
  channel: string;
  created_at: string;
  updated_at: string;
  status_reason?: string | null;
  // Optional fields that may contain recipients info
  recipient_count?: number;
  recipients?: any[];
  header_image_url?: string | null;
  // The round's category - it alone decides who receives it.
  category_id?: string | null;
  // Delivery + engagement funnel, embedded in every campaign response.
  stats?: {
    sent_count: number;
    delivered_count: number;
    read_count: number;
    replied_count: number;
    failed_count: number;
    queued_count: number;
    attempted_count: number;
  };
}

/** A round category (admin-managed): its audience decides who a round reaches. */
interface RoundCategory {
  id: string;
  base_stage: string;
  title: string;
  description: string;
  builtin: boolean;
  audience: string;
  audience_label: string;
  recipients: number;
}

interface Campaign {
  id: string;
  name: string;
  template: string;
  categoryId: string | null;
  status: CampaignStatus;
  /** Raw backend status_reason (why it is a draft / failed / empty). */
  statusReason: string | null;
  scheduleTime: Date | null;
  channel: 'whatsapp' | 'email';
  /**
   * Number of recipients the campaign was actually sent to.
   * Prefer campaign-specific data from the API; fallback to a general estimate when not available.
   */
  recipientCount: number;
  /**
   * The funnel the owner asks about, straight from the campaign payload:
   * how many RECEIVED it, how many SAW it, how many ANSWERED. Always defined
   * (zeros before a round sends), so the UI never has an "unknown" state -
   * `hasSendStats` below distinguishes "nothing sent yet" from "nobody read it".
   */
  sentCount: number;      // accepted by Meta
  deliveredCount: number; // reached the device
  readCount: number;      // opened (undercounts when read receipts are off)
  repliedCount: number;   // answered the round
  failedCount: number;
  queuedCount: number;
  attemptedCount: number;
  /** Header image of an image template (uploaded when the round was set up). */
  headerImageUrl: string | null;
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

function MsgPreview({ catalog, campaign, variables, full = false }: { catalog: MessagingCatalog; campaign: Campaign; variables: Record<string, string>; full?: boolean }) {
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
      {/* Collapsed: cropped + faded. Selected (full): the whole message, as the guest sees it. */}
      <Box sx={{ position: 'relative', zIndex: 1, borderRadius: 2.5, bgcolor: '#ece5dd', p: 1, maxHeight: full ? 'none' : 120, overflow: 'hidden', direction: 'rtl', textAlign: 'right', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', ...(full ? {} : { maskImage: 'linear-gradient(180deg,#000 66%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 66%,transparent)' }) }}>
        <Box sx={{ bgcolor: '#fff', borderRadius: '7.5px', p: 1, boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)' }}>
          {campaign.headerImageUrl && (
            <Box component="img" src={campaign.headerImageUrl} alt="" sx={{ display: 'block', width: '100%', height: full ? 'auto' : 64, maxHeight: 260, objectFit: 'cover', borderRadius: '5px', mb: 0.75 }} />
          )}
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
  const { selectedEvent } = useEvent();
  // Previews show the copy guests of THIS event type really get.
  const { catalog } = useCatalog((selectedEvent?.type as string) || 'wedding');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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
  // The "סבב חדש" drawer doubles as the round editor: set => editing that round.
  const [editId, setEditId] = useState<string | null>(null);
  const [createStage, setCreateStage] = useState('');
  const [createName, setCreateName] = useState('');
  const [createTemplateId, setCreateTemplateId] = useState('');
  const [createCategory, setCreateCategory] = useState('');
  const [roundCats, setRoundCats] = useState<RoundCategory[]>([]);
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
    // Every backend status maps to its own UI state - a failed or draft round
    // must never read as sent/scheduled.
    const raw = (apiCampaign.status || '').toLowerCase();
    const reason = apiCampaign.status_reason || null;
    let status: CampaignStatus = 'pending';
    if (raw === 'sent') {
      const reachedNobody = /empty audience|no_guests|no_recipients/i.test(reason || '')
        && !(apiCampaign.stats?.attempted_count);
      status = reachedNobody ? 'empty' : 'sent';
    } else if (raw === 'processing' || raw === 'sending') {
      status = 'sending';
    } else if (raw === 'failed') {
      status = 'failed';
    } else if (raw === 'draft') {
      status = 'draft';
    } else if (raw === 'paused') {
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

    const st = apiCampaign.stats ?? ({} as NonNullable<CampaignFromAPI['stats']>);

    return {
      id: apiCampaign.id,
      name: apiCampaign.name,
      template: apiCampaign.template,
      categoryId: apiCampaign.category_id || null,
      status,
      statusReason: reason,
      scheduleTime: apiCampaign.schedule_time ? new Date(apiCampaign.schedule_time) : null,
      channel: apiCampaign.channel as 'whatsapp' | 'email',
      recipientCount: specificRecipientCount,
      // Stats ride along with the campaign - no second request, and present for
      // every campaign whatever its status (scheduled, sending, sent, failed).
      sentCount: st.sent_count ?? 0,
      deliveredCount: st.delivered_count ?? 0,
      readCount: st.read_count ?? 0,
      repliedCount: st.replied_count ?? 0,
      failedCount: st.failed_count ?? 0,
      queuedCount: st.queued_count ?? 0,
      attemptedCount: st.attempted_count ?? 0,
      headerImageUrl: apiCampaign.header_image_url || null,
    };
  };

  // Map API campaigns to local format. Delivery stats arrive embedded in the
  // list response, so there is no per-campaign follow-up request to make.
  useEffect(() => {
    if (!apiCampaigns || apiCampaigns.length === 0) {
      setCampaigns([]);
      return;
    }

    setCampaigns(apiCampaigns.map(mapApiCampaign));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiCampaigns, stats?.total_guests]);

  // Round categories with their audience size in this event (core /campaigns/categories).
  const loadRoundCats = useCallback(async () => {
    if (!selectedEvent?.id) { setRoundCats([]); return; }
    try {
      const r = await fetchWithAuth(`/api/campaigns/categories?event_id=${selectedEvent.id}`);
      setRoundCats(r.ok ? await r.json() : []);
    } catch { setRoundCats([]); }
  }, [selectedEvent?.id]);
  useEffect(() => { loadRoundCats(); }, [loadRoundCats]);

  // Phone-call rounds (voice-service, through core). Planned automatically from
  // the event date; shown on the same timeline as the message rounds.
  type CallData = { rounds_allowed: number; rounds_used: number; can_schedule: boolean; pending_guests: number; rounds: CallRound[] };
  const [calls, setCalls] = useState<CallData | null>(null);
  const [addingCall, setAddingCall] = useState(false);
  const [newCallAt, setNewCallAt] = useState('');
  const [callErr, setCallErr] = useState<string | null>(null);
  const loadCalls = useCallback(async () => {
    if (!selectedEvent?.id) { setCalls(null); return; }
    try {
      const r = await fetchWithAuth(`/api/events/${selectedEvent.id}/call-rounds`);
      setCalls(r.ok ? await r.json() : null);
    } catch { setCalls(null); }
  }, [selectedEvent?.id]);
  useEffect(() => { loadCalls(); }, [loadCalls]);
  const callError = async (r: Response): Promise<string | null> => {
    if (r.ok) return null;
    const code = (await r.json().catch(() => ({})))?.detail?.error;
    return code === 'in_past' ? 'המועד כבר עבר. בחרו מועד עתידי.'
      : code === 'after_event' ? 'המועד צריך להיות לפני האירוע.'
      : code === 'already_started' ? 'הסבב כבר התחיל, אי אפשר להזיז אותו.'
      : code === 'no_phone_rounds_left' ? 'נוצלו כל סבבי השיחות שבחבילה.'
      : 'הפעולה לא הצליחה. נסו שוב.';
  };
  const moveCallRound = async (id: string, startAt: string) => {
    const r = await fetchWithAuth(`/api/events/${selectedEvent?.id}/call-rounds/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_at: startAt }) });
    const e = await callError(r); if (!e) loadCalls(); return e;
  };
  const cancelCallRound = async (id: string) => {
    const r = await fetchWithAuth(`/api/events/${selectedEvent?.id}/call-rounds/${id}/cancel`, { method: 'POST' });
    const e = await callError(r); if (!e) loadCalls(); return e;
  };
  const addCallRound = async () => {
    if (!newCallAt) return;
    setCallErr(null);
    const r = await fetchWithAuth(`/api/events/${selectedEvent?.id}/call-rounds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_at: new Date(newCallAt).toISOString() }) });
    const e = await callError(r);
    if (e) { setCallErr(e); return; }
    setAddingCall(false); setNewCallAt(''); loadCalls();
  };

  // Reload the list (and with it every campaign's funnel) from the server.
  const refreshCampaigns = useCallback(async () => {
    if (!selectedEvent?.id) return;
    try {
      const res = await fetchWithAuth(`/api/campaigns?event_id=${selectedEvent.id}&order_by=schedule_time&page_size=100`);
      if (!res.ok) return;
      const data: CampaignFromAPI[] = await res.json();
      setCampaigns(data.map(mapApiCampaign));
    } catch {
      // A failed background refresh just leaves the previous numbers on screen.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id, stats?.total_guests]);

  // Delivery, read and reply counts arrive later than the send itself - they are
  // written by webhooks minutes or hours afterwards. Without this the page would
  // show whatever was true when it loaded and quietly go stale, so a round that
  // is still landing refreshes itself. Only while the tab is visible, and only
  // while something can still change: messages in flight, or a round sent in the
  // last 24h that can still collect reads and replies.
  const liveCampaign = campaigns.some(
    (c) =>
      c.status === 'sending' ||
      // just sent-now / due within minutes: poll so the state flips on screen
      (c.status === 'scheduled' && c.scheduleTime != null &&
        Math.abs(new Date(c.scheduleTime).getTime() - Date.now()) < 15 * 60 * 1000) ||
      c.queuedCount > 0 ||
      (c.attemptedCount > 0 &&
        c.scheduleTime != null &&
        Date.now() - new Date(c.scheduleTime).getTime() < 24 * 60 * 60 * 1000),
  );

  useEffect(() => {
    if (!liveCampaign) return;
    const tick = () => {
      if (document.visibilityState === 'visible') refreshCampaigns();
    };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [liveCampaign, refreshCampaigns]);

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
        return 'לא מתוזמנת';
      case 'draft':
        return 'טיוטה';
      case 'failed':
        return 'נכשל';
      case 'empty':
        return 'לא נשלח';
      case 'sending':
        return 'יוצא עכשיו';
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
        return { bg: alpha(theme.palette.warning.main, 0.1), color: theme.palette.warning.dark };
      case 'draft':
      case 'empty':
        return { bg: alpha(theme.palette.warning.main, 0.12), color: theme.palette.warning.dark };
      case 'failed':
        return { bg: alpha(theme.palette.error.main, 0.1), color: theme.palette.error.main };
      case 'sending':
        return { bg: alpha(theme.palette.success.main, 0.1), color: theme.palette.success.dark };
      default:
        return { bg: alpha(theme.palette.text.disabled, 0.1), color: theme.palette.text.disabled };
    }
  };


  // One sentence explaining a state the owner must act on (null = nothing to say).
  const getStatusExplanation = (campaign: Campaign): string | null => {
    const why = reasonText(campaign.statusReason);
    switch (campaign.status) {
      case 'draft':
        return `${why ? `${why} · ` : ''}הסבב שמור כטיוטה ולא יישלח אוטומטית - שלחו עכשיו או קבעו מועד.`;
      case 'failed':
        return `השליחה נכשלה: ${why || 'שגיאה לא ידועה'}`;
      case 'empty':
        return `הסבב לא יצא לאף אחד: ${why || 'אין מוזמנים ברשימה'}`;
      case 'pending':
        return 'אין מועד שליחה - הסבב לא יישלח עד שתקבעו מועד.';
      default:
        return null;
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

  // The gallery renders ~20 template previews at once, so rebuild these only
  // when the catalog or the event changes - not once per card, per keystroke.
  const previewVariables = React.useMemo(
    () => buildPreviewValues(catalog, eventCtx()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, selectedEvent?.id, selectedEvent?.name, selectedEvent?.date, selectedEvent?.location],
  );

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
    if (filterStatus === 'draft') return campaign.status === 'draft' || campaign.status === 'pending';
    if (filterStatus === 'failed') return campaign.status === 'failed' || campaign.status === 'empty';
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
    // `send_now` lets the SERVER stamp the send instant, move a draft / paused
    // round to 'pending' (the scheduler only claims pending rows), retry a round
    // that failed before sending anything, and refuse an empty audience.
    setUpdating(sendNowCampaign.id);
    try {
      const response = await fetchWithAuth(`/api/campaigns/${sendNowCampaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send_now: true }),
      });
      if (!response.ok) {
        showToast(await apiErrorMessage(response, 'שגיאה בשליחת הסבב'), 'error');
        return;
      }
      const sendAt = new Date();
      setCampaigns(prev => prev.map(c =>
        c.id === sendNowCampaign.id
          ? { ...c, scheduleTime: sendAt, status: 'scheduled' as CampaignStatus, statusReason: null }
          : c
      ));
      setSendNowDialogOpen(false);
      setSendNowCampaign(null);
      // Celebrate the first campaign ever sent; fire a normal burst on later sends.
      if (!fireConfettiOnce('first_campaign_sent')) {
        fireConfetti();
      }
      showToast('הסבב בדרך! ההודעות יוצאות בדקות הקרובות', 'success');
      refreshCampaigns();
    } catch (error) {
      console.error('Error sending campaign:', error);
      showToast('שגיאה בשליחת הסבב', 'error');
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
      // Picking a time IS the owner's approval: a draft / paused / unscheduled
      // round must become 'pending' or the scheduler never claims it.
      if (['draft', 'paused', 'pending'].includes(editingCampaign.status) && editedTime) {
        updateData.status = 'pending';
      }

      const response = await fetchWithAuth(`/api/campaigns/${editingCampaign.id}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        showToast(await apiErrorMessage(response, 'שגיאה בעדכון מועד הסבב'), 'error');
        return;
      }

      await response.json();

      // Refresh campaigns list to get updated data - through the shared mapper,
      // so statuses stay normalized and the embedded stats come with it.
      const campaignsResponse = await fetchWithAuth(`/api/campaigns?event_id=${selectedEvent?.id}`);
      if (campaignsResponse.ok) {
        const campaignsData: CampaignFromAPI[] = await campaignsResponse.json();
        setCampaigns(campaignsData.map(mapApiCampaign));
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

  // Hebrew display name for a template's stage (used as the default round name).
  const stageTitle = (flowStage: string): string =>
    roundCats.find((c) => c.id === flowStage)?.title
    || catalog.stages.find((s) => s.id === flowStage)?.title || STAGE_LABELS[flowStage] || 'סבב חדש';

  // Categories a round of this stage may use (the built-in one first).
  const categoriesForStage = (stageId: string): RoundCategory[] =>
    roundCats.filter((c) => c.base_stage === stageId).sort((a, b) => Number(b.builtin) - Number(a.builtin));
  const categoryOf = (id: string | null | undefined) => roundCats.find((c) => c.id === id);

  const eventType = (selectedEvent?.type as string) || 'wedding';

  // Templates the UI may offer for sending - never suggest one that can't be
  // delivered; the backend rejects those with a 400 anyway.
  //
  // Deliverability is per EVENT TYPE: Meta approves the `<key>__wedding` variant,
  // not the base template, so the catalog's global `sendable` flag is far too
  // pessimistic - it reported 6 usable templates for a wedding that really has
  // 17, which is why most of the catalog was invisible here.
  const sendableTemplates = catalog.templates.filter((t) => isSendableFor(t, eventType));

  // Stages in lifecycle order that have at least one deliverable template.
  const stagesForCreate = STAGE_ORDER.filter((sid) =>
    sendableTemplates.some((t) => t.flow_stage === sid),
  );

  // Deliverable templates belonging to a stage, recommended one first.
  const templatesForCreateStage = (stageId: string): CatalogTemplate[] =>
    sendableTemplates
      .filter((t) => t.flow_stage === stageId)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.title.localeCompare(b.title, 'he'));

  // Templates we must NOT offer, kept so the panel can say why they're missing
  // instead of silently showing a short list.
  const unavailableForStage = (stageId: string): CatalogTemplate[] =>
    catalog.templates.filter((t) => t.flow_stage === stageId && !isSendableFor(t, eventType));

  // Every stage that has any template at all - so a stage with nothing available
  // still appears, explaining itself rather than vanishing.
  const stagesForPanel = STAGE_ORDER.filter((sid) =>
    catalog.templates.some((t) => t.flow_stage === sid),
  );

  const createTemplateObj = catalog.templates.find((t) => t.id === createTemplateId);
  const createNeedsImage = createTemplateObj?.preview?.header === 'image';

  const applyCreateStage = (stageId: string) => {
    setCreateStage(stageId);
    const tpls = templatesForCreateStage(stageId);
    const tpl = tpls.find((t) => t.is_default) || tpls[0];
    setCreateTemplateId(tpl?.id || '');
    setCreateCategory(tpl?.category_id || stageId);
    setCreateName(stageTitle(stageId));
    setCreateImageUrl('');
  };

  // New-round creation ("סבב חדש")
  const openCreate = () => {
    setEditId(null);
    setCreateTime('');
    setCreateImageUrl('');
    const firstStage = stagesForCreate[0] || '';
    if (firstStage) applyCreateStage(firstStage);
    else { setCreateStage(''); setCreateTemplateId(''); setCreateName('סבב חדש'); }
    setCreateOpen(true);
  };

  const handleCreateTemplateChange = (templateId: string) => {
    setCreateTemplateId(templateId);
    // Editing keeps the round's own name and image; a new round starts fresh.
    if (!editId) setCreateImageUrl('');
    const tpl = catalog.templates.find((t) => t.id === templateId);
    if (tpl) {
      // The gallery selects a template directly, so the stage follows from it
      // rather than being picked first.
      setCreateStage(tpl.flow_stage);
      if (categoryOf(createCategory)?.base_stage !== tpl.flow_stage) setCreateCategory(tpl.category_id || tpl.flow_stage);
      if (!editId) setCreateName(stageTitle(tpl.flow_stage));
    }
  };

  // Open the drawer on an existing (not yet sent) round: full preview with its
  // image, and template / image / name / time all editable in one place.
  const openEdit = (campaign: Campaign) => {
    const tpl = commTemplate(catalog, campaign);
    setEditId(campaign.id);
    setCreateTemplateId(tpl?.id || campaign.template || '');
    setCreateStage(tpl?.flow_stage || '');
    setCreateCategory(campaign.categoryId || tpl?.flow_stage || '');
    setCreateName(campaign.name);
    setCreateImageUrl(campaign.headerImageUrl || '');
    const d = campaign.scheduleTime;
    const p2 = (n: number) => String(n).padStart(2, '0');
    setCreateTime(d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` : '');
    setCreateOpen(true);
  };

  const saveRoundEdit = async () => {
    if (!editId || !createTemplateId || !createName.trim()) return;
    if (createNeedsImage && !createImageUrl) {
      showToast('התבנית הזו כוללת תמונה - נא להעלות תמונה לפני השמירה.', 'error');
      return;
    }
    setCreating(true);
    try {
      const body: any = { name: createName.trim(), template: createTemplateId };
      if (createCategory) body.category_id = createCategory;
      if (createNeedsImage) body.header_image_url = createImageUrl;
      if (createTime) body.schedule_time = new Date(createTime).toISOString();
      const res = await fetchWithAuth(`/api/campaigns/${editId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(typeof err.detail === 'string' ? err.detail : 'update failed');
      }
      await refreshCampaigns();
      setCreateOpen(false);
      setEditId(null);
      showToast('הסבב עודכן', 'success');
    } catch (error: any) {
      showToast(error?.message && error.message !== 'update failed' ? error.message : 'שגיאה בעדכון הסבב. נסו שוב.', 'error');
    } finally {
      setCreating(false);
    }
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
      if (createCategory) body.category_id = createCategory;
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
        setCampaigns(data.map(mapApiCampaign));
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

  // Message rounds and phone rounds on one chronological line.
  type TimelineItem = { kind: 'msg'; at: number; campaign: Campaign } | { kind: 'call'; at: number; round: CallRound };
  const timelineItems: TimelineItem[] = [
    ...timelineCampaigns.map((c) => ({ kind: 'msg' as const, at: c.scheduleTime ? new Date(c.scheduleTime).getTime() : Number.POSITIVE_INFINITY, campaign: c })),
    ...(calls?.rounds || []).map((r) => ({ kind: 'call' as const, at: new Date(r.start_at).getTime(), round: r })),
  ].sort((a, b) => a.at - b.at);

  // Shared timeline action-button styles.
  // gap + RTL-correct icon spacing so the startIcon never overlaps the label.
  const tlBtnBase = { borderRadius: 1.5, px: 1.75, py: 0.6, fontSize: '0.8125rem', fontWeight: 600, textTransform: 'none' as const, gap: 0.5, '& .MuiButton-startIcon': { marginRight: 0, marginLeft: 0 } };
  const tlBtn = {
    primary: { ...tlBtnBase, bgcolor: '#C9B8F3', color: '#16150F', '&:hover': { bgcolor: '#BBA6EE' }, '&:disabled': { bgcolor: 'action.disabled', color: 'white' } },
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
  
  // A campaign has real numbers the moment Meta accepted its first message -
  // not only once the whole round finishes. That is what makes the funnel
  // available "at any moment", including mid-send.
  const hasSendStats = (campaign: Campaign): boolean => campaign.attemptedCount > 0;

  // Percentages are OF THE MESSAGES THAT ARRIVED, never of the planned audience:
  // dividing by an audience we failed to reach would flatter every rate.
  const rateOf = (part: number, whole: number): number =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;

  const getCampaignReadRate = (campaign: Campaign): number =>
    rateOf(campaign.readCount, campaign.deliveredCount || campaign.sentCount);

  const getCampaignReplyRate = (campaign: Campaign): number =>
    rateOf(campaign.repliedCount, campaign.deliveredCount || campaign.sentCount);

  // Summary-strip metrics.
  const sentList = campaigns.filter(c => c.status === 'sent');
  const completed = sentList.length;
  const journeyPct = totalCampaigns > 0 ? Math.round((completed / totalCampaigns) * 100) : 0;
  // Average only over rounds that actually have measurements - a round with no
  // delivery data yet would otherwise drag the average toward zero.
  const measured = campaigns.filter(hasSendStats);
  const avgReadRate = measured.length ? Math.round(measured.reduce((a, c) => a + getCampaignReadRate(c), 0) / measured.length) : 0;
  const totalGuests = (stats?.total && stats.total > 0) ? stats.total : Math.max(0, ...campaigns.map(c => c.recipientCount || 0));
  // Count only confirmed deliveries; planned recipients are not "reached".
  const guestsReached = Math.max(0, ...measured.map(c => c.deliveredCount));
  // Only claim measured analytics when at least one round has real delivery
  // stats - otherwise the strip must show "-", not a fake 0.
  const hasAnyDeliveryStats = measured.length > 0;

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
      {/* Page masthead - title on the reading side, the one action on the other */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2} sx={{ mb: { xs: 3, md: 4 } }}>
        <Box>
          {/* The page title lives in the app header (design v6). */}
          <Typography sx={{ fontSize: { xs: '0.95rem', md: '1.05rem' }, color: 'text.secondary', maxWidth: '60ch' }}>
            כל סבב יוצא לפי לוח השליחה. לחצו על סבב כדי לראות את ההודעה המלאה, לערוך, לעצור או לשלוח עכשיו.
          </Typography>
        </Box>
        <Button
          startIcon={<PlusIcon sx={{ fontSize: 18 }} />}
          variant="contained"
          disableElevation
          onClick={openCreate}
          sx={{ borderRadius: 999, px: 2.25, py: 0.8, fontWeight: 700, fontSize: '0.9rem', textTransform: 'none', boxShadow: 'none', bgcolor: '#C9B8F3', color: '#16150F', gap: 0.5, mt: { md: 0.5 }, '& .MuiButton-startIcon': { marginRight: 0, marginLeft: 0 }, '&:hover': { bgcolor: '#BBA6EE', boxShadow: 'none' } }}
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
      {calls && calls.rounds_allowed > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 3, px: 2, py: 1.25, borderRadius: 2, bgcolor: alpha(primary, 0.06), border: '1px solid', borderColor: alpha(primary, 0.18) }}>
          <Typography sx={{ fontSize: 13.5, color: 'text.primary', flex: '1 1 260px' }}>
            <b>שיחות טלפון:</b> {calls.rounds_used} מתוך {calls.rounds_allowed} סבבים בשימוש. מי שלא ענה בוואטסאפ, או ענה "אולי", מקבל שיחה קצרה ועונה בלחיצה על מקש.
          </Typography>
          {calls.can_schedule && !addingCall && (
            <Button size="small" onClick={() => setAddingCall(true)} startIcon={<PlusIcon sx={{ fontSize: 16 }} />} sx={{ borderRadius: 999, px: 1.75, fontWeight: 600, textTransform: 'none', bgcolor: '#FFFFFF', border: '1px solid', borderColor: alpha(primary, 0.3), color: 'primary.main', gap: 0.5, '& .MuiButton-startIcon': { marginRight: 0, marginLeft: 0 } }}>סבב שיחות</Button>
          )}
          {addingCall && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <TextField type="datetime-local" size="small" value={newCallAt} onChange={(e) => setNewCallAt(e.target.value)} inputProps={{ 'aria-label': 'מועד סבב השיחות' }} />
              <Button size="small" disabled={!newCallAt} onClick={addCallRound} sx={{ borderRadius: 1.5, px: 1.75, fontWeight: 600, textTransform: 'none', bgcolor: '#C9B8F3', color: '#16150F', '&:hover': { bgcolor: '#BBA6EE' } }}>הוספה</Button>
              <Button size="small" onClick={() => { setAddingCall(false); setCallErr(null); }} sx={{ textTransform: 'none', color: 'text.secondary' }}>ביטול</Button>
            </Stack>
          )}
          {callErr && <Typography role="alert" sx={{ fontSize: 12.5, color: 'error.main', width: '100%' }}>{callErr}</Typography>}
        </Box>
      )}

      {timelineItems.length === 0 ? (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', py: 4 }}>
          <Box sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(primary, 0.1), color: 'primary.main' }}>
            <SparklesIcon />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', mb: 0.5 }}>מסע התקשורת שלכם מתחיל כאן</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>צרו את הסבב הראשון ואנחנו נלווה את האורחים באופן אוטומטי לאורך כל הדרך.</Typography>
            <Button startIcon={<PlusIcon sx={{ fontSize: 18 }} />} variant="contained" disableElevation onClick={openCreate} sx={{ borderRadius: 1.5, px: 2.25, py: 0.75, fontWeight: 600, textTransform: 'none', boxShadow: 'none', bgcolor: '#C9B8F3', color: '#16150F', gap: 0.5, '& .MuiButton-startIcon': { marginRight: 0, marginLeft: 0 }, '&:hover': { bgcolor: '#BBA6EE' } }}>צרו סבב ראשון</Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ position: 'relative' }}>
          {timelineItems.map((item, i) => {
            if (item.kind === 'call') {
              return (
                <CallRoundRow key={`call-${item.round.id}`} round={item.round} pendingGuests={calls?.pending_guests || 0}
                  isLast={i === timelineItems.length - 1} onMove={moveCallRound} onCancel={cancelCallRound} />
              );
            }
            const campaign = item.campaign;
            const active = (hoveredId ?? selectedId) === campaign.id;
            const selected = selectedId === campaign.id;
            // "Done" rounds take no actions. A failed / empty round stays
            // actionable (retry) - the server refuses if anything already went out.
            const isSent = campaign.status === 'sent' || campaign.status === 'sending';
            const isPaused = campaign.status === 'paused';
            const isFinishedUnsent = campaign.status === 'failed' || campaign.status === 'empty';
            const explanation = getStatusExplanation(campaign);
            const isLoading = updating === campaign.id;
            const isLast = i === timelineItems.length - 1;
            const dt = campaign.scheduleTime ? new Date(campaign.scheduleTime) : null;
            const sc = getStatusColor(campaign);
            const readRate = getCampaignReadRate(campaign);
            const replyRate = getCampaignReplyRate(campaign);
            // Only claim delivery numbers once messages actually went out; the
            // planned recipient count must not masquerade as confirmed delivery.
            const hasDeliveryStats = hasSendStats(campaign);
            const delivered = campaign.deliveredCount;
            const read = campaign.readCount;
            const replied = campaign.repliedCount;
            const failed = campaign.failedCount;
            const inFlight = campaign.queuedCount;
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
                      {isFinishedUnsent ? null : isPaused ? (
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
                  {explanation && (
                    <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: sc.color, mb: 0.75, lineHeight: 1.5 }}>
                      {explanation}
                    </Typography>
                  )}

                  {hasDeliveryStats ? (
                    // The three numbers the owner asks about, always in the same
                    // order: received -> saw -> answered.
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 1.25 }}>
                      <Stat icon={<CheckCircleIcon sx={{ fontSize: 15, color: 'success.main' }} />} text={`${delivered} קיבלו`} />
                      <Stat icon={<VisibilityIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={`${read} ראו (${readRate}%)`} />
                      <Stat icon={<ReplyIcon sx={{ fontSize: 15, color: primary }} />} text={`${replied} ענו (${replyRate}%)`} />
                      {inFlight > 0 && <Stat icon={<ClockIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={`${inFlight} בשליחה`} />}
                      {failed > 0 && <Stat icon={<ErrorOutlineIcon sx={{ fontSize: 15, color: 'error.main' }} />} text={`${failed} נכשלו`} />}
                    </Stack>
                  ) : isSent ? (
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 1.25 }}>
                      <Stat icon={<CheckCircleIcon sx={{ fontSize: 15, color: 'success.main' }} />} text={`${campaign.recipientCount} נמענים מתוכננים`} />
                      <Stat icon={<ClockIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text="נתוני מסירה יתעדכנו בקרוב" />
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 1.25 }}>
                      <Stat icon={<PeopleIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={`${campaign.recipientCount} נמענים${categoryOf(campaign.categoryId) ? ` · ${categoryOf(campaign.categoryId)!.audience_label}` : ''}`} />
                      <Stat icon={<ClockIcon sx={{ fontSize: 15, color: 'text.secondary' }} />} text={dt ? dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : 'לא מתוזמן'} />
                    </Stack>
                  )}

                  {hasDeliveryStats && delivered > 0 && (
                    // Funnel bar: the full track is everyone who RECEIVED it, the
                    // pale band is who SAW it, the solid band on top is who
                    // ANSWERED. Both bands start from the same edge because they
                    // are overlapping groups, not consecutive stages - someone
                    // with read receipts off answers without ever being "read".
                    <Box sx={{ position: 'relative', maxWidth: 340, height: 5, borderRadius: 99, bgcolor: alpha(theme.palette.divider, 0.7), overflow: 'hidden', mb: 1.25 }}>
                      <Box sx={{ position: 'absolute', inset: 0, width: `${readRate}%`, bgcolor: alpha(primary, 0.35), borderRadius: 99, transition: 'width .6s ease' }} />
                      <Box sx={{ position: 'absolute', inset: 0, width: `${replyRate}%`, bgcolor: primary, borderRadius: 99, transition: 'width .6s ease' }} />
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
                    <MsgPreview catalog={catalog} campaign={campaign} variables={getTemplateVariables()} full={selected} />
                  )}

                  {/* Reselect / customise the message inline (like the wizard) */}
                  {selected && !isSent && customFor !== campaign.id && (
                    <Stack direction="row" spacing={0.5} alignItems="center" onClick={(e) => e.stopPropagation()} sx={{ mt: 1, maxWidth: 360 }}>
                      <IconButton size="small" onClick={() => goTemplate(1)} disabled={tplList.length < 2} sx={{ color: 'text.secondary' }}><ChevronRightIcon fontSize="small" /></IconButton>
                      <Typography variant="caption" sx={{ flex: 1, textAlign: 'center', color: 'text.secondary', fontWeight: 600 }} noWrap>
                        {isCustomMsg ? 'הודעה מותאמת אישית' : `${tplList[curTplIdx]?.title || 'תבנית'}${tplList.length > 1 ? ` · ${curTplIdx + 1}/${tplList.length}` : ''}`}
                      </Typography>
                      <IconButton size="small" onClick={() => goTemplate(-1)} disabled={tplList.length < 2} sx={{ color: 'text.secondary' }}><ChevronLeftIcon fontSize="small" /></IconButton>
                      {/* Free-text rounds are rejected by Meta (no 24h window) and by core. */}
                      {featureFlags.customMessages && <Button onClick={() => openCustom(campaign)} startIcon={<EditIcon sx={{ fontSize: 15 }} />} sx={{ ...tlBtn.neutral, flexShrink: 0 }}>מותאם</Button>}
                    </Stack>
                  )}

                  {/* Primary actions */}
                  {selected && !isSent && customFor !== campaign.id && (
                    <Stack direction="row" spacing={1} onClick={(e) => e.stopPropagation()} sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                      <Button onClick={() => openEdit(campaign)} disabled={isLoading} startIcon={<EditIcon sx={{ fontSize: 16 }} />} sx={tlBtn.neutral}>עריכה</Button>
                      <Button onClick={() => handleSendNow(campaign)} disabled={isLoading} startIcon={<SendIcon sx={{ fontSize: 16 }} />} sx={tlBtn.primary}>{isFinishedUnsent ? 'ניסיון חוזר עכשיו' : 'שליחה עכשיו'}</Button>
                      {!isFinishedUnsent && (
                        <Button onClick={() => handleEditTime(campaign)} disabled={isLoading} startIcon={<AccessTimeIcon sx={{ fontSize: 16 }} />} sx={tlBtn.neutral}>{campaign.scheduleTime && campaign.status !== 'draft' ? 'שינוי מועד' : 'תזמון'}</Button>
                      )}
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
            {(editingCampaign?.status === 'paused' || editingCampaign?.status === 'draft') && (
              <Alert severity="info">
                {editingCampaign?.status === 'paused' ? 'הסבב מושהה' : 'הסבב שמור כטיוטה'} - שמירת המועד תפעיל אותו והוא יישלח במועד שבחרתם.
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
            sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600, px: 2.5, bgcolor: '#C9B8F3', color: '#16150F', '&:hover': { bgcolor: '#BBA6EE' } }}
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
            {sendNowCampaign && sendNowCampaign.recipientCount === 0 ? (
              <Alert severity="warning">
                אין כרגע מוזמנים שמתאימים לסבב הזה - הוסיפו מוזמנים לרשימה לפני השליחה.
              </Alert>
            ) : (
              <Alert severity="info">
                הסבב יוצא לדרך עכשיו, וההודעות יישלחו בדקות הקרובות.
              </Alert>
            )}
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
                  ההודעה תישלח ל-<strong>{sendNowCampaign.recipientCount}</strong> מוזמנים.
              </Typography>
                {sendNowCampaign.scheduleTime && sendNowCampaign.status === 'scheduled' && (
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
            disabled={updating !== null || sendNowCampaign?.recipientCount === 0}
            sx={{
              backgroundColor: '#C9B8F3',
              color: '#16150F',
              '&:hover': {
                backgroundColor: '#BBA6EE',
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

      {/* New round creation - a side panel, not a modal.
          The old dialog hid the catalog behind two dropdowns and pushed the
          message preview below the fold, so the owner picked a round without
          ever seeing what their guests would receive. Here every template for
          this event type is on screen as a real (truncated) message, and the
          full preview is pinned alongside. */}
      <Drawer
        anchor="left"
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        PaperProps={{
          sx: {
            width: { xs: '100%', md: 'min(1000px, 94vw)' },
            direction: 'rtl',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{editId ? 'עריכת סבב' : 'סבב חדש'}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              בחרו תבנית - כך ההודעה תיראה לאורחים
            </Typography>
          </Box>
          <IconButton onClick={() => !creating && setCreateOpen(false)} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {/* Body: gallery (right, in RTL) + pinned preview and settings (left) */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            overflowY: { xs: 'auto', md: 'hidden' },
          }}
        >
          {/* Template gallery - the whole catalog for this event type, at once. */}
          <Box sx={{ flex: 1, minWidth: 0, overflowY: { md: 'auto' }, px: 2.5, py: 2 }}>
            {stagesForPanel.map((sid) => {
              const available = templatesForCreateStage(sid);
              const unavailable = unavailableForStage(sid);
              return (
                <Box key={sid} sx={{ mb: 3 }}>
                  <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1.25 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>
                      {stageTitle(sid)}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                      {available.length ? `${available.length} תבניות` : 'אין תבניות זמינות'}
                    </Typography>
                  </Stack>
                  {available.length === 0 && (
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
                      השלב הזה עדיין לא זמין לסוג האירוע שלכם.
                    </Typography>
                  )}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(215px, 1fr))' },
                      gap: 1.25,
                    }}
                  >
                    {available.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        variables={previewVariables}
                        selected={createTemplateId === t.id}
                        onSelect={() => handleCreateTemplateChange(t.id)}
                      />
                    ))}
                    {/* Shown, not hidden: "where are the rest?" is a fair question,
                        and a silent short list is what made the catalog feel broken. */}
                    {unavailable.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        variables={previewVariables}
                        selected={false}
                        disabled
                        disabledReason={t.lifecycle === 'draft' ? 'בהכנה' : 'טרם אושרה לסוג האירוע הזה'}
                      />
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Pinned preview + round settings */}
          <Box
            sx={{
              width: { xs: 'auto', md: 380 },
              flexShrink: 0,
              borderInlineStart: { md: '1px solid' },
              borderTop: { xs: '1px solid', md: 'none' },
              borderColor: 'divider',
              overflowY: { md: 'auto' },
              px: 2.5,
              py: 2,
              bgcolor: 'background.default',
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              כך ההודעה תיראה לאורחים
            </Typography>
            <Box sx={{ bgcolor: '#ece5dd', borderRadius: 2, p: 1.25, mb: 2.5, minHeight: 120 }}>
              {createTemplateObj ? (
                <WhatsAppBubble
                  template={createTemplateObj}
                  variables={previewVariables}
                  imageUrl={createImageUrl || undefined}
                />
              ) : (
                <Typography sx={{ fontSize: 12.5, color: 'rgba(0,0,0,0.55)', p: 1.5, textAlign: 'center' }}>
                  בחרו תבנית כדי לראות אותה כאן
                </Typography>
              )}
            </Box>

            <Stack spacing={2}>
              <TextField
                size="small"
                fullWidth
                label="שם הסבב"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />

              {/* The category decides who receives the round - shown, not editable. */}
              {createStage && categoriesForStage(createStage).length > 0 && (
                <Box>
                  {categoriesForStage(createStage).length > 1 && (
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label="קטגוריה"
                      value={createCategory}
                      onChange={(e) => setCreateCategory(e.target.value)}
                      SelectProps={{ native: true }}
                      sx={{ mb: 1 }}
                    >
                      {categoriesForStage(createStage).map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </TextField>
                  )}
                  {categoryOf(createCategory) && (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      נשלח ל: <b>{categoryOf(createCategory)!.audience_label}</b>
                      {' · '}{categoryOf(createCategory)!.recipients} אורחים כרגע
                    </Typography>
                  )}
                </Box>
              )}

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
                  <Button
                    variant="outlined"
                    size="small"
                    fullWidth
                    startIcon={<ImageIcon sx={{ fontSize: 18 }} />}
                    onClick={() => createImageInputRef.current?.click()}
                    disabled={uploadingImage}
                    sx={{ fontWeight: 600 }}
                  >
                    {uploadingImage ? 'מעלה…' : createImageUrl ? 'החלפת תמונה' : 'העלאת תמונה'}
                  </Button>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 0.75 }}
                    color={createImageUrl ? 'success.main' : 'text.secondary'}
                  >
                    {createImageUrl ? 'תמונה נבחרה ✓' : 'התבנית הזו כוללת תמונה בראש ההודעה - חובה להעלות אחת.'}
                  </Typography>
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
                helperText={editId ? 'שינוי המועד יחול כל עוד הסבב עוד לא נשלח.' : 'בלי מועד, הסבב יישמר כטיוטה ותוכלו לתזמן או לשלוח אותו מתי שתרצו.'}
              />
            </Stack>
          </Box>
        </Box>

        {/* Footer */}
        <Stack
          direction="row"
          spacing={1.5}
          justifyContent="flex-end"
          sx={{ px: 2.5, py: 1.75, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}
        >
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>ביטול</Button>
          <Button
            variant="contained"
            onClick={editId ? saveRoundEdit : confirmCreate}
            disabled={creating || !createName.trim() || !createTemplateId || (createNeedsImage && !createImageUrl)}
            sx={{ backgroundColor: '#C9B8F3', color: '#16150F', '&:hover': { backgroundColor: '#BBA6EE' } }}
          >
            {editId ? (creating ? 'שומר…' : 'שמירת שינויים') : (creating ? 'יוצר…' : 'יצירת סבב')}
          </Button>
        </Stack>
      </Drawer>


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
            sx={{ backgroundColor: '#C9B8F3', color: '#16150F', '&:hover': { backgroundColor: '#BBA6EE' } }}
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
