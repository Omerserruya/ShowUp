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

// Plans differ ONLY by guest capacity, included campaign rounds and phone-call
// rounds (basic 0 / plus 1 / pro 3, see shared/domain/voice_calls.py) - every plan
// includes the rest of the ShowUp experience (AI assistant, WhatsApp campaigns, contact
// import, invitation builder, seating, analytics and the rest).
export const plans: PlanTier[] = [
  {
    id: 'basic',
    title: 'Basic',
    subtitle: 'בשביל להתחיל בקטן',
    price: '₪39',
    description: 'עד 50 אורחים',
    features: [
      'עד 50 אורחים',
      '2 סבבי הודעות כלולים',
      'כל היכולות, חוץ משיחות טלפון',
    ],
    color: '#9D83E0',
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
      'עד 250 אורחים',
      '4 סבבי הודעות כלולים',
      'סבב שיחות טלפון אחד',
      'כל היכולות כלולות',
    ],
    color: '#5A3DA6',
    isPopular: true,
    countLimit: 250,
  },
  {
    id: 'pro',
    title: 'Pro',
    subtitle: 'לאירועים הכי גדולים',
    price: '₪199',
    description: 'ללא הגבלת אורחים',
    features: [
      'ללא הגבלת אורחים',
      '4 סבבי הודעות כלולים',
      'עד 3 סבבי שיחות טלפון',
      'כל היכולות כלולות',
    ],
    color: '#432C85',
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

