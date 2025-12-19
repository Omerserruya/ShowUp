import React from 'react';
import { Box, Paper, Typography, Chip, Stack, Button, useTheme, alpha } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';

export interface CampaignUpdate {
  id: string;
  title: string;
  description: string;
  sentLabel: string;
  readLabel?: string;
  repliedLabel?: string;
  sentCount: number;
  readCount?: number;
  repliedCount?: number;
  timeAgo: string;
  type: 'primary' | 'reminder' | 'info';
}

interface CampaignUpdatesProps {
  items?: CampaignUpdate[];
}

const defaultItems: CampaignUpdate[] = [
  {
    id: '1',
    title: 'הזמנה ראשונית נשלחה',
    description: 'הזמנה נשלחה ל‑357 אורחים דרך WhatsApp',
    sentLabel: 'נשלח',
    readLabel: 'נקרא',
    sentCount: 357,
    readCount: 312,
    repliedLabel: 'אישרו',
    repliedCount: 120,
    timeAgo: 'לפני 3 ימים',
    type: 'primary',
  },
  {
    id: '2',
    title: 'תזכורת ראשונה',
    description: 'תזכורת נשלחה ל‑67 אורחים שלא ענו',
    sentLabel: 'נשלח',
    readLabel: 'נקרא',
    sentCount: 67,
    readCount: 23,
    repliedLabel: 'אישרו',
    repliedCount: 18,
    timeAgo: 'לפני 6 ימים',
    type: 'reminder',
  },
  {
    id: '3',
    title: 'עדכון פרטי מקום',
    description: 'פרטי מיקום ושעה נשלחו לכל המאושרים',
    sentLabel: 'נשלח',
    readLabel: 'נקרא',
    sentCount: 248,
    readCount: 180,
    timeAgo: 'לפני 10 ימים',
    type: 'info',
  },
];

const getTypeStyles = (theme: any) => ({
  primary: {
    bg: theme.palette.mode === 'dark' 
      ? alpha(theme.palette.secondary.main, 0.2)
      : 'rgba(233, 213, 255, 0.5)',
    iconBg: '#a855f7',
    icon: <WhatsAppIcon />,
  },
  reminder: {
    bg: theme.palette.mode === 'dark' 
      ? alpha(theme.palette.success.main, 0.2)
      : 'rgba(187, 247, 208, 0.6)',
    iconBg: '#22c55e',
    icon: <NotificationsActiveIcon />,
  },
  info: {
    bg: theme.palette.mode === 'dark' 
      ? alpha(theme.palette.info.main, 0.2)
      : 'rgba(219, 234, 254, 0.7)',
    iconBg: '#2563eb',
    icon: <InfoOutlinedIcon />,
  },
});

