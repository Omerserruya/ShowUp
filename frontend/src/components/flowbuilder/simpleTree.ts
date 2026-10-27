/**
 * Pure helpers for the simple (rule-table) flow editor.
 *
 * The simple editor is only another VIEW of the same graph JSON the canvas
 * edits: a category = an entry stage, a message block = a node, a rule row =
 * an outgoing edge. Each message has an ANSWER MODE derived from the graph
 * (see nodeRows): choices (buttons/list, or the template's RSVP replies) give
 * exactly one row per choice; free text gives text rows (number / contains /
 * RSVP intent / catch-all); "both" = choices + text rows. Twin edges (typed
 * RSVP intent doing the same as a button) are hidden and kept in sync.
 * Nothing here changes the graph format.
 */
import type { EdgeKind, EdgeWhen, FlowEdge, FlowGraph, FlowNode, Stage } from './types';
import { STAGES } from './labels';

/** Same limit as shared/domain/flow_graph.py MAX_NODES. */
export const MAX_NODES = 100;

/** Outgoing edges of a node in backend match order (priority, then array index). */
export function orderedEdges(g: FlowGraph, nodeId: string): FlowEdge[] {
  return g.edges
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.from === nodeId)
    .sort((a, b) => (a.e.priority ?? 0) - (b.e.priority ?? 0) || a.i - b.i)
    .map((x) => x.e);
}

// ---------------------------------------------------------------- tree

export type RowTarget =
  | { kind: 'none' }                       // to: null - stays on the message, sends nothing
  | { kind: 'missing'; nodeId: string }    // points at a node that does not exist
  | { kind: 'nested'; block: TreeBlock }   // first time we meet the target: render it here
  | { kind: 'link'; nodeId: string };      // already rendered above (shared node / loop)

export interface TreeRow {
  edge: FlowEdge;
  target: RowTarget;
}

export interface TreeBlock {
  nodeId: string;
  depth: number;
  rows: TreeRow[];
}

export interface CategoryTree {
  root: TreeBlock | null;
  /** Node ids rendered as blocks in this tree, in render order. */
  order: string[];
}

/**
 * Depth-first tree from a root node. Every node is rendered once, at the
 * first place it is reached (rows in display order, see nodeRows); later references become
 * back-links. The visited set makes loops and shared nodes terminate.
 */
export function buildTree(
  g: FlowGraph, rootId: string | null | undefined, opts: { seen?: Set<string>; maxDepth?: number } = {},
): CategoryTree {
  const ids = new Set(g.nodes.map((n) => n.id));
  const order: string[] = [];
  const maxDepth = opts.maxDepth ?? 60;
  // `opts.seen` lets several trees share one page: nodes already shown elsewhere become links.
  const seen = opts.seen ?? new Set<string>();
  if (!rootId || !ids.has(rootId) || seen.has(rootId)) return { root: null, order };
  // "Changed their mind" rows sit in a collapsed section, so a message they lead
  // to is rendered under a regular row when one reaches it too.
  const isMind = (n: FlowNode, e: FlowEdge) => isChangeOfMind(n, nodeRows(g, n).mode, e);
  const primary = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (primary.has(cur) || (seen.has(cur) && cur !== rootId)) continue;
    primary.add(cur);
    const n = g.nodes.find((x) => x.id === cur);
    if (n) visibleEdges(g, n).forEach((e) => { if (e.to && ids.has(e.to) && !isMind(n, e)) stack.push(e.to); });
  }
  const visit = (nodeId: string, depth: number): TreeBlock => {
    seen.add(nodeId);
    order.push(nodeId);
    const block: TreeBlock = { nodeId, depth, rows: [] };
    const node = g.nodes.find((n) => n.id === nodeId) as FlowNode;
    visibleEdges(g, node).forEach((edge) => {
      let target: RowTarget;
      if (edge.to == null) target = { kind: 'none' };
      else if (!ids.has(edge.to)) target = { kind: 'missing', nodeId: edge.to };
      else if (seen.has(edge.to) || depth + 1 > maxDepth || (isMind(node, edge) && primary.has(edge.to))) target = { kind: 'link', nodeId: edge.to };
      else target = { kind: 'nested', block: visit(edge.to, depth + 1) };
      block.rows.push({ edge, target });
    });
    return block;
  };
  return { root: visit(rootId, 0), order };
}

