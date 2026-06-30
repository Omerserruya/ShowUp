import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlaceIcon from '@mui/icons-material/Place';
import { InvitationConfig, InvitationData, DEFAULT_INVITATION, formatLocation } from './types';

const TEXTURES: Record<string, string> = {
  linen:
    'repeating-linear-gradient(45deg, rgba(0,0,0,0.02) 0 2px, transparent 2px 4px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.02) 0 2px, transparent 2px 4px)',
  paper: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)',
  none: 'none',
};

function hebDate(iso?: string | null) {
  if (!iso) return { date: '', time: '' };
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }),
      time: d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    };
  } catch {
    return { date: '', time: '' };
  }
}

/**
 * The envelope: a closed envelope whose flap opens (revealing the invitation)
 * the first time it scrolls into view, and on click. Pure CSS transforms - no
 * animation library.
 */
function Envelope({ config, opened, onOpen }: { config: InvitationConfig; opened: boolean; onOpen: () => void }) {
  const env = config.envelope || {};
  const color = env.color || '#f5efe6';
  const texture = TEXTURES[env.texture || 'linen'] ?? 'none';
  return (
    <Box
      onClick={onOpen}
      role="button"
      aria-label="פתח/י את ההזמנה"
      sx={{
        cursor: opened ? 'default' : 'pointer',
        width: { xs: 280, sm: 360 },
        height: { xs: 190, sm: 244 },
        position: 'relative',
        mx: 'auto',
        perspective: '1200px',
        transition: 'transform 0.6s ease, opacity 0.6s ease',
        transform: opened ? 'scale(0.92)' : 'scale(1)',
      }}
    >
      {/* Envelope body */}
      <Box sx={{
        position: 'absolute', inset: 0, borderRadius: 2,
        backgroundColor: color, backgroundImage: texture, backgroundSize: '8px 8px',
        boxShadow: '0 18px 40px rgba(0,0,0,0.22)', overflow: 'hidden',
      }}>
        {/* Stamp */}
        <Box sx={{
          position: 'absolute', top: 14, left: 14, width: 56, height: 68,
          border: '2px dashed rgba(0,0,0,0.25)', borderRadius: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', p: 0.5, transform: 'rotate(-4deg)',
          backgroundColor: 'rgba(255,255,255,0.4)',
        }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, fontFamily: env.font || 'serif', lineHeight: 1.1 }}>
            {env.stampText || '♥'}
          </Typography>
        </Box>
        {/* Envelope text */}
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontFamily: env.font || 'serif', fontSize: { xs: 22, sm: 28 }, color: 'rgba(0,0,0,0.7)', letterSpacing: 2 }}>
            {env.envelopeText || 'הזמנה'}
          </Typography>
        </Box>
      </Box>
      {/* Flap */}
      <Box sx={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '54%',
        transformOrigin: 'top', transition: 'transform 0.7s ease',
        transform: opened ? 'rotateX(180deg)' : 'rotateX(0deg)',
        backgroundColor: color, backgroundImage: texture, backgroundSize: '8px 8px',
        clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
        boxShadow: opened ? 'none' : '0 4px 8px rgba(0,0,0,0.12)',
        zIndex: opened ? 0 : 3,
      }} />
      {!opened && (
        <Typography sx={{ position: 'absolute', bottom: -28, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'text.secondary' }}>
          הקליקו לפתיחה ↑
        </Typography>
      )}
    </Box>
  );
}

interface Props {
  data: InvitationData;
  /** Render the RSVP slot (the public page injects a form here). */
  rsvpSlot?: React.ReactNode;
  /** Editor preview forces the open state and disables scroll auto-open. */
  forceOpen?: boolean;
}

