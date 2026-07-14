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
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';

interface Msg { from: 'bot' | 'user'; text: string }

// Action-shortcut starters - each one actually does something useful today.
const STARTERS: { label: string; path?: string; reply: string }[] = [
  { label: 'מי עוד לא הגיב?', path: '/guests?filter=pending', reply: 'מעביר אותך לרשימת האורחים שעדיין לא הגיבו 👇' },
  { label: 'כמה אישרו הגעה?', path: '/overview', reply: 'הנה הסיכום בלוח הבקרה - מספר המאשרים מופיע למעלה ✅' },
  { label: 'שלח תזכורת לאורחים', path: '/messages', reply: 'פותח את ניהול הקמפיינים כדי לשלוח סבב תזכורת ⏰' },
  { label: 'הוסף אורחים חדשים', path: '/guests', reply: 'פותח את רשימת האורחים - אפשר להוסיף ידנית או לייבא קובץ 📋' },
];

export default function AssistantWidget() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { selectedEvent } = useEvent();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([
    { from: 'bot', text: 'היי! אני העוזר האישי של ShowUp 🎉 אשמח לעזור לך לנהל את האירוע. במה אפשר לעזור?' },
  ]);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const runStarter = (s: typeof STARTERS[number]) => {
    setMessages((m) => [...m, { from: 'user', text: s.label }, { from: 'bot', text: s.reply }]);
    if (s.path) {
      setTimeout(() => {
        setOpen(false);
        navigate(s.path!);
      }, 600);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages((m) => [...m, { from: 'user', text }]);
    setSending(true);
    try {
      // Multi-turn context: send the recent transcript (minus the canned greeting).
      const history = messages
        .slice(1)
        .slice(-20)
        .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text }));
      const res = await fetchWithAuth('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, event_id: selectedEvent?.id, history }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((m) => [...m, { from: 'bot', text: data.reply || data.message || 'קיבלתי!' }]);
      } else {
        throw new Error('unavailable');
      }
    } catch {
      setMessages((m) => [
        ...m,
        { from: 'bot', text: 'העוזר החכם בדרך אליך בקרוב 💜 בינתיים אפשר להשתמש בקיצורים למעלה - הם יקפיצו אותך בדיוק למקום הנכון.' },
      ]);
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
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            '&:hover': { background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})` },
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
        <Box sx={{ p: 2, color: '#fff', background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ bgcolor: alpha('#fff', 0.25) }}><AutoAwesomeIcon /></Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>העוזר של ShowUp</Typography>
            <Typography variant="caption" sx={{ opacity: 0.9 }}>כאן כדי לעזור עם האירוע שלך</Typography>
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
            {STARTERS.map((s) => (
              <Chip key={s.label} label={s.label} variant="outlined" color="primary" onClick={() => runStarter(s)} sx={{ cursor: 'pointer' }} />
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
          <IconButton color="primary" onClick={handleSend} disabled={sending || !input.trim()}>
            <SendIcon />
          </IconButton>
        </Box>
      </Drawer>
    </>
  );
}
