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
