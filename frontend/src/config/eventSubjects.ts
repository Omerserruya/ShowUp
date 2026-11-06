/**
 * Who an event is for - the couple / honoree / parents / company - per event
 * type. Captured by the event wizard, the gift (redeem) page and Settings →
 * event details; stored as `event.subjects` and resolved into the message
 * variables (couple_names, bride_name, baby_name, company_name …) by
 * shared/domain/messaging/resolver.py.
 */

// Contextual subjects captured per event type (couple / parents / honoree / company …).
export interface EventSubjects {
  p1: string;
  p2: string;
  ln1: string;
  ln2: string;
  role1: 'bride' | 'groom';
  role2: 'bride' | 'groom';
  honoree: string; // baby / child / celebrant
  parent1: string;
  parent2: string;
  company: string;
  bizEventName: string;
  age: string;
  // Brit/Brita: parents often keep the baby's name a secret until the event.
  // When true we don't require the name and derive a name-free event title.
  secretName: boolean;
}

export const EMPTY_SUBJECTS: EventSubjects = {
  p1: '', p2: '', ln1: '', ln2: '', role1: 'bride', role2: 'groom',
  honoree: '', parent1: '', parent2: '', company: '', bizEventName: '', age: '',
  secretName: false,
};

export const joinHe = (a: string, b: string): string => {
  const x = (a || '').trim();
  const y = (b || '').trim();
  if (x && y) return `${x} ו${y}`;
  return x || y || '';
};

// Derive the auto-generated event title + the inviter name (used in messages) from
// the contextual subjects. Title stays editable; this only sets the suggestion.
export const deriveEventFromSubjects = (
  type: string,
  s: EventSubjects
): { name: string; inviterName: string } => {
  switch (type) {
    case 'wedding': {
      const couple = joinHe(s.p1, s.p2);
      return { name: couple ? `החתונה של ${couple}` : '', inviterName: couple };
    }
    case 'brit':
    case 'brita': {
      const label = type === 'brit' ? 'הברית' : 'הבריתה';
      const parents = joinHe(s.parent1, s.parent2);
      // Name kept secret → derive a warm, name-free title from the parents.
      if (s.secretName) {
        return { name: parents ? `${label} של ${parents}` : `${label} שלנו`, inviterName: parents };
      }
      const baby = s.honoree.trim();
      return { name: baby ? `${label} של ${baby}` : '', inviterName: parents };
    }
    case 'bar':
    case 'bat': {
      const label = type === 'bar' ? 'בר המצווה' : 'בת המצווה';
      const child = s.honoree.trim();
      return { name: child ? `${label} של ${child}` : '', inviterName: joinHe(s.parent1, s.parent2) };
    }
    case 'corporate':
      return { name: s.bizEventName.trim(), inviterName: s.company.trim() };
    case 'birthday': {
      const who = s.honoree.trim();
      const age = s.age.trim();
      const name = who ? (age ? `יום ההולדת ה-${age} של ${who}` : `יום ההולדת של ${who}`) : '';
      return { name, inviterName: who };
    }
    case 'other':
      return { name: '', inviterName: s.company.trim() };
    default:
      return { name: '', inviterName: '' };
  }
};

export const ROLES = [{ v: 'bride', t: 'כלה' }, { v: 'groom', t: 'חתן' }] as const;

/** The short form of the wizard's per-type fields (Settings, gift page).
 *  Wedding rows also carry a bride/groom role. */
export const SUBJECT_FIELDS: Record<string, { key: keyof EventSubjects; label: string; role?: 'role1' | 'role2' }[]> = {
  wedding: [
    { key: 'p1', label: 'שם פרטי - בן/בת הזוג הראשון/ה', role: 'role1' }, { key: 'ln1', label: 'שם משפחה' },
    { key: 'p2', label: 'שם פרטי - בן/בת הזוג השני/ה', role: 'role2' }, { key: 'ln2', label: 'שם משפחה' },
  ],
  brit: [{ key: 'honoree', label: 'שם התינוק (אפשר להשאיר ריק אם זה סוד)' }, { key: 'parent1', label: 'הורה ראשון' }, { key: 'parent2', label: 'הורה שני' }],
  brita: [{ key: 'honoree', label: 'שם התינוקת (אפשר להשאיר ריק אם זה סוד)' }, { key: 'parent1', label: 'הורה ראשון' }, { key: 'parent2', label: 'הורה שני' }],
  bar: [{ key: 'honoree', label: 'שם חתן בר המצווה' }, { key: 'parent1', label: 'הורה ראשון' }, { key: 'parent2', label: 'הורה שני' }],
  bat: [{ key: 'honoree', label: 'שם כלת בת המצווה' }, { key: 'parent1', label: 'הורה ראשון' }, { key: 'parent2', label: 'הורה שני' }],
  birthday: [{ key: 'honoree', label: 'למי חוגגים?' }],
  corporate: [{ key: 'company', label: 'שם החברה' }],
  other: [{ key: 'company', label: 'שמות המזמינים' }],
};

/** Mirrors shared/domain/messaging/resolver.py `event_host_label`: an event
 *  can't be created until the guests can be told who is hosting. */
export const hasHostNames = (s: Partial<EventSubjects>): boolean =>
  [s.company, s.p1, s.p2, s.parent1, s.parent2, s.honoree].some((v) => !!(v || '').trim());

export const HOST_NAMES_HINT = 'חובה למלא שמות בעלי האירוע - הם מופיעים בהודעות לאורחים';
