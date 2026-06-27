import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Link,
  CircularProgress,
  CardContent,
  IconButton,
  MenuItem,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { styled } from '@mui/material/styles';
import Card from '@mui/material/Card';
import { Theme } from '@mui/material/styles';
import { gray } from '../shared-theme/themePrimitives';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';

interface LoginFormData {
  phone: string;
  countryCode: string;
}

const StyledCard = styled(Card)(({ theme }: { theme: Theme }) => ({
  backgroundColor: theme.palette.background.paper,
  boxShadow: theme.palette.mode === 'dark' 
    ? '0 4px 20px rgba(0, 0, 0, 0.5)'
    : '0 4px 20px rgba(0, 0, 0, 0.1)',
  borderRadius: 16,
  width: '100%',
  padding: theme.spacing(4),
}));

const StyledTextField = styled(TextField)(({ theme }: { theme: Theme }) => ({
  marginBottom: theme.spacing(2),
  '& .MuiOutlinedInput-root': {
    backgroundColor: theme.palette.background.paper,
    '& fieldset': {
      borderColor: theme.palette.mode === 'dark' ? gray[700] : gray[300]
    },
    '&:hover fieldset': {
      borderColor: theme.palette.mode === 'dark' ? gray[600] : gray[400]
    }
  },
  '& .MuiInputLabel-root': {
    color: theme.palette.mode === 'dark' ? gray[400] : 'inherit'
  },
  '& .MuiInputBase-input': {
    color: theme.palette.text.primary
  }
}));

