/**
 * Styling for the RSVP form injected into the editorial invitation.
 * No cards, no shadows - underline fields and a thin outline button so the
 * form dissolves into the page. Derived from the invitation theme so the
 * form follows the chosen fonts and accent (button) colour.
 */
import { LayoutSpec, ResolvedTheme } from './theme';

export function formStyles(t: ResolvedTheme, layout?: LayoutSpec) {
  const shape = layout?.buttonShape || 'sharp';
  const radius = shape === 'pill' || shape === 'glow' ? 99 : 0;
  const buttonByShape =
    shape === 'underline'
      ? {
          // Minimal: a text button carried by an ink underline, nothing else.
          border: 'none', borderBottom: `1.5px solid ${t.ink}`, borderRadius: 0,
          bgcolor: 'transparent', px: 1,
          '&:hover': { border: 'none', borderBottom: `1.5px solid ${t.accent}`, bgcolor: 'transparent', color: t.accentText },
        }
      : shape === 'glow'
        ? {
            borderRadius: 99, borderColor: t.accent, color: '#fff',
            boxShadow: `0 0 18px ${t.accent}55, inset 0 0 12px ${t.accent}22`,
            '&:hover': { borderColor: t.accent, bgcolor: t.accent, color: '#fff', boxShadow: `0 0 26px ${t.accent}99` },
          }
        : shape === 'pill'
          ? {
              borderRadius: 99, borderColor: t.accent, color: t.ink,
              '&:hover': { borderColor: t.accent, bgcolor: t.accent, color: '#fff' },
            }
          : {
              borderRadius: 0, borderColor: t.accent, color: t.ink,
              '&:hover': { borderColor: t.accent, bgcolor: t.accent, color: '#fff' },
            };
  return {
    serif: { fontFamily: t.titleFont, color: t.ink, fontWeight: 300 },
    sans: { fontFamily: t.bodyFont },
    muted: t.muted,

    field: {
      '& label': { fontFamily: t.bodyFont, color: t.accentText },
      '& label.Mui-focused': { color: t.ink },
      '& .MuiInput-root': { fontFamily: t.bodyFont, color: t.ink },
      '& .MuiInput-underline:before': { borderBottomColor: t.line },
      '& .MuiInput-underline:hover:not(.Mui-disabled):before': { borderBottomColor: t.accent },
      '& .MuiInput-underline:after': { borderBottomColor: t.ink },
    },

    toggle: {
      '& .MuiToggleButton-root': {
        fontFamily: t.bodyFont, letterSpacing: 1, color: t.muted,
        // ≥44px hit area - guests include elderly relatives on small phones.
        border: `1px solid ${t.line}`, borderRadius: radius, py: 1.4, minHeight: 44,
        '&.Mui-selected': {
          color: t.ink, bgcolor: 'transparent',
          borderColor: t.accent, borderBottom: `2px solid ${t.accent}`,
          '&:hover': { bgcolor: 'transparent' },
        },
      },
    },

    button: {
      fontFamily: t.bodyFont, letterSpacing: 1, fontWeight: 500,
      py: 1.4, minHeight: 48, boxShadow: 'none',
      ...buttonByShape,
    },
  } as const;
}
