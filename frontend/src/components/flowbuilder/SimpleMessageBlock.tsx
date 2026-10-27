/**
 * Simple flow editor: one message (node) with its rules table.
 *
 * Every message has an answer mode (header segmented control):
 *   בחירות      - one fixed row per choice (button / list item, or the template's
 *                 RSVP replies); adding/removing a choice adds/removes its row
 *   טקסט חופשי  - text rows: number / number invalid / contains / RSVP intent / catch-all
 *   גם וגם      - choice rows + text rows
 * Rows whose target hasn't been shown yet nest that message underneath, so the
 * page reads "if X → send Y → (if A → send B …)". Recursion follows the
 * pre-computed tree (simpleTree.buildTree), never the raw graph.
 */
import React, { createContext, useContext, useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Chip, Ms } from '../v6/ui';
import type { FlowAction, FlowEdge, FlowGraph, FlowMeta, FlowNode, Stage } from './types';
import { Counter, VarTextarea } from './controls';
import {
  ACTION_ICON, ACTION_LABEL, DEFAULT_VARIABLES, LIMITS, NODE_TYPE_ICON, NODE_TYPE_LABEL, NODE_TYPE_TONE, RSVP_LABEL, STAGE_LABEL,
  actionSummary,
} from './labels';
import { uid, type IssueIndex } from './graph';
import { ACTIONS, ActionEditor, WordsInput, metaFields, newAction } from './actions';
import {
  addChoice, addTextRule, conditionKey, fixedRowLabel, modeSwitchCost, moveChoice, moveTextRule, nodeRows, removeChoice,
  setAnswerMode, syncNumberInput, textConditionOptions, updateChoice, whenFromKey, insertEdge,
  type AnswerMode, type NodeMode, type RowTarget, type TreeBlock,
} from './simpleTree';
import NodePanel from './NodePanel';
import ResendTemplateEditor from './ResendTemplateEditor';

// ---------------------------------------------------------------- context

export interface SimpleCtxValue {
  graph: FlowGraph;
  meta: FlowMeta | null;
  errors: IssueIndex;
  warns: IssueIndex;
  stage: Stage;
  highlight: string | null;
  simNodeId: string | null;
  mutate: (fn: (g: FlowGraph) => FlowGraph) => void;
  updateNode: (id: string, patch: Partial<FlowNode>) => void;
  updateEdge: (id: string, patch: Partial<FlowEdge>) => void;
  setEntry: (stage: Stage, id: string | null) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  deleteEdge: (id: string) => void;
  /** Create a message/end node near `fromId` and point a rule at it via `link`. */
  newTarget: (fromId: string, type: 'message' | 'end', link: (to: string) => (g: FlowGraph) => FlowGraph, edgeId?: string) => void;
  flash: (key: string) => void;
  isCollapsed: (key: string, dflt?: boolean) => boolean;
  toggle: (key: string, dflt?: boolean) => void;
  jumpTo: (nodeId: string) => void;
  jumpToEdge: (edgeId: string) => void;
}

export const SimpleCtx = createContext<SimpleCtxValue | null>(null);
const useSimple = () => useContext(SimpleCtx) as SimpleCtxValue;

export const blockDomId = (stage: string, nodeId: string) => `sfe-${stage}-${nodeId}`;
export const rowDomId = (stage: string, edgeId: string) => `sfe-row-${stage}-${edgeId}`;
export const nestKey = (stage: string, edgeId: string) => `${stage}:${edgeId}`;

const NEW_MESSAGE = '__new_message__';
const NEW_END = '__new_end__';
const STAY = '__stay__';
const newEdgeId = () => uid('e');
const newButtonId = () => uid('b');

const nodeName = (n: FlowNode | undefined) => (n ? (n.title || NODE_TYPE_LABEL[n.type]) : 'הודעה שנמחקה');

const MODES: { id: AnswerMode; label: string; hint: string }[] = [
  { id: 'choices', label: 'בחירות', hint: 'האורח בוחר מתוך אפשרויות קבועות (כפתורים, או רשימה מעל 3)' },
  { id: 'text', label: 'טקסט חופשי', hint: 'האורח כותב תשובה בעצמו' },
  { id: 'both', label: 'גם וגם', hint: 'אפשרויות לבחירה, ואפשר גם לכתוב' },
];

// ---------------------------------------------------------------- small bits

function IssueLines({ errors, warns }: { errors?: string[]; warns?: string[] }) {
  if (!errors?.length && !warns?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '4px 0 6px' }}>
      {(errors || []).map((m, i) => (
        <div key={`e${i}`} role="alert" style={{ display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 12.5, color: C.err, lineHeight: 1.45 }}>
          <Ms size={15} style={{ marginTop: 1 }}>error</Ms>{m}
        </div>
      ))}
      {(warns || []).map((m, i) => (
        <div key={`w${i}`} style={{ display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 12.5, color: C.warn, lineHeight: 1.45 }}>
          <Ms size={15} style={{ marginTop: 1 }}>warning</Ms>{m}
        </div>
      ))}
    </div>
  );
}