/** Node ids reachable (via edges) from the given roots, roots included. */
export function reachableFrom(g: FlowGraph, roots: (string | null | undefined)[]): Set<string> {
  const ids = new Set(g.nodes.map((n) => n.id));
  const seen = new Set<string>();
  const stack = roots.filter((r): r is string => !!r && ids.has(r));
  while (stack.length) {
    const cur = stack.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    g.edges.forEach((e) => { if (e.from === cur && e.to && ids.has(e.to) && !seen.has(e.to)) stack.push(e.to); });
  }
  return seen;
}

/** Nodes no entry stage can reach. */
export function unconnectedNodes(g: FlowGraph): FlowNode[] {
  const r = reachableFrom(g, STAGES.map((s) => g.entry[s]));
  return g.nodes.filter((n) => !r.has(n.id));
}

/** Other stages whose entry is the same node as `stage`'s entry. */
export function sharedStages(g: FlowGraph, stage: Stage): Stage[] {
  const id = g.entry[stage];
  if (!id) return [];
  return STAGES.filter((s) => s !== stage && g.entry[s] === id);
}

// ---------------------------------------------------------------- cloning

const STAGE_SUFFIX: Record<Stage, string> = { invitation: 'inv', reminder: 'rem', final_reminder: 'fin', default: 'gen' };

