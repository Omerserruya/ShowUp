/**
 * Styling for the RSVP form injected into the editorial invitation.
 * No cards, no shadows - underline fields and a thin outline button so the
 * form dissolves into the page. Derived from the invitation theme so the
 * form follows the chosen fonts and accent (button) colour.
 */
import { ResolvedTheme } from './theme';

export function formStyles(t: ResolvedTheme) {
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
        border: `1px solid ${t.line}`, borderRadius: 0, py: 1.4, minHeight: 44,
        '&.Mui-selected': {
          color: t.ink, bgcolor: 'transparent',
          borderColor: t.accent, borderBottom: `2px solid ${t.accent}`,
          '&:hover': { bgcolor: 'transparent' },
        },
      },
    },

    button: {
      fontFamily: t.bodyFont, letterSpacing: 1, fontWeight: 500, borderRadius: 0,
      color: t.ink, borderColor: t.accent, py: 1.4, minHeight: 48, boxShadow: 'none',
      '&:hover': { borderColor: t.accent, bgcolor: t.accent, color: '#fff' },
    },
  } as const;
}
