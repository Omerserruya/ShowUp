import React from 'react';
import { useNavigate } from 'react-router-dom';
import { color as C } from '../../design/tokens';
import type { Snapshot } from '../../adapters/eventSnapshot';
import { hebDayDate, hhmm } from '../../adapters/eventSnapshot';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import EventImagesPanel from '../EventImagesPanel';
import { Card, Kicker, Ms, Btn, Chip } from './ui';

/**
 * "לפני שההזמנה יוצאת" - the host's pre-send checklist on the Overview.
 *
 * Shown until the invitation round has gone out. Every step is computed from
 * real data: the Snapshot (guests, pending WhatsApp imports, rounds), the event
 * (WhatsApp cover image) and GET /api/events/{id}/invitation-round (the round's
 * date, recipients, wording, draft reason). The two "I did it" steps (schedule
 * reviewed, test sent) are per-event localStorage flags.
 */

interface InviteRound {
  campaign_id: string;
  name: string;
  status: string;
  status_reason?: string | null;
  schedule_time?: string | null;
  recipients: number;
  template_title?: string | null;
  custom_message?: boolean;
  sendable?: boolean;
}

type StepState = 'done' | 'todo' | 'current';

interface Step {
  key: string;
  title: string;
  state: StepState;
  summary: string;
  body?: React.ReactNode;
}

const flagKey = (kind: string, eid: string) => `onb_${kind}_${eid}`;
const readFlag = (k: string) => { try { return !!localStorage.getItem(k); } catch { return false; } };
const writeFlag = (k: string, v = '1') => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const SENT_STATES = new Set(['sent', 'sending', 'processing']);

function roundWhen(iso?: string | null): string {
  if (!iso) return 'עוד לא נקבע מועד';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'עוד לא נקבע מועד';
  return `${hebDayDate(d)}, ${hhmm(d)}`;
}

