import React, { useState } from 'react';
import { Box } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { color as C } from '../../design/tokens';
import { useSnapshot } from '../../contexts/SnapshotContext';
import { useEvent } from '../../contexts/EventContext';
import { useBanner } from '../../contexts/BannerContext';

const STATIC_TITLES: Record<string, [string, string]> = {
  '/invitation': ['דף ההזמנה באינטרנט', 'ההזמנה'],
  '/settings': ['אירוע, צוות וחשבון', 'הגדרות'],
  '/recap': ['אחרי האירוע', 'סיכום החגיגה'],
  '/guests/imported': ['מוואטסאפ', 'ממתינים לאישור'],
  '/venue': ['האולם', 'ניהול האולם'],
  '/venue/settings': ['האולם', 'הגדרות האולם'],
  '/admin': ['ניהול מערכת', 'לוח בקרה'],
  '/admin/operations': ['ניהול מערכת', 'מרכז תפעול'],
  '/admin/venues': ['ניהול מערכת', 'אולמות'],
  '/admin/users': ['ניהול מערכת', 'משתמשים'],
  '/admin/events': ['ניהול מערכת', 'אירועים'],
  '/admin/subscriptions': ['ניהול מערכת', 'מנויים'],
  '/admin/plans': ['ניהול מערכת', 'חבילות'],
  '/admin/coupons': ['ניהול מערכת', 'קופונים'],
  '/admin/entitlements': ['ניהול מערכת', 'הזמנות למימוש'],
  '/admin/feature-flags': ['ניהול מערכת', 'דגלי מערכת'],
  '/admin/monitoring': ['ניהול מערכת', 'ניטור'],
  '/admin/audit-log': ['ניהול מערכת', 'יומן ביקורת'],
};

/** Kicker + title for the current route, from live event data where relevant. */
export function usePageTitle(): [string, string] {
  const { pathname } = useLocation();
  const { snapshot } = useSnapshot();
  const { selectedEvent } = useEvent();
  const s = snapshot;
  const when = s?.event.shortDate || '';
  switch (pathname) {
    case '/overview':
      return [[when, s?.event.venue].filter(Boolean).join(' · '), selectedEvent?.name || 'האירוע'];
    case '/insights':
      return [when ? ((s?.event.daysUntil ?? 0) < 0 ? `האירוע היה ב־${when}` : `לקראת ${when}`) : 'האירוע', 'תמונת מצב'];
    case '/guests':
      return [s ? `${s.invitations.total} מוזמנים · ${s.people.invited} נפשות` : 'מוזמנים', 'רשימת המוזמנים'];
    case '/messages':
      return [s ? (s.nextRound ? `הסבב הבא: ${s.nextRound.whenLabel}` : `${s.rounds.length} סבבים`) : 'וואטסאפ', 'סבבי שליחה'];
    case '/seating':
      return [s ? `${s.tables.length} שולחנות · ${s.unseated.length} בלי שולחן` : 'שולחנות', 'הושבה'];
    default:
      return STATIC_TITLES[pathname] || ['', ''];
  }
}

/**
 * Sticky page header (design v6): letter-spaced kicker + page title, and a
 * guest search that jumps to the guest list.
 */
export default function AppHeader() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isBannerVisible } = useBanner();
  const [kicker, title] = usePageTitle();
  const [q, setQ] = useState('');
  const eventScoped = !pathname.startsWith('/admin') && !pathname.startsWith('/venue');

  if (!title) return null;

  return (
    <Box component="header" sx={{ position: 'sticky', top: isBannerVisible ? '48px' : 0, zIndex: 1100, bgcolor: 'rgba(245,241,233,.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: `1.5px solid ${C.lineApp}` }}>
      <Box sx={{ maxWidth: 1240, mx: 'auto', px: { xs: 2.25, md: 4 }, pt: { xs: 1.75, md: 2.25 }, pb: { xs: 1.5, md: 2 }, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2.25, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0 }}>
          {kicker && <Box sx={{ fontSize: 12, letterSpacing: '.06em', color: C.purple, fontWeight: 500 }}>{kicker}</Box>}
          <Box component="h1" sx={{ fontSize: { xs: 22, md: 'clamp(24px,2.6vw,32px)' }, lineHeight: 1.12, letterSpacing: '-0.032em', fontWeight: 600, m: kicker ? '8px 0 0' : 0 }}>{title}</Box>
        </Box>
        {eventScoped && (
          <Box
            component="form"
            role="search"
            onSubmit={(e: React.FormEvent) => { e.preventDefault(); navigate(`/guests${q.trim() ? `?search=${encodeURIComponent(q.trim())}` : ''}`); }}
            sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.1, height: 46, width: 260, maxWidth: '42vw', border: `1.5px solid ${C.field}`, bgcolor: '#FFFFFF', px: 1.75, borderRadius: '13px', '&:focus-within': { borderColor: C.purple } }}
          >
            <span className="ms" style={{ fontSize: 18, color: C.muted }}>search</span>
            <Box
              component="input"
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
              placeholder="חיפוש מוזמן"
              aria-label="חיפוש מוזמן"
              sx={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', bgcolor: 'transparent', fontSize: 14, fontFamily: 'inherit', color: C.ink, '&::placeholder': { color: C.muted } }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
