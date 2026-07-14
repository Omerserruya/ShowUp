import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Box,
  Button,
  Container,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
  Chip,
  Paper,
  Divider,
  MenuItem,
  IconButton,
  InputAdornment,
  Alert,
  Checkbox,
  CircularProgress,
  ClickAwayListener,
  ToggleButton,
  ToggleButtonGroup,
  Link,
  alpha,
} from '@mui/material';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { saveOrderToken, orderAuthHeaders } from '../utils/orderToken';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckIcon from '@mui/icons-material/Check';
import InventoryIcon from '@mui/icons-material/Inventory';
import EventIcon from '@mui/icons-material/Event';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DescriptionIcon from '@mui/icons-material/Description';
import VerifiedIcon from '@mui/icons-material/Verified';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import InfoIcon from '@mui/icons-material/Info';
import TuneIcon from '@mui/icons-material/Tune';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EditIcon from '@mui/icons-material/Edit';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTheme } from '@mui/material/styles';
import { plans, PlanTier } from '../config/plans';
import PriceTag from '../components/PriceTag';
import PriceSummary from '../components/PriceSummary';
import { fireConfetti } from '../utils/confetti';
import { CampaignSchedule } from '../config/campaigns';
import { buildAdaptiveTimeline } from '../config/scheduling';
import { israelTimeToISOUTC } from '../utils/israelTime';
// CampaignSchedule type is now imported from config/campaigns
import { useCatalog } from '../hooks/useCatalog';
import type { MessagingCatalog } from '../hooks/useCatalog';
import {
  BRIT_SECRET_INVITE_LINE,
  CONTENT_BLOCKS,
  renderBody,
  variableGroups,
  buildPreviewValues,
  templatesForStage,
  defaultTemplate,
  eventTypeLabel,
} from '../config/messaging';
import CustomMessageEditor from '../components/CustomMessageEditor';
import { useUser } from '../contexts/UserContext';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';
import PersonIcon from '@mui/icons-material/Person';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import { usePlacesAutocomplete } from '../hooks/usePlacesAutocomplete';
import { saveWizardDraft, loadWizardDraft, clearWizardDraft, draftHasProgress, WizardDraft } from '../utils/wizardDraft';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';

/** The minimal shape the WhatsApp preview bubble needs - a catalog template or a
 * custom message both satisfy it, so preview and delivery share one definition. */
interface PreviewMsg { id: string; title: string; body: string; }

interface Inviter {
  fn: string; // first name
  ln: string; // last name
}

