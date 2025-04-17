import * as React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ChatIcon from '@mui/icons-material/Chat';
import EditIcon from '@mui/icons-material/Edit';
import EventIcon from '@mui/icons-material/Event';
import { styled } from '@mui/material/styles';

const items = [
  {
    icon: <WhatsAppIcon />,
    title: 'שליחת הודעות וואטסאפ אוטומטיות',
    description:
      'תזמון הודעות אישור הגעה ישירות לאורחים – בלי כאבי ראש, בלי לשכוח.',
    color: '#4CAF50', // Green
  },
  {
    icon: <TrackChangesIcon />,
    title: 'מעקב אחר אישורי הגעה בזמן אמת',
    description:
      'רואים מי קיבל, מי פתח, מי לחץ, ומי עדיין מתעלם 😉 – הכל בדשבורד פשוט.',
    color: '#2196F3', // Blue
  },
  {
    icon: <CloudUploadIcon />,
    title: 'ייבוא אורחים בקלות דרך אקסל או וואטסאפ',
    description:
      'מעלים קובץ או שולחים את אנשי הקשר לבוט שלנו – אנחנו כבר נוסיף אותם אוטומטית.',
    color: '#FF9800', // Orange
  },
  {
    icon: <ChatIcon />,
    title: 'ניהול שיחה עם אורחים בצורת צ\'אט מרוכז',
    description:
      'כל התשובות של האורחים – במקום אחד. בלי להסתובב בין הודעות.',
    color: '#E91E63', // Pink
  },
  {
    icon: <EditIcon />,
    title: 'התאמה אישית של הודעות ההזמנה',
    description:
      'כותבים בדיוק מה שמתאים לכם – עם שם, פרטים, לינק ומיתוג אישי.',
    color: '#673AB7', // Deep Purple
  },
  {
    icon: <EventIcon />,
    title: 'מותאם לאירועים פרטיים ועסקיים',
    description:
      'חתונות, בריתות, ימי הולדת, כנסים – תפעול חלק ונעים לכל סוג של אירוע.',
    color: '#009688', // Teal
  },
];

const StyledCard = styled(Card)(({ theme }) => ({
  padding: theme.spacing(4),
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  transition: 'transform 0.2s',
  transform: 'scale(0.98)',
  '&:hover': {
    transform: 'translateY(-8px) scale(0.98)',
    boxShadow: theme.shadows[4],
  },
}));

const FeatureIcon = styled(Box)(({ color }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '16px',
  '& svg': {
    fontSize: 40,
    color: color,
  },
}));

export default function Highlights() {
  return (
    <Box
      id="highlights"
      sx={{
        pt: { xs: 6, sm: 12 },
        pb: { xs: 8, sm: 16 },
        color: 'text.primary',
        bgcolor: 'background.paper',
      }}
    >
      <Container maxWidth="lg">
        <Box
          sx={{
            width: { sm: '100%', md: '60%' },
            textAlign: 'center',
            mx: 'auto',
            mb: 6,
            direction: 'rtl',
          }}
        >
          <Typography component="h2" variant="h3" gutterBottom>
            במה אנחנו מיוחדים?
          </Typography>
          <Typography variant="h6" sx={{ color: 'text.secondary' }}>
            לא משנה אם זה אירוע משפחתי קטן או כנס גדול – אצלנו תקבלו מערכת פשוטה, חכמה ויעילה שמרכזת את כל מה שצריך כדי לדאוג שכולם יגיעו – ויידעו על זה בזמן.
          </Typography>
        </Box>
        <Grid container spacing={5}>
          {items.map((item, index) => (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <StyledCard
                elevation={2}
                sx={{ 
                  direction: 'rtl',
                  textAlign: 'right',
                  borderTop: `4px solid ${item.color}`,
                }}
              >
                <FeatureIcon color={item.color}>
                  {item.icon}
                </FeatureIcon>
                <Typography gutterBottom variant="h5" sx={{ fontWeight: 'medium', mb: 2 }}>
                  {item.title}
                </Typography>
                <Typography variant="body1" sx={{ color: 'text.secondary', mb: 2 }}>
                  {item.description}
                </Typography>
              </StyledCard>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}