export default function PreSendChecklist({ snapshot: s, eventId, onChanged }: {
  snapshot: Snapshot;
  eventId: string;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [hasWaImage, setHasWaImage] = React.useState<boolean | null>(null);
  const [round, setRound] = React.useState<InviteRound | null | undefined>(undefined);
  const [tick, setTick] = React.useState(0);
  const [showImages, setShowImages] = React.useState(false);
  const [scheduleOk, setScheduleOk] = React.useState(() => readFlag(flagKey('schedule_ok', eventId)));
  const [testSentTo, setTestSentTo] = React.useState<string | null>(() => {
    try { return localStorage.getItem(flagKey('test_sent', eventId)); } catch { return null; }
  });
  const [testBusy, setTestBusy] = React.useState(false);
  const [testErr, setTestErr] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setScheduleOk(readFlag(flagKey('schedule_ok', eventId)));
    try { setTestSentTo(localStorage.getItem(flagKey('test_sent', eventId))); } catch { setTestSentTo(null); }
    setShowImages(false);
    setExpanded(null);
  }, [eventId]);

  // Event (cover image) + invitation round. Both best-effort: on failure the
  // checklist falls back to snapshot data instead of disappearing.
  React.useEffect(() => {
    let cancelled = false;
    fetchWithAuth(`/api/events/${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((ev) => { if (!cancelled && ev) setHasWaImage(!!(ev.waImageUrl || ev.wa_image_url)); })
      .catch(() => {});
    fetchWithAuth(`/api/events/${eventId}/invitation-round`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (!cancelled) setRound(d?.round ?? null); })
      .catch(() => { if (!cancelled) setRound(undefined); });
    return () => { cancelled = true; };
  }, [eventId, tick, s.invitations.total]);

  // Fallback round from the snapshot when the endpoint is unavailable: the first
  // round in the schedule (the invitation is the earliest guest message).
  const fallback = s.rounds[0] || null;
  const r = round === undefined
    ? (fallback ? {
        campaign_id: fallback.id,
        name: fallback.name,
        status: fallback.statusLabel === 'טיוטה' ? 'draft' : fallback.isUpcoming ? 'pending' : (fallback.statusLabel === 'נשלח' || fallback.statusLabel === 'הסתיים' || fallback.statusLabel === 'יוצא עכשיו') ? 'sent' : 'pending',
        schedule_time: fallback.when ? fallback.when.toISOString() : null,
        recipients: fallback.recipients,
      } as InviteRound : null)
    : round;

  const status = (r?.status || '').toLowerCase();
  const invitationSent = !!r && SENT_STATES.has(status);
  if (invitationSent) return null;
  // After the event there is nothing left to prepare.
  if (s.event.daysUntil != null && s.event.daysUntil < 0) return null;

  const whenTs = r?.schedule_time ? new Date(r.schedule_time).getTime() : NaN;
  const pastTime = !isNaN(whenTs) && whenTs < Date.now();
  const isDraftWaiting = !!r && status === 'draft' && (r.status_reason === 'no_guests' || pastTime);

  const hasGuests = s.invitations.total > 0;

  const runTest = async () => {
    setTestBusy(true);
    setTestErr(null);
    try {
      const res = await fetchWithAuth(`/api/events/${eventId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r?.campaign_id && round ? { campaign_id: r.campaign_id } : {}),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const d = body?.detail;
        throw new Error(typeof d === 'string' ? d : res.status === 404 ? 'עוד אין סבב הזמנה לשלוח ממנו בדיקה' : 'השליחה לא הצליחה. נסו שוב בעוד רגע.');
      }
      const to = String(body?.to || '');
      writeFlag(flagKey('test_sent', eventId), to || '1');
      setTestSentTo(to || '1');
    } catch (e: any) {
      setTestErr(e?.message || 'השליחה לא הצליחה. נסו שוב בעוד רגע.');
    } finally {
      setTestBusy(false);
    }
  };

  const tile = (icon: string, title: string, hint: string, onClick: () => void) => (
    <button
      key={title}
      type="button"
      onClick={onClick}
      className="su-hover-ink"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', minHeight: 56, borderRadius: 14, border: `1.5px solid ${C.lineApp}`, background: '#FFFFFF', cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit', color: C.ink, width: '100%' }}
    >
      <Ms size={20} style={{ color: C.purple, marginTop: 1 }}>{icon}</Ms>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: C.body, marginTop: 2, lineHeight: 1.45 }}>{hint}</span>
      </span>
    </button>
  );

  const steps: Step[] = [];

  steps.push({
    key: 'guests',
    title: 'הוספת מוזמנים',
    state: hasGuests ? 'done' : 'todo',
    summary: hasGuests ? `${s.invitations.total} מוזמנים ברשימה` : 'בלי מוזמנים ההזמנה לא יוצאת לאף אחד',
    body: hasGuests ? undefined : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: 10 }}>
        {tile('forum', 'שיתוף אנשי קשר בוואטסאפ', 'שולחים אנשי קשר מהטלפון ומאשרים כאן', () => navigate('/guests'))}
        {tile('table_view', 'אקסל', 'מעלים קובץ עם שמות וטלפונים', () => navigate('/guests'))}
        {tile('person_add', 'אחד אחד', 'שם וטלפון, וממשיכים לבא', () => {
          navigate('/guests');
          window.setTimeout(() => window.dispatchEvent(new Event('showup:new-guest')), 450);
        })}
      </div>
    ),
  });

  if (s.pendingImports > 0) {
    steps.push({
      key: 'imports',
      title: 'אישור אנשי קשר שהגיעו מוואטסאפ',
      state: 'todo',
      summary: `${s.pendingImports} אנשי קשר מחכים. הם נכנסים לרשימה רק אחרי אישור`,
      body: <Btn kind="smallPrimary" to="/guests/imported">לאישור אנשי הקשר</Btn>,
    });
  }

  steps.push({
    key: 'image',
    title: 'תמונת ההזמנה',
    state: hasWaImage ? 'done' : 'todo',
    summary: hasWaImage ? 'התמונה תצא בראש הודעת ההזמנה' : hasWaImage === null ? 'בודקים…' : 'בלי תמונה תצא תמונה כללית',
    body: (
      <div>
        {!showImages ? (
          <Btn kind="smallGhost" onClick={() => setShowImages(true)}>
            <Ms size={18}>photo_camera</Ms>{hasWaImage ? 'החלפת תמונה' : 'העלאת תמונה'}
          </Btn>
        ) : (
          <EventImagesPanel
            eventId={eventId}
            compact
            onChanged={() => { setTick((t) => t + 1); onChanged?.(); }}
          />
        )}
      </div>
    ),
  });

  const recipients = r?.recipients ?? s.invitations.total;
  steps.push({
    key: 'schedule',
    title: 'בדיקת הלוח',
    state: scheduleOk ? 'done' : 'todo',
    summary: r ? `${r.name || 'ההזמנה'} · ${roundWhen(r.schedule_time)}` : 'עוד אין סבב הזמנה בלוח השליחה',
    body: (
      <div>
        {r && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: 13.5, color: C.body, marginBottom: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ms size={17} style={{ color: C.purple }}>schedule</Ms>{roundWhen(r.schedule_time)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ms size={17} style={{ color: C.purple }}>group</Ms>{recipients} נמענים</span>
            {(r.template_title || r.custom_message) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ms size={17} style={{ color: C.purple }}>chat</Ms>{r.custom_message ? 'נוסח אישי' : `״${r.template_title}״`}</span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {!scheduleOk && r && (
            <Btn kind="smallPrimary" onClick={() => { writeFlag(flagKey('schedule_ok', eventId)); setScheduleOk(true); }}>נראה טוב</Btn>
          )}
          <Btn kind="smallGhost" to="/messages">ללוח השליחה</Btn>
        </div>
      </div>
    ),
  });

  steps.push({
    key: 'test',
    title: 'שליחת בדיקה אליי',
    state: testSentTo ? 'done' : 'todo',
    summary: testSentTo
      ? `נשלחה ${testSentTo.length > 1 ? `ל־${testSentTo}` : 'לטלפון שלכם'}. ככה האורחים יראו אותה`
      : 'ההזמנה האמיתית, עם הפרטים שלכם, נשלחת לוואטסאפ שלכם',
    body: (
      <div>
        <Btn kind={testSentTo ? 'smallGhost' : 'smallPrimary'} onClick={runTest} disabled={testBusy || !r}>
          <Ms size={18}>send</Ms>{testBusy ? 'שולחים…' : testSentTo ? 'לשלוח שוב' : 'שליחת בדיקה אליי'}
        </Btn>
        {!r && <div style={{ fontSize: 13, color: C.body, marginTop: 8 }}>אפשר לשלוח בדיקה אחרי שיש סבב הזמנה בלוח.</div>}
        {testErr && <div role="alert" style={{ fontSize: 13, color: C.err, marginTop: 8, lineHeight: 1.5 }}>{testErr}</div>}
      </div>
    ),
  });

  const doneCount = steps.filter((st) => st.state === 'done').length;
  const allDone = doneCount === steps.length;
  const firstTodo = steps.findIndex((st) => st.state !== 'done');
  if (firstTodo >= 0) steps[firstTodo].state = 'current';
  const open = expanded ?? !allDone;

  return (
    <Card aria-label="לפני שההזמנה יוצאת">
      {isDraftWaiting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 16, background: C.warnBg, border: `1.5px solid ${C.warnBorder}`, marginBottom: 18 }}>
          <Ms size={22} style={{ color: C.warn }}>schedule_send</Ms>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>ההזמנה ממתינה לשליחה</div>
            <div style={{ fontSize: 13.5, color: C.body, marginTop: 3, lineHeight: 1.55 }}>
              {r?.status_reason === 'no_guests'
                ? 'כשהגיע מועד השליחה עוד לא היו מוזמנים ברשימה, אז היא נשמרה כטיוטה. מוסיפים מוזמנים וקובעים לה מועד בלוח השליחה.'
                : 'מועד השליחה שנקבע כבר עבר, אז היא נשמרה כטיוטה. קובעים לה מועד חדש בלוח השליחה.'}
            </div>
          </div>
          <Btn kind="smallPrimary" to="/messages">ללוח השליחה</Btn>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Kicker>{r && !isNaN(whenTs) && !pastTime ? `ההזמנה יוצאת ${roundWhen(r.schedule_time)}` : 'הכנה לשליחה'}</Kicker>
          <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: '6px 0 0' }}>
            {allDone ? 'הכול מוכן לפני ההזמנה' : 'לפני שההזמנה יוצאת'}
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="num" style={{ fontSize: 13.5, color: C.body }}>{doneCount} מתוך {steps.length}</span>
          <button
            type="button"
            onClick={() => setExpanded(!open)}
            aria-expanded={open}
            className="su-hover-underline"
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: C.purple, padding: '10px 4px', minHeight: 44 }}
          >
            {open ? 'הסתרה' : 'הצגה'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginTop: 14 }} role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
        {steps.map((st) => (
          <span key={st.key} style={{ flex: 1, height: 6, borderRadius: 99, background: st.state === 'done' ? C.purple : C.paperWarm }} />
        ))}
      </div>

      {open && (
        <ol style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column' }}>
          {steps.map((st, i) => {
            const isDone = st.state === 'done';
            const isCurrent = st.state === 'current';
            return (
              <li key={st.key} style={{ display: 'grid', gridTemplateColumns: '32px minmax(0,1fr)', gap: 12, padding: '14px 0', borderTop: i ? `1.5px solid ${C.line2}` : 'none' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
                    background: isDone ? C.purple : isCurrent ? C.tintApp : '#FFFFFF',
                    color: isDone ? '#FFFFFF' : C.purpleDark,
                    border: `1.5px solid ${isDone ? C.purple : isCurrent ? C.tintBorder : C.field}`,
                  }}
                >
                  {isDone ? <Ms size={17}>check</Ms> : <span className="num">{i + 1}</span>}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: isDone ? C.body : C.ink }}>{st.title}</span>
                    {isDone && <Chip tone="ok">בוצע</Chip>}
                  </div>
                  <div style={{ fontSize: 13.5, color: C.body, marginTop: 3, lineHeight: 1.55 }}>{st.summary}</div>
                  {st.body && (!isDone || (st.key === 'image' && showImages)) && (
                    <div style={{ marginTop: 12 }}>{st.body}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
