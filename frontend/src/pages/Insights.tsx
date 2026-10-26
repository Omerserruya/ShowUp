import React, { useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@mui/material';
import { color as C } from '../design/tokens';
import { useSnapshot } from '../contexts/SnapshotContext';
import { useEvent } from '../contexts/EventContext';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { Card, Kicker, CardTitle, Ms, Chip, EmptyNote, TextLink } from '../components/v6/ui';
import type { GuestRow } from '../adapters/eventSnapshot';
import GuestQuestionsInsights from '../components/v6/GuestQuestionsInsights';

interface Daily { date: string; dateLabel: string; confirmed: number; declined: number }

/** Cumulative confirmations from GET /api/guests/daily-responses (real data, no projection). */
function ConfirmCurve() {
  const { selectedEvent } = useEvent();
  const [data, setData] = useState<Daily[] | null>(null);
  useEffect(() => {
    if (!selectedEvent?.id) return;
    let off = false;
    fetchWithAuth(`/api/guests/daily-responses?event_id=${selectedEvent.id}&period=month`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => { if (!off) setData(Array.isArray(j?.data) ? j.data : []); })
      .catch(() => { if (!off) setData([]); });
    return () => { off = true; };
  }, [selectedEvent?.id]);

  const pts = useMemo(() => {
    if (!data) return [];
    let acc = 0;
    return data.map((d) => { acc += d.confirmed || 0; return { label: d.dateLabel, v: acc }; });
  }, [data]);

  if (!data) return <Skeleton variant="rounded" height={200} sx={{ borderRadius: '14px', mt: 2.5 }} />;
  if (!pts.length || pts[pts.length - 1].v === 0) return <EmptyNote icon="show_chart">עוד אין אישורים בחודש האחרון. ברגע שיתחילו להיכנס, תראו כאן את הקצב.</EmptyNote>;

  const W = 560, H = 168;
  const max = Math.max(...pts.map((p) => p.v), 1);
  const n = pts.length;
  // RTL: time flows right → left, like the design.
  const x = (i: number) => +(W - (n === 1 ? 0 : (i / (n - 1)) * W)).toFixed(1);
  const y = (v: number) => +(H - (v / max) * (H - 8)).toFixed(1);
  const line = 'M' + pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' L');
  const area = `${line} L${x(n - 1)},${H} L${x(0)},${H} Z`;
  const step = Math.max(1, Math.ceil(n / 7));
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`אישורים מצטברים: ${pts[pts.length - 1].v}`} style={{ display: 'block', width: '100%', height: 200, marginTop: 20, overflow: 'visible' }}>
        {[42, 84, 126].map((g) => <line key={g} x1="0" y1={g} x2={W} y2={g} stroke={C.line2} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
        <line x1="0" y1={H} x2={W} y2={H} stroke={C.lineApp} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={area} fill="rgba(157,131,224,0.18)" />
        <path d={line} fill="none" stroke={C.purple} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', marginTop: 8, flexDirection: 'row-reverse' }}>
        {pts.map((p, i) => (
          <span key={i} className="num" style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: i === n - 1 ? C.purple : C.muted, textAlign: 'center', visibility: i % step === 0 || i === n - 1 ? 'visible' : 'hidden', whiteSpace: 'nowrap' }}>{p.label}</span>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 16, paddingTop: 14, borderTop: `1.5px solid ${C.line2}` }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.body }}><span style={{ width: 16, height: 2.5, background: C.purple }} />אישרו עד היום (הזמנות)</span>
      </div>
    </>
  );
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

