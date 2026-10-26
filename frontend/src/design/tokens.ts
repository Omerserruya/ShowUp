/**
 * ShowUp design tokens (design v6 / Oct 2026).
 *
 * Single source for colors, type, radii and shadows used by the landing page,
 * the event signup flow and the host platform. The MUI theme
 * (shared-theme/themePrimitives.tsx) is built from these same values, so a
 * change here reaches every screen.
 *
 * Rules of the language:
 * - Warm paper backgrounds, white cards with a warm hairline.
 * - Lavender (`lav`) fills primary buttons, always with ink text.
 * - Deep purple (`purple`) is for links, highlights and selected states.
 * - No black surfaces. Black is only for text.
 */

export const color = {
  // Surfaces
  paper: '#FAF8F4', // landing / mobile background
  paperApp: '#F5F1E9', // signup + platform background
  paperSoft: '#FBFAF7', // quiet row / field background
  paperWarm: '#F1EEE7', // neutral fill (tracks, segmented controls)
  card: '#FFFFFF',

  // Lines
  line: '#E8E3D9', // landing card border
  lineApp: '#E6E2DA', // platform card border
  line2: '#F0EDE7', // inner row divider
  field: '#D8D3C9', // input border
  fieldSignup: '#D3CEC4',

  // Text
  ink: '#16150F',
  body: '#4A4741',
  muted: '#6B6660',
  mutedSoft: '#5B564D',
  placeholder: '#8E887C',

  // Brand
  lav: '#C9B8F3', // primary button fill (ink text)
  lavHover: '#BBA6EE',
  lavMid: '#9D83E0',
  purple: '#5A3DA6', // links, highlights, selected
  purpleDark: '#432C85', // hover
  tint: '#F6F2FD',
  tintApp: '#F3EFFC',
  tintBorder: '#DCD0F4',
  selection: '#E4DAFA',

  // Status
  ok: '#3F6323',
  okBg: '#E7F0D4',
  okBorder: '#CFE0B0',
  warn: '#7E5410',
  warnBg: '#F6EFD8',
  warnBorder: '#E9D9A8',
  err: '#8E3418',
  errBg: '#F6E3DC',
  errBorder: '#EBC5B6',
  danger: '#A33A2B',

  // WhatsApp mock surfaces (for message previews only)
  waChat: '#EFEAE2',
  waHeader: '#F0F2F5',
  waOut: '#D9FDD3',
  waText: '#111B21',
  waMeta: '#667781',
  waLink: '#027EB5',
  waGreen: '#25D366',
} as const;

export const font = {
  family: 'Heebo, "Noto Sans Hebrew", Arial, sans-serif',
  icons: '"Material Symbols Rounded"',
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const radius = {
  sm: 9,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
  pill: 999,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(22,21,15,.04)',
  raised: '0 18px 44px rgba(22,21,15,.07)',
  hero: '0 24px 60px rgba(22,21,15,.08)',
  selected: `0 0 0 1px ${'#5A3DA6'}, 0 14px 34px rgba(90,61,166,.10)`,
  focus: '0 0 0 3px rgba(157,131,224,.28)',
} as const;

/** Minimum touch target on mobile (px). */
export const touch = 44;

/** Chip palette for statuses: [background, border, text]. */
export const chipTone = {
  ok: [color.okBg, color.okBorder, color.ok],
  warn: [color.warnBg, color.warnBorder, color.warn],
  err: [color.errBg, color.errBorder, color.err],
  lav: [color.tintApp, color.tintBorder, color.purpleDark],
  quiet: [color.paperSoft, color.lineApp, color.body],
} as const;

export type ChipTone = keyof typeof chipTone;
