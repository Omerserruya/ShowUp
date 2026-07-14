import React, { useState } from 'react';
import { Box, Typography, Stack, ButtonBase, alpha, useTheme } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import Diversity3RoundedIcon from '@mui/icons-material/Diversity3Rounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import Profile from './Profile';
import Team from './Team';
import Billing from './Billing';

/**
 * Unified account settings - Profile, Team and Billing under one page with a
 * branded left section-nav (purple active state) and a clean content panel.
 * The sub-pages render in `embedded` mode. Deep-linkable via `?tab=`.
 */
const TABS = [
  { key: 'profile', label: 'הפרופיל שלי', desc: 'פרטים אישיים והעדפות', icon: <PersonRoundedIcon /> },
  { key: 'team', label: 'הצוות', desc: 'שותפים והרשאות', icon: <Diversity3RoundedIcon /> },
  // "חבילה", never "מנוי" - the product promise is a one-time payment, no subscription.
  { key: 'billing', label: 'חבילה ותשלום', desc: 'החבילה והשימוש שלך', icon: <CreditCardRoundedIcon /> },
] as const;

export default function Settings() {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const [tab, setTab] = useState<string>(TABS.some(t => t.key === requested) ? requested! : 'profile');

  const select = (key: string) => {
    setTab(key);
    setParams(key === 'profile' ? {} : { tab: key }, { replace: true });
  };

  const active = TABS.find(t => t.key === tab) ?? TABS[0];

  return (
    <Box sx={{ maxWidth: 1040, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 2.5, sm: 4 }, direction: 'rtl' }}>
      {/* Branded header */}
      <Stack useFlexGap direction="row" spacing={1.75} alignItems="center" sx={{ mb: { xs: 2.5, sm: 3.5 } }}>
        <Box sx={{ width: 46, height: 46, flexShrink: 0, borderRadius: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(primary, 0.1), color: 'primary.main' }}>
          <SettingsRoundedIcon />
        </Box>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' }}>הגדרות</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>הפרופיל, הצוות והחבילה שלך - במקום אחד.</Typography>
        </Box>
      </Stack>

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 1.5, md: 3 }, alignItems: 'flex-start' }}>
        {/* Section nav */}
        <Box
          sx={{
            display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: { xs: 1, md: 0.5 },
            width: { xs: '100%', md: 236 }, flexShrink: 0,
            overflowX: { xs: 'auto', md: 'visible' }, pb: { xs: 0.5, md: 0 },
            position: { md: 'sticky' }, top: { md: 16 },
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <ButtonBase
                key={t.key}
                onClick={() => select(t.key)}
                aria-current={on ? 'page' : undefined}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                  textAlign: 'start', gap: 1.25, flexShrink: 0,
                  px: 1.5, py: 1.15, borderRadius: 2, cursor: 'pointer',
                  bgcolor: on ? alpha(primary, 0.1) : 'transparent',
                  color: on ? 'primary.main' : 'text.primary',
                  transition: 'background-color .15s, color .15s',
                  '&:hover': { bgcolor: on ? alpha(primary, 0.14) : 'action.hover' },
                  '& svg': { fontSize: 21 },
                }}
              >
                {t.icon}
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Typography sx={{ fontSize: 14.5, fontWeight: on ? 700 : 600, lineHeight: 1.2 }} noWrap>{t.label}</Typography>
                  </Stack>
                  <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12, color: on ? alpha(primary, 0.8) : 'text.secondary', fontWeight: 500 }} noWrap>{t.desc}</Typography>
                </Box>
              </ButtonBase>
            );
          })}
        </Box>

        {/* Content - flat, separated from the nav by a hairline (no card). */}
        <Box
          sx={{
            flex: 1, minWidth: 0, width: '100%',
            borderInlineStart: { md: '1px solid' }, borderColor: { md: 'divider' },
            px: { xs: 1, md: 4 }, pt: { xs: 1, md: 0 },
            '& .MuiButton-root': {
              borderRadius: 1.5, textTransform: 'none', fontWeight: 600, gap: 0.5,
              '& .MuiButton-startIcon': { mx: 0 }, '& .MuiButton-endIcon': { mx: 0 },
            },
            '& .MuiButton-contained': {
              boxShadow: 'none', bgcolor: 'primary.main',
              '&:hover': { boxShadow: 'none', bgcolor: 'primary.dark' },
            },
            '& .MuiButton-outlined': {
              borderColor: alpha(primary, 0.5), color: 'primary.main',
              '&:hover': { borderColor: 'primary.main', bgcolor: alpha(primary, 0.05) },
            },
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: { xs: 'none', md: 'block' } }}>{active.label}</Typography>
          {tab === 'profile' && <Profile embedded />}
          {tab === 'team' && <Team embedded />}
          {tab === 'billing' && <Billing embedded />}
        </Box>
      </Box>
    </Box>
  );
}
