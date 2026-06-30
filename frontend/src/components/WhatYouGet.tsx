import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useTheme, alpha } from '@mui/material/styles';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import PersonAddAltRoundedIcon from '@mui/icons-material/PersonAddAltRounded';
import HowToRegRoundedIcon from '@mui/icons-material/HowToRegRounded';
import QuestionAnswerRoundedIcon from '@mui/icons-material/QuestionAnswerRounded';

// A few pastel cards, staggered in a zigzag - each one's top sits around the
// middle of its neighbour. Outcomes & experiences, not feature bullets.
type Card = {
  icon: React.ElementType;
  title: string;
  body: string;
  bg: string;
  accent: string;
  radius: string; // irregular corners
};

const cards: Card[] = [
  {
    icon: AutoAwesomeRoundedIcon,
    title: 'עוזר אישי שמבין עניין',
    body: 'מבקשים ממנו, והוא עושה. מוסיף אורחים, שולח תזכורות, יודע בדיוק מי זה מי. כאילו שכרתם מפיק, רק בלי המחיר של מפיק.',
    bg: '#ebebfb',
    accent: '#888cee',
    radius: '40px 40px 40px 12px',
  },
  {
    icon: PersonAddAltRoundedIcon,
    title: 'שלא תדעו מאקסלים',
    body: 'שולחים את אנשי הקשר לבוט בוואטסאפ, והרשימה מסתדרת לבד. בלי הקלדה ידנית, בלי קובץ שנעלם בדיוק כשצריך אותו.',
    bg: '#e6f5ec',
    accent: '#3aa56a',
    radius: '40px 12px 40px 40px',
  },
  {
    icon: HowToRegRoundedIcon,
    title: 'אישור הגעה בלחיצה',
    body: 'האורחים עונים ישר בוואטסאפ, בלחיצה אחת. בלי אפליקציה להוריד, בלי לינק מסתורי, בלי טופס שאף אחד לא ממלא.',
    bg: '#e8f0fc',
    accent: '#5d8fd6',
    radius: '12px 40px 40px 40px',
  },
  {
    icon: QuestionAnswerRoundedIcon,
    title: 'שואלים, ומקבלים תשובה',
    body: '"כמה אישרו?" "מי עוד לא ענה?" "תשלח להם תזכורת." הוא עונה ומבצע על המקום. גם ב‑2 בלילה, כשאתם לא מצליחים להירדם מרוב התרגשות.',
    bg: '#fce9f1',
    accent: '#d97aac',
    radius: '40px 40px 12px 40px',
  },
];

function useReveal<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function ValueCard({ card, index }: { card: Card; index: number }) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  const Icon = card.icon;
  const lowered = index % 2 === 1; // zigzag: every other card drops down
  return (
    <Box
      ref={ref}
      sx={{
        // The zigzag: even cards sit high, odd cards drop ~half a card down.
        mt: { xs: 0, md: lowered ? '120px' : 0 },
        minHeight: { md: 248 },
        p: { xs: 3, md: 3.5 },
        borderRadius: card.radius,
        bgcolor: card.bg,
        direction: 'rtl',
        textAlign: 'right',
        boxShadow: `0 20px 44px ${alpha(card.accent, 0.18)}`,
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(24px)',
        transition: `opacity 0.6s ease ${index * 0.08}s, transform 0.6s ease ${index * 0.08}s, box-shadow 0.3s ease`,
        '&:hover': {
          boxShadow: `0 28px 60px ${alpha(card.accent, 0.3)}`,
          transform: 'translateY(-6px)',
        },
      }}
    >
      <Box
        sx={{
          width: 54,
          height: 54,
          borderRadius: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          background: `linear-gradient(135deg, ${card.accent}, ${alpha(card.accent, 0.7)})`,
          boxShadow: `0 10px 22px ${alpha(card.accent, 0.4)}`,
          mb: 2.5,
        }}
      >
        <Icon sx={{ fontSize: 27 }} />
      </Box>
      <Typography sx={{ fontWeight: 800, fontSize: '1.2rem', color: '#2a2750', mb: 1 }}>{card.title}</Typography>
      <Typography sx={{ color: alpha('#2a2750', 0.7), lineHeight: 1.7, fontSize: '0.95rem' }}>{card.body}</Typography>
    </Box>
  );
}

export default function WhatYouGet() {
  const theme = useTheme();
  return (
    <Box
      id="what-you-get"
      sx={{
        py: { xs: 9, sm: 14 },
        bgcolor: theme.palette.mode === 'dark' ? 'background.default' : '#ffffff',
        color: 'text.primary',
        overflow: 'hidden',
      }}
    >
      <Container maxWidth="lg">
        <Box sx={{ textAlign: 'center', maxWidth: 700, mx: 'auto', mb: { xs: 6, sm: 8 }, direction: 'rtl' }}>
          <Typography variant="overline" sx={{ color: '#888cee', fontWeight: 700, letterSpacing: 1.5 }}>
            מה באמת מקבלים פה
          </Typography>
          <Typography component="h2" variant="h3" sx={{ fontWeight: 800, mt: 1.5, lineHeight: 1.15 }}>
            זאת לא עוד תוכנה. זה שקט נפשי.
          </Typography>
          <Typography variant="h6" sx={{ color: 'text.secondary', mt: 2, fontWeight: 400, lineHeight: 1.7 }}>
            תכף תרגישו שיש לכם צוות שלם מאחורי הקלעים. כזה שזוכר הכול, רודף אחרי האישורים במקומכם, ולא נלחץ אפילו יומיים לפני.
          </Typography>
        </Box>

        {/* zigzag pastel cards */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
            gap: { xs: 2.5, md: 3 },
            alignItems: 'start',
            pb: { md: '120px' }, // room for the dropped cards
          }}
        >
          {cards.map((card, i) => (
            <ValueCard key={card.title} card={card} index={i} />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
