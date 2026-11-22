import * as React from 'react';
import { Container, Typography, Box, Link, Divider } from '@mui/material';

// Public support page (App Store "Support URL"). Contact details match the footer.
const SUPPORT_WA = (process.env.REACT_APP_WHATSAPP_NUMBER || '+972-525401686').replace(/\D/g, '');
const SUPPORT_EMAIL = 'support@showup-rsvp.com';

const QA: { q: string; a: React.ReactNode }[] = [
  { q: 'איך מתחברים?', a: 'מזינים את מספר הטלפון ומקבלים קוד חד־פעמי בוואטסאפ. אין סיסמה.' },
  { q: 'איך מוסיפים אורחים מאנשי הקשר בטלפון?', a: 'במסך "מוזמנים" לוחצים "הוספת אורחים" ← "מאנשי הקשר בטלפון", בוחרים את האנשים ומאשרים. רק מי שבחרתם נשלח אלינו.' },
  { q: 'איך מפעילים או מכבים התראות?', a: 'בהגדרות הטלפון ← ShowUp ← התראות. בפרופיל באפליקציה יש כפתור לשליחת התראת בדיקה.' },
  { q: 'איך מוחקים את החשבון?', a: 'בפרופיל ← "מחיקת החשבון". המחיקה כוללת את האירועים, האורחים וההודעות של החשבון, והיא סופית.' },
];

export default function Support() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }} dir="rtl">
      <Typography variant="h3" component="h1" sx={{ fontWeight: 800, mb: 1 }}>תמיכה</Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        ShowUp - הזמנות דיגיטליות ואישורי הגעה לאירועים. יש שאלה או תקלה? אנחנו כאן.
      </Typography>
      <Box sx={{ display: 'grid', gap: 1, mb: 4 }}>
        <Typography>וואטסאפ: <Link href={`https://wa.me/${SUPPORT_WA}`} target="_blank" rel="noopener noreferrer">{`0${SUPPORT_WA.slice(3)}`}</Link></Typography>
        <Typography>דוא"ל: <Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link></Typography>
      </Box>
      <Divider sx={{ mb: 3 }} />
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 2 }}>שאלות נפוצות</Typography>
      <Box sx={{ display: 'grid', gap: 2.5 }}>
        {QA.map((x) => (
          <Box key={x.q}>
            <Typography sx={{ fontWeight: 700 }}>{x.q}</Typography>
            <Typography color="text.secondary">{x.a}</Typography>
          </Box>
        ))}
      </Box>
      <Typography sx={{ mt: 5 }} color="text.secondary">
        <Link href="/privacy">מדיניות פרטיות</Link> · <Link href="/terms">תנאי שימוש</Link>
      </Typography>
    </Container>
  );
}
