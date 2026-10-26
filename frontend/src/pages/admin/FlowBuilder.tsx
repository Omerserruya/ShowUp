/**
 * Admin: visual builder for the guest WhatsApp conversation (/admin/flow-builder).
 *
 * The conversation is a graph (shared contract: /api/admin/flow-graph/*):
 * nodes are bot messages, edges are "when the guest answers X → do Y → go to Z".
 * Edits happen on a local draft; Save creates a new version, Enable switches the
 * scope to the graph engine. The simulator runs the unsaved draft server-side.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { ReactFlowProvider, ReactFlowInstance } from 'reactflow';
import { color as C, radius } from '../../design/tokens';
import { Btn, Card, Chip, Kicker, Ms } from '../../components/v6/ui';
import FlowCanvas from '../../components/flowbuilder/FlowCanvas';
import NodePanel from '../../components/flowbuilder/NodePanel';
import EdgePanel from '../../components/flowbuilder/EdgePanel';
import Simulator from '../../components/flowbuilder/Simulator';
import { Toggle, inputBase, selectBase } from '../../components/flowbuilder/controls';
import { FlowApiError, errMsg, flowApi } from '../../components/flowbuilder/api';
import {
  autoLayout, cleanGraph, emptyGraph, handleForWhen, indexIssues, normalizeGraph, uid, whenForHandle,
} from '../../components/flowbuilder/graph';
import { EVENT_TYPES, NODE_TYPE_ICON, NODE_TYPE_LABEL } from '../../components/flowbuilder/labels';
import type {
  FlowEdge, FlowGraph, FlowMeta, FlowNode, GraphIssue, NodeType, Scope, ScopeRow, Selection, Stage, VersionRow,
} from '../../components/flowbuilder/types';

interface ScopeSel { scope: Scope; key: string }
interface LoadedInfo { version: number | null; enabled: boolean; is_default: boolean; inherited: string | null }
interface Toast { text: string; tone?: 'ok' | 'err'; undo?: FlowGraph }

const sameScope = (a: ScopeSel, b: ScopeSel) => a.scope === b.scope && a.key === b.key;
const SCOPE_TABS: { id: Scope; label: string }[] = [
  { id: 'global', label: 'ברירת מחדל' },
  { id: 'event_type', label: 'לפי סוג אירוע' },
  { id: 'event', label: 'אירוע ספציפי' },
];

const asIssues = (list: unknown): GraphIssue[] =>
  Array.isArray(list) ? list.map((x: any) => (typeof x === 'string' ? { message: x } : x)) : [];

function newNode(type: NodeType, pos: { x: number; y: number }): FlowNode {
  const base: FlowNode = { id: uid('n'), type, title: `${NODE_TYPE_LABEL[type]} חדשה`, text: '', input: 'none', buttons: [], position: pos };
  if (type === 'question' || type === 'template') {
    return { ...base, input: 'buttons', buttons: [{ id: uid('b'), label: 'כן' }, { id: uid('b'), label: 'לא' }] };
  }
  if (type === 'end') return { ...base, title: 'סיום' };
  return base;
}

const fmtDate = (s: string | null) => {
  if (!s) return '';
  try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; }
};

function Notice({ icon, title, children, action }: { icon: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
      <Ms size={36} style={{ color: C.purple }}>{icon}</Ms>
      <div style={{ fontSize: 19, fontWeight: 600, marginTop: 10 }}>{title}</div>
      {children && <div style={{ fontSize: 14, color: C.body, marginTop: 8, lineHeight: 1.6, maxWidth: 520, marginInline: 'auto' }}>{children}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </Card>
  );
}

function FlowBuilderInner() {
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [meta, setMeta] = useState<FlowMeta | null>(null);
  const [sel, setSel] = useState<ScopeSel>({ scope: 'global', key: 'default' });
  const [tab, setTab] = useState<Scope>('global');
  const [eventIdInput, setEventIdInput] = useState('');
  const [pendingScope, setPendingScope] = useState<ScopeSel | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [info, setInfo] = useState<LoadedInfo>({ version: null, enabled: false, is_default: true, inherited: null });
  const [graph, setGraph] = useState<FlowGraph>(emptyGraph());
  const [savedJson, setSavedJson] = useState('');
  const [fitKey, setFitKey] = useState('init');

  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<'inspect' | 'sim'>('inspect');
  const [simNodeId, setSimNodeId] = useState<string | null>(null);
  const [issues, setIssues] = useState<GraphIssue[]>([]);
  const [warnings, setWarnings] = useState<GraphIssue[]>([]);
  const [showIssues, setShowIssues] = useState(false);

  const [saveOpen, setSaveOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const rfRef = useRef<ReactFlowInstance | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const canvasBox = useRef<HTMLDivElement>(null);

  const dirty = useMemo(() => status === 'ready' && JSON.stringify(cleanGraph(graph)) !== savedJson, [graph, savedJson, status]);
  const issueIndex = useMemo(() => indexIssues(issues, graph), [issues, graph]);
  const issueCount = issues.length;

  // ------------------------------------------------------------ loading

  const loadScopes = useCallback(async () => {
    try {
      setScopes(await flowApi.listScopes());
      return true;
    } catch (e) {
      if (e instanceof FlowApiError && e.unavailable) setStatus('unavailable');
      return false;
    }
  }, []);

  const loadScope = useCallback(async (s: ScopeSel) => {
    setStatus('loading');
    setSelection(null);
    setIssues([]);
    setWarnings([]);
    setConflict(false);
    setConfirmEnable(null);
    setVersions(null);
    try {
      const data = await flowApi.get(s.scope, s.key);
      const g = autoLayout(normalizeGraph(data.graph), true);
      const inh = data.inherited_from;
      setGraph(g);
      setSavedJson(JSON.stringify(cleanGraph(g)));
      setInfo({
        version: data.version ?? null, enabled: !!data.enabled, is_default: !!data.is_default,
        inherited: !inh ? null : typeof inh === 'string' ? inh : (inh.label || `${inh.scope}/${inh.key}`),
      });
      setStatus('ready');
      setLoadError(null);
      setFitKey(`${s.scope}/${s.key}/${Date.now()}`);
    } catch (e) {
      if (e instanceof FlowApiError && e.unavailable && e.status !== 404) setStatus('unavailable');
      else if (e instanceof FlowApiError && e.status === 404 && s.scope === 'event') { setStatus('error'); setLoadError('לא נמצא אירוע עם המזהה הזה.'); }
      else if (e instanceof FlowApiError && e.status === 404) setStatus('unavailable');
      else { setStatus('error'); setLoadError(errMsg(e, 'טעינת השיחה נכשלה')); }
    }
  }, []);

  useEffect(() => {
    loadScopes();
    flowApi.meta().then(setMeta).catch(() => setMeta(null));
  }, [loadScopes]);
  useEffect(() => { loadScope(sel); }, [sel, loadScope]);

  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 3800);
    return () => clearTimeout(t);
  }, [toast]);

  // Live validation of the draft (silent if the endpoint isn't there yet).
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const t = setTimeout(async () => {
      try {
        const r = await flowApi.validate(cleanGraph(graph));
        setIssues(asIssues(r.errors));
        setWarnings(asIssues(r.warnings));
      } catch { /* keep last result */ }
    }, 900);
    return () => clearTimeout(t);
  }, [graph, status]);

  // ------------------------------------------------------------ scope switching

  const requestScope = (s: ScopeSel) => {
    if (sameScope(s, sel)) return;
    if (dirty) { setPendingScope(s); return; }
    setSel(s);
  };

  const pickTab = (t: Scope) => {
    setTab(t);
    if (t === 'global') requestScope({ scope: 'global', key: 'default' });
    if (t === 'event_type') requestScope({ scope: 'event_type', key: sel.scope === 'event_type' ? sel.key : 'wedding' });
  };

  const rowFor = (scope: Scope, key: string) => scopes.find((r) => r.scope === scope && r.key === key);

  // ------------------------------------------------------------ graph edits

  const mutate = useCallback((fn: (g: FlowGraph) => FlowGraph) => setGraph((g) => fn(g)), []);

  const updateNode = (id: string, patch: Partial<FlowNode>) =>
    mutate((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));

  const updateEdge = (id: string, patch: Partial<FlowEdge>) =>
    mutate((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const deleteNodes = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const g = graphRef.current;
    const entry = { ...g.entry };
    (Object.keys(entry) as Stage[]).forEach((s) => { if (entry[s] && ids.includes(entry[s] as string)) delete entry[s]; });
    setGraph({
      ...g, entry,
      nodes: g.nodes.filter((n) => !ids.includes(n.id)),
      edges: g.edges.filter((e) => !ids.includes(e.from) && !(e.to && ids.includes(e.to))),
    });
    setToast({ text: ids.length > 1 ? `נמחקו ${ids.length} צמתים` : 'הצומת נמחק', undo: g });
    setSelection(null);
  }, []);

  const deleteEdges = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const g = graphRef.current;
    setGraph({ ...g, edges: g.edges.filter((e) => !ids.includes(e.id)) });
    setToast({ text: 'המעבר נמחק', undo: g });
    setSelection(null);
  }, []);

  const duplicateNode = (id: string) => {
    const src = graph.nodes.find((n) => n.id === id);
    if (!src) return;
    const copy: FlowNode = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid('n'),
      title: `${src.title || 'צומת'} (עותק)`,
      buttons: src.buttons.map((b) => ({ ...b, id: uid('b') })),
      position: { x: (src.position?.x || 0) - 60, y: (src.position?.y || 0) + 60 },
    };
    mutate((g) => ({ ...g, nodes: [...g.nodes, copy] }));
    setSelection({ kind: 'node', id: copy.id });
  };

  const viewportCenter = () => {
    const rf = rfRef.current;
    const box = canvasBox.current?.getBoundingClientRect();
    if (!rf || !box) return { x: 0, y: 0 };
    const p = rf.project({ x: box.width / 2, y: box.height / 2 });
    return { x: p.x - 140, y: p.y - 60 };
  };

  const addNode = (type: NodeType) => {
    const n = newNode(type, viewportCenter());
    mutate((g) => {
      const entry = { ...g.entry };
      if (!g.nodes.length) entry.invitation = n.id;
      return { ...g, entry, nodes: [...g.nodes, n] };
    });
    setSelection({ kind: 'node', id: n.id });
    setPanel('inspect');
    setAddOpen(false);
  };

  const setEntry = (stage: Stage, nodeId: string | null) => mutate((g) => {
    const entry = { ...g.entry };
    if (nodeId) entry[stage] = nodeId; else delete entry[stage];
    return { ...g, entry };
  });

  const onMoveNode = useCallback((id: string, pos: { x: number; y: number }) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)) })), []);

  const onConnectHandles = useCallback((from: string, handle: string | null, to: string) => {
    const g = graphRef.current;
    const when = whenForHandle(handle);
    const h = handleForWhen(when);
    // One exit per button / outcome: reconnecting moves the existing arrow.
    const existing = g.edges.find((e) => e.from === from && handleForWhen(e.when) === h && e.when.kind === when.kind
      && (when.kind !== 'rsvp' || (e.when as any).value === (when as any).value));
    if (existing) {
      setGraph({ ...g, edges: g.edges.map((e) => (e.id === existing.id ? { ...e, to } : e)) });
      setSelection({ kind: 'edge', id: existing.id });
    } else {
      const edge: FlowEdge = { id: uid('e'), from, to, when, actions: [], priority: 0 };
      setGraph({ ...g, edges: [...g.edges, edge] });
      setSelection({ kind: 'edge', id: edge.id });
    }
    setPanel('inspect');
  }, []);

  const onConnectToEmpty = useCallback((from: string, handle: string | null, pos: { x: number; y: number }) => {
    const n = newNode('message', pos);
    const edge: FlowEdge = { id: uid('e'), from, to: n.id, when: whenForHandle(handle), actions: [], priority: 0 };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, n], edges: [...g.edges, edge] }));
    setSelection({ kind: 'node', id: n.id });
    setPanel('inspect');
  }, []);

  const onSelect = useCallback((s: Selection) => { setSelection(s); if (s) setPanel('inspect'); }, []);

  const relayout = () => {
    mutate((g) => autoLayout(g, false));
    setFitKey(`relayout/${Date.now()}`);
  };

  // ------------------------------------------------------------ server actions

  const validateNow = async () => {
    try {
      const r = await flowApi.validate(cleanGraph(graph));
      const errs = asIssues(r.errors);
      setIssues(errs);
      setWarnings(asIssues(r.warnings));
      setShowIssues(true);
      setToast(errs.length ? { text: `נמצאו ${errs.length} בעיות שצריך לתקן`, tone: 'err' } : { text: 'השיחה תקינה', tone: 'ok' });
    } catch (e) {
      setToast({ text: e instanceof FlowApiError && e.unavailable ? 'בדיקת התקינות עדיין לא זמינה בשרת' : errMsg(e), tone: 'err' });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await flowApi.save(sel.scope, sel.key, cleanGraph(graph), note.trim() || null, info.version);
      setSavedJson(JSON.stringify(cleanGraph(graph)));
      setInfo((i) => ({ ...i, version: r?.version ?? (i.version || 0) + 1, is_default: false, inherited: null }));
      setSaveOpen(false);
      setNote('');
      setIssues([]);
      setToast({ text: `נשמר - גרסה ${r?.version ?? ''}`.trim(), tone: 'ok' });
      loadScopes();
      if (versionsOpen) openVersions();
    } catch (e) {
      if (e instanceof FlowApiError && e.status === 422) {
        setIssues(e.issues.length ? e.issues : [{ message: e.message }]);
        setShowIssues(true);
        setToast({ text: 'יש בעיות שצריך לתקן לפני שמירה. הן מסומנות באדום.', tone: 'err' });
      } else if (e instanceof FlowApiError && e.status === 409) {
        setConflict(true);
        setSaveOpen(false);
      } else {
        setToast({ text: errMsg(e, 'השמירה נכשלה'), tone: 'err' });
      }
    } finally {
      setSaving(false);
    }
  };

  const applyEnable = async (enabled: boolean) => {
    setEnabling(true);
    try {
      await flowApi.setEnabled(sel.scope, sel.key, enabled);
      setInfo((i) => ({ ...i, enabled }));
      setToast({ text: enabled ? 'השיחה החדשה פעילה' : 'השיחה החדשה כובתה', tone: 'ok' });
      loadScopes();
    } catch (e) {
      setToast({ text: errMsg(e, 'העדכון נכשל'), tone: 'err' });
    } finally {
      setEnabling(false);
      setConfirmEnable(null);
    }
  };

  const openVersions = useCallback(async () => {
    setVersionsOpen(true);
    setVersionsError(null);
    try {
      setVersions(await flowApi.versions(sel.scope, sel.key));
    } catch (e) {
      setVersions([]);
      setVersionsError(errMsg(e, 'טעינת הגרסאות נכשלה'));
    }
  }, [sel]);

  const revert = async (version: number) => {
    try {
      await flowApi.revert(sel.scope, sel.key, version);
      setConfirmRevert(null);
      setVersionsOpen(false);
      setToast({ text: `שוחזרה גרסה ${version}`, tone: 'ok' });
      await loadScope(sel);
      loadScopes();
    } catch (e) {
      setToast({ text: errMsg(e, 'השחזור נכשל'), tone: 'err' });
    }
  };

  // ------------------------------------------------------------ render

  const selNode = selection?.kind === 'node' ? graph.nodes.find((n) => n.id === selection.id) : undefined;
  const selEdge = selection?.kind === 'edge' ? graph.edges.find((e) => e.id === selection.id) : undefined;

  const header = (
    <div style={{ marginBottom: 16 }}>
      <Kicker>ניהול מערכת</Kicker>
      <h1 style={{ fontSize: 'clamp(24px,3vw,30px)', fontWeight: 600, letterSpacing: '-0.03em', margin: '6px 0 4px' }}>בונה שיחה</h1>
      <div style={{ fontSize: 14.5, color: C.body, lineHeight: 1.6, maxWidth: 760 }}>
        כאן בונים את שיחת הוואטסאפ עם האורחים כמו תרשים: כל כרטיס הוא הודעה של הבוט, וכל חץ אומר "כשהאורח עונה כך - עושים את זה וממשיכים לשם".
      </div>
    </div>
  );

  if (isNarrow) {
    return (
      <div dir="rtl">
        {header}
        <Notice icon="desktop_windows" title="העריכה עובדת הכי טוב במחשב">
          בונה השיחה הוא קנבס רחב עם גרירה וחיבורים. כדאי לפתוח את המסך הזה במחשב או בטאבלט במצב רוחב.
        </Notice>
      </div>
    );
  }

  const scopeBar = (
    <Card style={{ padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div role="tablist" style={{ display: 'inline-flex', background: C.paperWarm, borderRadius: 12, padding: 3, gap: 2 }}>
          {SCOPE_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => pickTab(t.id)} style={{
              height: 34, padding: '0 14px', borderRadius: 10, border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
              background: tab === t.id ? '#FFFFFF' : 'transparent', color: tab === t.id ? C.ink : C.body,
              boxShadow: tab === t.id ? '0 1px 2px rgba(22,21,15,.08)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>
        {tab === 'event_type' && (
          <select style={{ ...selectBase, width: 200 }} value={sel.scope === 'event_type' ? sel.key : ''}
            onChange={(e) => requestScope({ scope: 'event_type', key: e.target.value })} aria-label="סוג אירוע">
            {sel.scope !== 'event_type' && <option value="">בחרו סוג אירוע</option>}
            {EVENT_TYPES.map((t) => {
              const r = rowFor('event_type', t.value);
              return <option key={t.value} value={t.value}>{t.label}{r && !r.is_default ? ' · מותאם' : ''}{r?.enabled ? ' · פעיל' : ''}</option>;
            })}
          </select>
        )}
        {tab === 'event' && (
          <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (eventIdInput.trim()) requestScope({ scope: 'event', key: eventIdInput.trim() }); }}>
            <input style={{ ...inputBase, width: 200 }} placeholder="מזהה אירוע" value={eventIdInput} onChange={(e) => setEventIdInput(e.target.value)} />
            <Btn kind="smallGhost" type="submit" disabled={!eventIdInput.trim()}>טעינה</Btn>
          </form>
        )}

        <div style={{ flex: 1 }} />

        {status === 'ready' && (
          <>
            <Chip tone={info.enabled ? 'ok' : 'quiet'}>{info.enabled ? 'פעיל' : 'כבוי'}</Chip>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.body }}>
              <Toggle checked={info.enabled} onChange={(v) => setConfirmEnable(v)} label="הפעלת השיחה" disabled={enabling} />
              הפעלה
            </label>
            <span style={{ fontSize: 12.5, color: C.muted }}>
              {info.version ? `גרסה ${info.version}` : 'לא נשמר עדיין'}{dirty ? ' · יש שינויים שלא נשמרו' : ''}
            </span>
          </>
        )}
      </div>

      {status === 'ready' && info.is_default && (
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>
          {info.inherited ? `מוצגת השיחה שעוברת בירושה מ-${info.inherited}. שמירה תיצור גרסה ייעודית להיקף הזה.` : 'מוצגת שיחת ברירת המחדל של המערכת. שמירה תיצור גרסה ראשונה.'}
        </div>
      )}

      {pendingScope && (
        <InlineConfirm tone="warn" icon="warning"
          text="יש שינויים שלא נשמרו. מעבר להיקף אחר ימחק אותם."
          confirmLabel="לעבור בלי לשמור" cancelLabel="להישאר"
          onConfirm={() => { const s = pendingScope; setPendingScope(null); setSel(s); setTab(s.scope); }}
          onCancel={() => { setPendingScope(null); setTab(sel.scope); }} />
      )}
      {confirmEnable !== null && (
        <InlineConfirm tone={confirmEnable ? 'lav' : 'warn'} icon={confirmEnable ? 'bolt' : 'pause_circle'}
          text={confirmEnable
            ? `להפעיל את השיחה מהבונה עבור ${scopeTitle(sel)}? אורחים יקבלו את הגרסה השמורה האחרונה${dirty ? ' (השינויים שעל המסך עוד לא נשמרו ולא ייכללו)' : ''}.`
            : `לכבות את השיחה מהבונה עבור ${scopeTitle(sel)}? אורחים יחזרו לשיחה הרגילה.`}
          confirmLabel={confirmEnable ? 'כן, להפעיל' : 'כן, לכבות'} cancelLabel="ביטול" busy={enabling}
          onConfirm={() => applyEnable(confirmEnable)} onCancel={() => setConfirmEnable(null)} />
      )}
      {conflict && (
        <InlineConfirm tone="err" icon="sync_problem"
          text="מישהו אחר שמר גרסה חדשה בזמן שעבדתם. טעינה מחדש תציג את הגרסה שלו (השינויים שעל המסך יימחקו)."
          confirmLabel="טעינה מחדש" cancelLabel="סגירה"
          onConfirm={() => loadScope(sel)} onCancel={() => setConflict(false)} />
      )}
    </Card>
  );

  if (status === 'unavailable') {
    return (
      <div dir="rtl">
        {header}
        <Notice icon="construction" title="בונה השיחה עוד לא מחובר לשרת"
          action={<Btn kind="smallGhost" onClick={() => { loadScopes(); loadScope(sel); }}><Ms size={18}>refresh</Ms>לנסות שוב</Btn>}>
          המסך מוכן, אבל השרת עדיין לא מחזיר את נתוני השיחה. אפשר לחזור לכאן אחרי העדכון הבא של השרת. בינתיים השיחה הקיימת ממשיכה לעבוד כרגיל.
        </Notice>
      </div>
    );
  }

  return (
    <div dir="rtl">
      {header}
      {scopeBar}

      {status === 'error' && (
        <Notice icon="error" title="לא הצלחנו לטעון את השיחה"
          action={<Btn kind="smallGhost" onClick={() => loadScope(sel)}><Ms size={18}>refresh</Ms>לנסות שוב</Btn>}>
          {loadError}
        </Notice>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          {/* toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <Btn kind="smallGhost" onClick={() => setAddOpen((v) => !v)} disabled={status !== 'ready'}><Ms size={18}>add</Ms>הוספת צומת</Btn>
              {addOpen && (
                <div style={{
                  position: 'absolute', top: 46, insetInlineStart: 0, zIndex: 20, background: '#FFFFFF', border: `1.5px solid ${C.lineApp}`,
                  borderRadius: radius.md, boxShadow: '0 18px 44px rgba(22,21,15,.1)', padding: 6, minWidth: 200,
                }}>
                  {(['message', 'question', 'template', 'end'] as NodeType[]).map((t) => (
                    <button key={t} type="button" onClick={() => addNode(t)} className="su-hover-ink" style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 10px', border: 0, background: 'none',
                      borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: C.ink, textAlign: 'start',
                    }}>
                      <Ms size={18} style={{ color: C.purple }}>{NODE_TYPE_ICON[t]}</Ms>{NODE_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Btn kind="smallGhost" onClick={relayout} disabled={status !== 'ready' || !graph.nodes.length}><Ms size={18}>account_tree</Ms>סידור אוטומטי</Btn>
            <Btn kind="smallGhost" onClick={validateNow} disabled={status !== 'ready'}><Ms size={18}>fact_check</Ms>בדיקת תקינות</Btn>
            <Btn kind="smallGhost" onClick={() => { setPanel('sim'); setSelection(null); }} disabled={status !== 'ready'}
              style={panel === 'sim' ? { borderColor: C.purple, color: C.purpleDark } : undefined}>
              <Ms size={18}>play_circle</Ms>ניסיון שיחה
            </Btn>
            {issueCount > 0 && (
              <button type="button" onClick={() => setShowIssues((v) => !v)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 11px', borderRadius: 999, cursor: 'pointer',
                border: `1.5px solid ${C.errBorder}`, background: C.errBg, color: C.err, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              }}>
                <Ms size={16}>error</Ms>{issueCount} בעיות
              </button>
            )}
            {!issueCount && warnings.length > 0 && (
              <button type="button" onClick={() => setShowIssues((v) => !v)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 11px', borderRadius: 999, cursor: 'pointer',
                border: `1.5px solid ${C.warnBorder}`, background: C.warnBg, color: C.warn, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              }}>
                <Ms size={16}>warning</Ms>{warnings.length} הערות
              </button>
            )}
            <div style={{ flex: 1 }} />
            <Btn kind="smallGhost" onClick={openVersions} disabled={status !== 'ready'}><Ms size={18}>history</Ms>גרסאות</Btn>
            <div style={{ position: 'relative' }}>
              <Btn kind="smallPrimary" onClick={() => setSaveOpen((v) => !v)} disabled={status !== 'ready' || (!dirty && !info.is_default)}>
                <Ms size={18}>save</Ms>שמירה
              </Btn>
              {saveOpen && (
                <div style={{
                  position: 'absolute', top: 46, insetInlineEnd: 0, zIndex: 20, width: 320, background: '#FFFFFF', border: `1.5px solid ${C.lineApp}`,
                  borderRadius: radius.lg, boxShadow: '0 18px 44px rgba(22,21,15,.12)', padding: 14,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>שמירה כגרסה חדשה</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>
                    {info.enabled ? 'השיחה פעילה - אורחים יקבלו את הגרסה החדשה מיד אחרי השמירה.' : 'השיחה כבויה, השמירה לא משפיעה על אורחים עד ההפעלה.'}
                  </div>
                  <input autoFocus style={inputBase} placeholder="מה השתנה? (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
                  {issueCount > 0 && <div style={{ fontSize: 12.5, color: C.err, marginTop: 8 }}>יש {issueCount} בעיות פתוחות - השרת עלול לסרב לשמירה.</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <Btn kind="smallPrimary" onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</Btn>
                    <Btn kind="smallGhost" onClick={() => setSaveOpen(false)}>ביטול</Btn>
                  </div>
                </div>
              )}
            </div>
          </div>

          {showIssues && (issueCount > 0 || warnings.length > 0) && (
            <Card style={{ padding: '10px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{issueCount ? 'בעיות שצריך לתקן' : 'הערות'}</span>
                <button type="button" onClick={() => setShowIssues(false)} style={{ background: 'none', border: 0, cursor: 'pointer', color: C.muted }} aria-label="סגירה"><Ms size={18}>close</Ms></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 140, overflowY: 'auto' }}>
                {[...issues.map((i) => ({ ...i, w: false })), ...warnings.map((i) => ({ ...i, w: true }))].map((it, i) => {
                  const one = indexIssues([it], graph);
                  const nodeId = Object.keys(one.nodes)[0];
                  const edgeId = Object.keys(one.edges)[0];
                  const target: Selection = nodeId ? { kind: 'node', id: nodeId } : edgeId ? { kind: 'edge', id: edgeId } : null;
                  return (
                    <button key={i} type="button" disabled={!target} onClick={() => target && onSelect(target)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 0, padding: '4px 0', textAlign: 'start',
                      cursor: target ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 13, color: it.w ? C.warn : C.err,
                    }}>
                      <Ms size={15}>{it.w ? 'warning' : 'error'}</Ms>
                      <span>{it.message}</span>
                      {target && <span style={{ color: C.purple, fontSize: 12, fontWeight: 600 }}>· הצגה</span>}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          <div style={{
            display: 'flex', gap: 12, height: 'calc(100dvh - 300px)', minHeight: 560,
          }}>
            <div ref={canvasBox} style={{ flex: 1, minWidth: 0, borderRadius: radius.xl, overflow: 'hidden', border: `1.5px solid ${C.lineApp}`, position: 'relative', background: C.paperSoft }}>
              {status === 'loading' && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 5, background: 'rgba(251,250,247,.7)', fontSize: 14, color: C.body }}>
                  טוען את השיחה…
                </div>
              )}
              {status === 'ready' && !graph.nodes.length && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 4, pointerEvents: 'none' }}>
                  <div style={{ textAlign: 'center', pointerEvents: 'all' }}>
                    <Ms size={34} style={{ color: C.purple }}>account_tree</Ms>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>השיחה ריקה</div>
                    <div style={{ fontSize: 13.5, color: C.body, margin: '6px 0 12px' }}>התחילו מהודעת הפתיחה - התבנית שנשלחת בהזמנה.</div>
                    <Btn kind="smallPrimary" onClick={() => addNode('template')}><Ms size={18}>add</Ms>הוספת הודעת פתיחה</Btn>
                  </div>
                </div>
              )}
              <FlowCanvas
                graph={graph}
                issues={issueIndex}
                selection={selection}
                simNodeId={panel === 'sim' ? simNodeId : null}
                fitKey={fitKey}
                onSelect={onSelect}
                onMoveNode={onMoveNode}
                onConnectHandles={onConnectHandles}
                onConnectToEmpty={onConnectToEmpty}
                onDeleteNodes={deleteNodes}
                onDeleteEdges={deleteEdges}
                onInit={(rf) => { rfRef.current = rf; }}
              />
              <div style={{ position: 'absolute', top: 10, insetInlineStart: 10, zIndex: 4, fontSize: 12, color: C.muted, background: 'rgba(255,255,255,.85)', padding: '4px 10px', borderRadius: 999, border: `1px solid ${C.line2}` }}>
                גררו מנקודה בצד כרטיס לכרטיס אחר כדי לחבר · שחררו על רקע ריק ליצירת הודעה חדשה
              </div>
            </div>

            <aside style={{
              width: 380, flex: 'none', overflowY: 'auto', background: '#FFFFFF', border: `1.5px solid ${C.lineApp}`,
              borderRadius: radius.xl, padding: 16, boxSizing: 'border-box',
            }}>
              {panel === 'sim' && status === 'ready' ? (
                <Simulator graph={graph} meta={meta} onActiveNode={setSimNodeId}
                  onSelectNode={(id) => setSelection({ kind: 'node', id })} onClose={() => setPanel('inspect')} />
              ) : selNode ? (
                <NodePanel key={selNode.id} node={selNode} graph={graph} meta={meta} errors={issueIndex.nodes[selNode.id] || []}
                  onChange={(p) => updateNode(selNode.id, p)} onSetEntry={setEntry}
                  onDelete={() => deleteNodes([selNode.id])} onDuplicate={() => duplicateNode(selNode.id)}
                  onSelectEdge={(id) => setSelection({ kind: 'edge', id })} onClose={() => setSelection(null)} />
              ) : selEdge ? (
                <EdgePanel key={selEdge.id} edge={selEdge} graph={graph} meta={meta} errors={issueIndex.edges[selEdge.id] || []}
                  onChange={(p) => updateEdge(selEdge.id, p)} onDelete={() => deleteEdges([selEdge.id])}
                  onSelectNode={(id) => setSelection({ kind: 'node', id })} onClose={() => setSelection(null)} />
              ) : (
                <div>
                  <Kicker>איך זה עובד</Kicker>
                  <div style={{ fontSize: 17, fontWeight: 600, margin: '6px 0 10px' }}>בחרו כרטיס או חץ כדי לערוך</div>
                  <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13.5, color: C.body, lineHeight: 1.75 }}>
                    <li><strong>כרטיס</strong> = הודעה שהבוט שולח (תבנית, הודעה, שאלה או סיום).</li>
                    <li>לכל <strong>כפתור</strong> יש נקודת חיבור משלו - גררו ממנה חץ להודעה הבאה.</li>
                    <li>על <strong>חץ</strong> מגדירים מתי עוברים ומה קורה בדרך: עדכון הגעה, שמירת שדה, תגית, התראה למארחים.</li>
                    <li>סימון <span style={{ color: C.ok, fontWeight: 600 }}>התחלה</span> מראה מאיפה השיחה מתחילה בכל שלב שליחה.</li>
                    <li>&quot;ניסיון שיחה&quot; מריץ את מה שעל המסך בלי לשלוח כלום.</li>
                  </ul>
                  {issueIndex.general.length > 0 && (
                    <div style={{ marginTop: 14, background: C.errBg, border: `1.5px solid ${C.errBorder}`, borderRadius: radius.md, padding: '8px 12px', fontSize: 13, color: C.err }}>
                      {issueIndex.general.map((m, i) => <div key={i}>{m}</div>)}
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      {versionsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1300 }}>
          <div onClick={() => { setVersionsOpen(false); setConfirmRevert(null); }} style={{ position: 'absolute', inset: 0, background: 'rgba(22,21,15,.25)' }} />
          <div dir="rtl" role="dialog" aria-label="גרסאות" style={{
            position: 'absolute', top: 0, bottom: 0, insetInlineEnd: 0, width: 400, maxWidth: '100%', background: C.paperApp,
            boxShadow: '0 24px 60px rgba(22,21,15,.18)', padding: 20, overflowY: 'auto', boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <Kicker>{scopeTitle(sel)}</Kicker>
                <div style={{ fontSize: 19, fontWeight: 600, marginTop: 4 }}>היסטוריית גרסאות</div>
              </div>
              <button type="button" onClick={() => { setVersionsOpen(false); setConfirmRevert(null); }} aria-label="סגירה" style={{ background: 'none', border: 0, cursor: 'pointer', color: C.body }}>
                <Ms size={22}>close</Ms>
              </button>
            </div>
            {versions === null && <div style={{ fontSize: 14, color: C.body }}>טוען…</div>}
            {versionsError && <div style={{ fontSize: 14, color: C.err, marginBottom: 8 }}>{versionsError}</div>}
            {versions && !versions.length && !versionsError && <div style={{ fontSize: 14, color: C.body }}>עוד לא נשמרו גרסאות להיקף הזה.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(versions || []).map((v) => (
                <Card key={v.version} style={{ padding: '12px 14px', borderColor: v.is_active ? C.purple : C.lineApp }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>גרסה {v.version}</span>
                    {v.is_active && <Chip tone="lav">נוכחית</Chip>}
                    <div style={{ flex: 1 }} />
                    {!v.is_active && confirmRevert !== v.version && (
                      <Btn kind="smallGhost" style={{ minHeight: 32 }} onClick={() => setConfirmRevert(v.version)}>שחזור</Btn>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>{fmtDate(v.created_at)}{v.created_by_name ? ` · ${v.created_by_name}` : ''}</div>
                  {v.note && <div style={{ fontSize: 13.5, color: C.body, marginTop: 6 }}>{v.note}</div>}
                  {confirmRevert === v.version && (
                    <div style={{ marginTop: 10, background: C.warnBg, border: `1.5px solid ${C.warnBorder}`, borderRadius: radius.md, padding: 10 }}>
                      <div style={{ fontSize: 13, color: C.warn, marginBottom: 8 }}>
                        לשחזר את גרסה {v.version}? תיווצר גרסה חדשה עם התוכן שלה.{dirty ? ' השינויים שלא נשמרו יימחקו.' : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn kind="smallPrimary" style={{ minHeight: 34 }} onClick={() => revert(v.version)}>כן, לשחזר</Btn>
                        <Btn kind="smallGhost" style={{ minHeight: 34 }} onClick={() => setConfirmRevert(null)}>ביטול</Btn>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" style={{
          position: 'fixed', bottom: 24, insetInlineStart: '50%', transform: 'translateX(50%)', zIndex: 1400,
          display: 'flex', alignItems: 'center', gap: 12, background: '#FFFFFF', color: C.ink, padding: '11px 16px', borderRadius: 14,
          border: `1.5px solid ${toast.tone === 'err' ? C.errBorder : toast.tone === 'ok' ? C.okBorder : C.lineApp}`,
          boxShadow: '0 18px 44px rgba(22,21,15,.14)', fontSize: 14,
        }}>
          <Ms size={18} style={{ color: toast.tone === 'err' ? C.err : toast.tone === 'ok' ? C.ok : C.purple }}>
            {toast.tone === 'err' ? 'error' : toast.tone === 'ok' ? 'check_circle' : 'info'}
          </Ms>
          {toast.text}
          {toast.undo && (
            <button type="button" onClick={() => { setGraph(toast.undo as FlowGraph); setToast(null); }} style={{
              background: 'none', border: 0, color: C.purple, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
            }}>ביטול</button>
          )}
        </div>
      )}
    </div>
  );
}

function scopeTitle(s: ScopeSel): string {
  if (s.scope === 'global') return 'ברירת המחדל';
  if (s.scope === 'event_type') return `אירועי ${EVENT_TYPES.find((t) => t.value === s.key)?.label || s.key}`;
  return `אירוע ${s.key}`;
}

function InlineConfirm({ tone, icon, text, confirmLabel, cancelLabel, onConfirm, onCancel, busy }: {
  tone: 'warn' | 'lav' | 'err'; icon: string; text: string; confirmLabel: string; cancelLabel: string;
  onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  const [bg, bc, fg] = tone === 'warn' ? [C.warnBg, C.warnBorder, C.warn] : tone === 'err' ? [C.errBg, C.errBorder, C.err] : [C.tintApp, C.tintBorder, C.purpleDark];
  return (
    <div role="alertdialog" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12, background: bg, border: `1.5px solid ${bc}`, borderRadius: radius.md, padding: '10px 12px' }}>
      <Ms size={19} style={{ color: fg }}>{icon}</Ms>
      <span style={{ flex: 1, minWidth: 220, fontSize: 13.5, color: fg, lineHeight: 1.5 }}>{text}</span>
      <Btn kind="smallPrimary" style={{ minHeight: 34 }} onClick={onConfirm} disabled={busy}>{busy ? 'רגע…' : confirmLabel}</Btn>
      <Btn kind="smallGhost" style={{ minHeight: 34 }} onClick={onCancel} disabled={busy}>{cancelLabel}</Btn>
    </div>
  );
}

export default function FlowBuilder() {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner />
    </ReactFlowProvider>
  );
}