function ModeSwitch({ node, mode, templateChoices }: { node: FlowNode; mode: NodeMode; templateChoices: boolean }) {
  const ctx = useSimple();
  const [ask, setAsk] = useState<AnswerMode | null>(null);
  const apply = (m: AnswerMode) => { ctx.mutate((g) => setAnswerMode(g, node.id, m, newEdgeId, newButtonId)); setAsk(null); };
  const pick = (m: AnswerMode) => {
    if (m === mode) return;
    const cost = modeSwitchCost(ctx.graph, node.id, m);
    if (cost.rules || cost.choices) setAsk(m); else apply(m);
  };
  const cost = ask ? modeSwitchCost(ctx.graph, node.id, ask) : null;
  return (
    <>
      <div role="radiogroup" aria-label="איך האורח עונה" className="sfe-seg">
        {MODES.map((m) => {
          const disabled = m.id === 'text' && templateChoices;
          return (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} disabled={disabled}
              title={disabled ? 'בתבנית האורח עונה בכפתורי התבנית' : m.hint}
              className={mode === m.id ? 'on' : ''} onClick={() => pick(m.id)}>{m.label}</button>
          );
        })}
      </div>
      {ask && cost && (
        <div className="sfe-confirm" role="alertdialog">
          <Ms size={17}>warning</Ms>
          <span style={{ flex: '1 1 200px' }}>
            מעבר ל"{MODES.find((m) => m.id === ask)?.label}" ימחק {cost.rules ? `${cost.rules} כללים` : ''}{cost.rules && cost.choices ? ' ו-' : ''}{cost.choices ? `${cost.choices} בחירות` : ''}
            {ask === 'both' ? ' (כללי מספר עובדים רק בטקסט חופשי)' : ''}.
          </span>
          <button type="button" className="sfe-ghostlink" style={{ color: C.danger }} onClick={() => apply(ask)}>כן, להחליף</button>
          <button type="button" className="sfe-ghostlink" onClick={() => setAsk(null)}>ביטול</button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- actions cell

function ActionsCell({ actions, onChange }: { actions: FlowAction[]; onChange: (a: FlowAction[]) => void }) {
  const { meta } = useSimple();
  const [open, setOpen] = useState<null | 'add' | number>(null);
  const firstField = metaFields(meta)[0]?.value || 'guest_count';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', position: 'relative' }}>
      {actions.map((a, i) => (
        <span key={i} className="sfe-action">
          <button type="button" onClick={() => setOpen(i)} title="עריכה">
            <Ms size={14}>{ACTION_ICON[a.type] || 'bolt'}</Ms>
            <span className="sfe-action-text">{actionSummary(a, meta)}</span>
          </button>
          <button type="button" aria-label="הסרת פעולה" onClick={() => onChange(actions.filter((_, j) => j !== i))}><Ms size={14}>close</Ms></button>
        </span>
      ))}
      <button type="button" className="sfe-ghostlink" onClick={() => setOpen('add')}><Ms size={16}>add</Ms>פעולה</button>
      {open !== null && (
        <>
          <div className="sfe-backdrop" onClick={() => setOpen(null)} />
          <div className="sfe-pop" role="dialog" aria-label="פעולה">
            {open === 'add' ? (
              <>
                <div className="sfe-pop-title">מה לעשות כשהכלל מתקיים?</div>
                {ACTIONS.map((t) => (
                  <button key={t} type="button" className="sfe-pop-item" onClick={() => {
                    onChange([...actions, newAction(t, firstField)]);
                    setOpen(t === 'stop_reminders' ? null : actions.length);
                  }}>
                    <Ms size={17} style={{ color: C.purple }}>{ACTION_ICON[t]}</Ms>{ACTION_LABEL[t]}
                  </button>
                ))}
              </>
            ) : actions[open] ? (
              <>
                <div className="sfe-pop-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Ms size={17} style={{ color: C.purple }}>{ACTION_ICON[actions[open].type]}</Ms>
                  <span style={{ flex: 1 }}>{ACTION_LABEL[actions[open].type]}</span>
                </div>
                <ActionEditor action={actions[open]} meta={meta} onChange={(x) => onChange(actions.map((y, j) => (j === open ? x : y)))} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                  <button type="button" className="sfe-ghostlink" style={{ color: C.danger }}
                    onClick={() => { onChange(actions.filter((_, j) => j !== open)); setOpen(null); }}>מחיקה</button>
                  <button type="button" className="sfe-ghostlink" onClick={() => setOpen(null)}>סיום</button>
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- generic row

interface RowProps {
  node: FlowNode;
  edge: FlowEdge | null;
  target: RowTarget | null;
  index: number;
  condition: React.ReactNode;
  /** Patch to/actions of this row (creates the rule when edge is null). */
  onPatch: (patch: Partial<Pick<FlowEdge, 'to' | 'actions'>>) => void;
  /** Link a freshly created node: returns the graph update. */
  linkNew: (to: string) => (g: FlowGraph) => FlowGraph;
  onUp?: () => void;
  onDown?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  domKey: string;
}

function RuleRow(p: RowProps) {
  const ctx = useSimple();
  const { graph, stage, errors } = ctx;
  const e = p.edge;
  const errs = e ? errors.edges[e.id] : undefined;
  const key = e ? nestKey(stage, e.id) : '';
  const nested = p.target?.kind === 'nested' ? p.target.block : null;
  const collapsed = nested ? ctx.isCollapsed(key) : false;
  const to = e?.to ?? null;
  const target = to ? graph.nodes.find((n) => n.id === to) : undefined;
  const linkTo = p.target?.kind === 'link' ? p.target.nodeId : null;

  const onTarget = (v: string) => {
    if (v === NEW_MESSAGE || v === NEW_END) ctx.newTarget(p.node.id, v === NEW_END ? 'end' : 'message', p.linkNew, e?.id);
    else p.onPatch({ to: v === STAY ? null : v });
  };

  return (
    <>
      <div className={`sfe-row${errs?.length ? ' bad' : ''}${e && ctx.highlight === `edge:${e.id}` ? ' flash' : ''}`} id={rowDomId(stage, p.domKey)} role="row">
        <div className="sfe-cell sfe-order">
          <span className="sfe-idx num">{p.index + 1}</span>
          {(p.onUp || p.onDown) && (
            <span className="sfe-move">
              <button type="button" aria-label="העברה למעלה" disabled={!p.onUp} onClick={p.onUp}><Ms size={15}>keyboard_arrow_up</Ms></button>
              <button type="button" aria-label="העברה למטה" disabled={!p.onDown} onClick={p.onDown}><Ms size={15}>keyboard_arrow_down</Ms></button>
            </span>
          )}
        </div>
        <div className="sfe-cell" role="cell">
          <span className="sfe-cell-label">אם האורח…</span>
          {p.condition}
        </div>
        <div className="sfe-cell" role="cell">
          <span className="sfe-cell-label">אז…</span>
          <ActionsCell actions={e?.actions || []} onChange={(actions) => p.onPatch({ actions })} />
        </div>
        <div className="sfe-cell" role="cell">
          <span className="sfe-cell-label">שלח</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {nested && (
              <button type="button" className="sfe-caret" aria-expanded={!collapsed} aria-label={collapsed ? 'פתיחת ההמשך' : 'קיפול ההמשך'}
                onClick={() => ctx.toggle(key)}>
                <Ms size={18}>{collapsed ? 'chevron_left' : 'expand_more'}</Ms>
              </button>
            )}
            <select className="sfe-cellsel" value={to ?? STAY} onChange={(ev) => onTarget(ev.target.value)} aria-label="מה שולחים"
              style={{ fontWeight: to ? 600 : 400, color: to ? C.ink : C.muted }}>
              <option value={STAY}>לא לשלוח כלום (נשאר כאן)</option>
              {to && !target && <option value={to}>הודעה שנמחקה</option>}
              <optgroup label="הודעות קיימות">
                {graph.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {nodeName(n)}{n.type === 'end' ? ' · סיום' : n.type === 'template' ? ' · תבנית' : ''}{n.id === p.node.id ? ' (שוב אותה הודעה)' : ''}
                  </option>
                ))}
              </optgroup>
              <optgroup label="חדש">
                <option value={NEW_MESSAGE}>+ הודעה חדשה</option>
                <option value={NEW_END}>+ הודעת סיום חדשה</option>
              </optgroup>
            </select>
          </div>
          {linkTo && (
            <button type="button" className="sfe-link" onClick={() => ctx.jumpTo(linkTo)}>
              <Ms size={15}>{linkTo === p.node.id ? 'replay' : 'north_west'}</Ms>
              {linkTo === p.node.id ? 'שולחים שוב את אותה הודעה' : `חוזר להודעה '${nodeName(target)}'`}
            </button>
          )}
          {nested && collapsed && <span className="sfe-quiet" style={{ display: 'block', marginTop: 2 }}>ההמשך מקופל</span>}
        </div>
        <div className="sfe-cell sfe-rowctl" role="cell">
          {p.onDuplicate && <button type="button" aria-label="שכפול כלל" title="שכפול" onClick={p.onDuplicate}><Ms size={16}>content_copy</Ms></button>}
          {p.onRemove && <button type="button" aria-label={p.removeLabel || 'מחיקה'} title={p.removeLabel || 'מחיקה'} className="danger" onClick={p.onRemove}><Ms size={16}>delete</Ms></button>}
        </div>
        {!!errs?.length && <div className="sfe-row-issues"><IssueLines errors={errs} /></div>}
      </div>
      {nested && !collapsed && (
        <div className="sfe-nest">
          <MessageBlock block={nested} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- rules table

function RulesTable({ block, node }: { block: TreeBlock; node: FlowNode }) {
  const ctx = useSimple();
  const { graph, mutate } = ctx;
  const rows = nodeRows(graph, node);
  const targets = new Map(block.rows.map((r) => [r.edge.id, r.target]));
  const isList = node.input === 'list';
  const maxLabel = isList ? LIMITS.listLabel : LIMITS.buttonLabel;
  const showChoices = rows.mode === 'choices' || rows.mode === 'both';
  const showText = rows.mode === 'text' || rows.mode === 'both' || rows.mode === 'questions' || rows.text.length > 0;
  let idx = 0;

  const linkEdge = (edgeId: string) => (to: string) => (g: FlowGraph) => ({ ...g, edges: g.edges.map((x) => (x.id === edgeId ? { ...x, to } : x)) });
  const editText = (e: FlowEdge, patch: Partial<FlowEdge>) =>
    mutate((g) => syncNumberInput({ ...g, edges: g.edges.map((x) => (x.id === e.id ? { ...x, ...patch } : x)) }, node.id));

  const textRows = rows.text.map((e, i) => {
    const prev = rows.text[i - 1];
    const next = rows.text[i + 1];
    const opts = textConditionOptions(rows.mode, e.when);
    return (
      <RuleRow key={e.id} domKey={e.id} node={node} edge={e} target={targets.get(e.id) || null} index={idx++}
        onPatch={(patch) => ctx.updateEdge(e.id, patch)} linkNew={linkEdge(e.id)}
        onUp={prev && prev.when.kind === e.when.kind ? () => mutate((g) => moveTextRule(g, node.id, e.id, -1)) : undefined}
        onDown={next && next.when.kind === e.when.kind ? () => mutate((g) => moveTextRule(g, node.id, e.id, 1)) : undefined}
        onDuplicate={() => {
          const copy: FlowEdge = { ...JSON.parse(JSON.stringify(e)), id: uid('e') };
          mutate((g) => insertEdge(g, copy, e.id));
          ctx.flash(`edge:${copy.id}`);
        }}
        onRemove={() => { ctx.deleteEdge(e.id); }} removeLabel="מחיקת כלל"
        condition={(
          <>
            <select className="sfe-cellsel" value={conditionKey(e.when)} aria-label="תנאי"
              onChange={(ev) => editText(e, { when: whenFromKey(ev.target.value, e.when) })}>
              {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            {e.when.kind === 'text_contains' && (
              <WordsInput resetKey={e.id} words={e.when.words || []} placeholder="מילים, מופרדות בפסיק"
                style={{ height: 32, padding: '4px 9px', fontSize: 13, marginTop: 4 }}
                onChange={(words) => ctx.updateEdge(e.id, { when: { kind: 'text_contains', words } })} />
            )}
            {e.when.kind === 'number' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: C.body, marginTop: 4 }}>
                בין
                <input type="number" className="sfe-mini" value={node.number?.min ?? ''} aria-label="מינימום" placeholder="0"
                  onChange={(ev) => ctx.updateNode(node.id, { number: { ...(node.number || {}), min: ev.target.value === '' ? null : Number(ev.target.value) } })} />
                ל-
                <input type="number" className="sfe-mini" value={node.number?.max ?? ''} aria-label="מקסימום" placeholder="—"
                  onChange={(ev) => ctx.updateNode(node.id, { number: { ...(node.number || {}), max: ev.target.value === '' ? null : Number(ev.target.value) } })} />
              </span>
            )}
            {e.when.kind === 'number_invalid' && <span className="sfe-quiet" style={{ marginTop: 2 }}>לא מספר, או מחוץ לטווח</span>}
            {e.when.kind === 'rsvp' && e.when.typed_only && <span className="sfe-quiet" style={{ marginTop: 2 }}>רק כשכתב בטקסט</span>}
          </>
        )} />
    );
  });

  const choiceRows = rows.choices.map((c, i) => {
    const e = c.edge;
    const twins = c.linked.filter((x) => x.when.kind === 'rsvp').map((x) => (x.when.kind === 'rsvp' ? RSVP_LABEL[x.when.value] || x.when.value : ''));
    const bad = c.buttonId ? (!c.label.trim() || c.label.length > maxLabel) : false;
    return (
      <RuleRow key={c.key} domKey={e?.id || `${node.id}-${c.key}`} node={node} edge={e} target={e ? targets.get(e.id) || null : null} index={idx++}
        onPatch={(patch) => mutate((g) => updateChoice(g, node.id, c.key, patch, newEdgeId))}
        linkNew={(to) => (g) => updateChoice(g, node.id, c.key, { to }, newEdgeId)}
        onUp={c.buttonId && i > 0 ? () => mutate((g) => moveChoice(g, node.id, c.buttonId as string, -1)) : undefined}
        onDown={c.buttonId && i < rows.choices.length - 1 ? () => mutate((g) => moveChoice(g, node.id, c.buttonId as string, 1)) : undefined}
        onRemove={c.buttonId && rows.choices.length > 1 ? () => mutate((g) => removeChoice(g, node.id, c.buttonId as string)) : undefined}
        removeLabel="מחיקת הבחירה"
        condition={(
          <div className="sfe-choice">
            <span className="sfe-choice-verb">{isList ? 'בחר' : 'לחץ'}</span>
            {c.buttonId ? (
              <span className="sfe-btnchip" style={{ borderColor: bad ? C.danger : undefined, opacity: c.hidden ? 0.6 : 1 }}
                title={c.hidden ? 'הבחירה מוסתרת כרגע בהגדרות' : undefined}>
                <input value={c.label} size={Math.max(6, Math.min(maxLabel, c.label.length + 1))} aria-label={`בחירה ${i + 1}`}
                  placeholder={`בחירה ${i + 1}`}
                  onChange={(ev) => ctx.updateNode(node.id, { buttons: node.buttons.map((b) => (b.id === c.buttonId ? { ...b, label: ev.target.value } : b)) })} />
                {c.label.length > maxLabel - 4 && <Counter value={c.label.length} max={maxLabel} />}
              </span>
            ) : (
              <span className="sfe-btnchip sfe-btnchip-static" title="כפתור בתבנית WhatsApp המאושרת">{c.label}</span>
            )}
            {c.hidden && <span className="sfe-quiet">מוסתר</span>}
            {(!!twins.length || c.rsvp) && (
              <span className="sfe-quiet" style={{ width: '100%' }}>
                {c.rsvp ? `גם כשכותבים שהם ${RSVP_LABEL[c.rsvp] === 'אולי' ? 'מתלבטים' : RSVP_LABEL[c.rsvp]}` : `גם כשכותבים: ${twins.join(', ')}`}
              </span>
            )}
          </div>
        )} />
    );
  });

  const fixedRows = rows.fixed.map((e) => (
    <RuleRow key={e.id} domKey={e.id} node={node} edge={e} target={targets.get(e.id) || null} index={idx++}
      onPatch={(patch) => ctx.updateEdge(e.id, patch)} linkNew={linkEdge(e.id)}
      onRemove={rows.mode === 'none' && !node.skip ? () => ctx.deleteEdge(e.id) : undefined} removeLabel="מחיקת ההמשך"
      condition={<span className="sfe-fixed"><Ms size={15}>subdirectory_arrow_left</Ms>{fixedRowLabel(node, e)}</span>} />
  ));

  const total = rows.choices.length + rows.text.length + rows.fixed.length;
  const hasAny = rows.text.some((e) => e.when.kind === 'any_text');
  const maxChoices = LIMITS.listItems;

  return (
    <div className="sfe-rules">
      {total > 0 && (
        <div className="sfe-row sfe-thead" role="row">
          <div className="sfe-cell" />
          <div className="sfe-cell">אם האורח…</div>
          <div className="sfe-cell">אז…</div>
          <div className="sfe-cell">שלח</div>
          <div className="sfe-cell" />
        </div>
      )}
      {!total && (
        <div className="sfe-quiet" style={{ padding: '6px 4px' }}>
          {node.type === 'end' ? 'השיחה מסתיימת כאן.' : 'ההודעה לא מחכה לתשובה. בחרו למעלה איך האורח עונה, או הוסיפו המשך אוטומטי.'}
        </div>
      )}
      {showChoices && choiceRows}
      {showChoices && !rows.templateChoices && (
        <div className="sfe-addline">
          {rows.choices.length < maxChoices && (
            <button type="button" className="sfe-addrule" onClick={() => {
              const bid = uid('b');
              mutate((g) => addChoice(g, node.id, bid, uid('e')));
            }}><Ms size={17}>add</Ms>הוספת בחירה</button>
          )}
          {rows.choices.length === 3 && !isList && <span className="sfe-quiet">בחירה רביעית תהפוך את הכפתורים לרשימה</span>}
        </div>
      )}
      {showText && rows.text.length > 0 && showChoices && <div className="sfe-subhead">ואם כתב טקסט במקום לבחור</div>}
      {showText && textRows}
      {(rows.mode === 'text' || rows.mode === 'both' || (rows.mode === 'questions' && !hasAny)) && (
        <div className="sfe-addline">
          <button type="button" className="sfe-addrule" onClick={() => {
            const id = uid('e');
            mutate((g) => (rows.mode === 'questions'
              ? { ...g, edges: [...g.edges, { id, from: node.id, to: null, when: { kind: 'any_text' as const }, actions: [], priority: 0 }] }
              : addTextRule(g, node.id, id)));
            ctx.flash(`edge:${id}`);
          }}><Ms size={17}>add</Ms>{rows.mode === 'questions' ? 'מה עושים כשכותבים משהו אחר' : 'הוספת כלל טקסט'}</button>
          {rows.mode !== 'questions' && rows.text.length > 1 && (
            <span className="sfe-quiet">נבדק לפי הסדר: סטטוס הגעה, מספר, "מכיל", ובסוף כל תשובה אחרת.</span>
          )}
        </div>
      )}
      {fixedRows}
      {rows.mode === 'none' && !rows.fixed.length && node.type === 'message' && (
        <div className="sfe-addline">
          <button type="button" className="sfe-addrule" onClick={() => {
            const id = uid('e');
            mutate((g) => ({ ...g, edges: [...g.edges, { id, from: node.id, to: null, when: { kind: 'done' as const }, actions: [], priority: 0 }] }));
            ctx.flash(`edge:${id}`);
          }}><Ms size={17}>add</Ms>להמשיך מיד להודעה נוספת</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- block

export function MessageBlock({ block, headerExtra, collapseKey }: { block: TreeBlock; headerExtra?: React.ReactNode; collapseKey?: string }) {
  const ctx = useSimple();
  const { graph, meta, stage, errors, warns } = ctx;
  const node = graph.nodes.find((n) => n.id === block.nodeId);
  const [details, setDetails] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  if (!node) return null;
  const rows = nodeRows(graph, node);
  const variables = meta?.variables?.length ? meta.variables : DEFAULT_VARIABLES;
  const entries = (Object.keys(graph.entry) as Stage[]).filter((s) => graph.entry[s] === node.id);
  const bodyCollapsed = collapseKey ? ctx.isCollapsed(collapseKey, true) : false;
  const hi = ctx.highlight === `node:${node.id}`;
  const sim = ctx.simNodeId === node.id;

  return (
    <div className={`sfe-block${hi ? ' flash' : ''}${sim ? ' sim' : ''}`} id={blockDomId(stage, node.id)}>
      <div className="sfe-head">
        {collapseKey && (
          <button type="button" className="sfe-caret" aria-expanded={!bodyCollapsed} onClick={() => ctx.toggle(collapseKey, true)}
            aria-label={bodyCollapsed ? 'פתיחה' : 'קיפול'}>
            <Ms size={18}>{bodyCollapsed ? 'chevron_left' : 'expand_more'}</Ms>
          </button>
        )}
        <Ms size={18} style={{ color: C.purple, flex: 'none' }}>{NODE_TYPE_ICON[node.type]}</Ms>
        <input className="sfe-title" value={node.title} placeholder="שם ההודעה (רק בשבילכם)" aria-label="שם ההודעה"
          onChange={(e) => ctx.updateNode(node.id, { title: e.target.value })} />
        <Chip tone={NODE_TYPE_TONE[node.type]} style={{ height: 22, fontSize: 11.5, padding: '0 8px', flex: 'none' }}>{NODE_TYPE_LABEL[node.type]}</Chip>
        {node.skip && <Chip tone="quiet" style={{ height: 22, fontSize: 11.5, padding: '0 8px', flex: 'none' }}>כבוי בהגדרות - מדלגים</Chip>}
        {entries.map((s) => (
          <Chip key={s} tone="ok" style={{ height: 22, fontSize: 11.5, padding: '0 8px', flex: 'none' }}>התחלה: {STAGE_LABEL[s]}</Chip>
        ))}
        <div style={{ flex: 1 }} />
        {rows.mode === 'questions'
          ? <span className="sfe-quiet">שאלות המארח</span>
          : !(node.type === 'end' && rows.mode === 'none') && <ModeSwitch node={node} mode={rows.mode} templateChoices={rows.templateChoices} />}
        {headerExtra}
        <button type="button" className={`sfe-ghostlink${details ? ' on' : ''}`} onClick={() => setDetails((v) => !v)}>
          <Ms size={16}>tune</Ms>פרטים נוספים
        </button>
      </div>
      <IssueLines errors={errors.nodes[node.id]} warns={warns.nodes[node.id]} />

      {!bodyCollapsed && (
        <>
          {details && (
            <div className="sfe-details">
              <NodePanel node={node} graph={graph} meta={meta} errors={errors.nodes[node.id] || []}
                onChange={(p) => ctx.updateNode(node.id, p)} onSetEntry={ctx.setEntry}
                onDelete={() => ctx.deleteNode(node.id)} onDuplicate={() => ctx.duplicateNode(node.id)}
                onSelectEdge={(id) => ctx.jumpToEdge(id)} onClose={() => setDetails(false)} />
            </div>
          )}

          <div className="sfe-body">
            {node.type === 'template' ? (
              <div style={{ fontSize: 13.5, color: C.body, lineHeight: 1.6 }}>
                <Ms size={16} style={{ color: C.purple, verticalAlign: '-3px', marginInlineEnd: 4 }}>mark_email_unread</Ms>
                נשלחת כתבנית WhatsApp מאושרת
                {node.resend_template?.name ? <> · <strong style={{ color: C.ink }} dir="ltr">{node.resend_template.name}</strong></> : ' (התבנית של הקמפיין)'}
                <button type="button" className="sfe-ghostlink" style={{ marginInlineStart: 8 }} onClick={() => setTplOpen((v) => !v)}>
                  {tplOpen ? 'סגירה' : 'שינוי תבנית'}
                </button>
                {tplOpen && (
                  <div style={{ marginTop: 6 }}>
                    <ResendTemplateEditor value={node.resend_template} variables={variables} onChange={(v) => ctx.updateNode(node.id, { resend_template: v })} />
                  </div>
                )}
              </div>
            ) : node.guest_questions ? (
              <div style={{ fontSize: 13.5, color: C.body, lineHeight: 1.6 }}>
                <Ms size={16} style={{ color: C.purple, verticalAlign: '-3px', marginInlineEnd: 4 }}>quiz</Ms>
                כאן הבוט שואל את השאלות שהמארח הגדיר לאירוע, אחת אחרי השנייה.
                <VarTextarea rows={2} value={node.text} onChange={(text) => ctx.updateNode(node.id, { text })} variables={variables}
                  ariaLabel="טקסט פתיחה לשאלות" placeholder="טקסט פתיחה לפני השאלות (לא חובה)" style={{ marginTop: 6 }} />
              </div>
            ) : (
              <div className="sfe-bubble">
                <span className="sfe-label">הבוט כותב</span>
                <VarTextarea rows={Math.min(6, Math.max(2, Math.ceil((node.text || '').length / 70)))} value={node.text}
                  onChange={(text) => ctx.updateNode(node.id, { text })} variables={variables} ariaLabel="הטקסט שהאורח מקבל"
                  placeholder="היי {guest_name}, …" chipsStyle={{ marginTop: 6 }} />
              </div>
            )}
          </div>

          <RulesTable block={block} node={node} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- styles

export const SIMPLE_CSS = `
.sfe-root{--sfe-hover:${C.paperSoft};}
.sfe-block{position:relative;background:#FFFFFF;border:1.5px solid ${C.lineApp};border-radius:${radius.lg}px;padding:14px 16px 10px;transition:box-shadow .25s,border-color .25s;}
.sfe-block.flash{border-color:${C.purple};box-shadow:0 0 0 3px rgba(157,131,224,.28);}
.sfe-block.sim{border-color:${C.lavMid};}
.sfe-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.sfe-title{flex:0 1 auto;min-width:120px;width:auto;font-family:inherit;font-size:16px;font-weight:600;letter-spacing:-0.01em;color:${C.ink};border:1.5px solid transparent;border-radius:9px;padding:3px 6px;background:transparent;outline:none;}
.sfe-title:hover{border-color:${C.line2};}
.sfe-title:focus{border-color:${C.field};background:#FFFFFF;}
.sfe-body{display:flex;flex-direction:column;gap:10px;margin:8px 0 6px;}
.sfe-label{display:block;font-size:12px;font-weight:600;color:${C.muted};margin-bottom:4px;letter-spacing:.02em;}
.sfe-bubble textarea{background:${C.paperSoft};border-color:${C.line2};font-size:14px;}
.sfe-bubble textarea:focus{background:#FFFFFF;border-color:${C.field};}
.sfe-answer{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;}
.sfe-answer .sfe-label{display:inline;margin:0;}
.sfe-pill{height:28px;padding:0 11px;border-radius:999px;border:1.5px solid ${C.lineApp};background:#FFFFFF;color:${C.body};font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
.sfe-pill.on{border-color:${C.purple};background:${C.tintApp};color:${C.purpleDark};}
.sfe-btnchip{display:inline-flex;align-items:center;gap:2px;height:32px;padding:0 4px 0 2px;border-radius:10px;border:1.5px solid ${C.tintBorder};background:${C.tint};}
.sfe-btnchip input{border:0;background:transparent;font-family:inherit;font-size:13.5px;font-weight:600;color:${C.purpleDark};outline:none;padding:0 8px;min-width:40px;}
.sfe-btnchip button{border:0;background:none;color:${C.muted};cursor:pointer;display:grid;place-items:center;padding:2px;border-radius:6px;}
.sfe-btnchip button:hover{color:${C.danger};}
.sfe-mini{width:70px;height:30px;box-sizing:border-box;border:1.5px solid ${C.field};border-radius:9px;padding:0 8px;font-family:inherit;font-size:13.5px;}
.sfe-ghostlink{display:inline-flex;align-items:center;gap:3px;height:28px;padding:0 8px;border:0;border-radius:8px;background:none;color:${C.purple};font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;}
.sfe-ghostlink:hover,.sfe-ghostlink.on{background:${C.tintApp};}
.sfe-quiet{font-size:12.5px;color:${C.muted};}
.sfe-details{border:1.5px solid ${C.tintBorder};background:${C.tint};border-radius:${radius.md}px;padding:12px 14px;margin:8px 0;}
.sfe-details > div{background:transparent;}
.sfe-rules{margin-top:4px;}
.sfe-row{display:grid;grid-template-columns:46px minmax(170px,1.15fr) minmax(170px,1.35fr) minmax(170px,1fr) 64px;align-items:start;column-gap:10px;min-height:40px;padding:4px 4px;border-top:1px solid ${C.line2};border-radius:8px;}
.sfe-row:not(.sfe-thead):hover{background:var(--sfe-hover);}
.sfe-row.bad{background:${C.errBg}55;}
.sfe-row.flash{background:${C.tintApp};}
.sfe-thead{min-height:28px;border-top:0;font-size:12px;font-weight:600;color:${C.muted};letter-spacing:.02em;align-items:end;padding-bottom:2px;}
.sfe-cell{min-width:0;display:flex;flex-direction:column;justify-content:center;min-height:32px;}
.sfe-cell-label{display:none;}
.sfe-order{flex-direction:row;align-items:center;gap:2px;}
.sfe-idx{font-size:12px;color:${C.placeholder};width:16px;text-align:center;}
.sfe-move{display:inline-flex;flex-direction:column;opacity:.35;}
.sfe-row:hover .sfe-move{opacity:1;}
.sfe-move button,.sfe-rowctl button,.sfe-caret{border:0;background:none;padding:0;cursor:pointer;color:${C.body};display:grid;place-items:center;border-radius:6px;}
.sfe-move button{height:15px;width:20px;}
.sfe-move button:disabled{opacity:.3;cursor:default;}
.sfe-caret{width:26px;height:26px;flex:none;}
.sfe-caret:hover,.sfe-rowctl button:hover{background:${C.paperWarm};}
.sfe-rowctl{flex-direction:row;align-items:center;justify-content:flex-end;gap:2px;opacity:.4;}
.sfe-row:hover .sfe-rowctl{opacity:1;}
.sfe-rowctl button{width:28px;height:28px;}
.sfe-rowctl button.danger{color:${C.danger};}
.sfe-cellsel{width:100%;height:32px;box-sizing:border-box;font-family:inherit;font-size:13.5px;color:${C.ink};background:transparent;border:1.5px solid transparent;border-radius:9px;padding:0 6px;cursor:pointer;outline:none;}
.sfe-row:hover .sfe-cellsel{border-color:${C.field};background:#FFFFFF;}
.sfe-cellsel:focus{border-color:${C.purple} !important;background:#FFFFFF;}
.sfe-action{display:inline-flex;align-items:center;height:26px;border-radius:8px;background:${C.tintApp};border:1px solid ${C.tintBorder};color:${C.purpleDark};max-width:100%;}
.sfe-action button{border:0;background:none;color:inherit;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;display:inline-flex;align-items:center;gap:4px;padding:0 4px 0 8px;height:100%;min-width:0;}
.sfe-action button + button{padding:0 4px;color:${C.muted};}
.sfe-action button + button:hover{color:${C.danger};}
.sfe-action-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;}
.sfe-link{display:inline-flex;align-items:center;gap:4px;margin-top:3px;border:0;background:none;padding:2px 6px;border-radius:8px;color:${C.purple};font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-align:start;}
.sfe-link:hover{background:${C.tintApp};}
.sfe-row-issues{grid-column:2 / -1;}
.sfe-nest{position:relative;margin:6px 0 10px;padding-inline-start:30px;}
.sfe-nest::before{content:'';position:absolute;inset-inline-start:14px;top:-4px;bottom:12px;width:2px;border-radius:2px;background:${C.tintBorder};}
.sfe-nest > .sfe-block{background:${C.paperSoft};}
.sfe-nest .sfe-nest > .sfe-block{background:#FFFFFF;}
.sfe-addrule{display:inline-flex;align-items:center;gap:4px;margin-top:4px;height:32px;padding:0 10px;border:0;border-radius:9px;background:none;color:${C.purple};font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;}
.sfe-addrule:hover{background:${C.tintApp};}
.sfe-backdrop{position:fixed;inset:0;z-index:30;}
.sfe-pop{position:absolute;top:calc(100% + 6px);inset-inline-start:0;z-index:31;width:300px;max-width:calc(100vw - 48px);background:#FFFFFF;border:1.5px solid ${C.lineApp};border-radius:${radius.md}px;box-shadow:0 18px 44px rgba(22,21,15,.12);padding:10px;}
.sfe-pop-title{font-size:13px;font-weight:600;color:${C.ink};margin:2px 4px 8px;}
.sfe-pop-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:0;background:none;border-radius:9px;cursor:pointer;font-family:inherit;font-size:13.5px;color:${C.ink};text-align:start;}
.sfe-pop-item:hover{background:${C.tintApp};}
.sfe-seg{display:inline-flex;background:${C.paperWarm};border-radius:10px;padding:2px;gap:2px;flex:none;}
.sfe-seg button{height:28px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:${C.body};font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
.sfe-seg button.on{background:#FFFFFF;color:${C.ink};box-shadow:0 1px 2px rgba(22,21,15,.08);}
.sfe-seg button:disabled{opacity:.4;cursor:not-allowed;}
.sfe-confirm{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;width:100%;margin-top:6px;padding:7px 10px;border-radius:10px;background:${C.warnBg};border:1.5px solid ${C.warnBorder};color:${C.warn};font-size:13px;}
.sfe-choice{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;}
.sfe-choice-verb{font-size:13px;color:${C.body};}
.sfe-btnchip-static{padding:0 10px;font-size:13px;font-weight:600;color:${C.purpleDark};}
.sfe-subhead{font-size:12px;font-weight:600;color:${C.muted};padding:12px 4px 4px;letter-spacing:.02em;}
.sfe-addline{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;}
.sfe-fixed{display:inline-flex;align-items:center;gap:5px;font-size:13px;color:${C.body};}
.sfe-tabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1.5px solid ${C.lineApp};margin-bottom:14px;}
.sfe-tab{display:inline-flex;align-items:center;gap:6px;height:42px;padding:0 14px;border:0;background:none;font-family:inherit;font-size:14.5px;font-weight:600;color:${C.body};cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1.5px;}
.sfe-tab.on{color:${C.ink};border-bottom-color:${C.purple};}
.sfe-tab .cnt{font-size:12px;color:${C.muted};font-weight:500;}
.sfe-tab .dot{width:7px;height:7px;border-radius:50%;background:${C.err};}
@media (max-width: 760px){
  .sfe-row{grid-template-columns:1fr;row-gap:6px;padding:10px 10px;border:1.5px solid ${C.line2};border-radius:12px;margin-bottom:8px;background:#FFFFFF;}
  .sfe-thead{display:none;}
  .sfe-cell-label{display:block;font-size:11.5px;font-weight:600;color:${C.muted};margin-bottom:2px;}
  .sfe-cellsel{border-color:${C.field};background:#FFFFFF;height:40px;}
  .sfe-order{justify-content:space-between;}
  .sfe-move{flex-direction:row;opacity:1;}
  .sfe-move button{height:28px;width:32px;}
  .sfe-rowctl{opacity:1;justify-content:flex-start;}
  .sfe-row-issues{grid-column:1;}
  .sfe-nest{padding-inline-start:12px;}
  .sfe-nest::before{inset-inline-start:3px;}
  .sfe-block{padding:12px 12px 8px;}
  .sfe-action-text{max-width:220px;}
}
`;