export default function InvitationView({ data, rsvpSlot, forceOpen }: Props) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const cfg: InvitationConfig = { ...DEFAULT_INVITATION, ...(data.invitation || {}) };
  const [opened, setOpened] = useState(!!forceOpen);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (forceOpen) { setOpened(true); return; }
  }, [forceOpen]);

  // Auto-open the envelope when it scrolls into view.
  useEffect(() => {
    if (forceOpen || opened) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setTimeout(() => setOpened(true), 350);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [forceOpen, opened]);

  const { date, time } = hebDate(data.event_date);
  const loc = formatLocation(data.location);
  const font = cfg.fontFamily || 'serif';

  const hero = (
    <Box sx={{ textAlign: 'center' }}>
      {cfg.hero?.imageUrl ? (
        <Box
          component="img"
          src={cfg.hero.imageUrl}
          alt={data.name}
          sx={{ width: '100%', maxWidth: 460, maxHeight: 520, objectFit: 'cover', borderRadius: 3, boxShadow: '0 14px 36px rgba(0,0,0,0.18)' }}
        />
      ) : (
        <Box sx={{ width: '100%', maxWidth: 460, height: 320, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto' }}>
          <Typography color="text.secondary">תמונת האירוע</Typography>
        </Box>
      )}
      <Typography sx={{ mt: 3, fontFamily: cfg.hero?.font || font, fontSize: { xs: 34, md: 46 }, fontWeight: 700, lineHeight: 1.15 }}>
        {cfg.hero?.bigText || data.name}
      </Typography>
      {date && (
        <Typography sx={{ mt: 1.5, fontFamily: font, fontSize: { xs: 18, md: 22 }, color: 'text.secondary' }}>
          {date}
        </Typography>
      )}
    </Box>
  );

  const textColumn = (
    <Box sx={{ textAlign: 'center', maxWidth: 460, mx: 'auto' }}>
      {data.inviters && data.inviters.length > 0 && (
        <Typography sx={{ fontFamily: font, fontSize: { xs: 20, md: 24 }, fontWeight: 600, mb: 2 }}>
          {data.inviters.map((i) => `${i.fn} ${i.ln}`).join(' & ')}
        </Typography>
      )}
      {cfg.personalText && (
        <Typography sx={{ fontFamily: font, fontSize: { xs: 17, md: 19 }, lineHeight: 1.8, whiteSpace: 'pre-wrap', mb: 4 }}>
          {cfg.personalText}
        </Typography>
      )}

      {/* Event details with icons */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center', mb: 4 }}>
        {cfg.details?.showDate !== false && date && (
          <DetailRow icon={<CalendarMonthIcon />} text={date} />
        )}
        {cfg.details?.showTime !== false && time && (
          <DetailRow icon={<AccessTimeIcon />} text={time} />
        )}
        {cfg.details?.showLocation !== false && loc && (
          <DetailRow icon={<PlaceIcon />} text={loc} />
        )}
      </Box>

      {cfg.rsvpEnabled !== false && rsvpSlot}
    </Box>
  );

  return (
    <Box sx={{ fontFamily: font, color: '#2b2b2b' }}>
      {/* Envelope (scroll target) */}
      <Box ref={sentinelRef} sx={{ py: { xs: 6, md: 8 }, display: 'flex', justifyContent: 'center' }}>
        <Envelope config={cfg} opened={opened} onOpen={() => setOpened(true)} />
      </Box>

      {/* Invitation content - revealed when opened */}
      <Box
        sx={{
          maxWidth: 1100, mx: 'auto', px: { xs: 3, md: 6 }, pb: 10,
          opacity: opened ? 1 : 0,
          transform: opened ? 'translateY(0)' : 'translateY(24px)',
          transition: 'opacity 0.8s ease 0.3s, transform 0.8s ease 0.3s',
          pointerEvents: opened ? 'auto' : 'none',
        }}
      >
        {isDesktop ? (
          // Desktop: image on the right, text on the left.
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, alignItems: 'center', direction: 'rtl' }}>
            <Box>{hero}</Box>
            <Box>{textColumn}</Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {hero}
            {textColumn}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function DetailRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.primary' }}>
      <Box sx={{ display: 'flex', color: 'text.secondary' }}>{icon}</Box>
      <Typography sx={{ fontSize: { xs: 16, md: 18 } }}>{text}</Typography>
    </Box>
  );
}
