/**
 * הגדרת תבניות הודעות לכל קמפיין
 * כל תבנית תומכת במשתנים דינמיים בפורמט {{משתנה}}
 */

// --- Scalable template metadata ----------------------------------------------
// Templates are no longer hand-picked by the wizard. Each template carries
// metadata; the wizard fetches templates and filters them by metadata (event
// type, flow stage, visibility, language). This lets us add new PUBLIC templates
// — available to everyone — without touching frontend code, and lets PRIVATE
// templates (created for one customer's event) flow through the same pipeline.

export type TemplateFlowStage = 'invitation' | 'reminder' | 'final_reminder' | 'thank_you';
export type TemplateVisibility = 'public' | 'private';
export type TemplateStatus = 'active' | 'archived';
// Mirrors the backend WhatsApp template lifecycle (shared.domain.enums.TemplateState).
export type TemplateApprovalStatus = 'draft' | 'validated' | 'meta_pending' | 'approved' | 'active' | 'rejected';

export interface MessageTemplate {
  id: string;
  campaignLabel: string; // legacy lookup key — still used; maps 1:1 to a flow stage
  name: string; // שם התבנית לתצוגה (לא קשור לתוכן)
  title: string; // כותרת ההודעה (מוצגת בתוך הבועה)
  body: string;
  isDefault?: boolean; // האם זו התבנית הדיפולטית לקמפיין/שלב הזה
  // --- metadata (optional on literals; sensible defaults are derived) ---
  flowStage?: TemplateFlowStage; // defaults from campaignLabel
  eventTypes?: string[]; // event types this fits; empty/undefined = all types
  visibility?: TemplateVisibility; // default 'public'
  language?: string; // default 'he'
  status?: TemplateStatus; // default 'active'
  approvalStatus?: TemplateApprovalStatus; // default 'approved' for built-in public templates
  eventId?: string | null; // set for private, event-scoped templates
  expiresAt?: string | null; // private templates may expire after the event
  createdBy?: string | null;
  createdAt?: string | null;
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

// --- Variable picker catalog -------------------------------------------------
// The custom-message editor offers these as clickable chips (grouped), so users
// never type {{...}} by hand. Each key matches a placeholder resolved by the
// wizard's getTemplateVariables, so the live preview always renders real text.
export interface TemplateVar {
  key: string; // the placeholder name inside {{ }}
  label: string; // human-friendly label shown on the chip
}
export interface TemplateVarGroup {
  category: string;
  items: TemplateVar[];
}

const GUEST_VARS: TemplateVar[] = [
  { key: 'שם', label: 'שם האורח' },
  { key: 'קישור_אישור', label: 'קישור לאישור הגעה' },
  { key: 'כמות_אורחים', label: 'כמות מוזמנים' },
];

const EVENT_VARS: TemplateVar[] = [
  { key: 'שם_אירוע', label: 'שם האירוע' },
  { key: 'תאריך', label: 'תאריך' },
  { key: 'שעה', label: 'שעה' },
  { key: 'מיקום', label: 'מיקום' },
  { key: 'ניווט', label: 'קישור ניווט' },
  { key: 'דף_הזמנה', label: 'דף ההזמנה' },
];

function eventSpecificVars(eventType: string): TemplateVar[] {
  switch (eventType) {
    case 'wedding':
      return [
        { key: 'כלה', label: 'שם הכלה' },
        { key: 'חתן', label: 'שם החתן' },
        { key: 'בני_הזוג', label: 'בני הזוג' },
      ];
    case 'brit':
    case 'brita':
      return [
        { key: 'רך_נולד', label: 'שם הרך הנולד' },
        { key: 'אמא', label: 'שם האמא' },
        { key: 'אבא', label: 'שם האבא' },
        { key: 'הורים', label: 'ההורים' },
      ];
    case 'bar':
    case 'bat':
      return [
        { key: 'חוגג', label: 'שם החוגג/ת' },
        { key: 'הורים', label: 'ההורים' },
      ];
    case 'corporate':
      return [{ key: 'חברה', label: 'שם החברה' }];
    case 'birthday':
      return [{ key: 'חוגג', label: 'שם החוגג/ת' }];
    default:
      return [];
  }
}

/** Variable groups offered for an event type: Guest, Event, and Event-specific. */
export const getVariableGroups = (eventType: string): TemplateVarGroup[] => {
  const groups: TemplateVarGroup[] = [
    { category: '👤 אורח', items: GUEST_VARS },
    { category: '📅 אירוע', items: EVENT_VARS },
  ];
  const specific = eventSpecificVars(eventType);
  if (specific.length) groups.push({ category: '🎉 מותאם לאירוע', items: specific });
  return groups;
};

// Ready-made content blocks — reusable sections users drop in with one click,
// so they don't rewrite the same lines every time. The text uses {{...}} which
// the live preview + send resolve like any other variable.
export interface ContentBlock {
  key: string;
  emoji: string;
  label: string;
  text: string;
}

export const CONTENT_BLOCKS: ContentBlock[] = [
  { key: 'event_details', emoji: '📅', label: 'פרטי האירוע', text: '📅 {{תאריך}} בשעה {{שעה}}' },
  { key: 'location', emoji: '📍', label: 'מיקום', text: '📍 {{מיקום}}' },
  { key: 'rsvp_cta', emoji: '💬', label: 'קריאה לאישור', text: 'נשמח לראותכם! 🎉\nאישור הגעה כאן:\n{{קישור_אישור}}' },
  { key: 'nav', emoji: '🧭', label: 'ניווט', text: 'הגעה קלה עם Waze:\n{{ניווט}}' },
];

/**
 * WhatsApp/Meta template body rules. Meta rejects bodies that begin or end with a
 * variable, have two adjacent variables, or are made up of variables only. We
 * validate live so users can't build a template that would get rejected.
 * Returns a list of human-friendly issues (empty = valid).
 */
export const validateTemplateBodyMeta = (body: string): string[] => {
  const issues: string[] = [];
  const VAR_G = /\{\{\s*[^}]+?\s*\}\}/g;
  if (!body.trim()) {
    issues.push('ההודעה ריקה. כתבו את הטקסט לפני שמוסיפים שדות.');
    return issues;
  }
  if (/^\s*\{\{\s*[^}]+?\s*\}\}/.test(body)) {
    issues.push('הודעה לא יכולה להתחיל בשדה אישי. פתחו במילה (למשל "שלום") ואז הוסיפו את השדה.');
  }
  if (/\{\{\s*[^}]+?\s*\}\}\s*$/.test(body)) {
    issues.push('הודעה לא יכולה להסתיים בשדה אישי. הוסיפו טקסט אחרי השדה האחרון.');
  }
  if (/\}\}\s*\{\{/.test(body)) {
    issues.push('אי אפשר לשים שני שדות צמודים. הפרידו ביניהם בטקסט קצר.');
  }
  if (!body.replace(VAR_G, '').replace(/\s+/g, '')) {
    issues.push('ההודעה צריכה לכלול טקסט אמיתי, לא רק שדות אישיים.');
  }
  return issues;
};

