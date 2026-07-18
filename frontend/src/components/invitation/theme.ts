import { InvitationTheme } from './types';

/** Fully-resolved tokens the renderer actually uses. */
export interface ResolvedTheme {
  bg: string;         // page background
  ink: string;        // primary text
  muted: string;      // secondary text (derived from ink)
  accent: string;     // hairlines, ornaments, buttons
  accentText: string; // accent-tinted TEXT - blended toward ink so small labels stay legible
  line: string;       // hairline dividers (derived from ink)
  titleFont: string;  // serif display
  bodyFont: string;   // sans body
  onImage: string;    // text over the photo (always light)
}

/** One font list for BOTH headers and body. English-only faces carry a Hebrew
 *  fallback so Hebrew text still renders. Grouped only for readability. */
export const FONTS: { label: string; value: string }[] = [
  // Serif / display (Hebrew + Latin)
  { label: 'פרנק רול', value: '"Frank Ruhl Libre", serif' },
  { label: 'דויד', value: '"David Libre", serif' },
  { label: 'סואץ', value: '"Suez One", serif' },
  { label: 'בלפייר', value: '"Bellefair", "Frank Ruhl Libre", serif' },
  // Sans (Hebrew + Latin)
  { label: 'אסיסטנט', value: '"Assistant", sans-serif' },
  { label: 'היבו', value: '"Heebo", sans-serif' },
  { label: 'רוביק', value: '"Rubik", sans-serif' },
  { label: 'סקולר', value: '"Secular One", sans-serif' },
  { label: 'אלף', value: '"Alef", sans-serif' },
  { label: 'מרים', value: '"Miriam Libre", sans-serif' },
  { label: 'נוטו', value: '"Noto Sans Hebrew", sans-serif' },
  // Handwritten (Hebrew + Latin)
  { label: 'אמאטיק', value: '"Amatic SC", cursive' },
  // Latin serif (Hebrew falls back)
  { label: 'Playfair', value: '"Playfair Display", "Frank Ruhl Libre", serif' },
  { label: 'Cormorant', value: '"Cormorant Garamond", "David Libre", serif' },
  { label: 'Garamond', value: '"EB Garamond", "David Libre", serif' },
  { label: 'Lora', value: '"Lora", "Frank Ruhl Libre", serif' },
  // Latin sans (Hebrew falls back)
  { label: 'Montserrat', value: '"Montserrat", "Heebo", sans-serif' },
  { label: 'Poppins', value: '"Poppins", "Heebo", sans-serif' },
  // Latin script (Hebrew falls back)
  { label: 'Great Vibes', value: '"Great Vibes", "David Libre", cursive' },
  { label: 'Dancing', value: '"Dancing Script", "David Libre", cursive' },
];

// Back-compat aliases - both header and body now use the same list.
export const TITLE_FONTS = FONTS;
export const BODY_FONTS = FONTS;

/** Curated palettes. Each is a partial theme applied on top of the defaults. */
export const THEME_PRESETS: { key: string; label: string; theme: InvitationTheme }[] = [
  { key: 'ivory', label: 'שנהב', theme: { preset: 'ivory', bg: '#f5efe6', ink: '#2b2622', accent: '#95836b', titleFont: '"Frank Ruhl Libre", serif', bodyFont: '"Assistant", sans-serif' } },
  { key: 'charcoal', label: 'פחם', theme: { preset: 'charcoal', bg: '#211d1a', ink: '#f0e9df', accent: '#c9a96a', titleFont: '"Frank Ruhl Libre", serif', bodyFont: '"Assistant", sans-serif' } },
  { key: 'sage', label: 'מרווה', theme: { preset: 'sage', bg: '#eceee7', ink: '#333d2c', accent: '#7c8c66', titleFont: '"David Libre", serif', bodyFont: '"Heebo", sans-serif' } },
  { key: 'blush', label: 'ורד', theme: { preset: 'blush', bg: '#f6ece9', ink: '#4a3a37', accent: '#b07b75', titleFont: '"David Libre", serif', bodyFont: '"Assistant", sans-serif' } },
  { key: 'classic', label: 'קלאסי', theme: { preset: 'classic', bg: '#f7f5f1', ink: '#1c1a17', accent: '#1c1a17', titleFont: '"Suez One", serif', bodyFont: '"Rubik", sans-serif' } },
];

export const DEFAULT_THEME = {
  bg: '#f5efe6',
  ink: '#2b2622',
  accent: '#95836b',
  titleFont: '"Frank Ruhl Libre", serif',
  bodyFont: '"Assistant", sans-serif',
};

/** Hex → rgba string with the given alpha. Falls back gracefully. */
function rgba(hex: string, a: number): string {
  const h = (hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some((x) => isNaN(x))) return `rgba(43,38,34,${a})`;
  return `rgba(${r},${g},${b},${a})`;
}

