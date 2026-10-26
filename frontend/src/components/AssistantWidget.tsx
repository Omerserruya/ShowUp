import React, { useRef, useState, useEffect } from 'react';
import {
  Box,
  Fab,
  Drawer,
  Typography,
  IconButton,
  TextField,
  Stack,
  Chip,
  Avatar,
  useTheme,
  alpha,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';

interface Msg { from: 'bot' | 'user'; text: string }

// Action-shortcut starters - each one actually does something useful today.
// Starters are real questions sent to the assistant (not canned navigation).
const STARTERS: string[] = ['כמה אישרו עד עכשיו?', 'מי עוד לא ענה?', 'מי ביקש מנה מיוחדת?', 'מי ראה את ההודעה ולא ענה?'];

const GREETING: Msg = { from: 'bot', text: 'היי! אני העוזרת של האירוע. אפשר לשאול אותי כמה אישרו, מי עוד לא ענה, או לבקש להוסיף אורח.' };

/** Honest error text per failure (was a single "coming soon" for everything). */
function errorText(status: number | null, detail?: string): string {
  if (status === 401) return 'צריך להתחבר מחדש כדי להמשיך.';
  if (status === 403 || status === 404) return 'אין לך הרשאה לאירוע הזה.';
  if (status === 422) return 'צריך לבחור אירוע לפני ששואלים.';
  if (status === 429) return detail || 'הגעתם למגבלת השאלות לעכשיו. נסו שוב בעוד כמה דקות.';
  if (status === 503) return 'העוזרת לא זמינה כרגע. נסו שוב בעוד רגע.';
  if (status === 504 || status === 502) return 'לקח יותר מדי זמן. ייתכן שהפעולה לא הושלמה, בדקו לפני שמנסים שוב.';
  return 'משהו השתבש. נסו שוב בעוד רגע.';
}

export default function AssistantWidget() {
  const theme = useTheme();
  const { selectedEvent } = useEvent();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // A conversation belongs to one event: switching events starts a fresh one,
  // so one event's transcript is never sent as context for another.
  useEffect(() => { setMessages([GREETING]); }, [selectedEvent?.id]);

  const handleSend = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || sending) return;
    if (!selectedEvent?.id) {
      setMessages((m) => [...m, { from: 'user', text }, { from: 'bot', text: errorText(422) }]);
      return;
    }
    if (!preset) setInput('');
    setMessages((m) => [...m, { from: 'user', text }]);
    setSending(true);
    try {
      // Multi-turn context: send the recent transcript (minus the canned greeting).
      const history = messages
        .filter((m) => m !== GREETING)
        .slice(-20)
        .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text }));
      const res = await fetchWithAuth('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, event_id: selectedEvent?.id, history }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((m) => [...m, { from: 'bot', text: data.reply || data.message || 'קיבלתי.' }]);
      } else {
        let detail: string | undefined;
        try { const j = await res.json(); detail = typeof j?.detail === 'string' && /[\u0590-\u05FF]/.test(j.detail) ? j.detail : undefined; } catch { /* non-JSON */ }
        setMessages((m) => [...m, { from: 'bot', text: errorText(res.status, detail) }]);
      }
    } catch {
      setMessages((m) => [...m, { from: 'bot', text: errorText(null) }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating trigger */}
      <Box sx={{ position: 'fixed', bottom: { xs: 96, md: 28 }, left: { xs: 16, md: 28 }, zIndex: (t) => t.zIndex.appBar + 2 }}>
        <Fab
          color="primary"
          aria-label="עוזר חכם"
          onClick={() => setOpen(true)}
          sx={{
            bgcolor: 'primary.main',
            boxShadow: '0 10px 26px rgba(90,61,166,0.30)',
            '&:hover': { bgcolor: 'primary.dark' },
          }}
        >
          <AutoAwesomeIcon />
        </Fab>
      </Box>

      <Drawer
        anchor="left"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 400 }, direction: 'rtl', display: 'flex', flexDirection: 'column' } }}
      >
        {/* Header */}
        <Box sx={{ p: 2, color: '#fff', bgcolor: 'primary.main', display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ bgcolor: alpha('#fff', 0.25) }}><AutoAwesomeIcon /></Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>העוזרת של האירוע</Typography>
            <Typography variant="caption" sx={{ opacity: 0.9 }}>שאלות ופעולות על האירוע. פעולות שליחה ומחיקה דורשות אישור שלך</Typography>
          </Box>
          <IconButton onClick={() => setOpen(false)} sx={{ color: '#fff' }}><CloseIcon /></IconButton>
        </Box>

        {/* Messages */}
        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2, bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
          <Stack spacing={1.5}>
            {messages.map((m, i) => (
              <Box key={i} sx={{ alignSelf: m.from === 'user' ? 'flex-start' : 'flex-end', maxWidth: '85%' }}>
                <Box
                  sx={{
                    p: 1.25, px: 1.75, borderRadius: 2.5,
                    bgcolor: m.from === 'user' ? 'primary.main' : 'background.paper',
                    color: m.from === 'user' ? '#fff' : 'text.primary',
                    border: m.from === 'user' ? 'none' : '1px solid', borderColor: 'divider',
                    boxShadow: theme.shadows[1],
                  }}
                >
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.text}</Typography>
                </Box>
              </Box>
            ))}
            <div ref={endRef} />
          </Stack>
        </Box>

        {/* Starters */}
        <Box sx={{ px: 2, pt: 1.5 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {STARTERS.map((q) => (
              <Chip key={q} label={q} variant="outlined" color="primary" onClick={() => handleSend(q)} disabled={sending} sx={{ cursor: 'pointer' }} />
            ))}
          </Box>
        </Box>

        {/* Input */}
        <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            fullWidth
            size="small"
            placeholder="כתבו הודעה…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <IconButton color="primary" onClick={() => handleSend()} disabled={sending || !input.trim()} aria-label="שליחה">
            <SendIcon />
          </IconButton>
        </Box>
      </Drawer>
    </>
  );
}
