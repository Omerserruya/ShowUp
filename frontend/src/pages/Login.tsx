import React, { useState, useEffect } from 'react';
import { Box, Button, TextField, Typography, Link, CircularProgress, MenuItem } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';
import OtpVerification from '../components/OtpVerification';
import AuthLayout, { authFieldSx, authButtonSx } from '../components/AuthLayout';

interface LoginFormData {
  phone: string;
  countryCode: string;
}

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Where to go after a successful OTP verification (e.g. continue to payment).
  const nextPath = (location.state as any)?.next || '/overview';
  const { setUser } = useUser();
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

  // Hand-off from the event wizard: the account was just created/registered and
  // an OTP was already sent. Jump straight to the code-entry screen.
  useEffect(() => {
    const state = location.state as any;
    if (state?.phone && state?.otpAlreadySent) {
      setPhoneNumber(state.phone);
      setShowOtpScreen(true);
      setOtpSentMessage('שלחנו קוד אימות ל-WhatsApp שלך');
      setResendCooldown(60);
    }
  }, [location.state]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');

    if (error) {
      let errorMessage = 'ההתחברות נכשלה. אנא נסו שוב.';

      // Map error types to specific messages
      if (error === 'email_exists') {
        errorMessage = 'האימייל הזה כבר רשום בשיטת התחברות אחרת. אנא התחברו בדרך המקורית.';
      } else if (error === 'auth_failed') {
        errorMessage = 'ההתחברות נכשלה. אנא נסו שוב.';
      } else if (error === 'unauthorized') {
        errorMessage = 'אין לכם הרשאה לגשת לעמוד הזה.';
      } else if (error === 'server_error') {
        errorMessage = 'אירעה תקלה זמנית. אנא נסו שוב מאוחר יותר.';
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

  const handleBackToPhone = () => {
    setShowOtpScreen(false);
    setOtp(['', '', '', '', '', '']);
    setOtpError('');
    setOtpSentMessage('');
  };

  // "Change phone number": if we arrived from the wizard, go one step BACK into it
  // (the wizard restores all entered data and lets the phone be edited) rather than
  // resetting to the Login form.
  const cameFromWizard = Boolean((location.state as any)?.fromWizard);
  const handleChangePhone = () => {
    if (cameFromWizard) {
      navigate('/wizard', { state: { resumeDraft: true } });
    } else {
      handleBackToPhone();
    }
  };

  // OTP entry is its own premium full-page experience (shared with Register).
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
        onBack={handleChangePhone}
        title="אימות בוואטסאפ"
      />
    );
  }

  return (
    <AuthLayout>
      <Box component="form" onSubmit={handleSubmit} sx={{ direction: 'rtl', textAlign: 'right' }}>
        <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '2rem', md: '2.4rem' }, lineHeight: 1.15 }}>
          טוב לראות אתכם שוב 👋
        </Typography>
        <Typography sx={{ color: 'text.secondary', mt: 1.5, mb: 4, fontSize: '1.05rem', lineHeight: 1.6 }}>
          רק נוודא שזה אתם. נשלח קוד התחברות מהיר לוואטסאפ, ואתם כבר בפנים.
        </Typography>

        {formError && (
          <Typography role="alert" variant="body2" sx={{ color: 'error.main', mb: 2.5, fontWeight: 600 }}>
            {formError}
          </Typography>
        )}

        <Typography component="label" htmlFor="login-phone" sx={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', mb: 1, color: 'text.secondary' }}>
          מספר הטלפון שלכם
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'row-reverse', gap: 1.5, mb: 3.5 }}>
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
            id="login-phone"
            type="tel"
            placeholder="050-0000000"
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
            }}
            error={!!errors.phone}
            helperText={errors.phone}
            sx={authFieldSx}
          />
        </Box>

        <Button type="submit" fullWidth variant="contained" disabled={loading} sx={authButtonSx}>
          {loading ? <CircularProgress size={24} color="inherit" /> : 'שלחו לי קוד'}
        </Button>

        <Typography sx={{ textAlign: 'center', mt: 3.5, color: 'text.secondary' }}>
          עוד אין לכם חשבון?{' '}
          <Link href="/register" sx={{ fontWeight: 700 }}>
            בואו נפתח אחד
          </Link>
        </Typography>
      </Box>
    </AuthLayout>
  );
};

export default Login;
