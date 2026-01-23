import React, { useMemo, useState, useEffect } from 'react';
import {
  Box,
  Button,
  Container,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Chip,
  Paper,
  Divider,
  MenuItem,
  IconButton,
  InputAdornment,
  Alert,
  Checkbox,
  CircularProgress,
} from '@mui/material';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckIcon from '@mui/icons-material/Check';
import InventoryIcon from '@mui/icons-material/Inventory';
import EventIcon from '@mui/icons-material/Event';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DescriptionIcon from '@mui/icons-material/Description';
import VerifiedIcon from '@mui/icons-material/Verified';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import InfoIcon from '@mui/icons-material/Info';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { useTheme } from '@mui/material/styles';
import { usePlans, usePlanCampaigns, Plan, CampaignSchedule } from '../hooks/usePlans';
// CampaignSchedule type is now imported from usePlans hook
import { templates, getTemplatesByCampaign, getDefaultTemplateForCampaign, processTemplate, MessageTemplate } from '../config/templates';
import { useUser } from '../contexts/UserContext';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';
import PersonIcon from '@mui/icons-material/Person';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import { usePlacesAutocomplete } from '../hooks/usePlacesAutocomplete';

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

// Helper function removed - campaigns come from API via usePlanCampaigns hook

// Helper function to get variables from event details
const getTemplateVariables = (eventDetails: EventDetails, inviters: Inviter[]): Record<string, string> => {
  const inviterName = inviters.length > 0 && (inviters[0].fn || inviters[0].ln)
    ? `${inviters[0].fn} ${inviters[0].ln}`.trim()
    : 'המזמינים';
  
  const eventTypeMap: Record<string, string> = {
    'wedding': 'חתונה',
    'bar': 'בר מצווה',
    'bat': 'בת מצווה',
    'corporate': 'אירוע חברה',
    'other': 'אירוע',
  };
  
  return {
    'שם': 'דוד כהן', // דוגמה - בפועל זה יגיע מהאורח
    'שם_מזמין': inviterName,
    'סוג_אירוע': eventTypeMap[eventDetails.type] || 'אירוע',
    'תאריך': eventDetails.date ? eventDetails.date.format('DD/MM/YYYY') : '{{תאריך}}',
    'שעה': eventDetails.time || '{{שעה}}',
    'מיקום': eventDetails.location?.address || eventDetails.location?.name || '{{מיקום}}',
    'שם_אירוע': eventDetails.name || '{{שם_אירוע}}',
  };
};

