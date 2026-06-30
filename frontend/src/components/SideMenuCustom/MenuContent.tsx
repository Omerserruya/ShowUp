import React, { useState } from 'react';
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Collapse, Typography, alpha, useTheme } from '@mui/material';
import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import EventSeatRoundedIcon from '@mui/icons-material/EventSeatRounded';
import Diversity3RoundedIcon from '@mui/icons-material/Diversity3Rounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { useEvent } from '../../contexts/EventContext';
import { hasFeature, Feature } from '../../config/entitlements';

const BRAND = '#888cee';
const DEEP = '#6f74e0';

interface NavItem { text: string; icon: React.ReactNode; path: string; feature?: Feature; }

interface MenuContentProps { onItemClick?: () => void; }

export default function MenuContent({ onItemClick }: MenuContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { isAdmin } = useUser();
  const { selectedEvent } = useEvent();
  const [adminOpen, setAdminOpen] = useState(false);

  const primary: NavItem[] = [
    { text: 'לוח בקרה', icon: <SpaceDashboardRoundedIcon />, path: '/overview' },
    { text: 'האורחים', icon: <GroupsRoundedIcon />, path: '/guests' },
    { text: 'ההזמנה', icon: <MailRoundedIcon />, path: '/invitation', feature: 'web_invitation' },
    { text: 'תזכורות והודעות', icon: <CampaignRoundedIcon />, path: '/messages', feature: 'whatsapp_campaigns' },
    { text: 'תבניות הודעה', icon: <DescriptionRoundedIcon />, path: '/templates', feature: 'templates' },
    { text: 'סידור מושבים', icon: <EventSeatRoundedIcon />, path: '/seating', feature: 'seating' },
    { text: 'צוות', icon: <Diversity3RoundedIcon />, path: '/team', feature: 'team_members' },
  ];
  const secondary: NavItem[] = [
    { text: 'חבילה ושימוש', icon: <CreditCardRoundedIcon />, path: '/billing' },
    { text: 'סיכום האירוע', icon: <CelebrationRoundedIcon />, path: '/recap' },
    { text: 'הפרופיל שלי', icon: <PersonRoundedIcon />, path: '/profile' },
  ];
  const adminItems: NavItem[] = [
    { text: 'ניהול משתמשים', icon: <ManageAccountsRoundedIcon />, path: '/admin/users' },
    { text: 'ניהול אירועים', icon: <EventRoundedIcon />, path: '/admin/events' },
    { text: 'רכישות ובילינג', icon: <ShoppingCartRoundedIcon />, path: '/admin/purchases' },
    { text: 'הגדרות מערכת', icon: <SettingsRoundedIcon />, path: '/admin/settings' },
  ];

  const visiblePrimary = primary.filter((i) => !i.feature || hasFeature(selectedEvent?.planId, i.feature));

  const go = (path: string) => { navigate(path); onItemClick?.(); };

  const itemSx = (selected: boolean) => ({
    borderRadius: 2.5,
    mb: 0.25,
    px: 1.5,
    py: 1.05,
    minHeight: 0,
    color: selected ? DEEP : 'text.secondary',
    bgcolor: selected ? alpha(BRAND, isDark ? 0.18 : 0.1) : 'transparent',
    transition: 'background-color .15s ease, color .15s ease',
    '& .MuiListItemIcon-root': { minWidth: 32, color: selected ? DEEP : (isDark ? alpha('#fff', 0.55) : alpha(theme.palette.text.primary, 0.55)) },
    '& .MuiListItemText-primary': { fontSize: '0.92rem', fontWeight: selected ? 700 : 500, textAlign: 'right' as const },
    '&:hover': { bgcolor: selected ? alpha(BRAND, isDark ? 0.22 : 0.14) : alpha(theme.palette.text.primary, isDark ? 0.06 : 0.04) },
  });

  const renderItem = (item: NavItem) => {
    const selected = location.pathname === item.path;
    return (
      <ListItemButton key={item.path} dir="rtl" onClick={() => go(item.path)} sx={itemSx(selected)}>
        <ListItemIcon>{item.icon}</ListItemIcon>
        <ListItemText primary={item.text} />
      </ListItemButton>
    );
  };

  return (
    <List sx={{ px: 1.5, py: 0 }}>
      {visiblePrimary.map(renderItem)}

      <Typography sx={{ px: 1.5, pt: 2, pb: 0.75, fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.08em', color: 'text.disabled', textAlign: 'right' }}>
        החשבון
      </Typography>
      {secondary.map(renderItem)}

      {isAdmin && (
        <>
          <ListItemButton dir="rtl" onClick={() => setAdminOpen((v) => !v)} sx={itemSx(false)}>
            <ListItemIcon><SettingsRoundedIcon /></ListItemIcon>
            <ListItemText primary="ניהול מערכת" />
            {adminOpen ? <ExpandLessRoundedIcon sx={{ color: 'text.disabled' }} /> : <ExpandMoreRoundedIcon sx={{ color: 'text.disabled' }} />}
          </ListItemButton>
          <Collapse in={adminOpen} timeout="auto" unmountOnExit>
            <Box sx={{ pr: 1.5 }}>{adminItems.map(renderItem)}</Box>
          </Collapse>
        </>
      )}
    </List>
  );
}