// Each campaign label corresponds to a flow stage in the communication timeline.
export const STAGE_BY_LABEL: Record<string, TemplateFlowStage> = {
  'Save the date': 'invitation',
  'תזכורת שבוע לפני': 'reminder',
  'תזכורת יום לפני': 'final_reminder',
  'תודה אחרי האירוע': 'thank_you',
};

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

/**
 * שורת "סוד" לאירועי ברית/בריתה כשההורים בוחרים לשמור את שם הרך הנולד בסוד.
 * נשזרת בהזמנה (Save the date) בלבד, משפט אחד קליל ומכובד — בלי לחשוף שם.
 */
export const BRIT_SECRET_INVITE_LINE = 'השם יישאר בסוד עד הרגע הגדול 🤫';

export const templates: MessageTemplate[] = [
  // Save the date templates
  {
    id: 'save_date_1',
    campaignLabel: 'Save the date',
    name: 'תבנית שמור תאריך עם כפתורים',
    title: 'שמור את התאריך! 📅',
    body: 'שלום {{שם}},\n\nאנחנו שמחים להזמין אותך ל{{סוג_אירוע}} של {{שם_מזמין}}.\n\n📅 תאריך: {{תאריך}}\n🕐 שעה: {{שעה}}\n📍 מיקום: {{מיקום}}\n\nנשמח לראותך!',
    isDefault: true, // תבנית דיפולטית
    variables: ['שם', 'סוג_אירוע', 'שם_מזמין', 'תאריך', 'שעה', 'מיקום'],
    buttons: [
      { id: 'view_details', text: 'צפה בפרטים', type: 'url' },
      { id: 'confirm', text: 'אשר הגעה', type: 'quick_reply' },
    ],
  },
  {
    id: 'save_date_2',
    campaignLabel: 'Save the date',
    name: 'תבנית שמור תאריך פשוטה',
    title: '{{שם_אירוע}}',
    body: 'שלום {{שם}},\n\n{{שם_מזמין}} מזמינים אותך ל{{סוג_אירוע}}.\n\n{{תאריך}} בשעה {{שעה}}\n{{מיקום}}\n\nנשמח לראותך!',
    variables: ['שם', 'שם_אירוע', 'שם_מזמין', 'סוג_אירוע', 'תאריך', 'שעה', 'מיקום'],
  },
  
  // תזכורת שבוע לפני templates
  {
    id: 'reminder_week_1',
    campaignLabel: 'תזכורת שבוע לפני',
    name: 'תזכורת שבוע לפני - מפורטת',
    title: 'תזכורת: {{שם_אירוע}}',
    body: 'שלום {{שם}},\n\nזו תזכורת ש{{סוג_אירוע}} של {{שם_מזמין}} יתקיים בעוד שבוע.\n\n📅 {{תאריך}} בשעה {{שעה}}\n📍 {{מיקום}}\n\nמצפים לראותך!',
    isDefault: true, // תבנית דיפולטית
    variables: ['שם', 'שם_אירוע', 'סוג_אירוע', 'שם_מזמין', 'תאריך', 'שעה', 'מיקום'],
  },
  {
    id: 'reminder_week_2',
    campaignLabel: 'תזכורת שבוע לפני',
    name: 'תזכורת שבוע לפני - עם כפתור',
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
    name: 'תזכורת יום לפני - מפורטת',
    title: 'מחר: {{שם_אירוע}}',
    body: 'שלום {{שם}},\n\nתזכורת אחרונה: מחר {{תאריך}} בשעה {{שעה}} יתקיים {{סוג_אירוע}} של {{שם_מזמין}} ב{{מיקום}}.\n\nמצפים לראותך!',
    isDefault: true, // תבנית דיפולטית
    variables: ['שם', 'שם_אירוע', 'תאריך', 'שעה', 'סוג_אירוע', 'שם_מזמין', 'מיקום'],
  },
  {
    id: 'reminder_day_2',
    campaignLabel: 'תזכורת יום לפני',
    name: 'תזכורת יום לפני - עם כפתורים',
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
    name: 'תודה מפורטת',
    title: 'תודה שהגעת! 🙏',
    body: 'שלום {{שם}},\n\nתודה רבה שהגעת ל{{סוג_אירוע}} של {{שם_מזמין}}.\n\nהנוכחות שלך הייתה משמעותית עבורנו ואנחנו מעריכים את זה מאוד.\n\nתודה רבה!',
    isDefault: true, // תבנית דיפולטית
    variables: ['שם', 'סוג_אירוע', 'שם_מזמין'],
  },
  {
    id: 'thank_you_2',
    campaignLabel: 'תודה אחרי האירוע',
    name: 'תודה קצרה',
    title: 'תודה!',
    body: 'שלום {{שם}},\n\nתודה שהגעת ל{{שם_אירוע}}.\n\nשמחנו לראותך ואנחנו מעריכים את הנוכחות שלך.\n\nתודה רבה!',
    variables: ['שם', 'שם_אירוע'],
  },
];

