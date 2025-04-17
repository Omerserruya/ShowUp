import * as React from 'react';
import { 
  Dialog,
  Button, 
  Box, 
  Typography, 
  Link,
  Paper
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import CookieIcon from '@mui/icons-material/Cookie';

export default function CookieConsent() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    // Check if user has already consented
    const hasConsented = localStorage.getItem('cookieConsent');
    if (!hasConsented) {
      setOpen(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('cookieConsent', 'true');
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      PaperProps={{
        sx: {
          maxWidth: '100%',
          width: { xs: '95%', sm: '600px' },
          m: 'auto',
          borderRadius: 2,
        }
      }}
    >
      <Paper
        elevation={6}
        sx={{
          p: 2,
          borderRadius: 2,
          bgcolor: 'background.paper',
          direction: 'rtl',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CookieIcon color="primary" />
          <Typography variant="h6" component="div">
            אנחנו משתמשים בעוגיות
          </Typography>
        </Box>
        
        <Typography variant="body2" color="text.secondary">
          אתר זה משתמש בעוגיות (Cookies) כדי לשפר את חווית המשתמש, לצרכי אבטחה ולניתוח של דפוסי השימוש באתר.
          על ידי המשך הגלישה באתר, אתם מסכימים למדיניות העוגיות שלנו. 
          למידע נוסף, בקרו ב-
          <Link 
            component={RouterLink} 
            to="/privacy" 
            color="primary"
            underline="hover"
            sx={{ mr: 0.5 }}
          >
            מדיניות הפרטיות
          </Link>
          שלנו.
        </Typography>
        
        <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 1 }}>
          <Button
            onClick={handleAccept}
            variant="contained"
            color="primary"
            size="medium"
          >
            אני מסכים
          </Button>
        </Box>
      </Paper>
    </Dialog>
  );
} 