interface LocationData {
  name: string;
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

interface EventDetails {
  name: string;
  description: string;
  type: string;
  date: Dayjs | null;
  time: string;
  location: LocationData | null;
  inviters: Inviter[];
}

// Helper function removed - campaigns come from config via getCampaignsForPlan

// Preview variable values - derived from the ONE catalog (samples overridden by
// real event details). Keyed by canonical names + legacy tokens, so previews use
// the same values the worker resolves at send time.
const getTemplateVariables = (
  catalog: MessagingCatalog,
  eventDetails: EventDetails,
  inviters: Inviter[],
  subjects?: EventSubjects,
): Record<string, string> => {
  const inviterName = inviters.length > 0 && (inviters[0].fn || inviters[0].ln)
    ? `${inviters[0].fn} ${inviters[0].ln}`.trim()
    : 'המזמינים';
  const brideName = subjects
    ? (subjects.role1 === 'bride' ? subjects.p1 : subjects.role2 === 'bride' ? subjects.p2 : subjects.p1)
    : '';
  const groomName = subjects
    ? (subjects.role1 === 'groom' ? subjects.p1 : subjects.role2 === 'groom' ? subjects.p2 : subjects.p2)
    : '';
  return buildPreviewValues(catalog, {
    eventName: eventDetails.name || 'האירוע שלנו',
    eventDate: eventDetails.date ? eventDetails.date.format('DD/MM/YYYY') : 'בקרוב',
    eventTime: eventDetails.time || 'בקרוב',
    venue: eventDetails.location?.address || eventDetails.location?.name || 'יתעדכן בקרוב',
    host: inviterName,
    // Canonical host label - mirror the worker's delivery logic exactly:
    // company → couple → "משפחת <שם משפחה>" → raw host, so preview == delivery.
    hostDisplay:
      (subjects?.company?.trim()) ||
      (subjects ? joinHe(subjects.p1, subjects.p2) : '') ||
      (eventDetails.inviters?.[0]?.ln?.trim() ? `משפחת ${eventDetails.inviters[0].ln.trim()}` : '') ||
      inviterName,
    eventTypeName: eventTypeLabel(catalog, eventDetails.type),
    couple: subjects ? joinHe(subjects.p1, subjects.p2) : '',
    parents: subjects ? joinHe(subjects.parent1, subjects.parent2) : '',
    bride: brideName?.trim(),
    groom: groomName?.trim(),
    mother: subjects?.parent1?.trim(),
    father: subjects?.parent2?.trim(),
    baby: subjects?.honoree?.trim(),
    celebrant: subjects?.honoree?.trim(),
    company: subjects?.company?.trim(),
  });
};

// WhatsApp message bubble - renders the catalog template body (the exact copy the
// worker delivers), not a parallel preview format.
const WhatsAppBubble = ({ template, variables }: { template: { title?: string; body: string }; variables: Record<string, string> }) => {
  const processedBody = renderBody(template.body, variables);
  const lines = processedBody.split('\n');

  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: '#ffffff',
        borderRadius: '7.5px',
        p: 1.5,
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
          borderRight: '8px solid #ffffff',
        },
      }}
    >
      {template.title && (
        <Typography 
          variant="subtitle2" 
          fontWeight={700} 
          sx={{ 
            mb: 0.5, 
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
            mb: line.trim() ? 0.5 : 0,
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
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'flex-end',
          mt: 0.5,
          direction: 'ltr',
        }}
      >
        {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
      </Typography>
    </Box>
  );
};

const steps = [
  { label: 'חבילה', icon: InventoryIcon },
  { label: 'האירוע', icon: EventIcon },
  { label: 'לוח זמנים', icon: ScheduleIcon },
  { label: 'ההזמנות', icon: DescriptionIcon },
  { label: 'סיכום', icon: VerifiedIcon },
  { label: 'תשלום', icon: VerifiedIcon },
];

// Presentational subtitle copy per event type. The event TYPES themselves (ids,
// emoji, names) come from the catalog - this is only the wizard's marketing copy.
const EVENT_TYPE_SUBTITLES: Record<string, string> = {
  wedding: 'המלצות, הודעות ולוח זמנים מותאמים לחתונה',
  brit: 'הכול מוכן לרגע המרגש של המשפחה',
  brita: 'הכול מוכן לרגע המרגש של המשפחה',
  bar: 'התאמה מלאה לאירוע בר המצווה',
  bat: 'הודעות ותזכורות שמותאמות למשפחה',
  corporate: 'ניהול אישורי הגעה מקצועי לאירועים עסקיים',
  birthday: 'דרך פשוטה לנהל את רשימת המוזמנים',
};

// A warm, celebratory opener per event type - used across the wizard so a wedding
// feels different from a brit, and a brit from a business event.
const EVENT_CONGRATS: Record<string, string> = {
  wedding: 'מזל טוב! 💍',
  brit: 'בשעה טובה ומוצלחת! 👶',
  brita: 'בשעה טובה ומוצלחת! 🍼',
  bar: 'מזל טוב! 🎉',
  bat: 'מזל טוב! 🎀',
  corporate: 'בהצלחה עם האירוע! 🥂',
  birthday: 'יום הולדת שמח! 🎂',
};

// The invitation campaign - the first message guests receive. We weave the
// brit/brita "secret name" flavor line into this one only.
const INVITE_CAMPAIGN_LABEL = 'Save the date';

// Contextual subjects captured per event type (couple / parents / honoree / company …).
interface EventSubjects {
  p1: string;
  p2: string;
  ln1: string;
  ln2: string;
  role1: 'bride' | 'groom';
  role2: 'bride' | 'groom';
  honoree: string; // baby / child / celebrant
  parent1: string;
  parent2: string;
  company: string;
  bizEventName: string;
  age: string;
  // Brit/Brita: parents often keep the baby's name a secret until the event.
  // When true we don't require the name and derive a name-free event title.
  secretName: boolean;
}

const EMPTY_SUBJECTS: EventSubjects = {
  p1: '', p2: '', ln1: '', ln2: '', role1: 'bride', role2: 'groom',
  honoree: '', parent1: '', parent2: '', company: '', bizEventName: '', age: '',
  secretName: false,
};

const joinHe = (a: string, b: string): string => {
  const x = (a || '').trim();
  const y = (b || '').trim();
  if (x && y) return `${x} ו${y}`;
  return x || y || '';
};

// Derive the auto-generated event title + the inviter name (used in messages) from
// the contextual subjects. Title stays editable; this only sets the suggestion.
const deriveEventFromSubjects = (
  type: string,
  s: EventSubjects
): { name: string; inviterName: string } => {
  switch (type) {
    case 'wedding': {
      const couple = joinHe(s.p1, s.p2);
      return { name: couple ? `החתונה של ${couple}` : '', inviterName: couple };
    }
    case 'brit':
    case 'brita': {
      const label = type === 'brit' ? 'הברית' : 'הבריתה';
      const parents = joinHe(s.parent1, s.parent2);
      // Name kept secret → derive a warm, name-free title from the parents.
      if (s.secretName) {
        return { name: parents ? `${label} של ${parents}` : `${label} שלנו`, inviterName: parents };
      }
      const baby = s.honoree.trim();
      return { name: baby ? `${label} של ${baby}` : '', inviterName: parents };
    }
    case 'bar':
    case 'bat': {
      const label = type === 'bar' ? 'בר המצווה' : 'בת המצווה';
      const child = s.honoree.trim();
      return { name: child ? `${label} של ${child}` : '', inviterName: joinHe(s.parent1, s.parent2) };
    }
    case 'corporate':
      return { name: s.bizEventName.trim(), inviterName: s.company.trim() };
    case 'birthday': {
      const who = s.honoree.trim();
      const age = s.age.trim();
      const name = who ? (age ? `יום ההולדת ה-${age} של ${who}` : `יום ההולדת של ${who}`) : '';
      return { name, inviterName: who };
    }
    default:
      return { name: '', inviterName: '' };
  }
};

// Human-readable description of when a campaign fires, relative to the event.
const describeCampaignTiming = (offsetDays: number, time: string): string => {
  const at = time ? `בשעה ${time}` : '';
  if (offsetDays > 0) {
    const d = offsetDays === 1 ? 'יום אחד' : `${offsetDays} ימים`;
    return `${d} לפני האירוע ${at}`.trim();
  }
  if (offsetDays < 0) {
    const n = Math.abs(offsetDays);
    const d = n === 1 ? 'יום אחד' : `${n} ימים`;
    return `${d} אחרי האירוע ${at}`.trim();
  }
  return `ביום האירוע ${at}`.trim();
};

export default function EventWizard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const theme = useTheme();
  const { user } = useUser();
  const packageFromQuery = params.get('package');
  const fullNameFromQuery = params.get('fullName');
  const phoneFromQuery = params.get('phone');
  const countryCodeFromQuery = params.get('countryCode');
  const eventTypeFromQuery = params.get('eventType');
  const eventTypeOtherFromQuery = params.get('eventTypeOther');

  // If package is selected, skip package selection step
  const [activeStep, setActiveStep] = useState(packageFromQuery ? 1 : 0);
  const [selectedPackageId, setSelectedPackageId] = useState<string>(packageFromQuery || '');
  
  // Parse full name from query
  const nameParts = fullNameFromQuery ? fullNameFromQuery.split(' ').filter(Boolean) : [];
  const firstNameFromQuery = nameParts[0] || '';
  const lastNameFromQuery = nameParts.slice(1).join(' ') || '';

  // Extract country code from phone if provided
  const getCountryCodeFromPhone = (phone: string): string => {
    if (!phone) return '+972';
    if (phone.startsWith('+972')) return '+972';
    if (phone.startsWith('+')) {
      // Try to extract country code (first 1-4 digits after +)
      const match = phone.match(/^\+(\d{1,4})/);
      return match ? `+${match[1]}` : '+972';
    }
    return '+972';
  };

  // Split full phone (+country + local) into code + local number
  const splitPhone = (phone: string, fallbackCode: string) => {
    const cleaned = (phone || '').replace(/\s+/g, '');
    if (cleaned.startsWith('+')) {
      // Match against KNOWN dial codes (longest first) - a greedy \d{1,4} would
      // steal a digit from the local number (e.g. +972525401686 → code +9725,
      // dropping the 5). Prefer the detected fallbackCode when it matches.
      const codes = Array.from(new Set(countryOptions.map((o) => o.dialCode)))
        .sort((a, b) => b.length - a.length);
      const code =
        (fallbackCode && cleaned.startsWith(fallbackCode) && fallbackCode) ||
        codes.find((c) => cleaned.startsWith(c)) ||
        fallbackCode;
      let local = cleaned.slice(code.length);
      // להצגה למשתמש אנחנו כן רוצים את ה־0 המוביל (למשל 052...)
      if (code === '+972' && local && !local.startsWith('0')) {
        local = `0${local}`;
      }
      return { code: code || fallbackCode, phone: local };
    }
    // Plain local number. Self-heal an IL mobile that arrived without its leading
    // 0 (e.g. from an older session that stored it stripped) so the user always
    // sees 05XXXXXXXX, the format they originally entered.
    let local = cleaned;
    if (fallbackCode === '+972' && /^\d{9}$/.test(local) && !local.startsWith('0')) {
      local = `0${local}`;
    }
    return { code: fallbackCode, phone: local };
  };

  const initialCountryCode = countryCodeFromQuery || getCountryCodeFromPhone(phoneFromQuery || '');
  const parsedPhone = splitPhone(phoneFromQuery || '', initialCountryCode);

  const normalizeEventTypeFromHero = (value: string | null, otherValue?: string) => {
    if (!value) return { type: '', other: '' };
    if (value === 'wedding') return { type: 'wedding', other: '' };
    if (value === 'bar-mitzvah') return { type: 'bar', other: '' };
    if (value === 'bat-mitzvah') return { type: 'bat', other: '' };
    if (value === 'corporate') return { type: 'corporate', other: '' };
    if (value === 'brit') return { type: 'brit', other: '' };
    if (value === 'brita') return { type: 'brita', other: '' };
    if (value === 'birthday') return { type: 'birthday', other: '' };
    if (value === 'other') return { type: '', other: otherValue || '' };
    return { type: '', other: otherValue || value };
  };

  const normalizedHeroType = normalizeEventTypeFromHero(eventTypeFromQuery, eventTypeOtherFromQuery ?? undefined);

  const [eventDetails, setEventDetails] = useState<EventDetails>({
    name: '',
    description: '',
    type: normalizedHeroType.type,
    date: null,
    time: '18:00',
    location: null,
    inviters: [{ fn: firstNameFromQuery, ln: lastNameFromQuery }], // מתחיל עם מזמין אחד מהנתונים מה-Hero
  });
  // Plans come from static config (frontend SSOT for marketing copy). Campaigns are
  // resolved by the Adaptive Timeline Engine from the event type, plan and date.
  const [campaigns, setCampaigns] = useState<CampaignSchedule[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Record<string, string>>({}); // campaign label -> template id
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  // Approve-or-Customize: the recommended plan is shown by default; these flip to
  // the detailed editors only if the user chooses to tweak.
  const [scheduleCustomize, setScheduleCustomize] = useState(false);
  const [templatesCustomize, setTemplatesCustomize] = useState(false);
  // Custom message text per campaign label. A campaign is "custom" iff its label
  // is a key here; the value is the user-written body (variables still apply).
  const [customMessages, setCustomMessages] = useState<Record<string, string>>({});
  // Editable, user-facing title per custom message (for their own organization).
  const [customTitles, setCustomTitles] = useState<Record<string, string>>({});
  // Per-campaign WhatsApp/Meta validity of the custom message (false = breaks a rule).
  const [customMsgValid, setCustomMsgValid] = useState<Record<string, boolean>>({});
  // Contextual subjects for the first step's dynamic form, and whether the user has
  // manually edited the auto-generated event name (which stops further auto-fill).
  const [subjects, setSubjects] = useState<EventSubjects>(EMPTY_SUBJECTS);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [paymentData, setPaymentData] = useState({
    firstName: firstNameFromQuery,
    lastName: lastNameFromQuery,
    phone: parsedPhone.phone,
    countryCode: parsedPhone.code,
    email: '',
  });
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({});
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  // Fingerprint of the payload the current order was created with. The orders API
  // cannot update an order's event/campaign body after creation, so when the
  // wizard state diverges (the user went back and edited) we discard the stale
  // order and create a fresh one instead of charging for outdated details.
  const [orderPayloadKey, setOrderPayloadKey] = useState<string | null>(null);
  // Show the date-picker "required" error only after the user touched the field -
  // never on a pristine form.
  const [dateTouched, setDateTouched] = useState(false);
  // Payment step shows a confirmation of the identity we already know; the user
  // flips this to true to edit the prefilled values.
  const [editIdentity, setEditIdentity] = useState(false);

  // Abandoned-wizard recovery: a draft saved on a previous visit, offered for
  // restore via a banner. While it's pending we pause autosave so the freshly
  // mounted (empty) state doesn't overwrite the work we're about to restore.
  const [pendingDraft, setPendingDraft] = useState<WizardDraft | null>(() => {
    const d = loadWizardDraft();
    return draftHasProgress(d) ? d : null;
  });

  // Customize-schedule grid: freeze the row order (by label) while the editor is
  // open so rows never re-sort and jump under the cursor mid-edit; offsetDrafts
  // holds in-progress "days" input values that commit only on blur.
  const [scheduleOrder, setScheduleOrder] = useState<string[] | null>(null);
  const [offsetDrafts, setOffsetDrafts] = useState<Record<string, string>>({});

  // Single source of truth: the messaging catalog. Templates are selected by the
  // campaign's canonical flow STAGE, narrowed to the event type - the same catalog
  // definitions the worker delivers, so the wizard preview cannot diverge.
  const { catalog } = useCatalog();
  const templatesFor = (stage?: string) => templatesForStage(catalog, stage, eventDetails.type);
  const defaultFor = (stage?: string) => defaultTemplate(templatesFor(stage));
  // Event-type cards for step 1, derived from the catalog (excluding the free-text
  // "other"); subtitles are wizard copy.
  const eventTypeCards = catalog.event_types
    .filter((e) => e.key !== 'other')
    .map((e) => ({ id: e.key, emoji: e.emoji, title: e.name_he, subtitle: EVENT_TYPE_SUBTITLES[e.key] || '' }));

  // Places Autocomplete hook - must be at component level
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const placesAutocomplete = usePlacesAutocomplete({
    onPlaceSelected: (location) => {
      setEventDetails((prev) => ({ ...prev, location }));
    },
    language: 'he',
  });

  // Update payment data when user changes or when data comes from Hero
  useEffect(() => {
    if (user) {
      const first = user.firstName ?? (user.username?.split(' ')[0] || '');
      const last =
        user.lastName ??
        (user.username
          ?.split(' ')
          .slice(1)
          .join(' ')
          .trim() || '');

      const phoneSource = user.phone || phoneFromQuery || '';
      const phoneCodeGuess = getCountryCodeFromPhone(phoneSource);
      const parsedPhoneSource = phoneSource ? splitPhone(phoneSource, phoneCodeGuess) : null;
      setPaymentData(prev => ({
        ...prev,
        firstName: prev.firstName || first,
        lastName: prev.lastName || last,
        email: user.email || prev.email || '',
        phone: prev.phone || parsedPhoneSource?.phone || '',
        countryCode: prev.countryCode || parsedPhoneSource?.code || prev.countryCode || '+972',
      }));
    } else if (firstNameFromQuery || lastNameFromQuery || phoneFromQuery) {
      // If we have data from Hero, use it (but don't override if user already filled)
      const parsed = splitPhone(phoneFromQuery || '', initialCountryCode);
      setPaymentData(prev => ({
        ...prev,
        firstName: prev.firstName || firstNameFromQuery,
        lastName: prev.lastName || lastNameFromQuery,
        phone: prev.phone || parsed.phone,
        countryCode: prev.countryCode || parsed.code,
      }));
    }
  }, [user, firstNameFromQuery, lastNameFromQuery, phoneFromQuery, initialCountryCode]);

  // When the payment step is reached, decide the initial mode once: confirmation if
  // the identity is already prefilled (account/Hero), otherwise the editable form.
  // Keyed on activeStep only so typing into the form never flips it back.
  useEffect(() => {
    if (activeStep === 5) {
      const prefilled = Boolean(
        paymentData.firstName.trim() && paymentData.lastName.trim() && paymentData.phone.trim()
      );
      setEditIdentity(!prefilled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  // Autosave the wizard so nothing is lost on refresh / close / return-tomorrow.
  // Paused while a restorable draft is pending the user's decision.
  useEffect(() => {
    if (pendingDraft) return;
    saveWizardDraft({
      activeStep,
      selectedPackageId,
      orderId,
      orderPayloadKey,
      eventDetails: { ...eventDetails, date: eventDetails.date && eventDetails.date.isValid() ? eventDetails.date.toISOString() : null },
      subjects,
      campaigns,
      selectedTemplates,
      customMessages,
      customTitles,
      customMsgValid,
      scheduleCustomize,
      templatesCustomize,
      nameManuallyEdited,
      paymentData,
    });
  }, [
    pendingDraft, activeStep, selectedPackageId, orderId, orderPayloadKey, eventDetails, subjects, campaigns,
    selectedTemplates, customMessages, customTitles, customMsgValid, scheduleCustomize, templatesCustomize,
    nameManuallyEdited, paymentData,
  ]);

  // Ignoring the restore banner and simply working is an implicit "start fresh":
  // once the wizard state diverges from its initial (query-param-derived) values,
  // dismiss the pending draft so autosave resumes and the new work survives a
  // refresh. Only user-edited fields are tracked - mount-time effects (account
  // prefill, Hero inviters, timeline resolution) must not dismiss the banner.
  const interactionSnapshot = JSON.stringify({
    activeStep,
    selectedPackageId,
    name: eventDetails.name,
    description: eventDetails.description,
    type: eventDetails.type,
    date: eventDetails.date && eventDetails.date.isValid() ? eventDetails.date.toISOString() : null,
    time: eventDetails.time,
    location: eventDetails.location,
    subjects,
    selectedTemplates,
    customMessages,
    customTitles,
    scheduleCustomize,
    templatesCustomize,
    agreedToTerms,
  });
  const initialSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingDraft) return;
    if (initialSnapshotRef.current === null) {
      initialSnapshotRef.current = interactionSnapshot;
      return;
    }
    if (interactionSnapshot !== initialSnapshotRef.current) {
      setPendingDraft(null);
    }
  }, [pendingDraft, interactionSnapshot]);

  const restoreDraft = () => {
    const d = pendingDraft;
    if (!d) return;
    setSelectedPackageId(d.selectedPackageId || '');
    setEventDetails({
      ...(d.eventDetails as any),
      // Only restore a valid date - never let an invalid Dayjs into state.
      date: (() => {
        const restored = d.eventDetails?.date ? dayjs(d.eventDetails.date as string) : null;
        return restored && restored.isValid() ? restored : null;
      })(),
    });
    setSubjects(d.subjects as any);
    setCampaigns(d.campaigns as CampaignSchedule[]);
    setSelectedTemplates(d.selectedTemplates || {});
    setCustomMessages(d.customMessages || {});
    setCustomTitles(d.customTitles || {});
    setCustomMsgValid(d.customMsgValid || {});
    setScheduleCustomize(!!d.scheduleCustomize);
    setTemplatesCustomize(!!d.templatesCustomize);
    setNameManuallyEdited(!!d.nameManuallyEdited);
    if (d.paymentData) setPaymentData(d.paymentData as any);
    setOrderId(d.orderId ?? null);
    setOrderPayloadKey(d.orderPayloadKey ?? null);
    setActiveStep(typeof d.activeStep === 'number' ? d.activeStep : 0);
    setPendingDraft(null);
  };

  const discardDraft = () => {
    clearWizardDraft();
    localStorage.removeItem('pending_order_id');
    setPendingDraft(null);
  };

  // Arriving from the OTP "change phone number" action: silently restore the
  // saved draft (no resume banner) and drop the user back on the payment step
  // with their details editable - it should feel like one step back.
  useEffect(() => {
    if ((location.state as any)?.resumeDraft && pendingDraft) {
      restoreDraft();
      setEditIdentity(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture the customize-grid row order once when the editor opens (frozen while
  // mounted so edits never reorder rows mid-typing); release it when leaving.
  useEffect(() => {
    if (activeStep === 2 && scheduleCustomize) {
      setScheduleOrder((prev) =>
        prev ?? [...campaigns].sort((a, b) => b.offsetDays - a.offsetDays).map((c) => c.label)
      );
    } else {
      setScheduleOrder(null);
      setOffsetDrafts((prev) => (Object.keys(prev).length ? {} : prev));
    }
  }, [activeStep, scheduleCustomize, campaigns]);

  // Step transitions: return to the top and move focus to the step content so
  // keyboard/screen-reader users land on the new step, not mid-page.
  const stepContentRef = useRef<HTMLDivElement | null>(null);
  const prevStepRef = useRef(activeStep);
  useEffect(() => {
    if (prevStepRef.current === activeStep) return;
    prevStepRef.current = activeStep;
    window.scrollTo({ top: 0 });
    stepContentRef.current?.focus({ preventScroll: true });
  }, [activeStep]);

  // Update event details when data comes from Hero (on mount)
  useEffect(() => {
    if (firstNameFromQuery || lastNameFromQuery) {
      setEventDetails(prev => ({
        ...prev,
        inviters: prev.inviters.length > 0 && (prev.inviters[0].fn || prev.inviters[0].ln)
          ? prev.inviters // Keep existing if already filled
          : [{ fn: firstNameFromQuery, ln: lastNameFromQuery }], // Use from Hero if empty
      }));
    }
  }, [firstNameFromQuery, lastNameFromQuery]);

  // Adaptive Timeline Engine: resolve the recommended communication plan from the
  // event type, plan tier and (crucially) how much time is left before the event.
  // We only auto-apply while the user hasn't taken over the schedule via "Customize"
  // - once they edit it, the schedule is theirs and we never clobber it.
  useEffect(() => {
    if (scheduleCustomize) return;
    if (!selectedPackageId || !eventDetails.type) {
      setCampaigns([]);
      return;
    }
    const resolved = buildAdaptiveTimeline({
      eventType: eventDetails.type,
      planId: selectedPackageId,
      eventDate: eventDetails.date,
      eventTime: eventDetails.time,
      now: dayjs(),
      // Campaigns with a user-written body may need WhatsApp/Meta approval first,
      // so the engine keeps a lead buffer before they can send.
      customLabels: Object.keys(customMessages),
    });
    setCampaigns(resolved);
  }, [selectedPackageId, eventDetails.type, eventDetails.date, eventDetails.time, customMessages, scheduleCustomize]);

  const selectedPlan = useMemo(() => {
    return plans.find(p => p.id === selectedPackageId);
  }, [plans, selectedPackageId]);

  const canNext = useMemo(() => {
    if (activeStep === 0) return !!selectedPackageId;
    if (activeStep === 1) {
      // חובה: שם האירוע, תאריך, שעה, וסוג האירוע (מיקום אופציונלי כרגע)
      return Boolean(
        eventDetails.name && 
        eventDetails.name.trim().length > 0 &&
        eventDetails.date !== null &&
        eventDetails.date.isValid() &&
        eventDetails.time &&
        eventDetails.time.trim().length > 0 &&
        eventDetails.type && 
        eventDetails.type.trim().length > 0
      );
    }
    if (activeStep === 2) return true;
    if (activeStep === 3) {
      // אפשר להמשיך, אלא אם הודעה מותאמת אישית מפרה כלל של WhatsApp/Meta.
      const hasInvalidCustom = campaigns.some(
        (c) => c.enabled && c.label in customMessages && customMsgValid[c.label] === false
      );
      return !hasInvalidCustom;
    }
    if (activeStep === 4) return agreedToTerms; // שלב הסיכום - צריך הסכמה לתנאים
    if (activeStep === 5) {
      // שלב התשלום - אם המשתמש מחובר, אפשר להמשיך. אם לא, צריך למלא פרטים
      if (user) return true;
      return !!(paymentData.firstName.trim() && paymentData.lastName.trim() && paymentData.phone.trim());
    }
    return true;
  }, [activeStep, selectedPackageId, eventDetails, campaigns, selectedTemplates, agreedToTerms, user, paymentData, customMessages, customMsgValid]);

  const handleNext = () => {
    // אם עוברים משלב התבניות (שלב 3), וודא שכל קמפיין פעיל יש לו תבנית (דיפולטית או נבחרת)
    if (activeStep === 3) {
      const activeCampaigns = campaigns.filter(c => c.enabled);
      const updatedTemplates = { ...selectedTemplates };
      
      activeCampaigns.forEach((campaign) => {
        // אם לא נבחרה תבנית לקמפיין הזה, בחר את התבנית הדיפולטית
        if (!updatedTemplates[campaign.label]) {
          const defTpl = defaultFor(campaign.stage);
          if (defTpl) {
            updatedTemplates[campaign.label] = defTpl.id;
          }
        }
      });
      
      setSelectedTemplates(updatedTemplates);
    }
    
    if (activeStep < steps.length - 1) {
      setActiveStep((s) => s + 1);
    }
    // Last step is handled by the payment form submit
  };

  const handleBack = () => setActiveStep((s) => Math.max(0, s - 1));

  const createEvent = async (): Promise<string | null> => {
    try {
      // Combine date and time: interpret as Israel time and convert to UTC so backend/store has no drift
      let eventDateTime: string | null = null;
      if (eventDetails.date && eventDetails.time) {
        eventDateTime = israelTimeToISOUTC(eventDetails.date, eventDetails.time);
      } else if (eventDetails.date) {
        eventDateTime = israelTimeToISOUTC(eventDetails.date, '00:00');
      }

      // Prepare location as JSON string
      const locationJson = eventDetails.location
        ? JSON.stringify({
            name: eventDetails.location.name,
            address: eventDetails.location.address,
            coordinates: eventDetails.location.coordinates,
          })
        : null;

      // Prepare event payload. This path creates the event directly (Free plan);
      // paid plans are provisioned server-side after payment. Tag the payment
      // state + plan so the dashboard shows the right status from creation.
      const eventPayload = {
        name: eventDetails.name,
        description: eventDetails.description || undefined,
        event_type: eventDetails.type || undefined,
        event_date: eventDateTime || undefined,
        location: locationJson,
        inviters: eventDetails.inviters
          .filter(inv => inv.fn || inv.ln)
          .map(inv => ({ fn: inv.fn, ln: inv.ln })),
        plan_id: selectedPackageId || 'free',
        payment_status: selectedPackageId && selectedPackageId !== 'free' ? 'paid' : 'free',
      };

      const response = await fetchWithAuth('/api/events', {
        method: 'POST',
        body: JSON.stringify(eventPayload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to create event');
      }

      const eventData = await response.json();
      return eventData.id;
    } catch (error) {
      console.error('Event creation error:', error);
      throw error;
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate form (גם למשתמשים מחוברים וגם ללא)
    const errors: Record<string, string> = {};
    if (!paymentData.firstName.trim()) {
      errors.firstName = 'שם פרטי הוא שדה חובה';
    }
    if (!paymentData.lastName.trim()) {
      errors.lastName = 'שם משפחה הוא שדה חובה';
    }
    const cleanedLocalPhone = paymentData.phone.replace(/\s/g, '');
    if (!cleanedLocalPhone) {
      errors.phone = 'מספר טלפון הוא שדה חובה';
    } else if (!/^\d{7,15}$/.test(cleanedLocalPhone)) {
      errors.phone = 'מספר הטלפון אינו תקין';
    } else {
      const normalized = normalizePhoneNumber(cleanedLocalPhone, paymentData.countryCode);
      if (!/^\+\d{8,15}$/.test(normalized)) {
        errors.phone = 'מספר הטלפון חייב להיות בפורמט בינלאומי (כולל קידומת)';
      }
    }
    // Email is optional, but if provided, must be valid
    if (paymentData.email.trim() && !/^\S+@\S+\.\S+$/.test(paymentData.email.trim())) {
      errors.email = 'כתובת האימייל אינה תקינה';
    }
    
    if (Object.keys(errors).length > 0) {
      setPaymentErrors(errors);
      return;
    }
    
    setPaymentLoading(true);
    setPaymentErrors({});

    try {
      // 1) Create / reuse order in aub-service (pre-payment בלבד, בלי יצירת event)
      let currentOrderId = orderId;

      // Build campaigns payload for order (label, template_id, scheduled_at)
      const campaignsPayload = campaigns
        .filter((c) => c.enabled)
        .map((c) => {
          const templateId =
            selectedTemplates[c.label] || defaultFor(c.stage)?.id || null;
          // In secret-name mode the flavor line lives in the composed copy, not in the
          // stored template, so send it as a custom_message to guarantee delivery.
          const customMessage = c.label in customMessages
            ? customMessages[c.label]
            : isSecretInvite(c.label)
              ? getBaseTemplate(c)?.body ?? null
              : null;

          // scheduled_at: prefer the engine-resolved send time (already compressed to
          // fit the available window and guaranteed not to be in the past). Fall back
          // to computing it from the offset for any manually-edited rows.
          let scheduledAt: Date | null = null;
          if (c.scheduledAt) {
            scheduledAt = new Date(c.scheduledAt);
          } else if (eventDetails.date) {
            const offsetDays = typeof c.offsetDays === 'number' ? c.offsetDays : 0;
            const at = eventDetails.date.subtract(offsetDays, 'day');
            const timeStr = c.time || '12:00';
            const isoUtc = israelTimeToISOUTC(at, timeStr);
            scheduledAt = new Date(isoUtc);
          }

          return {
            label: c.label,
            template_id: templateId,
            custom_message: customMessage,
            scheduled_at: scheduledAt,
          };
        });

      const orderBody = {
        plan: selectedPackageId,
        event_name: eventDetails.name,
        event_description: eventDetails.description,
        event_type: eventDetails.type,
        // Interpret the chosen date+time as Israel time (same as the free-plan
        // create path) - a raw local Date drops the chosen hour and can shift
        // the event a whole day once converted to UTC.
        event_date: eventDetails.date
          ? israelTimeToISOUTC(eventDetails.date, eventDetails.time || '00:00')
          : null,
        location: eventDetails.location,
        inviters: eventDetails.inviters,
        // Persist the event-type-specific subjects so the SAME variables the
        // designer previews (bride/groom/parents/baby/…) also resolve when the
        // WhatsApp message is delivered.
        subjects,
        campaigns: campaignsPayload,
      };
      const orderBodyKey = JSON.stringify(orderBody);

      // The orders API only lets us PATCH the buyer identity after creation -
      // there is no endpoint to update the event/campaign payload. If the wizard
      // state changed since the order was created (the user went back and
      // edited), discard the stale order and create a fresh one so checkout
      // never charges for outdated details.
      if (currentOrderId && orderBodyKey !== orderPayloadKey) {
        currentOrderId = null;
        setOrderId(null);
        localStorage.removeItem('pending_order_id');
      }

      if (!currentOrderId) {
        const orderRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: orderBodyKey,
        });

        if (!orderRes.ok) {
          throw new Error('Failed to create order');
        }

        const orderData = await orderRes.json();
        currentOrderId = orderData.order_id || orderData.orderId;
        saveOrderToken(currentOrderId, orderData.access_token);
        setOrderId(currentOrderId);
        setOrderPayloadKey(orderBodyKey);
      }

      // Remember the unfinished order so a returning user resumes straight at
      // checkout (instead of onboarding). Cleared once the order is paid.
      if (currentOrderId) localStorage.setItem('pending_order_id', String(currentOrderId));

      // 2) Enrich order with buyer identity (pre-payment)
      if (currentOrderId) {
        const normalizedPhone = normalizePhoneNumber(paymentData.phone, paymentData.countryCode);
        const identityRes = await fetch(`/api/orders/${currentOrderId}/identity`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...orderAuthHeaders(currentOrderId) },
          body: JSON.stringify({
            first_name: paymentData.firstName,
            last_name: paymentData.lastName,
            phone: normalizedPhone,
            email: paymentData.email.trim() || null, // Send null if empty (optional field)
          }),
        });

        if (!identityRes.ok) {
          throw new Error('Failed to update order identity');
        }
      }

      // 3) Verify the buyer via OTP BEFORE payment so they reach the pay page
      //    already authenticated. An already-logged-in user whose account phone
      //    matches the buyer phone is verified by definition - no OTP round-trip,
      //    straight to payment. If the phone differs, verify it as usual.
      const buyerPhone = normalizePhoneNumber(paymentData.phone, paymentData.countryCode);
      const loggedInPhone = (user?.phone || '').replace(/\s+/g, '');
      if (user && loggedInPhone && loggedInPhone === buyerPhone) {
        localStorage.setItem('user_first_name', paymentData.firstName);
        localStorage.setItem('user_last_name', paymentData.lastName);
        if (paymentData.email.trim()) localStorage.setItem('user_email', paymentData.email.trim());
        setPaymentLoading(false);
        navigate(`/payment?orderId=${encodeURIComponent(currentOrderId || '')}`);
        return;
      }
      const regRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: buyerPhone,
          email: paymentData.email.trim() || null,
          first_name: paymentData.firstName,
          last_name: paymentData.lastName,
        }),
      });
      if (regRes.status === 409) {
        // Existing account - send a login OTP instead.
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: buyerPhone }),
        });
        if (!loginRes.ok) throw new Error('Failed to send verification code');
      } else if (!regRes.ok) {
        throw new Error('Failed to start verification');
      }

      // Persist names so the app can greet the user after login.
      localStorage.setItem('user_first_name', paymentData.firstName);
      localStorage.setItem('user_last_name', paymentData.lastName);
      if (paymentData.email.trim()) localStorage.setItem('user_email', paymentData.email.trim());

      setPaymentLoading(false);
      // OTP verification happens BEFORE payment; after verifying, continue to pay.
      navigate('/login', {
        state: {
          phone: buyerPhone,
          otpAlreadySent: true,
          next: `/payment?orderId=${encodeURIComponent(currentOrderId || '')}`,
          // Lets the OTP "change phone number" action go one step BACK into the
          // wizard (restoring all data) instead of dumping the user on Login.
          fromWizard: true,
        },
      });
    } catch (error) {
      console.error('Order / payment flow error:', error);
      setPaymentErrors({ form: 'שגיאה ביצירת ההזמנה. אנא נסו שוב.' });
      setPaymentLoading(false);
    }
  };

  // Free-plan creation: the Free plan (₪0) has nothing to pay, so we create the
  // event directly and go straight to the dashboard. Paid plans always go
  // through the order → payment flow.
  const [creatingFree, setCreatingFree] = useState(false);
  const handleCreateFree = async () => {
    if (!eventDetails.name?.trim()) {
      setPaymentErrors({ form: 'יש להזין שם אירוע' });
      return;
    }
    setCreatingFree(true);
    setPaymentErrors({});
    try {
      const eventId = await createEvent();
      if (eventId) {
        clearWizardDraft(); // event created - the draft is no longer needed
        localStorage.removeItem('pending_order_id');
        navigate('/overview');
      }
    } catch (error) {
      setPaymentErrors({ form: 'שגיאה ביצירת האירוע. אנא נסו שוב.' });
    } finally {
      setCreatingFree(false);
    }
  };

  // Info messages for each step
  const getStepInfo = (step: number): string => {
    switch (step) {
      case 0:
        return 'כל חבילה כוללת את כל מה שצריך כדי שהאורחים יידעו, יאשרו ויגיעו. בחרו לפי כמות האורחים.';
      case 1:
        return '';
      case 2:
        return '';
      case 3:
        return '';
      case 4:
        return 'רגע לפני שמתחילים - הנה הכול במקום אחד. תמיד אפשר לחזור ולערוך.';
      case 5:
        return user
          ? 'עוד פרט אחרון ואתם מסודרים - נשמור את הכול בבטחה.'
          : 'נשאיר לכם את האירוע מוכן ומחכה - רק נסיים את הפרטים והכול יוצא לדרך.';
      default:
        return '';
    }
  };

  const renderInfoBox = () => {
    const infoText = getStepInfo(activeStep);
    if (!infoText) return null;

    return (
      <Alert
        icon={<InfoIcon />}
        severity="info"
        sx={{
          mb: 3,
          borderRadius: 2,
          bgcolor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.08 : 0.06),
          border: '1px solid',
          borderColor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.2 : 0.15),
          '& .MuiAlert-icon': {
            color: theme.palette.info.main,
          },
          '& .MuiAlert-message': {
            color: theme.palette.text.primary,
            direction: 'rtl',
            textAlign: 'right',
          },
        }}
      >
        {infoText}
      </Alert>
    );
  };

  // A warm way to refer to the event in copy - the actual name once known
  // ("החתונה של דנה ועמית"), otherwise the type ("החתונה"), otherwise a soft fallback.
  const warmEventRef = (): string => {
    if (eventDetails.name?.trim()) return eventDetails.name.trim();
    const label = eventTypeLabel(catalog, eventDetails.type);
    return label ? `ה${label}` : 'האירוע שלכם';
  };

  // Keyboard operability for clickable selector cards: focusable, announced as a
  // button, and activatable with Enter/Space. The target check keeps nested
  // interactive controls (e.g. a Switch inside the card) behaving natively.
  const pressableCardProps = (onActivate: () => void) => ({
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  });
  const focusRingSx = {
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: '2px',
    },
  } as const;

  // "We've prepared this for you" header used by the Approve-or-Customize steps.
  const renderPreparedHeader = (title: string, subtitle: string) => (
    <Box sx={{ mb: 3, textAlign: 'right', direction: 'rtl' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexDirection: 'row-reverse', justifyContent: 'flex-end' }}>
        <AutoAwesomeIcon sx={{ color: 'primary.main', fontSize: 22 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{subtitle}</Typography>
    </Box>
  );

  const renderPackageStep = () => {

    return (
      <Box>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 800 }}>
          כמה אורחים אתם מזמינים?
        </Typography>
        {renderInfoBox()}
        <Box
          sx={{
            display: { xs: 'flex', sm: 'grid' },
            gridTemplateColumns: { sm: 'repeat(3, 1fr)' },
            gap: 2,
            direction: 'rtl',
            overflowX: { xs: 'auto', sm: 'visible' },
            overflowY: 'hidden',
            scrollBehavior: 'smooth',
            scrollSnapType: { xs: 'x mandatory', sm: 'none' },
            py: { xs: 2, sm: 4, md: 4 },
            px: { xs: 1.5, md: 3 },
            mx: { xs: -2, sm: 0 },
            '&::-webkit-scrollbar': {
              display: 'none',
            },
            scrollbarWidth: 'none',
          }}
        >
          {plans.map((plan: PlanTier) => {
          const selected = selectedPackageId === plan.id;
          return (
            <Paper
              key={plan.id}
              variant="outlined"
              onClick={() => setSelectedPackageId(plan.id)}
              aria-pressed={selected}
              {...pressableCardProps(() => setSelectedPackageId(plan.id))}
              sx={{
                ...focusRingSx,
                p: plan.isPopular ? 3 : 2.5,
                borderRadius: 3,
                cursor: 'pointer',
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? plan.color : theme.palette.divider,
                boxShadow: selected
                  ? `0 0 0 2px ${alpha(plan.color, 0.25)}, 0 14px 34px ${alpha(theme.palette.common.black, 0.14)}`
                  : `0 10px 30px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.24 : 0.08)}`,
                transition: 'transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease, border-width 0.22s ease',
                position: 'relative',
                overflow: 'hidden',
                bgcolor: 'background.paper',
                transform: plan.isPopular ? 'scale(1.03)' : 'scale(1)',
                minWidth: { xs: '85%', sm: 'auto' },
                width: { xs: '85%', sm: 'auto' },
                flexShrink: { xs: 0, sm: 1 },
                scrollSnapAlign: { xs: 'center', sm: 'none' },
                '&::before': plan.isPopular
                  ? {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      background: `linear-gradient(135deg, ${alpha(plan.color, 0.08)}, transparent 60%)`,
                      pointerEvents: 'none',
                    }
                  : {},
                '&:hover': {
                  transform: plan.isPopular ? 'scale(1.05) translateY(-4px)' : 'translateY(-4px)',
                  borderColor: plan.color,
                  boxShadow: selected
                    ? `0 0 0 2px ${alpha(plan.color, 0.25)}, 0 18px 45px ${alpha(plan.color, 0.16)}`
                    : `0 18px 45px ${alpha(theme.palette.common.black, 0.12)}`,
                },
              }}
            >
              {plan.isPopular && (
                <Chip
                  label="הכי פופולרי"
                  color="primary"
                  size="small"
                  sx={{ position: 'absolute', top: 12, left: 12, fontWeight: 700 }}
                />
              )}
              <Typography variant="h5" fontWeight={800} sx={{ textAlign: 'right', direction: 'rtl' }}>
                {plan.title}
              </Typography>
              <Typography variant="subtitle1" color="text.secondary" sx={{ textAlign: 'right', direction: 'rtl' }}>
                {plan.subtitle}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <PriceTag price={plan.price} size="md" align="right" color={plan.color} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right', mb: 1, direction: 'rtl' }}>
                {plan.description}
              </Typography>
              <Box sx={{ mt: 1.5, display: 'grid', gap: 0.6, direction: 'rtl' }}>
                {plan.features.slice(0, 4).map((f) => (
                  <Box
                    key={f}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      justifyContent: 'flex-end',
                      flexDirection: 'row-reverse',
                      direction: 'rtl',
                    }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>
                      {f}
                    </Typography>
                    <CheckCircleIcon fontSize="small" sx={{ color: theme.palette.success.main }} />
                  </Box>
                ))}
              </Box>
              {selected && (
                <Chip
                  label="נבחר"
                  size="small"
                  sx={{
                    mt: 1.5,
                    alignSelf: 'flex-end',
                    bgcolor: plan.color,
                    color: theme.palette.common.white,
                    fontWeight: 700,
                  }}
                />
              )}
            </Paper>
          );
        })}
      </Box>
    </Box>
    );
  };

  const renderEventStep = () => {
    const t = eventDetails.type;
    const typeSelected = !!t;
    const typeMeta = eventTypeCards.find((e) => e.id === t);

    // Pick an event type: set the type and (re)generate the suggested name + inviter.
    // Re-clicking the already-selected type is a no-op - it must not clobber a
    // manually edited event name or reset the auto-fill state.
    const selectEventType = (typeId: string) => {
      if (typeId === eventDetails.type) return;
      const { name, inviterName } = deriveEventFromSubjects(typeId, subjects);
      setNameManuallyEdited(false);
      // A small, subtle celebration when a type is chosen.
      if (typeId) {
        fireConfetti(1400);
      }
      setEventDetails((ed) => ({
        ...ed,
        type: typeId,
        name: name || '',
        inviters: [{ fn: inviterName, ln: '' }],
      }));
    };

    // Update a contextual subject → re-derive the inviter + the name (unless edited).
    const updateSubjects = (patch: Partial<EventSubjects>) => {
      const next = { ...subjects, ...patch };
      setSubjects(next);
      const { name, inviterName } = deriveEventFromSubjects(t, next);
      setEventDetails((ed) => ({
        ...ed,
        inviters: [{ fn: inviterName, ln: '' }],
        name: nameManuallyEdited ? ed.name : name || '',
      }));
    };

    const fieldBox = (
      label: string,
      value: string,
      onChange: (v: string) => void,
      placeholder?: string
    ) => (
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
          {label}
        </Typography>
        <TextField
          fullWidth
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
          sx={{ '& .MuiOutlinedInput-root': { direction: 'rtl' } }}
        />
      </Box>
    );

    const twoCol = (a: React.ReactNode, b: React.ReactNode) => (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        {a}
        {b}
      </Box>
    );

    // One partner in the wedding step: their own first name, last name, and a
    // bride/groom toggle. Default roles are first=bride, second=groom.
    const weddingPersonBlock = (
      label: string,
      fnVal: string,
      lnVal: string,
      role: 'bride' | 'groom',
      onFn: (v: string) => void,
      onLn: (v: string) => void,
      onRole: (r: 'bride' | 'groom') => void
    ) => (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right' }}>
            {label}
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={role}
            onChange={(_, v) => { if (v) onRole(v as 'bride' | 'groom'); }}
            sx={{ direction: 'rtl' }}
          >
            <ToggleButton value="bride">כלה</ToggleButton>
            <ToggleButton value="groom">חתן</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {twoCol(
          fieldBox('שם פרטי', fnVal, onFn, 'שם פרטי'),
          fieldBox('שם משפחה', lnVal, onLn, 'שם משפחה')
        )}
      </Paper>
    );

    const renderContextualFields = () => {
      switch (t) {
        case 'wedding':
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {weddingPersonBlock(
                'אני',
                subjects.p1, subjects.ln1, subjects.role1,
                (v) => updateSubjects({ p1: v }),
                (v) => updateSubjects({ ln1: v }),
                (r) => updateSubjects({ role1: r })
              )}
              {weddingPersonBlock(
                'החצי שמשלים אותי',
                subjects.p2, subjects.ln2, subjects.role2,
                (v) => updateSubjects({ p2: v }),
                (v) => updateSubjects({ ln2: v }),
                (r) => updateSubjects({ role2: r })
              )}
            </Box>
          );
        case 'brit':
        case 'brita':
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!subjects.secretName && fieldBox(
                t === 'brit' ? 'שם התינוק' : 'שם התינוקת',
                subjects.honoree,
                (v) => updateSubjects({ honoree: v }),
                'איך קוראים לרך הנולד?'
              )}
              {/* Keeping the name a secret is a cherished tradition - never force it. */}
              <Paper
                variant="outlined"
                aria-pressed={subjects.secretName}
                onClick={() => updateSubjects({ secretName: !subjects.secretName })}
                {...pressableCardProps(() => updateSubjects({ secretName: !subjects.secretName }))}
                sx={{
                  ...focusRingSx,
                  cursor: 'pointer',
                  p: 1.75,
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  borderColor: subjects.secretName ? 'primary.main' : 'divider',
                  bgcolor: subjects.secretName ? alpha(theme.palette.primary.main, 0.06) : 'background.paper',
                  transition: 'border-color .18s ease, background-color .18s ease',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <Typography component="span" sx={{ fontSize: 24, lineHeight: 1 }}>🧿</Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    ששש… אנחנו מעדיפים לשמור את השם בסוד 😉
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {subjects.secretName
                      ? 'מצוין - נשמור את ההפתעה לרגע הגדול וניצור שם אירוע בלי לחשוף את השם.'
                      : 'אפשר להמשיך גם בלי לגלות - פשוט סמנו כאן ונדאג לשאר.'}
                  </Typography>
                </Box>
                <Switch
                  checked={subjects.secretName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => updateSubjects({ secretName: !subjects.secretName })}
                />
              </Paper>
              {twoCol(
                fieldBox('הורה ראשון', subjects.parent1, (v) => updateSubjects({ parent1: v }), 'שם פרטי'),
                fieldBox('הורה שני', subjects.parent2, (v) => updateSubjects({ parent2: v }), 'שם פרטי')
              )}
            </Box>
          );
        case 'bar':
        case 'bat':
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {fieldBox(
                t === 'bar' ? 'שם חתן בר המצווה' : 'שם כלת בת המצווה',
                subjects.honoree,
                (v) => updateSubjects({ honoree: v }),
                'שם פרטי'
              )}
              {twoCol(
                fieldBox('הורה ראשון', subjects.parent1, (v) => updateSubjects({ parent1: v }), 'שם פרטי'),
                fieldBox('הורה שני', subjects.parent2, (v) => updateSubjects({ parent2: v }), 'שם פרטי')
              )}
            </Box>
          );
        case 'corporate':
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {fieldBox('שם החברה', subjects.company, (v) => updateSubjects({ company: v }), 'שם החברה או הארגון')}
              {fieldBox('שם האירוע', subjects.bizEventName, (v) => updateSubjects({ bizEventName: v }), 'לדוגמה: ערב גיבוש 2026')}
            </Box>
          );
        case 'birthday':
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {twoCol(
                fieldBox('למי חוגגים?', subjects.honoree, (v) => updateSubjects({ honoree: v }), 'שם החוגג/ת'),
                fieldBox('גיל (אופציונלי)', subjects.age, (v) => updateSubjects({ age: v }), 'לדוגמה: 30')
              )}
            </Box>
          );
        default:
          return null;
      }
    };

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, direction: 'rtl' }}>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>איזה אירוע אתם חוגגים?</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            בחרו את סוג האירוע ונתפור לכם חוויה שמתאימה בדיוק לו.
          </Typography>
        </Box>

        {/* Event-type cards */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
          {eventTypeCards.map((et) => {
            const selected = t === et.id;
            return (
              <Paper
                key={et.id}
                variant="outlined"
                onClick={() => selectEventType(et.id)}
                aria-pressed={selected}
                {...pressableCardProps(() => selectEventType(et.id))}
                sx={{
                  ...focusRingSx,
                  cursor: 'pointer',
                  p: 2,
                  borderRadius: 3,
                  textAlign: 'center',
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? 'primary.main' : 'divider',
                  bgcolor: selected ? alpha(theme.palette.primary.main, 0.06) : 'background.paper',
                  boxShadow: selected ? 6 : 0,
                  transform: selected ? 'translateY(-3px)' : 'none',
                  transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
                  '&:hover': { borderColor: 'primary.main', transform: 'translateY(-3px)', boxShadow: 4 },
                }}
              >
                <Typography component="div" sx={{ fontSize: 34, lineHeight: 1 }}>{et.emoji}</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1 }}>{et.title}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, lineHeight: 1.4 }}>
                  {et.subtitle}
                </Typography>
              </Paper>
            );
          })}
        </Box>

        {typeSelected && (
          <>
            <Alert
              icon={<AutoAwesomeIcon fontSize="inherit" />}
              severity="success"
              sx={{ borderRadius: 2, '& .MuiAlert-message': { direction: 'rtl', textAlign: 'right' } }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{EVENT_CONGRATS[t] || 'בחירה מצוינת! ✨'}</Typography>
              כבר הכנו עבורכם את כל מהלך התקשורת ל{eventTypeLabel(catalog, t) || typeMeta?.title} - מההזמנה ועד התודה שאחרי. נשארו רק כמה פרטים שרק אתם יודעים.
            </Alert>

            {renderContextualFields()}

            {/* Auto-generated event name (editable) */}
            <Box>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
                איך נקרא לאירוע?
              </Typography>
              <TextField
                fullWidth
                value={eventDetails.name}
                onChange={(e) => {
                  setNameManuallyEdited(true);
                  setEventDetails({ ...eventDetails, name: e.target.value });
                }}
                placeholder="שם האירוע"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <AutoAwesomeIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                    </InputAdornment>
                  ),
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' }, maxLength: 100 }}
                sx={{ '& .MuiOutlinedInput-root': { direction: 'rtl' } }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block', textAlign: 'right' }}>
                יצרנו שם אוטומטית מהפרטים שמילאתם - אפשר לערוך בכל רגע.
              </Typography>
            </Box>

      {/* תאריך ושעה */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <Box>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
            תאריך האירוע *
          </Typography>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              value={eventDetails.date}
              minDate={dayjs().startOf('day')}
              format="DD/MM/YYYY"
              onChange={(val) => {
                setDateTouched(true);
                setEventDetails({ ...eventDetails, date: val });
              }}
              // The theme is LTR (RTL is applied per-element), so MUI X doesn't
              // auto-swap the month-nav arrows. Swap them here: in RTL "previous"
              // sits on the right and must point right, "next" on the left.
              slots={{
                leftArrowIcon: ChevronRightRoundedIcon,
                rightArrowIcon: ChevronLeftRoundedIcon,
              }}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  placeholder: 'בחר תאריך',
                  // Only complain once the field was actually touched - never on
                  // a pristine form the user hasn't reached yet.
                  onBlur: () => setDateTouched(true),
                  error: dateTouched && eventDetails.date === null,
                  helperText: dateTouched && eventDetails.date === null ? 'שדה חובה' : '',
                  inputProps: { style: { direction: 'rtl', textAlign: 'right' } },
                  sx: {
                    '& .MuiOutlinedInput-root': { direction: 'rtl' },
                    // Keep the calendar trigger icon a consistent size + spacing.
                    '& .MuiInputAdornment-root': { ml: 0, mr: 0.5 },
                    '& .MuiSvgIcon-root': { fontSize: 20 },
                  },
                },
                // The popup must render RTL so the month-nav arrows and layout align.
                desktopPaper: { sx: { direction: 'rtl' } },
                mobilePaper: { sx: { direction: 'rtl' } },
                popper: { sx: { direction: 'rtl' } },
                // Normalise the prev/next-month arrow buttons (were unsized/clipped).
                previousIconButton: { size: 'small', sx: { color: 'text.secondary' } },
                nextIconButton: { size: 'small', sx: { color: 'text.secondary' } },
                switchViewButton: { size: 'small' },
              }}
            />
          </LocalizationProvider>
        </Box>
        <Box>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
            שעת האירוע *
          </Typography>
          <TextField
            fullWidth
            required
            type="time"
            value={eventDetails.time}
            onChange={(e) => setEventDetails({ ...eventDetails, time: e.target.value })}
            error={!eventDetails.time || eventDetails.time.trim().length === 0}
            helperText={(!eventDetails.time || eventDetails.time.trim().length === 0) ? 'שדה חובה' : ''}
            inputProps={{ 
              style: { direction: 'ltr', textAlign: 'center' },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                direction: 'ltr',
              },
            }}
          />
        </Box>
      </Box>

      {/* מיקום */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
          מיקום האירוע
        </Typography>
        <ClickAwayListener onClickAway={() => setShowLocationSuggestions(false)}>
          <Box sx={{ position: 'relative' }}>
            <TextField
              fullWidth
              inputRef={placesAutocomplete.inputRef}
              placeholder={placesAutocomplete.isLoaded ? "הקלד כתובת או שם מקום..." : "טוען חיפוש כתובות..."}
              value={placesAutocomplete.inputValue}
              autoComplete="off"
              onChange={(e) => {
                placesAutocomplete.setInputValue(e.target.value);
                setShowLocationSuggestions(true);
                if (!e.target.value) {
                  setEventDetails({ ...eventDetails, location: null });
                }
              }}
              onFocus={() => setShowLocationSuggestions(true)}
              inputProps={{
                style: { direction: 'rtl', textAlign: 'right' },
                maxLength: 200,
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  direction: 'rtl',
                },
              }}
            />
            {showLocationSuggestions && placesAutocomplete.suggestions.length > 0 && (
              <Paper
                elevation={4}
                sx={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 1300,
                  mt: 0.5,
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {placesAutocomplete.suggestions.map((suggestion) => (
                  <MenuItem
                    key={suggestion.placeId}
                    onClick={() => {
                      placesAutocomplete.selectSuggestion(suggestion.placeId);
                      setShowLocationSuggestions(false);
                    }}
                    sx={{ display: 'block', textAlign: 'right', direction: 'rtl', whiteSpace: 'normal', py: 1 }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {suggestion.primaryText}
                    </Typography>
                    {suggestion.secondaryText && (
                      <Typography variant="caption" color="text.secondary">
                        {suggestion.secondaryText}
                      </Typography>
                    )}
                  </MenuItem>
                ))}
              </Paper>
            )}
          </Box>
        </ClickAwayListener>
        {eventDetails.location && (
          <Typography variant="caption" color="success.main" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
            ✓ {eventDetails.location.name || eventDetails.location.address}
          </Typography>
        )}
      </Box>

          </>
        )}
      </Box>
    );
  };

  const renderScheduleStep = () => {
    // Sort campaigns by offsetDays descending (30, 7, 1, -1). While the customize
    // editor is open, render in the order frozen at open time (scheduleOrder) so
    // editing an offset never re-sorts rows under the user's cursor.
    const byOffsetDesc = [...campaigns].sort((a, b) => b.offsetDays - a.offsetDays);
    const sortedCampaigns = scheduleOrder
      ? [
          ...scheduleOrder
            .map((label) => campaigns.find((c) => c.label === label))
            .filter((c): c is CampaignSchedule => Boolean(c)),
          ...campaigns.filter((c) => !scheduleOrder.includes(c.label)),
        ]
      : byOffsetDesc;
    const enabledCampaigns = sortedCampaigns.filter((c) => c.enabled);

    // Did the Adaptive Timeline Engine have to compress the plan to fit a short window?
    const wasCompressed = enabledCampaigns.some((c) => c.note);

    // Default: show the recommended timeline as a clean checklist. The wizard's
    // "הבא" button = "keep recommended"; "התאמה אישית" reveals the editable grid.
    if (!scheduleCustomize) {
      return (
        <Box>
          {renderPreparedHeader(
            'מתי ניצור קשר עם האורחים?',
            `סידרנו תזמון חכם ל${warmEventRef()} - מההזמנה הראשונה ועד התודה שאחרי. אפשר להשאיר כך, או להתאים בקליק.`
          )}
          {wasCompressed && (
            <Alert severity="info" icon={<AutoAwesomeIcon />} sx={{ mb: 2, borderRadius: 2, textAlign: 'right', direction: 'rtl' }}>
              המועד קרוב, אז התאמנו את לוח הזמנים כך שכל הודעה עדיין תצא בזמן - בלי הודעות בעבר ובסדר הנכון.
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {enabledCampaigns.map((c) => (
              <Paper
                key={c.label}
                variant="outlined"
                sx={{ p: 2, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5, direction: 'rtl' }}
              >
                <CheckCircleIcon sx={{ color: 'success.main', fontSize: 22, flexShrink: 0 }} />
                <Box sx={{ flex: 1, textAlign: 'right' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>{c.title || c.label}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {describeCampaignTiming(c.offsetDays, c.time)}
                  </Typography>
                  {c.note && (
                    <Typography variant="caption" sx={{ color: 'primary.main', display: 'block', mt: 0.25 }}>
                      ✨ {c.note}
                    </Typography>
                  )}
                </Box>
              </Paper>
            ))}
          </Box>
          <Button
            onClick={() => setScheduleCustomize(true)}
            startIcon={<TuneIcon />}
            sx={{ mt: 2.5 }}
          >
            התאמה אישית של לוח הזמנים
          </Button>
        </Box>
      );
    }

    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, direction: 'rtl', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            התאמה אישית - הפעילו, כבו או שנו תזמון לכל הודעה.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color="primary"
            onClick={() => setScheduleCustomize(false)}
            startIcon={<AutoAwesomeIcon />}
            sx={{ fontWeight: 600, borderRadius: 999, '& .MuiButton-startIcon': { ml: 0.75, mr: -0.25 } }}
          >
            חזרה ללו״ז המומלץ
          </Button>
        </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Header row */}
        <Box 
          sx={{ 
            display: { xs: 'none', sm: 'grid' },
            gridTemplateColumns: 'auto 1fr 140px 140px auto',
            gap: 2,
            px: 2,
            py: 1.5,
            direction: 'rtl',
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Box></Box>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            קמפיין
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', textAlign: 'center' }}>
            ימים לפני/אחרי
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', textAlign: 'center' }}>
            שעה
          </Typography>
          <Box></Box>
        </Box>

        {/* Campaign rows */}
        {sortedCampaigns.map((c, idx) => {
          const originalIdx = campaigns.findIndex(camp => camp.label === c.label && camp.offsetDays === c.offsetDays);
          const isBefore = c.offsetDays > 0;
          const isAfter = c.offsetDays < 0;
          
          return (
            <Paper 
              key={c.label} 
              variant="outlined" 
              sx={{
                p: { xs: 1.5, sm: 1.5 },
                borderRadius: 2,
                borderWidth: 1,
                borderColor: theme.palette.divider,
                bgcolor: 'transparent',
                transition: 'all 0.15s ease',
                '&:hover': {
                  borderColor: alpha(theme.palette.primary.main, 0.25),
                  bgcolor: alpha(theme.palette.primary.main, 0.03),
                },
              }}
            >
              <Box sx={{ 
                display: { xs: 'flex', sm: 'grid' },
                flexDirection: { xs: 'column', sm: 'row' },
                gridTemplateColumns: { sm: 'auto 1fr 140px 140px auto' },
                gap: { xs: 1.5, sm: 2 },
                alignItems: 'center',
                direction: 'rtl',
              }}>
                {/* Icon - hidden on mobile, shown on desktop */}
                <Box sx={{ display: { xs: 'none', sm: 'flex' }, justifyContent: 'center' }}>
                  {c.enabled ? (
                    <NotificationsActiveIcon 
                      sx={{ 
                        color: isBefore ? theme.palette.primary.main : isAfter ? theme.palette.success.main : theme.palette.text.secondary,
                        fontSize: 20,
                      }} 
                    />
                  ) : (
                    <NotificationsOffIcon 
                      sx={{ 
                        color: theme.palette.text.disabled,
                        fontSize: 20,
                      }} 
                    />
                  )}
                </Box>

                {/* Label and Switch row on mobile */}
                <Box sx={{ 
                  display: { xs: 'flex', sm: 'block' },
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexDirection: 'row-reverse',
                  gap: { xs: 1, sm: 0 },
                }}>
                  <Box sx={{ display: { xs: 'flex', sm: 'none' }, alignItems: 'center', gap: 1, flexDirection: 'row-reverse' }}>
                    {c.enabled ? (
                      <NotificationsActiveIcon 
                        sx={{ 
                          color: isBefore ? theme.palette.primary.main : isAfter ? theme.palette.success.main : theme.palette.text.secondary,
                          fontSize: 18,
                        }} 
                      />
                    ) : (
                      <NotificationsOffIcon 
                        sx={{ 
                          color: theme.palette.text.disabled,
                          fontSize: 18,
                        }} 
                      />
                    )}
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        fontWeight: 500,
                        color: c.enabled ? 'text.primary' : 'text.disabled',
                        textDecoration: c.enabled ? 'none' : 'line-through',
                      }}
                    >
                      {c.label}
                    </Typography>
                  </Box>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      display: { xs: 'none', sm: 'block' },
                      fontWeight: 500,
                      color: c.enabled ? 'text.primary' : 'text.disabled',
                      textDecoration: c.enabled ? 'none' : 'line-through',
                    }}
                  >
                    {c.label}
                  </Typography>
                  {/* Switch on mobile - shown here */}
                  <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'center' }}>
                    <Switch
                      checked={c.enabled}
                      onChange={(e) => {
                        const updated = [...campaigns];
                        updated[originalIdx] = { ...c, enabled: e.target.checked };
                        setCampaigns(updated);
                      }}
                      size="small"
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': {
                          color: isBefore ? theme.palette.primary.main : isAfter ? theme.palette.success.main : theme.palette.primary.main,
                        },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                          bgcolor: isBefore ? theme.palette.primary.main : isAfter ? theme.palette.success.main : theme.palette.primary.main,
                        },
                      }}
                    />
                  </Box>
                </Box>

                {/* Days and Time inputs - same row on mobile */}
                <Box sx={{ 
                  display: { xs: 'grid', sm: 'contents' },
                  gridTemplateColumns: { xs: '1fr 1fr', sm: 'none' },
                  gap: { xs: 1.5, sm: 0 },
                  width: { xs: '100%', sm: 'auto' },
                }}>
                  {/* Days input */}
                  <Box>
                    <TextField
                      fullWidth
                      type="number"
                      value={offsetDrafts[c.label] ?? String(c.offsetDays)}
                      onChange={(e) =>
                        // Buffer keystrokes locally; commit on blur so a half-typed
                        // (or cleared) value never becomes offsetDays 0 mid-edit.
                        setOffsetDrafts((prev) => ({ ...prev, [c.label]: e.target.value }))
                      }
                      onBlur={() => {
                        const raw = offsetDrafts[c.label];
                        setOffsetDrafts((prev) => {
                          const next = { ...prev };
                          delete next[c.label];
                          return next;
                        });
                        if (raw === undefined) return;
                        const parsed = Number(raw);
                        // Empty / invalid input = unchanged - never coerce to 0.
                        if (raw.trim() === '' || Number.isNaN(parsed) || parsed === c.offsetDays) return;
                        const updated = [...campaigns];
                        // Manual edit overrides the engine's resolved time; drop it so
                        // the order payload recomputes scheduled_at from this offset.
                        updated[originalIdx] = { ...c, offsetDays: parsed, scheduledAt: undefined };
                        setCampaigns(updated);
                      }}
                      disabled={!c.enabled}
                      size="small"
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <CalendarTodayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          </InputAdornment>
                        ),
                        style: { direction: 'rtl', textAlign: 'right' },
                      }}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          bgcolor: c.enabled ? 'background.paper' : 'transparent',
                          direction: 'rtl',
                        },
                      }}
                    />
                  </Box>

                  {/* Time input */}
                  <Box>
                    <TextField
                      fullWidth
                      type="time"
                      value={c.time}
                      onChange={(e) => {
                        const updated = [...campaigns];
                        updated[originalIdx] = { ...c, time: e.target.value, scheduledAt: undefined };
                        setCampaigns(updated);
                      }}
                      disabled={!c.enabled}
                      size="small"
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <AccessTimeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          </InputAdornment>
                        ),
                        style: { direction: 'ltr', textAlign: 'center' },
                      }}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          bgcolor: c.enabled ? 'background.paper' : 'transparent',
                        },
                      }}
                    />
                  </Box>
                </Box>

                {/* Switch - hidden on mobile (shown in label row), visible on desktop */}
                <Box sx={{ display: { xs: 'none', sm: 'flex' }, justifyContent: 'center' }}>
                  <Switch
                    checked={c.enabled}
                    onChange={(e) => {
                      const updated = [...campaigns];
                      updated[originalIdx] = { ...c, enabled: e.target.checked };
                      setCampaigns(updated);
                    }}
                    size="small"
                    sx={{
                      '& .MuiSwitch-switchBase.Mui-checked': {
                        color: isBefore ? theme.palette.primary.main : isAfter ? theme.palette.success.main : theme.palette.primary.main,
                      },
                      '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                        bgcolor: isBefore ? theme.palette.primary.main : isAfter ? theme.palette.success.main : theme.palette.primary.main,
                      },
                    }}
                  />
                </Box>
              </Box>
            </Paper>
          );
        })}
      </Box>
      </Box>
    );
  };

  // True when this brit/brita keeps the baby's name a secret and the campaign is
  // the guest invitation - the one place we add the playful "secret" flavor line.
  const isSecretInvite = (label: string): boolean =>
    label === INVITE_CAMPAIGN_LABEL &&
    subjects.secretName &&
    (eventDetails.type === 'brit' || eventDetails.type === 'brita');

  // Weave a single, classy secret-themed sentence into the invitation copy.
  // Never leaks a name (there is none in secret mode); appended once, idempotently.
  const withSecretFlavor = (template: PreviewMsg | null, label: string): PreviewMsg | null => {
    if (!template || !isSecretInvite(label)) return template;
    if (template.body.includes(BRIT_SECRET_INVITE_LINE)) return template;
    return { ...template, body: `${template.body}\n\n${BRIT_SECRET_INVITE_LINE}` };
  };

  // The base (recommended/selected) template for a campaign, ignoring any custom
  // override. Resolved from the catalog by the campaign's canonical stage.
  const getBaseTemplate = (c: CampaignSchedule): PreviewMsg | null => {
    const id = selectedTemplates[c.label] || defaultFor(c.stage)?.id;
    const base = templatesFor(c.stage).find((t) => t.id === id) || defaultFor(c.stage) || null;
    const msg: PreviewMsg | null = base ? { id: base.id, title: base.title, body: base.body } : null;
    return withSecretFlavor(msg, c.label);
  };

  // The message actually shown/used for a campaign - a custom override if present,
  // otherwise the base template. Both are PreviewMsg (one definition for preview + send).
  const getChosenMessage = (c: CampaignSchedule): PreviewMsg | null => {
    const base = getBaseTemplate(c);
    if (c.label in customMessages) {
      return {
        id: `custom:${c.label}`,
        title: customTitles[c.label] ?? base?.title ?? '',
        body: customMessages[c.label],
      };
    }
    return base;
  };

  const isCustomMessage = (label: string) => label in customMessages;

  const enableCustomMessage = (c: CampaignSchedule) => {
    const base = getBaseTemplate(c);
    setCustomMessages((prev) => ({ ...prev, [c.label]: prev[c.label] ?? (base?.body || '') }));
    setCustomTitles((prev) => ({ ...prev, [c.label]: prev[c.label] ?? (base?.title || '') }));
  };

  const clearCustomMessage = (label: string) => {
    setCustomMessages((prev) => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  };

  const renderTemplatesStep = () => {
    const activeCampaigns = campaigns.filter(c => c.enabled);
    const templateVariables = getTemplateVariables(catalog, eventDetails, eventDetails.inviters, subjects);

    // Default: show the recommended message for each campaign as a ready preview.
    if (!templatesCustomize) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {renderPreparedHeader(
            'איך תרצו להזמין את האורחים?',
            'כתבנו עבורכם הודעות חמות ואישיות שמביאות יותר אישורי הגעה. אפשר לאשר - או לכתוב משלכם.'
          )}
          {activeCampaigns.map((campaign) => {
            const chosen = getChosenMessage(campaign);
            if (!chosen) return null;
            return (
              <Box key={campaign.label} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, direction: 'rtl', flexWrap: 'wrap' }}>
                  <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{campaign.label}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>· {renderBody(chosen.title, templateVariables)}</Typography>
                </Box>
                <Box
                  sx={{
                    bgcolor: theme.palette.mode === 'dark' ? alpha('#1a2e1a', 0.5) : '#ece5dd',
                    p: 2,
                    borderRadius: 2,
                    maxWidth: 380,
                  }}
                >
                  <WhatsAppBubble template={chosen} variables={templateVariables} />
                </Box>
              </Box>
            );
          })}
          <Button
            onClick={() => setTemplatesCustomize(true)}
            startIcon={<TuneIcon />}
            sx={{ alignSelf: 'flex-start' }}
          >
            התאמת ההודעות
          </Button>
        </Box>
      );
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', direction: 'rtl', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            בחרו את הנוסח שהכי מדבר אליכם לכל הודעה.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color="primary"
            onClick={() => setTemplatesCustomize(false)}
            startIcon={<AutoAwesomeIcon />}
            sx={{ fontWeight: 600, borderRadius: 999, '& .MuiButton-startIcon': { ml: 0.75, mr: -0.25 } }}
          >
            חזרה למומלץ
          </Button>
        </Box>

        {activeCampaigns.map((campaign) => {
          const campaignTemplates = templatesFor(campaign.stage);
          const selectedTemplateId = selectedTemplates[campaign.label];
          const custom = isCustomMessage(campaign.label);

          return (
            <Box key={campaign.label} sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                {campaign.label}
              </Typography>
              
              {/* Fixed-size cards in a horizontal scroller at every breakpoint, so
                  more than ~2 variants never get smashed into narrow columns. */}
              <Box sx={{
                display: 'flex',
                gap: 2,
                minWidth: 0,
                maxWidth: '100%',
                overflowX: 'auto',
                overflowY: 'hidden',
                scrollBehavior: 'smooth',
                scrollSnapType: 'x mandatory',
                pb: 1,
                px: 1,
                mx: { xs: -2, sm: 0 },
                '&::-webkit-scrollbar': {
                  display: 'none',
                },
                scrollbarWidth: 'none',
              }}>
                {campaignTemplates.map((template) => {
                  const isSelected = !custom && selectedTemplateId === template.id;
                  const isDefault = template.is_default === true;
                  
                  return (
                    <Paper
                      key={template.id}
                      variant="outlined"
                      onClick={() => {
                        clearCustomMessage(campaign.label);
                        setSelectedTemplates({
                          ...selectedTemplates,
                          [campaign.label]: template.id,
                        });
                      }}
                      sx={{
                        p: 2,
                        cursor: 'pointer',
                        borderRadius: 3,
                        borderWidth: isSelected ? 2 : 1,
                        borderColor: isSelected ? 'primary.main' : isDefault ? 'success.main' : 'divider',
                        bgcolor: isSelected
                          ? alpha(theme.palette.primary.main, 0.06)
                          : isDefault
                          ? alpha(theme.palette.success.main, 0.04)
                          : 'transparent',
                        transition: 'all 0.2s ease',
                        minWidth: { xs: '85%', sm: 300 },
                        width: { xs: '85%', sm: 300 },
                        flexShrink: 0,
                        scrollSnapAlign: 'start',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                        '&:hover': {
                          borderColor: 'primary.main',
                          bgcolor: alpha(theme.palette.primary.main, 0.04),
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
                          }}
                        />
                      )}
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5, flexDirection: 'row-reverse', direction: 'rtl' }}>
                        <Typography variant="body2" fontWeight={600} sx={{ textAlign: 'right', direction: 'rtl', flex: 1 }}>
                          {template.title}
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
                          bgcolor: theme.palette.mode === 'dark' ? alpha('#1a2e1a', 0.5) : '#ece5dd',
                          p: 2,
                          borderRadius: 2,
                          minHeight: 150,
                          flexGrow: 1,
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

              {/* Write your own message */}
              {!custom ? (
                <Button
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={() => enableCustomMessage(campaign)}
                  sx={{ alignSelf: 'flex-start', borderRadius: 2, '& .MuiButton-startIcon': { ml: 0.75, mr: -0.25 } }}
                >
                  כתבו הודעה משלכם
                </Button>
              ) : (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, borderColor: 'primary.main', borderWidth: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexDirection: 'row-reverse', direction: 'rtl' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexDirection: 'row-reverse' }}>
                      <EditIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                      <Typography variant="body2" fontWeight={700}>הודעה מותאמת אישית</Typography>
                    </Box>
                    <Button size="small" onClick={() => clearCustomMessage(campaign.label)} sx={{ color: 'text.secondary' }}>
                      ביטול
                    </Button>
                  </Box>
                  <CustomMessageEditor
                    title={customTitles[campaign.label] ?? getBaseTemplate(campaign)?.title ?? ''}
                    onTitleChange={(v) =>
                      setCustomTitles((prev) => ({ ...prev, [campaign.label]: v }))
                    }
                    value={customMessages[campaign.label] ?? ''}
                    onChange={(v) =>
                      setCustomMessages((prev) => ({ ...prev, [campaign.label]: v }))
                    }
                    groups={variableGroups(catalog, eventDetails.type)}
                    blocks={CONTENT_BLOCKS}
                    variables={templateVariables}
                    onValidityChange={(valid) =>
                      setCustomMsgValid((prev) =>
                        prev[campaign.label] === valid ? prev : { ...prev, [campaign.label]: valid }
                      )
                    }
                  />
                  {(() => {
                    // A custom message becomes a new WhatsApp template that Meta must
                    // approve before it can be sent. Warn if the campaign is scheduled
                    // too soon for that approval to realistically complete.
                    const c = campaigns.find((x) => x.label === campaign.label);
                    const sendAt = c?.scheduledAt
                      ? new Date(c.scheduledAt)
                      : eventDetails.date
                        ? eventDetails.date.subtract(c?.offsetDays || 0, 'day').toDate()
                        : null;
                    const APPROVAL_LEAD_MS = 24 * 60 * 60 * 1000; // ~1 day for WhatsApp/Meta
                    const tooSoon = sendAt ? sendAt.getTime() - Date.now() < APPROVAL_LEAD_MS : false;
                    return tooSoon ? (
                      <Alert severity="warning" sx={{ mt: 1.5, textAlign: 'right', direction: 'rtl' }}>
                        ההודעה המותאמת שלכם דורשת אישור WhatsApp, שעשוי לקחת עד 24 שעות. מועד השליחה קרוב מדי - נשלח אותה ברגע שתאושר, או שאפשר להשתמש באחת ההודעות המוכנות שמאושרות מראש.
                      </Alert>
                    ) : (
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', textAlign: 'right' }}>
                        ℹ️ הודעה מותאמת עוברת אישור WhatsApp לפני השליחה (בדרך כלל עד 24 שעות).
                      </Typography>
                    );
                  })()}
                  <Box
                    sx={{
                      bgcolor: theme.palette.mode === 'dark' ? alpha('#1a2e1a', 0.5) : '#ece5dd',
                      p: 2,
                      borderRadius: 2,
                      mt: 2,
                      maxWidth: 380,
                    }}
                  >
                    <WhatsAppBubble
                      template={getChosenMessage(campaign)!}
                      variables={templateVariables}
                    />
                  </Box>
                </Paper>
              )}
            </Box>
          );
        })}
      </Box>
    );
  };

  const renderReviewStep = () => {
    // selectedPlan is already defined in component scope via useMemo
    const eventTypeMap = (t: string) => eventTypeLabel(catalog, t);
    // Resolve template variables so the summary shows real titles, never raw {{...}}.
    const reviewVariables = getTemplateVariables(catalog, eventDetails, eventDetails.inviters, subjects);
    
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {renderInfoBox()}
        
        <Typography variant="h5" fontWeight={800} sx={{ textAlign: 'center', mb: 1 }}>
          האירוע שלכם כמעט מוכן 🎉
        </Typography>

        {/* Package and Price */}
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexDirection: 'row' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="h6" fontWeight={700}>
                {selectedPlan?.title || 'לא נבחרה'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedPlan?.description || ''}
              </Typography>
            </Box>
            {selectedPlan?.price
              ? <PriceTag price={selectedPlan.price} size="md" align="right" color={selectedPlan?.color || undefined} />
              : <Typography variant="h4" fontWeight={800}>-</Typography>}
          </Box>
          <Divider sx={{ my: 2 }} />
          
          {/* Event Details */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, textAlign: 'right' }}>
            פרטי האירוע
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>שם האירוע:</Typography>
              <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>{eventDetails.name || '-'}</Typography>
            </Box>
            {eventDetails.type && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>סוג:</Typography>
                <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>{eventTypeMap(eventDetails.type) || 'אחר'}</Typography>
              </Box>
            )}
            {(eventDetails.date || eventDetails.time) && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>תאריך ושעה:</Typography>
                <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>
                  {eventDetails.date ? eventDetails.date.format('DD/MM/YYYY') : '-'} {eventDetails.time || '-'}
                </Typography>
              </Box>
            )}
            {eventDetails.location && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>מיקום:</Typography>
                <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>
                  {eventDetails.location.name || eventDetails.location.address}
                </Typography>
              </Box>
            )}
            {eventDetails.inviters.length > 0 && eventDetails.inviters.some(inv => inv.fn || inv.ln) && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>מזמינים:</Typography>
                <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>
                  {eventDetails.inviters
                    .filter(inv => inv.fn || inv.ln)
                    .map(inv => `${inv.fn} ${inv.ln}`.trim())
                    .join(', ')}
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Campaigns Summary */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, textAlign: 'right' }}>
            מה האורחים יקבלו
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, mb: 2 }}>
            {campaigns.filter(c => c.enabled).map((c) => {
              // Use the message actually chosen (custom override or base template, incl.
              // any secret-name flavor) and resolve its title - never show raw {{...}}.
              const chosen = getChosenMessage(c);
              const resolvedTitle = chosen
                ? renderBody(chosen.title, reviewVariables)
                : 'הודעה מותאמת';
              return (
                <Box key={c.label} sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row', gap: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{c.title || c.label}:</Typography>
                  <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>
                    {resolvedTitle} · {describeCampaignTiming(c.offsetDays, c.time)}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Paper>

        {/* Terms and Agreement */}
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, textAlign: 'right' }}>
            תנאים והסכמים
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8, textAlign: 'right' }}>
              • ביצוע התשלום מהווה הסכמה לתנאי השימוש והשירות
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8, textAlign: 'right' }}>
              • ניתן לבטל את ההזמנה עד 48 שעות לפני מועד האירוע
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8, textAlign: 'right' }}>
              • השירות כולל תמיכה טכנית במהלך תקופת האירוע
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8, textAlign: 'right' }}>
              • כל המידע שמוזן נשמר בצורה מאובטחת ומאוחסן בהתאם למדיניות הפרטיות
            </Typography>
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                sx={{
                  '&.Mui-checked': {
                    color: selectedPlan?.color || 'primary.main',
                  },
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ textAlign: 'right', direction: 'rtl' }}>
                קראתי ואני מסכים/ה{' '}
                <Link href="/terms" target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>
                  לתנאי השימוש
                </Link>
                {' '}ול
                <Link href="/privacy" target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>
                  מדיניות הפרטיות
                </Link>
                .
              </Typography>
            }
            sx={{ 
              justifyContent: 'flex-end',
              direction: 'rtl',
              alignItems: 'flex-start',
              m: 0,
            }}
          />
        </Paper>

        {/* Total Price */}
        <Paper
          variant="outlined"
          sx={{
            p: 3,
            borderRadius: 3,
            bgcolor: selectedPlan?.color ? alpha(selectedPlan.color, 0.06) : 'transparent',
            borderColor: selectedPlan?.color || 'divider',
            borderWidth: 2,
          }}
        >
          {selectedPlan?.price
            ? <PriceSummary price={selectedPlan.price} />
            : (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" fontWeight={700}>סה"כ לתשלום</Typography>
                <Typography variant="h4" fontWeight={800}>-</Typography>
              </Box>
            )}
        </Paper>
      </Box>
    );
  };

  // Total-price block, shared by the payment confirmation + edit views.
  const renderPaymentTotal = () => (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        bgcolor: selectedPlan?.color ? alpha(selectedPlan.color, 0.06) : 'transparent',
        borderColor: selectedPlan?.color || 'divider',
        borderWidth: 2,
        borderRadius: 3,
      }}
    >
      {selectedPlan?.price
        ? <PriceSummary price={selectedPlan.price} />
        : (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" fontWeight={700}>סה"כ לתשלום</Typography>
            <Typography variant="h5" fontWeight={800}>-</Typography>
          </Box>
        )}
    </Paper>
  );

  const renderPaymentStep = () => {
    // We already collected the buyer's identity earlier in the flow (or from their
    // logged-in account). Default to a clean confirmation of those known values
    // instead of asking the user to type everything again; "עריכה" reveals the form.
    const hasIdentity = Boolean(
      paymentData.firstName.trim() && paymentData.lastName.trim() && paymentData.phone.trim()
    );
    // An OTP is sent unless the logged-in account's phone matches the buyer phone
    // (then submit goes straight to payment). Mirrors handlePaymentSubmit.
    const buyerPhoneNormalized = paymentData.phone.trim()
      ? normalizePhoneNumber(paymentData.phone, paymentData.countryCode)
      : '';
    const loggedInPhone = (user?.phone || '').replace(/\s+/g, '');
    const otpWillBeSent = !(user && loggedInPhone && loggedInPhone === buyerPhoneNormalized);

    if (hasIdentity && !editIdentity) {
      const fullName = `${paymentData.firstName} ${paymentData.lastName}`.trim();
      const detailRow = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, direction: 'rtl' }}>
          {icon}
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{value}</Typography>
          </Box>
        </Box>
      );
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box sx={{ textAlign: 'center', mb: 1 }}>
            <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>עוד רגע וזה אמיתי 🎉</Typography>
            <Typography variant="body2" color="text.secondary">
              {otpWillBeSent ? 'אלו הפרטים שלכם - נאמת אותם בקצרה ונמשיך.' : 'אלו הפרטים שלכם - נשאר רק לאשר.'}
            </Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 }, borderRadius: 3 }}>
            {paymentErrors.form && (
              <Alert severity="error" sx={{ mb: 2, textAlign: 'right' }}>{paymentErrors.form}</Alert>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, direction: 'rtl' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>הפרטים שלכם</Typography>
              <Button size="small" startIcon={<EditIcon />} onClick={() => setEditIdentity(true)} sx={{ '& .MuiButton-startIcon': { ml: 0.5, mr: -0.25 } }}>
                עריכה
              </Button>
            </Box>
            <Box sx={{ display: 'grid', gap: 2 }}>
              {detailRow(<PersonIcon sx={{ color: 'text.secondary' }} />, 'שם מלא', fullName)}
              {detailRow(
                <PhoneIcon sx={{ color: 'text.secondary' }} />,
                'טלפון',
                // Bidi-isolate the phone so "+972 05..." doesn't get mangled in RTL.
                <Box component="span" dir="ltr" sx={{ unicodeBidi: 'isolate', display: 'inline-block' }}>
                  {`${paymentData.countryCode} ${paymentData.phone}`.trim()}
                </Box>
              )}
              {paymentData.email.trim() && detailRow(<EmailIcon sx={{ color: 'text.secondary' }} />, 'אימייל', paymentData.email.trim())}
            </Box>
          </Paper>

          {renderPaymentTotal()}

          {otpWillBeSent && (
            <Alert severity="info" sx={{ textAlign: 'right' }}>
              נשלח לכם קוד אימות קצר בוואטסאפ - וכבר נחזיר אתכם לכאן להמשך.
            </Alert>
          )}
        </Box>
      );
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
            עוד רגע וזה אמיתי 🎉
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user
              ? 'נשאר רק לאשר - והאירוע יוצא לדרך.'
              : 'כמה פרטים אחרונים ונשמור לכם את האירוע מוכן ומחכה.'}
          </Typography>
        </Box>

        <Paper 
          variant="outlined" 
          sx={{ 
            p: { xs: 3, md: 4 }, 
            borderRadius: 3,
            width: '100%',
          }}
        >
          <Box component="form" id="payment-form" onSubmit={handlePaymentSubmit}>
            {paymentErrors.form && (
              <Alert severity="error" sx={{ mb: 3, textAlign: 'right' }}>
                {paymentErrors.form}
              </Alert>
            )}

            <Box sx={{ display: 'grid', gap: 3, mb: 3 }}>
              {/* First Name */}
              <TextField
                fullWidth
                label="שם פרטי"
                value={paymentData.firstName}
                onChange={(e) => {
                  setPaymentData({ ...paymentData, firstName: e.target.value });
                  setPaymentErrors({ ...paymentErrors, firstName: '' });
                }}
                error={!!paymentErrors.firstName}
                helperText={paymentErrors.firstName}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonIcon sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                  },
                }}
              />

              {/* Last Name */}
              <TextField
                fullWidth
                label="שם משפחה"
                value={paymentData.lastName}
                onChange={(e) => {
                  setPaymentData({ ...paymentData, lastName: e.target.value });
                  setPaymentErrors({ ...paymentErrors, lastName: '' });
                }}
                error={!!paymentErrors.lastName}
                helperText={paymentErrors.lastName}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonIcon sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                  },
                }}
              />

              {/* Phone */}
              <Box sx={{ display: 'flex', gap: 1, flexDirection: 'row-reverse' }}>
                <TextField
                  select
                  value={paymentData.countryCode}
                  onChange={(e) => setPaymentData({ ...paymentData, countryCode: e.target.value })}
                  sx={{
                    minWidth: 120,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                    },
                  }}
                  SelectProps={{
                    // Bidi-isolate the dial code so "+972" renders correctly in RTL.
                    renderValue: (value) => (
                      <Box component="span" dir="ltr" sx={{ unicodeBidi: 'isolate', display: 'inline-block' }}>
                        {(value as string) || '+972'}
                      </Box>
                    ),
                  }}
                  inputProps={{ style: { direction: 'rtl', textAlign: 'right', fontSize: 13 } }}
                >
                  {countryOptions.map((option) => (
                    <MenuItem key={option.code + option.dialCode} value={option.dialCode}>
                      {option.flag} {option.name} ({option.dialCode})
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  fullWidth
                  type="tel"
                  label="מספר טלפון"
                  value={paymentData.phone}
                  onChange={(e) => {
                    setPaymentData({ ...paymentData, phone: e.target.value });
                    setPaymentErrors({ ...paymentErrors, phone: '' });
                  }}
                  error={!!paymentErrors.phone}
                  helperText={paymentErrors.phone}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PhoneIcon sx={{ color: 'text.secondary' }} />
                      </InputAdornment>
                    ),
                  }}
                  inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                    },
                  }}
                />
              </Box>

              {/* Email */}
              <TextField
                fullWidth
                type="email"
                label="אימייל (אופציונלי)"
                value={paymentData.email}
                onChange={(e) => {
                  setPaymentData({ ...paymentData, email: e.target.value });
                  setPaymentErrors({ ...paymentErrors, email: '' });
                }}
                error={!!paymentErrors.email}
                helperText={paymentErrors.email}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailIcon sx={{ color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                  },
                }}
              />
            </Box>

            {/* Total Price Display */}
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 3,
                bgcolor: selectedPlan?.color ? alpha(selectedPlan.color, 0.06) : 'transparent',
                borderColor: selectedPlan?.color || 'divider',
                borderWidth: 2,
                borderRadius: 3,
              }}
            >
              {selectedPlan?.price
                ? <PriceSummary price={selectedPlan.price} />
                : (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6" fontWeight={700}>סה"כ לתשלום</Typography>
                    <Typography variant="h5" fontWeight={800}>-</Typography>
                  </Box>
                )}
            </Paper>

            {otpWillBeSent && (
              <Alert severity="info" sx={{ mb: 2, textAlign: 'right' }}>
                נשלח לכם קוד אימות קצר בוואטסאפ - וכבר נחזיר אתכם לכאן להמשך.
              </Alert>
            )}
          </Box>
        </Paper>
      </Box>
    );
  };

  const renderStepContent = () => {
    if (activeStep === 0) return renderPackageStep();
    if (activeStep === 1) return renderEventStep();
    if (activeStep === 2) return renderScheduleStep();
    if (activeStep === 3) return renderTemplatesStep();
    if (activeStep === 4) return renderReviewStep();
    if (activeStep === 5) return renderPaymentStep();
    return null;
  };

  const renderMilestoneTracker = () => (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        gap: 0,
        minWidth: 240,
        pr: 4,
      }}
    >
      {steps.map((step, index) => {
        const StepIcon = step.icon;
        const isCompleted = index < activeStep;
        const isActive = index === activeStep;
        const isUpcoming = index > activeStep;

        return (
          <Box key={index} sx={{ position: 'relative' }}>
            {/* Connecting line */}
            {index < steps.length - 1 && (
              <Box
                sx={{
                  position: 'absolute',
                  right: 11,
                  top: 40,
                  width: 2,
                  height: 60,
                  bgcolor: isCompleted ? theme.palette.success.main : theme.palette.divider,
                  zIndex: 0,
                }}
              />
            )}
            {/* Step content */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 2,
                py: 2,
                position: 'relative',
                zIndex: 1,
              }}
            >
              {/* Icon circle */}
              <Box
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: isCompleted
                    ? theme.palette.success.main
                    : isActive
                    ? theme.palette.primary.main
                    : theme.palette.action.disabledBackground,
                  color: isCompleted || isActive ? theme.palette.common.white : theme.palette.text.secondary,
                  flexShrink: 0,
                }}
              >
                {isCompleted ? (
                  <CheckIcon sx={{ fontSize: 16 }} />
                ) : (
                  <StepIcon sx={{ fontSize: 16 }} />
                )}
              </Box>
              {/* Text content */}
              <Box sx={{ flex: 1, direction: 'rtl' }}>
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: isActive ? 700 : isCompleted ? 600 : 400,
                    color: isCompleted
                      ? theme.palette.success.main
                      : isActive
                      ? theme.palette.primary.main
                      : theme.palette.text.secondary,
                    mb: 0.5,
                  }}
                >
                  {step.label}
                </Typography>
                {isCompleted && (
                  <Typography variant="caption" sx={{ color: theme.palette.success.main, fontWeight: 600 }}>
                    הושלם
                  </Typography>
                )}
                {isActive && (
                  <Typography variant="caption" sx={{ color: theme.palette.primary.main, fontWeight: 600 }}>
                    בתהליך
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box
        sx={{
          minHeight: '100vh',
          background: theme.palette.mode === 'dark'
            ? `radial-gradient(1200px 600px at 10% 0%, ${alpha(theme.palette.primary.dark, 0.15)} 0%, transparent 70%), radial-gradient(800px 500px at 90% 20%, ${alpha('#7c3aed', 0.1)} 0%, transparent 65%), ${theme.palette.background.default}`
            : `radial-gradient(1200px 600px at 10% 0%, #e8ecff 0%, #f0f4ff 40%, transparent 70%), radial-gradient(800px 500px at 90% 20%, #fce8f5 0%, #fef0f7 35%, transparent 65%), linear-gradient(180deg, #f7f8fb 0%, #f3f4fa 100%)`,
          py: { xs: 4, md: 6 },
        }}
      >
        <Container
          maxWidth="lg"
          sx={{
            py: { xs: 4, md: 6 },
            px: { xs: 2, sm: 3, md: 4 },
            bgcolor: 'transparent',
            overflow: { xs: 'visible', sm: 'visible' },
          }}
          dir="rtl"
        >
        <Box sx={{ mb: 4, textAlign: 'center' }}>
          <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
            בואו נארגן את האירוע שלכם ✨
          </Typography>
          <Typography variant="body1" color="text.secondary">
            כמה צעדים קצרים, ואנחנו נדאג שכל האורחים יידעו, יאשרו ויגיעו.
          </Typography>
        </Box>

        {/* Abandoned-wizard recovery: pick up exactly where you left off. */}
        {pendingDraft && (
          <Alert
            icon={<RestoreRoundedIcon />}
            severity="info"
            sx={{ mb: 4, borderRadius: 3, textAlign: 'right', direction: 'rtl', alignItems: 'center' }}
            action={
              <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                <Button color="inherit" size="small" onClick={discardDraft}>
                  אירוע חדש
                </Button>
                <Button variant="contained" size="small" onClick={restoreDraft} sx={{ fontWeight: 700 }}>
                  המשך מאיפה שעצרתי
                </Button>
              </Box>
            }
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              שמרנו את האירוע שהתחלתם להכין
              {(pendingDraft.eventDetails?.name as string) ? ` - ${pendingDraft.eventDetails?.name as string}` : ''}.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              אפשר להמשיך בדיוק מהמקום שעצרתם.
            </Typography>
          </Alert>
        )}

        {/* Mobile horizontal progress bar */}
        <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              שלב {activeStep + 1} מתוך {steps.length}
            </Typography>
          </Box>
          <Box
            sx={{
              width: '100%',
              height: 4,
              bgcolor: theme.palette.divider,
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                width: `${((activeStep + 1) / steps.length) * 100}%`,
                height: '100%',
                bgcolor: theme.palette.primary.main,
                transition: 'width 0.3s ease',
              }}
            />
          </Box>
        </Box>

        {/* Desktop layout with sidebar */}
        <Box sx={{ display: { xs: 'block', md: 'flex' }, gap: 4 }}>
          {renderMilestoneTracker()}

          {/* minWidth:0 lets this flex column shrink to the available width so inner
              horizontal scrollers (e.g. the template variant cards) scroll internally
              instead of widening the row and pushing the nav buttons off-screen. */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              ref={stepContentRef}
              tabIndex={-1}
              sx={{ mb: 3, minWidth: 0, outline: 'none' }}
              dir="rtl"
            >
              {renderStepContent()}
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexDirection: 'row-reverse' }}>
              {activeStep === steps.length - 1 ? (
                <Box sx={{ display: 'flex', gap: 2, flexDirection: 'row-reverse', width: '100%' }}>
                  <Button
                    onClick={(e) => {
                      e.preventDefault();
                      // The Free plan has no payment step - create the event directly.
                      if (selectedPackageId === 'free') {
                        handleCreateFree();
                      } else {
                        handlePaymentSubmit(e as any);
                      }
                    }}
                    variant="contained"
                    disabled={!canNext || paymentLoading || creatingFree}
                    sx={{
                      flex: 1,
                      minWidth: { xs: '120px', sm: '140px' },
                      bgcolor: selectedPlan?.color || 'primary.main',
                      '&:hover': {
                        bgcolor: selectedPlan?.color ? alpha(selectedPlan.color, 0.85) : 'primary.dark',
                      },
                      '&:disabled': {
                        bgcolor: theme.palette.action.disabledBackground,
                      },
                    }}
                  >
                    {(paymentLoading || creatingFree)
                      ? <CircularProgress size={24} color="inherit" />
                      : selectedPackageId === 'free' ? 'יוצרים את האירוע 🎉' : 'למעבר לתשלום מאובטח'}
                  </Button>
                </Box>
              ) : activeStep === steps.length - 2 ? (
                <Box sx={{ display: 'flex', gap: 1.5, flexDirection: { xs: 'column', sm: 'row-reverse' }, width: '100%' }}>
                  <Button
                    variant="contained"
                    onClick={handleNext}
                    disabled={!canNext}
                    sx={{
                      flex: 1,
                      minWidth: { xs: '120px', sm: '140px' },
                      bgcolor: selectedPlan?.color || 'primary.main',
                      '&:hover': {
                        bgcolor: selectedPlan?.color ? alpha(selectedPlan.color, 0.85) : 'primary.dark',
                      },
                    }}
                  >
                    מעולה, בואו נסיים
                  </Button>
                </Box>
              ) : (
                // On the package step keep the primary action fully hidden until a
                // package is chosen - selecting a card is the action; an empty/disabled
                // "next" is just noise.
                (activeStep !== 0 || !!selectedPackageId) && (
                  <Button
                    variant="contained"
                    onClick={handleNext}
                    disabled={!canNext}
                    sx={{
                      minWidth: { xs: '120px', sm: '140px' },
                    }}
                  >
                    ממשיכים
                  </Button>
                )
              )}
              {activeStep !== 0 && (
                <Button variant="text" onClick={handleBack}>
                  חזרה
                </Button>
              )}
            </Box>
            </Box>
          </Box>
        </Container>
      </Box>
    </LocalizationProvider>
  );
}

