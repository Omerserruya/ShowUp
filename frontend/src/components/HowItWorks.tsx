import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useTheme, alpha } from '@mui/material/styles';

import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';

// Soft pastel brand — understated periwinkle, not a loud "AI" gradient.
const BRAND = '#888cee';
const PINK = '#aab0f4';
const WA = '#25D366';

/* ------------------------------------------------------------------ *
 * Scroll reveal — a small IntersectionObserver hook so each scene
 * fades + rises into view as the story scrolls. No external libs.
 * ------------------------------------------------------------------ */
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
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

/* ------------------------------------------------------------------ *
 * Product infographics — clean, hand-built (not stock/AI art).
 * ------------------------------------------------------------------ */

// 1. A WhatsApp invitation + one-tap reply.
function ChatVisual() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, direction: 'rtl' }}>
      <Box
        sx={{
          alignSelf: 'flex-start',
          maxWidth: '88%',
          bgcolor: '#fff',
          color: '#111827',
          borderRadius: '18px',
          borderTopRightRadius: 6,
          p: 1.75,
          boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
        }}
      >
        <Typography sx={{ fontWeight: 700, fontSize: 14.5 }}>החתונה של דנה ויוסי 💍</Typography>
        <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5 }}>
          יום שלישי, 19:30 · אולמי הגן, ראשון לציון
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1.25, flexWrap: 'wrap' }}>
          {['כן, אני מגיע 🎉', 'לא אוכל הפעם'].map((c) => (
            <Box
              key={c}
              sx={{
                px: 1.5,
                py: 0.6,
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                color: BRAND,
                bgcolor: alpha(BRAND, 0.08),
                border: `1px solid ${alpha(BRAND, 0.2)}`,
              }}
            >
              {c}
            </Box>
          ))}
        </Box>
      </Box>
      <Box
        sx={{
          alignSelf: 'flex-end',
          maxWidth: '70%',
          color: '#fff',
          background: `linear-gradient(135deg, ${WA}, #0f9d6a)`,
          borderRadius: '18px',
          borderTopLeftRadius: 6,
          px: 2,
          py: 1.25,
          fontWeight: 700,
          fontSize: 14.5,
          boxShadow: '0 10px 26px rgba(37,211,102,0.35)',
        }}
      >
        כן, אני מגיע 🎉
      </Box>
    </Box>
  );
}

// 2. A live RSVP dashboard — donut + stat tiles.
function DashboardVisual() {
  const pct = 84;
  const r = 42;
  const c = 2 * Math.PI * r;
  const tiles = [
    { n: '248', label: 'מגיעים', color: WA },
    { n: '63', label: 'טרם ענו', color: '#f59e0b' },
    { n: '29', label: 'לא יגיעו', color: '#94a3b8' },
  ];
  return (
    <Box sx={{ direction: 'rtl' }}>
      <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 2 }}>מצב אישורי הגעה</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
          <Box component="svg" viewBox="0 0 100 100" sx={{ width: 132, height: 132, transform: 'rotate(-90deg)' }}>
            <circle cx="50" cy="50" r={r} fill="none" stroke={alpha(BRAND, 0.12)} strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={BRAND}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - pct / 100)}
            />
          </Box>
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ fontWeight: 800, fontSize: 26, lineHeight: 1, color: BRAND }}>{pct}%</Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>אישרו</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minWidth: 150 }}>
          {tiles.map((t) => (
            <Box key={t.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: t.color, flexShrink: 0 }} />
              <Typography sx={{ fontWeight: 800, fontSize: 16 }}>{t.n}</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{t.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// 3. The adaptive communication timeline — a vertical rail.
function TimelineVisual() {
  const items = [
    { icon: MailOutlineRoundedIcon, label: 'הזמנה', when: '30 יום לפני' },
    { icon: NotificationsActiveRoundedIcon, label: 'תזכורת', when: 'שבוע לפני' },
    { icon: NotificationsActiveRoundedIcon, label: 'תזכורת אחרונה', when: 'יום לפני' },
    { icon: CelebrationRoundedIcon, label: 'תודה', when: 'אחרי האירוע' },
  ];
  return (
    <Box sx={{ direction: 'rtl', position: 'relative', pr: 0.5 }}>
      <Box
        sx={{
          position: 'absolute',
          top: 14,
          bottom: 14,
          insetInlineStart: 19,
          width: 2,
          background: `linear-gradient(${BRAND}, ${PINK})`,
          opacity: 0.4,
        }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Box key={it.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, position: 'relative' }}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  background: `linear-gradient(135deg, ${BRAND}, ${PINK})`,
                  flexShrink: 0,
                  zIndex: 1,
                  boxShadow: `0 6px 16px ${alpha(BRAND, 0.3)}`,
                }}
              >
                <Icon sx={{ fontSize: 20 }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 14.5 }}>{it.label}</Typography>
              </Box>
              <Box
                sx={{
                  px: 1.25,
                  py: 0.4,
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'text.secondary',
                  bgcolor: (theme) => (theme.palette.mode === 'dark' ? alpha('#fff', 0.06) : alpha(BRAND, 0.06)),
                }}
              >
                {it.when}
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 2, color: BRAND }}>
        <AccessTimeRoundedIcon sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>מתכוונן לבד לזמן שנשאר</Typography>
      </Box>
    </Box>
  );
}

