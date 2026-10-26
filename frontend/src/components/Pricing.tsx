import React from 'react';
import { Box, Container, Typography, Button } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useTheme, alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { plans } from '../config/plans';
import PriceTag from './PriceTag';

const BRAND = '#9D83E0';
const DEEP = '#5A3DA6';

/**
 * Three plans, one visual language. The recommended plan is lifted by a brand
 * border and a filled button; the others stay quiet with an outlined button.
 * No per-plan colors - the difference between plans is the number, not the hue.
 */
export default function Pricing() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();

  const handleStartNow = (planId: string) => {
    navigate(`/wizard?package=${planId}`);
  };

  return (
    <Box
      id="pricing"
      sx={{
        py: { xs: 8, md: 12 },
        bgcolor: isDark ? theme.palette.background.default : '#ffffff',
      }}
    >
      <Container maxWidth="lg" sx={{ px: { xs: 2.5, md: 4 } }}>
        <Box sx={{ textAlign: 'center', maxWidth: 620, mx: 'auto', mb: { xs: 5, md: 7 }, direction: 'rtl' }}>
          <Typography variant="overline" sx={{ color: BRAND, fontWeight: 700, letterSpacing: 1.5 }}>
            תעריפים
          </Typography>
          <Typography component="h2" variant="h3" sx={{ fontWeight: 800, mt: 1, letterSpacing: '-0.02em' }}>
            מחיר אחד. בלי כוכביות.
          </Typography>
          <Typography variant="h6" sx={{ color: 'text.secondary', mt: 1.5, fontWeight: 400, lineHeight: 1.7 }}>
            כל חבילה כוללת את כל היכולות. ההבדל היחיד הוא כמות האורחים וסבבי ההודעות. משלמים פעם אחת, בלי מנוי.
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: { xs: 2.5, md: 3 },
            alignItems: 'stretch',
            direction: 'rtl',
          }}
        >
          {plans.map((tier) => {
            const popular = !!tier.isPopular;
            return (
              <Box
                key={tier.id}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  p: { xs: 3, md: 3.5 },
                  borderRadius: 4,
                  bgcolor: isDark ? alpha('#fff', 0.03) : '#fff',
                  border: '1px solid',
                  borderColor: popular ? alpha(DEEP, 0.55) : (isDark ? alpha('#fff', 0.1) : alpha('#0f172a', 0.08)),
                  boxShadow: popular
                    ? `0 24px 56px ${alpha(DEEP, 0.16)}`
                    : (isDark ? 'none' : '0 8px 28px rgba(15,23,42,0.05)'),
                  transition: 'transform .22s ease, box-shadow .22s ease',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: popular ? `0 30px 64px ${alpha(DEEP, 0.2)}` : '0 18px 44px rgba(15,23,42,0.09)',
                  },
                }}
              >
                {popular && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -13,
                      insetInlineStart: 24,
                      px: 1.5,
                      py: 0.35,
                      borderRadius: 999,
                      bgcolor: DEEP,
                      color: '#fff',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      letterSpacing: '0.02em',
                    }}
                  >
                    הבחירה של רוב המארחים
                  </Box>
                )}

                <Typography component="h3" sx={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
                  {tier.title}
                </Typography>
                <Typography sx={{ color: 'text.secondary', mt: 0.5, fontSize: '0.95rem' }}>
                  {tier.subtitle}
                </Typography>

                <Box sx={{ mt: 3, display: 'flex', alignItems: 'baseline', gap: 1 }}>
                  <PriceTag price={tier.price} size="lg" align="right" />
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>לאירוע</Typography>
                </Box>
                <Typography sx={{ mt: 0.75, fontWeight: 700, color: popular ? DEEP : 'text.primary' }}>
                  {tier.description}
                </Typography>

                <Box
                  sx={{
                    mt: 3,
                    pt: 3,
                    borderTop: '1px solid',
                    borderColor: isDark ? alpha('#fff', 0.08) : alpha('#0f172a', 0.07),
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.25,
                    flex: 1,
                  }}
                >
                  {tier.features.map((feature) => (
                    <Box key={feature} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box
                        sx={{
                          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor: alpha(DEEP, 0.1), color: DEEP,
                        }}
                      >
                        <CheckRoundedIcon sx={{ fontSize: 15 }} />
                      </Box>
                      <Typography sx={{ fontSize: '0.95rem' }}>{feature}</Typography>
                    </Box>
                  ))}
                </Box>

                <Button
                  fullWidth
                  variant={popular ? 'contained' : 'outlined'}
                  disableElevation
                  onClick={() => handleStartNow(tier.id)}
                  sx={{
                    mt: 3.5,
                    borderRadius: 999,
                    py: 1.2,
                    fontWeight: 700,
                    fontSize: '0.98rem',
                    ...(popular
                      ? { bgcolor: DEEP, '&:hover': { bgcolor: '#5257c9' } }
                      : {
                          color: DEEP,
                          borderColor: alpha(DEEP, 0.4),
                          '&:hover': { borderColor: DEEP, bgcolor: alpha(DEEP, 0.05) },
                        }),
                  }}
                >
                  יוצאים לדרך
                </Button>
              </Box>
            );
          })}
        </Box>

        <Box
          sx={{
            mt: { xs: 4, md: 5 },
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            gap: { xs: 1.5, md: 4 },
            color: 'text.secondary',
            direction: 'rtl',
          }}
        >
          {[
            { icon: <ShieldRoundedIcon sx={{ fontSize: 18 }} />, text: 'החזר כספי מלא תוך 14 יום' },
            { icon: <LockRoundedIcon sx={{ fontSize: 18 }} />, text: 'תשלום מאובטח, בלי לשמור פרטי אשראי' },
            { icon: <CheckRoundedIcon sx={{ fontSize: 18 }} />, text: 'תשלום חד‑פעמי, בלי מנוי' },
          ].map((item) => (
            <Box key={item.text} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ color: DEEP, display: 'flex' }}>{item.icon}</Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {item.text}
              </Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  );
}
