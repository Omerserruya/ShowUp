import React, { useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import BarChartIcon from '@mui/icons-material/BarChart';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import SmsIcon from '@mui/icons-material/Sms';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import PersonIcon from '@mui/icons-material/Person';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import EventIcon from '@mui/icons-material/Event';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import SettingsIcon from '@mui/icons-material/Settings';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Divider from '@mui/material/Divider';
import { useNavigate, useLocation } from 'react-router-dom';

export default function MenuContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [adminOpen, setAdminOpen] = useState(false);

  const menuItems = [
    { text: 'סטטוס', icon: <BarChartIcon />, path: '/overview' },
    { text: 'רשימת מוזמנים', icon: <PeopleAltIcon />, path: '/guests' },
    { text: 'שליחת הודעות', icon: <SmsIcon />, path: '/messages' },
    { text: 'הושבה', icon: <EventSeatIcon />, path: '/seating' },
    { text: 'הפרופיל שלי', icon: <PersonIcon />, path: '/profile' },
  ];

  const adminMenuItems = [
    { text: 'ניהול משתמשים', icon: <ManageAccountsIcon />, path: '/admin/users' },
    { text: 'ניהול אירועים', icon: <EventIcon />, path: '/admin/events' },
    { text: 'רכישות ובילינג', icon: <ShoppingCartIcon />, path: '/admin/purchases' },
    { text: 'הגדרות מערכת', icon: <SettingsIcon />, path: '/admin/settings' },
  ];

  const handleAdminClick = () => {
    setAdminOpen(!adminOpen);
  };

  return (
    <List>
      {menuItems.map((item) => (
        <ListItem key={item.text} disablePadding>
          <ListItemButton
            selected={location.pathname === item.path}
            onClick={() => navigate(item.path)}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.text} 
                      sx={{ display: 'flex', justifyContent: 'right' }} // remove margin between         
/>
          </ListItemButton>
        </ListItem>
      ))}

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
                onClick={() => navigate(item.path)}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} sx={{ display: 'flex', justifyContent: 'right' }} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </List>
  );
}
