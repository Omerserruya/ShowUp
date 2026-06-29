import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import IconButton from '@mui/material/IconButton';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import TwitterIcon from '@mui/icons-material/X';
import { Link as RouterLink } from 'react-router-dom';
import Logo from './Logo';
import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';

function Copyright() {
  return (
    <Typography 
      variant="body2" 
      color="text.secondary" 
      align="center"
      sx={{
        width: { xs: '100%', sm: 'auto' },
      }}
    >
      {'© '}
      {new Date().getFullYear()}{' '}
      <Link component={RouterLink} to="/" color="inherit" sx={{ textDecoration: 'none' }}>
        ShowUp
      </Link>
      {' · כל הזכויות שמורות'}
    </Typography>
  );
}

const socialItems = [
  { icon: LinkedInIcon, label: 'LinkedIn', href: '#' },
  { icon: TwitterIcon, label: 'X', href: '#' },
];

export default function Footer() {
  return (
    <Container
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: { xs: 4, sm: 8 },
        py: { xs: 8, sm: 10 },
        textAlign: { sm: 'center', md: 'left' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          width: '100%',
          justifyContent: 'space-between',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            alignItems: { xs: 'center', sm: 'flex-start' },
            width: { xs: '100%', sm: '60%' },
          }}
        >
          <Box 
            sx={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: { xs: 'center', sm: 'flex-start' },
              gap: 1,
              width: { xs: '100%', sm: 'auto' } 
            }}
          >
            <Logo height={40} mr={0} />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                textAlign: { xs: 'center', sm: 'left' },
                maxWidth: 320,
              }}
            >
              ShowUp. אישורי הגעה לאירועים, ישר בוואטסאפ. אתם תחגגו, אנחנו כבר נדאג לשאר. נתראה בשמחות 🥂
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: { xs: 'center', sm: 'left' }, mt: 0.5, lineHeight: 1.8 }}
            >
              support@showup.co.il · תמיכה בוואטסאפ
              <br />
              פועלת על תשתית WhatsApp Business הרשמית
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              justifyContent: { xs: 'center', sm: 'flex-start' },
            }}
          >
            {socialItems.map((item) => (
              <IconButton
                key={item.label}
                color="primary"
                aria-label={item.label}
                component="a"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <item.icon />
              </IconButton>
            ))}
          </Box>
        </Box>
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Typography variant="body2" fontWeight={600}>
            מוצר
          </Typography>
          <Link color="text.secondary" href="#what-you-get">
            מה מקבלים
          </Link>
          <Link color="text.secondary" href="#pricing">
            תעריפים
          </Link>
          <Link color="text.secondary" href="#faq">
            שאלות נפוצות
          </Link>
        </Box>
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Typography variant="body2" fontWeight={600}>
            תמיכה
          </Typography>
          <Link color="text.secondary" href="#faq">
            שאלות נפוצות
          </Link>
          <Link color="text.secondary" href="mailto:support@showup.co.il">
            צור קשר
          </Link>
          <Link color="text.secondary" href="https://wa.me/972500000000" target="_blank" rel="noopener noreferrer">
            תמיכה בוואטסאפ
          </Link>
        </Box>
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'center', sm: 'flex-start' },
          pt: { xs: 4, sm: 8 },
          width: '100%',
          borderTop: '1px solid',
          borderColor: 'divider',
          gap: { xs: 2, sm: 0 },
        }}
      >
        <Copyright />
        <Box 
          sx={{ 
            display: 'flex', 
            gap: 3,
            flexWrap: 'wrap',
            justifyContent: { xs: 'center', sm: 'flex-end' },
          }}
        >
          <Link 
            component={RouterLink} 
            to="/terms" 
            color="text.secondary" 
            sx={{ 
              fontSize: '0.875rem',
              textDecoration: 'none', 
              '&:hover': { 
                textDecoration: 'underline' 
              } 
            }}
          >
            תנאי שימוש
          </Link>
          <Link 
            component={RouterLink} 
            to="/privacy" 
            color="text.secondary" 
            sx={{ 
              fontSize: '0.875rem',
              textDecoration: 'none', 
              '&:hover': { 
                textDecoration: 'underline' 
              } 
            }}
          >
            מדיניות פרטיות
          </Link>
          <Link 
            component={RouterLink} 
            to="/accessibility" 
            color="text.secondary" 
            sx={{ 
              fontSize: '0.875rem',
              textDecoration: 'none', 
              '&:hover': { 
                textDecoration: 'underline' 
              },
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}
          >
            <AccessibilityNewIcon sx={{ fontSize: '1rem' }} />
            הצהרת נגישות
          </Link>
        </Box>
      </Box>
    </Container>
  );
}
