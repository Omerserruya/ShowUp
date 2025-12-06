import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import { keyframes } from '@mui/system';

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

const blob = keyframes`
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -40px) scale(1.05);
  }
  66% {
    transform: translate(-20px, 20px) scale(0.97);
  }
`;

const countryOptions = [
  { code: 'IL', name: 'ישראל', dialCode: '+972', flag: '🇮🇱' },
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪' },
  { code: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹' },
  { code: 'GR', name: 'Greece', dialCode: '+30', flag: '🇬🇷' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { code: 'CZ', name: 'Czech Republic', dialCode: '+420', flag: '🇨🇿' },
  { code: 'HU', name: 'Hungary', dialCode: '+36', flag: '🇭🇺' },
  { code: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴' },
  { code: 'BG', name: 'Bulgaria', dialCode: '+359', flag: '🇧🇬' },
  { code: 'RU', name: 'Russia', dialCode: '+7', flag: '🇷🇺' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', flag: '🇺🇦' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'JO', name: 'Jordan', dialCode: '+962', flag: '🇯🇴' },
  { code: 'LB', name: 'Lebanon', dialCode: '+961', flag: '🇱🇧' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦' },
  { code: 'BH', name: 'Bahrain', dialCode: '+973', flag: '🇧🇭' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya', dialCode: '+254', flag: '🇰🇪' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
];

export default function Hero() {
  const [countryCode, setCountryCode] = React.useState('+972');
  const [phone, setPhone] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [eventType, setEventType] = React.useState('');
  const [customEventType, setCustomEventType] = React.useState('');

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
          : 'radial-gradient(circle at 0 100%, #e0f2ff 0, #ffffff 55%)',
        fontFamily: '"Noto Sans Hebrew", Arial, sans-serif',
      })}
    >
      {/* background gradient orbs */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 0% 100%, rgba(191,219,254,0.6) 0, transparent 55%), radial-gradient(circle at 80% 0%, rgba(221,214,254,0.5) 0, transparent 55%)',
          pointerEvents: 'none',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: -80,
          right: -80,
          width: 260,
          height: 260,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, rgba(59,130,246,0.65), rgba(125,211,252,0.12))',
          filter: 'blur(26px)',
          opacity: 0.24,
          animation: `${blob} 18s ease-in-out infinite`,
          pointerEvents: 'none',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '32%',
          left: -120,
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 40%, rgba(168,85,247,0.6), rgba(244,114,182,0.12))',
          filter: 'blur(30px)',
          opacity: 0.22,
          animation: `${blob} 22s ease-in-out infinite`,
          animationDelay: '4s',
          pointerEvents: 'none',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: -120,
          right: '25%',
          width: 260,
          height: 260,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 40%, rgba(52,211,153,0.6), rgba(56,189,248,0.14))',
          filter: 'blur(28px)',
          opacity: 0.2,
          animation: `${blob} 20s ease-in-out infinite`,
          animationDelay: '8s',
          pointerEvents: 'none',
        }}
      />

      <Container
        maxWidth="lg"
        sx={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          alignItems: 'center',
          gap: { xs: 6, md: 10 },
          px: { xs: 2, md: 4 },
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
          <Box>
            <Typography
              component="h1"
              sx={{
                fontSize: { xs: '2.3rem', md: '3.2rem' },
                fontWeight: 800,
                lineHeight: 1.15,
                backgroundImage: 'linear-gradient(90deg,#3b82f6,#8b5cf6,#ec4899)',
                color: 'transparent',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                textAlign: 'center',
              }}
            >
לניהול אורחים חכם.              <br />
              הכל בוואטסאפ.
            </Typography>
            <Typography
              variant="h6"
              sx={{
                mt: 2,
                color: 'text.secondary',
                maxWidth: 480,
                mx: 'auto',
                fontWeight: 400,
                textAlign: 'center',
              }}
            >
מערכת אוטמטית שעושה לכם סדר בהכל - אישורי הגעה, בחירת מנות, שאלות של אורחים והכול ללא לינקים מסורבלים.
ואם זה לא הספיק - נציג AI שידע לענות על כל שאלה שלכם ולהרגיע            </Typography>
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
              sx={{ fontWeight: 600, mb: 3, textAlign: 'right' }}
            >
              רוצים לראות איך האורח יחווה ? נסו בעצמכם
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
                    borderColor: '#3b82f6',
                    boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
                  },
                },
              })}
            />

            {/* Event Type Field */}
            <TextField
              select
              fullWidth
              placeholder="בחר אירוע"
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
                    borderColor: '#3b82f6',
                    boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
                  },
                },
              })}
              SelectProps={{
                displayEmpty: true,
                renderValue: (value) => {
                  if (!value) return 'בחר אירוע';
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
                placeholder="נא להזין סוג אירוע"
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
                      borderColor: '#3b82f6',
                      boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
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
                      borderColor: '#3b82f6',
                      boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
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
                placeholder="הזינו מספר טלפון"
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
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
                      borderColor: '#3b82f6',
                      boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
                    },
                  },
                })}
              />
            </Box>

            <Box
              sx={{
                mb: 1,
                bgcolor: 'transparent',
              }}
            >
              <Button
                fullWidth
                variant="contained"
                sx={{
                  borderRadius: 1.5,
                  py: 0.5,
                  fontSize: 16,
                  background: 'linear-gradient(90deg,#111827,#000000)',
                  boxShadow: 'none',
                  transition: 'transform 0.18s ease, background 0.18s ease',
                  '&:hover': {
                    background: 'linear-gradient(90deg,#1f2937,#020617)',
                    transform: 'scale(1.01)',
                  },
                  '&:active': {
                    transform: 'scale(0.98)',
                  },
                  textTransform: 'none',
                }}
              >
                קדימה, תראו לי
              </Button>
            </Box>

            <Typography
              variant="caption"
              sx={{ display: 'block', mb: 1, textAlign: 'right', color: 'text.secondary' }}
            >
              על ידי הזנת מספר הטלפון, אתם מסכימים לתנאי השימוש.
            </Typography>

            <Box
              sx={{
                display: 'flex',
                gap: { xs: 1, md: 2 },
                justifyContent: 'flex-end',
                flexWrap: 'nowrap',
                flexDirection: 'row',
                width: '100%',
              }}
            >
              <Button
                variant="outlined"
                sx={(theme) => ({
                  borderRadius: 1.5,
                  py: 1.1,
                  textTransform: 'none',
                  borderColor: theme.palette.divider,
                  color: theme.palette.text.primary,
                  bgcolor: theme.palette.mode === 'dark'
                    ? theme.palette.background.paper
                    : '#ffffff',
                  whiteSpace: 'nowrap',
                  flex: '1 1 50%',
                  maxWidth: '50%',
                  fontSize: { xs: 13, md: 14 },
                  '&:hover': {
                    borderColor: theme.palette.mode === 'dark'
                      ? theme.palette.divider
                      : '#cbd5e1',
                    bgcolor: theme.palette.mode === 'dark'
                      ? theme.palette.action.hover
                      : '#f8fafc',
                  },
                })}
              >
                שנציג יספר לי עוד
              </Button>
              <Button
                variant="contained"
                sx={{
                  borderRadius: 1.5,
                  py: 1.1,
                  textTransform: 'none',
                  background: 'linear-gradient(90deg,#3b82f6,#a855f7)',
                  border: 'none',
                  boxShadow: 'none',
                  outline: 'none',
                  whiteSpace: 'nowrap',
                  flex: '1 1 50%',
                  maxWidth: '50%',
                  fontSize: { xs: 13, md: 14 },
                  fontWeight: 600,
                  '&:hover': {
                    background: 'linear-gradient(90deg,#2563eb,#9333ea)',
                    border: 'none',
                    boxShadow: 'none',
                    transform: 'translateY(-1px)',
                  },
                  '&:focus-visible': {
                    outline: 'none',
                    boxShadow: 'none',
                    border: 'none',
                  },
                }}
              >
                התחילו עכשיו - בחרו חבילה
              </Button>
            </Box>
          </Box>
        </Box>

        {/* Left chat mockup - shown second on mobile */}
        <Box
          sx={{
            position: 'relative',
            height: { xs: 'auto', md: 380 },
            mb: { xs: 0, md: 0 },
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
              [theme.breakpoints.down('sm')]: {
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
                שלום! 👋
              </Typography>
              <Typography
                variant="body2"
                sx={{ mt: 0.5, color: '#6b7280', fontSize: 13.5 }}
              >
הנכם מוזמנים לחתונה של ...              </Typography>
              {["כן, אני בא! 🎉", "לצערי לא אוכל להגיע", "לצערי לא אוכל"].map((label) => (
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
              [theme.breakpoints.down('sm')]: {
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
              כן, אני בא! 🎉
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
              [theme.breakpoints.down('sm')]: {
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
אנחנו כבר מתרגשים לקראת הערב, מקווים שגם אתם! 💗 
מזכירים - היום, 19:30 באולמי..

מחכים לראותכם! 💗 
         
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: '#6b7280', fontSize: 13.5 }}>
            <br />
          לנוחיותכם ניווט מהיר באמצעות waze ע״י הכפתור למטה     
          </Typography>
              <Box
                  key={"waze לאירוע"}
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
                    {"waze לאירוע"}
                </Box>
            </Box>
          </Box>

        </Box>
      </Container>
    </Box>
  );
}
