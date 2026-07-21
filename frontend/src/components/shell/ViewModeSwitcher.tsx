import React from 'react';
import { Box, Typography, Tooltip, alpha, useTheme } from '@mui/material';
import CelebrationRoundedIcon from '@mui/icons-material/CelebrationRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';

/**
 * The context an admin/venue user is currently working in.
 *
 * A power user (system admin, and/or venue admin) also owns events, so their
 * menu used to stack the owner nav, the account group AND the whole admin/venue
 * console at once. This switcher shows ONE context at a time - the rail renders
 * only that mode's groups - so each view stays clean. Regular owners have a
 * single mode and never see the switcher.
 */
export type ViewMode = 'owner' | 'admin' | 'venue';

export const VIEW_MODE_META: Record<ViewMode, { label: string; short: string; home: string; icon: React.ReactNode }> = {
  owner: { label: 'האירוע שלי', short: 'אירוע', home: '/overview', icon: <CelebrationRoundedIcon /> },
  admin: { label: 'ניהול מערכת', short: 'מערכת', home: '/admin', icon: <AdminPanelSettingsRoundedIcon /> },
  venue: { label: 'ניהול האולם', short: 'אולם', home: '/venue', icon: <StorefrontRoundedIcon /> },
};

const BRAND = '#888cee';
const DEEP = '#6f74e0';

export default function ViewModeSwitcher({
  modes, value, onChange, expanded,
}: {
  modes: ViewMode[];
  value: ViewMode;
  onChange: (m: ViewMode) => void;
  expanded: boolean;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  if (modes.length < 2) return null;

  // Collapsed rail: a single icon that cycles to the next available mode.
  if (!expanded) {
    const idx = Math.max(0, modes.indexOf(value));
    const next = modes[(idx + 1) % modes.length];
    return (
      <Tooltip title={`תצוגה: ${VIEW_MODE_META[value].label} · לחצו להחלפה`} placement="left" arrow>
        <Box
          component="button"
          aria-label="החלפת תצוגה"
          onClick={() => onChange(next)}
          sx={{
            width: '100%', height: 40, border: '1px solid', borderColor: alpha(BRAND, 0.35),
            borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: DEEP, bgcolor: alpha(BRAND, isDark ? 0.18 : 0.1),
            transition: 'background-color .18s ease',
            '&:hover': { bgcolor: alpha(BRAND, isDark ? 0.26 : 0.16) },
            '& svg': { fontSize: 22 },
          }}
        >
          {VIEW_MODE_META[value].icon}
        </Box>
      </Tooltip>
    );
  }

  // Expanded rail: a segmented control of the available modes.
  return (
    <Box>
      <Typography sx={{ px: '6px', pb: 0.6, fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.1em', color: 'text.disabled', display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <SwapHorizRoundedIcon sx={{ fontSize: 14 }} /> תצוגה
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, isDark ? 0.06 : 0.04) }}>
        {modes.map((m) => {
          const active = m === value;
          return (
            <Box
              key={m}
              component="button"
              aria-pressed={active}
              onClick={() => onChange(m)}
              sx={{
                flex: 1, minWidth: 0, border: 'none', cursor: 'pointer', height: 34,
                borderRadius: 2.2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 0.5, font: 'inherit',
                color: active ? '#fff' : (isDark ? alpha('#fff', 0.7) : alpha(theme.palette.text.primary, 0.7)),
                bgcolor: active ? BRAND : 'transparent',
                boxShadow: active ? `0 4px 12px ${alpha(BRAND, 0.4)}` : 'none',
                transition: 'background-color .16s ease, color .16s ease',
                '&:hover': { bgcolor: active ? DEEP : alpha(theme.palette.text.primary, isDark ? 0.08 : 0.05) },
                '& svg': { fontSize: 18 },
              }}
            >
              {VIEW_MODE_META[m].icon}
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                {VIEW_MODE_META[m].short}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
