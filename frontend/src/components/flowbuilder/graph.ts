/** Pure graph helpers: normalisation, handles/ports, auto-layout, issue mapping. */
import type { EdgeKind, EdgeWhen, FlowEdge, FlowGraph, FlowNode, GraphIssue, NodeType, Stage } from './types';
import { whenLabel } from './labels';

export const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const emptyGraph = (): FlowGraph => ({ schema_version: 1, entry: {}, nodes: [], edges: [] });

/** Fill in missing arrays/fields so the editor never trips on partial data. */
export function normalizeGraph(g: any): FlowGraph {
  const graph: FlowGraph = {
    schema_version: Number(g?.schema_version) || 1,
    entry: { ...(g?.entry || {}) },
    nodes: Array.isArray(g?.nodes) ? g.nodes : [],
    edges: Array.isArray(g?.edges) ? g.edges : [],
  };
  if (Array.isArray(g?.fields)) {
    graph.fields = g.fields.map((f: any) => ({
      key: String(f.key ?? ''),
      label: f.label ?? '',
      type: f.type === 'choice' ? 'choice' : 'text',
      options: Array.isArray(f.options) ? f.options.map(String) : [],
    }));
  }
  graph.nodes = graph.nodes.map((n: any) => ({
    ...n,
    id: String(n.id),
    type: (n.type || 'message') as NodeType,
    title: n.title ?? '',
    text: n.text ?? '',
    input: n.input || 'none',
    buttons: Array.isArray(n.buttons) ? n.buttons.map((b: any) => ({ id: String(b.id), label: b.label ?? '', ...(b.hidden ? { hidden: true } : {}) })) : [],
  }));
  graph.edges = graph.edges.map((e: any, i: number) => ({
    ...e,
    id: String(e.id ?? `e${i + 1}`),
    from: String(e.from),
    to: e.to == null ? null : String(e.to),
    when: e.when || { kind: 'any_text' },
    actions: Array.isArray(e.actions) ? e.actions : [],
  }));
  return graph;
}

// ---------------------------------------------------------------- handles

export const TARGET_HANDLE = 'in';

/** Source handle id an edge leaves from, derived from its condition. */
export function handleForWhen(when: EdgeWhen): string {
  switch (when.kind) {
    case 'button': return `btn:${when.button_id}`;
    case 'text_contains':
    case 'any_text': return 'text';
    default: return when.kind;
  }
}

export interface Port {
  id: string;
  label: string;
  kind: 'button' | 'generic';
}

const GENERIC_PORT_LABEL: Record<string, string> = {
  rsvp: 'תשובת הגעה (זוהתה)',
  number: 'ענו מספר',
  number_invalid: 'מספר לא תקין',
  text: 'טקסט חופשי',
  done: 'אחרי השאלות / המשך',
};

/** Output ports of a node: one per button + generic ones by input type. */
export function portsFor(node: FlowNode, graph: FlowGraph): Port[] {
  const ports: Port[] = [];
  if (node.input === 'buttons' || node.input === 'list') {
    node.buttons.forEach((b) => ports.push({ id: `btn:${b.id}`, label: b.label || 'ללא שם', kind: 'button' }));
  }
  const generic = new Set<string>();
  if (node.type === 'template') generic.add('rsvp');
  if (node.input === 'number') { generic.add('number'); generic.add('number_invalid'); }
  if (node.input === 'text' || node.input === 'buttons' || node.input === 'list') generic.add('text');
  if (node.input === 'none' && node.type !== 'end') generic.add('done');
  if (node.guest_questions) generic.add('done');
  // Keep every handle an existing edge uses, so nothing renders detached.
  graph.edges.filter((e) => e.from === node.id).forEach((e) => {
    const h = handleForWhen(e.when);
    if (!h.startsWith('btn:')) generic.add(h);
    else if (!ports.some((p) => p.id === h)) ports.push({ id: h, label: 'כפתור שנמחק', kind: 'button' });
  });
  ['rsvp', 'number', 'number_invalid', 'text', 'done'].forEach((k) => {
    if (generic.has(k)) ports.push({ id: k, label: GENERIC_PORT_LABEL[k], kind: 'generic' });
  });
  return ports;
}

/** Default condition for an edge dragged out of a handle. */
export function whenForHandle(handle: string | null | undefined): EdgeWhen {
  if (handle && handle.startsWith('btn:')) return { kind: 'button', button_id: handle.slice(4) };
  switch (handle) {
    case 'rsvp': return { kind: 'rsvp', value: 'confirmed' };
    case 'number': return { kind: 'number' };
    case 'number_invalid': return { kind: 'number_invalid' };
    case 'done': return { kind: 'done' };
    default: return { kind: 'any_text' };
  }
}

