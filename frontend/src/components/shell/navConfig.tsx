import React from 'react';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import EventSeatRoundedIcon from '@mui/icons-material/EventSeatRounded';
import Diversity3RoundedIcon from '@mui/icons-material/Diversity3Rounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import { Feature } from '../../config/entitlements';

export interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  feature?: Feature;
}

/** Warm, product-oriented language - this app helps organize a celebration. */
export const primaryNav: NavItem[] = [
  { label: 'הבית', path: '/overview', icon: <HomeRoundedIcon /> },
  { label: 'האורחים', path: '/guests', icon: <GroupsRoundedIcon /> },
  { label: 'ההזמנה', path: '/invitation', icon: <MailRoundedIcon />, feature: 'web_invitation' },
  { label: 'תזכורות', path: '/messages', icon: <CampaignRoundedIcon />, feature: 'whatsapp_campaigns' },
  { label: 'נוסחי הודעה', path: '/templates', icon: <EditNoteRoundedIcon />, feature: 'templates' },
  { label: 'הושבה', path: '/seating', icon: <EventSeatRoundedIcon />, feature: 'seating' },
  { label: 'הצוות', path: '/team', icon: <Diversity3RoundedIcon />, feature: 'team_members' },
];

export const accountNav: NavItem[] = [
  { label: 'החבילה', path: '/billing', icon: <CreditCardRoundedIcon /> },
  { label: 'סיכום החגיגה', path: '/recap', icon: <CelebrationRoundedIcon /> },
  { label: 'הפרופיל', path: '/profile', icon: <PersonRoundedIcon /> },
];

/** Quick-access items for the mobile dock. */
export const mobileNav: NavItem[] = [
  { label: 'הבית', path: '/overview', icon: <HomeRoundedIcon /> },
  { label: 'האורחים', path: '/guests', icon: <GroupsRoundedIcon /> },
  { label: 'תזכורות', path: '/messages', icon: <CampaignRoundedIcon /> },
  { label: 'הפרופיל', path: '/profile', icon: <PersonRoundedIcon /> },
];

/**
 * Warm header per route - rendered in-flow by PageHeader. Only pages that don't
 * already render their own title appear here (others - Invitation, Templates,
 * Team, Billing, Recap, Profile - own their headers internally), so there's never
 * a duplicate heading.
 */
export const pageMeta: Record<string, { title: string; subtitle?: string }> = {
  '/guests': { title: 'האורחים שלכם', subtitle: 'מי הוזמן, מי אישר, ומי עוד מתלבט' },
  '/messages': { title: 'תזכורות והודעות', subtitle: 'אנחנו נדאג שכולם יידעו ויגיעו' },
  '/seating': { title: 'סידור מושבים', subtitle: 'מי יושב ליד מי' },
  '/admin/users': { title: 'ניהול משתמשים' },
  '/admin/events': { title: 'ניהול אירועים' },
  '/admin/purchases': { title: 'רכישות ובילינג' },
  '/admin/settings': { title: 'הגדרות מערכת' },
};
