import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@mui/material';
import { color as C } from '../design/tokens';
import { useEvent } from '../contexts/EventContext';
import { useSnapshot } from '../contexts/SnapshotContext';
import { agoLabel, STATUS_LABEL } from '../adapters/eventSnapshot';
import { computeNextStep } from '../components/shell/NextStepCard';
import PreSendChecklist from '../components/v6/PreSendChecklist';
import LoadErrorState from '../components/dashboard/LoadErrorState';
import { Card, Kicker, Ms, Chip, Dot, Btn, TextLink, FigureStrip, EmptyNote, STATUS_TONE } from '../components/v6/ui';
import type { ChipTone } from '../design/tokens';

/**
 * Home (סקירה), design v6. Answers "is my event under control?": how many are
 * coming, what's waiting for me, what just came in on WhatsApp, and the rounds.
 * All numbers come from the Snapshot adapter (real guests + campaigns).
 */
function Overview() {
  const navigate = useNavigate();
  const { selectedEvent } = useEvent();
  const { snapshot: s, loading, error, refresh } = useSnapshot();

  if (!selectedEvent) return null;
  if (error && !s) return <LoadErrorState onRetry={refresh} />;
  if (loading || !s) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 22 }}>
          <div><Skeleton variant="text" height={64} width="80%" /><Skeleton variant="text" height={28} width="60%" /></div>
          <Skeleton variant="rounded" height={280} sx={{ borderRadius: '22px' }} />
        </div>
        <Skeleton variant="rounded" height={120} sx={{ borderRadius: '20px' }} />
      </div>
    );
  }

  const inv = s.invitations;
  const next = computeNextStep(s);
  const freeSeats = s.tables.reduce((a, t) => a + Math.max(0, t.seats - t.taken), 0);
  const withNotes = s.guests.filter((g) => g.status === 'confirmed' && g.notes).length;

  const headline = inv.total === 0
    ? 'עוד אין מוזמנים ברשימה'
    : s.people.confirmed === 0
      ? 'עוד אף אחד לא אישר. זה רק עניין של זמן'
      : `${s.people.confirmed} ${s.people.confirmed === 1 ? 'איש כבר אמר שהוא מגיע' : 'אנשים כבר אמרו שהם מגיעים'}`;
  const sub = inv.total === 0
    ? 'מוסיפים מוזמנים מאקסל, מוואטסאפ או אחד אחד, וההזמנות יוצאות לפי לוח השליחה.'
    : [
        `${inv.confirmed} מתוך ${inv.total} ההזמנות אישרו בוואטסאפ`,
        inv.pending ? `עוד ${inv.pending} לא ענו` : 'כולם ענו',
        s.unseated.length ? `ו־${s.unseated.length} מחכים לשולחן` : '',
      ].filter(Boolean).join('. ').replace('. ו־', ', ו־');

  const mix = [
    { label: 'אישרו הגעה', n: inv.confirmed, color: C.purple },
    { label: 'עוד לא ענו', n: inv.pending, color: C.lav },
    ...(inv.maybe ? [{ label: 'אולי', n: inv.maybe, color: C.lavMid }] : []),
    { label: 'לא יגיעו', n: inv.declined, color: C.field },
  ];
  const mixTotal = Math.max(1, mix.reduce((a, m) => a + m.n, 0));

  type Decision = { stat: number; title: string; detail: string; cta: string; to: string; tone: ChipTone };
  const decisions: Decision[] = [];
  if (s.pendingImports) decisions.push({ stat: s.pendingImports, title: 'אנשי קשר מוואטסאפ מחכים לאישור', detail: 'הם נכנסים לרשימה רק אחרי שתאשרו או תתקנו', cta: 'לאישור', to: '/guests/imported', tone: 'lav' });
  if (inv.pending) decisions.push({ stat: inv.pending, title: 'מוזמנים שעוד לא ענו', detail: s.nextRound ? `${s.nextRound.name} יוצאת ${s.nextRound.whenLabel}` : 'אין כרגע סבב מתוזמן אליהם', cta: s.nextRound ? 'לסבבים' : 'לתזמון', to: '/messages', tone: 'warn' });
  if (s.unseated.length) decisions.push({ stat: s.unseated.length, title: 'אישרו הגעה ועדיין בלי שולחן', detail: freeSeats ? `יש ${freeSeats} מקומות פנויים בשולחנות` : s.tables.length ? 'השולחנות מלאים, אפשר להוסיף שולחן' : 'עוד לא נוצרו שולחנות', cta: 'להושבה', to: '/seating', tone: 'lav' });
  if (s.failedDeliveries) decisions.push({ stat: s.failedDeliveries, title: 'הודעות שלא נמסרו', detail: 'בדרך כלל זה מספר שגוי. שווה לבדוק ולתקן', cta: 'למוזמנים', to: '/guests', tone: 'err' });
  if (s.noPartySize.length) decisions.push({ stat: s.noPartySize.length, title: 'אישרו בלי לומר כמה יגיעו', detail: 'שווה לשאול אותם, בשביל המספר לאולם', cta: 'לרשימה', to: '/insights', tone: 'quiet' });

  const roundCols = 'minmax(150px,1.9fr) 72px 60px 104px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* "לפני שההזמנה יוצאת": replaces the old first-run images popup and
          stays until the invitation round has been sent. */}
      <PreSendChecklist snapshot={s} eventId={selectedEvent.id} onChanged={refresh} />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 22, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '6px 0' }}>
          <h2 style={{ fontSize: 'clamp(30px,4vw,50px)', lineHeight: 1.08, letterSpacing: '-0.034em', fontWeight: 600, margin: 0, maxWidth: '16ch', textWrap: 'balance' } as React.CSSProperties}>{headline}</h2>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: C.body, margin: '14px 0 0', maxWidth: '44ch' }}>{sub}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 18px', marginTop: 18 }}>
            {[
              { icon: 'event', text: s.event.dateLine },
              ...(s.event.venue ? [{ icon: 'location_on', text: s.event.venue }] : []),
              { icon: 'groups', text: `${inv.total} מוזמנים · ${s.people.invited} נפשות` },
            ].map((m) => (
              <span key={m.icon} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, color: C.body }}>
                <Ms size={18} style={{ color: C.purple }}>{m.icon}</Ms>{m.text}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 24 }}>
            {next?.cta && <Btn to={next.cta.path}>{next.cta.label}</Btn>}
            {s.unseated.length > 0 && next?.cta?.path !== '/seating' && (
              <a href="/seating" onClick={(e) => { e.preventDefault(); navigate('/seating'); }} style={{ fontSize: 15.5, borderBottom: `1.5px solid ${C.lavMid}`, paddingBottom: 1 }}>שיבוץ {s.unseated.length} מוזמנים</a>
            )}
          </div>
        </div>

        <Card hero>
          <Kicker>כמה מגיעים</Kicker>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <span className="num" style={{ fontSize: 64, fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 0.9 }}>{s.people.confirmed}</span>
            <span style={{ fontSize: 17, color: C.body }}>אנשים מתוך {s.people.invited} שהוזמנו</span>
          </div>
          <div style={{ fontSize: 13.5, color: C.body, marginTop: 18 }}>ההזמנות לפי תשובה</div>
          <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', background: C.paperWarm, marginTop: 8, gap: 3 }} role="img" aria-label={mix.map((m) => `${m.label} ${m.n}`).join(', ')}>
            {mix.filter((m) => m.n > 0).map((m) => (
              <span key={m.label} style={{ display: 'block', width: `${(m.n / mixTotal) * 100}%`, background: m.color, borderRadius: 99 }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
            {mix.map((m) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Dot color={m.color} />
                <span style={{ flex: 1, fontSize: 14.5, color: C.body }}>{m.label}</span>
                <span className="num" style={{ fontSize: 16, fontWeight: 600 }}>{m.n}</span>
                <span className="num" style={{ fontSize: 11.5, color: C.muted, width: 38, textAlign: 'left' }}>{Math.round((m.n / mixTotal) * 100)}%</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, paddingTop: 15, borderTop: `1.5px solid ${C.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: C.body }}>
              {s.expected.max > s.expected.min ? `צפי לערב האירוע: ${s.expected.min} עד ${s.expected.max} אנשים` : `צפי לערב האירוע: ${s.expected.min} אנשים`}
            </span>
            <TextLink to="/insights">לתמונת המצב</TextLink>
          </div>
        </Card>
      </section>

      <FigureStrip
        items={[
          { label: 'צפי לאולם', value: s.expected.max > s.expected.min ? `${s.expected.min}–${s.expected.max}` : String(s.expected.min), hint: 'לפי מי שאישר ומי שענה ״אולי״' },
          { label: 'עוד לא ענו', value: inv.pending, hint: s.nextRound ? `${s.nextRound.name}: ${s.nextRound.whenLabel}` : 'אין סבב מתוזמן', color: inv.pending ? C.warn : C.ink },
          { label: 'בלי שולחן', value: s.unseated.length, hint: freeSeats ? `יש ${freeSeats} מקומות פנויים` : s.tables.length ? 'השולחנות מלאים' : 'עוד לא נוצרו שולחנות', color: s.unseated.length ? C.purple : C.ink },
          { label: 'עם בקשה מיוחדת', value: withNotes, hint: 'אישרו וכתבו הערה, למשל מנה או נגישות' },
        ]}
      />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,360px),1fr))', gap: 22, alignItems: 'start' }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>מה מחכה לך</h3>
            {decisions.length > 0 && <span style={{ fontSize: 12, letterSpacing: '.05em', color: C.muted }}>{decisions.length} פריטים</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {decisions.length === 0 && <EmptyNote icon="check_circle">אין כרגע משהו שמחכה לכם. נעדכן כאן כשיהיה.</EmptyNote>}
            {decisions.slice(0, 4).map((d) => {
              const toneBg = { ok: C.okBg, warn: C.warnBg, err: C.errBg, lav: C.tintApp, quiet: C.paperSoft }[d.tone];
              const toneFg = { ok: C.ok, warn: C.warn, err: C.err, lav: C.purpleDark, quiet: C.body }[d.tone];
              return (
                <button key={d.title} type="button" onClick={() => navigate(d.to)} className="su-hover-ink" style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 16px', borderRadius: 16, cursor: 'pointer', textAlign: 'right', background: '#FFFFFF', border: `1.5px solid ${C.lineApp}`, fontFamily: 'inherit', color: C.ink }}>
                  <span className="num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.04em', color: toneFg, width: 46, height: 46, flex: 'none', borderRadius: 13, background: toneBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{d.stat}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{d.title}</span>
                    <span style={{ display: 'block', fontSize: 13.5, color: C.body, marginTop: 3, lineHeight: 1.5 }}>{d.detail}</span>
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: C.purple, whiteSpace: 'nowrap' }}>{d.cta}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>נכנס עכשיו בוואטסאפ</h3>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.ok }}><Dot color={C.ok} size={7} />מתעדכן לבד</span>
          </div>
          <div style={{ marginTop: 12 }}>
            {s.feed.length === 0 && <EmptyNote icon="forum">עוד אין תשובות. ברגע שמישהו יענה בוואטסאפ, זה יופיע כאן.</EmptyNote>}
            {s.feed.map((g) => (
              <div key={g.id} style={{ display: 'grid', gridTemplateColumns: '48px minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: `1.5px solid ${C.line2}` }}>
                <span className="num" style={{ fontSize: 11.5, color: C.muted }}>{agoLabel(g.lastResponse)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  <span style={{ display: 'block', fontSize: 13, color: C.body, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[g.status === 'confirmed' ? (g.partyKnown ? `${g.people} נפשות` : 'עוד לא אמרו כמה') : '', g.notes].filter(Boolean).join(' · ') || STATUS_LABEL[g.status]}
                  </span>
                </span>
                <Chip tone={STATUS_TONE[g.status]}>{g.status === 'confirmed' ? 'מגיעים' : g.status === 'declined' ? 'לא יגיעו' : 'אולי'}</Chip>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>סבבי השליחה</h3>
          <TextLink to="/messages">לכל הסבבים</TextLink>
        </div>
        {s.rounds.length === 0 ? (
          <EmptyNote icon="send">עוד אין סבבי שליחה לאירוע הזה.</EmptyNote>
        ) : (
          <div className="su-scroll-x">
            <div style={{ minWidth: 420 }}>
              <div style={{ display: 'grid', gridTemplateColumns: roundCols, gap: 12, alignItems: 'center', padding: '0 12px 10px', borderBottom: `1.5px solid ${C.lineApp}`, fontSize: 12.5, fontWeight: 600, color: C.muted }}>
                <span>סבב</span><span>נשלח ל</span><span>ענו</span><span>סטטוס</span>
              </div>
              {s.rounds.map((r) => (
                <div key={r.id} className="su-hover-row" style={{ display: 'grid', gridTemplateColumns: roundCols, gap: 12, alignItems: 'center', padding: '14px 12px', borderBottom: `1.5px solid ${C.line2}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, whiteSpace: 'nowrap' }}>{r.whenLabel}</div>
                  </div>
                  <span className="num" style={{ fontSize: 15 }}>{r.recipients || '–'}</span>
                  <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>{r.isUpcoming ? 'טרם' : r.replied}</span>
                  <Chip tone={r.tone}>{r.statusLabel}</Chip>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default Overview;
