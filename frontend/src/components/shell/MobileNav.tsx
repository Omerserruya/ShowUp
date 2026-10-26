import React, { useState } from 'react';
import { Box } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { color as C } from '../../design/tokens';
import { mobileTabs, ownerNav, recapNav, adminNav, venueNav, isActivePath, V6NavItem } from './v6Nav';
import EventSwitcher from './EventSwitcher';
import OptionsMenu from '../OptionsMenu';
import { useUser } from '../../contexts/UserContext';
import { useVenueAdmin } from '../../hooks/useVenueAdmin';
import { useSnapshot } from '../../contexts/SnapshotContext';

/**
 * Mobile navigation, design v6 ("Mobile Flows"): a flat bottom tab bar
 * (בית / מוזמנים / שליחה / שולחנות + עוד) and a bottom sheet with the event
 * switcher and the rest of the navigation.
 */
export default function MobileNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, isAdmin } = useUser();
  const { isVenueAdmin } = useVenueAdmin();
  const { snapshot } = useSnapshot();
  const [open, setOpen] = useState(false);

  const go = (path: string) => { navigate(path); setOpen(false); };
  const eventOver = (snapshot?.event.daysUntil ?? 1) < 0;
  const sheetItems: V6NavItem[] = [
    ...ownerNav.filter((n) => !mobileTabs.some((t) => t.path === n.path)),
    ...(eventOver ? [recapNav] : []),
    ...(isVenueAdmin ? venueNav : []),
    ...(isAdmin ? adminNav : []),
  ];

  const tab = (t: V6NavItem | { id: string; label: string; icon: string; path?: string }, on: boolean, onClick: () => void) => (
    <Box
      key={t.id}
      component="button"
      type="button"
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', minWidth: 62, minHeight: 50, borderRadius: '14px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: on ? C.purpleDark : C.muted, fontWeight: on ? 600 : 400, bgcolor: on ? C.tintApp : 'transparent' }}
    >
      <span className="ms" style={{ fontSize: 23 }}>{t.icon}</span>
      {t.label}
    </Box>
  );

  return (
    <Box sx={{ display: { xs: 'block', md: 'none' } }}>
      <Box component="nav" aria-label="ניווט ראשי" sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1250, display: 'flex', justifyContent: 'space-around', p: '8px 8px calc(10px + env(safe-area-inset-bottom))', bgcolor: 'rgba(250,248,244,.96)', backdropFilter: 'blur(10px)', borderTop: `1.5px solid ${C.lineApp}` }}>
        {mobileTabs.map((t) => tab(t, isActivePath(pathname, t.path), () => go(t.path)))}
        {tab({ id: 'more', label: 'עוד', icon: 'menu' }, open || sheetItems.some((n) => isActivePath(pathname, n.path)), () => setOpen(true))}
      </Box>

      <Box sx={{ position: 'fixed', inset: 0, zIndex: 1300, pointerEvents: open ? 'auto' : 'none', visibility: open ? 'visible' : 'hidden', transition: 'visibility 0s linear ' + (open ? '0s' : '.32s') }} aria-hidden={!open}>
        <Box onClick={() => setOpen(false)} sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(22,21,15,.4)', opacity: open ? 1 : 0, transition: 'opacity .25s ease' }} />
        <Box dir="rtl" role="dialog" aria-label="תפריט" sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', gap: 1.5, p: '10px 18px calc(28px + env(safe-area-inset-bottom))', bgcolor: C.paper, borderRadius: '26px 26px 0 0', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .32s cubic-bezier(.2,.8,.2,1)', maxHeight: '88vh', overflowY: 'auto' }}>
          <Box sx={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 99, bgcolor: C.field, m: '2px 0 4px' }} />
          <EventSwitcher expanded variant="card" />
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {sheetItems.map((n) => {
              const on = isActivePath(pathname, n.path);
              return (
                <Box key={n.id} component="button" type="button" onClick={() => go(n.path)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 52, px: 0.5, border: 'none', borderBottom: `1.5px solid ${C.line2}`, bgcolor: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: on ? 600 : 500, color: on ? C.purpleDark : C.ink, textAlign: 'right' }}>
                  <Box component="span" sx={{ width: 42, height: 42, flex: 'none', borderRadius: '12px', bgcolor: C.tintApp, color: C.purpleDark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: 22 }}>{n.icon}</span></Box>
                  <Box component="span" sx={{ flex: 1 }}>{n.label}</Box>
                  <span className="ms" style={{ fontSize: 22, color: C.muted }}>chevron_left</span>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
            <Box component="span" sx={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{user?.username || 'החשבון שלי'}</Box>
            <OptionsMenu />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