// WhatsApp message bubble component (received message - white background)
const WhatsAppBubble = ({ template, variables }: { template: MessageTemplate; variables: Record<string, string> }) => {
  const processedBody = processTemplate(template, variables);
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
        overflow: 'hidden', // כדי שה-divider לא יבלוט
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
            mb: 0.5, 
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
      {template.cta && (
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
          <Typography
            variant="body2"
            sx={{
              color: '#0084ff',
              fontWeight: 500,
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
              fontSize: '11px',
              display: 'flex',
              justifyContent: 'flex-end',
              mt: 0.5,
              mb: 0.5,
              direction: 'ltr',
            }}
          >
            {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </Typography>
          <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.1)', mx: -1.5, px: 1.5 }}>
            {template.buttons.map((button, idx) => (
              <Box key={button.id}>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#0084ff',
                    fontWeight: 400,
                    textAlign: 'center',
                    py: 0.75,
                  }}
                >
                  {button.text}
                </Typography>
                {idx < template.buttons!.length - 1 && (
                  <Divider 
                    sx={{ 
                      borderColor: 'rgba(0,0,0,0.1)',
                      mx: -1.5, // Negative margin to extend to edges
                      width: 'calc(100% + 24px)', // Full width including padding
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
            fontSize: '11px',
            display: 'flex',
            justifyContent: 'flex-end',
            mt: 0.5,
            direction: 'ltr',
          }}
        >
          {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
        </Typography>
      )}
    </Box>
  );
};

const steps = [
  { label: 'חבילה', icon: InventoryIcon },
  { label: 'אירוע', icon: EventIcon },
  { label: 'תזמון', icon: ScheduleIcon },
  { label: 'תבניות', icon: DescriptionIcon },
  { label: 'אישור', icon: VerifiedIcon },
  { label: 'תשלום', icon: VerifiedIcon },
];

export default function EventWizard() {
  const navigate = useNavigate();
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
      const match = cleaned.match(/^\+(\d{1,4})(.*)$/);
      if (match) {
        const code = `+${match[1]}`;
        let local = match[2];
        // להצגה למשתמש אנחנו כן רוצים את ה־0 המוביל (למשל 052...)
        if (code === '+972' && local && !local.startsWith('0')) {
          local = `0${local}`;
        }
        return { code: code || fallbackCode, phone: local };
      }
    }
    return { code: fallbackCode, phone: cleaned };
  };

  const initialCountryCode = countryCodeFromQuery || getCountryCodeFromPhone(phoneFromQuery || '');
  const parsedPhone = splitPhone(phoneFromQuery || '', initialCountryCode);

  const normalizeEventTypeFromHero = (value: string | null, otherValue?: string) => {
    if (!value) return { type: '', other: '' };
    if (value === 'wedding') return { type: 'wedding', other: '' };
    if (value === 'bar-mitzvah') return { type: 'bar', other: '' };
    if (value === 'bat-mitzvah') return { type: 'bat', other: '' };
    if (value === 'corporate') return { type: 'corporate', other: '' };
    if (value === 'brit') return { type: 'other', other: otherValue || 'ברית' };
    if (value === 'other') return { type: 'other', other: otherValue || '' };
    return { type: 'other', other: otherValue || value };
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
  // Fetch plans from API
  const { plans, loading: plansLoading } = usePlans();
  const { campaigns: planCampaigns, loading: campaignsLoading } = usePlanCampaigns(selectedPackageId);
  
  const [campaigns, setCampaigns] = useState<CampaignSchedule[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Record<string, string>>({}); // campaign label -> template id
  const [agreedToTerms, setAgreedToTerms] = useState(false);
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

  // Places Autocomplete hook - must be at component level
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

  // Update campaigns when plan campaigns are loaded from API
  useEffect(() => {
    if (planCampaigns && planCampaigns.length > 0) {
      // Sort by offsetDays descending (30, 7, 1, -1)
      const sorted = [...planCampaigns].sort((a, b) => b.offsetDays - a.offsetDays);
      setCampaigns(sorted);
    } else if (selectedPackageId && !campaignsLoading) {
      // If no campaigns found and not loading, clear campaigns
      setCampaigns([]);
    }
  }, [planCampaigns, selectedPackageId, campaignsLoading]);

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
        eventDetails.time && 
        eventDetails.time.trim().length > 0 &&
        eventDetails.type && 
        eventDetails.type.trim().length > 0
      );
    }
    if (activeStep === 2) return true;
    if (activeStep === 3) {
      // שלב התבניות - לא חובה לבחור, אפשר להמשיך (התבנית הדיפולטית תיבחר אוטומטית)
      return true;
    }
    if (activeStep === 4) return agreedToTerms; // שלב הסיכום - צריך הסכמה לתנאים
    if (activeStep === 5) {
      // שלב התשלום - אם המשתמש מחובר, אפשר להמשיך. אם לא, צריך למלא פרטים
      if (user) return true;
      return !!(paymentData.firstName.trim() && paymentData.lastName.trim() && paymentData.phone.trim());
    }
    return true;
  }, [activeStep, selectedPackageId, eventDetails, campaigns, selectedTemplates, agreedToTerms, user, paymentData]);

  const handleNext = () => {
    // אם עוברים משלב התבניות (שלב 3), וודא שכל קמפיין פעיל יש לו תבנית (דיפולטית או נבחרת)
    if (activeStep === 3) {
      const activeCampaigns = campaigns.filter(c => c.enabled);
      const updatedTemplates = { ...selectedTemplates };
      
      activeCampaigns.forEach((campaign) => {
        // אם לא נבחרה תבנית לקמפיין הזה, בחר את התבנית הדיפולטית
        if (!updatedTemplates[campaign.label]) {
          const defaultTemplate = getDefaultTemplateForCampaign(campaign.label);
          if (defaultTemplate) {
            updatedTemplates[campaign.label] = defaultTemplate.id;
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
      // Combine date and time into ISO datetime string
      let eventDateTime: string | null = null;
      if (eventDetails.date && eventDetails.time) {
        const [hours, minutes] = eventDetails.time.split(':');
        const combinedDateTime = eventDetails.date
          .hour(parseInt(hours, 10))
          .minute(parseInt(minutes, 10))
          .second(0);
        eventDateTime = combinedDateTime.toISOString();
      } else if (eventDetails.date) {
        eventDateTime = eventDetails.date.toISOString();
      }

      // Prepare location as JSON string
      const locationJson = eventDetails.location
        ? JSON.stringify({
            name: eventDetails.location.name,
            address: eventDetails.location.address,
            coordinates: eventDetails.location.coordinates,
          })
        : null;

      // Prepare event payload
      const eventPayload = {
        name: eventDetails.name,
        description: eventDetails.description || undefined,
        event_date: eventDateTime || undefined,
        location: locationJson,
        inviters: eventDetails.inviters
          .filter(inv => inv.fn || inv.ln)
          .map(inv => ({ fn: inv.fn, ln: inv.ln })),
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
          const templateId = selectedTemplates[c.label] || null;

          // scheduled_at is an absolute datetime for the campaign
          // offsetDays is relative to event date: positive => before event, negative => after event
          let scheduledAt: Date | null = null;
          if (eventDetails.date) {
            const base = eventDetails.date.startOf('day');
            const offsetDays = typeof c.offsetDays === 'number' ? c.offsetDays : 0;
            const at = base.subtract(offsetDays, 'day');

            const timeStr = c.time || '12:00';
            const [hh, mm] = timeStr.split(':').map((x) => parseInt(x, 10));
            const withTime = at.hour(Number.isFinite(hh) ? hh : 12).minute(Number.isFinite(mm) ? mm : 0).second(0);
            scheduledAt = withTime.toDate();
          }

          return {
            label: c.label,
            template_id: templateId,
            scheduled_at: scheduledAt,
          };
        });

      if (!currentOrderId) {
        const orderRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: selectedPackageId,
            event_name: eventDetails.name,
            event_description: eventDetails.description,
            event_type: eventDetails.type,
            event_date: eventDetails.date ? eventDetails.date.toDate() : null,
            location: eventDetails.location,
            inviters: eventDetails.inviters,
            campaigns: campaignsPayload,
          }),
        });

        if (!orderRes.ok) {
          throw new Error('Failed to create order');
        }

        const orderData = await orderRes.json();
        currentOrderId = orderData.order_id || orderData.orderId;
        setOrderId(currentOrderId);
      }

      // 2) Enrich order with buyer identity (pre-payment)
      if (currentOrderId) {
        const normalizedPhone = normalizePhoneNumber(paymentData.phone, paymentData.countryCode);
        const identityRes = await fetch(`/api/orders/${currentOrderId}/identity`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
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

      // 3) TODO: integrate payment provider here using currentOrderId

      setPaymentLoading(false);
      navigate(`/payment?orderId=${encodeURIComponent(currentOrderId || '')}`); // שלב תשלום (placeholder)
    } catch (error) {
      console.error('Order / payment flow error:', error);
      setPaymentErrors({ form: 'שגיאה ביצירת ההזמנה. אנא נסו שוב.' });
      setPaymentLoading(false);
    }
  };

  // Info messages for each step
  const getStepInfo = (step: number): string => {
    switch (step) {
      case 0:
        return 'בחרו את החבילה המתאימה לאירוע שלכם. כל חבילה כוללת קמפיינים שונים ותכונות שונות.';
      case 1:
        return 'מלאו את פרטי האירוע. שם האירוע הוא שדה חובה, שאר השדות הם אופציונליים וניתן למלא אותם מאוחר יותר.';
      case 2:
        return 'הגדירו את תזמון הקמפיינים. ניתן להפעיל או לכבות כל קמפיין ולשנות את התאריך והשעה שלו.';
      case 3:
        return 'בחרו את סגנון התבנית המתאים לאירוע שלכם. התבנית תשפיע על הטון והניסוח של ההודעות.';
      case 4:
        return 'בדקו את כל הפרטים לפני הסיום. ניתן לחזור לשלבים קודמים לעריכה.';
      case 5:
        return user 
          ? 'אנא בדקו את פרטי התשלום והמשיכו להשלמת ההזמנה.'
          : 'מלאו את הפרטים הבאים כדי להשלים את ההזמנה. אם אין לכם חשבון, ניצור אחד עבורכם.';
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
          borderRadius: 1,
          bgcolor: theme.palette.mode === 'dark' 
            ? theme.palette.info.dark + '20' 
            : theme.palette.info.light + '40',
          border: `1px solid ${theme.palette.mode === 'dark' ? theme.palette.info.dark + '40' : theme.palette.info.main + '30'}`,
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

  const renderPackageStep = () => {
    if (plansLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      );
    }

    return (
      <Box>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 800 }}>
          בחרו חבילה
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
          {plans.map((plan: Plan) => {
          const selected = selectedPackageId === plan.id;
          return (
            <Paper
              key={plan.id}
              variant="outlined"
              onClick={() => setSelectedPackageId(plan.id)}
              sx={{
                p: plan.isPopular ? 3 : 2.5,
                borderRadius: 2,
                cursor: 'pointer',
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? plan.color : theme.palette.divider,
                boxShadow: selected
                  ? `0 0 0 2px ${plan.color}40, 0 14px 34px rgba(15,23,42,0.14)`
                  : theme.palette.mode === 'dark'
                    ? '0 10px 30px rgba(0,0,0,0.24)'
                    : '0 10px 30px rgba(15,23,42,0.08)',
                transition: 'transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease, border-width 0.22s ease',
                position: 'relative',
                overflow: 'hidden',
                background: theme.palette.mode === 'dark'
                  ? theme.palette.background.paper
                  : '#ffffff',
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
                      background: `linear-gradient(135deg, ${plan.color}15, transparent 60%)`,
                      pointerEvents: 'none',
                    }
                  : {},
                '&:hover': {
                  transform: plan.isPopular ? 'scale(1.05) translateY(-4px)' : 'translateY(-4px)',
                  borderColor: plan.color,
                  boxShadow: selected
                    ? `0 0 0 2px ${plan.color}40, 0 18px 45px ${plan.color}28`
                    : '0 18px 45px rgba(15,23,42,0.12)',
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
              <Typography variant="h4" fontWeight={800} sx={{ mt: 1, color: plan.color, textAlign: 'right', direction: 'rtl' }}>
                {plan.price}
              </Typography>
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
                    color: '#fff',
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

  const renderEventStep = () => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        direction: 'rtl',
      }}
    >
      {renderInfoBox()}
      {/* שם האירוע */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
          שם האירוע *
        </Typography>
        <TextField
          fullWidth
          placeholder="לדוגמה: חתונת דוד ורות"
          value={eventDetails.name}
          onChange={(e) => setEventDetails({ ...eventDetails, name: e.target.value })}
          inputProps={{ 
            style: { direction: 'rtl', textAlign: 'right' },
            maxLength: 100,
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              direction: 'rtl',
            },
          }}
        />
      </Box>

      {/* תיאור האירוע */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
          תיאור האירוע
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="תיאור קצר של האירוע (אופציונלי)"
          value={eventDetails.description}
          onChange={(e) => setEventDetails({ ...eventDetails, description: e.target.value })}
          inputProps={{ 
            style: { direction: 'rtl', textAlign: 'right' },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              direction: 'rtl',
            },
          }}
        />
      </Box>

      {/* סוג האירוע */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
          סוג האירוע *
        </Typography>
        <TextField
          select
          fullWidth
          required
          value={eventDetails.type}
          onChange={(e) => setEventDetails({ ...eventDetails, type: e.target.value })}
          error={!eventDetails.type || eventDetails.type.trim().length === 0}
          helperText={(!eventDetails.type || eventDetails.type.trim().length === 0) ? 'שדה חובה' : ''}
          SelectProps={{
            MenuProps: {
              PaperProps: {
                sx: {
                  direction: 'rtl',
                  '& .MuiMenuItem-root': {
                    direction: 'rtl',
                    textAlign: 'right',
                  },
                },
              },
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              direction: 'rtl',
              '& .MuiSelect-select': {
                textAlign: 'right',
                direction: 'rtl',
              },
            },
          }}
        >
          <MenuItem value="wedding" dir="rtl">חתונה</MenuItem>
          <MenuItem value="bar" dir="rtl">בר מצווה</MenuItem>
          <MenuItem value="bat" dir="rtl">בת מצווה</MenuItem>
          <MenuItem value="corporate" dir="rtl">אירוע חברה</MenuItem>
          <MenuItem value="other" dir="rtl">אחר</MenuItem>
        </TextField>
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
              onChange={(val) => setEventDetails({ ...eventDetails, date: val })}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  placeholder: 'בחר תאריך',
                  error: eventDetails.date === null,
                  helperText: eventDetails.date === null ? 'שדה חובה' : '',
                  inputProps: { style: { direction: 'rtl', textAlign: 'right' } },
                  sx: {
                    '& .MuiOutlinedInput-root': {
                      direction: 'rtl',
                    },
                  },
                },
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
        <TextField
          fullWidth
          inputRef={placesAutocomplete.inputRef}
          placeholder={placesAutocomplete.isLoaded ? "הקלד כתובת או שם מקום..." : "טוען חיפוש כתובות..."}
          value={placesAutocomplete.inputValue}
          onChange={(e) => {
            placesAutocomplete.setInputValue(e.target.value);
            if (!e.target.value) {
              setEventDetails({ ...eventDetails, location: null });
            }
          }}
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
        {eventDetails.location && (
          <Typography variant="caption" color="success.main" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
            ✓ {eventDetails.location.name || eventDetails.location.address}
          </Typography>
        )}
      </Box>

      {/* מזמינים */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>
            מזמינים (מי מזמין את האירוע)
          </Typography>
          <IconButton
            size="small"
            onClick={() => {
              setEventDetails({
                ...eventDetails,
                inviters: [...eventDetails.inviters, { fn: '', ln: '' }],
              });
            }}
            sx={{ color: 'primary.main' }}
          >
            <AddIcon />
          </IconButton>
        </Box>
        {eventDetails.inviters.map((inviter, index) => (
          <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'flex-start' }}>
            <TextField
              placeholder="שם פרטי"
              value={inviter.fn}
              onChange={(e) => {
                const updatedInviters = [...eventDetails.inviters];
                updatedInviters[index] = { ...updatedInviters[index], fn: e.target.value };
                setEventDetails({ ...eventDetails, inviters: updatedInviters });
              }}
              inputProps={{ 
                style: { direction: 'rtl', textAlign: 'right' },
              }}
              sx={{
                flex: 1,
                '& .MuiOutlinedInput-root': {
                  direction: 'rtl',
                },
              }}
            />
            <TextField
              placeholder="שם משפחה"
              value={inviter.ln}
              onChange={(e) => {
                const updatedInviters = [...eventDetails.inviters];
                updatedInviters[index] = { ...updatedInviters[index], ln: e.target.value };
                setEventDetails({ ...eventDetails, inviters: updatedInviters });
              }}
              inputProps={{ 
                style: { direction: 'rtl', textAlign: 'right' },
              }}
              sx={{
                flex: 1,
                '& .MuiOutlinedInput-root': {
                  direction: 'rtl',
                },
              }}
            />
            {eventDetails.inviters.length > 1 && (
              <IconButton
                size="small"
                onClick={() => {
                  const updatedInviters = eventDetails.inviters.filter((_, i) => i !== index);
                  setEventDetails({ ...eventDetails, inviters: updatedInviters });
                }}
                sx={{ color: 'error.main', mt: 0.5 }}
              >
                <DeleteIcon />
              </IconButton>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );

  const renderScheduleStep = () => {
    // Sort campaigns by offsetDays descending (30, 7, 1, -1)
    const sortedCampaigns = [...campaigns].sort((a, b) => b.offsetDays - a.offsetDays);
    
    return (
      <Box>
        {renderInfoBox()}
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
                borderRadius: 1,
                borderWidth: 1,
                borderColor: theme.palette.divider,
                bgcolor: 'transparent',
                transition: 'all 0.15s ease',
                '&:hover': {
                  borderColor: theme.palette.primary.main + '40',
                  bgcolor: theme.palette.mode === 'dark' ? theme.palette.background.paper : '#fafafa',
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
                      value={c.offsetDays}
                      onChange={(e) => {
                        const updated = [...campaigns];
                        updated[originalIdx] = { ...c, offsetDays: Number(e.target.value) };
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
                          bgcolor: c.enabled 
                            ? (theme.palette.mode === 'dark' ? theme.palette.background.paper : '#ffffff')
                            : 'transparent',
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
                        updated[originalIdx] = { ...c, time: e.target.value };
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
                          bgcolor: c.enabled 
                            ? (theme.palette.mode === 'dark' ? theme.palette.background.paper : '#ffffff')
                            : 'transparent',
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

  const renderTemplatesStep = () => {
    const activeCampaigns = campaigns.filter(c => c.enabled);
    const templateVariables = getTemplateVariables(eventDetails, eventDetails.inviters);
    
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {renderInfoBox()}
        
        {activeCampaigns.map((campaign) => {
          const campaignTemplates = getTemplatesByCampaign(campaign.label);
          const selectedTemplateId = selectedTemplates[campaign.label];
          
          return (
            <Box key={campaign.label} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                {campaign.label}
              </Typography>
              
              <Box sx={{ 
                display: { xs: 'flex', sm: 'grid' },
                gridTemplateColumns: { 
                  sm: `repeat(${campaignTemplates.length}, 1fr)`,
                  md: `repeat(${campaignTemplates.length}, 1fr)`,
                },
                gap: 2,
                overflowX: { xs: 'auto', sm: 'visible' },
                overflowY: 'hidden',
                scrollBehavior: 'smooth',
                scrollSnapType: { xs: 'x mandatory', sm: 'none' },
                pb: { xs: 1, sm: 0 },
                px: { xs: 1, sm: 1 },
                mx: { xs: -2, sm: 0 },
                '&::-webkit-scrollbar': {
                  display: 'none',
                },
                scrollbarWidth: 'none',
              }}>
                {campaignTemplates.map((template) => {
                  const isSelected = selectedTemplateId === template.id;
                  const isDefault = template.isDefault === true;
                  
                  return (
                    <Paper
                      key={template.id}
                      variant="outlined"
                      onClick={() => {
                        setSelectedTemplates({
                          ...selectedTemplates,
                          [campaign.label]: template.id,
                        });
                      }}
                      sx={{
                        p: 2,
                        cursor: 'pointer',
                        borderWidth: isSelected ? 2 : 1,
                        borderColor: isSelected ? 'primary.main' : isDefault ? 'success.main' : 'divider',
                        bgcolor: isSelected ? 'primary.main' + '08' : isDefault ? 'success.main' + '05' : 'transparent',
                        transition: 'all 0.2s ease',
                        minWidth: { xs: '85%', sm: 'auto' },
                        width: { xs: '85%', sm: 'auto' },
                        flexShrink: { xs: 0, sm: 1 },
                        scrollSnapAlign: { xs: 'center', sm: 'none' },
                        position: 'relative',
                        '&:hover': {
                          borderColor: 'primary.main',
                          bgcolor: 'primary.main' + '05',
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
                          p: 2,
                          borderRadius: 1,
                          minHeight: 150,
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
            </Box>
          );
        })}
      </Box>
    );
  };

  const renderReviewStep = () => {
    // selectedPlan is already defined in component scope via useMemo
    const eventTypeMap: Record<string, string> = {
      'wedding': 'חתונה',
      'bar': 'בר מצווה',
      'bat': 'בת מצווה',
      'corporate': 'אירוע חברה',
      'other': 'אחר',
    };
    
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {renderInfoBox()}
        
        <Typography variant="h5" fontWeight={800} sx={{ textAlign: 'center', mb: 1 }}>
          סיכום הזמנה
        </Typography>

        {/* Package and Price */}
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexDirection: 'row' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="h6" fontWeight={700}>
                {selectedPlan?.title || 'לא נבחרה'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedPlan?.description || ''}
              </Typography>
            </Box>
            <Typography variant="h4" fontWeight={800} sx={{ color: selectedPlan?.color || 'text.primary' }}>
              {selectedPlan?.price || '—'}
            </Typography>
          </Box>
          <Divider sx={{ my: 2 }} />
          
          {/* Event Details */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, textAlign: 'right' }}>
            פרטי האירוע
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>שם האירוע:</Typography>
              <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>{eventDetails.name || '—'}</Typography>
            </Box>
            {eventDetails.type && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>סוג:</Typography>
                <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>{eventTypeMap[eventDetails.type] || 'אחר'}</Typography>
              </Box>
            )}
            {(eventDetails.date || eventDetails.time) && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>תאריך ושעה:</Typography>
                <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>
                  {eventDetails.date ? eventDetails.date.format('DD/MM/YYYY') : '—'} {eventDetails.time || '—'}
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
            קמפיינים פעילים
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, mb: 2 }}>
            {campaigns.filter(c => c.enabled).map((c) => {
              const templateId = selectedTemplates[c.label];
              const template = templates.find(t => t.id === templateId);
              return (
                <Box key={c.label} sx={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>{c.label}:</Typography>
                  <Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right' }}>
                    {template?.title || 'לא נבחרה'} ({c.offsetDays} ימים, {c.time})
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Paper>

        {/* Terms and Agreement */}
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
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
                קראתי והסכמתי לתנאי השימוש והשירות
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
            borderRadius: 2,
            bgcolor: selectedPlan?.color ? selectedPlan.color + '10' : 'transparent',
            borderColor: selectedPlan?.color || 'divider',
            borderWidth: 2,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
            <Typography variant="h6" fontWeight={700} sx={{ textAlign: 'right' }}>
              סה"כ לתשלום
            </Typography>
            <Typography variant="h4" fontWeight={800} sx={{ color: selectedPlan?.color || 'text.primary' }}>
              {selectedPlan?.price || '—'}
            </Typography>
          </Box>
        </Paper>
      </Box>
    );
  };

  const renderPaymentStep = () => {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
            {user ? 'פרטי התשלום' : 'בואו נסיים את ההזמנה'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user 
              ? 'אנא בדקו את הפרטים והמשיכו לתשלום' 
              : 'אנא מלאו את הפרטים הבאים כדי להשלים את התשלום'}
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
                    renderValue: (value) => (value as string) || '+972',
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
                bgcolor: selectedPlan?.color ? selectedPlan.color + '10' : 'transparent',
                borderColor: selectedPlan?.color || 'divider',
                borderWidth: 2,
                borderRadius: 2,
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
                <Typography variant="h6" fontWeight={700} sx={{ textAlign: 'right' }}>
                  סה"כ לתשלום
                </Typography>
                <Typography variant="h5" fontWeight={800} sx={{ color: selectedPlan?.color || 'text.primary' }}>
                  {selectedPlan?.price || '—'}
                </Typography>
              </Box>
            </Paper>

            {!user && (
              <Alert severity="info" sx={{ mb: 2, textAlign: 'right' }}>
                לאחר מילוי הפרטים, תועברו לדף אימות OTP להשלמת ההרשמה
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
                  height: isCompleted ? 60 : 60,
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
                    : theme.palette.mode === 'dark'
                    ? theme.palette.grey[800]
                    : theme.palette.grey[300],
                  color: isCompleted || isActive ? '#fff' : theme.palette.text.secondary,
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
          background: `
            radial-gradient(
              1200px 600px at 10% 0%,
              #e8ecff 0%,
              #f0f4ff 40%,
              transparent 70%
            ),
            radial-gradient(
              800px 500px at 90% 20%,
              #fce8f5 0%,
              #fef0f7 35%,
              transparent 65%
            ),
            linear-gradient(
              180deg,
              #f7f8fb 0%,
              #f3f4fa 100%
            )
          `,
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
            הקמה מהירה של אירוע
          </Typography>
          <Typography variant="body1" color="text.secondary">
            בחרו חבילה, התחברו, הגדירו אירוע וקמפיינים – צעד-אחר-צעד.
          </Typography>
        </Box>

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
          
          <Box sx={{ flex: 1 }}>
            <Box
              sx={{ mb: 3 }}
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
                      handlePaymentSubmit(e as any);
                    }}
                    variant="contained"
                    disabled={!canNext || paymentLoading}
                    sx={{
                      flex: 1,
                      minWidth: { xs: '120px', sm: '140px' },
                      bgcolor: selectedPlan?.color || 'primary.main',
                      '&:hover': {
                        bgcolor: selectedPlan?.color ? selectedPlan.color + 'dd' : 'primary.dark',
                      },
                      '&:disabled': {
                        bgcolor: '#666666',
                      },
                    }}
                  >
                    {paymentLoading ? <CircularProgress size={24} color="inherit" /> : 'סיום והמשך לתשלום'}
                  </Button>
                </Box>
              ) : activeStep === steps.length - 2 ? (
                <Button
                  variant="contained"
                  onClick={handleNext}
                  disabled={!canNext}
                  sx={{
                    minWidth: { xs: '120px', sm: '140px' },
                    bgcolor: selectedPlan?.color || 'primary.main',
                    '&:hover': {
                      bgcolor: selectedPlan?.color ? selectedPlan.color + 'dd' : 'primary.dark',
                    },
                  }}
                >
                  קדימה, בואו נסיים
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={handleNext}
                  disabled={!canNext}
                  sx={{
                    minWidth: { xs: '120px', sm: '140px' },
                  }}
                >
                  הבא
                </Button>
              )}
              <Button variant="text" onClick={handleBack} disabled={activeStep === 0}>
                הקודם
              </Button>
            </Box>
            </Box>
          </Box>
        </Container>
      </Box>
    </LocalizationProvider>
  );
}

