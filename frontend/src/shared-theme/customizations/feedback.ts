import { Theme, alpha } from '@mui/material/styles';
import type { Components } from '@mui/material/styles';
import type { AlertProps } from '@mui/material/Alert';
import type { DialogProps } from '@mui/material/Dialog';
import type { LinearProgressProps } from '@mui/material/LinearProgress';
import { gray, orange, brand } from '../themePrimitives';

type FeedbackComponents = Pick<Components<Theme>,
  | 'MuiAlert'
  | 'MuiDialog'
  | 'MuiLinearProgress'
>;

type ApplyStyles = {
  (mode: 'light' | 'dark', styles: Record<string, unknown>): Record<string, unknown>;
};

interface ExtendedTheme extends Omit<Theme, 'applyStyles'> {
  applyStyles: ApplyStyles;
}

type StyleProps<T> = T & { 
  theme: ExtendedTheme;
};

const applyDarkStyles = (theme: ExtendedTheme, styles: Record<string, unknown>): Record<string, unknown> => {
  return theme.applyStyles('dark', styles);
};

/* eslint-disable import/prefer-default-export */
export const feedbackCustomizations: FeedbackComponents = {
  MuiAlert: {
    styleOverrides: {
      // The rounded, softly-bordered look applies to every severity, but the
      // COLOR must stay semantic: painting success/info/error in warning-orange
      // (the old root override) made feedback unreadable product-wide.
      root: ({ theme }: StyleProps<AlertProps>) => ({
        borderRadius: 10,
        color: theme.palette.text.primary,
        border: '1px solid',
      }),
      standardWarning: ({ theme }: StyleProps<AlertProps>) => ({
        backgroundColor: orange[100],
        borderColor: orange[200],
        ...applyDarkStyles(theme, {
          backgroundColor: alpha(orange[900], 0.2),
          borderColor: orange[900],
        }),
      }),
      standardSuccess: ({ theme }: StyleProps<AlertProps>) => ({
        backgroundColor: alpha(theme.palette.success.main, 0.12),
        borderColor: alpha(theme.palette.success.main, 0.35),
        ...applyDarkStyles(theme, {
          backgroundColor: alpha(theme.palette.success.dark, 0.25),
          borderColor: theme.palette.success.dark,
        }),
      }),
      standardError: ({ theme }: StyleProps<AlertProps>) => ({
        backgroundColor: alpha(theme.palette.error.main, 0.1),
        borderColor: alpha(theme.palette.error.main, 0.35),
        ...applyDarkStyles(theme, {
          backgroundColor: alpha(theme.palette.error.dark, 0.25),
          borderColor: theme.palette.error.dark,
        }),
      }),
      standardInfo: ({ theme }: StyleProps<AlertProps>) => ({
        backgroundColor: alpha(theme.palette.info.main, 0.1),
        borderColor: alpha(theme.palette.info.main, 0.35),
        ...applyDarkStyles(theme, {
          backgroundColor: alpha(theme.palette.info.dark, 0.25),
          borderColor: theme.palette.info.dark,
        }),
      }),
    },
  },
  MuiDialog: {
    styleOverrides: {
      root: ({ theme }: StyleProps<DialogProps>) => ({
        '& .MuiDialog-paper': {
          borderRadius: '10px',
          border: '1px solid',
          borderColor: theme.palette.divider,
          boxShadow: `0 4px 16px ${alpha(gray[400], 0.2)}`,
          ...applyDarkStyles(theme, {
            borderColor: gray[800],
            boxShadow: `0 4px 16px ${alpha(gray[900], 0.5)}`,
          }),
        },
      }),
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: ({ theme }: StyleProps<LinearProgressProps>) => ({
        height: 8,
        borderRadius: 8,
        backgroundColor: gray[200],
        ...applyDarkStyles(theme, {
          backgroundColor: gray[800],
        }),
      }),
    },
  },
};
