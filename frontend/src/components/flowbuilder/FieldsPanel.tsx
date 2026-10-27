/**
 * "שדות נוספים" - the flow's extra fields (graph.fields), shown above the
 * category tabs of the simple editor. A field is declared once for the whole
 * conversation; rules store the guest's answer in it (the "שמירה בשדה" column)
 * and the worker creates the matching event field on the first answer, so the
 * host sees the results per event.
 */
import React, { useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Ms } from '../v6/ui';
import type { FlowGraph, GraphField } from './types';
import { WordsInput } from './actions';
import { FIELD_LIMITS, FIELD_PRESETS, addField, fieldProblem, fieldUsage, graphFields, removeField, updateField } from './fields';

interface Props {
  graph: FlowGraph;
  setGraph: (fn: (g: FlowGraph) => FlowGraph) => void;
  jumpToEdge: (edgeId: string) => void;
}

const LS_OPEN = 'flowbuilder.simple.fieldsOpen';
const lsGet = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } };

function FieldRow({ graph, field, setGraph, jumpToEdge }: Props & { field: GraphField }) {
  const [confirm, setConfirm] = useState(false);
  const used = fieldUsage(graph, field.key);
  const problem = fieldProblem(field);
  const patch = (p: Partial<Omit<GraphField, 'key'>>) => setGraph((g) => updateField(g, field.key, p));
  return (
    <div className={`sfe-frow${problem ? ' bad' : ''}`} role="row">
      <div className="sfe-cell" role="cell">
        <span className="sfe-cell-label">שם השדה</span>
        <input className="sfe-finput" value={field.label} maxLength={FIELD_LIMITS.label} placeholder="למשל: הסעה"
          aria-label="שם השדה" onChange={(e) => patch({ label: e.target.value })} />
      </div>
      <div className="sfe-cell" role="cell">
        <span className="sfe-cell-label">סוג תשובה</span>
        <select className="sfe-cellsel" value={field.type} aria-label="סוג תשובה"
          onChange={(e) => patch(e.target.value === 'choice'
            ? { type: 'choice', options: field.options.length ? field.options : ['כן', 'לא'] }
            : { type: 'text', options: [] })}>
          <option value="choice">בחירה מרשימה</option>
          <option value="text">טקסט חופשי</option>
        </select>
      </div>
      <div className="sfe-cell" role="cell">
        <span className="sfe-cell-label">תשובות אפשריות</span>
        {field.type === 'choice' ? (
          <WordsInput resetKey={field.key} words={field.options} placeholder="תשובות, מופרדות בפסיק"
            style={{ height: 32, padding: '4px 9px', fontSize: 13 }} onChange={(options) => patch({ options })} />
        ) : (
          <span className="sfe-quiet">נשמר מה שהאורח כותב</span>
        )}
        {problem && <span style={{ fontSize: 12, color: C.err, marginTop: 2 }}>{problem}</span>}
      </div>
      <div className="sfe-cell" role="cell">
        <span className="sfe-cell-label">בשימוש</span>
        {used.length ? (
          <button type="button" className="sfe-link" style={{ marginTop: 0 }} onClick={() => jumpToEdge(used[0].id)}>
            <Ms size={15}>north_west</Ms>{used.length === 1 ? 'כלל אחד' : `${used.length} כללים`}
          </button>
        ) : (
          <span className="sfe-quiet">עוד לא נשמר באף כלל</span>
        )}
      </div>
      <div className="sfe-cell sfe-rowctl" role="cell">
        <button type="button" className="danger" aria-label="מחיקת השדה" title="מחיקת השדה"
          onClick={() => (used.length ? setConfirm(true) : setGraph((g) => removeField(g, field.key)))}>
          <Ms size={16}>delete</Ms>
        </button>
      </div>
      {confirm && (
        <div className="sfe-confirm" style={{ gridColumn: '1 / -1' }}>
          <span style={{ flex: '1 1 220px' }}>השדה נשמר ב-{used.length} כללים. המחיקה תסיר את השמירה מהם (התשובות שכבר נשמרו באירועים יישארו).</span>
          <button type="button" className="sfe-ghostlink" style={{ color: C.danger }} onClick={() => setGraph((g) => removeField(g, field.key))}>מחיקה</button>
          <button type="button" className="sfe-ghostlink" onClick={() => setConfirm(false)}>ביטול</button>
        </div>
      )}
    </div>
  );
}

