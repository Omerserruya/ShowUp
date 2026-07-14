export type FlowStage = 'invitation' | 'reminder' | 'final_reminder' | 'thank_you';

export interface CampaignSchedule {
  enabled: boolean;
  label: string; // canonical flow stage / legacy campaign label
  offsetDays: number; // effective offset: >0 days before, <0 days after, 0 day-of
  time: string;
  // --- Adaptive-timeline metadata (set by the scheduling engine) ---
  stage?: FlowStage;
  title?: string; // user-facing display name (defaults to label)
  optional?: boolean;
  priority?: number; // lower = more important; higher numbers dropped first when compressing
  scheduledAt?: string; // ISO-UTC resolved send time once the event date is known
  note?: string; // e.g. "הוקדם בשל מועד קרוב" when the timeline was compressed
}

/**
 * הגדרת קמפיינים לכל חבילה
 * כל חבילה יכולה להגדיר את הקמפיינים שלה
 */

export const basicCampaigns: CampaignSchedule[] = [
  { enabled: true, label: 'תזכורת שבוע לפני', offsetDays: 7, time: '12:00' },
  { enabled: true, label: 'תזכורת יום לפני', offsetDays: 1, time: '18:00' },
];

export const plusCampaigns: CampaignSchedule[] = [
  { enabled: true, label: 'Save the date', offsetDays: 30, time: '10:00' },
  { enabled: true, label: 'תזכורת שבוע לפני', offsetDays: 7, time: '12:00' },
  { enabled: true, label: 'תזכורת יום לפני', offsetDays: 1, time: '18:00' },
  { enabled: false, label: 'תודה אחרי האירוע', offsetDays: -1, time: '11:00' },
];

export const proCampaigns: CampaignSchedule[] = [
  { enabled: true, label: 'Save the date', offsetDays: 30, time: '10:00' },
  { enabled: true, label: 'תזכורת שבוע לפני', offsetDays: 7, time: '12:00' },
  { enabled: true, label: 'תזכורת יום לפני', offsetDays: 1, time: '18:00' },
  { enabled: true, label: 'תודה אחרי האירוע', offsetDays: -1, time: '11:00' },
];

/**
 * מפה של חבילות לקמפיינים שלהן
 */
export const planCampaignsMap: Record<string, CampaignSchedule[]> = {
  basic: basicCampaigns,
  plus: plusCampaigns,
  pro: proCampaigns,
};

