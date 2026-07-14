import React, { useState } from 'react';
import { Box, Typography, Tooltip, alpha, useTheme } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded';
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { primaryNav, accountNav, NavItem } from './navConfig';
import EventSwitcher from './EventSwitcher';
import UserAvatar from '../UserAvatar';
import OptionsMenu from '../OptionsMenu';
import { useUser } from '../../contexts/UserContext';
import { useEvent } from '../../contexts/EventContext';
import { useBanner } from '../../contexts/BannerContext';
import { useVenueAdmin } from '../../hooks/useVenueAdmin';

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
  const { user, isAdmin } = useUser();
  const { selectedEvent } = useEvent();
  const { isBannerVisible } = useBanner();
  const { isVenueAdmin } = useVenueAdmin();
  const [expanded, setExpanded] = useState(false);

  // Venue admins get links to their venue dashboard + settings in the account group.
  const accountItems: NavItem[] = isVenueAdmin
    ? [
        { label: 'ניהול האולם', path: '/venue', icon: <StorefrontRoundedIcon /> },
        { label: 'הגדרות האולם', path: '/venue/settings', icon: <TuneRoundedIcon /> },
        ...accountNav,
      ]
    : accountNav;

  // System admins get the ops console group (gated on the admin role).
  const adminItems: NavItem[] = [
    { label: 'לוח בקרה', path: '/admin', icon: <SpaceDashboardRoundedIcon /> },
    { label: 'אולמות', path: '/admin/venues', icon: <StorefrontRoundedIcon /> },
    { label: 'משתמשים', path: '/admin/users', icon: <PeopleRoundedIcon /> },
    { label: 'אירועים', path: '/admin/events', icon: <EventRoundedIcon /> },
    { label: 'מנויים', path: '/admin/subscriptions', icon: <ReceiptLongRoundedIcon /> },
    { label: 'חבילות', path: '/admin/plans', icon: <LayersRoundedIcon /> },
    { label: 'קופונים', path: '/admin/coupons', icon: <LocalOfferRoundedIcon /> },
    { label: 'דגלי מערכת', path: '/admin/feature-flags', icon: <FlagRoundedIcon /> },
    { label: 'ניטור', path: '/admin/monitoring', icon: <MonitorHeartRoundedIcon /> },
    { label: 'יומן ביקורת', path: '/admin/audit-log', icon: <HistoryRoundedIcon /> },
  ];

  const items = primaryNav;

  const Row = ({ item }: { item: NavItem }) => {
    // Sub-routes (e.g. /guests/imported) must keep their section lit.
    const selected = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
    const row = (
      <Box
        component="button"
        aria-current={selected ? 'page' : undefined}
        aria-label={item.label}
        onClick={() => navigate(item.path)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(item.path); }
        }}
        sx={{
          position: 'relative', width: '100%', border: 'none', font: 'inherit', textAlign: 'start',
          display: 'flex', alignItems: 'center', gap: 1.75,
          height: 46, px: '14px', borderRadius: 3, cursor: 'pointer',
          color: selected ? DEEP : (isDark ? alpha('#fff', 0.62) : alpha(theme.palette.text.primary, 0.62)),
          bgcolor: selected ? alpha(BRAND, isDark ? 0.2 : 0.11) : 'transparent',
          transition: 'background-color .18s ease, color .18s ease',
          '&:hover': { bgcolor: selected ? alpha(BRAND, isDark ? 0.24 : 0.15) : alpha(theme.palette.text.primary, isDark ? 0.07 : 0.045) },
          '&:focus-visible': { outline: `2px solid ${BRAND}`, outlineOffset: 2 },
          '& svg': { fontSize: 24, flexShrink: 0 },
        }}
      >
        <Box sx={{ position: 'relative', display: 'flex' }}>
          {item.icon}
        </Box>
        <Typography sx={{ fontSize: '0.93rem', fontWeight: selected ? 800 : 600, whiteSpace: 'nowrap', opacity: expanded ? 1 : 0, transform: expanded ? 'none' : 'translateX(6px)', transition: 'opacity .18s ease, transform .2s ease', color: selected ? DEEP : 'text.primary' }}>
          {item.label}
        </Typography>
      </Box>
    );
    // Collapsed rail is icon-only - a tooltip names the destination without hovering
    // long enough to expand the whole rail.
    return expanded ? row : (
      <Tooltip title={item.label} placement="left" arrow>{row}</Tooltip>
    );
  };

  return (
    <Box
      component="nav"
      aria-label="ניווט ראשי"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      // Keyboard users get the same expansion hover users do.
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setExpanded(false);
      }}
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

      {/* Scrollable nav region - EventSwitcher (above) and the user footer
          (below) stay pinned; the nav groups scroll when they overflow (e.g. the
          admin console adds many items on shorter screens). */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0, // required so this flex child can shrink and scroll
          overflowY: 'auto',
          overflowX: 'hidden',
          // Thin, subtle scrollbar that doesn't fight the glass rail.
          scrollbarWidth: 'thin',
          scrollbarColor: `${alpha(theme.palette.text.primary, 0.25)} transparent`,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.text.primary, 0.2), borderRadius: 4 },
          '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
        }}
      >
        {/* Primary nav */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, mt: 2 }}>
          {items.map((item) => <Row key={item.path} item={item} />)}
        </Box>

        {/* Account group */}
        <Typography sx={{ px: '14px', pt: 2.5, pb: 0.75, fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.1em', color: 'text.disabled', whiteSpace: 'nowrap', opacity: expanded ? 1 : 0, transition: 'opacity .18s ease', height: expanded ? 'auto' : 8 }}>
          החשבון
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
          {accountItems.map((item) => <Row key={item.path} item={item} />)}
        </Box>

        {/* System admin console (role-gated) */}
        {isAdmin && (
          <>
            <Typography sx={{ px: '14px', pt: 2.5, pb: 0.75, fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.1em', color: 'text.disabled', whiteSpace: 'nowrap', opacity: expanded ? 1 : 0, transition: 'opacity .18s ease', height: expanded ? 'auto' : 8 }}>
              ניהול מערכת
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
              {adminItems.map((item) => <Row key={item.path} item={item} />)}
            </Box>
          </>
        )}
      </Box>

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
