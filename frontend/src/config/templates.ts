/**
 * הגדרת תבניות הודעות לכל קמפיין
 * כל תבנית תומכת במשתנים דינמיים בפורמט {{משתנה}}
 */

export interface MessageTemplate {
  id: string;
  campaignLabel: string; // איזה קמפיין התבנית שייכת אליו
  title: string;
  body: string;
  cta?: {
    text: string;
    link?: string;
  };
  buttons?: Array<{
    id: string;
    text: string;
    type?: 'url' | 'quick_reply';
  }>;
  variables?: string[]; // רשימת משתנים שהתבנית משתמשת בהם
}

/**
 * משתנים זמינים:
 * - {{שם}} - שם האורח
 * - {{שם_מזמין}} - שם המזמין (מהאירוע)
 * - {{סוג_אירוע}} - סוג האירוע (חתונה, בר מצווה וכו')
 * - {{תאריך}} - תאריך האירוע
 * - {{שעה}} - שעת האירוע
 * - {{מיקום}} - מיקום האירוע
 * - {{שם_אירוע}} - שם האירוע
 */

export const templates: MessageTemplate[] = [
  // Save the date templates
  {
    id: 'save_date_1',
    campaignLabel: 'Save the date',
    title: 'שמור את התאריך! 📅',
    body: 'שלום {{שם}},\n\nאנחנו שמחים להזמין אותך ל{{סוג_אירוע}} של {{שם_מזמין}}.\n\n📅 תאריך: {{תאריך}}\n🕐 שעה: {{שעה}}\n📍 מיקום: {{מיקום}}\n\nנשמח לראותך!',
    variables: ['שם', 'סוג_אירוע', 'שם_מזמין', 'תאריך', 'שעה', 'מיקום'],
    buttons: [
      { id: 'view_details', text: 'צפה בפרטים', type: 'url' },
      { id: 'confirm', text: 'אשר הגעה', type: 'quick_reply' },
    ],
  },
  {
    id: 'save_date_2',
    campaignLabel: 'Save the date',
    title: '{{שם_אירוע}}',
    body: 'שלום {{שם}},\n\n{{שם_מזמין}} מזמינים אותך ל{{סוג_אירוע}}.\n\n{{תאריך}} בשעה {{שעה}}\n{{מיקום}}\n\nנשמח לראותך!',
    variables: ['שם', 'שם_אירוע', 'שם_מזמין', 'סוג_אירוע', 'תאריך', 'שעה', 'מיקום'],
  },
  
  // תזכורת שבוע לפני templates
  {
    id: 'reminder_week_1',
    campaignLabel: 'תזכורת שבוע לפני',
    title: 'תזכורת: {{שם_אירוע}}',
    body: 'שלום {{שם}},\n\nזו תזכורת ש{{סוג_אירוע}} של {{שם_מזמין}} יתקיים בעוד שבוע.\n\n📅 {{תאריך}} בשעה {{שעה}}\n📍 {{מיקום}}\n\nמצפים לראותך!',
    variables: ['שם', 'שם_אירוע', 'סוג_אירוע', 'שם_מזמין', 'תאריך', 'שעה', 'מיקום'],
  },
  {
    id: 'reminder_week_2',
    campaignLabel: 'תזכורת שבוע לפני',
    title: 'תזכורת שבוע לפני',
    body: 'שלום {{שם}},\n\n{{שם_אירוע}} מתקרב! האירוע יתקיים ב{{תאריך}} בשעה {{שעה}} ב{{מיקום}}.\n\nנשמח לראותך שם!',
    variables: ['שם', 'שם_אירוע', 'תאריך', 'שעה', 'מיקום'],
    buttons: [
      { id: 'view_location', text: 'צפה במיקום', type: 'url' },
    ],
  },
  
  // תזכורת יום לפני templates
  {
    id: 'reminder_day_1',
    campaignLabel: 'תזכורת יום לפני',
    title: 'מחר: {{שם_אירוע}}',
    body: 'שלום {{שם}},\n\nתזכורת אחרונה: מחר {{תאריך}} בשעה {{שעה}} יתקיים {{סוג_אירוע}} של {{שם_מזמין}} ב{{מיקום}}.\n\nמצפים לראותך!',
    variables: ['שם', 'שם_אירוע', 'תאריך', 'שעה', 'סוג_אירוע', 'שם_מזמין', 'מיקום'],
  },
  {
    id: 'reminder_day_2',
    campaignLabel: 'תזכורת יום לפני',
    title: 'תזכורת: מחר האירוע!',
    body: 'שלום {{שם}},\n\n{{שם_אירוע}} מחר ב{{תאריך}} בשעה {{שעה}}.\nמיקום: {{מיקום}}\n\nלא לשכוח! 😊',
    variables: ['שם', 'שם_אירוע', 'תאריך', 'שעה', 'מיקום'],
    buttons: [
      { id: 'confirm', text: 'אשר הגעה', type: 'quick_reply' },
      { id: 'cancel', text: 'לא אוכל להגיע', type: 'quick_reply' },
    ],
  },
  
  // תודה אחרי האירוע templates
  {
    id: 'thank_you_1',
    campaignLabel: 'תודה אחרי האירוע',
    title: 'תודה שהגעת! 🙏',
    body: 'שלום {{שם}},\n\nתודה רבה שהגעת ל{{סוג_אירוע}} של {{שם_מזמין}}.\n\nהנוכחות שלך הייתה משמעותית עבורנו ואנחנו מעריכים את זה מאוד.\n\nתודה רבה!',
    variables: ['שם', 'סוג_אירוע', 'שם_מזמין'],
  },
  {
    id: 'thank_you_2',
    campaignLabel: 'תודה אחרי האירוע',
    title: 'תודה!',
    body: 'שלום {{שם}},\n\nתודה שהגעת ל{{שם_אירוע}}.\n\nשמחנו לראותך ואנחנו מעריכים את הנוכחות שלך.\n\nתודה רבה!',
    variables: ['שם', 'שם_אירוע'],
  },
];

/**
 * קבלת תבניות לפי קמפיין
 */
export const getTemplatesByCampaign = (campaignLabel: string): MessageTemplate[] => {
  return templates.filter(t => t.campaignLabel === campaignLabel);
};

/**
 * עיבוד משתנים בתבנית
 */
export const processTemplate = (
  template: MessageTemplate,
  variables: Record<string, string>
): string => {
  let processed = template.body;
  
  // החלפת כל המשתנים
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`;
    processed = processed.replace(new RegExp(placeholder, 'g'), value || placeholder);
  });
  
  return processed;
};

