import React, { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@mui/material';
import { color as C } from '../../design/tokens';
import { useEvent } from '../../contexts/EventContext';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { Btn, Chip, EmptyNote, Ms } from './ui';
import {
  QuestionField, Q_MAX_OPTIONS, Q_MIN_OPTIONS, SHUTTLE_CITY_PRESET, SHUTTLE_PRESET,
  errorDetail, isGuestQuestion, optionLimit, validateQuestion,
} from './guestQuestions';

const field: React.CSSProperties = { minHeight: 48, padding: '0 14px', borderRadius: 13, border: `1.5px solid ${C.field}`, background: '#FFFFFF', fontSize: 15.5, fontFamily: 'inherit', color: C.ink, width: '100%' };
const iconBtn: React.CSSProperties = { width: 40, height: 40, flex: 'none', borderRadius: 12, border: `1.5px solid ${C.field}`, background: '#FFFFFF', color: C.body, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };

type Draft = { id?: string; label: string; options: string[]; ask: boolean };
const emptyDraft = (): Draft => ({ label: '', options: ['', ''], ask: true });

/**
 * Settings → "שאלות לאורחים". Questions (e.g. shuttle) the WhatsApp bot asks a
 * guest right after they confirm and give the party size; the web invitation
 * shows them too. Answers appear in Insights.
 */
export default function GuestQuestionsPanel() {
  const { selectedEvent } = useEvent();
  const eventId = selectedEvent?.id as string | undefined;
  const [items, setItems] = useState<QuestionField[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoadError(null);
    try {
      const res = await fetchWithAuth(`/api/events/${eventId}/fields`);
      if (!res.ok) throw new Error(await errorDetail(res, 'לא הצלחנו לטעון את השאלות'));
      const all = (await res.json()) as QuestionField[];
      setItems(all.filter(isGuestQuestion));
    } catch (e: any) {
      setLoadError(e.message || 'לא הצלחנו לטעון את השאלות');
      setItems([]);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  if (!eventId) return <EmptyNote icon="event">בחרו אירוע כדי לנהל את השאלות לאורחים</EmptyNote>;
  if (!items) return <Skeleton variant="rounded" height={180} sx={{ borderRadius: '14px' }} />;

  const startNew = (preset?: { label: string; options: string[] }) => {
    setError(null);
    setDraft(preset ? { label: preset.label, options: [...preset.options], ask: true } : emptyDraft());
  };
  const startEdit = (q: QuestionField) => {
    setError(null);
    setDraft({ id: q.id, label: q.label, options: [...(q.options || [])], ask: q.ask_in_rsvp });
  };

  const save = async () => {
    if (!draft) return;
    const options = draft.options.map((o) => o.trim());
    const v = validateQuestion(draft.label, options);
    if (v) { setError(v); return; }
    setSaving(true);
    setError(null);
    try {
      const body = { label: draft.label.trim(), options, ask_in_rsvp: draft.ask };
      const res = draft.id
        ? await fetchWithAuth(`/api/events/${eventId}/fields/${draft.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await fetchWithAuth(`/api/events/${eventId}/fields`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...body, data_type: 'enum',
              sort_order: items.reduce((m, q) => Math.max(m, q.sort_order), -1) + 1,
            }),
          });
      if (res.status === 403) throw new Error('אין לכם הרשאה לערוך שאלות באירוע הזה');
      if (!res.ok) throw new Error(await errorDetail(res, 'לא הצלחנו לשמור. נסו שוב'));
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'לא הצלחנו לשמור. נסו שוב');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (q: QuestionField) => {
    if (!window.confirm(`למחוק את השאלה "${q.label}"? גם התשובות שכבר התקבלו יימחקו.`)) return;
    setBusyId(q.id);
    try {
      const res = await fetchWithAuth(`/api/events/${eventId}/fields/${q.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await errorDetail(res, 'לא הצלחנו למחוק'));
      await load();
    } catch (e: any) {
      setLoadError(e.message || 'לא הצלחנו למחוק');
    } finally {
      setBusyId(null);
    }
  };

  const patch = async (q: QuestionField, body: Partial<QuestionField>) => {
    const res = await fetchWithAuth(`/api/events/${eventId}/fields/${q.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorDetail(res, 'לא הצלחנו לעדכן'));
  };

  const toggleAsk = async (q: QuestionField) => {
    setBusyId(q.id);
    try { await patch(q, { ask_in_rsvp: !q.ask_in_rsvp }); await load(); } catch (e: any) { setLoadError(e.message); } finally { setBusyId(null); }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const a = items[idx];
    const b = items[idx + dir];
    if (!a || !b) return;
    setBusyId(a.id);
    try {
      // Re-number the whole list so equal sort_orders can't make the swap a no-op.
      const order = items.map((q) => q.id);
      [order[idx], order[idx + dir]] = [order[idx + dir], order[idx]];
      await Promise.all(order.map((id, i) => {
        const q = items.find((x) => x.id === id)!;
        return q.sort_order === i ? null : patch(q, { sort_order: i });
      }));
      await load();
    } catch (e: any) { setLoadError(e.message); } finally { setBusyId(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, direction: 'rtl' }}>
      <p style={{ fontSize: 14, color: C.body, margin: 0, lineHeight: 1.65 }}>
        רוצים לדעת מי צריך הסעה, או כל דבר אחר? הוסיפו שאלה, והבוט ישאל אותה בוואטסאפ מיד אחרי שהאורח מאשר הגעה ואומר כמה יגיעו.
        היא תופיע גם בטופס האישור בהזמנה הדיגיטלית. את התשובות רואים בעמוד התובנות.
      </p>
      <div role="note" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 13, background: C.warnBg, border: `1.5px solid ${C.warnBorder}`, color: C.warn, fontSize: 13.5, lineHeight: 1.6 }}>
        <Ms size={18} style={{ marginTop: 1 }}>info</Ms>
        <span>השאלה נשאלת אורחים שמאשרים הגעה מעכשיו. מי שכבר אישר לא יקבל אותה</span>
      </div>

      {loadError && <div role="alert" style={{ fontSize: 13.5, color: C.danger, fontWeight: 500 }}>{loadError}</div>}

      {items.length === 0 && !draft && (
        <EmptyNote icon="help">עוד אין שאלות לאורחים. אפשר להתחיל מהשאלה הנפוצה - הסעה.</EmptyNote>
      )}

      {items.map((q, i) => (
        <div key={q.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 0', borderBottom: `1.5px solid ${C.line2}`, opacity: busyId === q.id ? 0.55 : 1 }}>
          <span className="num" style={{ fontSize: 12, color: C.purple, paddingTop: 4, width: 22, flex: 'none' }}>{String(i + 1).padStart(2, '0')}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.4 }}>{q.label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {(q.options || []).map((o) => <Chip key={o} tone="quiet" style={{ fontWeight: 500 }}>{o}</Chip>)}
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13.5, color: C.body, cursor: 'pointer' }}>
              <input type="checkbox" checked={q.ask_in_rsvp} disabled={busyId === q.id} onChange={() => toggleAsk(q)} style={{ width: 18, height: 18, accentColor: C.purple }} />
              לשאול בוואטסאפ אחרי אישור הגעה
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" style={iconBtn} onClick={() => move(i, -1)} disabled={i === 0 || !!busyId} aria-label="להזיז למעלה"><Ms size={18}>arrow_upward</Ms></button>
            <button type="button" style={iconBtn} onClick={() => move(i, 1)} disabled={i === items.length - 1 || !!busyId} aria-label="להזיז למטה"><Ms size={18}>arrow_downward</Ms></button>
            <button type="button" style={iconBtn} onClick={() => startEdit(q)} disabled={!!busyId} aria-label={`עריכת השאלה ${q.label}`}><Ms size={18}>edit</Ms></button>
            <button type="button" style={{ ...iconBtn, color: C.danger }} onClick={() => remove(q)} disabled={!!busyId} aria-label={`מחיקת השאלה ${q.label}`}><Ms size={18}>delete</Ms></button>
          </div>
        </div>
      ))}

      {draft ? (
        <QuestionEditor draft={draft} setDraft={setDraft} error={error} saving={saving} onSave={save}
                        onCancel={() => { setDraft(null); setError(null); }} />
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn kind="smallPrimary" onClick={() => startNew(SHUTTLE_PRESET)}><Ms size={18}>directions_bus</Ms>הסעה</Btn>
          <Btn kind="smallGhost" onClick={() => startNew(SHUTTLE_CITY_PRESET)}><Ms size={18}>location_city</Ms>הסעה לפי עיר</Btn>
          <Btn kind="smallGhost" onClick={() => startNew()}><Ms size={18}>add</Ms>שאלה חדשה</Btn>
        </div>
      )}
    </div>
  );
}

function QuestionEditor({ draft, setDraft, error, saving, onSave, onCancel }: {
  draft: Draft; setDraft: (d: Draft) => void; error: string | null; saving: boolean;
  onSave: () => void; onCancel: () => void;
}) {
  const lim = optionLimit(draft.options.length);
  const setOpt = (i: number, v: string) => setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? v : o)) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18, borderRadius: 16, border: `1.5px solid ${C.tintBorder}`, background: C.tintApp }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>השאלה</span>
        <input className="su-input" value={draft.label} maxLength={100} placeholder="למשל: צריכים הסעה לאירוע?"
               onChange={(e) => setDraft({ ...draft, label: e.target.value })} style={field} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>תשובות אפשריות</span>
        <span style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
          {draft.options.length <= 3
            ? 'עד 3 תשובות יופיעו ככפתורים בוואטסאפ - עד 20 תווים לכל תשובה.'
            : 'מ־4 תשובות ומעלה יופיעו כרשימת בחירה בוואטסאפ - עד 24 תווים לכל תשובה.'}
        </span>
        {draft.options.map((o, i) => {
          const over = o.trim().length > lim;
          return (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="su-input" value={o} placeholder={`תשובה ${i + 1}`} aria-label={`תשובה ${i + 1}`}
                     onChange={(e) => setOpt(i, e.target.value)}
                     style={{ ...field, borderColor: over ? C.danger : C.field }} />
              <span className="num" style={{ fontSize: 12, width: 40, flex: 'none', textAlign: 'center', color: over ? C.danger : C.muted }}>{o.trim().length}/{lim}</span>
              <button type="button" style={iconBtn} aria-label={`הסרת תשובה ${i + 1}`}
                      disabled={draft.options.length <= Q_MIN_OPTIONS}
                      onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}>
                <Ms size={18}>close</Ms>
              </button>
            </div>
          );
        })}
        {draft.options.length < Q_MAX_OPTIONS && (
          <button type="button" onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}
                  style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '4px 0', color: C.purple, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Ms size={18}>add</Ms>עוד תשובה
          </button>
        )}
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.ask} onChange={(e) => setDraft({ ...draft, ask: e.target.checked })} style={{ width: 18, height: 18, accentColor: C.purple }} />
        לשאול בוואטסאפ אחרי אישור הגעה
      </label>
      {draft.id && (
        <span style={{ fontSize: 12.5, color: C.muted }}>שינוי נוסח של תשובה לא משנה תשובות שכבר התקבלו.</span>
      )}
      {error && <div role="alert" style={{ fontSize: 13.5, color: C.danger, fontWeight: 500 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Btn kind="smallPrimary" onClick={onSave} disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</Btn>
        <Btn kind="smallGhost" onClick={onCancel} disabled={saving}>ביטול</Btn>
      </div>
    </div>
  );
}
