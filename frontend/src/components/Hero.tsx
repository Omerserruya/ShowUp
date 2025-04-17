import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import Button from '@mui/material/Button';
import { alpha } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import PhoneIcon from '@mui/icons-material/Phone';

export default function Hero() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [phoneNumber, setPhoneNumber] = React.useState('');

  const features = [
    'שולחים הודעות אישיות בוואטסאפ (ברור שלא SMS!) 📱',
    'אתם רואים מי אישר, מי מתלבט, ומי... נעלם 👀',
    'יש לכם אקסל? אנשי קשר? אפילו צילום מסך? שלחו לנו – נטפל בזה 📂',
    'קל, מהיר, בלי כאב ראש – אנחנו עושים את כל העבודה בשבילכם 💡',
  ];

  return (
    <Box
      id="hero"
      sx={(theme) => ({
        width: '100%',
        backgroundImage:
          theme.palette.mode === 'light'
            ? 'linear-gradient(180deg, #E3F2FD, #FFFFFF)'
            : 'linear-gradient(180deg, #02294F, #090E10)',
        backgroundSize: '100% 20%',
        backgroundRepeat: 'no-repeat',
        pt: { xs: 14, sm: 20 },
        pb: { xs: 8, sm: 12 },
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '100%',
          background: theme.palette.mode === 'light'
            ? 'radial-gradient(circle at 50% 0%, rgba(33, 150, 243, 0.1), transparent 50%)'
            : 'radial-gradient(circle at 50% 0%, rgba(33, 150, 243, 0.2), transparent 50%)',
          pointerEvents: 'none',
        },
      })}
    >
      <Container
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: { xs: 4, md: 8 },
          maxWidth: 'lg',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: 'center',
            gap: { xs: 4, md: 8 },
            width: '100%',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              maxWidth: { xs: '100%', md: '50%' },
              gap: 3,
            }}
          >
            <Box 
              sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 1,
                mb: 2,
                textAlign: 'center',
              }}
            >
              <Typography
                component="h1"
                variant="h1"
                sx={{
                  fontSize: { xs: '2.25rem', sm: '3rem', md: '3.5rem' },
                  fontWeight: 800,
                  lineHeight: 1.2,
                  letterSpacing: '-0.02em',
                  color: 'text.primary',
                  textShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
              >
                האישורים עוד לא הגיעו?
              </Typography>
              <Typography
                component="h1"
                variant="h1"
                sx={{
                  fontSize: { xs: '2.25rem', sm: '3rem', md: '3.5rem' },
                  fontWeight: 800,
                  lineHeight: 1.2,
                  letterSpacing: '-0.02em',
                  color: 'primary.main',
                  textShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
              >
                תנו לנו לטפל בזה
              </Typography>
            </Box>
            <Typography
              variant="body1"
              sx={{
                fontSize: { xs: '1.1rem', sm: '1.35rem' },
                color: 'text.secondary',
                maxWidth: 600,
                mb: 4,
                lineHeight: 1.6,
                textAlign: 'center',
              }}
            >
              אנחנו כאן כדי לוודא שאף אורח לא יתפספס – כי יש דברים יותר חשובים לדאוג להם מאשר לרדוף אחרי אישורי הגעה.
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 2,
                width: '100%',
                maxWidth: 800,
                mb: 4,
              }}
            >
              {features.map((feature, index) => (
                <Card
                  key={index}
                  sx={{
                    height: '100%',
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: theme.shadows[4],
                    },
                  }}
                >
                  <CardContent>
                    <Box sx={{ 
                      display: 'flex', 
                      justifyContent: 'center',
                    }}>
                      <Typography
                        sx={{
                          fontSize: { xs: '1.1rem', sm: '1.2rem' },
                          fontWeight: 500,
                          lineHeight: 1.5,
                          textAlign: 'center',
                        }}
                      >
                        {feature}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              width: { xs: '100%', md: '50%' },
            }}
          >
            <Box
              component="img"
              src="/iphone-demo.png"
              alt="ShowUp App Demo"
              sx={{
                width: '100%',
                maxWidth: 400,
                height: 'auto',
                objectFit: 'contain',
                filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.1))',
              }}
            />
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            width: '100%',
            maxWidth: 800,
            mt: { xs: 0, md: 4 },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              width: '100%',
              maxWidth: 400,
            }}
          >
            <Typography
              variant="h6"
              sx={{
                textAlign: 'center',
                fontWeight: 600,
                color: 'primary.main',
              }}
            >
              נסו בעצמכם
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <TextField
                fullWidth
                variant="outlined"
                placeholder="הזינו מספר טלפון"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PhoneIcon color="primary" />
                    </InputAdornment>
                  ),
                  sx: {
                    '& input': {
                      textAlign: 'right',
                    },
                  },
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    '&:hover fieldset': {
                      borderColor: 'primary.main',
                    },
                  },
                }}
              />
              <Button
                fullWidth
                color="primary"
                variant="contained"
                size="large"
                sx={{
                  py: 1.5,
                  borderRadius: 2,
                  boxShadow: '0 4px 14px 0 rgba(0,118,255,0.39)',
                  '&:hover': {
                    boxShadow: '0 6px 20px rgba(0,118,255,0.23)',
                  },
                }}
              >
                הבא
              </Button>
            </Box>
            <Typography
              variant="caption"
              sx={{
                textAlign: 'center',
                color: 'text.secondary',
                fontSize: '0.8rem',
                lineHeight: 1.5,
              }}
            >
              על ידי הזנת מספר הטלפון, אתם מסכימים לתנאי השימוש
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              gap: 2,
            }}
          >
            <Button
              color="primary"
              variant="contained"
              size="large"
              component="a"
              href="/sign-up"
              sx={{
                minWidth: { xs: '100%', sm: 200 },
                fontSize: '1.1rem',
                py: 1.5,
                px: 3,
                borderRadius: 2,
                boxShadow: '0 4px 14px 0 rgba(0,118,255,0.39)',
                '&:hover': {
                  boxShadow: '0 6px 20px rgba(0,118,255,0.23)',
                },
              }}
            >
              התחילו עכשיו
            </Button>
            <Button
              color="primary"
              variant="outlined"
              size="large"
              component="a"
              href="#features"
              sx={{
                minWidth: { xs: '100%', sm: 200 },
                fontSize: '1.1rem',
                py: 1.5,
                px: 3,
                borderRadius: 2,
                borderWidth: 2,
                '&:hover': {
                  borderWidth: 2,
                },
              }}
            >
              למדו עוד
            </Button>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
