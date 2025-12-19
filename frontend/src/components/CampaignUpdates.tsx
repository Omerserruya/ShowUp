import React from 'react';
import { Box, Paper, Typography, Chip, Stack, Button } from '@mui/material';
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

const typeStyles = {
  primary: {
    bg: 'rgba(233, 213, 255, 0.5)',
    iconBg: '#a855f7',
    icon: <WhatsAppIcon />,
  },
  reminder: {
    bg: 'rgba(187, 247, 208, 0.6)',
    iconBg: '#22c55e',
    icon: <NotificationsActiveIcon />,
  },
  info: {
    bg: 'rgba(219, 234, 254, 0.7)',
    iconBg: '#2563eb',
    icon: <InfoOutlinedIcon />,
  },
} as const;

const CampaignUpdates: React.FC<CampaignUpdatesProps> = ({ items = defaultItems }) => {
  const navigate = useNavigate();

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        bgcolor: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e5e7eb',
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
            color: '#7c3aed',
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
          color: '#111827',
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
                  color: '#6b7280',
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
                      color: '#111827', 
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
                      color: '#4b5563', 
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
                        bgcolor: 'rgba(59,130,246,0.06)',
                        color: '#2563eb',
                        fontSize: { xs: '0.7rem', sm: '0.75rem' },
                        height: { xs: 24, sm: 28 },
                      }}
                    />
                    {item.readLabel && item.readCount !== undefined && (
                      <Chip
                        label={`${item.readLabel} ${item.readCount}`}
                        size="small"
                        sx={{
                          bgcolor: 'rgba(37,99,235,0.06)',
                          color: '#1d4ed8',
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
                          bgcolor: 'rgba(34,197,94,0.08)',
                          color: '#16a34a',
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