const CampaignUpdates: React.FC<CampaignUpdatesProps> = ({ items = defaultItems }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const typeStyles = getTypeStyles(theme);

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        bgcolor: 'background.paper',
        borderRadius: '16px',
        border: '1px solid',
        borderColor: 'divider',
        height: '100%',
        direction: 'rtl',
        position: 'relative',
      }}
    >
      {/* View all button - top-left corner */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
        }}
      >
        <Button
          variant="text"
          size="small"
          onClick={() => navigate('/messages')}
          endIcon={
            <ArrowBackIcon
              sx={{ fontSize: 18 }}
            />
          }
          sx={{
            color: theme.palette.mode === 'dark' ? '#a78bfa' : '#7c3aed',
            fontWeight: 500,
            textTransform: 'none',
            '& .MuiButton-endIcon': {
              mr: 0,
              ml: 0.5,
            },
          }}
        >
          צפה בהכל
        </Button>
      </Box>

      <Typography
        variant="h5"
        component="h2"
        sx={{
          fontWeight: 600,
          color: 'text.primary',
          mb: 1,
          mr: 1,
          textAlign: 'right',
        }}
      >
        עדכוני קמפיינים
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          mb: 3,
          mr: 1,
          textAlign: 'right',
        }}
      >
        ההודעות האחרונות שנשלחו לאורחים
      </Typography>

      <Stack spacing={2.5}>
        {items.map((item) => {
          const style = typeStyles[item.type];
          return (
            <Box
              key={item.id}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row-reverse' },
                alignItems: 'stretch',
                bgcolor: style.bg,
                borderRadius: 3,
                p: { xs: 1.5, sm: 2 },
                gap: { xs: 1.5, sm: 2 },
                position: 'relative',
              }}
            >
              {/* Time ago - top left on mobile, right side on desktop */}
              <Box
                sx={{
                  minWidth: { xs: 'auto', sm: 96 },
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                  color: 'text.secondary',
                  fontSize: { xs: '0.75rem', sm: '0.875rem' },
                  pt: { xs: 0, sm: 1 },
                  textAlign: 'right',
                  flexShrink: 0,
                  order: { xs: 1, sm: 0 },
                }}
              >
                {item.timeAgo}
              </Box>

              {/* Main content area */}
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row-reverse' },
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  justifyContent: 'flex-end',
                  gap: { xs: 1.5, sm: 2 },
                  minWidth: 0,
                  order: { xs: 2, sm: 0 },
                }}
              >
                {/* Text content */}
                <Box 
                  sx={{ 
                    textAlign: 'right',
                    flex: 1,
                    minWidth: 0,
                    width: '100%',
                  }}
                >
                  <Typography
                    variant="subtitle1"
                    sx={{ 
                      fontWeight: 600, 
                      color: 'text.primary', 
                      mb: 0.5, 
                      textAlign: 'right',
                      fontSize: { xs: '0.875rem', sm: '1rem' },
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ 
                      color: 'text.secondary', 
                      textAlign: 'right',
                      fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    }}
                  >
                    {item.description}
                  </Typography>

                  {/* Stats row */}
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'row-reverse',
                      alignItems: 'center',
                      gap: 1.5,
                      mt: 1.5,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Chip
                      label={`${item.sentLabel} ${item.sentCount}`}
                      size="small"
                      sx={{
                        bgcolor: theme.palette.mode === 'dark' 
                          ? alpha(theme.palette.primary.main, 0.15)
                          : 'rgba(59,130,246,0.06)',
                        color: theme.palette.mode === 'dark' 
                          ? theme.palette.primary.light
                          : '#2563eb',
                        fontSize: { xs: '0.7rem', sm: '0.75rem' },
                        height: { xs: 24, sm: 28 },
                      }}
                    />
                    {item.readLabel && item.readCount !== undefined && (
                      <Chip
                        label={`${item.readLabel} ${item.readCount}`}
                        size="small"
                        sx={{
                          bgcolor: theme.palette.mode === 'dark' 
                            ? alpha(theme.palette.info.main, 0.15)
                            : 'rgba(37,99,235,0.06)',
                          color: theme.palette.mode === 'dark' 
                            ? theme.palette.info.light
                            : '#1d4ed8',
                          fontSize: { xs: '0.7rem', sm: '0.75rem' },
                          height: { xs: 24, sm: 28 },
                        }}
                      />
                    )}
                    {item.repliedLabel && item.repliedCount !== undefined && (
                      <Chip
                        label={`${item.repliedLabel} ${item.repliedCount}`}
                        size="small"
                        sx={{
                          bgcolor: theme.palette.mode === 'dark' 
                            ? alpha(theme.palette.success.main, 0.15)
                            : 'rgba(34,197,94,0.08)',
                          color: theme.palette.mode === 'dark' 
                            ? theme.palette.success.light
                            : '#16a34a',
                          fontSize: { xs: '0.7rem', sm: '0.75rem' },
                          height: { xs: 24, sm: 28 },
                        }}
                      />
                    )}
                  </Box>
                </Box>

                {/* Icon - top right on mobile, right side on desktop */}
                <Box
                  sx={{
                    width: { xs: 36, sm: 40 },
                    height: { xs: 36, sm: 40 },
                    borderRadius: '999px',
                    bgcolor: style.iconBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    flexShrink: 0,
                    flexGrow: 0,
                    alignSelf: { xs: 'flex-end', sm: 'center' },
                    order: { xs: 0, sm: 0 },
                    position: { xs: 'absolute', sm: 'static' },
                    top: { xs: 12, sm: 'auto' },
                    left: { xs: 12, sm: 'auto' },
                  }}
                >
                  {style.icon}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
};

export default CampaignUpdates;


