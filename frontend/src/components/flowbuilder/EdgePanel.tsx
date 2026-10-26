/** Side panel for the selected edge: where it goes, when it fires, what it does. */
import React, { useEffect, useRef, useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Btn, Ms } from '../v6/ui';
import type { ActionType, EdgeKind, EdgeWhen, FlowAction, FlowEdge, FlowGraph, FlowMeta } from './types';
import { ErrorLine, Field, IconBtn, PanelHeader, VarChip, inputBase, insertAtCaret, selectBase } from './controls';
import { ACTION_ICON, ACTION_LABEL, DEFAULT_FIELDS, EDGE_KIND_LABEL, RSVP_LABEL } from './labels';
import { defaultWhen, edgeLabel } from './graph';

interface Props {
  edge: FlowEdge;
  graph: FlowGraph;
  meta: FlowMeta | null;
  errors: string[];
  onChange: (patch: Partial<FlowEdge>) => void;
  onDelete: () => void;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

const KINDS: EdgeKind[] = ['button', 'rsvp', 'number', 'number_invalid', 'text_contains', 'any_text', 'done'];
const ACTIONS: ActionType[] = ['set_rsvp', 'set_field', 'add_tag', 'notify_host', 'stop_reminders'];
const RSVP_VALUES = ['confirmed', 'declined', 'maybe'];
const CUSTOM = '__custom__';

const newAction = (type: ActionType, firstField: string): FlowAction => {
  switch (type) {
    case 'set_rsvp': return { type, value: 'confirmed' };
    case 'set_field': return { type, field: firstField, value: '{answer}' };
    case 'add_tag': return { type, tag: '' };
    case 'notify_host': return { type, text: '' };
    default: return { type: 'stop_reminders' };
  }
};

function WordsInput({ edgeId, words, onChange }: { edgeId: string; words: string[]; onChange: (w: string[]) => void }) {
  const [raw, setRaw] = useState(words.join(', '));
  // Reset only when switching edges, so typing commas isn't fought.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRaw(words.join(', ')); }, [edgeId]);
  return (
    <input
      style={inputBase}
      value={raw}
      placeholder="למשל: כן, מגיע, נגיע"
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(e.target.value.split(/[,،\n]/).map((w) => w.trim()).filter(Boolean));
      }}
    />
  );
}

