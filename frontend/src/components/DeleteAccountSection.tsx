import React, { useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography,
} from '@mui/material';
import { useUser } from '../contexts/UserContext';
import { fetchWithAuth } from '../utils/fetchWithAuth';

const CONFIRM_WORD = 'מחיקה';

/**
 * "מחיקת החשבון" at the bottom of the profile (required by the App Store, and
 * offered on the website too). Server side: aub POST /auth/account/delete, see
 * shared/domain/account_deletion.py for what is removed and what is kept.
 */
export default function DeleteAccountSection() {
  const { clearUser } = useUser();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { if (!busy) { setOpen(false); setTyped(''); setError(null); } };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/auth/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      if (res.status === 403) {
        setError('חשבון מנהל מערכת לא נמחק מכאן.');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      clearUser();
      localStorage.removeItem('selected_event_id');
      localStorage.removeItem('pending_order_id');
      window.location.href = '/login?deleted=1';
    } catch {
      setError('המחיקה לא הצליחה. נסו שוב בעוד רגע.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>מחיקת החשבון</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: '60ch' }}>
        החשבון, האירועים שלכם ורשימות האורחים יימחקו לצמיתות, וסבבים או שיחות שתוזמנו לא יצאו.
        אירוע שיש לו בעלים נוסף יישאר אצלו.
      </Typography>
      <Button variant="outlined" color="error" onClick={() => setOpen(true)}>מחיקת החשבון</Button>

      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>למחוק את החשבון?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            אי אפשר לבטל את זה. יימחקו החשבון, האירועים שאתם הבעלים היחידים שלהם, האורחים, התשובות וההודעות.
            רשומות תשלום נשמרות בלי פרטים אישיים, כפי שמחייב החוק.
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            כדי לאשר, כתבו <b>{CONFIRM_WORD}</b>:
          </Typography>
          <TextField fullWidth size="small" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" inputProps={{ 'aria-label': 'אישור מחיקה' }} />
          {error && <Typography color="error" variant="body2" sx={{ mt: 1 }}>{error}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={close} disabled={busy}>ביטול</Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirm}
            disabled={busy || typed.trim() !== CONFIRM_WORD}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
            sx={{ bgcolor: 'error.main', color: '#fff', '&:hover': { bgcolor: 'error.dark' } }}
          >
            מחיקה לצמיתות
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
