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
import { ROLES, SUBJECT_FIELDS } from '../../config/eventSubjects';

const field: React.CSSProperties = { minHeight: 48, padding: '0 14px', borderRadius: 13, border: `1.5px solid ${C.field}`, background: '#FFFFFF', fontSize: 15.5, fontFamily: 'inherit', color: C.ink, width: '100%' };

const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
    {children}
  </label>
);

type Subj = Record<string, string>;

/**
 * Settings → "פרטי האירוע" (Platform v6 settings group). Edits the fields the
 * API allows (PUT /api/events/{id}: name, event_date, location, subjects, gift).
 * These values flow into messages that haven't gone out yet - the subjects are
 * the couple / honoree / parents / company names the templates address.
 */
export default function EventDetailsPanel() {
  const { selectedEvent, fetchEvents } = useEvent() as any;
  const { refresh } = useSnapshot();
  const iso = eventDateISO(selectedEvent);
  const fields = SUBJECT_FIELDS[selectedEvent?.type ?? selectedEvent?.eventType ?? selectedEvent?.event_type ?? ''] || [];
  const initial = () => {
    const d = iso ? new Date(iso) : null;
    // Display in Israel time, which is how the wizard stored it.
    const il = d ? new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })) : null;
    const stored: Subj = selectedEvent?.subjects || {};
    const subj: Subj = {};
    for (const f of fields) {
      subj[f.key] = stored[f.key] || '';
      if (f.role) subj[f.role] = stored[f.role] || (f.role === 'role1' ? 'bride' : 'groom');
    }
    return {
      name: selectedEvent?.name || '',
      date: il ? dayjs(il).format('YYYY-MM-DD') : '',
      time: il ? dayjs(il).format('HH:mm') : '',
      location: parseLocation(selectedEvent?.location).name,
      subj,
      giftUrl: selectedEvent?.gift?.url || '',
      giftPhone: selectedEvent?.gift?.bit_phone || '',
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
    const subj: Subj = {};
    for (const [k, val] of Object.entries(v.subj)) if (val.trim() !== orig.subj[k]) subj[k] = val.trim();
    if (Object.keys(subj).length) body.subjects = subj;
    if (v.giftUrl.trim() !== orig.giftUrl || v.giftPhone.trim() !== orig.giftPhone) {
      body.gift = { url: v.giftUrl.trim(), bit_phone: v.giftPhone.trim() };
    }
    try {
      const r = await fetchWithAuth(`/api/events/${selectedEvent.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 422) {
        const code = (await r.json().catch(() => null))?.detail?.code;
        if (code === 'gift_url_invalid') { setMsg({ ok: false, t: 'הקישור למתנה צריך להתחיל ב־https://' }); return; }
        if (code === 'gift_phone_invalid') { setMsg({ ok: false, t: 'מספר הביט צריך להיות נייד, למשל 050-1234567' }); return; }
      }
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
      {fields.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
          <div>
            <span style={{ fontSize: 15, fontWeight: 600 }}>בעלי האירוע</span>
            <p style={{ fontSize: 13.5, color: C.body, margin: '4px 0 0', lineHeight: 1.6 }}>השמות שמופיעים בהודעות, למשל ״נועה ויונתן מתחתנים״.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 14 }}>
            {fields.map((f) => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <L label={f.label}>
                  <input className="su-input" value={v.subj[f.key]} maxLength={40} onChange={(e) => setV({ ...v, subj: { ...v.subj, [f.key]: e.target.value } })} style={field} />
                </L>
                {f.role && (
                  <span role="radiogroup" aria-label={`תפקיד - ${f.label}`} style={{ display: 'flex', gap: 8 }}>
                    {ROLES.map((r) => {
                      const on = v.subj[f.role!] === r.v;
                      return (
                        <button key={r.v} type="button" role="radio" aria-checked={on} onClick={() => setV({ ...v, subj: { ...v.subj, [f.role!]: r.v } })}
                          style={{ minHeight: 36, padding: '0 16px', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', border: `1.5px solid ${on ? C.purple : C.field}`, background: on ? C.tint : '#FFFFFF', color: C.ink, fontWeight: on ? 600 : 500 }}>
                          {r.t}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>מתנה</span>
          <p style={{ fontSize: 13.5, color: C.body, margin: '4px 0 0', lineHeight: 1.6 }}>
            פותחים קבוצה בביט או בפייבוקס ומדביקים כאן את הקישור שלה. הכסף עובר ישר אליכם, בלי עמלה מאיתנו.
            האורחים יקבלו כפתור ״למתנה״ בהודעות שכוללות אותו.
          </p>
        </div>
        <L label="קישור לקבוצה בביט או בפייבוקס">
          <input className="su-input" dir="ltr" inputMode="url" placeholder="https://" value={v.giftUrl} maxLength={500} onChange={(e) => setV({ ...v, giftUrl: e.target.value })} style={field} />
        </L>
        <L label="או מספר טלפון להעברה בביט (לא חובה)">
          <input className="su-input num" dir="ltr" inputMode="tel" placeholder="050-1234567" value={v.giftPhone} maxLength={20} onChange={(e) => setV({ ...v, giftPhone: e.target.value })} style={field} />
        </L>
        {v.giftPhone.trim() && <p style={{ fontSize: 13, color: C.body, margin: 0 }}>המספר יוצג לאורחים שלוחצים על הכפתור.</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Btn onClick={save} disabled={!dirty || saving}>{saving ? 'שומרים...' : 'שמירה'}</Btn>
        {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13.5, fontWeight: 500, color: msg.ok ? C.ok : C.danger }}>{msg.t}</span>}
      </div>
    </div>
  );
}
