/**
 * On-demand Google Fonts loading.
 *
 * index.html ships only the app font (Noto Sans Hebrew) plus the invitation's
 * default pair (Frank Ruhl Libre + Assistant). Every other family in the studio
 * menu is fetched lazily: the public invitation loads just the 2-3 families its
 * theme actually uses, and only the studio (where couples browse the menu)
 * loads the full set. Guests on cellular no longer pay for ~20 font families.
 */

const GOOGLE_FAMILY_PARAMS: Record<string, string> = {
  'Noto Sans Hebrew': 'Noto+Sans+Hebrew:wght@300;400;500;600;700;800;900',
  'Frank Ruhl Libre': 'Frank+Ruhl+Libre:wght@300;400;500;700',
  'David Libre': 'David+Libre:wght@400;500;700',
  'Suez One': 'Suez+One',
  'Bellefair': 'Bellefair',
  'Heebo': 'Heebo:wght@300;400;500;700',
  'Assistant': 'Assistant:wght@300;400;500;600;700',
  'Rubik': 'Rubik:wght@300;400;500;700',
  'Secular One': 'Secular+One',
  'Alef': 'Alef:wght@400;700',
  'Miriam Libre': 'Miriam+Libre:wght@400;700',
  'Amatic SC': 'Amatic+SC:wght@400;700',
  'Playfair Display': 'Playfair+Display:wght@400;500;600;700',
  'Cormorant Garamond': 'Cormorant+Garamond:wght@400;500;600;700',
  'EB Garamond': 'EB+Garamond:wght@400;500;600;700',
  'Lora': 'Lora:wght@400;500;600;700',
  'Montserrat': 'Montserrat:wght@300;400;500;600;700',
  'Poppins': 'Poppins:wght@300;400;500;600;700',
  'Great Vibes': 'Great+Vibes',
  'Dancing Script': 'Dancing+Script:wght@400;500;600;700',
};

// Families already present via the static <link> in index.html.
const loaded = new Set<string>(['Noto Sans Hebrew', 'Frank Ruhl Libre', 'Assistant']);

/** Extract quoted family names from a CSS font-family value. */
export function familiesFromCss(css?: string | null): string[] {
  if (!css) return [];
  return Array.from(css.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

/** Inject a stylesheet for any not-yet-loaded known families. */
export function ensureGoogleFonts(families: string[]): void {
  const need = Array.from(new Set(families)).filter((f) => GOOGLE_FAMILY_PARAMS[f] && !loaded.has(f));
  if (!need.length) return;
  need.forEach((f) => loaded.add(f));
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${need.map((f) => `family=${GOOGLE_FAMILY_PARAMS[f]}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

/** Convenience: load whatever families a set of CSS font-family values reference. */
export function ensureThemeFonts(...cssValues: (string | undefined | null)[]): void {
  ensureGoogleFonts(cssValues.flatMap(familiesFromCss));
}

/** The studio font menu previews every option - load the whole set there. */
export function ensureAllFonts(): void {
  ensureGoogleFonts(Object.keys(GOOGLE_FAMILY_PARAMS));
}
