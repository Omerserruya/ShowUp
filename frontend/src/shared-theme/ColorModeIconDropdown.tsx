import React from 'react';
import IconButton from '@mui/material/IconButton';
import { useColorScheme } from '@mui/material/styles';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';

interface ColorModeIconDropdownProps {
  mode?: 'light' | 'dark' | 'system';
  onChange?: (mode: 'light' | 'dark' | 'system') => void;
  size?: 'small' | 'medium' | 'large';
}

export default function ColorModeIconDropdown({ 
  mode: controlledMode,
  onChange: controlledOnChange,
  size = 'small'
}: ColorModeIconDropdownProps) {
  const { mode: contextMode, setMode: contextSetMode } = useColorScheme();
  
  const mode = controlledMode ?? contextMode;
  const setMode = controlledOnChange ?? contextSetMode;

  const toggleColorMode = () => {
    setMode(mode === 'light' ? 'dark' : 'light');
  };

  return (
    <IconButton onClick={toggleColorMode} color="inherit" size={size}>
      {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
    </IconButton>
  );
} 