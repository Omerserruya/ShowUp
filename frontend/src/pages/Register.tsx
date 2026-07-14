import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Link,
  CircularProgress,
  MenuItem,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';
import OtpVerification from '../components/OtpVerification';
import AuthLayout, { authFieldSx, authButtonSx } from '../components/AuthLayout';

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

const Register = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Where to go after a successful OTP verification (e.g. continue to payment).
  const nextPath = (location.state as any)?.next || '/overview';
  const { setUser } = useUser();
  const [formData, setFormData] = useState<RegisterFormData>({
    phone: '',
    countryCode: '+972',
    firstName: '',
    lastName: '',
    email: '',
  });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [showOtpScreen, setShowOtpScreen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
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
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneNumber,
          first_name: formData.firstName,
          last_name: formData.lastName,
          email: formData.email || undefined,
        }),
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok && data.status === 'otp_sent') {
        setOtpSentMessage('שלחנו קוד חדש ל-WhatsApp שלך');
        setResendCooldown(60);
        setOtp(['', '', '', '', '', '']);
        // Put the cursor back where typing starts - autoFocus only fires on mount.
        setTimeout(() => document.getElementById('otp-input-0')?.focus(), 50);
      } else {
        setOtpError(data.error || 'שליחת הקוד נכשלה. נסו שוב');
      }
    } catch (error) {
      setOtpError('אירעה שגיאה בשליחת הקוד');
    } finally {
      setLoading(false);
    }
  };

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
    if (!agreedToTerms) {
      setFormError('צריך לאשר את תנאי השימוש ומדיניות הפרטיות כדי להמשיך');
      return;
    }
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
        setOtpSentMessage('שלחנו קוד אימות ל-WhatsApp שלך');
        setResendCooldown(60);
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

  const handleOtpSubmit = async (e?: React.FormEvent, codeOverride?: string) => {
    if (e) e.preventDefault();
    if (loading) return;
    const otpString = codeOverride ?? otp.join('');
    if (otpString.length !== 6) {
      setOtpError('אנא הזן את הקוד בן 6 הספרות שקיבלתם בוואטסאפ');
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
          code: otpString,
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
        navigate(nextPath);
      } else {
        if (data.error === 'too_many_attempts') {
          setOtpError('יותר מדי ניסיונות. אנא נסה שוב מאוחר יותר');
        } else if (data.error === 'otp_expired_or_missing') {
          setOtpError('קוד OTP פג תוקף. אנא בקש קוד חדש');
        } else if (data.error === 'invalid_code') {
          // Only quote remaining attempts when the server actually reported them.
          const remaining = typeof data.attempts === 'number' ? Math.max(0, 5 - data.attempts) : null;
          setOtpError(remaining !== null ? `קוד שגוי. נותרו ${remaining} ניסיונות` : 'קוד שגוי, נסו שוב');
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

    // Multi-character input = OS/keyboard autofill of the whole code into one box.
    // Distribute the digits across all boxes and submit when complete.
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      const filledOtp = ['', '', '', '', '', ''];
      for (let i = 0; i < 6; i++) filledOtp[i] = digits[i] || '';
      setOtp(filledOtp);
      setOtpError('');
      const focusIndex = Math.min(digits.length, 5);
      document.getElementById(`otp-input-${focusIndex}`)?.focus();
      if (digits.length === 6) handleOtpSubmit(undefined, filledOtp.join(''));
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setOtpError('');

    // Auto-focus next input
    if (value && index < 5) {
      document.getElementById(`otp-input-${index + 1}`)?.focus();
    }

    // Auto-submit the moment all six digits are present.
    if (newOtp.join('').length === 6) {
      handleOtpSubmit(undefined, newOtp.join(''));
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
    document.getElementById(`otp-input-${nextIndex}`)?.focus();

    // Auto-submit when a full 6-digit code was pasted.
    if (pastedData.length === 6) {
      handleOtpSubmit(undefined, newOtp.join(''));
    }
  };

  const handleBackToForm = () => {
    setShowOtpScreen(false);
    setOtp(['', '', '', '', '', '']);
    setOtpError('');
    setOtpSentMessage('');
  };

  // OTP entry is its own premium full-page experience (shared with Login).
  if (showOtpScreen) {
    return (
      <OtpVerification
        phone={phoneNumber}
        otp={otp}
        loading={loading}
        error={otpError}
        sentMessage={otpSentMessage}
        resendCooldown={resendCooldown}
        onChange={handleOtpInputChange}
        onKeyDown={handleOtpKeyDown}
        onPaste={handleOtpPaste}
        onSubmit={handleOtpSubmit}
        onResend={handleResendOtp}
        onBack={handleBackToForm}
        title="אימות בוואטסאפ"
      />
    );
  }

  const nameFieldSx = [authFieldSx, { flex: 1 }];

  return (
    <AuthLayout>
      <Box component="form" onSubmit={handleSubmit} sx={{ direction: 'rtl', textAlign: 'right' }}>
        <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '2rem', md: '2.4rem' }, lineHeight: 1.15 }}>
          יאללה, בואו נתחיל 🎉
        </Typography>
        <Typography sx={{ color: 'text.secondary', mt: 1.5, mb: 4, fontSize: '1.05rem', lineHeight: 1.6 }}>
          כמה פרטים קצרים, ואתם מוכנים לארגן את האירוע בלי כאב ראש.
        </Typography>

        {formError && (
          <Typography role="alert" variant="body2" sx={{ color: 'error.main', mb: 2.5, fontWeight: 600 }}>
            {formError}
          </Typography>
        )}

        {/* Phone */}
        <Box sx={{ display: 'flex', flexDirection: 'row-reverse', gap: 1.5, mb: 2.5 }}>
          <TextField
            select
            value={formData.countryCode}
            onChange={(e) => setFormData({ ...formData, countryCode: e.target.value as string })}
            sx={[authFieldSx, { width: 120, flexShrink: 0 }]}
            SelectProps={{ renderValue: (value) => (value as string) || '+972' }}
            inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
          >
            {countryOptions.map((option) => (
              <MenuItem key={option.code + option.dialCode} value={option.dialCode}>
                {option.flag} {option.name} ({option.dialCode})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            type="tel"
            placeholder="מספר טלפון"
            value={formData.phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const onlyDigits = e.target.value.replace(/\D/g, '');
              setFormData({ ...formData, phone: onlyDigits });
              setFormError('');
            }}
            inputProps={{
              // The value is an LTR phone number - rtl direction bidi-scrambles it.
              style: { direction: 'ltr', textAlign: 'right' },
              inputMode: 'numeric',
              pattern: '[0-9]*',
              autoComplete: 'tel',
              'aria-label': 'מספר טלפון',
            }}
            error={!!errors.phone}
            helperText={errors.phone}
            sx={authFieldSx}
          />
        </Box>

        {/* Name (first + last side by side) */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexDirection: { xs: 'column', sm: 'row' } }}>
          <TextField
            placeholder="שם פרטי"
            value={formData.firstName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setFormData({ ...formData, firstName: e.target.value });
              setFormError('');
            }}
            inputProps={{ style: { direction: 'rtl', textAlign: 'right' }, 'aria-label': 'שם פרטי', autoComplete: 'given-name' }}
            error={!!errors.firstName}
            helperText={errors.firstName}
            sx={nameFieldSx}
          />
          <TextField
            placeholder="שם משפחה"
            value={formData.lastName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setFormData({ ...formData, lastName: e.target.value });
              setFormError('');
            }}
            inputProps={{ style: { direction: 'rtl', textAlign: 'right' }, 'aria-label': 'שם משפחה', autoComplete: 'family-name' }}
            error={!!errors.lastName}
            helperText={errors.lastName}
            sx={nameFieldSx}
          />
        </Box>

        {/* Email (optional) */}
        <TextField
          fullWidth
          type="email"
          placeholder="אימייל (לא חובה)"
          value={formData.email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setFormData({ ...formData, email: e.target.value });
            setFormError('');
          }}
          inputProps={{ style: { direction: 'rtl', textAlign: 'right' }, 'aria-label': 'אימייל (לא חובה)', autoComplete: 'email' }}
          error={!!errors.email}
          helperText={errors.email}
          sx={[authFieldSx, { mb: 2 }]}
        />

        {/* Terms */}
        <FormControlLabel
          sx={{ alignItems: 'flex-start', m: 0, mb: 3, direction: 'rtl' }}
          control={
            <Checkbox
              checked={agreedToTerms}
              onChange={(e) => {
                setAgreedToTerms(e.target.checked);
                setFormError('');
              }}
              sx={{ pt: 0.25, '&.Mui-checked': { color: '#888cee' } }}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
              קראתי ואני מסכים/ה{' '}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>
                לתנאי השימוש
              </Link>
              {' '}ול
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" sx={{ fontWeight: 600 }}>
                מדיניות הפרטיות
              </Link>
              .
            </Typography>
          }
        />

        <Button type="submit" fullWidth variant="contained" disabled={loading || !agreedToTerms} sx={authButtonSx}>
          {loading ? <CircularProgress size={24} color="inherit" /> : 'יוצאים לדרך'}
        </Button>

        <Typography sx={{ textAlign: 'center', mt: 3.5, color: 'text.secondary' }}>
          כבר יש לכם חשבון?{' '}
          <Link component={RouterLink} to="/login" sx={{ fontWeight: 700 }}>
            להתחברות
          </Link>
        </Typography>
      </Box>
    </AuthLayout>
  );
};

export default Register;
