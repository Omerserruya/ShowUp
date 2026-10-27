/** Hebrew copy for the flow builder: node types, inputs, conditions, actions. */
import type { ActionType, EdgeKind, EdgeWhen, FlowAction, FlowGraph, FlowMeta, InputType, NodeType, Stage } from './types';
import type { ChipTone } from '../../design/tokens';

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  template: 'תבנית',
  message: 'הודעה',
  question: 'שאלה',
  end: 'סיום',
};

export const NODE_TYPE_HINT: Record<NodeType, string> = {
  template: 'הודעת פתיחה שנשלחת כתבנית WhatsApp מאושרת (הזמנה / תזכורת).',
  message: 'הודעה רגילה שהבוט שולח בתוך השיחה.',
  question: 'הודעה שמחכה לתשובה מהאורח - כפתורים, רשימה, מספר או טקסט.',
  end: 'הודעת סיום. אחריה השיחה נסגרת.',
};

export const NODE_TYPE_ICON: Record<NodeType, string> = {
  template: 'mark_email_unread',
  message: 'chat',
  question: 'help',
  end: 'flag',
};

export const NODE_TYPE_TONE: Record<NodeType, ChipTone> = {
  template: 'lav',
  message: 'quiet',
  question: 'warn',
  end: 'ok',
};

export const INPUT_LABEL: Record<InputType, string> = {
  buttons: 'כפתורים (עד 3)',
  list: 'רשימת בחירה (עד 10)',
  number: 'מספר',
  text: 'טקסט חופשי',
  none: 'בלי תשובה',
};

export const STAGES: Stage[] = ['invitation', 'reminder', 'final_reminder', 'default'];

export const STAGE_LABEL: Record<string, string> = {
  invitation: 'הזמנה',
  reminder: 'תזכורת',
  final_reminder: 'תזכורת אחרונה',
  default: 'הודעה חופשית מאורח',
};

export const RSVP_LABEL: Record<string, string> = {
  confirmed: 'מגיעים',
  declined: 'לא מגיעים',
  maybe: 'אולי',
};

export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  button: 'לחיצה על כפתור',
  rsvp: 'זוהתה תשובת הגעה',
  number: 'ענו מספר',
  number_invalid: 'מספר לא תקין',
  text_contains: 'טקסט שמכיל מילים',
  any_text: 'כל טקסט',
  done: 'אחרי השאלות / בסיום',
  answered: 'ענו על שאלה של המארח',
};

export const ACTION_LABEL: Record<ActionType, string> = {
  set_rsvp: 'עדכון סטטוס הגעה',
  set_field: 'עדכון שדה של האורח',
  add_tag: 'הוספת תגית',
  notify_host: 'התראה לבעלי האירוע',
  stop_reminders: 'הפסקת תזכורות',
};

export const ACTION_ICON: Record<ActionType, string> = {
  set_rsvp: 'how_to_reg',
  set_field: 'edit_note',
  add_tag: 'sell',
  notify_host: 'notifications',
  stop_reminders: 'notifications_off',
};

export const EVENT_TYPES: { value: string; label: string }[] = [
  { value: 'wedding', label: 'חתונה' },
  { value: 'bar', label: 'בר מצווה' },
  { value: 'bat', label: 'בת מצווה' },
  { value: 'brit', label: 'ברית' },
  { value: 'brita', label: 'בריתה' },
  { value: 'birthday', label: 'יום הולדת' },
  { value: 'corporate', label: 'אירוע חברה' },
  { value: 'other', label: 'אחר' },
];

export const DEFAULT_FIELDS = [
  { value: 'guest_count', label: 'מספר מגיעים' },
  { value: 'notes', label: 'הערות' },
];

export const DEFAULT_VARIABLES = [
  { key: 'guest_name', label: 'שם האורח' },
  { key: 'event_name', label: 'שם האירוע' },
  { key: 'event_date', label: 'תאריך' },
  { key: 'venue_name', label: 'מקום' },
];

export const LIMITS = { buttons: 3, buttonLabel: 20, listItems: 10, listLabel: 24 };

const quote = (s: string) => `'${s}'`;

/** Human condition label, e.g. "לחצו 'ברור שאגיע!'". */
export function whenLabel(when: EdgeWhen, graph: FlowGraph, fromId: string): string {
  switch (when.kind) {
    case 'button': {
      const node = graph.nodes.find((n) => n.id === fromId);
      const b = node?.buttons.find((x) => x.id === when.button_id);
      const verb = node?.input === 'list' ? 'בחרו' : 'לחצו';
      return b ? `${verb} ${quote(b.label || 'כפתור ללא שם')}` : `${verb} כפתור שנמחק`;
    }
    case 'rsvp':
      return `ענו: ${RSVP_LABEL[when.value] || when.value}`;
    case 'number':
      return 'ענו מספר';
    case 'number_invalid':
      return 'מספר לא תקין';
    case 'text_contains': {
      const w = (when.words || []).filter(Boolean);
      if (!w.length) return 'טקסט שמכיל: (לא הוגדר)';
      const shown = w.slice(0, 3).join(', ');
      return `טקסט שמכיל: ${shown}${w.length > 3 ? '…' : ''}`;
    }
    case 'any_text':
      return 'כל טקסט';
    case 'done':
      return 'אחרי השאלות';
    case 'answered':
      return 'ענו על שאלה';
    default:
      return 'תנאי';
  }
}

export function fieldLabel(field: string, meta: FlowMeta | null): string {
  const f = (meta?.fields?.length ? meta.fields : DEFAULT_FIELDS).find((x) => x.value === field);
  if (f) return f.label;
  if (field.startsWith('custom:')) return `שדה מותאם: ${field.slice(7)}`;
  return field;
}

export function actionSummary(a: FlowAction, meta: FlowMeta | null): string {
  switch (a.type) {
    case 'set_rsvp':
      return `סטטוס הגעה ← ${RSVP_LABEL[a.value] || a.value || '?'}`;
    case 'set_field':
      return `${fieldLabel(a.field || '', meta) || 'שדה'} ← ${a.value || '…'}`;
    case 'add_tag':
      return `תגית: ${a.tag || '…'}`;
    case 'notify_host':
      return `התראה למארחים${a.text ? `: ${a.text}` : ''}`;
    case 'stop_reminders':
      return 'הפסקת תזכורות';
    default:
      return (a as any).type;
  }
}

export function simActionLabel(type: string): string {
  return (ACTION_LABEL as Record<string, string>)[type] || type;
}
