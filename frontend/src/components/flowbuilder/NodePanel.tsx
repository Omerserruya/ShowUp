/** Side panel for the selected node: content, reply type, buttons, entries, exits. */
import React, { useRef } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Btn, Chip, Ms } from '../v6/ui';
import type { FlowGraph, FlowMeta, FlowNode, InputType, NodeType, Stage } from './types';
import { Counter, ErrorLine, Field, IconBtn, PanelHeader, Toggle, VarChip, inputBase, insertAtCaret, selectBase } from './controls';
import { DEFAULT_VARIABLES, INPUT_LABEL, LIMITS, NODE_TYPE_HINT, NODE_TYPE_LABEL, STAGES, STAGE_LABEL } from './labels';
import { edgeLabel, uid } from './graph';
import ResendTemplateEditor from './ResendTemplateEditor';

interface Props {
  node: FlowNode;
  graph: FlowGraph;
  meta: FlowMeta | null;
  errors: string[];
  onChange: (patch: Partial<FlowNode>) => void;
  onSetEntry: (stage: Stage, nodeId: string | null) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSelectEdge: (id: string) => void;
  onClose: () => void;
}

const INPUTS: InputType[] = ['buttons', 'list', 'number', 'text', 'none'];
const TYPES: NodeType[] = ['template', 'message', 'question', 'end'];

