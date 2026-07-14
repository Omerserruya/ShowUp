import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';

/** Custom events other pages can listen to (e.g. Guests focuses search / opens add). */
export const SHORTCUT_EVENTS = {
  focusSearch: 'showup:focus-search',
  newGuest: 'showup:new-guest',
} as const;

interface ShortcutRow {
  keys: string[];
  label: string;
}

const NAV_SHORTCUTS: Record<string, string> = {
  o: '/overview',
  g: '/guests',
  m: '/messages',
  s: '/seating',
  e: '/settings',
};

const HELP_GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    // Labels must match the nav rail 1:1 so the help sheet maps to what users see.
    title: 'ניווט',
    rows: [
      { keys: ['g', 'הבית (o)'], label: 'הבית' },
      { keys: ['g', 'האורחים (g)'], label: 'האורחים' },
      { keys: ['g', 'תזכורות (m)'], label: 'תזכורות' },
      { keys: ['g', 'הושבה (s)'], label: 'הושבה' },
      { keys: ['g', 'הגדרות (e)'], label: 'הגדרות' },
    ],
  },
  {
    title: 'פעולות',
    rows: [
      { keys: ['c'], label: 'צור אירוע חדש' },
      { keys: ['n'], label: 'הוסף אורח (במסך האורחים)' },
      { keys: ['/'], label: 'מיקוד בחיפוש (במסך האורחים)' },
      { keys: ['?'], label: 'הצג קיצורי מקלדת' },
    ],
  },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = React.useState(false);
  // Tracks a pending "g" prefix for two-key navigation sequences.
  const pendingG = React.useRef<number | null>(null);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key;

      // Two-key "g <dest>" navigation.
      if (pendingG.current) {
        const dest = NAV_SHORTCUTS[key.toLowerCase()];
        pendingG.current = null;
        if (dest) {
          e.preventDefault();
          navigate(dest);
          return;
        }
      }

      if (key === 'g') {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 1200);
        return;
      }

      if (key === '?') {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      if (key === 'Escape' && helpOpen) {
        setHelpOpen(false);
        return;
      }

      if (key === 'c') {
        e.preventDefault();
        navigate('/wizard');
        return;
      }

      if (key === '/') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.focusSearch));
        return;
      }

      if (key === 'n') {
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.newGuest));
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, helpOpen]);

  return (
    <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <KeyboardRoundedIcon color="primary" />
        קיצורי מקלדת
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pb: 1 }}>
          {HELP_GROUPS.map((group) => (
            <Box key={group.title}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                {group.title}
              </Typography>
              <Stack spacing={1}>
                {group.rows.map((row) => (
                  <Box
                    key={row.label}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Typography variant="body2">{row.label}</Typography>
                    <Stack direction="row" spacing={0.5}>
                      {row.keys.map((k) => (
                        <Box
                          key={k}
                          component="kbd"
                          sx={{
                            px: 1,
                            py: 0.25,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                            border: '1px solid',
                            borderColor: 'divider',
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            color: 'text.primary',
                          }}
                        >
                          {k}
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
              <Divider sx={{ mt: 2 }} />
            </Box>
          ))}
          <Typography variant="caption" color="text.secondary">
            לחצו <b>?</b> בכל עת כדי לפתוח חלון זה.
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
