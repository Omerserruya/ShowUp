import React, { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { color as C } from '../../design/tokens';
import EventSwitcher from './EventSwitcher';
import OptionsMenu from '../OptionsMenu';
import ViewModeSwitcher, { ViewMode, VIEW_MODE_META } from './ViewModeSwitcher';
import { ownerNav, adminNav, venueNav, recapNav, isActivePath, V6NavItem } from './v6Nav';
import { useUser } from '../../contexts/UserContext';
import { useVenueAdmin } from '../../hooks/useVenueAdmin';
import { useSnapshot } from '../../contexts/SnapshotContext';
import NextStepCard from './NextStepCard';

export const SIDENAV_WIDTH = 244;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0][0];
  return `${parts[0][0]}״${parts[parts.length - 1][0]}`;
}

/**
 * Desktop sidebar, design v6 ("Platform v6"): wordmark, event card, nav with
 * live counts, the "next step" card and the signed-in user.
 */
export default function SideNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, isAdmin } = useUser();
  const { isVenueAdmin } = useVenueAdmin();
  const { snapshot } = useSnapshot();

  const availableModes: ViewMode[] = useMemo(() => {
    const m: ViewMode[] = ['owner'];
    if (isAdmin) m.push('admin');
    if (isVenueAdmin) m.push('venue');
    return m;
  }, [isAdmin, isVenueAdmin]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('showup_view_mode') || 'owner') as ViewMode);
  const mode: ViewMode = availableModes.includes(viewMode) ? viewMode : 'owner';
  const switchMode = (m: ViewMode) => {
    setViewMode(m);
    try { localStorage.setItem('showup_view_mode', m); } catch { /* private mode */ }
    navigate(VIEW_MODE_META[m].home);
  };

  const counts: Record<string, string> = {};
  if (snapshot) {
    const s = snapshot;
    counts.guests = s.pendingImports ? `${s.invitations.total} · +${s.pendingImports}` : String(s.invitations.total || '');
    counts.campaigns = s.rounds.length ? String(s.rounds.length) : '';
    counts.seating = s.unseated.length ? String(s.unseated.length) : '';
  }
  const eventOver = (snapshot?.event.daysUntil ?? 1) < 0;
  const items: V6NavItem[] = mode === 'admin' ? adminNav : mode === 'venue' ? venueNav : [...ownerNav, ...(eventOver ? [recapNav] : [])];

  const name = user?.username || '';

  return (
    <Box
      component="nav"
      aria-label="ניווט ראשי"
      sx={{ width: SIDENAV_WIDTH, flex: 'none', position: 'sticky', top: 0, height: '100vh', overflow: 'auto', p: '22px 16px 18px', display: { xs: 'none', md: 'flex' }, flexDirection: 'column', bgcolor: 'rgba(250,248,244,.9)', borderLeft: `1.5px solid ${C.lineApp}` }}
    >
      <Box component="a" href="/overview" onClick={(e: React.MouseEvent) => { e.preventDefault(); navigate('/overview'); }} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 0.75, pb: '22px', color: C.ink, textDecoration: 'none' }}>
        <img src="/brand/seal.png" alt="" style={{ width: 34, height: 34, objectFit: 'contain' }} />
        <Box component="span" sx={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>ShowUp</Box>
      </Box>

      {availableModes.length > 1 && (
        <Box sx={{ mb: 1.5 }}>
          <ViewModeSwitcher modes={availableModes} value={mode} onChange={switchMode} expanded />
        </Box>
      )}

      {mode === 'owner' && <EventSwitcher expanded variant="card" />}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', mt: '18px' }}>
        {items.map((n) => {
          const on = isActivePath(pathname, n.path);
          return (
            <Box
              key={n.id}
              component="button"
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => navigate(n.path)}
              className={on ? undefined : 'su-hover-soft'}
              sx={{ display: 'flex', alignItems: 'center', gap: '11px', width: '100%', minHeight: 44, px: 1.5, borderRadius: '12px', border: 'none', cursor: 'pointer', fontSize: 15, fontFamily: 'inherit', fontWeight: on ? 600 : 500, bgcolor: on ? C.tintApp : 'transparent', color: on ? C.purpleDark : C.body, boxShadow: on ? `inset 0 0 0 1.5px ${C.tintBorder}` : 'none' }}
            >
              <span className="ms" style={{ fontSize: 21, color: on ? C.purple : C.muted }}>{n.icon}</span>
              <Box component="span" sx={{ flex: 1, textAlign: 'right' }}>{n.label}</Box>
              {counts[n.id] && <Box component="span" className="num" sx={{ fontSize: 11.5, color: on ? C.purpleDark : C.muted }}>{counts[n.id]}</Box>}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ flex: 1, minHeight: 22 }} />

      {mode === 'owner' && <NextStepCard />}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 2, pt: '14px', px: 0.75, borderTop: `1.5px solid ${C.lineApp}` }}>
        <Box component="span" sx={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', bgcolor: '#F1ECFB', color: C.purpleDark, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(name) || <span className="ms" style={{ fontSize: 18 }}>person</span>}</Box>
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          <Box component="span" sx={{ display: 'block', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'החשבון שלי'}</Box>
          {(user?.email || user?.phone) && (
            <Box component="span" className="ltr" sx={{ display: 'block', fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{user?.email || user?.phone}</Box>
          )}
        </Box>
        <OptionsMenu />
      </Box>
    </Box>
  );
}