/**
 * Fill in sensible metadata defaults for a template literal. Built-in templates
 * are public, Hebrew, active and pre-approved; their flow stage is derived from
 * the campaign label. Explicit fields on the literal always win.
 */
export const normalizeTemplate = (t: MessageTemplate): MessageTemplate => ({
  ...t,
  flowStage: t.flowStage || STAGE_BY_LABEL[t.campaignLabel],
  eventTypes: t.eventTypes || [],
  visibility: t.visibility || 'public',
  language: t.language || 'he',
  status: t.status || 'active',
  approvalStatus: t.approvalStatus || 'approved',
  eventId: t.eventId ?? null,
});

const USABLE_APPROVAL: TemplateApprovalStatus[] = ['approved', 'active'];

const notExpired = (t: MessageTemplate): boolean =>
  !t.expiresAt || new Date(t.expiresAt).getTime() > Date.now();

export interface TemplateQuery {
  eventType?: string; // match templates with no eventTypes (all) or that include this type
  flowStage?: TemplateFlowStage;
  campaignLabel?: string;
  language?: string; // default 'he'
  visibility?: TemplateVisibility; // omit to include both public + matching private
  eventId?: string | null; // include private templates scoped to this event
  includeUnapproved?: boolean; // include drafts/pending (e.g. the customer's own previews)
}