/** Blend two hex colors: 0 → a, 1 → b. Falls back to `a` on bad input. */
function blend(a: string, b: string, ratio: number): string {
  const parse = (hex: string) => {
    const h = (hex || '').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const v = [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
    return v.some((x) => isNaN(x)) ? null : v;
  };
  const ca = parse(a), cb = parse(b);
  if (!ca || !cb) return a;
  const mix = ca.map((x, i) => Math.round(x + (cb[i] - x) * ratio));
  return `#${mix.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------------------------------------------------ *
 * Layouts - the STRUCTURE dimension of a design, orthogonal to colors
 * and fonts. Each layout is a genuinely different page: hero composition,
 * typography scale, spacing, decorations and button shapes.
 * ------------------------------------------------------------------ */

export type InvitationLayoutId = 'editorial' | 'classic' | 'minimal' | 'luxury' | 'floral' | 'night';

export interface LayoutSpec {
  key: InvitationLayoutId;
  label: string;
  description: string;
  /** Hero composition:
   *  split    - two-column magazine, photo pinned on one side (the editorial).
   *  medallion- centered column, photo in an oval medallion above the names.
   *  banner   - type-first opening, photo (if any) as a small strip below.
   *  arch     - photo in an arched gold-framed window, dark & ceremonial.
   *  backdrop - photo behind EVERYTHING; content floats in glass panels. */
  hero: 'split' | 'medallion' | 'banner' | 'arch' | 'backdrop';
  /** Divider ornament between sections. */
  ornament: 'diamond' | 'doubleRule' | 'none' | 'goldBar' | 'petal' | 'glowDot';
  /** Decorative page frame. */
  frame: 'none' | 'double' | 'corners';
  /** Content sections rendered as translucent glass panels (night). */
  glassPanels?: boolean;
  /** Floral corner decorations on the page. */
  florals?: boolean;
  /** Display type: weight + tracking personality. */
  display: { weight: number; letterSpacing: number; sizeDesktop: number; sizeMobile: number };
  /** Vertical rhythm of the story column. */
  density: 'airy' | 'normal' | 'tight';
  /** RSVP / link button shape. */
  buttonShape: 'sharp' | 'pill' | 'underline' | 'glow';
}

export const LAYOUTS: LayoutSpec[] = [
  {
    key: 'editorial', label: 'מגזין', description: 'שתי עמודות - תמונה מלאה לצד סיפור נגלל',
    hero: 'split', ornament: 'diamond', frame: 'none',
    display: { weight: 400, letterSpacing: 0, sizeDesktop: 56, sizeMobile: 60 },
    density: 'normal', buttonShape: 'sharp',
  },
  {
    key: 'classic', label: 'אלגנטי', description: 'עמודה סימטרית עם מדליון תמונה ומסגרת כפולה',
    hero: 'medallion', ornament: 'doubleRule', frame: 'double',
    display: { weight: 400, letterSpacing: 0.5, sizeDesktop: 52, sizeMobile: 44 },
    density: 'normal', buttonShape: 'sharp',
  },
  {
    key: 'minimal', label: 'מינימלי', description: 'טיפוגרפיה בלבד - שקט, אוויר, ואף קישוט מיותר',
    hero: 'banner', ornament: 'none', frame: 'none',
    display: { weight: 300, letterSpacing: 1, sizeDesktop: 64, sizeMobile: 46 },
    density: 'airy', buttonShape: 'underline',
  },
  {
    key: 'luxury', label: 'יוקרתי', description: 'קשת מוזהבת, רקע כהה וטקס חגיגי',
    hero: 'arch', ornament: 'goldBar', frame: 'corners',
    display: { weight: 400, letterSpacing: 1.5, sizeDesktop: 48, sizeMobile: 40 },
    density: 'normal', buttonShape: 'sharp',
  },
  {
    key: 'floral', label: 'פרחוני', description: 'פינות פורחות, תמונה מעוגלת ורוך בכל פרט',
    hero: 'medallion', ornament: 'petal', frame: 'none', florals: true,
    display: { weight: 400, letterSpacing: 0, sizeDesktop: 50, sizeMobile: 42 },
    density: 'normal', buttonShape: 'pill',
  },
  {
    key: 'night', label: 'לילה', description: 'התמונה ברקע כל הדף, התוכן צף בזכוכית זוהרת',
    hero: 'backdrop', ornament: 'glowDot', frame: 'none', glassPanels: true,
    display: { weight: 500, letterSpacing: 1, sizeDesktop: 58, sizeMobile: 48 },
    density: 'tight', buttonShape: 'glow',
  },
];

const LAYOUT_BY_KEY: Record<string, LayoutSpec> = Object.fromEntries(LAYOUTS.map((l) => [l.key, l]));

export function resolveLayout(t?: InvitationTheme | null): LayoutSpec {
  return LAYOUT_BY_KEY[(t?.layout || '').trim()] || LAYOUT_BY_KEY.editorial;
}

export function resolveTheme(t?: InvitationTheme | null): ResolvedTheme {
  const ink = t?.ink || DEFAULT_THEME.ink;
  const accent = t?.accent || DEFAULT_THEME.accent;
  return {
    bg: t?.bg || DEFAULT_THEME.bg,
    ink,
    muted: rgba(ink, 0.62),
    accent,
    // Light accents (e.g. ivory's #95836b on #f5efe6) fall well below AA for
    // small text; pulling the hue halfway toward the ink keeps the palette's
    // character while making 12-14px labels legible for older guests.
    accentText: blend(accent, ink, 0.45),
    line: rgba(ink, 0.14),
    titleFont: t?.titleFont || DEFAULT_THEME.titleFont,
    bodyFont: t?.bodyFont || DEFAULT_THEME.bodyFont,
    onImage: '#ffffff',
  };
}
