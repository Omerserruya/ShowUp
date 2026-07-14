import { InvitationConfig } from './types';

/** A ready-made invitation design the couple/host can start from. `config` is a
 *  partial InvitationConfig merged onto the current design (theme + envelope +
 *  optional starter copy). `eventTypes` limits where it shows ([] = every type).
 *  Event-type keys mirror shared EventType: wedding | brit | brita | bar | bat |
 *  corporate | birthday | other. */
export interface InvitationTemplate {
  id: string;
  label: string;
  eventTypes: string[];
  trending?: boolean;
  config: Partial<InvitationConfig>;
}

const SERIF = '"Frank Ruhl Libre", serif';
const DAVID = '"David Libre", serif';
const SUEZ = '"Suez One", serif';
const ASSISTANT = '"Assistant", sans-serif';
const HEEBO = '"Heebo", sans-serif';
const RUBIK = '"Rubik", sans-serif';
const SECULAR = '"Secular One", sans-serif';

/** Build an envelope config in one line (design layer only). */
const env = (color: string, wax: string, font = SERIF, text = 'הזמנה'): InvitationConfig['envelope'] => ({
  enabled: true, color, texture: 'linen', waxColor: wax, stampText: '', paperText: '', envelopeText: text, font,
});

export const INVITATION_TEMPLATES: InvitationTemplate[] = [
  // ---- Wedding ----
  {
    id: 'gold-classic', label: 'זהב קלאסי', eventTypes: ['wedding', 'other'], trending: true,
    config: {
      theme: { preset: 'gold-classic', bg: '#f7f3ea', ink: '#2a2620', accent: '#b3924e', titleFont: SUEZ, bodyFont: ASSISTANT },
      envelope: env('#3e121a', '#c9a24a', SUEZ),
    },
  },
  {
    id: 'botanical', label: 'בוטני ירוק', eventTypes: ['wedding', 'other', 'birthday'], trending: true,
    config: {
      theme: { preset: 'botanical', bg: '#eef1ea', ink: '#2f3a2c', accent: '#6f8a5b', titleFont: DAVID, bodyFont: HEEBO },
      envelope: env('#33402d', '#a8b892', DAVID),
    },
  },
  {
    id: 'romantic-blush', label: 'רומנטי ורוד', eventTypes: ['wedding', 'other'],
    config: {
      theme: { preset: 'romantic-blush', bg: '#f7ece9', ink: '#4a3a37', accent: '#c58f88', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#6e3f3a', '#e3c3bd', DAVID),
    },
  },
  {
    id: 'modern-black', label: 'שחור מודרני', eventTypes: ['wedding', 'corporate', 'other'], trending: true,
    config: {
      theme: { preset: 'modern-black', bg: '#1c1a19', ink: '#f2ece2', accent: '#cba46a', titleFont: SERIF, bodyFont: RUBIK },
      envelope: env('#111010', '#cba46a', SERIF),
    },
  },

  // ---- Brit / Brita ----
  {
    id: 'soft-sky', label: 'תכלת רך', eventTypes: ['brit', 'brita'], trending: true,
    config: {
      theme: { preset: 'soft-sky', bg: '#eef4f8', ink: '#29404e', accent: '#7fa8c2', titleFont: DAVID, bodyFont: HEEBO },
      envelope: env('#2c4a5a', '#b4d0e0', DAVID, 'הזמנה'),
    },
  },
  {
    id: 'cream-cloud', label: 'ענן קרם', eventTypes: ['brit', 'brita', 'birthday'],
    config: {
      theme: { preset: 'cream-cloud', bg: '#f6f1e8', ink: '#4a4234', accent: '#cbb489', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#6b5c43', '#e0cfac', DAVID),
    },
  },

  // ---- Bar mitzvah ----
  {
    id: 'navy-gold', label: 'נייבי וזהב', eventTypes: ['bar'], trending: true,
    config: {
      theme: { preset: 'navy-gold', bg: '#14213a', ink: '#eef1f6', accent: '#c9a24a', titleFont: SUEZ, bodyFont: RUBIK },
      envelope: env('#0e1930', '#c9a24a', SUEZ),
    },
  },
  {
    id: 'urban-slate', label: 'אורבני', eventTypes: ['bar', 'corporate'],
    config: {
      theme: { preset: 'urban-slate', bg: '#23262b', ink: '#eef0f2', accent: '#6aa0c9', titleFont: SERIF, bodyFont: RUBIK },
      envelope: env('#16181c', '#6aa0c9', SERIF),
    },
  },

  // ---- Bat mitzvah ----
  {
    id: 'rose-gold', label: 'ורוד וזהב', eventTypes: ['bat'], trending: true,
    config: {
      theme: { preset: 'rose-gold', bg: '#f7ebe9', ink: '#4a3138', accent: '#c98a86', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#7a4750', '#e6c0bb', DAVID),
    },
  },
  {
    id: 'lavender', label: 'לבנדר', eventTypes: ['bat', 'birthday'], trending: true,
    config: {
      theme: { preset: 'lavender', bg: '#efecf6', ink: '#37324a', accent: '#9285bd', titleFont: DAVID, bodyFont: HEEBO },
      envelope: env('#443b63', '#c7bce2', DAVID),
    },
  },

  // ---- Birthday ----
  {
    id: 'festive', label: 'חגיגה צבעונית', eventTypes: ['birthday', 'other'], trending: true,
    config: {
      theme: { preset: 'festive', bg: '#fff6ec', ink: '#3a2f26', accent: '#e08a3c', titleFont: SECULAR, bodyFont: RUBIK },
      envelope: env('#b9541f', '#f0c48a', SECULAR),
    },
  },
  {
    id: 'clean-modern', label: 'מודרני נקי', eventTypes: ['birthday', 'corporate', 'other'],
    config: {
      theme: { preset: 'clean-modern', bg: '#f4f5f7', ink: '#1f2430', accent: '#4f6dd0', titleFont: SERIF, bodyFont: HEEBO },
      envelope: env('#2c3550', '#b7c2e6', SERIF),
    },
  },

  // ---- Corporate ----
  {
    id: 'minimal-light', label: 'מינימל בהיר', eventTypes: ['corporate', 'other'],
    config: {
      theme: { preset: 'minimal-light', bg: '#f6f6f4', ink: '#1c1c1c', accent: '#444444', titleFont: ASSISTANT, bodyFont: ASSISTANT },
      envelope: env('#2b2b2b', '#bdbdbd', ASSISTANT),
    },
  },
  {
    id: 'elegant-dark', label: 'אלגנט כהה', eventTypes: ['corporate', 'wedding', 'other'],
    config: {
      theme: { preset: 'elegant-dark', bg: '#1b1e24', ink: '#eef0f2', accent: '#b98f4c', titleFont: SERIF, bodyFont: RUBIK },
      envelope: env('#111318', '#b98f4c', SERIF),
    },
  },

  // ---- Universal ----
  {
    id: 'ivory', label: 'שנהב קלאסי', eventTypes: [],
    config: {
      theme: { preset: 'ivory', bg: '#f5efe6', ink: '#2b2622', accent: '#95836b', titleFont: SERIF, bodyFont: ASSISTANT },
      envelope: env('#3e121a', '#d8ccb8', SERIF),
    },
  },
];

/** Templates suited to an event type - the type's own, plus universal ([]),
 *  trending first. Unknown/empty type → all. */
export function templatesForEventType(eventType?: string | null): InvitationTemplate[] {
  const et = (eventType || '').trim().toLowerCase();
  const list = INVITATION_TEMPLATES.filter(
    (t) => !et || t.eventTypes.length === 0 || t.eventTypes.includes(et),
  );
  return [...list].sort((a, b) => Number(!!b.trending) - Number(!!a.trending));
}
