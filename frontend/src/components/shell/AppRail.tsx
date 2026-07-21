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
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { primaryNav, accountNav, NavItem } from './navConfig';
import ViewModeSwitcher, { ViewMode, VIEW_MODE_META } from './ViewModeSwitcher';
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

/** Shared style for a nav group's section label (collapses to a thin gap). */
const GROUP_LABEL = (expanded: boolean) => ({
  px: '14px', pt: 2.5, pb: 0.75, fontSize: '0.64rem', fontWeight: 800,
  letterSpacing: '0.1em', color: 'text.disabled', whiteSpace: 'nowrap',
  opacity: expanded ? 1 : 0, transition: 'opacity .18s ease',
  height: expanded ? 'auto' : 8,
} as const);

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

  // Which contexts this user can work in. A regular owner has only 'owner' and
  // never sees the switcher; power users switch between them so each view is clean.
  const availableModes: ViewMode[] = React.useMemo(() => {
    const m: ViewMode[] = ['owner'];
    if (isAdmin) m.push('admin');
    if (isVenueAdmin) m.push('venue');
    return m;
  }, [isAdmin, isVenueAdmin]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = (localStorage.getItem('showup_view_mode') || 'owner') as ViewMode;
    return saved;
  });
  // Never leave the user in a mode they no longer have access to.
  const mode: ViewMode = availableModes.includes(viewMode) ? viewMode : 'owner';

  const switchMode = (m: ViewMode) => {
    setViewMode(m);
    try { localStorage.setItem('showup_view_mode', m); } catch { /* private mode */ }
    navigate(VIEW_MODE_META[m].home);   // jump to that context's home
  };

  // Venue management items (shown in venue mode).
  const venueItems: NavItem[] = [
    { label: 'ניהול האולם', path: '/venue', icon: <StorefrontRoundedIcon /> },
    { label: 'הגדרות האולם', path: '/venue/settings', icon: <TuneRoundedIcon /> },
  ];

  // System admins get the ops console group (gated on the admin role).
  const adminItems: NavItem[] = [
    { label: 'לוח בקרה', path: '/admin', icon: <SpaceDashboardRoundedIcon /> },
    { label: 'מרכז תפעול', path: '/admin/operations', icon: <InsightsRoundedIcon /> },
    { label: 'אולמות', path: '/admin/venues', icon: <StorefrontRoundedIcon /> },
    { label: 'משתמשים', path: '/admin/users', icon: <PeopleRoundedIcon /> },
    { label: 'אירועים', path: '/admin/events', icon: <EventRoundedIcon /> },
    { label: 'מנויים', path: '/admin/subscriptions', icon: <ReceiptLongRoundedIcon /> },
    { label: 'חבילות', path: '/admin/plans', icon: <LayersRoundedIcon /> },
    { label: 'קופונים', path: '/admin/coupons', icon: <LocalOfferRoundedIcon /> },
    { label: 'הזמנות למימוש', path: '/admin/entitlements', icon: <CardGiftcardRoundedIcon /> },
    { label: 'דגלי מערכת', path: '/admin/feature-flags', icon: <FlagRoundedIcon /> },
    { label: 'ניטור', path: '/admin/monitoring', icon: <MonitorHeartRoundedIcon /> },
    { label: 'יומן ביקורת', path: '/admin/audit-log', icon: <HistoryRoundedIcon /> },
  ];


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
      {/* View-mode switcher: power users flip between owner / admin / venue so
          each context stays uncluttered. Hidden for regular owners. */}
      {availableModes.length > 1 && (
        <Box sx={{ mb: 1 }}>
          <ViewModeSwitcher modes={availableModes} value={mode} onChange={switchMode} expanded={expanded} />
        </Box>
      )}

      {/* Event switcher - only relevant while working on your own event. */}
      {mode === 'owner' && <EventSwitcher expanded={expanded} />}

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
        {/* One context at a time - only the active mode's group renders. */}
        {mode === 'owner' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, mt: 2 }}>
            {primaryNav.map((item) => <Row key={item.path} item={item} />)}
          </Box>
        )}

        {mode === 'admin' && (
          <>
            <Typography sx={GROUP_LABEL(expanded)}>ניהול מערכת</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
              {adminItems.map((item) => <Row key={item.path} item={item} />)}
            </Box>
          </>
        )}

        {mode === 'venue' && (
          <>
            <Typography sx={GROUP_LABEL(expanded)}>ניהול האולם</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
              {venueItems.map((item) => <Row key={item.path} item={item} />)}
            </Box>
          </>
        )}

        {/* Account group - shared across every mode. */}
        <Typography sx={GROUP_LABEL(expanded)}>החשבון</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
          {accountNav.map((item) => <Row key={item.path} item={item} />)}
        </Box>
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
