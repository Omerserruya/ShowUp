import {
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineOppositeContent,
  TimelineDot
} from '@mui/lab';
import { Typography, Box } from '@mui/material';
import { EventTimelineItem } from '../mocks/overviewData';

interface EventTimelineProps {
  maxWidth?: string | number;
  timeline: EventTimelineItem[];
}

const EventTimeline: React.FC<EventTimelineProps> = ({ maxWidth = '100%', timeline }) => {
  // Create softer pastel versions of the colors
  const getPastelColor = (hexColor: string) => {
    return `${hexColor}AA`; // Add alpha for softer appearance
  };

  return (
    <Box sx={{ width: '100%', maxWidth, mx: 'auto' }}>
      <Timeline 
        position="alternate"
        sx={{
          '& .MuiTimelineDot-root': {
            boxShadow: 'none',
            my: 1
          }
        }}
      >
        {timeline.map((step, index) => (
          <TimelineItem key={index}>
            <TimelineOppositeContent
              sx={{ 
                m: 'auto 0',
                fontSize: '0.775rem',
                color: 'text.secondary',
                opacity: 0.8
              }}
              align="right"
            >
              {step.date}
            </TimelineOppositeContent>
            
            <TimelineSeparator>
              <TimelineConnector sx={{ 
                bgcolor: index === 0 ? 'transparent' : getPastelColor(timeline[index-1].color),
                height: '14px'
              }} />
              <TimelineDot sx={{ 
                bgcolor: getPastelColor(step.color),
                p: 0.8,
                border: `1px solid ${step.color}20`
              }}>
                {step.icon}
              </TimelineDot>
              <TimelineConnector sx={{ 
                bgcolor: getPastelColor(step.color),
                height: '14px',
                opacity: index === timeline.length - 1 ? 0 : 0.8
              }} />
            </TimelineSeparator>
            
            <TimelineContent sx={{ m: 'auto 0', py: '12px', px: 2 }}>
              <Typography 
                variant="subtitle1" 
                component="span" 
                sx={{ 
                  fontWeight: 500, 
                  color: step.color,
                  opacity: 0.9,
                  display: 'block',
                  mb: 0.5,
                  fontSize: '0.95rem'
                }}
              >
                {step.title}
              </Typography>
              <Typography 
                variant="body2" 
                sx={{ 
                  color: 'text.secondary',
                  fontSize: '0.8rem',
                  opacity: 0.8
                }}
              >
                {step.description}
              </Typography>
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </Box>
  );
};

export default EventTimeline; 