export default function FieldsPanel({ graph, setGraph, jumpToEdge }: Props) {
  const fields = graphFields(graph);
  const [open, setOpenRaw] = useState(() => { const v = lsGet(LS_OPEN); return v == null ? true : v === '1'; });
  const [adding, setAdding] = useState(false);
  const setOpen = (v: boolean) => { setOpenRaw(v); lsSet(LS_OPEN, v ? '1' : '0'); };
  const bad = fields.some((f) => fieldProblem(f));
  const add = (f: Omit<GraphField, 'key'>) => {
    setGraph((g) => addField(g, f).graph);
    setAdding(false);
    setOpen(true);
  };

  return (
    <section className="sfe-fields" aria-label="שדות נוספים">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="sfe-caret" aria-expanded={open} aria-label={open ? 'קיפול' : 'פתיחה'} onClick={() => setOpen(!open)}>
          <Ms size={18}>{open ? 'expand_more' : 'chevron_left'}</Ms>
        </button>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>שדות נוספים</h3>
        <span className="num sfe-quiet">{fields.length || ''}</span>
        {bad && <span className="dot" aria-label="יש בעיות" style={{ width: 7, height: 7, borderRadius: '50%', background: C.err }} />}
        <span className="sfe-quiet" style={{ flex: '1 1 260px' }}>
          מידע שאוספים מהאורחים בשיחה (למשל הסעה). בוחרים בכל כלל בעמודה "שמירה בשדה", והתשובות מופיעות למארח בעמוד התובנות.
        </span>
        <span style={{ position: 'relative' }}>
          <button type="button" className="sfe-addrule" style={{ marginTop: 0 }} onClick={() => setAdding(!adding)}
            disabled={fields.length >= FIELD_LIMITS.max}>
            <Ms size={17}>add</Ms>שדה חדש
          </button>
          {adding && (
            <>
              <div className="sfe-backdrop" onClick={() => setAdding(false)} />
              <div className="sfe-pop" role="dialog" aria-label="שדה חדש" style={{ insetInlineStart: 'auto', insetInlineEnd: 0 }}>
                <div className="sfe-pop-title">איזה שדה להוסיף?</div>
                <button type="button" className="sfe-pop-item" onClick={() => add({ label: 'שדה חדש', type: 'choice', options: ['כן', 'לא'] })}>
                  <Ms size={17} style={{ color: C.purple }}>list</Ms>שדה ריק עם בחירה מרשימה
                </button>
                <button type="button" className="sfe-pop-item" onClick={() => add({ label: 'שדה חדש', type: 'text', options: [] })}>
                  <Ms size={17} style={{ color: C.purple }}>edit_note</Ms>שדה ריק עם טקסט חופשי
                </button>
                <div className="sfe-pop-title" style={{ marginTop: 8 }}>או מוכן מראש</div>
                {FIELD_PRESETS.map((p) => (
                  <button key={p.label} type="button" className="sfe-pop-item" onClick={() => add({ ...p, options: [...p.options] })}>
                    <Ms size={17} style={{ color: C.purple }}>{p.type === 'choice' ? 'checklist' : 'notes'}</Ms>
                    <span style={{ minWidth: 0 }}>
                      {p.label}
                      {p.options.length > 0 && <span className="sfe-quiet" style={{ display: 'block' }}>{p.options.join(' · ')}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
      </div>
      {open && fields.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="sfe-frow sfe-thead" role="row">
            <div className="sfe-cell">שם השדה</div>
            <div className="sfe-cell">סוג תשובה</div>
            <div className="sfe-cell">תשובות אפשריות</div>
            <div className="sfe-cell">בשימוש</div>
            <div className="sfe-cell" />
          </div>
          {fields.map((f) => <FieldRow key={f.key} graph={graph} field={f} setGraph={setGraph} jumpToEdge={jumpToEdge} />)}
          <div className="sfe-quiet" style={{ padding: '8px 4px 0' }}>
            כדי לשאול את האורחים: בעמודה "שלח" של כלל (למשל אחרי "מגיע") בוחרים "שאלה על השדה". נוצרת שאלה עם התשובות האלה, וכל תשובה נשמרת בשדה.
          </div>
        </div>
      )}
      {open && !fields.length && (
        <div className="sfe-quiet" style={{ padding: '6px 4px 0', borderRadius: radius.md }}>
          עוד אין שדות. הוסיפו שדה, למשל "נקודת איסוף להסעה" עם התשובות סבידור מרכז, קדימה צורן ולא צריך.
        </div>
      )}
    </section>
  );
}
