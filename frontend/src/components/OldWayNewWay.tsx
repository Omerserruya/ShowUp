import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useTheme, alpha } from '@mui/material/styles';
import PhoneMissedRoundedIcon from '@mui/icons-material/PhoneMissedRounded';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';

const BRAND = '#888cee';
const MUTE = '#94a3b8';

// Old-world "scraps" — the mess ShowUp clears away. Muted, tilted, overlapping.
function Scrap({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: object;
}) {
  return (
    <Box
      sx={{
        position: 'absolute',
        bgcolor: 'background.paper',
        border: `1px solid ${alpha(MUTE, 0.35)}`,
        borderRadius: 2.5,
        boxShadow: '0 10px 28px rgba(15,23,42,0.10)',
        p: 1.5,
        color: MUTE,
        filter: 'grayscale(0.4)',
        opacity: 0.92,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export default function OldWayNewWay() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const oldTags = ['אקסל', 'עשרות טלפונים', 'העתק־הדבק', '"מי ענה?"', 'תזכורות ידניות'];

  return (
    <Box
      id="why"
      sx={{
        py: { xs: 9, sm: 15 },
        bgcolor: isDark ? 'background.default' : '#f7f6fe',
        color: 'text.primary',
        overflow: 'hidden',
      }}
    >
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.05fr 0.95fr' },
            gap: { xs: 6, md: 9 },
            alignItems: 'center',
          }}
        >
          {/* Copy */}
          <Box sx={{ order: { xs: 1, md: 2 }, direction: 'rtl', textAlign: 'right' }}>
            <Typography variant="overline" sx={{ color: BRAND, fontWeight: 700, letterSpacing: 1.5 }}>
              דור חדש של ניהול אירועים
            </Typography>
            <Typography
              component="h2"
              variant="h2"
              sx={{ fontWeight: 800, mt: 1.5, lineHeight: 1.08, fontSize: { xs: '2.1rem', md: '3rem' } }}
            >
              פעם זה היה בלגן.
              <br />
              היום זה פשוט{' '}
              <Box component="span" sx={{ color: BRAND }}>
                עובד.
              </Box>
            </Typography>
            <Typography variant="h6" sx={{ color: 'text.secondary', mt: 2.5, fontWeight: 400, lineHeight: 1.75, maxWidth: 520 }}>
              אקסלים אינסופיים, עשרות טלפונים, תזכורות ידניות והתחושה ההיא של "מי בעצם אישר?" — כל זה נגמר.
              ShowUp לוקחת את כל הבלגן והופכת אותו לשיחה אחת רגועה בוואטסאפ, שמנהלת את עצמה.
            </Typography>

            {/* old-world words, crossed out — elegant, not a checklist */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 3.5 }}>
              {oldTags.map((t) => (
                <Box
                  key={t}
                  sx={{
                    px: 1.5,
                    py: 0.6,
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'text.secondary',
                    bgcolor: alpha(MUTE, 0.1),
                    textDecoration: 'line-through',
                    textDecorationColor: alpha(MUTE, 0.6),
                  }}
                >
                  {t}
                </Box>
              ))}
            </Box>
          </Box>

          {/* Visual: chaos resolving into one calm card */}
          <Box
            sx={{
              order: { xs: 2, md: 1 },
              position: 'relative',
              height: { xs: 340, sm: 420 },
              direction: 'rtl',
            }}
          >
            {/* scattered old-way scraps */}
            <Scrap sx={{ top: '4%', insetInlineEnd: '6%', width: 150, transform: 'rotate(-7deg)' }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, mb: 0.75 }}>אורחים.xlsx</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5 }}>
                {Array.from({ length: 9 }).map((_, i) => (
                  <Box key={i} sx={{ height: 9, borderRadius: 0.5, bgcolor: alpha(MUTE, 0.25) }} />
                ))}
              </Box>
            </Scrap>

            <Scrap sx={{ top: '2%', insetInlineStart: '4%', transform: 'rotate(6deg)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <PhoneMissedRoundedIcon sx={{ fontSize: 16, color: '#ef4444', opacity: 0.7 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>3 שיחות שלא נענו</Typography>
            </Scrap>

            <Scrap sx={{ bottom: '6%', insetInlineStart: '2%', transform: 'rotate(-5deg)', borderTopLeftRadius: 4 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>מי ענה בכלל? 🤔</Typography>
            </Scrap>

            <Scrap sx={{ bottom: '10%', insetInlineEnd: '8%', transform: 'rotate(7deg)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <AccessTimeRoundedIcon sx={{ fontSize: 15 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>לשלוח תזכורת… שוב</Typography>
            </Scrap>

            {/* the calm card — order from chaos, in focus */}
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: { xs: 230, sm: 270 },
                bgcolor: 'background.paper',
                borderRadius: '22px',
                border: `1px solid ${alpha(BRAND, 0.3)}`,
                boxShadow: `0 30px 70px ${alpha(BRAND, 0.28)}`,
                p: 2.5,
                zIndex: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    background: `linear-gradient(135deg, ${BRAND}, #aab0f4)`,
                  }}
                >
                  <CheckRoundedIcon sx={{ fontSize: 20 }} />
                </Box>
                <Typography sx={{ fontWeight: 800, fontSize: 16 }}>הכול מסודר</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                <Typography sx={{ fontWeight: 800, fontSize: 30, color: BRAND, lineHeight: 1 }}>312</Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>אישרו הגעה</Typography>
              </Box>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 1 }}>
                נשלח, נאסף ועודכן — אוטומטית בוואטסאפ.
              </Typography>
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
