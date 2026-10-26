import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { useNavigate } from 'react-router-dom';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';

const LEAD_ENDPOINT_START = '/api/leads/start-now'; // החלף ל-URL הסופי
const LEAD_ENDPOINT_CONTACT = '/api/leads/contact'; // החלף ל-URL הסופי



/* A still, composed WhatsApp exchange: the invitation, the one-tap reply, and
   the day-of reminder. Each bubble rises in once; nothing loops or fades away. */
const RISE = { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } };

function Bubble({ side, delay, children }: { side: 'in' | 'out'; delay: number; children: React.ReactNode }) {
  const out = side === 'out';
  return (
    <Box
      sx={{
        alignSelf: out ? 'flex-start' : 'flex-end',
        maxWidth: out ? '72%' : '86%',
        px: 2,
        py: 1.35,
        borderRadius: '18px',
        ...(out ? { borderBottomLeftRadius: 6 } : { borderBottomRightRadius: 6 }),
        bgcolor: out ? '#dcf8c6' : '#ffffff',
        color: '#111827',
        boxShadow: '0 1px 2px rgba(15,23,42,0.08), 0 10px 30px rgba(15,23,42,0.06)',
        fontSize: 14,
        lineHeight: 1.55,
        opacity: 0,
        animation: 'heroBubble .55s cubic-bezier(.2,.8,.2,1) forwards',
        animationDelay: `${delay}s`,
        '@keyframes heroBubble': RISE,
      }}
    >
      {children}
    </Box>
  );
}

function ReplyButton({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <Box
      sx={{
        mt: 0.75,
        py: 0.7,
        textAlign: 'center',
        borderRadius: 1.5,
        fontSize: 13.5,
        fontWeight: 600,
        color: accent ? '#0f7a52' : '#1f2937',
        bgcolor: accent ? 'rgba(37,211,102,0.12)' : 'rgba(15,23,42,0.05)',
        border: `1px solid ${accent ? 'rgba(37,211,102,0.35)' : 'rgba(15,23,42,0.08)'}`,
      }}
    >
      {label}
    </Box>
  );
}

function HeroConversation() {
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 420,
        p: { xs: 2, md: 2.5 },
        borderRadius: 5,
        bgcolor: '#f3f0ff',
        backgroundImage: 'radial-gradient(rgba(95,100,214,0.10) 1px, transparent 1.2px)',
        backgroundSize: '18px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        direction: 'rtl',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, pb: 0.5 }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: '#5A3DA6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 }}>ד</Box>
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2, color: '#111827' }}>דנה ויוסי</Typography>
          <Typography sx={{ fontSize: 12, color: '#6b7280' }}>WhatsApp Business</Typography>
        </Box>
      </Box>

      <Bubble side="in" delay={0.15}>
        <Typography sx={{ fontWeight: 700, fontSize: 14.5 }}>היי, מוזמנים לחתונה של דנה ויוסי</Typography>
        <Typography sx={{ fontSize: 13.5, color: '#4b5563', mt: 0.5 }}>יום שלישי, 19:30 · אולמי הגן, ראשון לציון</Typography>
        <ReplyButton label="כן, באים" accent />
        <ReplyButton label="לא נצליח הפעם" />
      </Bubble>

      <Bubble side="out" delay={0.75}>
        <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>כן, באים 🎉</Typography>
      </Bubble>

      <Bubble side="in" delay={1.3}>
        <Typography sx={{ fontSize: 13.5, color: '#374151' }}>
          מתרגשים לקראת הערב. מזכירים: היום ב‑19:30, אולמי הגן. וכדי שלא תתעכבו בדרך:
        </Typography>
        <ReplyButton label="ניווט עם Waze" />
      </Bubble>
    </Box>
  );
}

