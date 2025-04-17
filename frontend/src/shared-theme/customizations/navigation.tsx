import * as React from 'react';
import { Theme, alpha } from '@mui/material/styles';
import type { Components } from '@mui/material/styles';
import type { MenuItemProps } from '@mui/material/MenuItem';
import type { SelectProps } from '@mui/material/Select';
import type { TabProps } from '@mui/material/Tab';
import type { StepProps } from '@mui/material/Step';

import { buttonBaseClasses } from '@mui/material/ButtonBase';
import { dividerClasses } from '@mui/material/Divider';
import { menuItemClasses } from '@mui/material/MenuItem';
import { selectClasses } from '@mui/material/Select';
import { tabClasses } from '@mui/material/Tab';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import { gray, brand } from '../themePrimitives';

type NavigationComponents = Pick<Components<Theme>,
  | 'MuiMenuItem'
  | 'MuiMenu'
  | 'MuiSelect'
  | 'MuiLink'
  | 'MuiDrawer'
  | 'MuiPaginationItem'
  | 'MuiTabs'
  | 'MuiTab'
  | 'MuiStepConnector'
  | 'MuiStepIcon'
  | 'MuiStepLabel'
  | 'MuiBottomNavigation'
  | 'MuiBottomNavigationAction'
  | 'MuiStep'
>;

interface CustomTheme extends Theme {
  applyStyles: (mode: 'light' | 'dark', styles: Record<string, unknown>) => Record<string, unknown>;
  palette: Theme['palette'];
  shape: Theme['shape'];
}

type StyleProps<T> = T & { 
  theme: CustomTheme;
};

