import React, { useState } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { primaryNav, accountNav, NavItem } from './navConfig';
import EventSwitcher from './EventSwitcher';
import UserAvatar from '../UserAvatar';
import OptionsMenu from '../OptionsMenu';
import { useUser } from '../../contexts/UserContext';
import { useEvent } from '../../contexts/EventContext';
import { useBanner } from '../../contexts/BannerContext';
import { hasFeature } from '../../config/entitlements';

const BRAND = '#888cee';
const DEEP = '#6f74e0';
const COLLAPSED = 76;
const EXPANDED = 264;

/**
 * A glass rail that floats above the page (not a Drawer). Collapsed shows icons;
 * hovering expands it to reveal labels - as an overlay, so the page never reflows.
 */
export default function AppRail() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { selectedEvent } = useEvent();
  const { isBannerVisible } = useBanner();
  const [expanded, setExpanded] = useState(false);

  const items = primaryNav.filter((i) => !i.feature || hasFeature(selectedEvent?.planId, i.feature));

  const Row = ({ item }: { item: NavItem }) => {
    const selected = location.pathname === item.path;
    return (
      <Box
        role="button"
        onClick={() => navigate(item.path)}
        sx={{
          position: 'relative',
          display: 'flex', alignItems: 'center', gap: 1.75,
          height: 46, px: '14px', borderRadius: 3, cursor: 'pointer',
          color: selected ? DEEP : (isDark ? alpha('#fff', 0.62) : alpha(theme.palette.text.primary, 0.62)),
          bgcolor: selected ? alpha(BRAND, isDark ? 0.2 : 0.11) : 'transparent',
          transition: 'background-color .18s ease, color .18s ease',
          '&:hover': { bgcolor: selected ? alpha(BRAND, isDark ? 0.24 : 0.15) : alpha(theme.palette.text.primary, isDark ? 0.07 : 0.045) },
          '& svg': { fontSize: 24, flexShrink: 0 },
        }}
      >
        {item.icon}
        <Typography sx={{ fontSize: '0.93rem', fontWeight: selected ? 800 : 600, whiteSpace: 'nowrap', opacity: expanded ? 1 : 0, transform: expanded ? 'none' : 'translateX(6px)', transition: 'opacity .18s ease, transform .2s ease', color: selected ? DEEP : 'text.primary' }}>
          {item.label}
        </Typography>
      </Box>
    );
  };

  return (
    <Box
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      sx={{
        display: { xs: 'none', md: 'flex' },
        position: 'fixed',
        top: isBannerVisible ? 64 : 16,
        bottom: 16,
        right: 16, // physical right - in RTL `inset-inline-end` would land on the left
        zIndex: 1250,
        width: expanded ? EXPANDED : COLLAPSED,
        transition: 'width .28s cubic-bezier(.2,.8,.2,1), box-shadow .28s ease',
        flexDirection: 'column',
        p: 1.25,
        borderRadius: 5,
        overflow: 'hidden',
        bgcolor: isDark ? alpha('#16161c', 0.75) : alpha('#ffffff', 0.72),
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        border: '1px solid',
        borderColor: isDark ? alpha('#fff', 0.08) : alpha('#0f172a', 0.06),
        boxShadow: expanded
          ? `0 24px 60px ${alpha('#0f172a', isDark ? 0.6 : 0.16)}`
          : `0 10px 30px ${alpha('#0f172a', isDark ? 0.45 : 0.08)}`,
      }}
    >
      {/* Event switcher */}
      <EventSwitcher expanded={expanded} />

      {/* Primary nav */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, mt: 2 }}>
        {items.map((item) => <Row key={item.path} item={item} />)}
      </Box>

      {/* Account group */}
      <Typography sx={{ px: '14px', pt: 2.5, pb: 0.75, fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.1em', color: 'text.disabled', whiteSpace: 'nowrap', opacity: expanded ? 1 : 0, transition: 'opacity .18s ease', height: expanded ? 'auto' : 8 }}>
        החשבון
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
        {accountNav.map((item) => <Row key={item.path} item={item} />)}
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* User */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1, borderRadius: 3, bgcolor: isDark ? alpha('#fff', 0.04) : alpha(theme.palette.text.primary, 0.03) }}>
        <Box sx={{ flexShrink: 0 }}><UserAvatar username={user?.username || 'Guest'} /></Box>
        <Box sx={{ flex: 1, minWidth: 0, opacity: expanded ? 1 : 0, transition: 'opacity .18s ease', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <Typography noWrap sx={{ fontSize: '0.85rem', fontWeight: 700, color: 'text.primary' }}>{user?.username || 'אורח'}</Typography>
        </Box>
        <Box sx={{ flexShrink: 0, opacity: expanded ? 1 : 0, transition: 'opacity .18s ease', pointerEvents: expanded ? 'auto' : 'none' }}><OptionsMenu /></Box>
      </Box>
    </Box>
  );
}