export default function Insights() {
  const { snapshot: s } = useSnapshot();
  if (!s) return <Skeleton variant="rounded" height={320} sx={{ borderRadius: '20px' }} />;

  const d = s.event.daysUntil;
  const notes: { title: string; detail: string }[] = [];
  if (s.invitations.total && d != null && d >= 0) {
    notes.push({
      title: d <= 14 ? 'לסגור מספר עם האולם' : 'המספר לאולם, נכון להיום',
      detail: s.expected.max > s.expected.min
        ? `כרגע ${s.people.confirmed} אנשים אישרו, ועוד ${s.people.maybe} ענו ״אולי״. כדאי לתכנן בין ${s.expected.min} ל־${s.expected.max}`
        : `כרגע ${s.people.confirmed} אנשים אישרו${s.invitations.pending ? `, ועוד ${s.invitations.pending} הזמנות לא נענו` : ''}`,
    });
  }
  const callCount = s.maybe.length + s.noPartySize.length;
  if (callCount) notes.push({ title: `להתקשר ל־${callCount} שעוד לא סגרו`, detail: 'מי שענה ״אולי״ או אישר בלי לומר כמה יגיעו. שיחה קצרה סוגרת את זה מהר' });
  if (s.unseated.length && (d == null || d >= 0)) notes.push({ title: `לשבץ את ${s.unseated.length} האחרונים`, detail: 'אישרו הגעה ועדיין אין להם שולחן' });
  if (s.invitations.pending && !s.nextRound && (d == null || d >= 0)) notes.push({ title: 'לתזמן תזכורת', detail: `${s.invitations.pending} הזמנות עוד לא נענו, ואין סבב מתוזמן אליהן` });

  const calls: { g: GuestRow; why: string }[] = [
    ...s.maybe.map((g) => ({ g, why: 'ענו ״אולי״' })),
    ...s.noPartySize.map((g) => ({ g, why: 'אישרו בלי לומר כמה יגיעו' })),
    ...s.optedOut.map((g) => ({ g, why: 'ביקשו לא לקבל הודעות בוואטסאפ' })),
  ];
  const requests = s.guests.filter((g) => g.status === 'confirmed' && g.notes);
  const segCols = 'minmax(120px,1.1fr) 64px minmax(0,1.5fr) minmax(0,1.2fr)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 22, alignItems: 'start' }}>
        <Card>
          <Kicker>אישורים מצטברים · 30 הימים האחרונים</Kicker>
          <CardTitle>איך האישורים נכנסים</CardTitle>
          <ConfirmCurve />
        </Card>
        <Card>
          <Kicker>מה כדאי לעשות</Kicker>
          <CardTitle>{notes.length ? (notes.length === 1 ? 'דבר אחד לעשות' : `${notes.length} דברים לעשות`) : 'הכול מסודר'}</CardTitle>
          <div style={{ marginTop: 12 }}>
            {notes.length === 0 && <EmptyNote icon="check_circle">אין משימות פתוחות כרגע.</EmptyNote>}
            {notes.map((n, i) => (
              <div key={n.title} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 12, padding: '15px 0', borderBottom: `1.5px solid ${C.line2}` }}>
                <span className="num" style={{ fontSize: 12, color: C.purple, paddingTop: 3 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{n.title}</span>
                  <span style={{ display: 'block', fontSize: 13.5, color: C.body, marginTop: 5, lineHeight: 1.6 }}>{n.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 22, alignItems: 'start' }}>
        <Card>
          <Kicker>בשביל הקייטרינג</Kicker>
          <CardTitle style={{ margin: '8px 0 6px' }}>מה ביקשו האורחים</CardTitle>
          <p style={{ fontSize: 13.5, color: C.body, margin: '0 0 10px', lineHeight: 1.6 }}>מה שאורחים שאישרו כתבו בשיחה: מנה מיוחדת, אלרגיה או כל בקשה אחרת.</p>
          {requests.length === 0 && <EmptyNote icon="restaurant">עוד אף אורח לא כתב בקשה מיוחדת.</EmptyNote>}
          {requests.slice(0, 12).map((g) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1.5px solid ${C.line2}` }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{g.name}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 2 }}>{g.notes}</span>
              </span>
              <span className="num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.04em' }}>{g.people}</span>
            </div>
          ))}
          {requests.length > 12 && <div style={{ marginTop: 12 }}><TextLink to="/guests">עוד {requests.length - 12} ברשימת המוזמנים</TextLink></div>}
        </Card>

        <Card>
          <Kicker>עדיף בטלפון</Kicker>
          <CardTitle style={{ margin: '8px 0 6px' }}>למי כדאי להתקשר</CardTitle>
          <p style={{ fontSize: 13.5, color: C.body, margin: '0 0 10px', lineHeight: 1.6 }}>מי שעוד לא סגר סופית, או ביקש לא לקבל הודעות.</p>
          {calls.length === 0 && <EmptyNote icon="call">אין כרגע למי להתקשר.</EmptyNote>}
          {calls.slice(0, 12).map(({ g, why }) => (
            <div key={g.id + why} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1.5px solid ${C.line2}` }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{g.name}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 2 }}>{why}</span>
              </span>
              {g.phone && (
                <a href={telHref(g.phone)} aria-label={`התקשרות אל ${g.name}`} style={{ width: 44, height: 44, flex: 'none', borderRadius: 12, background: C.tintApp, border: `1.5px solid ${C.tintBorder}`, color: C.purpleDark, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ms size={19}>call</Ms>
                </a>
              )}
            </div>
          ))}
        </Card>
      </section>

      <GuestQuestionsInsights />

      <Card>
        <Kicker>לפי קבוצה</Kicker>
        <CardTitle style={{ margin: '8px 0 16px' }}>מי עונה ומי עדיין שותק</CardTitle>
        {s.groups.length === 0 ? <EmptyNote icon="groups">עוד אין מוזמנים.</EmptyNote> : (
          <div className="su-scroll-x">
            <div style={{ minWidth: 480 }}>
              <div style={{ display: 'grid', gridTemplateColumns: segCols, gap: 14, alignItems: 'center', padding: '0 12px 10px', borderBottom: `1.5px solid ${C.lineApp}`, fontSize: 12.5, fontWeight: 600, color: C.muted }}>
                <span>קבוצה</span><span>ענו</span><span>אחוז תשובות</span><span>שובצו (מתוך המאשרים)</span>
              </div>
              {s.groups.map((g) => {
                const rate = g.invited ? Math.round((g.replied / g.invited) * 100) : 0;
                const seated = g.confirmed ? Math.round((g.seated / g.confirmed) * 100) : 0;
                return (
                  <div key={g.name} className="su-hover-row" style={{ display: 'grid', gridTemplateColumns: segCols, gap: 14, alignItems: 'center', padding: '14px 12px', borderBottom: `1.5px solid ${C.line2}` }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                      {rate < 60 && g.invited >= 3 && <Chip tone="warn" style={{ height: 22, fontSize: 11.5, padding: '0 8px' }}>לטיפול</Chip>}
                    </span>
                    <span className="num" style={{ fontSize: 14, color: C.body }}>{g.replied}/{g.invited}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ flex: 1, minWidth: 0, height: 9, borderRadius: 99, background: C.paperWarm, overflow: 'hidden' }}><span style={{ display: 'block', width: `${rate}%`, height: '100%', borderRadius: 99, background: rate >= 70 ? C.purple : rate >= 55 ? C.lavMid : C.lav }} /></span>
                      <span className="num" style={{ fontSize: 15, fontWeight: 600, width: 40, textAlign: 'left' }}>{rate}%</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ flex: 1, minWidth: 0, height: 9, borderRadius: 99, background: C.paperWarm, overflow: 'hidden' }}><span style={{ display: 'block', width: `${seated}%`, height: '100%', borderRadius: 99, background: seated >= 70 ? C.ok : '#C9B98F' }} /></span>
                      <span className="num" style={{ fontSize: 13.5, color: C.body, width: 36, textAlign: 'left' }}>{g.confirmed ? `${seated}%` : '–'}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