/* eslint-disable import/prefer-default-export */
export const navigationCustomizations: NavigationComponents = {
  MuiMenuItem: {
    styleOverrides: {
      root: ({ theme }: StyleProps<MenuItemProps>) => ({
        borderRadius: theme.shape.borderRadius,
        padding: '6px 8px',
        [`&.${menuItemClasses.focusVisible}`]: {
          backgroundColor: 'transparent',
        },
      }),
    },
  },
  MuiMenu: {
    styleOverrides: {
      list: {
        gap: '0px',
        [`&.${dividerClasses.root}`]: {
          margin: '0 -8px',
        },
      },
      paper: ({ theme }: StyleProps<any>) => ({
        marginTop: '4px',
        borderRadius: theme.shape.borderRadius,
        border: `1px solid ${theme.palette.divider}`,
        backgroundImage: 'none',
        background: 'hsl(0, 0%, 100%)',
        boxShadow:
          'hsla(220, 30%, 5%, 0.07) 0px 4px 16px 0px, hsla(220, 25%, 10%, 0.07) 0px 8px 16px -5px',
        [`& .${buttonBaseClasses.root}`]: {
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.action.selected, 0.3),
          },
        },
        ...theme.applyStyles('dark', {
          background: gray[900],
          boxShadow:
            'hsla(220, 30%, 5%, 0.7) 0px 4px 16px 0px, hsla(220, 25%, 10%, 0.8) 0px 8px 16px -5px',
        }),
      }),
    },
  },
  MuiSelect: {
    defaultProps: {
      IconComponent: UnfoldMoreRoundedIcon,
    },
    styleOverrides: {
      root: ({ theme }: StyleProps<SelectProps>) => ({
        borderRadius: theme.shape.borderRadius,
        border: '1px solid',
        borderColor: gray[200],
        backgroundColor: theme.palette.background.paper,
        boxShadow: `inset 0 1px 0 1px hsla(220, 0%, 100%, 0.6), inset 0 -1px 0 1px hsla(220, 35%, 90%, 0.5)`,
        '&:hover': {
          borderColor: gray[300],
          backgroundColor: theme.palette.background.paper,
          boxShadow: 'none',
        },
        '&.Mui-focused': {
          outlineOffset: 0,
          borderColor: gray[400],
        },
        '&.Mui-disabled': {
          opacity: 0.6,
        },
        ...theme.applyStyles('dark', {
          borderRadius: theme.shape.borderRadius,
          borderColor: gray[700],
          backgroundColor: theme.palette.background.paper,
          boxShadow: `inset 0 1px 0 1px ${alpha(gray[700], 0.15)}, inset 0 -1px 0 1px hsla(220, 0%, 0%, 0.7)`,
          '&:hover': {
            borderColor: alpha(gray[700], 0.7),
            backgroundColor: theme.palette.background.paper,
            boxShadow: 'none',
          },
          '&.Mui-focused': {
            outlineOffset: 0,
            borderColor: gray[900],
          },
        }),
      }),
    },
  },
  MuiLink: {
    defaultProps: {
      underline: 'none',
    },
    styleOverrides: {
      root: ({ theme }: StyleProps<any>) => ({
        color: theme.palette.text.primary,
        fontWeight: 500,
        position: 'relative',
        textDecoration: 'none',
        width: 'fit-content',
        '&::before': {
          content: '""',
          position: 'absolute',
          width: '100%',
          height: '1px',
          bottom: 0,
          left: 0,
          backgroundColor: theme.palette.text.secondary,
          opacity: 0.3,
          transition: 'width 0.3s ease, opacity 0.3s ease',
        },
        '&:hover::before': {
          width: 0,
        },
        '&:focus-visible': {
          outline: `3px solid ${alpha(brand[500], 0.5)}`,
          outlineOffset: '4px',
          borderRadius: '2px',
        },
      }),
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: ({ theme }: StyleProps<any>) => ({
        backgroundColor: theme.palette.background.default,
      }),
    },
  },
  MuiPaginationItem: {
    styleOverrides: {
      root: ({ theme }: StyleProps<any>) => ({
        '&.Mui-selected': {
          color: 'white',
          backgroundColor: theme.palette.grey[900],
        },
        ...theme.applyStyles('dark', {
          '&.Mui-selected': {
            color: 'black',
            backgroundColor: theme.palette.grey[50],
          },
        }),
      }),
    },
  },
  MuiTabs: {
    styleOverrides: {
      root: { minHeight: 'fit-content' },
      indicator: ({ theme }: StyleProps<any>) => ({
        backgroundColor: theme.palette.grey[800],
        ...theme.applyStyles('dark', {
          backgroundColor: theme.palette.grey[200],
        }),
      }),
    },
  },
  MuiTab: {
    styleOverrides: {
      root: ({ theme }: StyleProps<TabProps>) => ({
        color: theme.palette.text.primary,
        fontWeight: 500,
        position: 'relative',
        textDecoration: 'none',
        '&::after': {
          content: '""',
          display: 'block',
          position: 'absolute',
          width: 0,
          height: '2px',
          bottom: 0,
          left: 0,
          backgroundColor: theme.palette.text.secondary,
          opacity: 0.3,
          transition: 'width 0.3s ease, opacity 0.3s ease',
        },
        '&:hover::after': {
          width: '100%',
          opacity: 0.6,
        },
        '&.Mui-selected::after': {
          width: '100%',
          opacity: 1,
        },
      }),
    },
  },
  MuiStepConnector: {
    styleOverrides: {
      line: ({ theme }: StyleProps<any>) => ({
        borderTop: '1px solid',
        borderColor: theme.palette.divider,
        flex: 1,
        borderRadius: '99px',
      }),
    },
  },
  MuiStepIcon: {
    styleOverrides: {
      root: ({ theme }: StyleProps<any>) => ({
        color: 'transparent',
        border: `1px solid ${gray[400]}`,
        width: 12,
        height: 12,
        borderRadius: '50%',
        '& text': {
          display: 'none',
        },
        '&.Mui-active': {
          border: 'none',
          color: theme.palette.primary.main,
        },
        '&.Mui-completed': {
          border: 'none',
          color: theme.palette.success.main,
        },
        ...theme.applyStyles('dark', {
          border: `1px solid ${gray[700]}`,
          '&.Mui-active': {
            border: 'none',
            color: theme.palette.primary.light,
          },
          '&.Mui-completed': {
            border: 'none',
            color: theme.palette.success.light,
          },
        }),
        variants: [
          {
            props: { completed: true },
            style: {
              width: 12,
              height: 12,
            },
          },
        ],
      }),
    },
  },
  MuiStepLabel: {
    styleOverrides: {
      label: ({ theme }: StyleProps<any>) => ({
        '&.Mui-completed': {
          opacity: 0.6,
          ...theme.applyStyles('dark', { opacity: 0.5 }),
        },
      }),
    },
  },
  MuiBottomNavigation: {
    styleOverrides: {
      root: ({ theme }: StyleProps<any>) => ({
        '&.Mui-selected': {
          color: 'white',
          backgroundColor: theme.palette.grey[900],
        },
        ...theme.applyStyles('dark', {
          '&.Mui-selected': {
            color: 'black',
            backgroundColor: theme.palette.grey[50],
          },
        }),
      }),
    },
  },
  MuiBottomNavigationAction: {
    styleOverrides: {
      root: ({ theme }: StyleProps<any>) => ({
        minWidth: 'fit-content',
        minHeight: 'fit-content',
        color: theme.palette.text.secondary,
        borderRadius: theme.shape.borderRadius,
        border: '1px solid',
        borderColor: 'transparent',
        ':hover': {
          color: theme.palette.text.primary,
          backgroundColor: gray[100],
          borderColor: gray[200],
        },
        '&.Mui-selected': {
          color: 'inherit',
        },
        ...theme.applyStyles('dark', {
          ':hover': {
            color: theme.palette.text.primary,
            backgroundColor: gray[800],
            borderColor: gray[700],
          },
        }),
      }),
    },
  },
  MuiStep: {
    styleOverrides: {
      root: ({ theme }: StyleProps<StepProps>) => ({
        border: `1px solid ${gray[200]}`,
        borderRadius: '50%',
        padding: '4px',
        '&.Mui-active': {
          border: 'none',
          color: theme.palette.primary.main,
        },
        '&.Mui-completed': {
          border: 'none',
          color: theme.palette.success.main,
        },
        ...theme.applyStyles('dark', {
          border: `1px solid ${gray[700]}`,
          '&.Mui-active': {
            border: 'none',
            color: theme.palette.primary.light,
          },
          '&.Mui-completed': {
            border: 'none',
            color: theme.palette.success.light,
          },
        }),
      }),
    },
  },
};
