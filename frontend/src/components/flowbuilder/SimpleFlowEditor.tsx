/**
 * Simple (rule-table) editor for the guest conversation - the default mode of
 * /admin/flow-builder. A pure alternative view of the SAME graph JSON the
 * canvas edits:
 *   category tab  = entry stage (invitation / reminder / final_reminder / default)
 *   message block = node (text, how the guest answers)
 *   rule row      = outgoing edge: condition (when) → actions → target (to)
 * Targets reached for the first time nest under their row; nodes already shown
 * become back-links. Unreachable nodes are listed at the bottom.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Btn, Ms } from '../v6/ui';
import type { FlowEdge, FlowGraph, FlowMeta, FlowNode, Stage } from './types';
import { selectBase } from './controls';
import { NODE_TYPE_LABEL, STAGES } from './labels';
import { uid, type IssueIndex } from './graph';
import {
  MAX_NODES, addRuleTo, buildTree, cloneEntrySubtree, reachableFrom, unconnectedNodes, visibleEdges,
  type CategoryTree, type TreeBlock,
} from './simpleTree';
import FieldsPanel from './FieldsPanel';
import { fieldQuestion, graphFields } from './fields';
import { MessageBlock, SIMPLE_CSS, SimpleCtx, blockDomId, nestKey, rowDomId, type SimpleCtxValue } from './SimpleMessageBlock';

export interface FocusRequest { kind: 'node' | 'edge'; id: string; nonce: number }

interface Props {
  graph: FlowGraph;
  meta: FlowMeta | null;
  errors: IssueIndex;
  warns: IssueIndex;
  simNodeId: string | null;
  focus: FocusRequest | null;
  setGraph: (fn: (g: FlowGraph) => FlowGraph) => void;
  onDeleteNodes: (ids: string[]) => void;
  onDeleteEdges: (ids: string[]) => void;
}

const TAB_LABEL: Record<Stage, string> = {
  invitation: 'הזמנה',
  reminder: 'תזכורת',
  final_reminder: 'תזכורת אחרונה',
  default: 'כללי / כל השאר',
};

const TAB_HINT: Record<Stage, string> = {
  invitation: 'מה קורה כשהאורח עונה להזמנה.',
  reminder: 'מה קורה כשהאורח עונה לתזכורת.',
  final_reminder: 'מה קורה כשהאורח עונה לתזכורת האחרונה לפני האירוע.',
  default: 'כל הודעה מאורח שלא שייכת לשלב אחר. קטגוריה בלי הגדרה משלה משתמשת בלוגיקה הזאת.',
};

const LS_STAGE = 'flowbuilder.simple.stage';
const LS_COLLAPSED = 'flowbuilder.simple.collapsed';

const lsGet = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } };

const effectiveRoot = (g: FlowGraph, s: Stage) => g.entry[s] || (s !== 'default' ? g.entry.default : undefined);

/** For every node in a tree: the collapse keys that must be open to see it. */
function ancestorKeys(stage: Stage, block: TreeBlock | null, base: string[], out: Map<string, string[]>) {
  if (!block) return;
  if (!out.has(block.nodeId)) out.set(block.nodeId, base);
  block.rows.forEach((r) => {
    if (r.target.kind === 'nested') ancestorKeys(stage, r.target.block, [...base, nestKey(stage, r.edge.id)], out);
  });
}

function newSimpleNode(type: 'message' | 'end' | 'template', near?: FlowNode): FlowNode {
  const pos = near?.position ? { x: near.position.x - 340, y: near.position.y + 40 + Math.round(Math.random() * 80) } : { x: 0, y: 0 };
  if (type === 'end') return { id: uid('n'), type, title: 'סיום', text: 'תודה! נתראה באירוע 🎉', input: 'none', buttons: [], position: pos };
  if (type === 'template') return { id: uid('n'), type, title: 'הודעת הפתיחה (תבנית)', text: '', input: 'none', buttons: [], position: pos };
  return { id: uid('n'), type, title: 'הודעה חדשה', text: 'כתבו כאן את ההודעה לאורח', input: 'none', buttons: [], position: pos };
}

