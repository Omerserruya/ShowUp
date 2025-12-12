import { planCampaignsMap, CampaignSchedule } from './campaigns';

export type PlanTier = {
  id: 'basic' | 'plus' | 'pro';
  title: string;
  subtitle: string;
  price: string;
  description: string;
  features: string[];
  color: string;
  isPopular?: boolean;
};

export const plans: PlanTier[] = [
  {
    id: 'basic',
    title: 'Basic',
    subtitle: 'בוא נתחיל',
    price: '₪39',
    description: 'עד 50 אורחים',
    features: [
      'שליחת הודעות בסיסיות בוואטסאפ',
      'מעקב תגובות בסיסי',
      'דשבורד תגובות',
    ],
    color: '#4CAF50',
    isPopular: false,
  },
  {
    id: 'plus',
    title: 'Plus',
    subtitle: 'אירוע בשליטה',
    price: '₪99',
    description: 'עד 250 אורחים',
    features: [
      'תזמון הודעות מתקדם',
      'תגובות מסווגות לפי תוכן',
      'ייבוא אנשי קשר מכל פורמט',
      'תמיכה בצ\'אט',
    ],
    color: '#2196F3',
    isPopular: true,
  },
  {
    id: 'pro',
    title: 'Pro',
    subtitle: 'הכול כלול',
    price: '₪199',
    description: 'ללא הגבלת אורחים',
    features: [
      'אוטומציות ותזכורות מתקדמות',
      'אינטגרציות עם Google Sheets / CRM',
      'ניתוחי בינה מלאכותית לתגובות',
      'תיוגים והערות על אורחים',
      'תמיכה טלפונית',
    ],
    color: '#9C27B0',
    isPopular: false,
  },
];

/**
 * פונקציה עזר לקבלת קמפיינים של חבילה
 */
export const getCampaignsForPlan = (planId: string): CampaignSchedule[] => {
  return planCampaignsMap[planId] || [];
};

