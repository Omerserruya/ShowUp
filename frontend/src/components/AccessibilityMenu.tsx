import * as React from 'react';
import { 
  Fab, 
  Popover, 
  Box, 
  Typography, 
  Divider, 
  IconButton, 
  Slider, 
  Switch, 
  FormControlLabel, 
  Button,
  Tooltip,
  Link
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import ContrastIcon from '@mui/icons-material/Contrast';
import CloseIcon from '@mui/icons-material/Close';
import LinkIcon from '@mui/icons-material/Link';
import MouseIcon from '@mui/icons-material/Mouse';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import TranslateIcon from '@mui/icons-material/Translate';
import { useColorScheme } from '@mui/material/styles';

export default function AccessibilityMenu() {
  const [anchorEl, setAnchorEl] = React.useState<HTMLButtonElement | null>(null);
  const { mode, setMode } = useColorScheme();
  
  // State for accessibility settings
  const [fontSize, setFontSize] = React.useState<number>(100);
  const [highContrast, setHighContrast] = React.useState<boolean>(false);
  const [highlightLinks, setHighlightLinks] = React.useState<boolean>(false);
  const [bigCursor, setBigCursor] = React.useState<boolean>(false);
  const [keyboardNav, setKeyboardNav] = React.useState<boolean>(false);
  const [readableFont, setReadableFont] = React.useState<boolean>(false);

  // Handle opening menu
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  // Handle closing menu
  const handleClose = () => {
    setAnchorEl(null);
  };

  // Toggle high contrast
  const toggleContrast = () => {
    setHighContrast(!highContrast);
    if (!highContrast) {
      document.body.classList.add('high-contrast');
    } else {
      document.body.classList.remove('high-contrast');
    }
  };

  // Update font size
  const handleFontSizeChange = (event: Event, newValue: number | number[]) => {
    const newSize = newValue as number;
    setFontSize(newSize);
    document.documentElement.style.fontSize = `${newSize}%`;
  };

  // Increase font size
  const increaseFontSize = () => {
    const newSize = Math.min(fontSize + 10, 200);
    setFontSize(newSize);
    document.documentElement.style.fontSize = `${newSize}%`;
  };

  // Decrease font size
  const decreaseFontSize = () => {
    const newSize = Math.max(fontSize - 10, 80);
    setFontSize(newSize);
    document.documentElement.style.fontSize = `${newSize}%`;
  };

  // Toggle links highlight
  const toggleHighlightLinks = () => {
    setHighlightLinks(!highlightLinks);
    if (!highlightLinks) {
      document.body.classList.add('highlight-links');
    } else {
      document.body.classList.remove('highlight-links');
    }
  };
  
  // Toggle big cursor
  const toggleBigCursor = () => {
    setBigCursor(!bigCursor);
    if (!bigCursor) {
      document.body.classList.add('big-cursor');
    } else {
      document.body.classList.remove('big-cursor');
    }
  };

  // Toggle keyboard navigation
  const toggleKeyboardNav = () => {
    setKeyboardNav(!keyboardNav);
    if (!keyboardNav) {
      document.body.classList.add('keyboard-nav');
    } else {
      document.body.classList.remove('keyboard-nav');
    }
  };

  // Toggle readable font
  const toggleReadableFont = () => {
    setReadableFont(!readableFont);
    if (!readableFont) {
      document.body.classList.add('readable-font');
    } else {
      document.body.classList.remove('readable-font');
    }
  };

  // Reset all settings
  const resetSettings = () => {
    setFontSize(100);
    setHighContrast(false);
    setHighlightLinks(false);
    setBigCursor(false);
    setKeyboardNav(false);
    setReadableFont(false);
    
    document.documentElement.style.fontSize = '100%';
    document.body.classList.remove('high-contrast', 'highlight-links', 'big-cursor', 'keyboard-nav', 'readable-font');
  };

  // Handle dark mode
  const toggleDarkMode = () => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  };

  // Apply accessibility styles
  React.useEffect(() => {
    // Add custom CSS for accessibility features
    const style = document.createElement('style');
    style.innerHTML = `
      .high-contrast {
        filter: contrast(1.5);
      }
      .highlight-links a {
        text-decoration: underline !important;
        color: #0000EE !important;
        background-color: #FFFF00 !important;
        outline: 2px solid #FFFF00 !important;
      }
      .big-cursor,
      .big-cursor * {
        cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path d="M16 0l-3 9h-4l-1-4-1 4h-4l3-9h4l1 4 1-4z"/></svg>') 24 24, auto !important;
      }
      .keyboard-nav *:focus {
        outline: 3px solid #4488FF !important;
        outline-offset: 2px !important;
      }
      .readable-font {
        font-family: Arial, Helvetica, sans-serif !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
        line-height: 1.5 !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const open = Boolean(anchorEl);
  const id = open ? 'accessibility-popover' : undefined;

  return (
    <>
      <Tooltip title="אפשרויות נגישות">
        <Fab
          color="primary"
          aria-label="אפשרויות נגישות"
          size="medium"
          onClick={handleClick}
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1000,
          }}
        >
          <AccessibilityNewIcon />
        </Fab>
      </Tooltip>

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
      >
        <Box sx={{ width: 320, p: 3, direction: 'rtl' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">הגדרות נגישות</Typography>
            <IconButton onClick={handleClose} size="small">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Font Size Controls */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              <FormatSizeIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />
              גודל טקסט
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              <IconButton onClick={decreaseFontSize} size="small">
                <ZoomOutIcon />
              </IconButton>
              <Slider
                value={fontSize}
                min={80}
                max={200}
                step={10}
                onChange={handleFontSizeChange}
                aria-labelledby="font-size-slider"
                sx={{ mx: 2 }}
              />
              <IconButton onClick={increaseFontSize} size="small">
                <ZoomInIcon />
              </IconButton>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {fontSize}%
            </Typography>
          </Box>

          {/* Contrast Mode */}
          <FormControlLabel
            control={<Switch checked={highContrast} onChange={toggleContrast} />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <ContrastIcon fontSize="small" sx={{ mr: 1 }} />
                <Typography variant="subtitle2">ניגודיות גבוהה</Typography>
              </Box>
            }
            sx={{ mb: 1, ml: 0, width: '100%', justifyContent: 'space-between' }}
          />

          {/* Link Highlighting */}
          <FormControlLabel
            control={<Switch checked={highlightLinks} onChange={toggleHighlightLinks} />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <LinkIcon fontSize="small" sx={{ mr: 1 }} />
                <Typography variant="subtitle2">הדגשת קישורים</Typography>
              </Box>
            }
            sx={{ mb: 1, ml: 0, width: '100%', justifyContent: 'space-between' }}
          />

          {/* Big Cursor */}
          <FormControlLabel
            control={<Switch checked={bigCursor} onChange={toggleBigCursor} />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <MouseIcon fontSize="small" sx={{ mr: 1 }} />
                <Typography variant="subtitle2">סמן גדול</Typography>
              </Box>
            }
            sx={{ mb: 1, ml: 0, width: '100%', justifyContent: 'space-between' }}
          />

          {/* Keyboard Navigation */}
          <FormControlLabel
            control={<Switch checked={keyboardNav} onChange={toggleKeyboardNav} />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <KeyboardIcon fontSize="small" sx={{ mr: 1 }} />
                <Typography variant="subtitle2">ניווט מקלדת</Typography>
              </Box>
            }
            sx={{ mb: 1, ml: 0, width: '100%', justifyContent: 'space-between' }}
          />

          {/* Readable Font */}
          <FormControlLabel
            control={<Switch checked={readableFont} onChange={toggleReadableFont} />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TranslateIcon fontSize="small" sx={{ mr: 1 }} />
                <Typography variant="subtitle2">פונט קריא</Typography>
              </Box>
            }
            sx={{ mb: 3, ml: 0, width: '100%', justifyContent: 'space-between' }}
          />

          <Divider sx={{ mb: 2 }} />

          {/* Dark Mode */}
          <FormControlLabel
            control={<Switch checked={mode === 'dark'} onChange={toggleDarkMode} />}
            label={
              <Typography variant="subtitle2">מצב כהה</Typography>
            }
            sx={{ mb: 2, ml: 0, width: '100%', justifyContent: 'space-between' }}
          />

          {/* Reset Button */}
          <Button 
            variant="outlined" 
            fullWidth 
            onClick={resetSettings}
            sx={{ mb: 1 }}
          >
            איפוס הגדרות
          </Button>

          {/* Accessibility Statement */}
          <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 2 }}>
            אתר זה עומד בתקנות נגישות בהתאם לחוק הישראלי
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
            <Link
              component={RouterLink}
              to="/accessibility"
              onClick={handleClose}
              sx={{
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
              }}
            >
              <AccessibilityNewIcon sx={{ fontSize: '0.875rem' }} />
              לצפייה בהצהרת הנגישות המלאה
            </Link>
          </Box>
        </Box>
      </Popover>
    </>
  );
} 