export default function SimpleFlowEditor({ graph, meta, errors, warns, simNodeId, focus, setGraph, onDeleteNodes, onDeleteEdges }: Props) {
  const [stage, setStageRaw] = useState<Stage>(() => {
    const v = lsGet(LS_STAGE);
    return (STAGES as string[]).includes(v || '') ? (v as Stage) : 'invitation';
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(lsGet(LS_COLLAPSED) || '{}') || {}; } catch { return {}; }
  });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [splitAsk, setSplitAsk] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingScroll = useRef<{ dom: string; stage: Stage; fallback?: string } | null>(null);
  const hiTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setStage = (s: Stage) => { setStageRaw(s); lsSet(LS_STAGE, s); setSplitAsk(false); setNotice(null); };
  useEffect(() => { lsSet(LS_COLLAPSED, JSON.stringify(collapsed)); }, [collapsed]);

  // ------------------------------------------------------------ derived trees

  const trees = useMemo(() => {
    const out = {} as Record<Stage, { tree: CategoryTree; extra: { block: TreeBlock; key: string }[]; anc: Map<string, string[]> }>;
    const lost = unconnectedNodes(graph);
    STAGES.forEach((s) => {
      const seen = new Set<string>();
      const tree = buildTree(graph, effectiveRoot(graph, s), { seen });
      const anc = new Map<string, string[]>();
      ancestorKeys(s, tree.root, [], anc);
      const extra: { block: TreeBlock; key: string }[] = [];
      lost.forEach((n) => {
        const t = buildTree(graph, n.id, { seen });
        if (t.root) {
          const key = `${s}:u:${n.id}`;
          extra.push({ block: t.root, key });
          ancestorKeys(s, t.root, [key], anc);
        }
      });
      out[s] = { tree, extra, anc };
    });
    return out;
  }, [graph]);

  const cur = trees[stage];
  const root = effectiveRoot(graph, stage);
  const ownEntry = !!graph.entry[stage];
  const sharedWith = STAGES.filter((s) => s !== stage && root && effectiveRoot(graph, s) === root);

  // ------------------------------------------------------------ navigation

  const isCollapsed = useCallback((key: string, dflt = false) => (key in collapsed ? collapsed[key] : dflt), [collapsed]);
  const toggle = useCallback((key: string, dflt = false) =>
    setCollapsed((c) => ({ ...c, [key]: !(key in c ? c[key] : dflt) })), []);

  const flash = (h: string) => {
    setHighlight(h);
    if (hiTimer.current) clearTimeout(hiTimer.current);
    hiTimer.current = setTimeout(() => setHighlight(null), 1800);
  };
  useEffect(() => () => { if (hiTimer.current) clearTimeout(hiTimer.current); }, []);

  const reveal = useCallback((nodeId: string, dom: (s: Stage) => string, hi: string, preferStage?: Stage) => {
    const order = [preferStage || stage, ...STAGES.filter((s) => s !== (preferStage || stage))];
    const s = order.find((x) => trees[x].anc.has(nodeId)) || (preferStage || stage);
    const keys = trees[s].anc.get(nodeId) || [];
    if (keys.length) setCollapsed((c) => { const n = { ...c }; keys.forEach((k) => { n[k] = false; }); return n; });
    if (s !== stage) setStage(s);
    pendingScroll.current = { dom: dom(s), stage: s, fallback: blockDomId(s, nodeId) };
    flash(hi);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, trees]);

  // Scroll after the expanded / switched tree has rendered.
  useEffect(() => {
    const p = pendingScroll.current;
    if (!p) return undefined;
    const t = setTimeout(() => {
      const el = document.getElementById(p.dom) || (p.fallback ? document.getElementById(p.fallback) : null);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      pendingScroll.current = null;
    }, 40);
    return () => clearTimeout(t);
  });

  const jumpTo = useCallback((nodeId: string) => reveal(nodeId, (s) => blockDomId(s, nodeId), `node:${nodeId}`), [reveal]);
  const jumpToEdge = useCallback((edgeId: string) => {
    const e = graph.edges.find((x) => x.id === edgeId);
    if (e) reveal(e.from, (s) => rowDomId(s, edgeId), `edge:${edgeId}`);
  }, [graph.edges, reveal]);

  useEffect(() => {
    if (!focus) return;
    if (focus.kind === 'node') jumpTo(focus.id); else jumpToEdge(focus.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => {
    if (simNodeId) document.getElementById(blockDomId(stage, simNodeId))?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [simNodeId, stage]);

  // ------------------------------------------------------------ edits

  const updateNode = useCallback((id: string, patch: Partial<FlowNode>) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })), [setGraph]);
  const updateEdge = useCallback((id: string, patch: Partial<FlowEdge>) =>
    setGraph((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) })), [setGraph]);
  const setEntry = useCallback((s: Stage, id: string | null) => setGraph((g) => {
    const entry = { ...g.entry };
    if (id) entry[s] = id; else delete entry[s];
    return { ...g, entry };
  }), [setGraph]);

  const ctx: SimpleCtxValue = {
    graph, meta, errors, warns, stage, highlight, simNodeId,
    updateNode, updateEdge, setEntry,
    deleteNode: (id) => onDeleteNodes([id]),
    deleteEdge: (id) => onDeleteEdges([id]),
    duplicateNode: (id) => {
      const src = graph.nodes.find((n) => n.id === id);
      if (!src) return;
      const copy: FlowNode = {
        ...JSON.parse(JSON.stringify(src)), id: uid('n'), title: `${src.title || 'הודעה'} (עותק)`,
        buttons: src.buttons.map((b) => ({ ...b, id: uid('b') })),
        position: { x: (src.position?.x || 0) - 60, y: (src.position?.y || 0) + 60 },
      };
      setGraph((g) => ({ ...g, nodes: [...g.nodes, copy] }));
      setNotice('נוצר עותק - הוא מופיע למטה ב"הודעות לא מחוברות" עד שתחברו אותו.');
    },
    mutate: (fn) => setGraph(fn),
    flash,
    newTarget: (fromId, type, link, edgeId) => {
      if (graph.nodes.length >= MAX_NODES) { setNotice(`אפשר עד ${MAX_NODES} הודעות בשיחה אחת.`); return; }
      const n = newSimpleNode(type, graph.nodes.find((x) => x.id === fromId));
      setGraph((g) => link(n.id)({ ...g, nodes: [...g.nodes, n] }));
      if (edgeId) setCollapsed((c) => ({ ...c, [nestKey(stage, edgeId)]: false }));
      pendingScroll.current = { dom: blockDomId(stage, n.id), stage };
      flash(`node:${n.id}`);
    },
    newFieldQuestion: (fromId, fieldKey, link, edgeId, then) => {
      const f = graphFields(graph).find((x) => x.key === fieldKey);
      if (!f) return;
      if (graph.nodes.length >= MAX_NODES) { setNotice(`אפשר עד ${MAX_NODES} הודעות בשיחה אחת.`); return; }
      const id = uid('n');
      const ids = { edge: () => uid('e'), button: () => uid('b') };
      setGraph((g) => link(id)(fieldQuestion(g, f, id, ids, then, g.nodes.find((x) => x.id === fromId))));
      if (edgeId) setCollapsed((c) => ({ ...c, [nestKey(stage, edgeId)]: false }));
      pendingScroll.current = { dom: blockDomId(stage, id), stage };
      flash(`node:${id}`);
      setNotice(then ? `נוצרה שאלה על "${f.label}". כל תשובה נשמרת בשדה, ואחריה השיחה ממשיכה כמו קודם.` : `נוצרה שאלה על "${f.label}". כל תשובה נשמרת בשדה.`);
    },
    isCollapsed, toggle, jumpTo, jumpToEdge,
  };

  // ------------------------------------------------------------ split / start

  const splitCount = root ? reachableFrom(graph, [root]).size : 0;
  const doSplit = () => {
    const res = cloneEntrySubtree(graph, stage, root);
    setSplitAsk(false);
    if (!res) { setNotice(`אי אפשר לפצל: השיחה תעבור את המגבלה של ${MAX_NODES} הודעות.`); return; }
    setGraph(() => res.graph);
    setNotice(`נוצרה לוגיקה נפרדת ל${TAB_LABEL[stage]} (${Object.keys(res.idMap).length} הודעות). שינויים כאן כבר לא משפיעים על שאר הקטגוריות.`);
  };

  const createFirst = () => {
    const n = newSimpleNode(stage === 'default' ? 'message' : 'template');
    setGraph((g) => ({ ...g, nodes: [...g.nodes, n], entry: { ...g.entry, [stage]: n.id, ...(g.entry.default ? {} : { default: n.id }) } }));
    flash(`node:${n.id}`);
  };

  const tabHasIssue = (s: Stage) => {
    const ids = new Set(trees[s].tree.order);
    return Object.keys(errors.nodes).some((id) => ids.has(id))
      || Object.keys(errors.edges).some((eid) => { const e = graph.edges.find((x) => x.id === eid); return !!e && ids.has(e.from); });
  };

  // ------------------------------------------------------------ render

  const lost = cur.extra;
  return (
    <SimpleCtx.Provider value={ctx}>
      <style>{SIMPLE_CSS}</style>
      <div className="sfe-root" dir="rtl">
        <FieldsPanel graph={graph} setGraph={setGraph} jumpToEdge={jumpToEdge} />
        <div className="sfe-tabs" role="tablist" aria-label="קטגוריות">
          {STAGES.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={stage === s} className={`sfe-tab${stage === s ? ' on' : ''}`} onClick={() => setStage(s)}>
              {TAB_LABEL[s]}
              {tabHasIssue(s) && <span className="dot" aria-label="יש בעיות" />}
              <span className="cnt num">{trees[s].tree.order.length || ''}</span>
            </button>
          ))}
        </div>

        {/* category header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px 16px', marginBottom: 12 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div style={{ fontSize: 14, color: C.body, lineHeight: 1.6 }}>{TAB_HINT[stage]}</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.muted, flex: '0 1 auto' }}>
            ההודעה הראשונה
            <select style={{ ...selectBase, width: 230, height: 36, padding: '0 10px', fontSize: 13.5 }} value={graph.entry[stage] || ''}
              onChange={(e) => setEntry(stage, e.target.value || null)} aria-label="ההודעה הראשונה בקטגוריה">
              <option value="">{stage === 'default' ? 'לא נבחרה' : 'כמו ב"כללי"'}</option>
              {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.title || NODE_TYPE_LABEL[n.type]}</option>)}
            </select>
          </label>
        </div>

        {root && (sharedWith.length > 0 || !ownEntry) && (
          <div style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: C.tint, border: `1.5px solid ${C.tintBorder}`,
            borderRadius: radius.md, padding: '9px 12px', marginBottom: 12, fontSize: 13.5, color: C.purpleDark,
          }}>
            <Ms size={18}>call_split</Ms>
            <span style={{ flex: '1 1 260px' }}>
              {!ownEntry
                ? 'לקטגוריה הזאת אין לוגיקה משלה - היא משתמשת בלוגיקה של "כללי". שינוי כאן ישנה גם שם.'
                : `משותף גם ל${sharedWith.map((s) => TAB_LABEL[s]).join(' ול')}. שינוי כאן ישנה גם שם.`}
            </span>
            {splitAsk ? (
              <>
                <span style={{ fontSize: 13, color: C.body }}>ייווצרו {splitCount} הודעות חדשות (העתק) רק ל{TAB_LABEL[stage]}.</span>
                <Btn kind="smallPrimary" style={{ minHeight: 32 }} onClick={doSplit}>כן, לפצל</Btn>
                <Btn kind="smallGhost" style={{ minHeight: 32 }} onClick={() => setSplitAsk(false)}>ביטול</Btn>
              </>
            ) : (
              <Btn kind="smallGhost" style={{ minHeight: 32 }} onClick={() => setSplitAsk(true)}>
                {ownEntry ? 'פיצול לקטגוריה נפרדת' : `יצירת לוגיקה נפרדת ל${TAB_LABEL[stage]}`}
              </Btn>
            )}
          </div>
        )}

        {notice && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.body, background: C.paperSoft, border: `1.5px solid ${C.lineApp}`, borderRadius: radius.md, padding: '8px 12px', marginBottom: 12 }}>
            <Ms size={17} style={{ color: C.purple }}>info</Ms>
            <span style={{ flex: 1 }}>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="סגירה" style={{ border: 0, background: 'none', cursor: 'pointer', color: C.muted }}><Ms size={17}>close</Ms></button>
          </div>
        )}

        {errors.general.length > 0 && (
          <div style={{ background: C.errBg, border: `1.5px solid ${C.errBorder}`, borderRadius: radius.md, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: C.err }}>
            {errors.general.map((m, i) => <div key={i}>{m}</div>)}
          </div>
        )}

        {cur.tree.root ? (
          <MessageBlock block={cur.tree.root} />
        ) : (
          <div style={{ textAlign: 'center', padding: '36px 16px', background: '#FFFFFF', border: `1.5px dashed ${C.field}`, borderRadius: radius.lg }}>
            <Ms size={30} style={{ color: C.purple }}>chat_add_on</Ms>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>אין עדיין הודעה ראשונה ל{TAB_LABEL[stage]}</div>
            <div style={{ fontSize: 13.5, color: C.body, margin: '6px 0 12px' }}>בחרו הודעה קיימת למעלה, או התחילו הודעה חדשה.</div>
            <Btn kind="smallPrimary" onClick={createFirst}><Ms size={18}>add</Ms>הודעה ראשונה</Btn>
          </div>
        )}

        {lost.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>הודעות לא מחוברות</h3>
              <span className="num" style={{ fontSize: 13, color: C.muted }}>{lost.length}</span>
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>אף קטגוריה לא מגיעה להודעות האלה, ולכן אורחים לא יקבלו אותן. אפשר לחבר אותן אחרי הודעה אחרת או למחוק.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lost.map(({ block, key }) => (
                <MessageBlock key={key} block={block} collapseKey={key} headerExtra={(
                  <>
                    <select className="sfe-cellsel" style={{ width: 190, borderColor: C.field, background: '#FFFFFF' }} value="" aria-label="חיבור ההודעה"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__start__') { setEntry(stage, block.nodeId); return; }
                        if (!graph.nodes.some((n) => n.id === v)) return;
                        const ids = { edge: uid('e'), button: uid('b') };
                        setGraph((g) => addRuleTo(g, v, block.nodeId, ids));
                        reveal(v, (s) => rowDomId(s, ids.edge), `edge:${ids.edge}`, stage);
                      }}>
                      <option value="">חיבור…</option>
                      <option value="__start__">כהודעה הראשונה ב{TAB_LABEL[stage]}</option>
                      <optgroup label="ככלל חדש אחרי ההודעה">
                        {cur.tree.order.map((id) => {
                          const n = graph.nodes.find((x) => x.id === id);
                          return n ? <option key={id} value={id}>{n.title || NODE_TYPE_LABEL[n.type]} ({visibleEdges(graph, n).length} כללים)</option> : null;
                        })}
                      </optgroup>
                    </select>
                    <button type="button" className="sfe-ghostlink" style={{ color: C.danger }} onClick={() => onDeleteNodes([block.nodeId])}>
                      <Ms size={16}>delete</Ms>מחיקה
                    </button>
                  </>
                )} />
              ))}
            </div>
          </section>
        )}
      </div>
    </SimpleCtx.Provider>
  );
}
