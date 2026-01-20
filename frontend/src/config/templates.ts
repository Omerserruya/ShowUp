/**
 * הגדרת תבניות הודעות לכל קמפיין
 * כל תבנית תומכת במשתנים דינמיים בפורמט {{משתנה}}
 */

export interface MessageTemplate {
  id: string;
  campaignLabel: string; // איזה קמפיין התבנית שייכת אליו
  name: string; // שם התבנית לתצוגה (לא קשור לתוכן)
  title: string; // כותרת ההודעה (מוצגת בתוך הבועה)
  body: string;
  isDefault?: boolean; // האם זו התבנית הדיפולטית לקמפיין הזה
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
  // RSVP template without picture (event_no_pic)
  {
    id: 'event_no_pic',
    campaignLabel: 'RSVP',
    name: 'הזמנת RSVP ללא תמונה',
    title: '{{שם_אירוע}}',
    body:
      'שלום {{שם}},\n\n' +
      'נשמח לראותך ב{{סוג_אירוע}} של {{שם_מזמין}}.\n\n' +
      '📅 תאריך: {{תאריך}}\n' +
      '🕒 שעה: {{שעה}}\n' +
      '📍 מיקום: {{מיקום}}\n\n' +
      'נשמח לאישור הגעה שלך.',
    isDefault: true,
    variables: ['שם', 'שם_אירוע', 'סוג_אירוע', 'שם_מזמין', 'תאריך', 'שעה', 'מיקום'],
    buttons: [
      { id: 'rsvp_yes', text: 'אשר הגעה', type: 'quick_reply' },
      { id: 'rsvp_no', text: 'לא אוכל להגיע', type: 'quick_reply' },
    ],
  },

  // RSVP template with picture (general_rsvp)
  {
    id: 'general_rsvp',
    campaignLabel: 'RSVP',
    name: 'הזמנת RSVP עם תמונה',
    title: '{{שם_אירוע}}',
    body:
      'שלום {{שם}},\n\n' +
      '{{שם_מזמין}} מזמינים אותך ל{{סוג_אירוע}}.\n\n' +
      '📅 {{תאריך}} בשעה {{שעה}}\n' +
      '📍 {{מיקום}}\n\n' +
      'נשמח לראותך!',
    variables: ['שם', 'שם_אירוע', 'שם_מזמין', 'סוג_אירוע', 'תאריך', 'שעה', 'מיקום'],
    buttons: [
      { id: 'rsvp_yes', text: 'אשר הגעה', type: 'quick_reply' },
      { id: 'rsvp_no', text: 'לא אוכל להגיע', type: 'quick_reply' },
    ],
  },

  // Reminder template (reminder) - used לקמפיינים של "תזכורת" למי שלא הגיב
  {
    id: 'reminder',
    campaignLabel: 'nudge_reminder',
    name: 'תזכורת למי שעדיין לא אישר',
    title: 'רק תזכורת קטנה 😊',
    body:
      'שלום {{שם}},\n\n' +
      'רק רצינו להזכיר בעדינות את {{סוג_אירוע}} של {{שם_מזמין}}.\n\n' +
      'אם עדיין לא הספקת לאשר – נשמח מאוד לעדכון קצר 🙏',
    isDefault: true,
    variables: ['שם', 'סוג_אירוע', 'שם_מזמין'],
  },

  // Event reminder template (event_remind) - תזכורת קרובה עם פרטי שעה/מיקום
  {
    id: 'event_remind',
    campaignLabel: 'event_remind',
    name: 'תזכורת עם שעה ומיקום',
    title: 'נתראה בקרוב! 🎉',
    body:
      'שלום {{שם}},\n\n' +
      'תזכורת: היום {{שם_אירוע}} בשעה {{שעה}}.\n' +
      '📍 מיקום: {{מיקום}}\n\n' +
      'מצפים לראותך! אם אתה צריך ניווט, לחץ על הכפתור בתחתית ההודעה.',
    variables: ['שם', 'שם_אירוע', 'שעה', 'מיקום'],
    isDefault: true,
    buttons: [
      { id: 'open_waze', text: 'פתח ב-Waze', type: 'url' },
    ],
  },

  // Table info template (table_info) - מידע על מספר שולחן
  {
    id: 'table_info',
    campaignLabel: 'מידע שולחנות',
    name: 'הודעה עם מספר שולחן',
    title: 'מספר השולחן שלך 🎉',
    body:
      'שלום {{שם}},\n\n' +
      'רק לעדכן שמספר השולחן שלך ב{{שם_אירוע}} הוא: {{מספר_שולחן}}.\n\n' +
      'מחכים לראותך!',
    variables: ['שם', 'שם_אירוע', 'מספר_שולחן'],
  },

  // Thank you template (thank_you) - תואם ל-template thank_you מה-backend
  {
    id: 'thank_you',
    campaignLabel: 'thank_you',
    name: 'תודה לפי תבנית ברירת מחדל',
    title: 'תודה שהיית חלק מהאירוע שלנו ❤️',
    body:
      'שלום {{שם}},\n\n' +
      'תודה גדולה שהיית חלק מ{{שם_אירוע}}.\n' +
      '{{שם_מזמין}} מעריכים מאוד את הנוכחות שלך ואת השמחה שהבאת איתך.\n\n' +
      'תודה מכל הלב!',
    variables: ['שם', 'שם_אירוע', 'שם_מזמין'],
  },
];

/**
 * קבלת תבניות לפי קמפיין
 */
export const getTemplatesByCampaign = (campaignLabel: string): MessageTemplate[] => {
  return templates.filter(t => t.campaignLabel === campaignLabel);
};

/**
 * קבלת התבנית הדיפולטית לקמפיין
 */
export const getDefaultTemplateForCampaign = (campaignLabel: string): MessageTemplate | undefined => {
  return templates.find(t => t.campaignLabel === campaignLabel && t.isDefault === true);
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

