import React, { useEffect, useState } from 'react';
import { Skeleton } from '@mui/material';
import { color as C } from '../../design/tokens';
import { useEvent } from '../../contexts/EventContext';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { Card, CardTitle, Chip, EmptyNote, Kicker, Ms, TextLink } from './ui';
import { QuestionField, QuestionResults, ResultGuest, isGuestQuestion } from './guestQuestions';

/**
 * Insights → one card per host question ("שאלות לאורחים"): a bar per option
 * with counts, the guests behind each option (expandable), and the confirmed
 * guests who have not answered yet. Data: GET /api/events/{id}/fields/{fid}/results.
 */
export default function GuestQuestionsInsights() {
  const { selectedEvent } = useEvent();
  const eventId = selectedEvent?.id as string | undefined;
  const [results, setResults] = useState<QuestionResults[] | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let off = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/events/${eventId}/fields`);
        const fields: QuestionField[] = res.ok ? await res.json() : [];
        const qs = fields.filter((f) => isGuestQuestion(f) && f.ask_in_rsvp);
        const all = await Promise.all(qs.map(async (q) => {
          const r = await fetchWithAuth(`/api/events/${eventId}/fields/${q.id}/results`);
          return r.ok ? ((await r.json()) as QuestionResults) : null;
        }));
        if (!off) setResults(all.filter((x): x is QuestionResults => !!x));
      } catch {
        if (!off) setResults([]);
      }
    })();
    return () => { off = true; };
  }, [eventId]);

  if (!eventId) return null;
  if (!results) return <Skeleton variant="rounded" height={160} sx={{ borderRadius: '20px' }} />;
  if (results.length === 0) {
    return (
      <Card>
        <Kicker>שאלות לאורחים</Kicker>
        <CardTitle style={{ margin: '8px 0 6px' }}>מי צריך הסעה?</CardTitle>
        <p style={{ fontSize: 13.5, color: C.body, margin: '0 0 12px', lineHeight: 1.6 }}>
          אפשר לשאול את האורחים שאלה קצרה מיד אחרי שהם מאשרים הגעה, והתשובות יופיעו כאן.
        </p>
        <TextLink to="/settings?tab=questions">להוספת שאלה</TextLink>
      </Card>
    );
  }
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 22, alignItems: 'start' }}>
      {results.map((r) => <QuestionCard key={r.field.id} r={r} />)}
    </section>
  );
}

function QuestionCard({ r }: { r: QuestionResults }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...r.options.map((o) => o.count));
  const toggle = (k: string) => setOpen((cur) => (cur === k ? null : k));
  return (
    <Card>
      <Kicker>שאלה לאורחים · {r.total_answered} ענו</Kicker>
      <CardTitle style={{ margin: '8px 0 14px' }}>{r.field.label}</CardTitle>
      {r.options.map((o) => {
        const k = `o:${o.label}`;
        const isOpen = open === k;
        return (
          <div key={k} style={{ borderBottom: `1.5px solid ${C.line2}` }}>
            <button
              type="button" onClick={() => toggle(k)} aria-expanded={isOpen} disabled={!o.count}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto 20px', gap: 12, alignItems: 'center', width: '100%', padding: '12px 0', background: 'none', border: 'none', fontFamily: 'inherit', color: C.ink, textAlign: 'start', cursor: o.count ? 'pointer' : 'default' }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600 }}>
                  {o.label}
                  {o.archived && <Chip tone="quiet" style={{ height: 20, fontSize: 11, padding: '0 6px' }}>תשובה ישנה</Chip>}
                </span>
                <span style={{ display: 'block', marginTop: 7, height: 9, borderRadius: 99, background: C.paperWarm, overflow: 'hidden' }}>
                  <span style={{ display: 'block', width: `${Math.round((o.count / max) * 100)}%`, height: '100%', borderRadius: 99, background: C.purple }} />
                </span>
              </span>
              <span style={{ textAlign: 'left' }}>
                <span className="num" style={{ display: 'block', fontSize: 20, fontWeight: 600, letterSpacing: '-0.04em' }}>{o.count}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{o.people} אנשים</span>
              </span>
              <Ms size={18} style={{ color: C.muted, visibility: o.count ? 'visible' : 'hidden' }}>{isOpen ? 'expand_less' : 'expand_more'}</Ms>
            </button>
            {isOpen && <GuestList guests={o.guests} />}
          </div>
        );
      })}
      <div>
        <button
          type="button" onClick={() => toggle('unanswered')} aria-expanded={open === 'unanswered'}
          disabled={!r.unanswered_confirmed.length}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '14px 0 4px', background: 'none', border: 'none', fontFamily: 'inherit', color: C.body, fontSize: 13.5, fontWeight: 600, cursor: r.unanswered_confirmed.length ? 'pointer' : 'default', textAlign: 'start' }}
        >
          <span style={{ flex: 1 }}>
            {r.unanswered_confirmed.length
              ? `עוד לא ענו: ${r.unanswered_confirmed.length} מהמאשרים`
              : 'כל המאשרים ענו על השאלה'}
          </span>
          {!!r.unanswered_confirmed.length && <Ms size={18} style={{ color: C.muted }}>{open === 'unanswered' ? 'expand_less' : 'expand_more'}</Ms>}
        </button>
        {open === 'unanswered' && <GuestList guests={r.unanswered_confirmed} />}
      </div>
    </Card>
  );
}

function GuestList({ guests }: { guests: ResultGuest[] }) {
  if (!guests.length) return <EmptyNote icon="group">אין אורחים כאן.</EmptyNote>;
  return (
    <div style={{ padding: '0 0 10px', maxHeight: 320, overflowY: 'auto' }}>
      {guests.map((g) => (
        <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: C.paperSoft, marginBottom: 6 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
          <span className="num" dir="ltr" style={{ fontSize: 12.5, color: C.muted }}>{g.phone_masked}</span>
          <span className="num" style={{ fontSize: 13, fontWeight: 600, width: 28, textAlign: 'left' }} aria-label={`${g.people} אנשים`}>{g.people}</span>
        </div>
      ))}
    </div>
  );
}
