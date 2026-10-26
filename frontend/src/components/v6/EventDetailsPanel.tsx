import React, { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { color as C } from '../../design/tokens';
import { useEvent } from '../../contexts/EventContext';
import { useSnapshot } from '../../contexts/SnapshotContext';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { israelTimeToISOUTC } from '../../utils/israelTime';
import { parseLocation } from '../../config/messaging';
import { eventDateISO } from '../../adapters/eventSnapshot';
import { Btn, Kicker } from './ui';

const field: React.CSSProperties = { minHeight: 48, padding: '0 14px', borderRadius: 13, border: `1.5px solid ${C.field}`, background: '#FFFFFF', fontSize: 15.5, fontFamily: 'inherit', color: C.ink, width: '100%' };

const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
    {children}
  </label>
);

/**
 * Settings → "פרטי האירוע" (Platform v6 settings group). Edits the fields the
 * API allows (PUT /api/events/{id}: name, event_date, location). These values
 * flow into messages that haven't gone out yet.
 */
export default function EventDetailsPanel() {
  const { selectedEvent, fetchEvents } = useEvent() as any;
  const { refresh } = useSnapshot();
  const iso = eventDateISO(selectedEvent);
  const initial = () => {
    const d = iso ? new Date(iso) : null;
    // Display in Israel time, which is how the wizard stored it.
    const il = d ? new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })) : null;
    return {
      name: selectedEvent?.name || '',
      date: il ? dayjs(il).format('YYYY-MM-DD') : '',
      time: il ? dayjs(il).format('HH:mm') : '',
      location: parseLocation(selectedEvent?.location).name,
    };
  };
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setV(initial()); setMsg(null); }, [selectedEvent?.id]);

  if (!selectedEvent) return null;
  const orig = initial();
  const dirty = JSON.stringify(v) !== JSON.stringify(orig);

  const save = async () => {
    if (!v.name.trim()) { setMsg({ ok: false, t: 'צריך שם לאירוע' }); return; }
    setSaving(true); setMsg(null);
    const body: Record<string, unknown> = {};
    if (v.name.trim() !== orig.name) body.name = v.name.trim();
    if ((v.date !== orig.date || v.time !== orig.time) && v.date && v.time) body.event_date = israelTimeToISOUTC(dayjs(v.date), v.time);
    // Only replace the location when edited, so a saved map pin (used for the
    // Waze / Google Maps links) is kept otherwise.
    if (v.location.trim() !== orig.location) body.location = v.location.trim();
    try {
      const r = await fetchWithAuth(`/api/events/${selectedEvent.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      await fetchEvents?.();
      refresh();
      setMsg({ ok: true, t: 'נשמר. הודעות שעוד לא יצאו יכללו את הפרטים החדשים' });
    } catch {
      setMsg({ ok: false, t: 'לא הצלחנו לשמור. נסו שוב' });
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}>
      <div>
        <Kicker>האירוע</Kicker>
        <p style={{ fontSize: 14, color: C.body, margin: '8px 0 0', lineHeight: 1.6 }}>הפרטים האלה נכנסים להודעות שיוצאות למוזמנים.</p>
      </div>
      <L label="שם האירוע"><input className="su-input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} style={field} /></L>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 14 }}>
        <L label="תאריך"><input className="su-input" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} style={field} /></L>
        <L label="שעה"><input className="su-input num" type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} style={field} /></L>
      </div>
      <L label="מקום"><input className="su-input" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} style={field} /></L>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Btn onClick={save} disabled={!dirty || saving}>{saving ? 'שומרים...' : 'שמירה'}</Btn>
        {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13.5, fontWeight: 500, color: msg.ok ? C.ok : C.danger }}>{msg.t}</span>}
      </div>
    </div>
  );
}