/**
 * The metadata-driven selector. The wizard uses this (over a fetched template
 * set) instead of hardcoding which templates to show: it filters by event type,
 * flow stage, language and visibility, and keeps only usable (approved, active,
 * unexpired) templates — plus, when an eventId is given, that event's private
 * templates.
 */
export const selectTemplates = (
  all: MessageTemplate[],
  query: TemplateQuery = {}
): MessageTemplate[] => {
  const lang = query.language || 'he';
  const stage = query.flowStage || (query.campaignLabel ? STAGE_BY_LABEL[query.campaignLabel] : undefined);
  return all
    .map(normalizeTemplate)
    .filter((t) => {
      if (t.status !== 'active') return false;
      if (t.language && t.language !== lang) return false;
      if (stage && t.flowStage !== stage) return false;
      if (query.campaignLabel && t.campaignLabel !== query.campaignLabel) return false;
      if (query.eventType && t.eventTypes && t.eventTypes.length > 0 && !t.eventTypes.includes(query.eventType)) return false;
      // Visibility: public templates are always candidates; private only for their event.
      if (t.visibility === 'private') {
        if (!query.eventId || t.eventId !== query.eventId) return false;
        if (!notExpired(t)) return false;
      } else if (query.visibility === 'private') {
        return false; // caller explicitly asked for private only
      }
      if (!query.includeUnapproved && t.approvalStatus && !USABLE_APPROVAL.includes(t.approvalStatus)) return false;
      return true;
    });
};

/**
 * קבלת תבניות לפי קמפיין (metadata-aware). Optionally narrows by event type so
 * type-specific templates surface only for their event type.
 */
export const getTemplatesByCampaign = (campaignLabel: string, eventType?: string): MessageTemplate[] => {
  return selectTemplates(templates, { campaignLabel, eventType });
};

/**
 * קבלת התבנית הדיפולטית לקמפיין — the marked default, else the first match.
 */
export const getDefaultTemplateForCampaign = (campaignLabel: string, eventType?: string): MessageTemplate | undefined => {
  const matches = getTemplatesByCampaign(campaignLabel, eventType);
  return matches.find((t) => t.isDefault === true) || matches[0];
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

