import * as React from 'react';
import { useColorScheme } from '@mui/material/styles';
import MenuItem from '@mui/material/MenuItem';
import Select, { SelectProps } from '@mui/material/Select';

type ColorMode = 'light' | 'dark' | 'system';

interface SelectDisplayCustomProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-screenshot'?: string;
}

export default function ColorModeSelect(props: Omit<SelectProps<ColorMode>, 'value' | 'onChange'>) {
  const { mode, setMode } = useColorScheme();
  
  if (!mode) {
    return null;
  }

  return (
    <Select<ColorMode>
      value={mode}
      onChange={(event) => setMode(event.target.value as ColorMode)}
      SelectDisplayProps={{
        'data-screenshot': 'toggle-mode',
      } as SelectDisplayCustomProps}
      {...props}
    >
      <MenuItem value="system">System</MenuItem>
      <MenuItem value="light">Light</MenuItem>
      <MenuItem value="dark">Dark</MenuItem>
    </Select>
  );
} 