import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { isNativeApp, registerForPush } from '../native/app';

/** App only: "send me a test notification" - checks the whole push path end to end. */
export default function PushTestRow() {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'nodevice' | 'error'>('idle');
  if (!isNativeApp()) return null;
  const send = async () => {
    setState('busy');
    try {
      await registerForPush(); // asks for permission if it was never granted
      const res = await fetchWithAuth('/api/push/test', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { queued } = await res.json();
      setState(queued ? 'sent' : 'nodevice');
    } catch {
      setState('error');
    }
  };
  const note = {
    idle: 'בודקים שהטלפון מקבל עדכונים כשאורחים עונים.',
    busy: 'שולחים…',
    sent: 'נשלח. ההתראה תגיע תוך חצי דקה בערך.',
    nodevice: 'הטלפון עוד לא רשום להתראות. אשרו התראות בהגדרות הטלפון ונסו שוב.',
    error: 'השליחה לא הצליחה. נסו שוב בעוד רגע.',
  }[state];
  return (
    <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>התראות</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{note}</Typography>
      <Button variant="outlined" onClick={send} disabled={state === 'busy'}>שליחת התראת בדיקה</Button>
    </Box>
  );
}
