import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import { alpha, Theme } from '@mui/material/styles';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';

const BRAND = '#888cee';
const SOFT = '#aab0f4';
const DEEP = '#6f74e0';

// Shared, premium field style for the auth forms — generous, modern, accessible.
export const authFieldSx = (theme: Theme) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 2.5,
    bgcolor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.04) : '#ffffff',
    fontSize: '1rem',
    transition: 'box-shadow .15s ease, border-color .15s ease',
    '& fieldset': { borderColor: alpha(theme.palette.text.primary, 0.16) },
    '&:hover fieldset': { borderColor: alpha(BRAND, 0.5) },
    '&.Mui-focused fieldset': { borderColor: BRAND, borderWidth: 2 },
    '&.Mui-focused': { boxShadow: `0 0 0 4px ${alpha(BRAND, 0.12)}` },
  },
  '& .MuiOutlinedInput-input': { padding: '15px 16px' },
  '& .MuiInputBase-input': { color: theme.palette.text.primary },
});

// Shared primary button style — large, confident, on-brand pastel.
export const authButtonSx = {
  py: 1.5,
  borderRadius: 2.5,
  fontSize: '1.05rem',
  fontWeight: 700,
  textTransform: 'none' as const,
  color: '#fff',
  boxShadow: 'none',
  background: `linear-gradient(90deg, ${BRAND}, ${SOFT})`,
  '&:hover': { background: `linear-gradient(90deg, ${DEEP}, ${BRAND})`, boxShadow: `0 12px 28px ${alpha(BRAND, 0.32)}` },
  '&.Mui-disabled': { background: alpha(BRAND, 0.45), color: '#fff' },
};

/**
 * The branded gradient panel shell (left side). Reusable across auth + payment:
 * pass any content as children; it keeps the wordmark on top and the help link at
 * the bottom, with the soft texture + glow. Hidden on mobile.
 */
export function AuthPanel({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' },
        position: 'relative',
        flexDirection: 'column',
        justifyContent: 'space-between',
        p: 6,
        color: '#fff',
        overflow: 'hidden',
        background: `linear-gradient(160deg, ${DEEP} 0%, ${BRAND} 55%, ${SOFT} 100%)`,
      }}
    >
      {/* soft texture + glow */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          opacity: 0.4,
          backgroundImage: `radial-gradient(${alpha('#ffffff', 0.16)} 1px, transparent 1.6px)`,
          backgroundSize: '26px 26px',
          pointerEvents: 'none',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: -120,
          insetInlineStart: -80,
          width: 360,
          height: 360,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha('#ffffff', 0.25)}, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      {/* wordmark */}
      <Box sx={{ position: 'relative', direction: 'rtl' }}>
        <Typography sx={{ fontWeight: 900, fontSize: '1.6rem', letterSpacing: 0.5 }}>ShowUp</Typography>
        <Typography sx={{ opacity: 0.85, fontSize: '0.9rem', mt: 0.5 }}>אישורי הגעה לאירועים, ישר בוואטסאפ</Typography>
      </Box>

      {/* middle content */}
      <Box sx={{ position: 'relative', direction: 'rtl', maxWidth: 440 }}>{children}</Box>

      {/* need help */}
      <Box sx={{ position: 'relative', direction: 'rtl' }}>
        <Link
          href="https://wa.me/972500000000"
          target="_blank"
          rel="noopener noreferrer"
          sx={{ color: '#fff', opacity: 0.9, fontWeight: 600, textDecoration: 'none', '&:hover': { opacity: 1, textDecoration: 'underline' } }}
        >
          צריכים עזרה? דברו איתנו בוואטסאפ
        </Link>
      </Box>
    </Box>
  );
}

const slides = [
  {
    icon: AutoAwesomeRoundedIcon,
    title: 'עוזר אישי שמבין עניין',
    text: 'מבקשים, והוא מבצע. מוסיף אורחים, שולח תזכורות, ויודע בדיוק מי זה מי.',
  },
  {
    icon: WhatsAppIcon,
    title: 'הכול קורה בוואטסאפ',
    text: 'בלי אפליקציות ובלי טפסים. בצ׳אט שכולם כבר מכירים, כל היום.',
  },
  {
    icon: NotificationsActiveRoundedIcon,
    title: 'הם ישכחו. אנחנו לא.',
    text: 'התזכורות יוצאות לבד, בזמן הנכון. גם הדודה הרחוקה תקבל אחת.',
  },
  {
    icon: InsightsRoundedIcon,
    title: 'תמיד יודעים כמה באים',
    text: 'אישורי הגעה מתעדכנים בזמן אמת, והכול מסודר במקום אחד.',
  },
];

/** Default left panel: an auto-rotating benefits carousel. */
function MarketingPanel() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % slides.length), 4800);
    return () => clearInterval(t);
  }, []);

  const slide = slides[active];
  const Icon = slide.icon;

  return (
    <AuthPanel>
      <Box
        key={active}
        sx={{
          animation: 'authFade .6s ease',
          '@keyframes authFade': {
            from: { opacity: 0, transform: 'translateY(12px)' },
            to: { opacity: 1, transform: 'none' },
          },
        }}
      >
        <Box
          sx={{
            width: 68,
            height: 68,
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 3,
            bgcolor: alpha('#ffffff', 0.16),
            border: `1px solid ${alpha('#ffffff', 0.25)}`,
            backdropFilter: 'blur(4px)',
          }}
        >
          <Icon sx={{ fontSize: 34, color: '#fff' }} />
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: '1.9rem', lineHeight: 1.2, mb: 1.5 }}>{slide.title}</Typography>
        <Typography sx={{ opacity: 0.9, fontSize: '1.05rem', lineHeight: 1.7 }}>{slide.text}</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mt: 4 }}>
        {slides.map((_, i) => (
          <Box
            key={i}
            role="button"
            aria-label={`שקופית ${i + 1}`}
            onClick={() => setActive(i)}
            sx={{
              height: 6,
              width: i === active ? 28 : 6,
              borderRadius: 999,
              cursor: 'pointer',
              transition: 'width .3s ease, background-color .3s ease',
              bgcolor: i === active ? '#fff' : alpha('#ffffff', 0.4),
            }}
          />
        ))}
      </Box>
    </AuthPanel>
  );
}

/**
 * Premium split-screen shell: branded panel on the left, clean content on the
 * right. Shared by Login, Register, the OTP step and Payment so the whole flow
 * feels like one continuation of the landing page. Pass `panel` to override the
 * default marketing carousel (e.g. the payment "what happens next" panel).
 */
export default function AuthLayout({ children, panel }: { children: React.ReactNode; panel?: React.ReactNode }) {
  return (
    <Box
      dir="rtl"
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
      }}
    >
      {/* RIGHT — content (first child sits on the right in RTL; the only column on mobile) */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 3, sm: 6, md: 8 },
          py: { xs: 6, md: 8 },
          bgcolor: 'background.default',
        }}
      >
        <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 4, textAlign: 'center' }}>
          <Box component="img" src="/logo.png" alt="ShowUp" sx={{ height: 44 }} />
        </Box>
        <Box sx={{ width: '100%', maxWidth: 440 }}>{children}</Box>
      </Box>

      {/* LEFT — branded panel */}
      {panel ?? <MarketingPanel />}
    </Box>
  );
}
