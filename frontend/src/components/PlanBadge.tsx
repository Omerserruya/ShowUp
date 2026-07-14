import React from 'react';
import { Box, Stack, Typography, useTheme, alpha } from '@mui/material';
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded';
import { usePlanId, useIsStarter, useIsVenue, useVenueName } from '../hooks/useEntitlement';
import { getPlan } from '../config/plans';

/**
 * Subtle current-plan indicator. For the couple's Starter plan and for Venue
 * Edition it reads as a benefit - never an advertisement. Venue Edition shows the
 * source: "Provided by <Venue>". `compact` renders a single quiet line.
 */
export default function PlanBadge({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const planId = usePlanId();
  const isStarter = useIsStarter();
  const isVenue = useIsVenue();
  const venueName = useVenueName();
  const plan = getPlan(planId);

  let title = plan?.title || 'חבילה';
  let note: string | undefined;
  if (isVenue) {
    title = 'Venue';
    note = venueName ? `סופק על ידי ${venueName}` : 'סופק על ידי האולם שלכם';
  } else if (isStarter) {
    title = 'Starter';
    note = 'כלול באדיבות האולם שלכם';
  }

  if (compact) {
    return (
      <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 600 }}>
        חבילת {title}{note ? ` · ${note}` : ''}
      </Typography>
    );
  }

  return (
    <Stack
      direction="row" spacing={1.25} alignItems="center"
      sx={{
        display: 'inline-flex', px: 1.5, py: 0.85, borderRadius: 2,
        bgcolor: alpha(primary, 0.06), border: '1px solid', borderColor: alpha(primary, 0.18),
      }}
    >
      <WorkspacePremiumRoundedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>חבילת {title}</Typography>
        {note && <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.3 }}>{note}</Typography>}
      </Box>
    </Stack>
  );
}
