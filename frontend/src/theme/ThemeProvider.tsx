import React from 'react';
import { Experimental_CssVarsProvider as CssVarsProvider } from '@mui/material/styles';
import { experimental_extendTheme as extendTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { brand, gray } from '../shared-theme/themePrimitives';
import { alpha } from '@mui/material/styles';

const theme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: '#1976d2',
          light: brand[200],
          dark: brand[700],
          contrastText: brand[50],
        },
        background: {
          default: 'hsl(0, 0%, 99%)',
          paper: 'hsl(220, 35%, 97%)',
        },
        text: {
          primary: gray[800],
          secondary: gray[600],
        },
        // Add other colors as needed
      },
    },
    dark: {
      palette: {
        primary: {
          main: brand[400],
          light: brand[300],
          dark: brand[700],
          contrastText: brand[50],
        },
        background: {
          default: gray[900],
          paper: 'hsl(220, 30%, 7%)',
        },
        text: {
          primary: 'hsl(0, 0%, 100%)',
          secondary: gray[400],
        },
        divider: alpha(gray[700], 0.6),
        action: {
          hover: alpha(gray[600], 0.2),
          selected: alpha(gray[600], 0.3),
        },
        // Add other colors as needed
      },
    },
  },
});

// Add smooth transition for theme switching
const themeWithTransitions = {
  ...theme,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          transition: 'background-color 0.3s, color 0.3s',
        },
      },
    },
  },
};

interface ThemeProviderProps {
  children: React.ReactNode;
}

const ThemeProvider = ({ children }: ThemeProviderProps) => {
  return (
    <CssVarsProvider theme={themeWithTransitions} defaultMode="light" modeStorageKey="show-up-color-scheme">
      <CssBaseline />
      {children}
    </CssVarsProvider>
  );
}

export default ThemeProvider; 