function SetFieldEditor({ action, fields, onChange }: {
  action: Extract<FlowAction, { type: 'set_field' }>; fields: { value: string; label: string }[]; onChange: (a: FlowAction) => void;
}) {
  const valueRef = useRef<HTMLInputElement>(null);
  const known = fields.some((f) => f.value === action.field);
  const isCustom = !known;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select style={selectBase} value={known ? action.field : CUSTOM}
        onChange={(e) => onChange({ ...action, field: e.target.value === CUSTOM ? 'custom:' : e.target.value })}>
        {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        <option value={CUSTOM}>שדה מותאם אישית…</option>
      </select>
      {isCustom && (
        <input style={inputBase} placeholder="שם השדה (באנגלית), למשל: meal" value={action.field.replace(/^custom:/, '')}
          onChange={(e) => onChange({ ...action, field: `custom:${e.target.value.trim()}` })} />
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input ref={valueRef} style={inputBase} placeholder="הערך לשמירה" value={action.value}
          onChange={(e) => onChange({ ...action, value: e.target.value })} />
        <VarChip label="התשובה" onClick={() => {
          const { next } = insertAtCaret(valueRef.current, action.value || '', '{answer}');
          onChange({ ...action, value: next });
        }} />
      </div>
      <div style={{ fontSize: 12, color: C.muted }}>{'{answer}'} = מה שהאורח ענה (המספר, הטקסט או הכפתור).</div>
    </div>
  );
}

export default function EdgePanel({ edge, graph, meta, errors, onChange, onDelete, onSelectNode, onClose }: Props) {
  const from = graph.nodes.find((n) => n.id === edge.from);
  const fields = meta?.fields?.length ? meta.fields : DEFAULT_FIELDS;
  const firstField = fields[0]?.value || 'guest_count';
  const [adding, setAdding] = useState(false);

  const setWhen = (when: EdgeWhen) => onChange({ when });
  const setAction = (i: number, a: FlowAction) => onChange({ actions: edge.actions.map((x, j) => (j === i ? a : x)) });
  const removeAction = (i: number) => onChange({ actions: edge.actions.filter((_, j) => j !== i) });
  const moveAction = (i: number, d: -1 | 1) => {
    const next = [...edge.actions];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ actions: next });
  };

  const w = edge.when;

  return (
    <div>
      <PanelHeader kicker="מעבר בין צמתים" title={edgeLabel(edge, graph)} onClose={onClose}>
        <IconBtn icon="delete" label="מחיקת המעבר" tone="danger" onClick={onDelete} />
      </PanelHeader>

      {!!errors.length && (
        <div style={{ background: C.errBg, border: `1.5px solid ${C.errBorder}`, borderRadius: radius.md, padding: '8px 12px', marginBottom: 6 }}>
          {errors.map((m, i) => <ErrorLine key={i}>{m}</ErrorLine>)}
        </div>
      )}

      <Field label="מאיפה ולאן">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, marginBottom: 8 }}>
          <button type="button" onClick={() => from && onSelectNode(from.id)} className="su-hover-underline"
            style={{ background: 'none', border: 0, padding: 0, color: C.purple, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5 }}>
            {from ? (from.title || from.id) : 'צומת שנמחק'}
          </button>
          <Ms size={16} style={{ color: C.muted }}>arrow_back</Ms>
        </div>
        <select style={selectBase} value={edge.to ?? ''} onChange={(e) => onChange({ to: e.target.value || null })}>
          <option value="">סוף השיחה (בלי הודעה נוספת)</option>
          {graph.nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.title || n.id}{n.id === edge.from ? ' (אותו צומת - שואלים שוב)' : ''}</option>
          ))}
        </select>
      </Field>

      <Field label="מתי עוברים כאן?">
        <select style={selectBase} value={w.kind} onChange={(e) => setWhen(defaultWhen(e.target.value as EdgeKind, from))}>
          {KINDS.map((k) => <option key={k} value={k}>{EDGE_KIND_LABEL[k]}</option>)}
        </select>
        {w.kind === 'button' && (
          <div style={{ marginTop: 8 }}>
            {from?.buttons.length ? (
              <select style={selectBase} value={w.button_id} onChange={(e) => setWhen({ kind: 'button', button_id: e.target.value })}>
                {!from.buttons.some((b) => b.id === w.button_id) && <option value={w.button_id}>כפתור שנמחק</option>}
                {from.buttons.map((b) => <option key={b.id} value={b.id}>{b.label || 'ללא שם'}</option>)}
              </select>
            ) : <ErrorLine>לצומת המקור אין כפתורים. הוסיפו כפתורים בצומת או בחרו תנאי אחר.</ErrorLine>}
          </div>
        )}
        {w.kind === 'rsvp' && (
          <div style={{ marginTop: 8 }}>
            <select style={selectBase} value={w.value} onChange={(e) => setWhen({ kind: 'rsvp', value: e.target.value })}>
              {RSVP_VALUES.map((v) => <option key={v} value={v}>{RSVP_LABEL[v]}</option>)}
            </select>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>מתאים כשהמערכת זיהתה את תשובת ההגעה (מכפתור התבנית או מטקסט).</div>
          </div>
        )}
        {w.kind === 'text_contains' && (
          <div style={{ marginTop: 8 }}>
            <WordsInput edgeId={edge.id} words={w.words || []} onChange={(words) => setWhen({ kind: 'text_contains', words })} />
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>מספיק שאחת המילים מופיעה בתשובה. הפרידו בפסיק.</div>
          </div>
        )}
        {w.kind === 'number_invalid' && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>כשהאורח כתב משהו שאינו מספר, או מספר מחוץ לטווח.</div>}
        {w.kind === 'any_text' && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>כל הודעת טקסט שלא התאימה לתנאי אחר.</div>}
      </Field>

      <Field label="עדיפות" hint="כשכמה תנאים מתאימים לאותה תשובה - מספר נמוך נבדק קודם.">
        <input type="number" style={{ ...inputBase, maxWidth: 120 }} value={edge.priority ?? ''}
          onChange={(e) => onChange({ priority: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="0" />
      </Field>

      <Field label="מה קורה במעבר?" hint="הפעולות מתבצעות לפי הסדר, לפני שנשלחת ההודעה הבאה.">
        {!edge.actions.length && <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>אין פעולות. אפשר רק להעביר לצומת הבא.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {edge.actions.map((a, i) => (
            <div key={i} style={{ border: `1.5px solid ${C.lineApp}`, borderRadius: radius.md, padding: 10, background: C.paperSoft }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: a.type === 'stop_reminders' ? 0 : 8 }}>
                <Ms size={17} style={{ color: C.purple }}>{ACTION_ICON[a.type] || 'bolt'}</Ms>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{ACTION_LABEL[a.type] || a.type}</span>
                <IconBtn icon="arrow_upward" label="למעלה" size={28} onClick={() => moveAction(i, -1)} disabled={i === 0} />
                <IconBtn icon="arrow_downward" label="למטה" size={28} onClick={() => moveAction(i, 1)} disabled={i === edge.actions.length - 1} />
                <IconBtn icon="close" label="הסרת פעולה" size={28} tone="danger" onClick={() => removeAction(i)} />
              </div>
              {a.type === 'set_rsvp' && (
                <select style={selectBase} value={a.value} onChange={(e) => setAction(i, { ...a, value: e.target.value })}>
                  {RSVP_VALUES.map((v) => <option key={v} value={v}>{RSVP_LABEL[v]}</option>)}
                </select>
              )}
              {a.type === 'set_field' && <SetFieldEditor action={a} fields={fields} onChange={(x) => setAction(i, x)} />}
              {a.type === 'add_tag' && (
                <input style={inputBase} value={a.tag} placeholder="שם התגית, למשל: צמחוני" onChange={(e) => setAction(i, { ...a, tag: e.target.value })} />
              )}
              {a.type === 'notify_host' && (
                <textarea rows={2} style={{ ...inputBase, resize: 'vertical' }} value={a.text}
                  placeholder="למשל: {guest_name} ביקש/ה לדבר איתכם" onChange={(e) => setAction(i, { ...a, text: e.target.value })} />
              )}
            </div>
          ))}
        </div>
        {adding ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {ACTIONS.map((t) => (
              <button key={t} type="button" onClick={() => { onChange({ actions: [...edge.actions, newAction(t, firstField)] }); setAdding(false); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 11px', borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${C.tintBorder}`, background: C.tintApp, color: C.purpleDark, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                }}>
                <Ms size={16}>{ACTION_ICON[t]}</Ms>{ACTION_LABEL[t]}
              </button>
            ))}
            <Btn kind="smallGhost" onClick={() => setAdding(false)} style={{ minHeight: 34 }}>ביטול</Btn>
          </div>
        ) : (
          <Btn kind="smallGhost" onClick={() => setAdding(true)} style={{ marginTop: 10 }}><Ms size={18}>add</Ms>הוספת פעולה</Btn>
        )}
      </Field>
      <div style={{ fontSize: 11.5, color: C.placeholder, paddingTop: 8 }}>מזהה: {edge.id}</div>
    </div>
  );
}
