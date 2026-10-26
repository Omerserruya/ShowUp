/**
 * "שאלות לאורחים" (e.g. shuttle) - types, limits and client-side validation.
 * Mirrors core-service routers/custom_fields.py validate_question: a question
 * is an ENUM event field with ask_in_rsvp, 2..10 options; WhatsApp limits the
 * option length to 20 chars as buttons (<=3 options) / 24 as a list (4..10).
 */
export interface QuestionField {
  id: string;
  event_id: string;
  key: string;
  label: string;
  data_type: string;
  options: string[] | null;
  required: boolean;
  applies_to_template: boolean;
  ask_in_rsvp: boolean;
  sort_order: number;
}

export interface ResultGuest { id: string; name: string; phone_masked: string; people: number }
export interface ResultOption { label: string; count: number; people: number; guests: ResultGuest[]; archived?: boolean }
export interface QuestionResults {
  field: QuestionField;
  options: ResultOption[];
  unanswered_confirmed: ResultGuest[];
  total_answered: number;
}

export const Q_MIN_OPTIONS = 2;
export const Q_MAX_OPTIONS = 10;
export const Q_LABEL_MAX = 100;

/** Max characters per option for a given option count (WhatsApp limits). */
export const optionLimit = (count: number) => (count <= 3 ? 20 : 24);

export const SHUTTLE_PRESET = { label: 'צריכים הסעה לאירוע?', options: ['כן, אשמח', 'לא, תודה'] };
export const SHUTTLE_CITY_PRESET = { label: 'מאיזו עיר תצטרפו להסעה?', options: ['תל אביב', 'ירושלים', 'חיפה', 'לא צריך הסעה'] };

/** Friendly Hebrew error, or null when valid. */
export function validateQuestion(label: string, options: string[]): string | null {
  const l = label.trim();
  if (!l) return 'צריך לכתוב את השאלה';
  if (l.length > Q_LABEL_MAX) return `השאלה ארוכה מדי - עד ${Q_LABEL_MAX} תווים`;
  const opts = options.map((o) => o.trim());
  if (opts.some((o) => !o)) return 'אחת התשובות ריקה - כתבו אותה או מחקו אותה';
  if (opts.length < Q_MIN_OPTIONS) return 'צריך לפחות 2 תשובות אפשריות';
  if (opts.length > Q_MAX_OPTIONS) return 'אפשר עד 10 תשובות';
  if (new Set(opts).size !== opts.length) return 'יש תשובה שמופיעה פעמיים';
  const lim = optionLimit(opts.length);
  const long = opts.find((o) => o.length > lim);
  if (long) {
    return opts.length <= 3
      ? `התשובה "${long}" ארוכה מדי - עד ${lim} תווים כשיש עד 3 תשובות (כך הן מופיעות ככפתורים בוואטסאפ)`
      : `התשובה "${long}" ארוכה מדי - עד ${lim} תווים (מגבלה של וואטסאפ)`;
  }
  return null;
}

export const isGuestQuestion = (f: QuestionField) => f.data_type === 'enum';

/** Read the API's error detail (string or {message}) for display. */
export async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const b = await res.json();
    if (typeof b?.detail === 'string') return b.detail;
    if (b?.detail?.message) return b.detail.message;
  } catch { /* not json */ }
  return fallback;
}
