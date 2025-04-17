import { createTheme } from '@mui/material/styles';

// Augment the Theme interface
declare module '@mui/material/styles' {
  interface Theme {
    vars?: any;
    applyStyles: (mode: 'light' | 'dark', styles: Record<string, unknown>) => Record<string, unknown>;
  }
  // allow configuration using `createTheme`
  interface ThemeOptions {
    vars?: any;
    applyStyles?: (mode: 'light' | 'dark', styles: Record<string, unknown>) => Record<string, unknown>;
  }
}

// Create a theme instance with applyStyles implementation
const theme = createTheme({
  // Your theme configuration here
  applyStyles: (mode: 'light' | 'dark', styles: Record<string, unknown>) => {
    return mode === 'dark' ? styles : {};
  }
});

export default theme; 