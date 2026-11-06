import React, { useState } from 'react';
import { Box, Typography, Stack, ButtonBase, alpha, useTheme } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import Diversity3RoundedIcon from '@mui/icons-material/Diversity3Rounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import QuizRoundedIcon from '@mui/icons-material/QuizRounded';
import EventDetailsPanel from '../components/v6/EventDetailsPanel';
import GuestQuestionsPanel from '../components/v6/GuestQuestionsPanel';
import Profile from './Profile';
import Team from './Team';
import Billing from './Billing';
import EventImagesPanel from '../components/EventImagesPanel';
import { useEvent } from '../contexts/EventContext';

/**
 * Unified account settings - Profile, Team and Billing under one page with a
 * branded left section-nav (purple active state) and a clean content panel.
 * The sub-pages render in `embedded` mode. Deep-linkable via `?tab=`.
 */
const TABS = [
  { key: 'event', label: 'פרטי האירוע', desc: 'שם, תאריך, שעה, מקום ובעלי האירוע', icon: <EventRoundedIcon /> },
  { key: 'profile', label: 'הפרופיל שלי', desc: 'פרטים אישיים והעדפות', icon: <PersonRoundedIcon /> },
  { key: 'team', label: 'הצוות', desc: 'שותפים והרשאות', icon: <Diversity3RoundedIcon /> },
  { key: 'questions', label: 'שאלות לאורחים', desc: 'הסעה ושאלות אחרי אישור הגעה', icon: <QuizRoundedIcon /> },
  { key: 'media', label: 'תמונות האירוע', desc: 'תמונת וואטסאפ והזמנה', icon: <PhotoLibraryRoundedIcon /> },
  // "חבילה", never "מנוי" - the product promise is a one-time payment, no subscription.
  { key: 'billing', label: 'חבילה ותשלום', desc: 'החבילה והשימוש שלך', icon: <CreditCardRoundedIcon /> },
] as const;

export default function Settings() {
  const theme = useTheme();
  const primary = theme.palette.primary.main;
  const { selectedEvent } = useEvent();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const [tab, setTab] = useState<string>(TABS.some(t => t.key === requested) ? requested! : 'event');

  const select = (key: string) => {
    setTab(key);
    setParams(key === 'event' ? {} : { tab: key }, { replace: true });
  };

  const active = TABS.find(t => t.key === tab) ?? TABS[0];

  return (
    <Box sx={{ maxWidth: 1040, mx: 'auto', px: { xs: 0, sm: 1 }, py: { xs: 0.5, sm: 1 }, direction: 'rtl' }}>
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
              boxShadow: 'none', bgcolor: '#C9B8F3', color: '#16150F',
              '&:hover': { boxShadow: 'none', bgcolor: '#BBA6EE' },
            },
            '& .MuiButton-outlined': {
              borderColor: alpha(primary, 0.5), color: 'primary.main',
              '&:hover': { borderColor: 'primary.main', bgcolor: alpha(primary, 0.05) },
            },
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: { xs: 'none', md: 'block' } }}>{active.label}</Typography>
          {tab === 'event' && <EventDetailsPanel />}
          {tab === 'profile' && <Profile embedded />}
          {tab === 'team' && <Team embedded />}
          {tab === 'questions' && <GuestQuestionsPanel />}
          {tab === 'media' && (selectedEvent?.id
            ? (<>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.875rem', mb: 2 }}>
                  שתי תמונות מלוות את האירוע: אחת בהודעות הוואטסאפ ואחת בדף ההזמנה. אפשר להחליף אותן בכל רגע - כל המקומות שבהם הן מופיעות מתעדכנים מיד.
                </Typography>
                <EventImagesPanel eventId={selectedEvent.id} />
              </>)
            : <Typography color="text.secondary">בחרו אירוע כדי לנהל את התמונות</Typography>)}
          {tab === 'billing' && <Billing embedded />}
        </Box>
      </Box>
    </Box>
  );
}
