import React from 'react';
import { Box, Container, Grid, Typography, Paper, Button, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { styled, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { plans } from '../config/plans';
import PriceTag from './PriceTag';

const StyledPaper = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'accent' && prop !== 'popular',
})<{ accent: string; popular?: boolean }>(({ theme, accent, popular }) => ({
  padding: popular ? theme.spacing(5) : theme.spacing(4),
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  borderRadius: 16,
  backgroundColor: theme.palette.mode === 'dark' 
    ? theme.palette.background.paper 
    : '#ffffff',
  border: popular 
    ? `1px solid ${accent}` 
    : `1px solid ${theme.palette.mode === 'dark' ? theme.palette.divider : '#e2e8f0'}`,
  boxShadow: popular 
    ? '0 16px 40px rgba(37,99,235,0.18)' 
    : theme.palette.mode === 'dark'
      ? '0 10px 30px rgba(0,0,0,0.3)'
      : '0 10px 30px rgba(15,23,42,0.06)',
  position: 'relative',
  overflow: 'hidden',
  transform: popular ? 'scale(1.05)' : 'scale(1)',
  transition:
    'transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease, background-color 0.22s ease',
  '&::before': popular
    ? {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(135deg, ${accent}22, transparent 60%)`,
        pointerEvents: 'none',
      }
    : {},
  '&:hover': {
    transform: popular ? 'scale(1.08) translateY(-6px)' : 'translateY(-6px)',
    boxShadow: popular
      ? '0 20px 55px rgba(37,99,235,0.25)'
      : theme.palette.mode === 'dark'
        ? '0 18px 45px rgba(0,0,0,0.4)'
      : '0 18px 45px rgba(15,23,42,0.12)',
    borderColor: accent,
    backgroundColor: theme.palette.mode === 'dark'
      ? theme.palette.background.paper
      : '#fdfefe',
  },
  [theme.breakpoints.down('md')]: {
    transform: 'scale(1)',
    '&:hover': {
      transform: popular ? 'scale(1.02) translateY(-6px)' : 'translateY(-6px)',
    },
  },
}));

const FeatureItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  marginBottom: theme.spacing(1),
  '& svg': {
    marginLeft: theme.spacing(1),
    color: theme.palette.success.main,
  },
}));

const FeaturesBox = styled(Box)(({ theme }) => ({
  flex: '1 1 auto',
  marginTop: theme.spacing(3),
  marginBottom: theme.spacing(4),
  minHeight: 0,
}));

export default function Pricing() {
  const theme = useTheme();
  const navigate = useNavigate();
  const tiers = plans;

  const handleStartNow = (planId: string) => {
    navigate(`/wizard?package=${planId}`);
  };

  return (
    <Box
      id="pricing"
      sx={{
        py: 10,
        bgcolor: theme.palette.mode === 'dark'
          ? theme.palette.background.default
          : '#ffffff',
      }}
    >
      <Container maxWidth="lg" sx={{ overflow: 'visible', px: { md: 4 } }}>
        <Box
          sx={{
            textAlign: 'center',
            maxWidth: 640,
            mx: 'auto',
            mb: 6,
            direction: 'rtl',
          }}
        >
          <Typography
            variant="h3"
            gutterBottom
            sx={{
              fontWeight: 800,
              textAlign: 'center',
            }}
          >
            מחיר אחד. בלי כוכביות.
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center' }}>
            כל חבילה כוללת את כל היכולות - ההבדל היחיד הוא כמות האורחים וסבבי ההודעות. משלמים פעם אחת ונגמר, בלי מנוי ובלי אותיות קטנות.
          </Typography>
        </Box>

        <Grid 
          container 
          spacing={{ xs: 3, md: 4 }} 
          sx={{ 
            mt: 2, 
            alignItems: 'stretch', 
            direction: 'rtl',
            py: { md: 2 },
          }}
        >
          {tiers.map((tier, index) => (
            <Grid 
              item 
              xs={12} 
              sm={6} 
              md={4} 
              key={tier.title}
              sx={{
                display: 'flex',
                alignItems: 'stretch',
              }}
            >
              {tier.isPopular ? (
                <StyledPaper accent={tier.color} popular elevation={0} sx={{ width: '100%' }}>
                  <Chip
                    label="הכי פופולרית"
                    color="primary"
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 16,
                      right: 16,
                      fontWeight: 700,
                      borderRadius: 999,
                      px: 1.5,
                    }}
                  />
                  <Typography
                    component="h2"
                    variant="h4"
                    gutterBottom
                    sx={{ fontWeight: 700, mt: 1, direction: 'rtl', textAlign: 'right' }}
                  >
                    {tier.title}
                  </Typography>
                  <Typography
                    variant="h6"
                    color="text.secondary"
                    gutterBottom
                    sx={{ direction: 'rtl', textAlign: 'right' }}
                  >
                    {tier.subtitle}
                  </Typography>
                  <Box sx={{ my: 2 }}>
                    <PriceTag price={tier.price} size="lg" align="right" />
                  </Box>
                  <Typography
                    variant="subtitle1"
                    color="text.secondary"
                    gutterBottom
                    sx={{ direction: 'rtl', textAlign: 'right' }}
                  >
                    {tier.description}
                  </Typography>
                  <FeaturesBox>
                    {tier.features.map((feature) => (
                      <FeatureItem key={feature}>
                        <CheckCircleIcon fontSize="small" />
                        <Typography variant="body1" sx={{ mr: 1 }}>
                          {feature}
                        </Typography>
                      </FeatureItem>
                    ))}
                  </FeaturesBox>
                  <Button
                    fullWidth
                    variant="contained"
                    sx={{
                      borderRadius: 999,
                      py: 1.2,
                      fontWeight: 600,
                      background: `linear-gradient(90deg, ${tier.color}, #111827)`,
                      border: 'none',
                      boxShadow: 'none',
                      '&:hover': {
                        background: `linear-gradient(90deg, ${tier.color}, #020617)`,
                        transform: 'translateY(-1px)',
                        boxShadow: '0 12px 30px rgba(15,23,42,0.25)',
                      },
                      '&:focusVisible': {
                        outline: 'none',
                        boxShadow: 'none',
                        border: 'none',
                      },
                    }}
                    onClick={() => handleStartNow(tier.id)}
                  >
                    יוצאים לדרך
                  </Button>
                </StyledPaper>
              ) : (
                <StyledPaper accent={tier.color} elevation={0} sx={{ width: '100%' }}>
                  <Typography
                    component="h2"
                    variant="h4"
                    gutterBottom
                    sx={{ fontWeight: 700, direction: 'rtl', textAlign: 'right' }}
                  >
                    {tier.title}
                  </Typography>
                  <Typography
                    variant="h6"
                    color="text.secondary"
                    gutterBottom
                    sx={{ direction: 'rtl', textAlign: 'right' }}
                  >
                    {tier.subtitle}
                  </Typography>
                  <Box sx={{ my: 2 }}>
                    <PriceTag price={tier.price} size="lg" align="right" />
                  </Box>
                  <Typography
                    variant="subtitle1"
                    color="text.secondary"
                    gutterBottom
                    sx={{ direction: 'rtl', textAlign: 'right' }}
                  >
                    {tier.description}
                  </Typography>
                  <FeaturesBox>
                    {tier.features.map((feature) => (
                      <FeatureItem key={feature}>
                        <CheckCircleIcon fontSize="small" />
                        <Typography variant="body1" sx={{ mr: 1 }}>
                          {feature}
                        </Typography>
                      </FeatureItem>
                    ))}
                  </FeaturesBox>
                  <Button
                    fullWidth
                    variant="contained"
                    sx={{
                      borderRadius: 999,
                      py: 1.2,
                      fontWeight: 600,
                      background: tier.color,
                      border: 'none',
                      boxShadow: 'none',
                      '&:hover': {
                        background: tier.color,
                        opacity: 0.95,
                        transform: 'translateY(-1px)',
                        boxShadow: '0 10px 24px rgba(15,23,42,0.18)',
                      },
                      '&:focusVisible': {
                        outline: 'none',
                        boxShadow: 'none',
                        border: 'none',
                      },
                    }}
                    onClick={() => handleStartNow(tier.id)}
                  >
                    יוצאים לדרך
                  </Button>
                </StyledPaper>
              )}
            </Grid>
          ))}
        </Grid>

        <Box
          sx={{
            mt: { xs: 4, md: 6 },
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            gap: { xs: 1.5, md: 3 },
            color: 'text.secondary',
            direction: 'rtl',
          }}
        >
          {[
            { icon: <ShieldRoundedIcon fontSize="small" color="success" />, text: 'החזר כספי מלא תוך 14 יום' },
            { icon: <LockRoundedIcon fontSize="small" color="success" />, text: 'תשלום מאובטח · ללא שמירת פרטי אשראי' },
            { icon: <CheckCircleIcon fontSize="small" color="success" />, text: 'תשלום חד‑פעמי · ללא מנוי וללא התחייבות' },
          ].map((item) => (
            <Box key={item.text} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {item.icon}
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
