import React, { useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import BarChartIcon from '@mui/icons-material/BarChart';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import SendIcon from '@mui/icons-material/Send';
import DescriptionIcon from '@mui/icons-material/Description';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import GroupIcon from '@mui/icons-material/Group';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import PersonIcon from '@mui/icons-material/Person';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import EventIcon from '@mui/icons-material/Event';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import SettingsIcon from '@mui/icons-material/Settings';
import CelebrationIcon from '@mui/icons-material/Celebration';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Divider from '@mui/material/Divider';
import { styled } from '@mui/material/styles';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { useEvent } from '../../contexts/EventContext';
import { useEntitlements, Feature } from '../../hooks/useEntitlements';

const DashboardButton = styled(Button)<{ selected?: boolean }>(({ theme, selected }) => ({
  background: selected 
    ? 'linear-gradient(90deg, #7C3AED 0%, #EC4899 100%)'
    : 'transparent',
  color: selected ? 'white' : theme.palette.text.primary,
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(1.25, 2),
  textTransform: 'none',
  fontWeight: selected ? 500 : 400,
  width: '100%',
  justifyContent: 'flex-start',
  gap: theme.spacing(1),
  minHeight: 48,
  height: 48,
  fontSize: '0.9375rem',
  '&:hover': {
    background: selected
      ? 'linear-gradient(90deg, #6D28D9 0%, #DB2777 100%)'
      : 'rgba(0, 0, 0, 0.04)',
  },
  '& .MuiButton-startIcon': {
    marginRight: 0,
    marginLeft: theme.spacing(1),
    color: selected ? 'white' : theme.palette.text.secondary,
  },
}));

const MenuItemButton = styled(ListItemButton)<{ selected?: boolean }>(({ theme, selected }) => ({
  borderRadius: theme.shape.borderRadius,
  margin: theme.spacing(0.5, 1),
  minHeight: 48,
  height: 48,
  padding: theme.spacing(1.25, 2),
  backgroundColor: selected 
    ? 'transparent'
    : 'transparent',
  background: selected 
    ? 'linear-gradient(90deg, #7C3AED 0%, #EC4899 100%)'
    : 'transparent',
  color: selected ? 'white' : theme.palette.text.primary,
  '&.Mui-selected': {
    backgroundColor: 'transparent',
    background: 'linear-gradient(90deg, #7C3AED 0%, #EC4899 100%)',
    color: 'white',
    '&:hover': {
      backgroundColor: 'transparent',
      background: 'linear-gradient(90deg, #6D28D9 0%, #DB2777 100%)',
    },
    '& .MuiListItemIcon-root': {
      color: 'white',
    },
  },
  '&:hover': {
    backgroundColor: selected
      ? 'transparent'
      : 'rgba(0, 0, 0, 0.04)',
    background: selected
      ? 'linear-gradient(90deg, #6D28D9 0%, #DB2777 100%)'
      : undefined,
  },
  '& .MuiListItemIcon-root': {
    color: selected ? 'white' : theme.palette.text.secondary,
    minWidth: 40,
  },
}));

interface MenuContentProps {
  onItemClick?: () => void;
}

export default function MenuContent({ onItemClick }: MenuContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useUser();
  const { selectedEvent } = useEvent();
  const { hasFeature } = useEntitlements(selectedEvent?.planId);
  const [adminOpen, setAdminOpen] = useState(false);

  const isDashboardSelected = location.pathname === '/overview';

  // `feature` gates the item by plan tier; items without one are always shown.
  const allMenuItems: Array<{ text: string; icon: React.ReactNode; path: string; feature?: Feature }> = [
    { text: 'רשימת אורחים', icon: <PeopleAltIcon />, path: '/guests' },
    { text: 'הזמנה דיגיטלית', icon: <MailOutlineIcon />, path: '/invitation', feature: 'web_invitation' },
    { text: 'ניהול קמפיינים', icon: <SendIcon />, path: '/messages', feature: 'whatsapp_campaigns' },
    { text: 'תבניות הודעה', icon: <DescriptionIcon />, path: '/templates', feature: 'templates' },
    { text: 'סידור מושבים', icon: <EventSeatIcon />, path: '/seating', feature: 'seating' },
    { text: 'חברי צוות', icon: <GroupIcon />, path: '/team', feature: 'team_members' },
    { text: 'חבילה ושימוש', icon: <CreditCardIcon />, path: '/billing' },
    { text: 'סיכום האירוע', icon: <CelebrationIcon />, path: '/recap' },
    { text: 'הפרופיל שלי', icon: <PersonIcon />, path: '/profile' },
  ];
  const menuItems = allMenuItems.filter((item) => !item.feature || hasFeature(item.feature));

  const adminMenuItems = [
    { text: 'ניהול משתמשים', icon: <ManageAccountsIcon />, path: '/admin/users' },
    { text: 'ניהול אירועים', icon: <EventIcon />, path: '/admin/events' },
    { text: 'רכישות ובילינג', icon: <ShoppingCartIcon />, path: '/admin/purchases' },
    { text: 'הגדרות מערכת', icon: <SettingsIcon />, path: '/admin/settings' },
  ];

  const handleAdminClick = () => {
    setAdminOpen(!adminOpen);
  };

  const handleNavigation = (path: string) => {
    navigate(path);
    onItemClick?.();
  };

  return (
    <List sx={{ px: 1 }}>
      {/* Dashboard Button */}
      <ListItem disablePadding sx={{ mb: 1 }}>
        <DashboardButton
          startIcon={<BarChartIcon />}
          onClick={() => handleNavigation('/overview')}
          fullWidth
          selected={isDashboardSelected}
        >
          לוח בקרה
        </DashboardButton>
      </ListItem>

      {/* Regular Menu Items */}
      {menuItems.map((item) => {
        const isSelected = location.pathname === item.path;
        return (
        <ListItem key={item.text} disablePadding>
            <MenuItemButton
              selected={isSelected}
              onClick={() => handleNavigation(item.path)}
              dir="rtl"
          >
              <ListItemIcon>
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={item.text}
                sx={{ 
                  textAlign: 'right',
                  '& .MuiListItemText-primary': {
                    fontSize: '0.9375rem',
                    color: isSelected ? 'white' : 'text.primary',
                  },
                }}
/>
            </MenuItemButton>
        </ListItem>
        );
      })}

      {isAdmin && (
        <>
          <Divider sx={{ my: 1 }} />

          <ListItem disablePadding>
            <ListItemButton onClick={handleAdminClick}>
              <ListItemIcon>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText primary="ניהול" sx={{ display: 'flex', justifyContent: 'right' }} />
              {adminOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
          </ListItem>

          {adminOpen && (
            <List component="div" disablePadding>
              {adminMenuItems.map((item) => (
                <ListItem key={item.text} disablePadding sx={{ pr: 4 }}>
                  <ListItemButton
                    selected={location.pathname === item.path}
                    onClick={() => handleNavigation(item.path)}
                  >
                    <ListItemIcon>{item.icon}</ListItemIcon>
                    <ListItemText primary={item.text} sx={{ display: 'flex', justifyContent: 'right' }} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </>
      )}
    </List>
  );
}
