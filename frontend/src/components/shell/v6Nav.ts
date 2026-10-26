/**
 * Design v6 navigation model. Icons are Material Symbols names (rendered with
 * the `.ms` class). Counts are attached at render time from the Snapshot.
 */
export type V6NavId = 'home' | 'insights' | 'guests' | 'campaigns' | 'seating' | 'invitation' | 'settings' | 'recap';

export interface V6NavItem {
  id: string;
  label: string;
  path: string;
  icon: string;
}

export const ownerNav: V6NavItem[] = [
  { id: 'home', label: 'סקירה', path: '/overview', icon: 'home' },
  { id: 'insights', label: 'תמונת מצב', path: '/insights', icon: 'insights' },
  { id: 'guests', label: 'מוזמנים', path: '/guests', icon: 'groups' },
  { id: 'campaigns', label: 'סבבי שליחה', path: '/messages', icon: 'send' },
  { id: 'seating', label: 'הושבה', path: '/seating', icon: 'table_bar' },
  { id: 'invitation', label: 'דף ההזמנה', path: '/invitation', icon: 'mail' },
  { id: 'settings', label: 'הגדרות', path: '/settings', icon: 'tune' },
];

export const recapNav: V6NavItem = { id: 'recap', label: 'סיכום החגיגה', path: '/recap', icon: 'celebration' };

export const venueNav: V6NavItem[] = [
  { id: 'venue', label: 'ניהול האולם', path: '/venue', icon: 'storefront' },
  { id: 'venue-settings', label: 'הגדרות האולם', path: '/venue/settings', icon: 'tune' },
];

export const adminNav: V6NavItem[] = [
  { id: 'a-dash', label: 'לוח בקרה', path: '/admin', icon: 'space_dashboard' },
  { id: 'a-ops', label: 'מרכז תפעול', path: '/admin/operations', icon: 'insights' },
  { id: 'a-venues', label: 'אולמות', path: '/admin/venues', icon: 'storefront' },
  { id: 'a-users', label: 'משתמשים', path: '/admin/users', icon: 'group' },
  { id: 'a-events', label: 'אירועים', path: '/admin/events', icon: 'event' },
  { id: 'a-subs', label: 'מנויים', path: '/admin/subscriptions', icon: 'receipt_long' },
  { id: 'a-plans', label: 'חבילות', path: '/admin/plans', icon: 'layers' },
  { id: 'a-coupons', label: 'קופונים', path: '/admin/coupons', icon: 'sell' },
  { id: 'a-ent', label: 'הזמנות למימוש', path: '/admin/entitlements', icon: 'redeem' },
  { id: 'a-flags', label: 'דגלי מערכת', path: '/admin/feature-flags', icon: 'flag' },
  { id: 'a-mon', label: 'ניטור', path: '/admin/monitoring', icon: 'monitor_heart' },
  { id: 'a-flows', label: 'שיחת אישור הגעה', path: '/admin/flows', icon: 'forum' },
  { id: 'a-flow-builder', label: 'בונה שיחה', path: '/admin/flow-builder', icon: 'account_tree' },
  { id: 'a-audit', label: 'יומן ביקורת', path: '/admin/audit-log', icon: 'history' },
];

/** Mobile tab bar (Mobile Flows: בית / מוזמנים / שליחה / שולחנות). */
export const mobileTabs: V6NavItem[] = [
  { id: 'home', label: 'בית', path: '/overview', icon: 'home' },
  { id: 'guests', label: 'מוזמנים', path: '/guests', icon: 'groups' },
  { id: 'campaigns', label: 'שליחה', path: '/messages', icon: 'send' },
  { id: 'seating', label: 'שולחנות', path: '/seating', icon: 'table_bar' },
];

export const isActivePath = (pathname: string, path: string) =>
  pathname === path || (path !== '/admin' && pathname.startsWith(path + '/')) || (path === '/admin' && pathname === '/admin');
