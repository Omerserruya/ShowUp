import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { keyframes } from '@mui/system';
import { useNavigate } from 'react-router-dom';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';

const LEAD_ENDPOINT_START = '/api/leads/start-now'; // החלף ל-URL הסופי
const LEAD_ENDPOINT_CONTACT = '/api/leads/contact'; // החלף ל-URL הסופי

const float = keyframes`
  0% {
    transform: translateY(24px) scale(0.96);
    opacity: 0;
  }
  15% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  50% {
    transform: translateY(-12px) scale(1);
    opacity: 1;
  }
  85% {
    transform: translateY(18px) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateY(40px) scale(0.96);
    opacity: 0;
  }
`;

export default function Hero() {
  const navigate = useNavigate();
  const [countryCode, setCountryCode] = React.useState('+972');
  const [phone, setPhone] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [eventType, setEventType] = React.useState('');
  const [customEventType, setCustomEventType] = React.useState('');

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

  // Demo CTA: build a per-event-type invite template and open it in WhatsApp, so the
  // visitor literally receives the message a guest would get. The template links to a
  // public demo RSVP page (the full guest experience — no signup needed).
  const handleSeeDemo = () => {
    const name = fullName.trim();
    const type = eventType === 'other' && customEventType ? 'other' : (eventType || 'wedding');
    const rsvpParams = new URLSearchParams();
    rsvpParams.set('type', eventType || 'wedding');
    if (name) rsvpParams.set('name', name);
    const rsvpUrl = `${window.location.origin}/demo/invite?${rsvpParams.toString()}`;

    const greeting = name ? `שלום ${name}! 👋` : 'שלום! 👋';
    const templates: Record<string, string> = {
      wedding: `${greeting}\nאתם מוזמנים לחתונה של דנה ❤ יוסי 💍\nיום שלישי, 19:30 · אולמי הגן הקסום, ראשון לציון\nלצפייה בהזמנה ואישור הגעה:\n${rsvpUrl}`,
      'bar-mitzvah': `${greeting}\nאתם מוזמנים לחגוג את בר המצווה של איתי 🕎\nלצפייה בהזמנה ואישור הגעה:\n${rsvpUrl}`,
      'bat-mitzvah': `${greeting}\nאתם מוזמנים לחגוג את בת המצווה של מאיה ✨\nלצפייה בהזמנה ואישור הגעה:\n${rsvpUrl}`,
      brit: `${greeting}\nבשעה טובה ומוצלחת! אתם מוזמנים לברית 👶\nלצפייה בהזמנה ואישור הגעה:\n${rsvpUrl}`,
      corporate: `${greeting}\nאתם מוזמנים לערב ההשקה של ShowUp 🚀\nלצפייה בהזמנה ואישור הגעה:\n${rsvpUrl}`,
      other: `${greeting}\nאתם מוזמנים לאירוע שלנו 🎉\nלצפייה בהזמנה ואישור הגעה:\n${rsvpUrl}`,
    };
    const text = templates[type] || templates.other;

    // Fire-and-forget lead, then open WhatsApp. With a phone we open a chat to that
    // number (visitor can message themselves); otherwise WhatsApp lets them pick a chat.
    sendLead('hero_see_demo', LEAD_ENDPOINT_CONTACT);
    const digits = phone ? normalizePhoneNumber(phone, countryCode).replace(/\D/g, '') : '';
    const waUrl = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
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
        py: { xs: 12, md: 12 },
        px: 0,
        background: theme.palette.mode === 'dark'
          ? theme.palette.background.default
          : 'linear-gradient(180deg, #faf8ff 0%, #ffffff 100%)',
        fontFamily: '"Noto Sans Hebrew", Arial, sans-serif',
      })}
    >
      {/* Calm, premium background — a single soft brand wash, no decorative noise. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(900px 620px at 85% -8%, rgba(136,140,238,0.08) 0, transparent 60%), radial-gradient(760px 560px at -5% 105%, rgba(170,176,244,0.06) 0, transparent 55%)',
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
                fontSize: { xs: '2.4rem', md: '3.3rem' },
                fontWeight: 800,
                lineHeight: 1.12,
                color: 'text.primary',
              }}
            >
              אתם מזמינים.
              <br />
              אנחנו דואגים{' '}
              <Box
                component="span"
                sx={{
                  backgroundImage: 'linear-gradient(90deg,#888cee,#aab0f4)',
                  color: 'transparent',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                }}
              >
                שכולם יגיעו.
              </Box>
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
                : 'rgba(249, 249, 249, 0.31)',
              borderRadius: 1.5,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 20px 55px rgba(0,0,0,0.3)'
                : '0 20px 55px rgba(15,23,42,0.10)',
              border: `1px solid ${theme.palette.divider}`,
              p: { xs: 2, md: 3 },
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
                  borderRadius: 1.5,
                  height: 40,
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
                    borderColor: '#888cee',
                    boxShadow: '0 0 0 1px rgba(136,140,238,0.32)',
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
                  borderRadius: 1.5,
                  height: 40,
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
                    borderColor: '#888cee',
                    boxShadow: '0 0 0 1px rgba(136,140,238,0.32)',
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
                    borderRadius: 1.5,
                    height: 40,
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
                      borderColor: '#888cee',
                      boxShadow: '0 0 0 1px rgba(136,140,238,0.32)',
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
                    borderRadius: 1.5,
                    height: 40,
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
                      borderColor: '#888cee',
                      boxShadow: '0 0 0 1px rgba(136,140,238,0.32)',
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
                  // to E.164 only when building the API payload — never rewrite the
                  // visible value, which used to strip the leading 0.
                  setPhone(e.target.value);
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                sx={(theme) => ({
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 1.5,
                    height: 40,
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
                      borderColor: '#888cee',
                      boxShadow: '0 0 0 1px rgba(136,140,238,0.32)',
                    },
                  },
                })}
              />
            </Box>

            {/* Primary action — start the wizard with the captured details. */}
            <Button
              fullWidth
              variant="contained"
              onClick={handleStartNow}
              sx={{
                borderRadius: 1.5,
                py: 1.15,
                fontSize: 16,
                fontWeight: 700,
                textTransform: 'none',
                background: 'linear-gradient(90deg,#888cee,#aab0f4)',
                boxShadow: '0 10px 24px rgba(136,140,238,0.26)',
                transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                '&:hover': {
                  background: 'linear-gradient(90deg,#7378e4,#9a9ff2)',
                  boxShadow: '0 14px 30px rgba(136,140,238,0.34)',
                  transform: 'translateY(-1px)',
                },
                '&:active': { transform: 'scale(0.99)' },
              }}
            >
              יוצאים לדרך
            </Button>

            {/* Secondary action — feel the guest experience over WhatsApp. */}
            <Button
              fullWidth
              variant="outlined"
              onClick={handleSeeDemo}
              startIcon={<WhatsAppIcon />}
              sx={(theme) => ({
                mt: 1.25,
                mb: 1.5,
                borderRadius: 1.5,
                py: 1,
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
              שלחו לי דמו לוואטסאפ
            </Button>

            <Typography
              variant="caption"
              sx={{ display: 'block', textAlign: 'right', color: 'text.secondary', lineHeight: 1.7 }}
            >
              בלי התחייבות, אפשר לעצור מתי שבא לכם. ההודעות יוצאות מוואטסאפ הרשמי, והתשלום מאובטח לגמרי.
            </Typography>
          </Box>
        </Box>

        {/* Left chat mockup - shown second on mobile */}
        <Box
          sx={{
            position: 'relative',
            height: { xs: 'auto', md: 380 },
            mb: 0,
            direction: 'rtl',
            zIndex: 1,
            order: { xs: 2, md: 1 },
            display: { xs: 'flex', md: 'block' },
            flexDirection: { xs: 'column', md: 'row' },
          }}
        >

        {/* Message 1 - Top left (white/gray - left aligned) */}
          <Box
            sx={(theme) => ({
              position: 'absolute',
              top: { xs: 0, md: -8 },
              left: { xs: '18%', md: '24%' },
              animation: `${float} 6s ease-in-out infinite`,
              animationDelay: '0s',
              opacity: 0,
              [theme.breakpoints.down('md')]: {
                position: 'static',
                opacity: 1,
                mb: 1.5,
                alignSelf: 'flex-start',
                mr: 'auto',
                ml: 0,
              },
            })}
          >
            <Box
              sx={{
                bgcolor: '#ffffff',
                borderRadius: '26px',
                borderTopLeftRadius: 6,
                boxShadow: '0 18px 45px rgba(15,23,42,0.15)',
                border: '1px solid rgba(226,232,240,0.9)',
                px: 3,
                py: 2,
                maxWidth: 230,
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#111827' }}>
                היי! 👋
              </Typography>
              <Typography
                variant="body2"
                sx={{ mt: 0.5, color: '#6b7280', fontSize: 13.5 }}
              >
                מוזמנים לחתונה של דנה ויוסי 💍
              </Typography>
              {["כן, באים! 🎉", "לא נצליח הפעם"].map((label) => (
                <Box
                  key={label}
                  sx={{
                    mt: 0.5,
                    borderRadius: 1,
                    px: 1.8,
                    py: 0.8,
                    background: 'linear-gradient(90deg,#e0f2fe,#ede9fe)',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#374151',
                  }}
                >
                  {label}
                </Box>
              ))}
            </Box>
          </Box>

          {/* Message 2 - User response (green - right aligned) */}
          <Box
            sx={(theme) => ({
              position: 'absolute',
              top: { xs: 82, md: 190 },
              right: { xs: '12%', md: '18%' },
              animation: `${float} 6s ease-in-out infinite`,
              animationDelay: '1s',
              opacity: 0,
              [theme.breakpoints.down('md')]: {
                position: 'static',
                opacity: 1,
                mb: 1.5,
                alignSelf: 'flex-end',
                ml: 'auto',
                mr: 0,
              },
            })}
          >
            <Box
              sx={{
                background: 'linear-gradient(135deg,#22c55e,#059669)',
                color: '#ffffff',
                borderRadius: '26px',
                borderTopRightRadius: 8,
                px: 3,
                py: 2,
                boxShadow: '0 20px 50px rgba(21,128,61,0.45)',
                maxWidth: 230,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              כן, באים! 🎉
            </Box>
          </Box>


          {/* Message3 - Top left (white/gray - left aligned) */}
          <Box
            sx={(theme) => ({
              position: 'absolute',
              top: { xs: 82, md: 230 },
              left: { xs: '18%', md: '24%' },
              animation: `${float} 6s ease-in-out infinite`,
              animationDelay: '2.5s',
              opacity: 0,
              [theme.breakpoints.down('md')]: {
                position: 'static',
                opacity: 1,
                mb: 1.5,
                alignSelf: 'flex-start',
                mr: 'auto',
                ml: 0,
              },
            })}
          >
            <Box
              sx={{
                bgcolor: '#ffffff',
                borderRadius: '26px',
                borderTopLeftRadius: 6,
                boxShadow: '0 18px 45px rgba(15,23,42,0.15)',
                border: '1px solid rgba(226,232,240,0.9)',
                px: 3,
                py: 2,
                maxWidth: 230,
              }}
            >
              <Typography
                variant="body2"
                sx={{ mt: 0.5, color: '#6b7280', fontSize: 13.5 }}
              >
מתרגשים לקראת הערב, מקווים שגם אתם! 💗
מזכירים: היום ב‑19:30, אולמי הגן.
נתראה בשמחה 🥂
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: '#6b7280', fontSize: 13.5 }}>
            <br />
          וכדי שלא תתעכבו בדרך, לחצו לניווט עם waze 👇
          </Typography>
              <Box
                  key={"ניווט עם waze"}
                  sx={{
                    mt: 0.5,
                    borderRadius: 1,
                    px: 1.8,
                    py: 0.8,
                    background: 'linear-gradient(90deg,#e0f2fe,#ede9fe)',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#374151',
                  }}
                >
                    {"ניווט עם waze"}
                </Box>
            </Box>
          </Box>

        </Box>
      </Container>
    </Box>
  );
}
