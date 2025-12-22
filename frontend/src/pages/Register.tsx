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
  Card,
  MenuItem,
} from '@mui/material';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { styled, Theme } from '@mui/material/styles';
import { gray } from '../shared-theme/themePrimitives';
import { useUser } from '../contexts/UserContext';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';

interface RegisterFormData {
  phone: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface FormErrors {
  phone?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
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

const Register = () => {
  const navigate = useNavigate();
  const { setUser } = useUser();
  const [formData, setFormData] = useState<RegisterFormData>({
    phone: '',
    countryCode: '+972',
    firstName: '',
    lastName: '',
    email: '',
  });
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [showOtpScreen, setShowOtpScreen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [otpError, setOtpError] = useState('');
  const [formError, setFormError] = useState('');
  const [otpSentMessage, setOtpSentMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const validateForm = () => {
    const newErrors: FormErrors = {};
    if (!formData.phone) {
      newErrors.phone = 'מספר טלפון הוא שדה חובה';
    } else if (!/^\d{7,15}$/.test(formData.phone.replace(/\s/g, ''))) {
      newErrors.phone = 'מספר הטלפון אינו תקין';
    }
    if (!formData.firstName) {
      newErrors.firstName = 'שם פרטי הוא שדה חובה';
    }
    if (!formData.lastName) {
      newErrors.lastName = 'שם משפחה הוא שדה חובה';
    }
    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'כתובת האימייל אינה תקינה';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!validateForm()) return;

    setLoading(true);
    try {
      const fullPhoneNumber = normalizePhoneNumber(formData.phone, formData.countryCode);
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: fullPhoneNumber,
          first_name: formData.firstName,
          last_name: formData.lastName,
          email: formData.email || undefined,
        }),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok && data.status === 'otp_sent') {
        setPhoneNumber(fullPhoneNumber);
        setShowOtpScreen(true);
        setFormError('');
        setOtpSentMessage('קוד OTP נשלח למספר הטלפון שלך');
      } else {
        setFormError(
          data.error === 'user_exists' 
            ? 'מספר טלפון זה כבר רשום במערכת. אנא התחבר במקום' 
            : data.error || 'ההרשמה נכשלה'
        );
      }
    } catch (error) {
      console.error('Registration error:', error);
      setFormError('אירעה שגיאה במהלך ההרשמה');
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
          
          // Save user details to localStorage
          if (formData.firstName && formData.lastName) {
            localStorage.setItem('user_first_name', formData.firstName);
            localStorage.setItem('user_last_name', formData.lastName);
            if (formData.email) {
              localStorage.setItem('user_email', formData.email);
            }
          }
          
          // Set user from token data and localStorage
          const savedFirstName = localStorage.getItem('user_first_name') || '';
          const savedLastName = localStorage.getItem('user_last_name') || '';
          const savedEmail = localStorage.getItem('user_email') || '';
          
          setUser({
            _id: decoded.user_id || decoded.sub || '',
            username: savedFirstName && savedLastName 
              ? `${savedFirstName} ${savedLastName}`
              : decoded.sub || phoneNumber || 'משתמש',
            email: savedEmail,
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

  const handleBackToForm = () => {
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
                {showOtpScreen ? 'אימות קוד OTP' : 'יצירת חשבון'}
              </Typography>
              <Typography color="textSecondary" variant="body2" sx={{ mt: 1 }}>
                {showOtpScreen 
                  ? `הזן את קוד ה-OTP שנשלח למספר ${phoneNumber}`
                  : 'הירשם כדי להתחיל'}
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
                {/* Phone Number Field */}
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

              {/* First Name Field */}
              <StyledTextField
                fullWidth
                placeholder="שם פרטי"
                value={formData.firstName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData({ ...formData, firstName: e.target.value });
                  setFormError('');
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                error={!!errors.firstName}
                helperText={errors.firstName}
                sx={(theme) => ({
                  mb: 2,
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

              {/* Last Name Field */}
              <StyledTextField
                    fullWidth
                placeholder="שם משפחה"
                value={formData.lastName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData({ ...formData, lastName: e.target.value });
                  setFormError('');
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                error={!!errors.lastName}
                helperText={errors.lastName}
                sx={(theme) => ({
                  mb: 2,
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

              {/* Email Field (Optional) */}
              <StyledTextField
                    fullWidth
                type="email"
                placeholder="כתובת אימייל (אופציונלי)"
                    value={formData.email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData({ ...formData, email: e.target.value });
                  setFormError('');
                }}
                inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                    error={!!errors.email}
                    helperText={errors.email}
                sx={(theme) => ({
                  mb: 2,
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
                  bgcolor: '#000000',
                  color: '#ffffff',
                  '&:hover': {
                    bgcolor: '#1a1a1a',
                  },
                  '&:disabled': {
                    bgcolor: '#666666',
                    color: '#ffffff',
                  },
                }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'המשך'}
              </Button>

              <Box sx={{ textAlign: 'center', mt: 2 }}>
                <Link component={RouterLink} to="/login" variant="body2" color="primary">
                    כבר יש לך חשבון? התחבר
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
                      type="text"
                      inputMode="numeric"
                      value={otp[index]}
                      onChange={(e) => handleOtpInputChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      onPaste={(e) => handleOtpPaste(e, index)}
                      inputProps={{
                        maxLength: 1,
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
                        direction: 'ltr',
                        '& .MuiInputBase-input': {
                          fontSize: { xs: '20px', sm: '22px' },
                          padding: { xs: '8px', sm: '10px' },
                        },
                        '& .MuiOutlinedInput-root': {
                          borderRadius: 1.5,
                          height: { xs: 52, sm: 50 },
                          direction: 'ltr',
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
                          direction: 'ltr !important' as any,
                          textAlign: 'center !important' as any,
                          unicodeBidi: 'bidi-override !important' as any,
                          '&::placeholder': {
                            direction: 'ltr !important' as any,
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
                    bgcolor: '#000000',
                    color: '#ffffff',
                    '&:hover': {
                      bgcolor: '#1a1a1a',
                    },
                    '&:disabled': {
                      bgcolor: '#666666',
                      color: '#ffffff',
                    },
                  }}
                  disabled={loading || otp.join('').length !== 6}
              >
                  {loading ? <CircularProgress size={24} color="inherit" /> : 'אימות'}
                </Button>

                <Box sx={{ textAlign: 'center', mt: 2 }}>
                  <Link 
                    component="button"
                    variant="body2" 
                color="primary"
                    onClick={handleBackToForm}
                    sx={{ 
                      cursor: 'pointer',
                      border: 'none',
                      background: 'none',
                      textDecoration: 'underline'
                    }}
              >
                    חזרה לטופס הרשמה
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

export default Register; 