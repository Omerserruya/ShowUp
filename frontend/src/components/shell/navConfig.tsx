import React from 'react';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import EventSeatRoundedIcon from '@mui/icons-material/EventSeatRounded';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';

export interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

/** Warm, product-oriented language - this app helps organize a celebration. */
export const primaryNav: NavItem[] = [
  { label: 'הבית', path: '/overview', icon: <HomeRoundedIcon /> },
  { label: 'האורחים', path: '/guests', icon: <GroupsRoundedIcon /> },
  { label: 'ההזמנה', path: '/invitation', icon: <MailRoundedIcon /> },
  { label: 'תזכורות', path: '/messages', icon: <CampaignRoundedIcon /> },
  { label: 'הושבה', path: '/seating', icon: <EventSeatRoundedIcon /> },
];

export const accountNav: NavItem[] = [
  { label: 'סיכום החגיגה', path: '/recap', icon: <CelebrationRoundedIcon /> },
  { label: 'הגדרות', path: '/settings', icon: <SettingsRoundedIcon /> },
];

/**
 * Quick-access items for the mobile dock - the four most-used product areas.
 * Settings lives in the "עוד" sheet; it must not outrank core features on the
 * most thumb-reachable surface.
 */
export const mobileNav: NavItem[] = [
  { label: 'הבית', path: '/overview', icon: <HomeRoundedIcon /> },
  { label: 'האורחים', path: '/guests', icon: <GroupsRoundedIcon /> },
  { label: 'ההזמנה', path: '/invitation', icon: <MailRoundedIcon /> },
  { label: 'תזכורות', path: '/messages', icon: <CampaignRoundedIcon /> },
];

/**
 * Warm header per route - rendered in-flow by PageHeader. Only pages that don't
 * already render their own title appear here (others - Invitation, Templates,
 * Team, Billing, Recap, Profile - own their headers internally), so there's never
 * a duplicate heading.
 */
export const pageMeta: Record<string, { title: string; subtitle?: string }> = {
  // '/guests' renders its title inside the summary band (GuestsSummary), not here.
  '/messages': { title: 'תזכורות והודעות', subtitle: 'אנחנו נדאג שכולם יידעו ויגיעו' },
  '/seating': { title: 'סידור מושבים', subtitle: 'מי יושב ליד מי' },
  '/admin/users': { title: 'ניהול משתמשים' },
  '/admin/events': { title: 'ניהול אירועים' },
  '/admin/plans': { title: 'חבילות ומהדורות' },
  '/admin/purchases': { title: 'רכישות ובילינג' },
  '/admin/settings': { title: 'הגדרות מערכת' },
};
