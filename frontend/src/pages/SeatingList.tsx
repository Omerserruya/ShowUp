import React, { useMemo, useState } from 'react';
import { color as C } from '../design/tokens';
import { useSnapshot } from '../contexts/SnapshotContext';
import { useEvent } from '../contexts/EventContext';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { Btn, Ms, EmptyNote, initialsOf } from '../components/v6/ui';
import type { GuestRow } from '../adapters/eventSnapshot';
import EntrancePanel from '../components/v6/EntrancePanel';

/**
 * Seating as a list with fill bars (Mobile Flows 05): no hall map on a phone.
 * Tap a waiting guest, then a table. Same data as the desktop map:
 * event.seatingLayout.tables + guests.table_number (= parseInt(table.id)).
 */
export default function SeatingList() {
  const { snapshot: s, refresh } = useSnapshot();
  const { selectedEvent, fetchEvents } = useEvent() as any;
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSeats, setNewSeats] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tables = useMemo(() => {
    if (!s) return [];
    return [...s.tables].sort((a, b) => (b.seats - b.taken > 0 ? 1 : 0) - (a.seats - a.taken > 0 ? 1 : 0) || a.number - b.number);
  }, [s]);

  if (!s) return null;
  const pickedGuest = s.unseated.find((g) => g.id === picked) || null;

  const seat = async (g: GuestRow, table: number | null) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetchWithAuth(`/api/guests/${g.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table_number: table }) });
      if (!r.ok) throw new Error();
      setPicked(null);
      refresh();
    } catch { setMsg('השינוי לא נשמר. בדקו את החיבור ונסו שוב'); } finally { setBusy(false); }
  };

  const addTable = async () => {
    if (!selectedEvent?.id) return;
    setBusy(true); setMsg(null);
    try {
      const evRes = await fetchWithAuth(`/api/events/${selectedEvent.id}`);
      const ev = evRes.ok ? await evRes.json() : {};
      const current: any[] = (ev.seatingLayout || ev.seating_layout || {}).tables || [];
      const used = [...current.map((t) => parseInt(String(t.id), 10)), ...s.guests.map((g) => g.table || 0)].filter((n) => !Number.isNaN(n));
      const id = String(Math.max(0, ...used) + 1);
      const table = { id, name: newName.trim() || `שולחן ${id}`, seats: newSeats, style: 'round', side: 'bride', position: { x: 100 + current.length * 220, y: 100 }, size: { width: 200, height: 200 } };
      const r = await fetchWithAuth(`/api/events/${selectedEvent.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seatingLayout: { tables: [...current, table] } }) });
      if (!r.ok) throw new Error();
      setAdding(false); setNewName('');
      await fetchEvents?.();
      refresh();
    } catch { setMsg('לא הצלחנו להוסיף שולחן. נסו שוב'); } finally { setBusy(false); }
  };

  const bar = (taken: number, cap: number) => {
    const full = cap > 0 && taken >= cap;
    const pct = cap ? Math.min(100, Math.round((taken / cap) * 100)) : 0;
    return (
      <span style={{ display: 'block', height: 8, borderRadius: 99, background: C.paperWarm, overflow: 'hidden', marginTop: 8 }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', borderRadius: 99, background: full ? C.ok : taken ? C.purple : C.field }} />
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <EntrancePanel eventId={selectedEvent?.id} />
      {s.unseated.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 14, background: C.tintApp, border: `1.5px solid ${C.tintBorder}`, color: C.purpleDark, fontSize: 14, lineHeight: 1.5 }}>
            <Ms size={20}>touch_app</Ms>
            <span>{s.unseated.length} אורחים מחכים לשולחן. לוחצים על שם ואז על שולחן</span>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {s.unseated.map((g) => {
              const on = picked === g.id;
              return (
                <button key={g.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? null : g.id)} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${on ? C.purple : C.field}`, background: on ? C.tintApp : '#FFFFFF', color: on ? C.purpleDark : C.ink, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {g.name}<span className="num" style={{ fontSize: 12, color: C.muted }}>{g.people}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {msg && <div role="alert" style={{ fontSize: 13.5, color: C.danger, fontWeight: 500 }}>{msg}</div>}

      {tables.length === 0 && <EmptyNote icon="table_bar">עוד אין שולחנות. מוסיפים שולחן ראשון, ומשבצים.</EmptyNote>}

      {tables.map((t) => {
        const seated = s.guests.filter((g) => g.table === t.number && g.status !== 'declined');
        const free = t.seats - t.taken;
        const fits = pickedGuest ? pickedGuest.people <= free : true;
        const summary = seated.length === 0 ? 'ריק' : free <= 0 ? 'מלא' : seated.slice(0, 2).map((g) => g.name).join(', ') + (seated.length > 2 ? ` ועוד ${seated.length - 2}` : '');
        const isOpen = open === t.number;
        return (
          <div key={t.number} style={{ background: '#FFFFFF', border: `1.5px solid ${pickedGuest && fits ? C.tintBorder : C.lineApp}`, borderRadius: 16, overflow: 'hidden' }}>
            <button
              type="button"
              disabled={busy || (!!pickedGuest && !fits)}
              onClick={() => (pickedGuest ? seat(pickedGuest, t.number) : setOpen(isOpen ? null : t.number))}
              style={{ display: 'block', width: '100%', padding: '14px 16px', border: 'none', background: 'transparent', textAlign: 'right', cursor: 'pointer', fontFamily: 'inherit', color: C.ink, opacity: pickedGuest && !fits ? 0.5 : 1 }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 15.5, fontWeight: 600 }}>{t.name}</span>
                <span className="num" style={{ fontSize: 15, fontWeight: 600, color: free <= 0 ? C.ok : C.purpleDark }}>{t.taken}/{t.seats}</span>
              </span>
              {bar(t.taken, t.seats)}
              <span style={{ display: 'block', fontSize: 13, color: C.muted, marginTop: 6 }}>{pickedGuest ? (fits ? `להושיב כאן את ${pickedGuest.name}` : 'אין מספיק מקום') : summary}</span>
            </button>
            {isOpen && !pickedGuest && (
              <div style={{ borderTop: `1.5px solid ${C.line2}`, padding: '4px 16px 10px' }}>
                {seated.length === 0 && <EmptyNote icon="event_seat">אף אחד עוד לא יושב כאן.</EmptyNote>}
                {seated.map((g) => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1.5px solid ${C.line2}` }}>
                    <span style={{ width: 36, height: 36, borderRadius: '50%', background: C.tintApp, color: C.purpleDark, fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initialsOf(g.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{g.name}</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: C.muted }}>{g.people === 1 ? 'אדם אחד' : `${g.people} אנשים`}</span>
                    </span>
                    <button type="button" aria-label={`להוריד את ${g.name} מהשולחן`} onClick={() => seat(g, null)} disabled={busy} style={{ width: 44, height: 44, border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer' }}><Ms size={20}>close</Ms></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div style={{ background: '#FFFFFF', border: `1.5px solid ${C.lineApp}`, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>שם</span>
            <input className="su-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="למשל: שולחן המשפחה" style={{ minHeight: 52, padding: '0 14px', borderRadius: 13, border: `1.5px solid ${C.field}`, background: C.paperSoft, fontSize: 16, fontFamily: 'inherit' }} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>כמה מקומות</span>
            <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {[8, 10, 12, 14].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={newSeats === n} onClick={() => setNewSeats(n)} style={{ minHeight: 44, borderRadius: 11, border: `1.5px solid ${newSeats === n ? C.purple : C.field}`, background: newSeats === n ? C.tintApp : '#FFFFFF', color: newSeats === n ? C.purpleDark : C.ink, fontWeight: 600, fontFamily: 'inherit', fontSize: 15 }}>{n}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={addTable} disabled={busy} style={{ flex: 1 }}>הוספת השולחן</Btn>
            <Btn kind="ghost" onClick={() => setAdding(false)}>ביטול</Btn>
          </div>
        </div>
      ) : (
        <Btn kind="ghost" onClick={() => setAdding(true)}><Ms size={20}>add</Ms>שולחן חדש</Btn>
      )}
    </div>
  );
}