/** A node id valid for the backend (^[a-z][a-z0-9_]{0,63}$, no '__') and unused. */
export function freshNodeId(base: string, suffix: string, taken: Set<string>): string {
  let stem = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(stem)) stem = `n_${stem}`.replace(/_+$/g, '');
  stem = stem.slice(0, 50).replace(/_+$/g, '');
  for (let k = 1; k < 1000; k += 1) {
    const id = `${stem}_${suffix}${k === 1 ? '' : k}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
  const id = `n_${Math.random().toString(36).slice(2, 10)}`;
  taken.add(id);
  return id;
}

export interface CloneResult {
  graph: FlowGraph;
  /** old node id -> new node id */
  idMap: Record<string, string>;
}

/**
 * Give `stage` its own copy of everything reachable from its entry: deep-copy
 * those nodes and their outgoing edges under fresh ids, then re-point only
 * that stage's entry. Other stages keep the original nodes untouched.
 * Returns null when there is nothing to clone or the node limit would break.
 */
export function cloneEntrySubtree(g: FlowGraph, stage: Stage, sourceRoot?: string): CloneResult | null {
  const root = sourceRoot ?? g.entry[stage];
  if (!root || !g.nodes.some((n) => n.id === root)) return null;
  const reach = reachableFrom(g, [root]);
  if (g.nodes.length + reach.size > MAX_NODES) return null;
  const taken = new Set(g.nodes.map((n) => n.id));
  const idMap: Record<string, string> = {};
  g.nodes.forEach((n) => { if (reach.has(n.id)) idMap[n.id] = freshNodeId(n.id, STAGE_SUFFIX[stage], taken); });

  const takenEdges = new Set(g.edges.map((e) => e.id));
  let ec = 0;
  const freshEdgeId = () => {
    let id = '';
    do { ec += 1; id = `e_${STAGE_SUFFIX[stage]}_${ec}`; } while (takenEdges.has(id));
    takenEdges.add(id);
    return id;
  };

  const newNodes: FlowNode[] = g.nodes.filter((n) => reach.has(n.id)).map((n) => {
    const copy: FlowNode = JSON.parse(JSON.stringify(n));
    copy.id = idMap[n.id];
    if (n.position) copy.position = { x: n.position.x, y: n.position.y + 1400 };
    return copy;
  });
  const newEdges: FlowEdge[] = g.edges.filter((e) => reach.has(e.from)).map((e) => {
    const copy: FlowEdge = JSON.parse(JSON.stringify(e));
    copy.id = freshEdgeId();
    copy.from = idMap[e.from];
    copy.to = e.to == null ? null : (idMap[e.to] ?? e.to);
    return copy;
  });
  return {
    graph: { ...g, entry: { ...g.entry, [stage]: idMap[root] }, nodes: [...g.nodes, ...newNodes], edges: [...g.edges, ...newEdges] },
    idMap,
  };
}

// ---------------------------------------------------------------- answer modes & rows

export type AnswerMode = 'choices' | 'text' | 'both';
/** `none` = sends and doesn't listen; `questions` = runs the host's guest questions. */
export type NodeMode = AnswerMode | 'none' | 'questions';

/** Quick replies of the invitation/reminder WhatsApp template (flow_graph.TEMPLATE_QUICK_REPLIES). */
export const TEMPLATE_CHOICES: { value: string; label: string }[] = [
  { value: 'confirmed', label: 'ברור שאגיע!' },
  { value: 'declined', label: 'לצערי לא אוכל' },
  { value: 'maybe', label: 'עוד מתלבט/ת, תחזרו אלי?' },
];

export interface ChoiceRow {
  /** `button:<id>` or `rsvp:<value>` (template replies). */
  key: string;
  label: string;
  buttonId?: string;
  rsvp?: string;
  hidden?: boolean;
  /** The edge the row edits (null = no rule yet, created on first edit). */
  edge: FlowEdge | null;
  /** Under-the-hood twins kept in sync (e.g. typed "מגיע" = the accept button). */
  linked: FlowEdge[];
}

export interface NodeRows {
  mode: NodeMode;
  /** Template nodes answer with the template's fixed RSVP replies. */
  templateChoices: boolean;
  choices: ChoiceRow[];
  /** Text-based rules, in backend evaluation order. */
  text: FlowEdge[];
  /** done / answered: structural rows the admin can retarget but not remove. */
  fixed: FlowEdge[];
}

const TEXT_ORDER: Record<string, number> = { button: 0, rsvp: 1, number: 2, number_invalid: 3, text_contains: 4, any_text: 5 };
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const hasChoiceInput = (n: FlowNode) => n.input === 'buttons' || n.input === 'list';
const usesTemplateChoices = (n: FlowNode) => n.type === 'template' && !hasChoiceInput(n);

/** Split a node's outgoing edges into choice rows, text rows and fixed rows. */
export function nodeRows(g: FlowGraph, node: FlowNode): NodeRows {
  const edges = orderedEdges(g, node.id);
  const used = new Set<string>();
  const fixed = edges.filter((e) => e.when.kind === 'done' || e.when.kind === 'answered');
  fixed.forEach((e) => used.add(e.id));
  const choices: ChoiceRow[] = [];
  const templateChoices = usesTemplateChoices(node);

  if (!node.guest_questions && templateChoices) {
    TEMPLATE_CHOICES.forEach((c) => {
      const mine = edges.filter((e) => !used.has(e.id) && e.when.kind === 'rsvp' && e.when.value === c.value && !e.when.typed_only);
      const [edge, ...rest] = mine;
      mine.forEach((e) => used.add(e.id));
      choices.push({ key: `rsvp:${c.value}`, label: c.label, rsvp: c.value, edge: edge || null, linked: rest });
    });
  } else if (!node.guest_questions && hasChoiceInput(node)) {
    node.buttons.forEach((b) => {
      const mine = edges.filter((e) => !used.has(e.id) && e.when.kind === 'button' && e.when.button_id === b.id);
      const [edge, ...rest] = mine;
      mine.forEach((e) => used.add(e.id));
      // An RSVP-intent edge doing exactly what this choice does is its typed twin.
      const twins = edge
        ? edges.filter((e) => !used.has(e.id) && e.when.kind === 'rsvp' && !e.when.typed_only && e.to === edge.to && sameJson(e.actions, edge.actions))
        : [];
      twins.forEach((e) => used.add(e.id));
      choices.push({ key: `button:${b.id}`, label: b.label, buttonId: b.id, hidden: !!b.hidden, edge: edge || null, linked: [...rest, ...twins] });
    });
  }

  const text = edges
    .filter((e) => !used.has(e.id))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (TEXT_ORDER[a.e.when.kind] ?? 9) - (TEXT_ORDER[b.e.when.kind] ?? 9) || a.i - b.i)
    .map((x) => x.e);

  let mode: NodeMode;
  if (node.guest_questions) mode = 'questions';
  else if (templateChoices || hasChoiceInput(node)) mode = text.length ? 'both' : 'choices';
  else if (node.input === 'text' || node.input === 'number' || text.length) mode = 'text';
  else mode = 'none';
  return { mode, templateChoices, choices, text, fixed };
}

/** Edges shown as rows (linked twins hidden), in display order. */
export function visibleEdges(g: FlowGraph, node: FlowNode): FlowEdge[] {
  const r = nodeRows(g, node);
  return [...r.choices.map((c) => c.edge).filter((e): e is FlowEdge => !!e), ...r.text, ...r.fixed];
}

// ---------------------------------------------------------------- edits (pure)

const patchNode = (g: FlowGraph, id: string, patch: Partial<FlowNode>): FlowGraph =>
  ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
const getNode = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id);
const nextPriority = (g: FlowGraph, nodeId: string) =>
  g.edges.filter((e) => e.from === nodeId).reduce((m, e) => Math.max(m, (e.priority ?? 0) + 1), 0);

export interface EdgeIdGen { (): string }

/** Buttons when ≤3 choices, a WhatsApp list above that. */
export const choiceInputFor = (count: number) => (count > 3 ? 'list' : 'buttons');

/** Number rules need input=number (validator: not_number_node); keep text nodes in sync. */
export function syncNumberInput(g: FlowGraph, nodeId: string): FlowGraph {
  const n = getNode(g, nodeId);
  if (!n || (n.input !== 'text' && n.input !== 'number')) return g;
  const wants = g.edges.some((e) => e.from === nodeId && (e.when.kind === 'number' || e.when.kind === 'number_invalid'));
  const input = wants ? 'number' : 'text';
  return input === n.input ? g : patchNode(g, nodeId, { input });
}

/** What switching a node's answer mode would delete (rules + choices). */
export function modeSwitchCost(g: FlowGraph, nodeId: string, mode: AnswerMode): { rules: number; choices: number } {
  const n = getNode(g, nodeId);
  if (!n) return { rules: 0, choices: 0 };
  const r = nodeRows(g, n);
  if (mode === 'choices') return { rules: r.text.length, choices: 0 };
  if (mode === 'both') return { rules: r.text.filter((e) => e.when.kind === 'number' || e.when.kind === 'number_invalid' || e.when.kind === 'button').length, choices: 0 };
  // text: choice rows go away (their typed RSVP twins stay as text rules)
  const rules = r.choices.reduce((s, c) => s + (c.edge && c.edge.when.kind === 'button' ? 1 : 0)
    + c.linked.filter((e) => e.when.kind === 'button').length, 0);
  return { rules, choices: r.templateChoices ? 0 : n.buttons.length };
}

/**
 * Switch a node's answer mode, mapping onto the existing schema:
 *  choices → input buttons/list, one button edge per choice, text rules removed
 *  both    → choices + text rules (at least a catch-all any_text); number rules
 *            are dropped because the backend only allows them on input=number
 *  text    → input text (or number if number rules exist), buttons removed
 * Templates keep their fixed RSVP replies and cannot be text-only.
 */
export function setAnswerMode(g: FlowGraph, nodeId: string, mode: AnswerMode, newId: EdgeIdGen, newButtonId: EdgeIdGen): FlowGraph {
  const n = getNode(g, nodeId);
  if (!n || n.guest_questions) return g;
  const r = nodeRows(g, n);
  let out = g;
  if (mode === 'choices' || mode === 'both') {
    const drop = new Set(r.text.filter((e) => mode === 'choices' || ['number', 'number_invalid', 'button'].includes(e.when.kind)).map((e) => e.id));
    out = { ...out, edges: out.edges.filter((e) => !drop.has(e.id)) };
    if (usesTemplateChoices(n)) {
      TEMPLATE_CHOICES.forEach((c) => {
        if (!r.choices.find((x) => x.rsvp === c.value)?.edge) {
          out = { ...out, edges: [...out.edges, { id: newId(), from: nodeId, to: null, when: { kind: 'rsvp', value: c.value }, actions: [], priority: nextPriority(out, nodeId) }] };
        }
      });
    } else {
      const buttons = n.buttons.length ? n.buttons : [{ id: newButtonId(), label: 'כן' }, { id: newButtonId(), label: 'לא' }];
      out = patchNode(out, nodeId, { buttons, input: choiceInputFor(buttons.length), type: n.type === 'message' ? 'question' : n.type });
      buttons.forEach((b) => {
        if (!out.edges.some((e) => e.from === nodeId && e.when.kind === 'button' && e.when.button_id === b.id)) {
          out = { ...out, edges: [...out.edges, { id: newId(), from: nodeId, to: null, when: { kind: 'button', button_id: b.id }, actions: [], priority: nextPriority(out, nodeId) }] };
        }
      });
    }
    if (mode === 'both' && !out.edges.some((e) => e.from === nodeId && e.when.kind === 'any_text')) {
      out = { ...out, edges: [...out.edges, { id: newId(), from: nodeId, to: null, when: { kind: 'any_text' }, actions: [], priority: nextPriority(out, nodeId) }] };
    }
    return out;
  }
  // text
  if (usesTemplateChoices(n)) return g;
  out = { ...out, edges: out.edges.filter((e) => !(e.from === nodeId && e.when.kind === 'button')) };
  out = patchNode(out, nodeId, { buttons: [], input: 'text', type: n.type === 'message' ? 'question' : n.type });
  if (!out.edges.some((e) => e.from === nodeId && e.when.kind !== 'done' && e.when.kind !== 'answered')) {
    out = { ...out, edges: [...out.edges, { id: newId(), from: nodeId, to: null, when: { kind: 'any_text' }, actions: [], priority: nextPriority(out, nodeId) }] };
  }
  return syncNumberInput(out, nodeId);
}

/** Add a choice (button + its rule). Switches to a list above 3 choices. */
export function addChoice(g: FlowGraph, nodeId: string, buttonId: string, edgeId: string, to: string | null = null, label = ''): FlowGraph {
  const n = getNode(g, nodeId);
  if (!n) return g;
  const buttons = [...n.buttons, { id: buttonId, label }];
  const out = patchNode(g, nodeId, { buttons, input: choiceInputFor(buttons.length) });
  return { ...out, edges: [...out.edges, { id: edgeId, from: nodeId, to, when: { kind: 'button', button_id: buttonId }, actions: [], priority: nextPriority(out, nodeId) }] };
}

/** Remove a choice: the button, its rule and the rule's typed twins. */
export function removeChoice(g: FlowGraph, nodeId: string, buttonId: string): FlowGraph {
  const n = getNode(g, nodeId);
  if (!n) return g;
  const row = nodeRows(g, n).choices.find((c) => c.buttonId === buttonId);
  const drop = new Set([...(row?.edge ? [row.edge.id] : []), ...(row?.linked || []).map((e) => e.id)]);
  const buttons = n.buttons.filter((b) => b.id !== buttonId);
  const out = patchNode(g, nodeId, { buttons, input: choiceInputFor(buttons.length) });
  return { ...out, edges: out.edges.filter((e) => !drop.has(e.id) && !(e.from === nodeId && e.when.kind === 'button' && e.when.button_id === buttonId)) };
}

export function moveChoice(g: FlowGraph, nodeId: string, buttonId: string, d: -1 | 1): FlowGraph {
  const n = getNode(g, nodeId);
  if (!n) return g;
  const i = n.buttons.findIndex((b) => b.id === buttonId);
  const j = i + d;
  if (i < 0 || j < 0 || j >= n.buttons.length) return g;
  const buttons = [...n.buttons];
  [buttons[i], buttons[j]] = [buttons[j], buttons[i]];
  return patchNode(g, nodeId, { buttons });
}

/** Edit a choice row's target/actions; creates the rule if missing and keeps twins in sync. */
export function updateChoice(g: FlowGraph, nodeId: string, key: string, patch: Partial<Pick<FlowEdge, 'to' | 'actions'>>, newId: EdgeIdGen): FlowGraph {
  const n = getNode(g, nodeId);
  if (!n) return g;
  const row = nodeRows(g, n).choices.find((c) => c.key === key);
  if (!row) return g;
  if (!row.edge) {
    const when: EdgeWhen = row.buttonId ? { kind: 'button', button_id: row.buttonId } : { kind: 'rsvp', value: row.rsvp as string };
    return { ...g, edges: [...g.edges, { id: newId(), from: nodeId, to: null, when, actions: [], priority: nextPriority(g, nodeId), ...patch }] };
  }
  const ids = new Set([row.edge.id, ...row.linked.map((e) => e.id)]);
  return { ...g, edges: g.edges.map((e) => (ids.has(e.id) ? { ...e, ...patch } : e)) };
}

/**
 * "Changed their mind" rules: a typed RSVP intent on a message that asks
 * something else (count, notes, update...). Shown apart from the message's own
 * answers, in their own collapsed section.
 */
export function isChangeOfMind(node: FlowNode, mode: NodeMode, e: FlowEdge): boolean {
  if (node.type === 'template' || e.when.kind !== 'rsvp') return false;
  return !!e.when.typed_only || (mode === 'text' && (node.input === 'number' || node.input === 'text'));
}

/** Flat value for a text rule's condition select. */
export function conditionKey(w: EdgeWhen): string {
  switch (w.kind) {
    case 'button': return `button:${w.button_id}`;
    case 'rsvp': return `rsvp:${w.value}`;
    default: return w.kind;
  }
}

export function whenFromKey(key: string, prev?: EdgeWhen): EdgeWhen {
  if (prev && conditionKey(prev) === key) return prev;
  if (key.startsWith('button:')) return { kind: 'button', button_id: key.slice(7) };
  if (key.startsWith('rsvp:')) return { kind: 'rsvp', value: key.slice(5) };
  if (key === 'text_contains') return { kind: 'text_contains', words: prev?.kind === 'text_contains' ? prev.words : [] };
  return { kind: key as EdgeKind } as EdgeWhen;
}

export interface ConditionOption { key: string; label: string }

/** Text-rule conditions for a mode (number rules only in pure free-text mode). */
/**
 * On a question that asks for something else (a number / free text), typed RSVP
 * rules mean the guest changed their mind instead of answering - label them so.
 */
export function textConditionOptions(mode: NodeMode, current?: EdgeWhen, changeOfMind = false): ConditionOption[] {
  const out: ConditionOption[] = [];
  if (mode === 'questions') {
    out.push({ key: 'any_text', label: 'כתב משהו אחר' });
  } else {
    if (mode === 'text' || mode === 'none') {
      out.push({ key: 'number', label: 'כתב מספר' }, { key: 'number_invalid', label: 'כתב מספר לא תקין' });
    }
    out.push(
      { key: 'text_contains', label: 'כתב טקסט שמכיל…' },
      { key: 'rsvp:confirmed', label: changeOfMind ? 'כתב שבעצם כן מגיע' : 'כתב שהוא מגיע' },
      { key: 'rsvp:declined', label: changeOfMind ? 'כתב שבעצם לא יגיע' : 'כתב שלא יגיע' },
      { key: 'rsvp:maybe', label: changeOfMind ? 'כתב שבעצם עוד מתלבט' : 'כתב שאולי' },
      { key: 'any_text', label: mode === 'both' ? 'כתב משהו אחר' : 'כל תשובה אחרת' },
    );
  }
  if (current && !out.some((o) => o.key === conditionKey(current))) {
    out.push({ key: conditionKey(current), label: current.kind === 'button' ? 'לחץ כפתור שנמחק' : current.kind });
  }
  return out;
}

export function fixedRowLabel(node: FlowNode, e: FlowEdge): string {
  if (e.when.kind === 'answered') return 'ענה על שאלה (ממשיכים לשאלה הבאה)';
  if (node.guest_questions) return 'סיים לענות על השאלות';
  if (node.skip) return 'כשהשלב כבוי בהגדרות - ממשיכים ישר';
  if (node.type === 'message') return 'מיד אחרי ההודעה';
  return 'ממשיכים בלי לחכות לתשובה';
}

/** A new text rule: catch-all first, then "contains". */
export function addTextRule(g: FlowGraph, nodeId: string, edgeId: string, to: string | null = null): FlowGraph {
  const hasAny = g.edges.some((e) => e.from === nodeId && e.when.kind === 'any_text');
  const when: EdgeWhen = hasAny ? { kind: 'text_contains', words: [] } : { kind: 'any_text' };
  let out: FlowGraph = { ...g, edges: [...g.edges, { id: edgeId, from: nodeId, to, when, actions: [], priority: nextPriority(g, nodeId) }] };
  const n = getNode(out, nodeId);
  if (n && n.input === 'none' && n.type !== 'end' && n.type !== 'template') out = patchNode(out, nodeId, { input: 'text', type: n.type === 'message' ? 'question' : n.type });
  return out;
}

/** "Connect after this message": a new choice / text rule / continue, by the node's mode. */
export function addRuleTo(g: FlowGraph, fromId: string, to: string | null, ids: { edge: string; button: string }): FlowGraph {
  const n = getNode(g, fromId);
  if (!n) return g;
  const r = nodeRows(g, n);
  if (r.mode === 'choices' && !r.templateChoices) return addChoice(g, fromId, ids.button, ids.edge, to, 'בחירה חדשה');
  if (r.mode === 'none' && !r.fixed.length) {
    return { ...g, edges: [...g.edges, { id: ids.edge, from: fromId, to, when: { kind: 'done' }, actions: [], priority: nextPriority(g, fromId) }] };
  }
  return addTextRule(g, fromId, ids.edge, to);
}

/** Move a text rule among rules of the same kind (other kinds are matched in a fixed order). */
export function moveTextRule(g: FlowGraph, nodeId: string, edgeId: string, d: -1 | 1): FlowGraph {
  const n = getNode(g, nodeId);
  if (!n) return g;
  const text = nodeRows(g, n).text;
  const i = text.findIndex((e) => e.id === edgeId);
  const j = i + d;
  if (i < 0 || j < 0 || j >= text.length || text[j].when.kind !== text[i].when.kind) return g;
  const ids = orderedEdges(g, nodeId).map((e) => e.id);
  const a = ids.indexOf(text[i].id);
  const b = ids.indexOf(text[j].id);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  return reorderEdges(g, nodeId, ids);
}

/** Replace `nodeId`'s outgoing edges order with `ids` (renumbers priority 0..n-1). */
export function reorderEdges(g: FlowGraph, nodeId: string, ids: string[]): FlowGraph {
  const prio = new Map(ids.map((id, i) => [id, i]));
  return { ...g, edges: g.edges.map((e) => (e.from === nodeId && prio.has(e.id) ? { ...e, priority: prio.get(e.id) as number } : e)) };
}

/** Insert `edge` right after `afterId` (or last) in its node's match order. */
export function insertEdge(g: FlowGraph, edge: FlowEdge, afterId?: string): FlowGraph {
  const ids = orderedEdges(g, edge.from).map((e) => e.id);
  const at = afterId ? ids.indexOf(afterId) + 1 : ids.length;
  ids.splice(at > 0 ? at : ids.length, 0, edge.id);
  return reorderEdges({ ...g, edges: [...g.edges, edge] }, edge.from, ids);
}

/** Remove a node, its edges and any entry pointing at it. */
export function removeNode(g: FlowGraph, id: string): FlowGraph {
  const entry = { ...g.entry };
  (Object.keys(entry) as Stage[]).forEach((s) => { if (entry[s] === id) delete entry[s]; });
  return { ...g, entry, nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) };
}
