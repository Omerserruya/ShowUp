import React from 'react';
import { Box, Typography, Button, alpha, useTheme } from '@mui/material';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';

const BRAND = '#888cee';
const DEEP = '#6f74e0';
const SOFT = '#aab0f4';

export interface AssistantInsightProps {
  /** Short overline, e.g. "הצעד הבא". */
  eyebrow?: string;
  /** The human recommendation sentence. */
  text: string;
  /** Small context chip, e.g. "⏱ 2 דקות" / "מומלץ: מחר". */
  meta?: string;
  /** Optional action. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * The assistant's presence on the dashboard - a calm, native insight strip with a
 * sparkle, a recommendation written like a person, and one clear action. Not a
 * chatbot bubble; it reads as the product quietly thinking ahead for you.
 */
export default function AssistantInsight({ eyebrow = 'הצעד הבא', text, meta, actionLabel, onAction }: AssistantInsightProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 1.75, sm: 2.5 },
        flexWrap: 'wrap',
        p: { xs: 2.5, sm: 3 },
        borderRadius: 4,
        border: '1px solid',
        borderColor: alpha(BRAND, isDark ? 0.3 : 0.2),
        background: isDark
          ? `linear-gradient(120deg, ${alpha(BRAND, 0.16)}, ${alpha(DEEP, 0.08)})`
          : `linear-gradient(120deg, ${alpha(BRAND, 0.08)}, ${alpha(SOFT, 0.05)})`,
        boxShadow: isDark ? 'none' : `0 6px 22px ${alpha(BRAND, 0.08)}`,
        opacity: 0,
        animation: 'insightIn .55s cubic-bezier(.2,.8,.2,1) forwards',
        animationDelay: '80ms',
        '@keyframes insightIn': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
      }}
    >
      {/* soft glow trailing the sparkle */}
      <Box sx={{ position: 'absolute', top: '50%', insetInlineStart: 18, transform: 'translateY(-50%)', width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(BRAND, 0.22)}, transparent 70%)`, pointerEvents: 'none' }} />

      <Box
        sx={{
          position: 'relative',
          width: 44, height: 44, borderRadius: '14px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', background: `linear-gradient(135deg, ${DEEP}, ${BRAND})`,
          boxShadow: `0 8px 20px ${alpha(BRAND, 0.45)}, inset 0 1px 0 ${alpha('#fff', 0.3)}`,
          animation: 'sparklePulse 3.2s ease-in-out infinite',
          '@keyframes sparklePulse': { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.07)' } },
        }}
      >
        <AutoAwesomeRoundedIcon sx={{ fontSize: 22 }} />
      </Box>

      <Box sx={{ position: 'relative', flex: 1, minWidth: 200 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.4 }}>
          <Box sx={{ fontSize: '0.95rem', lineHeight: 1 }}>✨</Box>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', color: DEEP }}>
            {eyebrow}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: { xs: '1rem', sm: '1.08rem' }, fontWeight: 700, color: 'text.primary', lineHeight: 1.5 }}>
          {text}
        </Typography>
        {meta && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', mt: 1, px: 1.25, py: 0.4, borderRadius: 99, bgcolor: alpha(DEEP, isDark ? 0.22 : 0.1) }}>
            <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: DEEP }}>{meta}</Typography>
          </Box>
        )}
      </Box>

      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          variant="contained"
          disableElevation
          sx={{
            position: 'relative',
            flexShrink: 0,
            borderRadius: 2.5,
            px: 2.75, py: 1,
            fontWeight: 700,
            textTransform: 'none',
            color: '#fff',
            background: `linear-gradient(90deg, ${DEEP}, ${BRAND})`,
            boxShadow: `0 8px 20px ${alpha(BRAND, 0.3)}`,
            transition: 'transform .2s ease, box-shadow .2s ease',
            '&:hover': { background: `linear-gradient(90deg, ${DEEP}, ${DEEP})`, transform: 'translateY(-1px)', boxShadow: `0 12px 26px ${alpha(BRAND, 0.4)}` },
          }}
        >
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}
