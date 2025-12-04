import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { styled, useTheme } from '@mui/material/styles';

// Icons
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SmartToyIcon from '@mui/icons-material/SmartToy';

// --- Feature Data ---
const featureData = [
  {
    icon: WhatsAppIcon,
    title: 'אישורי הגעה אוטומטיים בוואטסאפ, בלי לינקים',
    description:
      'חוויה אישית ונוחה למענה שמבטיחה שהאורחים שלכם באמת יענו – הכל קורה ישירות בוואטסאפ, בלי טפסים מסורבלים.',
    color: '#16a34a', // Green
  },
  {
    icon: TrackChangesIcon,
    title: 'ניהול מתקדם בדשבורד בזמן אמת',
    description:
      'עדכוני סטטוס לייב, סידורי הושבה ותצוגה ברורה של כמה מגיעים, מי אישר, מי מתלבט ומה המצב בשטח בכל רגע.',
    color: '#2563eb', // Blue
  },
  {
    icon: SmartToyIcon,
    title: 'נציג AI זמין 24/7',
    description:
      'העוזר האישי שלכם לשאלות כמו כמה אישורי הגעה התקבלו, מי אישר ומה, כמה צמחונים, ואפילו בקשות מיוחדות מאורחים – במילה אחת: שקט.',
    color: '#7c3aed', // Purple
  },
  {
    icon: CloudUploadIcon,
    title: 'העלאת אורחים מהירה ופשוטה דרך הבוט',
    description:
      'ייבוא אנשי קשר מאקסל או מהמחשב, או שליחה ישירה לבוט – אנחנו נטפל בסידור וניהול הרשימה, בלי כאב ראש.',
    color: '#f97316', // Orange
  },
];

// --- Icon with clean accent box (no outer card) ---
const FeatureIcon = styled(Box)<{ colorprop: string }>(({ colorprop }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 8,
  borderRadius: 999,
  padding: 10,
  background: `linear-gradient(135deg, ${colorprop}18, ${colorprop}08)`,
  border: `1px solid ${colorprop}40`,
  '& svg': {
    fontSize: 26,
    color: colorprop,
  },
}));

export default function Highlights() {
  const theme = useTheme();

  return (
    <Box
      id="highlights"
      sx={{
        pt: { xs: 1, sm: 12 },
        pb: { xs: 8, sm: 16 },
        bgcolor: theme.palette.mode === 'dark'
          ? theme.palette.background.default
          : 'linear-gradient(to bottom, #f5f7fb 0%, #ffffff 40%, #f5f7fb 100%)',
        color: theme.palette.text.primary,
      }}
    >
      <Container maxWidth="lg" sx={{ overflow: 'hidden' }}>
        {/* Header Section (RTL) */}
        <Box
          sx={{
            width: { sm: '100%', md: '60%' },
            textAlign: 'center',
            mx: 'auto',
            mt: { xs: 4, md: 0 },
            mb: 8,
            direction: 'rtl',
          }}
        >
          <Typography component="h2" variant="h3" gutterBottom sx={{ fontWeight: 800 }}>
            למה לבחור ב‑
            <Box
              component="span"
              sx={{
                ml: 0.5,
                background: 'linear-gradient(90deg,#2563eb,#7c3aed)',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
                fontWeight: 800,
              }}
            >
              ShowUp?
            </Box>
          </Typography>
          <Typography variant="h6" sx={{ color: theme.palette.text.secondary, mt: 1 }}>
            כל מה שאתם צריכים לניהול אורחים חכם – בפלטפורמה אחת פשוטה ויעילה.
          </Typography>
        </Box>

        {/* Features Grid (RTL) */}
        <Grid container spacing={4} sx={{ alignItems: 'stretch', direction: 'rtl' }}>
          {featureData.map((item, index) => {
            const IconComponent = item.icon;
            const featureColor = item.color;

            return (
              <Grid item xs={12} sm={6} md={3} key={index}>
                <Box
                  sx={{
                    direction: 'rtl',
                    textAlign: 'right',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 1,
                    p: 0,
                    borderRadius: 2,
                    transition: 'background-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease',
                    cursor: 'default',
                    '&:hover': {
                      backgroundColor: theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.05)'
                        : 'rgba(15,23,42,0.02)',
                      boxShadow: theme.palette.mode === 'dark'
                        ? '0 10px 30px rgba(0,0,0,0.3)'
                        : '0 10px 30px rgba(15,23,42,0.08)',
                      transform: 'translateY(-3px)',
                    },
                  }}
                >
                  <FeatureIcon colorprop={featureColor}>
                    <IconComponent />
                  </FeatureIcon>
                  <Typography
                    gutterBottom
                    variant="h6"
                    sx={{
                      fontWeight: 700,
                      mb: 1,
                      color: theme.palette.text.primary,
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      color: theme.palette.text.secondary,
                      lineHeight: 1.6,
                    }}
                  >
                    {item.description}
                  </Typography>
                </Box>
              </Grid>
            );
          })}
        </Grid>
      </Container>
    </Box>
  );
}
