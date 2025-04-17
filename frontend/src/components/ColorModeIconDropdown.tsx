import * as React from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import ComputerIcon from '@mui/icons-material/Computer';
import { useColorScheme } from '@mui/material/styles';

interface ColorModeIconDropdownProps {
  size?: 'small' | 'medium' | 'large';
  mode?: 'light' | 'dark' | 'system';
  onChange?: (mode: 'light' | 'dark' | 'system') => void;
}

export default function ColorModeIconDropdown({ 
  size = 'medium',
  mode: controlledMode,
  onChange: controlledOnChange
}: ColorModeIconDropdownProps) {
  const { mode: contextMode, setMode: contextSetMode } = useColorScheme();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const mode = controlledMode ?? contextMode;
  const setMode = controlledOnChange ?? contextSetMode;

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleModeChange = (newMode: 'light' | 'dark' | 'system') => {
    setMode(newMode);
    handleClose();
  };

  return (
    <>
      <IconButton
        onClick={handleClick}
        size={size}
        aria-label="Color mode"
        aria-controls={open ? 'color-mode-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
      >
        {mode === 'light' ? <LightModeIcon /> : mode === 'dark' ? <DarkModeIcon /> : <ComputerIcon />}
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        id="color-mode-menu"
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem onClick={() => handleModeChange('light')}>
          <ListItemIcon>
            <LightModeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>מצב בהיר</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleModeChange('dark')}>
          <ListItemIcon>
            <DarkModeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>מצב כהה</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleModeChange('system')}>
          <ListItemIcon>
            <ComputerIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>מערכת</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
} 