import React, { useState, useEffect } from 'react';
import { Box, Typography, Paper, useTheme, alpha } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AccessTimeIcon from '@mui/icons-material/AccessTime';

interface EventCountdownProps {
  eventDate?: string; // ISO string
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function EventCountdown({ eventDate }: EventCountdownProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [targetDate, setTargetDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!eventDate) return;

    const date = new Date(eventDate);
    if (isNaN(date.getTime())) return;

    setTargetDate(date);
  }, [eventDate]);

  useEffect(() => {
    if (!targetDate) return;

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = targetDate.getTime();
      const difference = target - now;

      if (difference <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [targetDate]);

  if (!targetDate) {
    return null;
  }

  const formatDate = (date: Date) => {
    const months = [
      'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
    ];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ב${month} ${year}`;
  };

  const formatTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const TimeBox = ({ value, label }: { value: number; label: string }) => (
    <Paper
      elevation={0}
      sx={{
        bgcolor: isDark
          ? alpha(theme.palette.background.paper, 0.6)
          : alpha('#ffffff', 0.8),
        backdropFilter: 'blur(10px)',
        borderRadius: 3,
        p: { xs: 1.5, md: 2.5 },
        border: '1px solid',
        borderColor: isDark
          ? alpha(theme.palette.primary.main, 0.15)
          : alpha(theme.palette.primary.main, 0.2),
        textAlign: 'center',
        minWidth: { xs: '55px', sm: '80px', md: '100px' },
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: { xs: 'auto', md: '100px' },
      }}
    >
      <Typography
        variant="h4"
        sx={{
          fontWeight: 700,
          mb: { xs: 0.25, md: 0.5 },
          fontFamily: 'monospace',
          background: isDark
            ? `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${alpha(theme.palette.primary.main, 0.8)} 100%)`
            : 'linear-gradient(135deg, #9333ea 0%, #7c3aed 50%, #6366f1 100%)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontSize: { xs: '1.5rem', sm: '2.5rem', md: '3rem' },
        }}
      >
        {value.toString().padStart(2, '0')}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 500,
          color: 'text.secondary',
          fontSize: { xs: '0.65rem', sm: '0.75rem', md: '0.875rem' },
        }}
      >
        {label}
      </Typography>
    </Paper>
  );

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 3,
        background: isDark
          ? `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.3)} 0%, ${alpha('#7c3aed', 0.2)} 50%, ${alpha('#ec4899', 0.15)} 100%)`
          : 'linear-gradient(135deg, #dbeafe 0%, #e9d5ff 50%, #fce7f3 100%)',
        border: '1px solid',
        borderColor: isDark
          ? alpha(theme.palette.primary.main, 0.15)
          : alpha(theme.palette.primary.main, 0.2),
        p: { xs: 2.5, sm: 4, md: 4 },
        mb: { xs: 1.5, md: 0 },
        height: { xs: 'auto', md: '100%' },
        minHeight: { xs: 'auto', md: '240px' },
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {/* Decorative circles */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 128,
          height: 128,
          backgroundColor: alpha(theme.palette.primary.main, isDark ? 0.15 : 0.3),
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'blur(40px)',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 160,
          height: 160,
          backgroundColor: alpha('#ec4899', isDark ? 0.15 : 0.3),
          borderRadius: '50%',
          transform: 'translate(50%, 50%)',
          filter: 'blur(40px)',
        }}
      />

      <Box sx={{ position: 'relative', textAlign: 'center' }}>
        {/* Title with sparkles */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: { xs: 0.75, md: 1 },
            mb: { xs: 2, md: 2.5 },
          }}
        >
          <Box
            sx={{
              animation: 'countdownPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              '@keyframes countdownPulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.5 },
              },
              color: alpha(theme.palette.primary.main, 0.7),
            }}
          >
            <AutoAwesomeIcon sx={{ fontSize: { xs: 20, md: 28 } }} />
          </Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700,
              color: 'text.primary',
              fontSize: { xs: '1.1rem', sm: '1.5rem', md: '1.75rem' },
            }}
          >
            ספירה לאחור לאירוע
          </Typography>
          <Box
            sx={{
              animation: 'countdownPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              color: alpha(theme.palette.primary.main, 0.7),
            }}
          >
            <AutoAwesomeIcon sx={{ fontSize: { xs: 20, md: 28 } }} />
          </Box>
        </Box>

        {/* Time boxes */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: { xs: 1, sm: 2, md: 2.5 },
            mb: { xs: 2, md: 2.5 },
          }}
        >
          <TimeBox value={timeLeft.days} label="ימים" />
          <TimeBox value={timeLeft.hours} label="שעות" />
          <TimeBox value={timeLeft.minutes} label="דקות" />
          <TimeBox value={timeLeft.seconds} label="שניות" />
        </Box>

        {/* Date and time info */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            flexWrap: 'wrap',
            bgcolor: alpha(theme.palette.primary.main, isDark ? 0.15 : 0.1),
            backdropFilter: 'blur(10px)',
            borderRadius: 3,
            py: 1.5,
            px: 3,
            fontSize: { xs: '0.875rem', sm: '1rem' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CalendarTodayIcon sx={{ fontSize: 16, color: theme.palette.primary.main }} />
            <Typography variant="body2" sx={{ color: 'text.primary' }}>
              {formatDate(targetDate)}
            </Typography>
          </Box>
          <Box
            sx={{
              width: '1px',
              height: 16,
              bgcolor: alpha(theme.palette.primary.main, 0.3),
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AccessTimeIcon sx={{ fontSize: 16, color: theme.palette.primary.main }} />
            <Typography variant="body2" sx={{ color: 'text.primary' }}>
              {formatTime(targetDate)}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

export default EventCountdown;