const Login = () => {
  const navigate = useNavigate();
  const { setUser, refreshUserDetails } = useUser();
  const [formData, setFormData] = useState<LoginFormData>({
    phone: '',
    countryCode: '+972',
  });
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [showOtpScreen, setShowOtpScreen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errors, setErrors] = useState<Partial<LoginFormData>>({});
  const [otpError, setOtpError] = useState('');
  const [formError, setFormError] = useState('');
  const [otpSentMessage, setOtpSentMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Countdown for the "resend code" cooldown.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || !phoneNumber) return;
    setOtpError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber }),
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok && data.status === 'otp_sent') {
        setOtpSentMessage('שלחנו קוד חדש ל-WhatsApp שלך');
        setResendCooldown(60);
        setOtp(['', '', '', '', '', '']);
      } else {
        setOtpError(data.error || 'שליחת הקוד נכשלה. נסו שוב');
      }
    } catch (error) {
      setOtpError('אירעה שגיאה בשליחת הקוד');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    
    if (error) {
      let errorMessage = 'Authentication failed. Please try again.';
      
      // Map error types to specific messages
      if (error === 'email_exists') {
        errorMessage = 'This email is already registered with a different account type. Please use your original login method.';
      } else if (error === 'auth_failed') {
        errorMessage = 'Authentication failed. Please try again.';
      } else if (error === 'unauthorized') {
        errorMessage = 'You are not authorized to access this resource.';
      } else if (error === 'server_error') {
        errorMessage = 'A server error occurred. Please try again later.';
      }
      
      setFormError(errorMessage);
      
      // Clear the URL parameter without refreshing the page
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const validateForm = () => {
    const newErrors: Partial<LoginFormData> = {};
    if (!formData.phone) {
      newErrors.phone = 'מספר טלפון הוא שדה חובה';
    } else if (!/^\d{7,15}$/.test(formData.phone.replace(/\s/g, ''))) {
      newErrors.phone = 'מספר הטלפון אינו תקין';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      const fullPhoneNumber = normalizePhoneNumber(formData.phone, formData.countryCode);
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone: fullPhoneNumber }),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok && data.status === 'otp_sent') {
        setPhoneNumber(fullPhoneNumber);
        setShowOtpScreen(true);
        setFormError('');
        setOtpSentMessage('שלחנו קוד אימות ל-WhatsApp שלך');
        setResendCooldown(60);
      } else {
        setFormError(
          data.error === 'user_not_found' 
            ? 'משתמש לא נמצא. אנא הירשם תחילה' 
            : data.error || 'התחברות נכשלה'
        );
      }
    } catch (error) {
      console.error('Login error:', error);
      setFormError('אירעה שגיאה במהלך ההתחברות');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpString = otp.join('');
    if (otpString.length !== 6) {
      setOtpError('אנא הזן קוד OTP בן 6 ספרות');
      return;
    }

    setLoading(true);
    setOtpError('');
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          phone: phoneNumber,
          code: otpString 
        }),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok && data.access_token) {
        // Store the JWT token
        localStorage.setItem('access_token', data.access_token);
        
        // Decode token to get user_id and create user object
        try {
          const base64Url = data.access_token.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          );
          const decoded = JSON.parse(jsonPayload);
          
          // Try to get saved user details from localStorage
          const savedFirstName = localStorage.getItem('user_first_name');
          const savedLastName = localStorage.getItem('user_last_name');
          const savedEmail = localStorage.getItem('user_email');
          
          // Set user from token data and localStorage
          const username = savedFirstName && savedLastName
            ? `${savedFirstName} ${savedLastName}`
            : decoded.sub || phoneNumber || 'משתמש';
          
          setUser({
            _id: decoded.user_id || decoded.sub || '',
            username: username,
            email: savedEmail || '',
            role: 'user',
          });
        } catch (tokenError) {
          console.error('Error decoding token:', tokenError);
        }
        
        setOtpError('');
        navigate('/overview');
      } else {
        if (data.error === 'too_many_attempts') {
          setOtpError('יותר מדי ניסיונות. אנא נסה שוב מאוחר יותר');
        } else if (data.error === 'otp_expired_or_missing') {
          setOtpError('קוד OTP פג תוקף. אנא בקש קוד חדש');
        } else if (data.error === 'invalid_code') {
          setOtpError(`קוד שגוי. נותרו ${5 - (data.attempts || 0)} ניסיונות`);
        } else {
          setOtpError(data.error || 'קוד OTP שגוי');
        }
      }
    } catch (error) {
      console.error('OTP verification error:', error);
      setOtpError('אירעה שגיאה באימות הקוד');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpInputChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1); // Only take the last character
    setOtp(newOtp);
    setOtpError('');

    // Force LTR direction on the input element after value change
    setTimeout(() => {
      const inputElement = document.getElementById(`otp-input-${index}`);
      if (inputElement) {
        const muiInputRoot = inputElement.querySelector('.MuiOutlinedInput-root') as HTMLElement;
        if (muiInputRoot) {
          const actualInput = muiInputRoot.querySelector('input') as HTMLInputElement;
          if (actualInput) {
            actualInput.setAttribute('dir', 'ltr');
            actualInput.style.setProperty('direction', 'ltr', 'important');
            actualInput.style.setProperty('text-align', 'center', 'important');
            actualInput.style.setProperty('unicode-bidi', 'bidi-override', 'important');
          }
        }
      }
    }, 0);

    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-input-${index + 1}`);
      if (nextInput) {
        (nextInput as HTMLInputElement).focus();
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-input-${index - 1}`);
      if (prevInput) {
        (prevInput as HTMLInputElement).focus();
      }
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLDivElement>, startIndex: number) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newOtp = [...otp];
    
    // Fill OTP from left to right (LTR), starting from the first input (index 0)
    for (let i = 0; i < 6 && i < pastedData.length; i++) {
      newOtp[i] = pastedData[i] || '';
    }
    
    setOtp(newOtp);
    setOtpError('');
    
    // Focus the last filled input or the first empty one (LTR)
    const nextIndex = Math.min(pastedData.length, 5);
    const nextInput = document.getElementById(`otp-input-${nextIndex}`);
    if (nextInput) {
      (nextInput as HTMLInputElement).focus();
    }
  };

  const handleBackToPhone = () => {
    setShowOtpScreen(false);
    setOtp(['', '', '', '', '', '']);
    setOtpError('');
    setOtpSentMessage('');
  };

  // Force LTR direction on OTP input fields
  useEffect(() => {
    if (showOtpScreen) {
      const applyLtrDirection = () => {
        // Find all OTP input fields by their IDs
        for (let i = 0; i < 6; i++) {
          const inputElement = document.getElementById(`otp-input-${i}`);
          if (inputElement) {
            // Find the actual input element inside MUI TextField structure
            const muiInputRoot = inputElement.querySelector('.MuiOutlinedInput-root') as HTMLElement;
            if (muiInputRoot) {
              muiInputRoot.setAttribute('dir', 'ltr');
              muiInputRoot.style.setProperty('direction', 'ltr', 'important');
              
              const actualInput = muiInputRoot.querySelector('input') as HTMLInputElement;
              if (actualInput) {
                actualInput.setAttribute('dir', 'ltr');
                actualInput.style.setProperty('direction', 'ltr', 'important');
                actualInput.style.setProperty('text-align', 'center', 'important');
                actualInput.style.setProperty('unicode-bidi', 'bidi-override', 'important');
              }
            }
          }
        }
      };

      // Apply multiple times to ensure it sticks
      applyLtrDirection();
      const timeoutId1 = setTimeout(applyLtrDirection, 50);
      const timeoutId2 = setTimeout(applyLtrDirection, 150);
      const timeoutId3 = setTimeout(applyLtrDirection, 300);
      const intervalId = setInterval(applyLtrDirection, 500);

      return () => {
        clearTimeout(timeoutId1);
        clearTimeout(timeoutId2);
        clearTimeout(timeoutId3);
        clearInterval(intervalId);
      };
    }
  }, [showOtpScreen, otp]);

  return (
      <Box
        sx={{
        minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
        justifyContent: 'center',
        background: {
          xs: 'transparent',
          md: 'linear-gradient(135deg, rgba(147, 197, 253, 0.15) 0%, rgba(191, 219, 254, 0.15) 50%, rgba(219, 234, 254, 0.15) 100%)',
        },
        py: { xs: 0, md: 8 },
        px: { xs: 0, md: 0 },
        }}
      >
      <Container component="main" maxWidth={false} sx={{ width: '100%', px: { xs: 0, sm: 3 }, m: { xs: 0, sm: 'auto' }, maxWidth: { xs: '100%', sm: '444px' } }}>
        <StyledCard sx={{ m: { xs: 0, sm: 0 }, borderRadius: { xs: 0, sm: 16 } }}>
          <CardContent>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                mb: 3,
              }}
            >
              <Box
                component="img"
                src="/logo.png"
                alt="ShowUp Logo"
                sx={{
                  height: { xs: 60, sm: 80 },
                  width: 'auto',
                  mb: 2,
                  objectFit: 'contain',
                }}
              />
              <Typography component="h1" variant="h5" fontWeight="bold">
                {showOtpScreen ? 'אימות קוד OTP' : 'התחברות'}
              </Typography>
              <Typography color="textSecondary" variant="body2" sx={{ mt: 1 }}>
                {showOtpScreen
                  ? `הזן את הקוד שנשלח ל-WhatsApp במספר ${phoneNumber}`
                  : 'הזן את מספר הטלפון שלך כדי להתחבר'}
              </Typography>
            </Box>

            {!showOtpScreen ? (
            <Box component="form" onSubmit={handleSubmit}>
                {formError && (
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'error.main',
                      mb: 2,
                      textAlign: 'right',
                      fontSize: '14px',
                    }}
                  >
                    {formError}
                  </Typography>
                )}
                <Box
                  sx={{
                    mb: 2,
                    display: 'flex',
                    flexDirection: 'row-reverse',
                    gap: 1,
                  }}
                >
                  <TextField
                    select
                    value={formData.countryCode}
                    onChange={(e) => setFormData({ ...formData, countryCode: e.target.value as string })}
                    sx={(theme) => ({
                      minWidth: { xs: 90, sm: 110 },
                      width: { xs: 90, sm: 110 },
                      flexShrink: 0,
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 1.5,
                        height: 40,
                        bgcolor: theme.palette.mode === 'dark'
                          ? theme.palette.background.paper
                          : '#f9fafb',
                        '& fieldset': {
                          borderColor: theme.palette.divider,
                        },
                        '&:hover fieldset': {
                          borderColor: theme.palette.mode === 'dark'
                            ? theme.palette.divider
                            : '#d1d5db',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#3b82f6',
                          boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
                        },
                        '& .MuiSelect-select': {
                          fontSize: { xs: 12, sm: 13 },
                        },
                      },
                    })}
                    SelectProps={{
                      renderValue: (value) => (value as string) || '+972',
                    }}
                    inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                  >
                    {countryOptions.map((option) => (
                      <MenuItem key={option.code + option.dialCode} value={option.dialCode}>
                        {option.flag} {option.name} ({option.dialCode})
                      </MenuItem>
                    ))}
                  </TextField>

              <StyledTextField
                fullWidth
                    type="tel"
                    placeholder="הזינו מספר טלפון"
                    value={formData.phone}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const onlyDigits = e.target.value.replace(/\D/g, '');
                      setFormData({ ...formData, phone: onlyDigits });
                      setFormError('');
                    }}
                    inputProps={{
                      style: { direction: 'rtl', textAlign: 'right' },
                      inputMode: 'numeric',
                      pattern: '[0-9]*',
                    }}
                    error={!!errors.phone}
                    helperText={errors.phone}
                    sx={(theme) => ({
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 1.5,
                        height: 40,
                        bgcolor: theme.palette.mode === 'dark'
                          ? theme.palette.background.paper
                          : '#f9fafb',
                        '& fieldset': {
                          borderColor: theme.palette.divider,
                          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                        },
                        '&:hover fieldset': {
                          borderColor: theme.palette.mode === 'dark'
                            ? theme.palette.divider
                            : '#d1d5db',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#3b82f6',
                          boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
                        },
                      },
                    })}
              />
                </Box>

              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{
                  mt: 2,
                  mb: 2,
                    borderRadius: 1,
                    padding: '12px',
                  textTransform: 'none',
                  fontSize: '16px',
                    bgcolor: '#7C3AED',
                    color: '#ffffff',
                    '&:hover': {
                      bgcolor: '#6D28D9',
                    },
                    '&:disabled': {
                      bgcolor: '#B9A8DC',
                      color: '#ffffff',
                    },
                }}
                disabled={loading}
              >
                  {loading ? <CircularProgress size={24} color="inherit" /> : 'המשך'}
              </Button>

                <Box sx={{ textAlign: 'center', mt: 2 }}>
                  <Link href="/register" variant="body2" color="primary">
                    אין לך חשבון? צור חשבון
                  </Link>
                </Box>
              </Box>
            ) : (
              <Box component="form" onSubmit={handleOtpSubmit}>
                {otpSentMessage && (
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'success.main',
                      mb: 2,
                      textAlign: 'center',
                      fontSize: '14px',
                    }}
                  >
                    {otpSentMessage}
                  </Typography>
                )}
                
                <Box
                  dir="ltr"
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: { xs: 1, sm: 1 },
                    mb: 2,
                    direction: 'ltr',
                    width: { xs: '100%', sm: 'auto' },
                    flexWrap: { xs: 'nowrap', sm: 'nowrap' },
                    px: { xs: 1, sm: 0 },
                    '& *': {
                      direction: 'ltr !important' as any,
                    },
                  }}
                >
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <TextField
                      key={index}
                      id={`otp-input-${index}`}
                      type="tel"
                      inputMode="numeric"
                      value={otp[index]}
                      onChange={(e) => handleOtpInputChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      onPaste={(e) => handleOtpPaste(e, index)}
                      inputProps={{
                        maxLength: 1,
                        pattern: '[0-9]*',
                        style: {
                          direction: 'ltr',
                          textAlign: 'center',
                          fontWeight: 600,
                          unicodeBidi: 'bidi-override',
                        },
                      }}
                      sx={(theme) => ({
                        width: { xs: 48, sm: 50 },
                        minWidth: { xs: 48, sm: 50 },
                        flexShrink: 0,
                        direction: 'ltr !important',
                        '& .MuiInputBase-input': {
                          fontSize: { xs: '20px', sm: '22px' },
                          padding: { xs: '8px', sm: '10px' },
                        },
                        '& .MuiOutlinedInput-root': {
                          borderRadius: 1.5,
                          height: { xs: 52, sm: 50 },
                          direction: 'ltr !important',
                          bgcolor: theme.palette.mode === 'dark'
                            ? theme.palette.background.paper
                            : '#f9fafb',
                          '& fieldset': {
                            borderColor: otpError ? 'error.main' : theme.palette.divider,
                            borderWidth: otpError ? 2 : 1,
                          },
                          '&:hover fieldset': {
                            borderColor: otpError ? 'error.main' : (theme.palette.mode === 'dark'
                              ? theme.palette.divider
                              : '#d1d5db'),
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: otpError ? 'error.main' : '#3b82f6',
                            borderWidth: 2,
                            boxShadow: otpError ? 'none' : '0 0 0 2px rgba(59,130,246,0.2)',
                          },
                          '& input': {
                            direction: 'ltr !important',
                            textAlign: 'center !important',
                            unicodeBidi: 'bidi-override !important',
                            '&::placeholder': {
                              direction: 'ltr !important',
                            },
                          },
                        },
                      })}
                    />
                  ))}
                </Box>

                {otpError && (
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'error.main',
                      mb: 2,
                      textAlign: 'center',
                      fontSize: '14px',
                    }}
                  >
                    {otpError}
                </Typography>
                )}

                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{
                    mt: 2,
                    mb: 2,
                    borderRadius: 1,
                    padding: '12px',
                    textTransform: 'none',
                    fontSize: '16px',
                    bgcolor: '#7C3AED',
                    color: '#ffffff',
                    '&:hover': {
                      bgcolor: '#6D28D9',
                    },
                    '&:disabled': {
                      bgcolor: '#B9A8DC',
                      color: '#ffffff',
                    },
                  }}
                  disabled={loading || otp.join('').length !== 6}
              >
                  {loading ? <CircularProgress size={24} color="inherit" /> : 'אימות'}
                </Button>

                <Box sx={{ textAlign: 'center', mt: 1 }}>
                  {resendCooldown > 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      שליחת קוד חדש בעוד {resendCooldown} שניות
                    </Typography>
                  ) : (
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      color="primary"
                      onClick={handleResendOtp}
                      disabled={loading}
                      sx={{ cursor: 'pointer', border: 'none', background: 'none', textDecoration: 'underline' }}
                    >
                      שלח קוד חדש
                    </Link>
                  )}
                </Box>

                <Box sx={{ textAlign: 'center', mt: 2 }}>
                  <Link
                    component="button"
                    type="button"
                    variant="body2"
                color="primary"
                    onClick={handleBackToPhone}
                    sx={{ 
                      cursor: 'pointer',
                      border: 'none',
                      background: 'none',
                      textDecoration: 'underline'
                    }}
              >
                    חזרה להזנת מספר טלפון
                  </Link>
                </Box>
            </Box>
            )}
          </CardContent>
        </StyledCard>
      </Container>
      </Box>
  );
};

export default Login; 