import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useTheme, alpha } from '@mui/material/styles';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import PersonAddAltRoundedIcon from '@mui/icons-material/PersonAddAltRounded';
import HowToRegRoundedIcon from '@mui/icons-material/HowToRegRounded';
import QuestionAnswerRoundedIcon from '@mui/icons-material/QuestionAnswerRounded';

const BRAND = '#9D83E0';
const DEEP = '#5A3DA6';

// Outcomes, not a feature grid. Four quiet columns under one hairline - the
// copy carries the weight, the icon just marks the beat.
type Item = { icon: React.ElementType; title: string; body: string };

const items: Item[] = [
  {
    icon: AutoAwesomeRoundedIcon,
    title: 'עוזר אישי שמבין עניין',
    body: 'מבקשים ממנו, והוא עושה. מוסיף אורחים, שולח תזכורות, יודע בדיוק מי זה מי. כאילו שכרתם מפיק, רק בלי המחיר של מפיק.',
  },
  {
    icon: PersonAddAltRoundedIcon,
    title: 'שלא תדעו מאקסלים',
    body: 'שולחים את אנשי הקשר בוואטסאפ, והרשימה מסתדרת לבד. בלי הקלדה ידנית, בלי קובץ שנעלם בדיוק כשצריך אותו.',
  },
  {
    icon: HowToRegRoundedIcon,
    title: 'אישור הגעה בלחיצה',
    body: 'האורחים עונים ישר בוואטסאפ, בלחיצה אחת. בלי אפליקציה להוריד, בלי לינק מסתורי, בלי טופס שאף אחד לא ממלא.',
  },
  {
    icon: QuestionAnswerRoundedIcon,
    title: 'שואלים, ומקבלים תשובה',
    body: '"כמה אישרו?" "מי עוד לא ענה?" "תשלח להם תזכורת." הוא עונה ומבצע על המקום. גם ב‑2 בלילה, כשאתם לא מצליחים להירדם.',
  },
];

function useReveal<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function ValueItem({ item, index }: { item: Item; index: number }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { ref, shown } = useReveal<HTMLDivElement>();
  const Icon = item.icon;
  return (
    <Box
      ref={ref}
      sx={{
        pt: 3,
        borderTop: '1px solid',
        borderColor: isDark ? alpha('#fff', 0.1) : alpha('#0f172a', 0.1),
        direction: 'rtl',
        textAlign: 'right',
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(14px)',
        transition: `opacity 0.5s ease ${index * 0.07}s, transform 0.5s ease ${index * 0.07}s`,
      }}
    >
      <Box
        sx={{
          width: 40, height: 40, borderRadius: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: DEEP, bgcolor: alpha(BRAND, isDark ? 0.18 : 0.12), mb: 2,
        }}
      >
        <Icon sx={{ fontSize: 22 }} />
      </Box>
      <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.01em', mb: 1 }}>{item.title}</Typography>
      <Typography sx={{ color: 'text.secondary', lineHeight: 1.75, fontSize: '0.95rem' }}>{item.body}</Typography>
    </Box>
  );
}

export default function WhatYouGet() {
  const theme = useTheme();
  return (
    <Box
      id="what-you-get"
      sx={{
        py: { xs: 8, sm: 12 },
        bgcolor: theme.palette.mode === 'dark' ? 'background.default' : '#ffffff',
        color: 'text.primary',
      }}
    >
      <Container maxWidth="lg" sx={{ px: { xs: 2.5, md: 4 } }}>
        <Box sx={{ maxWidth: 640, mb: { xs: 5, sm: 7 }, direction: 'rtl', mr: 0, ml: 'auto' }}>
          <Typography variant="overline" sx={{ color: BRAND, fontWeight: 700, letterSpacing: 1.5 }}>
            מה באמת מקבלים פה
          </Typography>
          <Typography component="h2" variant="h3" sx={{ fontWeight: 800, mt: 1, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            זאת לא עוד תוכנה. זה שקט נפשי.
          </Typography>
          <Typography variant="h6" sx={{ color: 'text.secondary', mt: 2, fontWeight: 400, lineHeight: 1.7 }}>
            תכף תרגישו שיש לכם צוות שלם מאחורי הקלעים. כזה שזוכר הכול, רודף אחרי האישורים במקומכם, ולא נלחץ אפילו יומיים לפני.
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
            gap: { xs: 3, md: 4 },
            direction: 'rtl',
          }}
        >
          {items.map((item, i) => (
            <ValueItem key={item.title} item={item} index={i} />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
