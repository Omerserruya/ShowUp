/**
 * Landing copy that must stay truthful to the product.
 *
 * ASSISTANT_EXAMPLES: only commands the WhatsApp assistant really executes
 * (core-service/app/ai_tools.py). Each pair is [what the host types, a
 * representative reply]. Do NOT add examples for tools that don't exist (the
 * design's "send a reminder to whoever didn't answer" creates a campaign, and
 * "import this group" imports a WhatsApp group - neither tool exists).
 */
export const ASSISTANT_EXAMPLES: [string, string][] = [
  // AddGuest(name, phone, import_count)
  ['תוסיף את דנה כהן 054-1234567 לרשימה', 'הוספתי 👍 דנה כהן כבר ברשימת המוזמנים.'],
  // EventStats
  ['כמה אישרו עד עכשיו?', '248 אישרו הגעה, 63 עדיין לא ענו ו־29 לא יגיעו.'],
  // SearchGuest(status=pending)
  ['מי עוד לא ענה?', '63 אורחים עוד לא ענו. הנה הרשימה, לפי קבוצות.'],
  // SearchGuest(notes_query) - dietary notes guests wrote in the chat
  ['מי ביקש צמחוני?', '12 אורחים כתבו צמחוני או טבעוני. הנה השמות.'],
  // UpdateEvent(event_date)
  ['שנה את שעת האירוע ל־20:00', 'עדכנתי ל־20:00. מההודעה הבאה זו השעה שתופיע.'],
  // MessageStats(list=read_no_reply)
  ['מי ראה את ההודעה ולא ענה?', '9 אורחים ראו ולא ענו. אולי שווה להרים להם טלפון.'],
];

/** Event types offered in the landing form. Values are the ones EventWizard
 *  understands from the hero (`normalizeEventTypeFromHero`), mapped to the real
 *  catalog keys: wedding, bar, bat, brit, brita, birthday, corporate. */
export const LANDING_EVENT_TYPES: { value: string; label: string }[] = [
  { value: 'wedding', label: 'חתונה' },
  { value: 'bar-mitzvah', label: 'בר מצווה' },
  { value: 'bat-mitzvah', label: 'בת מצווה' },
  { value: 'brit', label: 'ברית' },
  { value: 'brita', label: 'בריתה' },
  { value: 'birthday', label: 'יום הולדת' },
  { value: 'corporate', label: 'אירוע חברה' },
  { value: 'other', label: 'אחר' },
];

export const MARQUEE_EVENTS = ['חתונות', 'בר מצווה', 'בת מצווה', 'בריתות', 'בריתות לבנות', 'ימי הולדת', 'אירועי חברה'];
