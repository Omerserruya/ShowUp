import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, InputAdornment, Stack, TextField, Typography, alpha } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { PhoneContact, contactsPermission, readPhoneContacts } from '../native/app';

/**
 * Guests from the phone's address book (mobile app only - see canReadContacts).
 * Contacts are read on the phone; only the ones the owner ticks are sent, through
 * the same POST /guests/bulk as a file import (duplicates / bad numbers / plan cap
 * are skipped and reported there).
 */
interface Props {
  busy: boolean;
  onAdd: (picked: PhoneContact[]) => void;
}

const PURPLE = '#5A3DA6';
// A long address book renders in pages; search narrows it first.
const PAGE = 300;

const localPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d.startsWith('972') ? `0${d.slice(3)}` : d;
};

export default function PhoneContactsPicker({ busy, onAdd }: Props) {
  const [stage, setStage] = useState<'checking' | 'intro' | 'loading' | 'list' | 'denied'>('checking');
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const load = async (ask: boolean) => {
    const perm = await contactsPermission(ask);
    if (perm !== 'granted') {
      setStage(ask ? 'denied' : 'intro');
      return;
    }
    setStage('loading');
    try {
      setContacts(await readPhoneContacts());
      setStage('list');
    } catch {
      setStage('denied');
    }
  };

  // Already allowed earlier -> straight to the list; otherwise explain first.
  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || (qd.length >= 3 && c.phone.replace(/\D/g, '').includes(qd)));
  }, [contacts, query]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allShownPicked = shown.length > 0 && shown.every((c) => picked.has(c.id));
  const toggleAllShown = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      shown.forEach((c) => (allShownPicked ? next.delete(c.id) : next.add(c.id)));
      return next;
    });

  if (stage === 'checking' || stage === 'loading') {
    return (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
        <CircularProgress size={28} sx={{ color: PURPLE }} />
        {stage === 'loading' && <Typography color="text.secondary">טוענים את אנשי הקשר מהטלפון…</Typography>}
      </Stack>
    );
  }

  if (stage === 'intro' || stage === 'denied') {
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: 2, textAlign: 'center' }}>
        <Box sx={{ width: 56, height: 56, borderRadius: '50%', bgcolor: alpha(PURPLE, 0.1), display: 'grid', placeItems: 'center' }}>
          <ContactsRoundedIcon sx={{ color: PURPLE, fontSize: 30 }} />
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>הוספת אורחים מאנשי הקשר</Typography>
        {stage === 'intro' ? (
          <>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem', maxWidth: 360 }}>
              כדי לבחור אורחים מתוך אנשי הקשר, ShowUp צריכה גישה לשמות ולמספרי הטלפון בטלפון שלכם.
              הרשימה נקראת כאן בטלפון, ורק מי שתסמנו יתווסף לרשימת האורחים של האירוע.
            </Typography>
            <Button variant="contained" onClick={() => load(true)} sx={{ bgcolor: PURPLE, borderRadius: 2.5, px: 4, fontWeight: 700 }}>
              המשך
            </Button>
          </>
        ) : (
          <>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem', maxWidth: 360 }}>
              אין גישה לאנשי הקשר. אפשר לאשר אותה בהגדרות הטלפון:
              הגדרות ← אפליקציות ← ShowUp ← הרשאות ← אנשי קשר.
            </Typography>
            <Button variant="outlined" onClick={() => load(true)} sx={{ color: PURPLE, borderColor: PURPLE, borderRadius: 2.5, fontWeight: 700 }}>
              לנסות שוב
            </Button>
          </>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <TextField
        size="small"
        placeholder="חיפוש לפי שם או מספר"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
      />
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
          {shown.length} אנשי קשר{picked.size ? ` · ${picked.size} נבחרו` : ''}
        </Typography>
        {shown.length > 0 && (
          <Button size="small" onClick={toggleAllShown} sx={{ color: PURPLE, fontWeight: 700 }}>
            {allShownPicked ? 'ביטול הסימון' : query ? 'סימון כל התוצאות' : 'סימון הכל'}
          </Button>
        )}
      </Stack>

      <Box sx={{ maxHeight: '52vh', overflowY: 'auto', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        {shown.length === 0 && (
          <Typography sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            {contacts.length ? 'לא נמצאו אנשי קשר' : 'אין בטלפון אנשי קשר עם מספר טלפון'}
          </Typography>
        )}
        {shown.slice(0, limit).map((c) => {
          const on = picked.has(c.id);
          return (
            <Box key={c.id} onClick={() => toggle(c.id)} role="checkbox" aria-checked={on}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.1, cursor: 'pointer',
                    borderBottom: '1px solid', borderColor: 'divider', bgcolor: on ? alpha(PURPLE, 0.06) : 'transparent' }}>
              <Box sx={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
                         border: `2px solid ${on ? PURPLE : '#C9C3D6'}`, bgcolor: on ? PURPLE : 'transparent' }}>
                {on && <CheckRoundedIcon sx={{ color: '#fff', fontSize: 16 }} />}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.95rem' }}>{c.name}</Typography>
                <Typography noWrap dir="ltr" sx={{ fontSize: '0.8rem', color: 'text.secondary', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {localPhone(c.phone)}
                </Typography>
              </Box>
            </Box>
          );
        })}
        {shown.length > limit && (
          <Button fullWidth onClick={() => setLimit((l) => l + PAGE)} sx={{ py: 1.5, color: PURPLE }}>
            להציג עוד ({shown.length - limit})
          </Button>
        )}
      </Box>

      <Button
        variant="contained"
        disabled={!picked.size || busy}
        onClick={() => onAdd(contacts.filter((c) => picked.has(c.id)))}
        sx={{ bgcolor: PURPLE, borderRadius: 2.5, py: 1.2, fontWeight: 800 }}
      >
        {busy ? 'מוסיפים…' : picked.size ? `הוספת ${picked.size} אורחים` : 'בחרו אורחים'}
      </Button>
    </Stack>
  );
}
