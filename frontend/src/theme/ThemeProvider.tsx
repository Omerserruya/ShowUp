import React from 'react';
import { Experimental_CssVarsProvider as CssVarsProvider } from '@mui/material/styles';
import { experimental_extendTheme as extendTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import {
  colorSchemes,
  typography,
  shadows,
  shape,
} from '../shared-theme/themePrimitives';
import { inputsCustomizations } from '../shared-theme/customizations/inputs';
import { dataDisplayCustomizations } from '../shared-theme/customizations/dataDisplay';
import { feedbackCustomizations } from '../shared-theme/customizations/feedback';
import { navigationCustomizations } from '../shared-theme/customizations/navigation';
import { surfacesCustomizations } from '../shared-theme/customizations/surfaces';

/**
 * Single source of truth for the ShowUp design system.
 *
 * Historically the app shipped two themes: a rich, fully-customized theme that
 * only wrapped the marketing page, and a stripped-down one (no typography, no
 * shadows, no component styling) that wrapped the entire authenticated app.
 * This unifies them — the full design system now applies everywhere, so every
 * screen inherits the brand font, the elevation ramp, and the component polish.
 */
const theme = extendTheme({
  colorSchemes,
  typography,
  shadows,
  shape,
  components: {
    ...(inputsCustomizations as any),
    ...(dataDisplayCustomizations as any),
    ...(feedbackCustomizations as any),
    ...(navigationCustomizations as any),
    ...(surfacesCustomizations as any),
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          transition: 'background-color 0.3s, color 0.3s',
          overflowX: 'hidden',
        },
        html: {
          overflowX: 'hidden',
          // Smooth in-page anchor scrolling (landing nav) + focus jumps.
          scrollBehavior: 'smooth',
        },
        '#root': {
          overflowX: 'hidden',
        },
      },
    },
  },
});

interface ThemeProviderProps {
  children: React.ReactNode;
}

const ThemeProvider = ({ children }: ThemeProviderProps) => {
  return (
    <CssVarsProvider
      theme={theme}
      defaultMode="light"
      modeStorageKey="show-up-color-scheme"
    >
      <CssBaseline />
      {children}
    </CssVarsProvider>
  );
};

export default ThemeProvider;
