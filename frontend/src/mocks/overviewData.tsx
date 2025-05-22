import React from 'react';
import {
  Email as EmailIcon,
  MarkEmailRead as MarkEmailReadIcon,
  Campaign as CampaignIcon,
  Favorite as FavoriteIcon,
} from '@mui/icons-material';

export interface EventTimelineItem {
  title: string;
  date: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

export interface MessageStats {
  total: number;
  sent: number;
  pending: number;
  failed: number;
}

// Mock data
export const mockTimeline: EventTimelineItem[] = [
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

export const mockMessageStats: MessageStats = {
  total: 150,
  sent: 120,
  pending: 30,
  failed: 0
}; 