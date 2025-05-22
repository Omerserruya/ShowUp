// Types
export interface MessageTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  placeholders: string[];
  category: 'reminder' | 'thank_you' | 'update' | 'custom';
}

export interface MessageHistory {
  id: string;
  templateId: string;
  templateName: string;
  recipients: number;
  status: 'sent' | 'scheduled' | 'failed';
  sendDate: Date;
  scheduledDate?: Date;
}

// Mock data
export const mockTemplates: MessageTemplate[] = [
  {
    id: '1',
    name: 'תזכורת לאירוע',
    description: 'שליחת תזכורת לאורחים שהאשרו הגעה',
    content: 'שלום {{name}},\n\nזו תזכורת שהאירוע {{eventName}} יתקיים ב-{{eventDate}}.\n\nמיקום: {{location}}\n\nנשמח לראותכם!\n\n{{rsvpLink}}',
    placeholders: ['name', 'eventName', 'eventDate', 'location', 'rsvpLink'],
    category: 'reminder'
  },
  {
    id: '2',
    name: 'תודה על האישור',
    description: 'שליחת הודעת תודה לאורחים שהאשרו הגעה',
    content: 'שלום {{name}},\n\nתודה על אישור ההגעה לאירוע {{eventName}}.\n\nנשמח לראותכם ב-{{eventDate}}!\n\n{{eventDetails}}',
    placeholders: ['name', 'eventName', 'eventDate', 'eventDetails'],
    category: 'thank_you'
  },
  {
    id: '3',
    name: 'עדכון מיקום',
    description: 'שליחת עדכון מיקום לאורחים',
    content: 'שלום {{name}},\n\nחשוב: המיקום של האירוע {{eventName}} השתנה.\n\nהמיקום החדש: {{newLocation}}\n\n{{mapLink}}',
    placeholders: ['name', 'eventName', 'newLocation', 'mapLink'],
    category: 'update'
  }
];

export const mockHistory: MessageHistory[] = [
  {
    id: '1',
    templateId: '1',
    templateName: 'תזכורת לאירוע',
    recipients: 45,
    status: 'sent',
    sendDate: new Date('2024-03-15T10:00:00'),
  },
  {
    id: '2',
    templateId: '2',
    templateName: 'תודה על האישור',
    recipients: 30,
    status: 'scheduled',
    sendDate: new Date('2024-03-16T15:00:00'),
    scheduledDate: new Date('2024-03-17T10:00:00'),
  },
]; 