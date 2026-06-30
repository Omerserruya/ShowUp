import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useTheme, alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

import WhatsAppIcon from '@mui/icons-material/WhatsApp';

const BRAND = '#888cee';
const SOFT = '#aab0f4';
const WA = '#25D366';

// Things you simply say - shown as command chips (intelligence through use).
const askChips = [
  '"שנה את שעת האירוע"',
  '"כמה עדיין לא אישרו?"',
  '"תשלח שוב למי שלא ענה"',
  '"תעלה את הקבוצה הזו לרשימה"',
  '"מי הצמחונים?"',
  '"תוסיף את דנה לרשימה"',
];

// A short, real conversation that performs actions.
type Turn = { from: 'me' | 'bot'; text: string };
const conversation: Turn[] = [
  { from: 'me', text: 'תוסיף את דנה כהן ויוסי לוי לרשימה' },
  { from: 'bot', text: 'הוספתי 👍 דנה ויוסי כבר ברשימת המוזמנים.' },
  { from: 'me', text: 'כמה אישרו עד עכשיו?' },
  { from: 'bot', text: '312 אישרו הגעה, 48 עדיין לא ענו ו־29 לא יגיעו.' },
  { from: 'me', text: 'תשלח תזכורת למי שלא ענה' },
  { from: 'bot', text: 'יצא! שלחתי תזכורת ל־48 האורחים שטרם השיבו.' },
];

function ChatMock() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, sm: 3 }, direction: 'rtl' }}>
      {conversation.map((t, i) =>
        t.from === 'me' ? (
          <Box
            key={i}
            sx={{
              alignSelf: 'flex-end',
              maxWidth: '82%',
              color: '#fff',
              background: `linear-gradient(135deg, ${WA}, #0f9d6a)`,
              borderRadius: '18px',
              borderTopLeftRadius: 6,
              px: 1.75,
              py: 1.1,
              fontSize: 14,
              fontWeight: 600,
              boxShadow: '0 8px 20px rgba(37,211,102,0.25)',
            }}
          >
            {t.text}
          </Box>
        ) : (
          <Box
            key={i}
            sx={{
              alignSelf: 'flex-start',
              maxWidth: '88%',
              bgcolor: '#fff',
              color: '#111827',
              borderRadius: '18px',
              borderTopRightRadius: 6,
              px: 1.75,
              py: 1.1,
              fontSize: 14,
              boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
            }}
          >
            {t.text}
          </Box>
        ),
      )}
    </Box>
  );
}

export default function Assistant() {
  const theme = useTheme();
  const navigate = useNavigate();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      id="assistant"
      sx={{
        position: 'relative',
        py: { xs: 9, sm: 15 },
        bgcolor: isDark ? 'background.default' : '#ffffff',
        color: 'text.primary',
        overflow: 'hidden',
      }}
    >
      {/* Full-bleed brand "infographic" panel on the left - square at the page edge,
          rounded only on the inner (center-facing) side. The chat floats over it. */}
      <Box
        sx={{
          display: { xs: 'none', md: 'block' },
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: '47%',
          background: `linear-gradient(150deg, ${BRAND} 0%, ${SOFT} 100%)`,
          borderTopRightRadius: 72,
          borderBottomRightRadius: 72,
          overflow: 'hidden',
        }}
      >
        {/* faint dot texture */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: 0.5,
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.28) 1.5px, transparent 1.6px)',
            backgroundSize: '22px 22px',
          }}
        />
        {/* soft light glow */}
        <Box
          sx={{
            position: 'absolute',
            bottom: -90,
            left: -50,
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.3), transparent 70%)',
          }}
        />
      </Box>

      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: { xs: 5, md: 8 },
            alignItems: 'center',
          }}
        >
          {/* INFO - right side (read first in RTL) */}
          <Box sx={{ order: { xs: 1, md: 1 }, direction: 'rtl', textAlign: 'right' }}>
            <Typography variant="overline" sx={{ color: BRAND, fontWeight: 700, letterSpacing: 1.5 }}>
              העוזר של ShowUp
            </Typography>
            <Typography component="h2" variant="h3" sx={{ fontWeight: 800, lineHeight: 1.12, mt: 1 }}>
              לא צ׳אטבוט.{' '}
              <Box component="span" sx={{ color: BRAND }}>
                עוזר אישי לאירוע.
              </Box>
            </Typography>
            <Typography variant="h6" sx={{ color: 'text.secondary', mt: 2, fontWeight: 400, lineHeight: 1.7 }}>
              שואלים, מבקשים, והוא פשוט עושה. הוא מכיר את האירוע שלכם וזוכר כל פרט קטן. כל הניהול קורה
              בתוך וואטסאפ. בלי מסכים, בלי טפסים, בלי לחפש איפה לחצתם פעם שעברה.
            </Typography>

            {/* FEATURES - restyled as a cloud of spoken-command chips */}
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 4, mb: 1.5 }}>
              פשוט אומרים לו:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {askChips.map((c) => (
                <Box
                  key={c}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.75,
                    px: 1.75,
                    py: 0.9,
                    borderRadius: 999,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: 'text.primary',
                    bgcolor: isDark ? alpha(BRAND, 0.12) : '#ffffff',
                    border: `1px solid ${alpha(BRAND, 0.3)}`,
                    boxShadow: isDark ? 'none' : `0 4px 14px ${alpha(BRAND, 0.1)}`,
                  }}
                >
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: BRAND, flexShrink: 0 }} />
                  {c}
                </Box>
              ))}
            </Box>

            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3.5, fontWeight: 600 }}>
              במקום ללמוד עוד מערכת, פשוט מדברים. הוא זוכר את ההקשר ועושה את העבודה. אתם מרוויחים שעות.
            </Typography>
            <Button
              onClick={() => navigate('/wizard')}
              variant="contained"
              startIcon={<WhatsAppIcon />}
              sx={{
                mt: 3,
                borderRadius: 999,
                px: 3,
                py: 1.1,
                fontWeight: 700,
                textTransform: 'none',
                background: `linear-gradient(90deg, ${BRAND}, ${SOFT})`,
                boxShadow: `0 10px 24px ${alpha(BRAND, 0.26)}`,
                '& .MuiButton-startIcon': { ml: 0.5, mr: -0.25 },
                '&:hover': { background: `linear-gradient(90deg, #7378e4, #9a9ff2)`, boxShadow: `0 14px 30px ${alpha(BRAND, 0.34)}` },
              }}
            >
              בואו תכירו אותו
            </Button>
          </Box>

          {/* CHAT - just the messages, floating directly over the brand panel */}
          <Box sx={{ order: { xs: 2, md: 2 }, display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ width: '100%', maxWidth: 460 }}>
              <ChatMock />
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
