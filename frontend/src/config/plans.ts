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
  countLimit?: number | null; // Max guests allowed (null = unlimited)
};

export const plans: PlanTier[] = [
  {
    id: 'basic',
    title: 'Basic',
    subtitle: 'בשביל להתחיל בקטן',
    price: '₪39',
    description: 'עד 50 אורחים',
    features: [
      'שליחת הודעות בסיסיות בוואטסאפ',
      'מעקב תגובות בסיסי',
      'דשבורד תגובות',
    ],
    color: '#4CAF50',
    isPopular: false,
    countLimit: 50,
  },
  {
    id: 'plus',
    title: 'Plus',
    subtitle: 'הבחירה של רוב המארחים',
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
    countLimit: 250,
  },
  {
    id: 'pro',
    title: 'Pro',
    subtitle: 'כשרוצים את הכול',
    price: '₪199',
    description: 'ללא הגבלת אורחים',
    features: [
      'אוטומציות ותזכורות מתקדמות',
      'אינטגרציות עם Google Sheets / CRM',
      'תובנות חכמות על התגובות',
      'תיוגים והערות על אורחים',
      'תמיכה טלפונית',
    ],
    color: '#9C27B0',
    isPopular: false,
    countLimit: null,
  },
];

/**
 * פונקציה עזר לקבלת חבילה לפי מזהה
 */
export const getPlan = (planId: string | null | undefined): PlanTier | undefined => {
  if (!planId) return undefined;
  return plans.find((p) => p.id === planId);
};

/**
 * פונקציה עזר לקבלת קמפיינים של חבילה
 */
export const getCampaignsForPlan = (planId: string | null | undefined): CampaignSchedule[] => {
  if (!planId) return [];
  return planCampaignsMap[planId] || [];
};

