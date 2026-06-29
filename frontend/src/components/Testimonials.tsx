import * as React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Rating from '@mui/material/Rating';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';

/**
 * Social proof. Copy/avatars are representative samples — replace `userTestimonials`
 * and the aggregate rating with real, opt-in customer quotes before launch.
 */
const userTestimonials = [
  {
    initials: 'נ״א',
    name: 'נועה ואורן',
    occupation: 'חתונה · 420 אורחים',
    color: 'hsl(262, 76%, 59%)',
    testimonial:
      'הפסקנו לרדוף אחרי אנשים בטלפון. תוך יומיים היו לנו 80% אישורי הגעה, והכול עודכן לבד בדשבורד. פשוט קסם.',
  },
  {
    initials: 'ל״מ',
    name: 'ליאת מזרחי',
    occupation: 'בר מצווה · 180 אורחים',
    color: 'hsl(330, 81%, 60%)',
    testimonial:
      'הכי אהבתי שהאורחים פשוט מקבלים הודעה בוואטסאפ ועונים. בלי אפליקציות, בלי לינקים מסובכים. גם סבתא הסתדרה.',
  },
  {
    initials: 'ד״כ',
    name: 'דניאל כהן',
    occupation: 'אירוע חברה · 600 אורחים',
    color: 'hsl(199, 89%, 48%)',
    testimonial:
      'ארגנתי כנס לחברה והמערכת חסכה לי ימי עבודה. התזכורות האוטומטיות הביאו עוד עשרות מאשרים בלי שנגעתי בכלום.',
  },
  {
    initials: 'ש״ב',
    name: 'שירה בן דוד',
    occupation: 'חתונה · 300 אורחים',
    color: 'hsl(120, 44%, 53%)',
    testimonial:
      'הדבר הכי מלחיץ בחתונה זה לא לדעת כמה באים. פה ראינו את המספר מתעדכן בזמן אמת וישבנו רגועים מול האולם.',
  },
  {
    initials: 'י״פ',
    name: 'יוסי פרץ',
    occupation: 'ברית · 120 אורחים',
    color: 'hsl(45, 90%, 45%)',
    testimonial:
      'הכול היה מוכן בעשר דקות. שלחנו הזמנה אחת והמערכת המשיכה לבד עם תזכורות. שווה כל שקל.',
  },
  {
    initials: 'מ״ל',
    name: 'מאיה לוי',
    occupation: 'בת מצווה · 220 אורחים',
    color: 'hsl(280, 70%, 55%)',
    testimonial:
      'גם בחירת המנות עברה דרך וואטסאפ. הגענו לאולם עם רשימה מסודרת לפי שולחנות. הקייטרינג חשב שאנחנו אלופים.',
  },
];

const AGGREGATE_RATING = 4.9;
const REVIEW_COUNT = 1280;

export default function Testimonials() {
  return (
    <Container
      id="testimonials"
      sx={{
        pt: { xs: 6, sm: 12 },
        pb: { xs: 8, sm: 14 },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: { xs: 4, sm: 6 },
      }}
    >
      <Box sx={{ width: { sm: '100%', md: '70%' }, textAlign: 'center' }}>
        <Typography component="h2" variant="h3" sx={{ fontWeight: 700, mb: 1.5 }}>
          מארחים מספרים
        </Typography>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <Rating value={AGGREGATE_RATING} precision={0.1} readOnly size="small" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {AGGREGATE_RATING.toFixed(1)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            מתוך {REVIEW_COUNT.toLocaleString('he-IL')} מארחים שדירגו אותנו
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {userTestimonials.map((t, index) => (
          <Grid xs={12} sm={6} md={4} key={index} sx={{ display: 'flex' }}>
            <Card
              variant="outlined"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                flexGrow: 1,
                p: 1,
                borderRadius: 3,
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 6,
                },
              }}
            >
              <CardContent
                sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: 2 }}
              >
                <FormatQuoteRoundedIcon
                  sx={{ color: 'primary.main', opacity: 0.35, fontSize: 36, transform: 'scaleX(-1)' }}
                />
                <Typography
                  variant="body1"
                  sx={{ color: 'text.primary', flexGrow: 1, lineHeight: 1.7 }}
                >
                  {t.testimonial}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                  <Avatar sx={{ bgcolor: t.color, color: '#fff', fontWeight: 700, fontSize: 14 }}>
                    {t.initials}
                  </Avatar>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {t.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t.occupation}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}
