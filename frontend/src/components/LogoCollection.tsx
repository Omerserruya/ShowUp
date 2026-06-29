import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MarkChatReadRoundedIcon from '@mui/icons-material/MarkChatReadRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';

/**
 * Trust band. Numbers are placeholders — wire these to real aggregate metrics
 * (events created, guests managed, average response rate) before launch.
 */
const stats = [
  { icon: CelebrationRoundedIcon, value: '12,000+', label: 'אירועים נוהלו ב‑ShowUp' },
  { icon: GroupsRoundedIcon, value: '2.4M', label: 'אורחים שעודכנו אוטומטית' },
  { icon: MarkChatReadRoundedIcon, value: '92%', label: 'ממוצע אישורי הגעה' },
  { icon: StarRoundedIcon, value: '4.9', label: 'דירוג ממוצע ממארחים' },
];

export default function LogoCollection() {
  return (
    <Container id="trust" sx={{ py: { xs: 4, sm: 6 } }}>
      <Box
        sx={{
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          px: { xs: 2, sm: 5 },
          py: { xs: 4, sm: 5 },
        }}
      >
        {/* Official-WhatsApp trust cue — anchors the numbers in credibility. */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            mb: { xs: 3, sm: 4 },
            direction: 'rtl',
            color: 'text.secondary',
            flexWrap: 'wrap',
            textAlign: 'center',
          }}
        >
          <WhatsAppIcon sx={{ fontSize: 20, color: '#25D366' }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            פועלת על תשתית WhatsApp Business הרשמית
          </Typography>
          <VerifiedRoundedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        </Box>
        <Grid container spacing={{ xs: 3, sm: 2 }}>
          {stats.map((s) => (
            <Grid xs={6} md={3} key={s.label}>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 0.75,
                }}
              >
                <s.icon sx={{ color: 'primary.main', fontSize: 30, mb: 0.5 }} />
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 800,
                    lineHeight: 1,
                    backgroundImage: (theme) =>
                      `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  {s.value}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 180 }}>
                  {s.label}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Container>
  );
}
