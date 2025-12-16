import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

type CampaignStatus = 'completed' | 'upcoming';

export interface CampaignTimelineItem {
  id: string;
  dateLabel: string;
  title: string;
  status: CampaignStatus;
}

interface CampaignTimelineProps {
  items?: CampaignTimelineItem[];
}

const defaultItems: CampaignTimelineItem[] = [
  {
    id: '1',
    dateLabel: 'לפני 10 ימים',
    title: 'הודעת \"שמרו את התאריך\" נשלחה',
    status: 'completed',
  },
  {
    id: '2',
    dateLabel: 'לפני 6 ימים',
    title: 'הזמנה ראשונית נשלחה',
    status: 'completed',
  },
  {
    id: '3',
    dateLabel: 'בעוד 3 ימים',
    title: 'תזכורת ראשונה תישלח',
    status: 'upcoming',
  },
  {
    id: '4',
    dateLabel: 'ביום האירוע',
    title: 'הודעת תודה מתוכננת',
    status: 'upcoming',
  },
];

const CampaignTimeline: React.FC<CampaignTimelineProps> = ({ items = defaultItems }) => {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        bgcolor: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e5e7eb',
        height: '100%',
        direction: 'rtl',
      }}
    >
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
        ציר זמן קמפיינים
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
        סטטוס שליחת ההודעות לאורך הזמן
      </Typography>

      <Box
        sx={{
          position: 'relative',
          mt: 0.5,
        }}
      >
        {/* Vertical line */}
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            right: 5, // separate from cards; dedicated gutter for line + dots
            width: 2,
            bgcolor: '#e5e7eb',
          }}
        />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((item, index) => {
            const isCompleted = item.status === 'completed';
            const dotColor = isCompleted ? '#22c55e' : '#9ca3af';
            const bgColor = isCompleted ? 'rgba(34,197,94,0.05)' : 'rgba(148,163,184,0.04)';
            const borderColor = isCompleted ? 'rgba(34,197,94,0.35)' : 'rgba(148,163,184,0.6)';
             const statusLabel = isCompleted ? 'הושלם' : 'מתוכנן';
             const statusBg = isCompleted ? 'rgba(34,197,94,0.12)' : 'rgba(234,179,8,0.16)';
             const statusColor = isCompleted ? '#16a34a' : '#b45309';

            return (
              <Box
                key={item.id}
                sx={{
                  display: 'flex',
                  flexDirection: 'row-reverse',
                  alignItems: 'stretch',
                  gap: 1.5,
                  position: 'relative',
                }}
              >
                {/* Dot aligned on the vertical line */}
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    bgcolor: dotColor,
                    position: 'absolute',
                    right:0, // center on the line (line right=16, radius=6)
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                />

                {/* Content */}
                <Box
                  sx={{
                    flex: 1,
                    mr: 3, // smaller gutter so cards are closer to the line
                    pr: 2.75,
                    pl: 1.5,
                    py: 1.5,
                    bgcolor: bgColor,
                    borderRadius: 2,
                    border: `1px solid ${borderColor}`,
                    boxShadow: '0 4px 14px rgba(15,23,42,0.04)',
                    textAlign: 'right',
                  }}
                >
                  {/* Top row: date + status pill */}
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'row-reverse',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 0.5,
                      gap: 1.5,
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        color: '#6b7280',
                        fontSize: '0.875rem',
                      }}
                    >
                      {item.dateLabel}
                    </Typography>
                    <Box
                      sx={{
                        px: 1.25,
                        py: 0.25,
                        borderRadius: 999,
                        bgcolor: statusBg,
                        color: statusColor,
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        minWidth: 64,
                        textAlign: 'center',
                      }}
                    >
                      {statusLabel}
                    </Box>
                  </Box>

                  <Typography
                    variant="body1"
                    sx={{
                      fontWeight: 500,
                      color: '#111827',
                      fontSize: '0.95rem',
                    }}
                  >
                    {item.title}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
};

export default CampaignTimeline;


