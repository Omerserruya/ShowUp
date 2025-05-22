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
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import EmailIcon from '@mui/icons-material/Email';
import CampaignIcon from '@mui/icons-material/Campaign';
import FavoriteIcon from '@mui/icons-material/Favorite';

interface TimelineStep {
  title: string;
  date: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

interface EventTimelineProps {
  maxWidth?: string | number;
}

const EventTimeline: React.FC<EventTimelineProps> = ({ maxWidth = '100%' }) => {
  // Sample timeline steps data
  const timelineSteps: TimelineStep[] = [
    {
      title: "הודעה ראשונה",
      date: "01/07/2023",
      description: "שליחת הזמנה ראשונית לאירוע",
      icon: <EmailIcon fontSize="small" />,
      color: "#1976d2"
    },
    {
      title: "הודעה שניה",
      date: "15/07/2023",
      description: "תזכורת והשלמת פרטים נוספים",
      icon: <MarkEmailReadIcon fontSize="small" />,
      color: "#2e7d32"
    },
    {
      title: "איזכור על האירוע",
      date: "25/07/2023",
      description: "תזכורת אחרונה לפני האירוע",
      icon: <CampaignIcon fontSize="small" />,
      color: "#ed6c02"
    },
    {
      title: "הודעת תודה",
      date: "03/08/2023",
      description: "הודעת תודה לאחר האירוע",
      icon: <FavoriteIcon fontSize="small" />,
      color: "#d32f2f"
    }
  ];

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
        {timelineSteps.map((step, index) => (
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
                bgcolor: index === 0 ? 'transparent' : getPastelColor(timelineSteps[index-1].color),
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
                opacity: index === timelineSteps.length - 1 ? 0 : 0.8
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