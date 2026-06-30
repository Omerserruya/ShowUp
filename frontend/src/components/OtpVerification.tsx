import React from 'react';
import { Box, Button, CircularProgress, Link, TextField, Typography } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { alpha, useTheme } from '@mui/material/styles';
import AuthLayout, { authButtonSx } from './AuthLayout';

export interface OtpVerificationProps {
  /** The phone number the code was sent to (shown in the subtitle). */
  phone: string;
  /** The six-slot OTP state. */
  otp: string[];
  loading: boolean;
  error?: string;
  /** Optional success/info line (e.g. "code sent"). */
  sentMessage?: string;
  /** Seconds remaining on the resend cooldown (0 = can resend). */
  resendCooldown: number;
  onChange: (index: number, value: string) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>, index: number) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onResend: () => void;
  onBack: () => void;
  title?: string;
}

const SLOTS = [0, 1, 2, 3, 4, 5];

/**
 * OTP entry, on the same premium split-screen as Login/Register. No card/modal
 * chrome - the marketing panel stays on the left, and the right side holds clear
 * hierarchy with six large digit inputs. Purely presentational: every handler
 * (autofill/paste/auto-submit/resend) is owned by the parent page and passed in.
 */
export default function OtpVerification({
  phone,
  otp,
  loading,
  error,
  sentMessage,
  resendCooldown,
  onChange,
  onKeyDown,
  onPaste,
  onSubmit,
  onResend,
  onBack,
  title = 'אימות בוואטסאפ',
}: OtpVerificationProps) {
  const theme = useTheme();
  const complete = otp.join('').length === 6;

  return (
    <AuthLayout>
      <Box sx={{ direction: 'rtl', textAlign: 'right' }}>
        <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '2rem', md: '2.4rem' }, lineHeight: 1.15 }}>
          {title}
        </Typography>
        <Typography sx={{ color: 'text.secondary', mt: 1.5, fontSize: '1.05rem', lineHeight: 1.6 }}>
          שלחנו קוד בן 6 ספרות לוואטסאפ של
        </Typography>
        <Typography sx={{ fontWeight: 700, mb: 4, direction: 'ltr', unicodeBidi: 'plaintext', textAlign: 'right' }}>
          {phone}
        </Typography>

        {sentMessage && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 2.5, color: 'success.main' }}>
            <CheckCircleRoundedIcon fontSize="small" />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{sentMessage}</Typography>
          </Box>
        )}

        <Box component="form" onSubmit={onSubmit} noValidate>
          <Box dir="ltr" sx={{ display: 'flex', gap: { xs: 1, sm: 1.5 }, mb: 3 }}>
            {SLOTS.map((index) => (
              <TextField
                key={index}
                id={`otp-input-${index}`}
                value={otp[index] ?? ''}
                onChange={(e) => onChange(index, e.target.value)}
                onKeyDown={(e) => onKeyDown(index, e)}
                onPaste={(e) => onPaste(e, index)}
                type="tel"
                autoFocus={index === 0}
                error={!!error}
                inputProps={{
                  inputMode: 'numeric',
                  // Only slot 0 advertises one-time-code so WebOTP/autofill drops
                  // the whole code here; handleOtpInputChange distributes it.
                  autoComplete: index === 0 ? 'one-time-code' : 'off',
                  maxLength: index === 0 ? 6 : 1,
                  'aria-label': `ספרה ${index + 1}`,
                  style: {
                    textAlign: 'center',
                    direction: 'ltr',
                    unicodeBidi: 'bidi-override',
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    padding: 0,
                    fontVariantNumeric: 'tabular-nums',
                  },
                }}
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    height: { xs: 58, sm: 64 },
                    borderRadius: 2.5,
                    bgcolor: 'background.paper',
                    transition: 'box-shadow .15s ease, border-color .15s ease',
                    '& fieldset': { borderWidth: 2, borderColor: alpha(theme.palette.text.primary, 0.15) },
                    '&:hover fieldset': { borderColor: alpha('#888cee', 0.5) },
                    '&.Mui-focused fieldset': { borderColor: '#888cee' },
                    '&.Mui-focused': { boxShadow: `0 0 0 4px ${alpha('#888cee', 0.12)}` },
                  },
                }}
              />
            ))}
          </Box>

          {error && (
            <Typography variant="body2" sx={{ color: 'error.main', mb: 2, fontWeight: 600 }}>
              {error}
            </Typography>
          )}

          <Button type="submit" fullWidth variant="contained" disabled={loading || !complete} sx={authButtonSx}>
            {loading ? <CircularProgress size={24} color="inherit" /> : 'אימות וכניסה'}
          </Button>
        </Box>

        <Box sx={{ mt: 3 }}>
          {resendCooldown > 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {`אפשר לשלוח קוד חדש בעוד ${resendCooldown} שניות`}
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              לא קיבלתם?{' '}
              <Link component="button" type="button" onClick={onResend} disabled={loading} sx={{ fontWeight: 700 }}>
                שלחו לי קוד חדש בוואטסאפ
              </Link>
            </Typography>
          )}
        </Box>

        <Box sx={{ mt: 2 }}>
          <Link component="button" type="button" onClick={onBack} sx={{ color: 'text.secondary', fontWeight: 600 }}>
            ← שינוי מספר הטלפון
          </Link>
        </Box>
      </Box>
    </AuthLayout>
  );
}