export function defaultWhen(kind: EdgeKind, node: FlowNode | undefined): EdgeWhen {
  switch (kind) {
    case 'button': return { kind: 'button', button_id: node?.buttons[0]?.id || '' };
    case 'rsvp': return { kind: 'rsvp', value: 'confirmed' };
    case 'text_contains': return { kind: 'text_contains', words: [] };
    default: return { kind } as EdgeWhen;
  }
}

export const edgeLabel = (e: FlowEdge, g: FlowGraph) => whenLabel(e.when, g, e.from);

// ---------------------------------------------------------------- layout

const COL_W = 340;
const ROW_GAP = 110;

/** Rough rendered height of a node card, for layering. */
export function estimateHeight(n: FlowNode, g: FlowGraph): number {
  const lines = Math.min(4, Math.ceil((n.text || '').length / 34) || 1);
  return 96 + lines * 20 + portsFor(n, g).length * 34;
}

/**
 * Simple layered top→down layout: BFS depth from the stage entries, nodes in a
 * layer laid out right→left (RTL reading order), unreachable nodes at the end.
 */
export function autoLayout(g: FlowGraph, onlyMissing: boolean): FlowGraph {
  const needs = g.nodes.some((n) => !n.position || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y));
  if (onlyMissing && !needs) return g;
  const depth = new Map<string, number>();
  const queue: string[] = [];
  const entries = (['invitation', 'reminder', 'final_reminder', 'default'] as Stage[])
    .map((s) => g.entry[s]).filter((x): x is string => !!x && g.nodes.some((n) => n.id === x));
  const roots = entries.length ? entries : g.nodes.filter((n) => !g.edges.some((e) => e.to === n.id)).map((n) => n.id);
  roots.forEach((r) => { if (!depth.has(r)) { depth.set(r, 0); queue.push(r); } });
  while (queue.length) {
    const id = queue.shift() as string;
    const d = depth.get(id) as number;
    g.edges
      .filter((e) => e.from === id && e.to)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .forEach((e) => {
        const to = e.to as string;
        if (!depth.has(to)) { depth.set(to, d + 1); queue.push(to); }
      });
  }
  let maxD = Math.max(0, ...Array.from(depth.values()));
  g.nodes.forEach((n) => { if (!depth.has(n.id)) depth.set(n.id, ++maxD); });

  const layers: FlowNode[][] = [];
  g.nodes.forEach((n) => {
    const d = depth.get(n.id) as number;
    (layers[d] = layers[d] || []).push(n);
  });
  const pos = new Map<string, { x: number; y: number }>();
  let y = 0;
  layers.forEach((layer) => {
    if (!layer?.length) return;
    const width = (layer.length - 1) * COL_W;
    layer.forEach((n, i) => pos.set(n.id, { x: width / 2 - i * COL_W, y }));
    y += Math.max(...layer.map((n) => estimateHeight(n, g))) + ROW_GAP;
  });
  return {
    ...g,
    nodes: g.nodes.map((n) => (onlyMissing && n.position && Number.isFinite(n.position.x) ? n : { ...n, position: pos.get(n.id) || { x: 0, y: 0 } })),
  };
}

// ---------------------------------------------------------------- issues

export interface IssueIndex {
  nodes: Record<string, string[]>;
  edges: Record<string, string[]>;
  general: string[];
}

/** Map server issues (`nodes[2].buttons[0].label`, `edges[e3]`, ids) to nodes/edges. */
export function indexIssues(issues: GraphIssue[], g: FlowGraph): IssueIndex {
  const out: IssueIndex = { nodes: {}, edges: {}, general: [] };
  const push = (bucket: Record<string, string[]>, id: string, m: string) => { (bucket[id] = bucket[id] || []).push(m); };
  issues.forEach((it) => {
    const msg = it.message || 'שגיאה';
    if (it.edge_id) return push(out.edges, it.edge_id, msg);
    if (it.node_id) return push(out.nodes, it.node_id, msg);
    const m = /^(nodes|edges)(?:\[([^\]]+)\]|\.([^.]+))/.exec(it.path || '');
    if (m) {
      const list: { id: string }[] = m[1] === 'nodes' ? g.nodes : g.edges;
      const ref = m[2] ?? m[3];
      const byId = list.find((x) => x.id === ref);
      const item = byId || (/^\d+$/.test(ref) ? list[Number(ref)] : undefined);
      if (item) return push(m[1] === 'nodes' ? out.nodes : out.edges, item.id, msg);
    }
    const em = /^entry\.?(\w+)?/.exec(it.path || '');
    if (em && em[1] && g.entry[em[1] as Stage]) return push(out.nodes, g.entry[em[1] as Stage] as string, msg);
    out.general.push(msg);
    return undefined;
  });
  return out;
}

/** Strip editor-only noise before sending. */
export function cleanGraph(g: FlowGraph): FlowGraph {
  return {
    ...g,
    nodes: g.nodes.map((n) => ({
      ...n,
      position: n.position ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : n.position,
    })),
  };
}
