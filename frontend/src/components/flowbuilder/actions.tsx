/** Edge action editing, shared by the canvas EdgePanel and the simple rule table. */
import React, { useEffect, useRef, useState } from 'react';
import { color as C } from '../../design/tokens';
import type { ActionType, FlowAction, FlowMeta } from './types';
import { VarChip, inputBase, insertAtCaret, selectBase } from './controls';
import { DEFAULT_FIELDS, RSVP_LABEL } from './labels';

export const ACTIONS: ActionType[] = ['set_rsvp', 'set_field', 'add_tag', 'notify_host', 'stop_reminders'];
export const RSVP_VALUES = ['confirmed', 'declined', 'maybe'];
const CUSTOM = '__custom__';

export const metaFields = (meta: FlowMeta | null) => (meta?.fields?.length ? meta.fields : DEFAULT_FIELDS);

export const newAction = (type: ActionType, firstField: string): FlowAction => {
  switch (type) {
    case 'set_rsvp': return { type, value: 'confirmed' };
    case 'set_field': return { type, field: firstField, value: '{answer}' };
    case 'add_tag': return { type, tag: '' };
    case 'notify_host': return { type, text: '' };
    default: return { type: 'stop_reminders' };
  }
};

/** Comma-separated words; keeps the raw text so typing commas isn't fought. */
export function WordsInput({ resetKey, words, onChange, style, placeholder }: {
  resetKey: string; words: string[]; onChange: (w: string[]) => void; style?: React.CSSProperties; placeholder?: string;
}) {
  const [raw, setRaw] = useState(words.join(', '));
  // Reset only when switching edges.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRaw(words.join(', ')); }, [resetKey]);
  return (
    <input
      style={{ ...inputBase, ...style }}
      value={raw}
      placeholder={placeholder ?? 'למשל: כן, מגיע, נגיע'}
      aria-label="מילים"
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select style={selectBase} value={known ? action.field : CUSTOM}
        onChange={(e) => onChange({ ...action, field: e.target.value === CUSTOM ? 'custom:' : e.target.value })}>
        {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        <option value={CUSTOM}>שדה מותאם אישית…</option>
      </select>
      {!known && (
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

/** Parameters of one action (nothing for stop_reminders). */
export function ActionEditor({ action, meta, onChange }: { action: FlowAction; meta: FlowMeta | null; onChange: (a: FlowAction) => void }) {
  const a = action;
  if (a.type === 'set_rsvp') {
    return (
      <select style={selectBase} value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value })} aria-label="סטטוס הגעה">
        {RSVP_VALUES.map((v) => <option key={v} value={v}>{RSVP_LABEL[v]}</option>)}
      </select>
    );
  }
  if (a.type === 'set_field') return <SetFieldEditor action={a} fields={metaFields(meta)} onChange={onChange} />;
  if (a.type === 'add_tag') {
    return <input style={inputBase} value={a.tag} placeholder="שם התגית, למשל: צמחוני" aria-label="תגית" onChange={(e) => onChange({ ...a, tag: e.target.value })} />;
  }
  if (a.type === 'notify_host') {
    return (
      <textarea rows={2} style={{ ...inputBase, resize: 'vertical' }} value={a.text} aria-label="טקסט ההתראה"
        placeholder="למשל: {guest_name} ביקש/ה לדבר איתכם" onChange={(e) => onChange({ ...a, text: e.target.value })} />
    );
  }
  return <div style={{ fontSize: 12.5, color: C.muted }}>האורח לא יקבל יותר תזכורות לאירוע הזה.</div>;
}
