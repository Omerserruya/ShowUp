import React from 'react';
import Chip from '@mui/material/Chip';
import { alpha, useTheme } from '@mui/material/styles';

interface EventStatusBadgeProps {
  state?: string;
  paymentStatus?: string;
  size?: 'small' | 'medium';
}

type StatusColor = 'success' | 'warning' | 'default';

/**
 * Derives a single user-facing status (Hebrew label + color) from the event's
 * persistent lifecycle `state` and `paymentStatus` fields.
 */
function deriveStatus(
  state?: string,
  paymentStatus?: string
): { label: string; color: StatusColor } {
  if (paymentStatus === 'pending') {
    return { label: 'ממתין לתשלום', color: 'warning' };
  }
  if (state === 'draft') {
    return { label: 'טיוטה', color: 'default' };
  }
  if ((paymentStatus === 'paid' || paymentStatus === 'free') && state === 'active') {
    return { label: 'פעיל', color: 'success' };
  }
  return { label: 'פעיל', color: 'success' };
}

const EventStatusBadge: React.FC<EventStatusBadgeProps> = ({
  state,
  paymentStatus,
  size = 'small',
}) => {
  const theme = useTheme();
  const { label, color } = deriveStatus(state, paymentStatus);

  // Soft, premium palette: neutral grey for "default", themed color otherwise.
  const baseColor =
    color === 'default'
      ? theme.palette.text.secondary
      : theme.palette[color].main;

  return (
    <Chip
      label={label}
      size={size}
      sx={{
        direction: 'rtl',
        fontWeight: 600,
        borderRadius: 2,
        color: baseColor,
        bgcolor: alpha(baseColor, 0.12),
        border: '1px solid',
        borderColor: alpha(baseColor, 0.24),
        '& .MuiChip-label': {
          px: 1.25,
        },
      }}
    />
  );
};

export default EventStatusBadge;
