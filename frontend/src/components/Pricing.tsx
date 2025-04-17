import React from 'react';
import { Box, Container, Grid, Typography, Paper, Button, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { styled } from '@mui/material/styles';

const tiers = [
  {
    title: 'Basic',
    subtitle: 'בוא נתחיל',
    price: '₪39',
    description: 'עד 50 אורחים',
    features: [
      'שליחת הודעות בסיסיות בוואטסאפ',
      'מעקב תגובות בסיסי',
      'דשבורד תגובות',
    ],
    color: '#4CAF50', // Green
    isPopular: false,
  },
  {
    title: 'Plus',
    subtitle: 'אירוע בשליטה',
    price: '₪99',
    description: 'עד 250 אורחים',
    features: [
      'תזמון הודעות מתקדם',
      'תגובות מסווגות לפי תוכן',
      'ייבוא אנשי קשר מכל פורמט',
      'תמיכה בצ\'אט',
    ],
    color: '#2196F3', // Blue
    isPopular: true,
  },
  {
    title: 'Pro',
    subtitle: 'הכול כלול',
    price: '₪199',
    description: 'ללא הגבלת אורחים',
    features: [
      'אוטומציות ותזכורות מתקדמות',
      'אינטגרציות עם Google Sheets / CRM',
      'ניתוחי בינה מלאכותית לתגובות',
      'תיוגים והערות על אורחים',
      'תמיכה טלפונית',
    ],
    color: '#9C27B0', // Purple
    isPopular: false,
  },
];

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4),
  display: 'flex',
  flexDirection: 'column',
  height: '520px',
  width: '100%',
  transition: 'transform 0.2s',
  transform: 'scale(0.95)',
  '&:hover': {
    transform: 'translateY(-8px) scale(0.95)',
  },
}));

const PopularPaper = styled(StyledPaper)(({ theme }) => ({
  transform: 'scale(1.05) !important',
  '&:hover': {
    transform: 'translateY(-8px) scale(1.05) !important',
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
  flex: 1,
  overflowY: 'auto',
  marginTop: theme.spacing(3),
  marginBottom: theme.spacing(4),
  paddingRight: theme.spacing(1),
  '&::-webkit-scrollbar': {
    width: '4px',
  },
  '&::-webkit-scrollbar-track': {
    background: theme.palette.grey[100],
    borderRadius: '2px',
  },
  '&::-webkit-scrollbar-thumb': {
    background: theme.palette.grey[400],
    borderRadius: '2px',
  },
}));

export default function Pricing() {
  return (
    <Box sx={{ py: 8, bgcolor: 'background.paper' }}>
      <Container maxWidth="lg">
        <Typography variant="h3" align="center" gutterBottom>
          אז כמה זה בסך הכול?
        </Typography>
        <Typography variant="h6" align="center" color="text.secondary" paragraph>
          בחרו את החבילה שמתאימה לכם
        </Typography>
        <Grid container spacing={4} sx={{ mt: 4, alignItems: 'center' }}>
          {tiers.map((tier) => (
            <Grid item xs={12} sm={6} md={4} key={tier.title}>
              {tier.isPopular ? (
                <PopularPaper
                  elevation={3}
                  sx={{
                    borderTop: `4px solid ${tier.color}`,
                    position: 'relative',
                  }}
                >
                  <Chip
                    label="פופולרי"
                    color="primary"
                    sx={{
                      position: 'absolute',
                      top: -12,
                      right: '50%',
                      transform: 'translateX(50%)',
                      fontWeight: 'bold',
                    }}
                  />
                  <Typography
                    component="h2"
                    variant="h4"
                    color="text.primary"
                    gutterBottom
                  >
                    {tier.title}
                  </Typography>
                  <Typography
                    variant="h6"
                    color="text.secondary"
                    gutterBottom
                  >
                    {tier.subtitle}
                  </Typography>
                  <Typography
                    variant="h3"
                    color="text.primary"
                    sx={{ my: 2 }}
                  >
                    {tier.price}
                  </Typography>
                  <Typography
                    variant="subtitle1"
                    color="text.secondary"
                    gutterBottom
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
                      backgroundColor: tier.color,
                      '&:hover': {
                        backgroundColor: tier.color,
                        opacity: 0.9,
                      },
                    }}
                  >
                    התחל עכשיו
                  </Button>
                </PopularPaper>
              ) : (
                <StyledPaper
                  elevation={3}
                  sx={{ 
                    borderTop: `4px solid ${tier.color}`,
                  }}
                >
                  <Typography
                    component="h2"
                    variant="h4"
                    color="text.primary"
                    gutterBottom
                  >
                    {tier.title}
                  </Typography>
                  <Typography
                    variant="h6"
                    color="text.secondary"
                    gutterBottom
                  >
                    {tier.subtitle}
                  </Typography>
                  <Typography
                    variant="h3"
                    color="text.primary"
                    sx={{ my: 2 }}
                  >
                    {tier.price}
                  </Typography>
                  <Typography
                    variant="subtitle1"
                    color="text.secondary"
                    gutterBottom
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
                      backgroundColor: tier.color,
                      '&:hover': {
                        backgroundColor: tier.color,
                        opacity: 0.9,
                      },
                    }}
                  >
                    התחל עכשיו
                  </Button>
                </StyledPaper>
              )}
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}