// 4. You're in control — you command the assistant, it performs.
function ControlVisual() {
  const commands = [
    { cmd: 'תשלח תזכורת למי שלא ענה', done: '48 תזכורות יצאו' },
    { cmd: 'תעדכן את שעת האירוע ל־20:00', done: 'עודכן בכל ההודעות' },
    { cmd: 'מי עוד לא אישר?', done: '48 אורחים. הנה הם.' },
  ];
  return (
    <Box sx={{ direction: 'rtl' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: WA, boxShadow: `0 0 0 4px ${alpha(WA, 0.18)}` }} />
        <Typography sx={{ fontWeight: 800, fontSize: 14 }}>עוזר האירוע</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>· מקוון</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        {commands.map((c) => (
          <Box key={c.cmd}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                px: 1.75,
                py: 1,
                borderRadius: '16px',
                borderTopRightRadius: 6,
                color: '#fff',
                background: `linear-gradient(135deg, ${BRAND}, ${PINK})`,
                fontWeight: 700,
                fontSize: 14,
                boxShadow: `0 8px 20px ${alpha(BRAND, 0.28)}`,
              }}
            >
              {c.cmd}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75, mr: 0.5 }}>
              <Box
                sx={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha('#16a34a', 0.14),
                  color: '#16a34a',
                  flexShrink: 0,
                }}
              >
                <CheckRoundedIcon sx={{ fontSize: 12 }} />
              </Box>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', fontWeight: 600 }}>{c.done}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

interface Scene {
  num: string;
  title: string;
  desc: string;
  bullets?: string[];
  tint: string;
  visual: React.ReactNode;
}

const scenes: Scene[] = [
  {
    num: '01',
    title: 'הזמנה שמרגישה אישית',
    desc: 'כל אורח מקבל הזמנה ישר לוואטסאפ, ומאשר בלחיצה. ככה עונים יותר אנשים, ובאמת. כי כולם כבר שם, כל היום.',
    bullets: ['בצ׳אט שכולם מכירים', 'גם בחירת מנה, באותה שיחה'],
    tint: WA,
    visual: <ChatVisual />,
  },
  {
    num: '02',
    title: 'אתם תמיד יודעים כמה באים',
    desc: 'מי אישר, מי עוד מתלבט, וכמה בדיוק יושבים מול האולם. הכול מתעדכן לבד, בזמן אמת. סוף סוף אפשר לנשום.',
    bullets: ['עדכון חי עד הרגע האחרון', 'מספר מדויק לקייטרינג ולהושבה'],
    tint: BRAND,
    visual: <DashboardVisual />,
  },
  {
    num: '03',
    title: 'הם ישכחו. אנחנו לא.',
    desc: 'אנחנו בונים לבד את כל רצף ההודעות. הזמנה, תזכורת, ותודה שאחרי. גם הדודה הרחוקה תקבל תזכורת בזמן. אתם מאשרים פעם אחת, ושוכחים מזה לתמיד.',
    tint: PINK,
    visual: <TimelineVisual />,
  },
  {
    num: '04',
    title: 'אתם המנהלים. הוא העובד.',
    desc: 'אומרים לעוזר מה לעשות, והוא עושה. שולח תזכורות, מעדכן שעה, שולף לכם מספרים. אתם מחליטים, הוא רץ. בלי להיכנס לשום מסך.',
    bullets: ['מדברים איתו בשפה רגילה', 'הוא זוכר הכול, ומבצע מיד'],
    tint: BRAND,
    visual: <ControlVisual />,
  },
];

