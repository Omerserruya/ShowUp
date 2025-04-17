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
    <Typography variant="body2" color="text.secondary" align="center">
      {'© '}
      {new Date().getFullYear()}{' '}
      <Link color="inherit" href="https://mui.com/">
        ShowUp
      </Link>
      {'. כל הזכויות שמורות.'}
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
            minWidth: { xs: '100%', sm: '60%' },
          }}
        >
          <Box sx={{ width: { xs: '100%', sm: 60 } }}>
            <Logo />
          </Box>
          <Typography variant="body2" color="text.secondary">
            ShowUp - פלטפורמה לניהול תורים ופגישות לעסקים קטנים ובינוניים.
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: 1,
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
          <Link color="text.secondary" href="#">
            תכונות
          </Link>
          <Link color="text.secondary" href="#">
            תעריפים
          </Link>
          <Link color="text.secondary" href="#">
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
            חברה
          </Typography>
          <Link color="text.secondary" href="#">
            אודות
          </Link>
          <Link color="text.secondary" href="#">
            קריירה
          </Link>
          <Link color="text.secondary" href="#">
            צור קשר
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
            משפטי
          </Typography>
          <Link 
            component={RouterLink} 
            to="/terms" 
            color="text.secondary" 
            sx={{ 
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
              textDecoration: 'none', 
              '&:hover': { 
                textDecoration: 'underline' 
              },
              display: 'flex',
              alignItems: 'center',
              gap: 0.5
            }}
          >
            <AccessibilityNewIcon fontSize="small" />
            הצהרת נגישות
          </Link>
        </Box>
      </Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          pt: { xs: 4, sm: 8 },
          width: '100%',
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Copyright />
        <Box sx={{ display: 'flex', gap: 3 }}>
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
