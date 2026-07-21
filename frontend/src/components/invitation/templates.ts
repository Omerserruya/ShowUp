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
  // =========================================================================
  // DESIGN templates - each one is a genuinely different PAGE (layout,
  // typography, spacing, decorations, hero and button language), not a
  // recolor. One per layout in theme.ts LAYOUTS.
  // =========================================================================
  {
    id: 'design-editorial', label: 'מגזין', eventTypes: [], trending: true,
    config: {
      theme: { preset: 'design-editorial', layout: 'editorial', bg: '#f5efe6', ink: '#2b2622', accent: '#95836b', titleFont: SERIF, bodyFont: ASSISTANT },
      envelope: env('#3e121a', '#d8ccb8', SERIF),
    },
  },
  {
    id: 'design-classic', label: 'אלגנטי', eventTypes: [], trending: true,
    config: {
      theme: { preset: 'design-classic', layout: 'classic', bg: '#faf7f0', ink: '#33302b', accent: '#a08b5f', titleFont: '"Bellefair", "Frank Ruhl Libre", serif', bodyFont: ASSISTANT },
      envelope: env('#4a4335', '#cfc0a0', SERIF),
    },
  },
  {
    id: 'design-minimal', label: 'מינימלי', eventTypes: [],
    config: {
      theme: { preset: 'design-minimal', layout: 'minimal', bg: '#fcfcfa', ink: '#191919', accent: '#191919', titleFont: HEEBO, bodyFont: HEEBO },
      envelope: env('#232323', '#d9d9d4', HEEBO),
    },
  },
  {
    id: 'design-luxury', label: 'יוקרתי', eventTypes: [], trending: true,
    config: {
      theme: { preset: 'design-luxury', layout: 'luxury', bg: '#171512', ink: '#efe6d4', accent: '#c9a250', titleFont: SUEZ, bodyFont: RUBIK },
      envelope: env('#0f0e0b', '#c9a250', SUEZ),
    },
  },
  {
    id: 'design-floral', label: 'פרחוני', eventTypes: [], trending: true,
    config: {
      theme: { preset: 'design-floral', layout: 'floral', bg: '#f8f2ee', ink: '#4c3f3d', accent: '#b0766e', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#7a4b45', '#e6c4bd', DAVID),
    },
  },
  {
    id: 'design-night', label: 'לילה', eventTypes: [],
    config: {
      theme: { preset: 'design-night', layout: 'night', bg: '#0c0e16', ink: '#f2f3f8', accent: '#8b93ff', titleFont: SECULAR, bodyFont: RUBIK },
      envelope: env('#101322', '#8b93ff', SECULAR, 'הזמנה'),
    },
  },

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
  // Each entry carries its own `layout`, so the four designs an event type sees
  // are genuinely different PAGES, not one page in four palettes.
  {
    id: 'soft-sky', label: 'תכלת רך', eventTypes: ['brit', 'brita'], trending: true,
    config: {
      theme: { preset: 'soft-sky', layout: 'classic', bg: '#eef4f8', ink: '#29404e', accent: '#7fa8c2', titleFont: DAVID, bodyFont: HEEBO },
      envelope: env('#2c4a5a', '#b4d0e0', DAVID, 'הזמנה'),
    },
  },
  {
    id: 'cream-cloud', label: 'ענן קרם', eventTypes: ['brit', 'brita', 'birthday'],
    config: {
      theme: { preset: 'cream-cloud', layout: 'minimal', bg: '#f6f1e8', ink: '#4a4234', accent: '#cbb489', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#6b5c43', '#e0cfac', DAVID),
    },
  },
  {
    id: 'morning-dew', label: 'טל בוקר', eventTypes: ['brit'], trending: true,
    config: {
      theme: { preset: 'morning-dew', layout: 'editorial', bg: '#f7f4ee', ink: '#2f4250', accent: '#7c9fb8', titleFont: SERIF, bodyFont: ASSISTANT },
      envelope: env('#31505f', '#cfe0ea', SERIF, 'הזמנה'),
    },
  },
  {
    id: 'first-light', label: 'אור ראשון', eventTypes: ['brit'],
    config: {
      theme: { preset: 'first-light', layout: 'floral', bg: '#fbf6ef', ink: '#3d382f', accent: '#b9a888', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#5d5344', '#e8dcc6', DAVID, 'הזמנה'),
    },
  },
  {
    id: 'almond-blossom', label: 'שקד', eventTypes: ['brita'], trending: true,
    config: {
      theme: { preset: 'almond-blossom', layout: 'floral', bg: '#faf1ec', ink: '#4b3a38', accent: '#c48f88', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#7c4d47', '#eccbc4', DAVID, 'הזמנה'),
    },
  },
  {
    id: 'pearl', label: 'פנינה', eventTypes: ['brita'],
    config: {
      theme: { preset: 'pearl', layout: 'editorial', bg: '#f6f3f6', ink: '#413546', accent: '#a08faa', titleFont: '"Bellefair", "Frank Ruhl Libre", serif', bodyFont: ASSISTANT },
      envelope: env('#4e4157', '#d8cee0', '"Bellefair", "Frank Ruhl Libre", serif', 'הזמנה'),
    },
  },

  // ---- Bar mitzvah ----
  {
    id: 'navy-gold', label: 'נייבי וזהב', eventTypes: ['bar'], trending: true,
    config: {
      theme: { preset: 'navy-gold', layout: 'luxury', bg: '#14213a', ink: '#eef1f6', accent: '#c9a24a', titleFont: SUEZ, bodyFont: RUBIK },
      envelope: env('#0e1930', '#c9a24a', SUEZ),
    },
  },
  {
    id: 'urban-slate', label: 'אורבני', eventTypes: ['bar', 'corporate'],
    config: {
      theme: { preset: 'urban-slate', layout: 'night', bg: '#23262b', ink: '#eef0f2', accent: '#6aa0c9', titleFont: SERIF, bodyFont: RUBIK },
      envelope: env('#16181c', '#6aa0c9', SERIF),
    },
  },
  {
    id: 'jerusalem-stone', label: 'אבן ירושלמית', eventTypes: ['bar'], trending: true,
    config: {
      theme: { preset: 'jerusalem-stone', layout: 'classic', bg: '#f2ece1', ink: '#33302b', accent: '#b08d4f', titleFont: SUEZ, bodyFont: RUBIK },
      envelope: env('#4a4030', '#ddc9a2', SUEZ),
    },
  },
  {
    id: 'midnight', label: 'חצות', eventTypes: ['bar'],
    config: {
      theme: { preset: 'midnight', layout: 'editorial', bg: '#0e1118', ink: '#eef1f8', accent: '#6f8cff', titleFont: SECULAR, bodyFont: RUBIK },
      envelope: env('#0a0c12', '#6f8cff', SECULAR),
    },
  },

  // ---- Bat mitzvah ----
  {
    id: 'rose-gold', label: 'ורוד וזהב', eventTypes: ['bat'], trending: true,
    config: {
      theme: { preset: 'rose-gold', layout: 'editorial', bg: '#f7ebe9', ink: '#4a3138', accent: '#c98a86', titleFont: DAVID, bodyFont: ASSISTANT },
      envelope: env('#7a4750', '#e6c0bb', DAVID),
    },
  },
  {
    id: 'lavender', label: 'לבנדר', eventTypes: ['bat', 'birthday'], trending: true,
    config: {
      theme: { preset: 'lavender', layout: 'floral', bg: '#efecf6', ink: '#37324a', accent: '#9285bd', titleFont: DAVID, bodyFont: HEEBO },
      envelope: env('#443b63', '#c7bce2', DAVID),
    },
  },
  {
    id: 'sunrise', label: 'זריחה', eventTypes: ['bat'],
    config: {
      theme: { preset: 'sunrise', layout: 'classic', bg: '#f8f1e8', ink: '#42302c', accent: '#c08b72', titleFont: '"Bellefair", "Frank Ruhl Libre", serif', bodyFont: ASSISTANT },
      envelope: env('#6d4436', '#e8c9b4', '"Bellefair", "Frank Ruhl Libre", serif'),
    },
  },
  {
    id: 'lilac-night', label: 'לילך', eventTypes: ['bat'],
    config: {
      theme: { preset: 'lilac-night', layout: 'night', bg: '#100c1a', ink: '#f2eff8', accent: '#b49ae8', titleFont: SECULAR, bodyFont: RUBIK },
      envelope: env('#0b0813', '#b49ae8', SECULAR),
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
