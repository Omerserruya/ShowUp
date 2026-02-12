import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  useTheme,
  alpha
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

interface StatusCardProps {
  title: string;
  description: string;
  count: number;
  color: string; // Can be any CSS color or gradient
  icon: React.ReactNode;
  onClick?: () => void;
}

// Extract a usable solid color from any color string (hex, gradient, rgb, etc.)
const extractColor = (color: string): string => {
  const match = color.match(/#[0-9a-fA-F]{6}|rgb\([^)]+\)|rgba\([^)]+\)/);
  return match ? match[0] : '#6366f1';
};

const StatusCard: React.FC<StatusCardProps> = ({
  title,
  description,
  count,
  color,
  icon,
  onClick
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const solidColor = extractColor(color);

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: isDark ? alpha(solidColor, 0.3) : alpha(solidColor, 0.15),
        bgcolor: isDark ? alpha(solidColor, 0.08) : alpha(solidColor, 0.04),
        transition: 'all 0.2s ease-in-out',
        height: { xs: 'auto', sm: '180px' },
        overflow: 'visible',
        '&:hover': {
          transform: onClick ? 'translateY(-2px)' : 'none',
          borderColor: alpha(solidColor, 0.4),
          boxShadow: onClick
            ? `0 8px 25px ${alpha(solidColor, isDark ? 0.25 : 0.12)}`
            : 'none',
        },
      }}
    >
      <CardActionArea
        onClick={onClick}
        disabled={!onClick}
        sx={{
          height: '100%',
          p: { xs: 1.5, sm: 2.5 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          '&:hover': { bgcolor: 'transparent' },
          '.MuiCardActionArea-focusHighlight': { opacity: 0 },
        }}
      >
        {/* Top: Icon + Title */}
        <Box sx={{ width: '100%' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              mb: { xs: 1, sm: 1.5 },
            }}
          >
            <Box
              sx={{
                width: { xs: 36, sm: 44 },
                height: { xs: 36, sm: 44 },
                borderRadius: 2.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(solidColor, isDark ? 0.2 : 0.12),
                color: solidColor,
                flexShrink: 0,
                '& > *': {
                  fontSize: { xs: 20, sm: 24 },
                  color: solidColor,
                },
              }}
            >
              {icon}
            </Box>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                color: 'text.primary',
                fontSize: { xs: '0.8rem', sm: '0.9rem' },
                lineHeight: 1.3,
              }}
            >
              {title}
            </Typography>
          </Box>

          {/* Description - desktop only */}
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              display: { xs: 'none', sm: 'block' },
              fontSize: '0.75rem',
              lineHeight: 1.4,
            }}
          >
            {description}
          </Typography>
        </Box>

        {/* Bottom: Count + Arrow */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            width: '100%',
            mt: { xs: 1, sm: 'auto' },
            pt: { xs: 0, sm: 1 },
          }}
        >
          <Typography
            variant="h3"
            component="div"
            sx={{
              fontWeight: 700,
              color: solidColor,
              fontSize: { xs: '1.75rem', sm: '2.5rem' },
              lineHeight: 1,
            }}
          >
            {count}
          </Typography>

          {onClick && (
            <Box
              sx={{
                color: alpha(solidColor, 0.6),
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.2s',
                '.MuiCard-root:hover &': {
                  color: solidColor,
                },
              }}
            >
              <ArrowBackIcon sx={{ fontSize: { xs: 18, sm: 20 } }} />
            </Box>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
};

export default StatusCard;