function SceneRow({ scene, flip }: { scene: Scene; flip: boolean }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { ref, shown } = useReveal<HTMLDivElement>();

  return (
    <Box
      ref={ref}
      sx={{
        display: 'grid',
        // Give the infographic the larger share so it's the star of each scene.
        gridTemplateColumns: { xs: '1fr', md: flip ? '0.82fr 1.18fr' : '1.18fr 0.82fr' },
        gap: { xs: 5, md: 10 },
        alignItems: 'center',
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(28px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
      }}
    >
      {/* Visual panel — large, rounded, tinted, gently offset for an editorial feel. */}
      <Box sx={{ order: { xs: 2, md: flip ? 2 : 1 }, position: 'relative' }}>
        <Box
          sx={{
            position: 'absolute',
            inset: -18,
            borderRadius: 52,
            background: `radial-gradient(circle at 30% 15%, ${alpha(scene.tint, 0.22)}, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            position: 'relative',
            borderRadius: '32px',
            p: { xs: 3, md: 5 },
            bgcolor: isDark ? alpha('#ffffff', 0.04) : '#ffffff',
            border: `1px solid ${isDark ? alpha('#fff', 0.1) : alpha(scene.tint, 0.18)}`,
            boxShadow: isDark ? `0 24px 60px ${alpha('#000', 0.4)}` : `0 34px 90px ${alpha(scene.tint, 0.24)}`,
            transform: { md: flip ? 'rotate(0.6deg)' : 'rotate(-0.6deg)' },
          }}
        >
          {scene.visual}
        </Box>
      </Box>

      {/* Copy */}
      <Box sx={{ order: { xs: 1, md: flip ? 1 : 2 }, direction: 'rtl', textAlign: 'right', px: { md: 1 } }}>
        <Typography
          sx={{
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1,
            color: alpha(scene.tint, isDark ? 0.6 : 0.35),
            mb: 1.5,
          }}
        >
          {scene.num}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 800, mb: 1.5, fontSize: { xs: '1.6rem', md: '2rem' } }}>
          {scene.title}
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', lineHeight: 1.8, maxWidth: 480 }}>
          {scene.desc}
        </Typography>
        {scene.bullets && (
          <Box sx={{ mt: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {scene.bullets.map((b) => (
              <Box key={b} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: alpha(scene.tint, 0.12),
                    color: scene.tint,
                    flexShrink: 0,
                  }}
                >
                  <CheckRoundedIcon sx={{ fontSize: 15 }} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {b}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function HowItWorks() {
  const theme = useTheme();
  return (
    <Box
      id="how-it-works"
      sx={{
        py: { xs: 8, sm: 14 },
        bgcolor: theme.palette.mode === 'dark' ? 'background.default' : '#ffffff',
        color: 'text.primary',
        overflow: 'hidden',
      }}
    >
      <Container maxWidth="lg">
        <Box sx={{ textAlign: 'center', maxWidth: 680, mx: 'auto', mb: { xs: 7, sm: 11 }, direction: 'rtl' }}>
          <Typography variant="overline" sx={{ color: BRAND, fontWeight: 700, letterSpacing: 1.5 }}>
            הכול קורה בוואטסאפ
          </Typography>
          <Typography component="h2" variant="h3" sx={{ fontWeight: 800, mt: 1 }}>
            אתם מארגנים אירוע, לא מערכת
          </Typography>
          <Typography variant="h6" sx={{ color: 'text.secondary', mt: 1.5, fontWeight: 400 }}>
            המעקב, התזכורות והתשובות לאורחים? עלינו. אתם פשוט רואים איך האישורים נכנסים, אחד אחרי השני.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 9, sm: 16 } }}>
          {scenes.map((s, i) => (
            <SceneRow key={s.num} scene={s} flip={i % 2 === 1} />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
