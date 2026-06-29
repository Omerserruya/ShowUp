import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { styled, useTheme } from '@mui/material/styles';

// Icons
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';

// Brand-consistent accents: WhatsApp keeps its recognizable green; everything
// else uses the brand violet so the page reads as one calm, premium product.
const BRAND = '#888cee';

// --- Feature Data ---
const featureData = [
  {
    icon: WhatsAppIcon,
    title: 'אישורי הגעה ישירות בוואטסאפ',
    description:
      'האורחים מאשרים בלחיצה אחת, בצ׳אט שהם כבר מכירים — בלי אפליקציות, בלי לינקים ובלי טפסים. כך מגיעים ליותר אישורים, ובאמת.',
    color: '#16a34a',
  },
  {
    icon: InsightsRoundedIcon,
    title: 'תמונה מלאה בזמן אמת',
    description:
      'מי אישר, מי מתלבט וכמה בדיוק מגיעים — הכול מתעדכן לבד בדשבורד אחד ונקי, עד הרגע האחרון. אתם תמיד יודעים איפה הדברים עומדים.',
    color: BRAND,
  },
  {
    icon: ScheduleRoundedIcon,
    title: 'תקשורת אוטומטית, בתזמון הנכון',
    description:
      'הזמנה, תזכורות ותודה שאחרי — נשלחות מעצמן בדיוק בזמן הנכון לכל אירוע. מגדירים פעם אחת, והכול ממשיך לבד.',
    color: BRAND,
  },
  {
    icon: SupportAgentRoundedIcon,
    title: 'מענה מיידי לשאלות של אורחים',
    description:
      'שעה, מיקום, חניה, מתנות — האורחים מקבלים תשובה ברגע, בכל שעה. עוזר חכם עונה במקומכם, כדי שתישארו רגועים.',
    color: BRAND,
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
                background: 'linear-gradient(90deg,#aab0f4,#888cee)',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
                fontWeight: 800,
              }}
            >
              ShowUp?
            </Box>
          </Typography>
          <Typography variant="h6" sx={{ color: theme.palette.text.secondary, mt: 1 }}>
            כל מה שצריך כדי שהאורחים יידעו, יאשרו ויגיעו — במקום אחד, בלי כאב ראש.
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
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
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
