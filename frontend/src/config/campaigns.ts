export interface CampaignSchedule {
  enabled: boolean;
  label: string;
  offsetDays: number;
  time: string;
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