export default function Hero() {
  const navigate = useNavigate();
  const [countryCode, setCountryCode] = React.useState('+972');
  const [phone, setPhone] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [eventType, setEventType] = React.useState('');
  const [customEventType, setCustomEventType] = React.useState('');
  const [demoSending, setDemoSending] = React.useState(false);
  const [toast, setToast] = React.useState<{ severity: 'success' | 'error' | 'warning'; message: string } | null>(null);

  const buildLeadPayload = (source: string) => {
    const normalizedPhone = phone ? normalizePhoneNumber(phone, countryCode) : '';
    return {
      source, // e.g., 'hero_start_now' / 'hero_contact'
      fullName,
      phone: normalizedPhone,
      countryCode,
      eventType,
      eventTypeOther: eventType === 'other' ? customEventType : '',
    };
  };

  const sendLead = async (source: string, endpoint: string) => {
    try {
      const payload = buildLeadPayload(source);
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('Lead submission failed', err);
    }
  };

  // Demo CTA: verify the visitor filled in name + phone, then send the real ShowUp
  // WhatsApp demo (the approved MARKETING template) to their number. The template's
  // own buttons carry the next steps ("בואו נתחיל" → wizard, "דברו איתי" → sales
  // WhatsApp), so here we just validate and fire the send.
  const handleSeeDemo = async () => {
    const name = fullName.trim();
    if (!name) {
      setToast({ severity: 'warning', message: 'רק צריך את השם המלא שלכם כדי לשלוח 🙂' });
      return;
    }
    if (!phone.trim()) {
      setToast({ severity: 'warning', message: 'הוסיפו מספר טלפון ונשלח את הדמו לוואטסאפ שלכם' });
      return;
    }
    const normalizedPhone = normalizePhoneNumber(phone, countryCode);
    if (!normalizedPhone || normalizedPhone.replace(/\D/g, '').length < 9) {
      setToast({ severity: 'warning', message: 'מספר הטלפון לא נראה תקין, בדקו שוב' });
      return;
    }

    setDemoSending(true);
    sendLead('hero_see_demo', LEAD_ENDPOINT_CONTACT); // fire-and-forget lead capture
    try {
      const res = await fetch('/api/auth/demo/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: normalizedPhone, countryCode, eventType }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setToast({ severity: 'success', message: 'הדמו בדרך אליכם לוואטסאפ 🎉 בדקו את ההודעה' });
    } catch (err) {
      console.error('Demo send failed', err);
      setToast({ severity: 'error', message: 'לא הצלחנו לשלוח כרגע, נסו שוב בעוד רגע' });
    } finally {
      setDemoSending(false);
    }
  };

  const handleStartNow = () => {
    const params = new URLSearchParams();
    if (fullName) params.set('fullName', fullName);
    if (phone) params.set('phone', phone);
    if (countryCode) params.set('countryCode', countryCode);
    if (eventType) {
      params.set('eventType', eventType);
      if (eventType === 'other' && customEventType) {
        params.set('eventTypeOther', customEventType);
      }
    }
    // Fire-and-forget lead
    sendLead('hero_start_now', LEAD_ENDPOINT_START);

    navigate(`/wizard?${params.toString()}`);
  };

  return (
    <Box
      id="hero"
      sx={(theme) => ({
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        py: { xs: 14, md: 12 },
        px: 0,
        background: theme.palette.mode === 'dark'
          ? theme.palette.background.default
          : 'linear-gradient(180deg, #F6F2FD 0%, #ffffff 100%)',
        fontFamily: '"Noto Sans Hebrew", Arial, sans-serif',
      })}
    >
      {/* Calm, premium background - a single soft brand wash, no decorative noise. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(900px 620px at 85% -8%, rgba(157,131,224,0.08) 0, transparent 60%), radial-gradient(760px 560px at -5% 105%, rgba(170,176,244,0.06) 0, transparent 55%)',
          pointerEvents: 'none',
        }}
      />

      <Container
        maxWidth="lg"
        sx={{
          position: 'relative',
          display: 'grid',
          // Two columns from md (≥900px); single column below that
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          alignItems: 'center',
          gap: { xs: 6, md: 8, lg: 10 },
          px: { xs: 2.5, md: 4 },
        }}
        dir="ltr"
      >
        {/* Right content - shown first on mobile */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            textAlign: 'right',
            maxWidth: 520,
            ml: 'auto',
            mt: { xs: 2, md: 0 },
            order: { xs: 1, md: 2 },
          }}
          dir="rtl"
        >
          <Box sx={{ textAlign: 'right' }}>
            <Typography
              component="h1"
              sx={{
                fontSize: { xs: '2.5rem', md: '3.4rem' },
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: '-0.02em',
                color: 'text.primary',
              }}
            >
              <Box component="span" sx={{ display: 'block', whiteSpace: 'nowrap' }}>אתם מזמינים.</Box>
              <Box component="span" sx={{ display: 'block', whiteSpace: 'nowrap' }}>אנחנו דואגים</Box>
              <Box component="span" sx={{ display: 'block', whiteSpace: 'nowrap', color: '#5A3DA6' }}>שכולם יגיעו.</Box>
            </Typography>
            <Typography
              variant="h6"
              sx={{
                mt: 2,
                color: 'text.secondary',
                maxWidth: 520,
                fontWeight: 400,
                lineHeight: 1.6,
              }}
            >
    שולחים את ההזמנות, ומי ששכח כבר יקבל תזכורת. האישורים נאספים לבד, בתוך וואטסאפ. אנחנו נרדוף אחרי האישורים, אתם תרדפו אחרי הרחבה.
            </Typography>
          </Box>

          {/* White card with form */}
          <Box
            sx={(theme) => ({
              bgcolor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.05)'
                : '#ffffff',
              borderRadius: 3,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 20px 55px rgba(0,0,0,0.3)'
                : '0 18px 50px rgba(15,23,42,0.08)',
              border: `1px solid ${theme.palette.divider}`,
              p: { xs: 2.5, md: 3 },
              width: '100%',
            })}
          >
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 700, mb: 0.5, textAlign: 'right' }}
            >
              יאללה, מתחילים
            </Typography>
            <Typography
              variant="caption"
              sx={{ display: 'block', mb: 2.5, textAlign: 'right', color: 'text.secondary' }}
            >
              כמה פרטים, ויש לכם לוח הודעות מוכן לאירוע. רוצים טעימה קודם? נשלח לכם הזמנת דמו ישר לוואטסאפ 💬
            </Typography>

            {/* Full Name Field */}
            <TextField
              fullWidth
              placeholder="שם מלא"
              value={fullName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)}
              inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
              sx={(theme) => ({
                mb: 2,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  height: 44,
                  bgcolor: theme.palette.mode === 'dark'
                    ? theme.palette.background.paper
                    : '#f9fafb',
                  '& fieldset': {
                    borderColor: theme.palette.divider,
                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                  },
                  '&:hover fieldset': {
                    borderColor: theme.palette.mode === 'dark'
                      ? theme.palette.divider
                      : '#d1d5db',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#9D83E0',
                    boxShadow: '0 0 0 1px rgba(157,131,224,0.32)',
                  },
                },
              })}
            />

            {/* Event Type Field */}
            <TextField
              select
              fullWidth
              placeholder="איזה אירוע?"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as string)}
              sx={(theme) => ({
                mb: 2,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  height: 44,
                  bgcolor: theme.palette.mode === 'dark'
                    ? theme.palette.background.paper
                    : '#f9fafb',
                  '& fieldset': {
                    borderColor: theme.palette.divider,
                  },
                  '&:hover fieldset': {
                    borderColor: theme.palette.mode === 'dark'
                      ? theme.palette.divider
                      : '#d1d5db',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#9D83E0',
                    boxShadow: '0 0 0 1px rgba(157,131,224,0.32)',
                  },
                },
              })}
              SelectProps={{
                displayEmpty: true,
                renderValue: (value) => {
                  if (!value) return 'איזה אירוע?';
                  const options = [
                    { value: 'wedding', label: 'חתונה' },
                    { value: 'bar-mitzvah', label: 'בר מצווה' },
                    { value: 'bat-mitzvah', label: 'בת מצווה' },
                    { value: 'brit', label: 'ברית' },
                    { value: 'corporate', label: 'אירוע חברה' },
                    { value: 'other', label: 'אחר' },
                  ];
                  return options.find(opt => opt.value === value)?.label || (value as string);
                },
              }}
              inputProps={{ style: { direction: 'rtl', textAlign: 'right', fontSize: 13 } }}
            >
              <MenuItem value="wedding">חתונה</MenuItem>
              <MenuItem value="bar-mitzvah">בר מצווה</MenuItem>
              <MenuItem value="bat-mitzvah">בת מצווה</MenuItem>
              <MenuItem value="brit">ברית</MenuItem>
              <MenuItem value="corporate">אירוע חברה</MenuItem>
              <MenuItem value="other">אחר</MenuItem>
            </TextField>

            {/* Custom Event Type Field (shown only when "other" is selected) */}
            {eventType === 'other' && (
              <TextField
                fullWidth
                placeholder="אז מה חוגגים?"
                value={customEventType}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomEventType(e.target.value)}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                sx={(theme) => ({
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    height: 44,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f9fafb',
                    '& fieldset': {
                      borderColor: theme.palette.divider,
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    },
                    '&:hover fieldset': {
                      borderColor: theme.palette.mode === 'dark'
                        ? theme.palette.divider
                        : '#d1d5db',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#9D83E0',
                      boxShadow: '0 0 0 1px rgba(157,131,224,0.32)',
                    },
                  },
                })}
              />
            )}

            <Box
              sx={{
                mb: 1,
                display: 'flex',
                flexDirection: 'row-reverse',
                gap: 1,
              }}
            >
              <TextField
                select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value as string)}
                sx={(theme) => ({
                  minWidth: 110,
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    height: 44,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f9fafb',
                    '& fieldset': {
                      borderColor: theme.palette.divider,
                    },
                    '&:hover fieldset': {
                      borderColor: theme.palette.mode === 'dark'
                        ? theme.palette.divider
                        : '#d1d5db',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#9D83E0',
                      boxShadow: '0 0 0 1px rgba(157,131,224,0.32)',
                    },
                  },
                })}
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
                placeholder="הטלפון שלכם"
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  // Keep exactly what the user typed (e.g. 05XXXXXXXX). We normalize
                  // to E.164 only when building the API payload - never rewrite the
                  // visible value, which used to strip the leading 0.
                  setPhone(e.target.value);
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                sx={(theme) => ({
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    height: 44,
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : '#f9fafb',
                    '& fieldset': {
                      borderColor: theme.palette.divider,
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    },
                    '&:hover fieldset': {
                      borderColor: theme.palette.mode === 'dark'
                        ? theme.palette.divider
                        : '#d1d5db',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#9D83E0',
                      boxShadow: '0 0 0 1px rgba(157,131,224,0.32)',
                    },
                  },
                })}
              />
            </Box>

            {/* Primary action - start the wizard with the captured details. */}
            <Button
              fullWidth
              variant="contained"
              onClick={handleStartNow}
              sx={{
                borderRadius: 2,
                py: 1.25,
                fontSize: 16,
                fontWeight: 700,
                textTransform: 'none',
                bgcolor: '#5A3DA6',
                boxShadow: '0 10px 24px rgba(95,100,214,0.28)',
                transition: 'transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease',
                '&:hover': {
                  bgcolor: '#5257c9',
                  boxShadow: '0 14px 30px rgba(95,100,214,0.34)',
                  transform: 'translateY(-1px)',
                },
                '&:active': { transform: 'scale(0.99)' },
              }}
            >
              יוצאים לדרך
            </Button>

            {/* Secondary action - feel the guest experience over WhatsApp. */}
            <Button
              fullWidth
              variant="outlined"
              onClick={handleSeeDemo}
              disabled={demoSending}
              startIcon={demoSending ? <CircularProgress size={16} color="inherit" /> : <WhatsAppIcon />}
              sx={(theme) => ({
                mt: 1.25,
                mb: 1.5,
                borderRadius: 2,
                py: 1.05,
                fontSize: 14,
                fontWeight: 600,
                textTransform: 'none',
                color: '#0f7a52',
                borderColor: 'rgba(37,211,102,0.5)',
                bgcolor: theme.palette.mode === 'dark' ? 'transparent' : 'rgba(37,211,102,0.04)',
                '& .MuiButton-startIcon': { ml: 0.5, mr: -0.25 },
                '&:hover': { borderColor: '#25D366', bgcolor: 'rgba(37,211,102,0.08)' },
              })}
            >
              {demoSending ? 'שולחים...' : 'שלחו לי דמו לוואטסאפ'}
            </Button>

            <Typography
              variant="caption"
              sx={{ display: 'block', textAlign: 'right', color: 'text.secondary', lineHeight: 1.7 }}
            >
              בלי התחייבות, אפשר לעצור מתי שבא לכם. ההודעות יוצאות מוואטסאפ הרשמי, והתשלום מאובטח לגמרי.
            </Typography>
          </Box>
        </Box>

        {/* Left: a real-looking WhatsApp exchange, composed and still - the
            product is the conversation, so we show it plainly. */}
        <Box
          sx={{
            order: { xs: 2, md: 1 },
            direction: 'rtl',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <HeroConversation />
        </Box>

      </Container>

      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