export default function NodePanel({ node, graph, meta, errors, onChange, onSetEntry, onDelete, onDuplicate, onSelectEdge, onClose }: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const variables = meta?.variables?.length ? meta.variables : DEFAULT_VARIABLES;
  const isList = node.input === 'list';
  const maxItems = isList ? LIMITS.listItems : LIMITS.buttons;
  const maxLabel = isList ? LIMITS.listLabel : LIMITS.buttonLabel;
  const exits = graph.edges.filter((e) => e.from === node.id);
  const stages = (meta?.stages?.length ? meta.stages : STAGES) as Stage[];

  const insertVar = (key: string) => {
    const { next, caret } = insertAtCaret(textRef.current, node.text || '', `{${key}}`);
    onChange({ text: next });
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (el) { el.focus(); el.setSelectionRange(caret, caret); }
    });
  };

  const setButton = (i: number, label: string) =>
    onChange({ buttons: node.buttons.map((b, j) => (j === i ? { ...b, label } : b)) });
  const removeButton = (i: number) => onChange({ buttons: node.buttons.filter((_, j) => j !== i) });
  const moveButton = (i: number, d: -1 | 1) => {
    const next = [...node.buttons];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ buttons: next });
  };
  const addButton = () => onChange({ buttons: [...node.buttons, { id: uid('b'), label: '' }] });

  const setType = (type: NodeType) => {
    const patch: Partial<FlowNode> = { type };
    if (type === 'end') patch.input = 'none';
    if (type === 'question' && node.input === 'none') patch.input = 'buttons';
    onChange(patch);
  };

  return (
    <div>
      <PanelHeader kicker={`צומת · ${NODE_TYPE_LABEL[node.type]}`} title={node.title || 'ללא כותרת'} onClose={onClose}>
        <IconBtn icon="content_copy" label="שכפול צומת" onClick={onDuplicate} />
        <IconBtn icon="delete" label="מחיקת צומת" tone="danger" onClick={onDelete} />
      </PanelHeader>

      {!!errors.length && (
        <div style={{ background: C.errBg, border: `1.5px solid ${C.errBorder}`, borderRadius: radius.md, padding: '8px 12px', marginBottom: 6 }}>
          {errors.map((m, i) => <ErrorLine key={i}>{m}</ErrorLine>)}
        </div>
      )}

      <Field label="כותרת (רק בשבילכם, האורח לא רואה)">
        <input style={inputBase} value={node.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="למשל: שאלת כמות מגיעים" />
      </Field>

      <Field label="סוג הצומת" hint={NODE_TYPE_HINT[node.type]}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} style={{
              height: 34, padding: '0 12px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: `1.5px solid ${node.type === t ? C.purple : C.lineApp}`, background: node.type === t ? C.tintApp : '#FFFFFF',
              color: node.type === t ? C.purpleDark : C.body,
            }}>{NODE_TYPE_LABEL[t]}</button>
          ))}
        </div>
      </Field>

      <Field label="הטקסט שהאורח מקבל" aside={<Counter value={(node.text || '').length} max={1024} />}>
        <textarea ref={textRef} rows={5} style={{ ...inputBase, resize: 'vertical' }} value={node.text}
          onChange={(e) => onChange({ text: e.target.value })} placeholder="היי {guest_name}, …" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {variables.map((v) => <VarChip key={v.key} label={v.label} onClick={() => insertVar(v.key)} />)}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>*כוכביות* יוצגו כטקסט מודגש בוואטסאפ.</div>
      </Field>

      {node.type === 'template' && (
        <ResendTemplateEditor value={node.resend_template} variables={variables}
          onChange={(v) => onChange({ resend_template: v })} />
      )}

      {node.type !== 'end' && (
        <Field label="איך האורח עונה?">
          <select style={selectBase} value={node.input} onChange={(e) => onChange({ input: e.target.value as InputType })}>
            {INPUTS.map((i) => <option key={i} value={i}>{INPUT_LABEL[i]}</option>)}
          </select>
        </Field>
      )}

      {(node.input === 'buttons' || node.input === 'list') && node.type !== 'end' && (
        <Field
          label={isList ? 'אפשרויות ברשימה' : 'כפתורים'}
          aside={<span style={{ fontSize: 12, color: node.buttons.length > maxItems ? C.err : C.muted }}>{node.buttons.length}/{maxItems}</span>}
          hint={`כל ${isList ? 'אפשרות' : 'כפתור'} היא יציאה נפרדת בקנבס - גררו ממנה חץ לצומת הבא. עד ${maxLabel} תווים.`}
          error={node.buttons.length > maxItems ? `וואטסאפ מאפשר עד ${maxItems} ${isList ? 'אפשרויות' : 'כפתורים'}` : null}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {node.buttons.map((b, i) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input
                  style={{ ...inputBase, borderColor: b.label.length > maxLabel || !b.label.trim() ? C.danger : C.field }}
                  value={b.label}
                  onChange={(e) => setButton(i, e.target.value)}
                  placeholder={isList ? `אפשרות ${i + 1}` : `כפתור ${i + 1}`}
                  aria-label={`תווית ${i + 1}`}
                />
                <Counter value={b.label.length} max={maxLabel} />
                <IconBtn icon="arrow_upward" label="למעלה" size={30} onClick={() => moveButton(i, -1)} disabled={i === 0} />
                <IconBtn icon="arrow_downward" label="למטה" size={30} onClick={() => moveButton(i, 1)} disabled={i === node.buttons.length - 1} />
                <IconBtn icon="close" label="הסרה" size={30} tone="danger" onClick={() => removeButton(i)} />
              </div>
            ))}
            {node.buttons.length < maxItems && (
              <Btn kind="smallGhost" onClick={addButton} style={{ alignSelf: 'flex-start' }}>
                <Ms size={18}>add</Ms>{isList ? 'הוספת אפשרות' : 'הוספת כפתור'}
              </Btn>
            )}
          </div>
        </Field>
      )}

      {node.input === 'number' && node.type !== 'end' && (
        <Field label="טווח מספרים מותר" hint="תשובה מחוץ לטווח תצא דרך היציאה 'מספר לא תקין'.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: C.body }}>מ-</span>
            <input type="number" style={inputBase} value={node.number?.min ?? ''}
              onChange={(e) => onChange({ number: { ...(node.number || {}), min: e.target.value === '' ? null : Number(e.target.value) } })} />
            <span style={{ fontSize: 13, color: C.body }}>עד</span>
            <input type="number" style={inputBase} value={node.number?.max ?? ''}
              onChange={(e) => onChange({ number: { ...(node.number || {}), max: e.target.value === '' ? null : Number(e.target.value) } })} />
          </div>
        </Field>
      )}

      {node.type !== 'end' && (
        <Field label="שאלות המארח" hint="אחרי הצומת הזה נשאל את השאלות שהמארח הגדיר לאירוע. בסיומן ממשיכים ביציאה 'אחרי השאלות'."
          aside={<Toggle checked={!!node.guest_questions} onChange={(v) => onChange({ guest_questions: v })} label="שאלות המארח" />}>
          <span />
        </Field>
      )}

      <Field label="נקודת התחלה" hint="השיחה מתחילה בצומת הזה כשנשלחת הודעה מהשלב שסומן.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stages.map((s) => {
            const owner = graph.entry[s];
            const mine = owner === node.id;
            const ownerNode = owner && !mine ? graph.nodes.find((n) => n.id === owner) : null;
            return (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={mine} onChange={(e) => onSetEntry(s, e.target.checked ? node.id : null)} />
                <span>{STAGE_LABEL[s] || s}</span>
                {ownerNode && <span style={{ fontSize: 12, color: C.muted }}>(כרגע: {ownerNode.title || ownerNode.id})</span>}
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="יציאות מהצומת" hint="לחיצה על יציאה פותחת את התנאי והפעולות שלה.">
        {!exits.length && <div style={{ fontSize: 13, color: C.muted }}>אין יציאות עדיין. גררו חץ מאחת הנקודות בצד הכרטיס.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {exits.map((e) => {
            const to = e.to ? graph.nodes.find((n) => n.id === e.to) : null;
            return (
              <button key={e.id} type="button" onClick={() => onSelectEdge(e.id)} style={{
                display: 'flex', alignItems: 'center', gap: 6, textAlign: 'start', padding: '7px 10px', borderRadius: 10,
                border: `1.5px solid ${C.lineApp}`, background: C.paperSoft, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: C.ink,
              }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{edgeLabel(e, graph)}</span>
                <Ms size={16} style={{ color: C.muted }}>arrow_back</Ms>
                <span style={{ fontSize: 12.5, color: C.body, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {to ? (to.title || to.id) : 'סוף השיחה'}
                </span>
                {!!e.actions.length && <Chip tone="lav" style={{ height: 20, fontSize: 11, padding: '0 6px' }}>{e.actions.length}</Chip>}
              </button>
            );
          })}
        </div>
      </Field>
      <div style={{ fontSize: 11.5, color: C.placeholder, paddingTop: 8 }}>מזהה: {node.id}</div>
    </div>
  );
}
