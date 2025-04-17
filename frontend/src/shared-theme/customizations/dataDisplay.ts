import { Theme, alpha } from '@mui/material/styles';
import type { Components } from '@mui/material/styles';
import { svgIconClasses } from '@mui/material/SvgIcon';
import { typographyClasses } from '@mui/material/Typography';
import { buttonBaseClasses } from '@mui/material/ButtonBase';
import { chipClasses } from '@mui/material/Chip';
import { iconButtonClasses } from '@mui/material/IconButton';
import type { ListItemProps } from '@mui/material/ListItem';
import type { ListItemTextProps } from '@mui/material/ListItemText';
import type { ListSubheaderProps } from '@mui/material/ListSubheader';
import type { ChipProps } from '@mui/material/Chip';
import { gray, red, green } from '../themePrimitives';

type DataDisplayComponents = Pick<Components<Theme>,
  | 'MuiList'
  | 'MuiListItem'
  | 'MuiListItemText'
  | 'MuiListSubheader'
  | 'MuiListItemIcon'
  | 'MuiChip'
  | 'MuiTablePagination'
  | 'MuiIcon'
>;

type ApplyStyles = {
  (mode: 'light' | 'dark', styles: Record<string, unknown>): Record<string, unknown>;
};

interface ExtendedTheme extends Omit<Theme, 'applyStyles'> {
  applyStyles: ApplyStyles;
  vars?: {
    palette: Theme['palette'];
    shape: Theme['shape'];
  };
}

type StyleProps<T> = T & { 
  theme: ExtendedTheme;
};

const applyDarkStyles = (theme: ExtendedTheme, styles: Record<string, unknown>): Record<string, unknown> => {
  return theme.applyStyles('dark', styles);
};

type ComponentStyleOverrides = {
  [key: string]: {
    styleOverrides?: {
      root?: ((props: { theme: Theme }) => any) | any;
      primary?: ((props: { theme: Theme }) => any) | any;
      secondary?: ((props: { theme: Theme }) => any) | any;
      actions?: any;
    };
    defaultProps?: Record<string, any>;
  };
};

/* eslint-disable import/prefer-default-export */
export const dataDisplayCustomizations: DataDisplayComponents = {
  MuiList: {
    styleOverrides: {
      root: {
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      },
    },
  },
  MuiListItem: {
    styleOverrides: {
      root: ({ theme }: StyleProps<ListItemProps>) => ({
        [`& .${svgIconClasses.root}`]: {
          width: '1rem',
          height: '1rem',
        },
      }),
    },
  },
  MuiListItemText: {
    styleOverrides: {
      primary: ({ theme }: StyleProps<ListItemTextProps>) => ({
        fontSize: theme.typography.body2.fontSize,
        fontWeight: 500,
        lineHeight: theme.typography.body2.lineHeight,
      }),
      secondary: ({ theme }: StyleProps<ListItemTextProps>) => ({
        fontSize: theme.typography.caption.fontSize,
        lineHeight: theme.typography.caption.lineHeight,
      }),
    },
  },
  MuiListSubheader: {
    styleOverrides: {
      root: ({ theme }: StyleProps<ListSubheaderProps>) => ({
        backgroundColor: 'transparent',
        padding: '4px 8px',
        fontSize: theme.typography.caption.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
        textTransform: 'uppercase',
        letterSpacing: '.08rem',
        color: theme.palette.text.secondary,
      }),
    },
  },
  MuiListItemIcon: {
    styleOverrides: {
      root: {
        minWidth: 0,
      },
    },
  },
  MuiChip: {
    defaultProps: {
      variant: 'filled',
    },
    styleOverrides: {
      root: ({ theme }: StyleProps<ChipProps>) => ({
        border: '1px solid',
        borderRadius: '999px',
        [`& .${chipClasses.label}`]: {
          padding: '0 8px',
          fontSize: theme.typography.caption.fontSize,
        },
      }),
    },
  },
  MuiTablePagination: {
    styleOverrides: {
      actions: {
        display: 'flex',
        gap: 8,
        marginRight: 6,
        [`& .${iconButtonClasses.root}`]: {
          minWidth: 0,
          width: 36,
          height: 36,
        },
      },
    },
  },
  MuiIcon: {
    defaultProps: {
      fontSize: 'small',
    },
    styleOverrides: {
      root: {
        variants: [
          {
            props: {
              fontSize: 'small',
            },
            style: {
              fontSize: '1rem',
            },
          },
        ],
      },
    },
  },
};
