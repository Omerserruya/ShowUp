import React from 'react';
import { Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { color as C } from '../../design/tokens';
import { useSnapshot } from '../../contexts/SnapshotContext';
import type { Snapshot } from '../../adapters/eventSnapshot';

export interface NextStep {
  kicker: string;
  title: string;
  detail: string;
  cta?: { label: string; path: string };
}

/** The single most useful next action, derived from real event data only. */
export function computeNextStep(s: Snapshot): NextStep | null {
  const d = s.event.daysUntil;
  const kicker = d == null ? 'האירוע' : d > 1 ? `עוד ${d} ימים` : d === 1 ? 'מחר' : d === 0 ? 'היום' : 'אחרי האירוע';
  if (d != null && d < 0) {
    return { kicker, title: 'האירוע מאחוריכם', detail: 'כל המספרים מחכים בסיכום החגיגה', cta: { label: 'לסיכום', path: '/recap' } };
  }
  // The invitation round fell back to draft (no guests when it was due, or its
  // time passed): nothing goes out until the host re-schedules it.
  const first = s.rounds[0];
  if (first && first.statusLabel === 'טיוטה' && (s.invitations.total === 0 || !first.when || first.when.getTime() < Date.now())) {
    return { kicker, title: 'ההזמנה ממתינה לשליחה', detail: 'היא שמורה כטיוטה. קובעים לה מועד בלוח השליחה', cta: { label: 'ללוח השליחה', path: '/messages' } };
  }
  if (s.pendingImports > 0) {
    return { kicker, title: `${s.pendingImports} אנשי קשר מחכים לאישור`, detail: 'הגיעו מוואטסאפ. הם נכנסים לרשימה רק אחרי שתאשרו', cta: { label: 'לאישור', path: '/guests/imported' } };
  }
  if (s.invitations.total === 0) {
    return { kicker, title: 'עוד אין מוזמנים', detail: 'מוסיפים מאקסל, מוואטסאפ או אחד אחד', cta: { label: 'הוספת מוזמנים', path: '/guests' } };
  }
  if (s.invitations.pending > 0) {
    const detail = s.nextRound ? `${s.nextRound.name} יוצאת ${s.nextRound.whenLabel}` : 'אין כרגע סבב מתוזמן למי שלא ענה';
    return { kicker, title: `${s.invitations.pending} מוזמנים עוד לא ענו`, detail, cta: { label: s.nextRound ? 'לסבבי השליחה' : 'תזמון תזכורת', path: '/messages' } };
  }
  if (s.unseated.length > 0) {
    return { kicker, title: `${s.unseated.length} אישרו ועדיין בלי שולחן`, detail: 'אפשר לשבץ אותם עכשיו', cta: { label: 'להושבה', path: '/seating' } };
  }
  return { kicker, title: 'הכול מתקדם יפה', detail: 'כולם ענו וכולם משובצים' };
}

export default function NextStepCard() {
  const navigate = useNavigate();
  const { snapshot } = useSnapshot();
  if (!snapshot) return null;
  const n = computeNextStep(snapshot);
  if (!n) return null;
  return (
    <Box sx={{ border: `1.5px solid ${C.tintBorder}`, bgcolor: '#FFFFFF', borderRadius: '18px', p: 2 }}>
      <Box sx={{ fontSize: 12, letterSpacing: '.06em', color: C.purple, fontWeight: 500 }}>{n.kicker}</Box>
      <Box sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, mt: 1 }}>{n.title}</Box>
      <Box sx={{ fontSize: 13, color: C.body, lineHeight: 1.55, mt: 0.5 }}>{n.detail}</Box>
      {n.cta && (
        <Box
          component="button"
          type="button"
          onClick={() => navigate(n.cta!.path)}
          className="su-hover-lav"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 44, mt: 1.75, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', color: C.ink, bgcolor: C.lav, borderRadius: '12px' }}
        >
          {n.cta.label}
        </Box>
      )}
    </Box>
  );
}
