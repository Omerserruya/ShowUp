/**
 * Flow-level extra fields ("שדות נוספים"): graph.fields + the set_field
 * `custom:<key>` actions that write them. Pure helpers shared by the simple
 * editor, the canvas panels and FlowBuilder.
 */
import type { FlowAction, FlowEdge, FlowGraph, FlowMeta, FlowNode, GraphField } from './types';
import { choiceInputFor } from './simpleTree';

/** Same limits as shared/domain/flow_graph.py GRAPH_FIELD_*. */
export const FIELD_LIMITS = { max: 30, label: 100, minOptions: 2, maxOptions: 10, option: 24 };

export const ANSWER = '{answer}';
export const fieldRef = (key: string) => `custom:${key}`;

export const FIELD_PRESETS: { label: string; type: GraphField['type']; options: string[] }[] = [
  { label: 'הסעה', type: 'choice', options: ['כן, צריך הסעה', 'לא צריך'] },
  { label: 'נקודת איסוף להסעה', type: 'choice', options: ['סבידור מרכז', 'קדימה צורן', 'לא צריך הסעה'] },
  { label: 'מנה', type: 'choice', options: ['בשר', 'צמחוני', 'טבעוני'] },
  { label: 'הערה חופשית', type: 'text', options: [] },
];

export const graphFields = (g: FlowGraph): GraphField[] => g.fields || [];

export function fieldByRef(g: FlowGraph, ref: string): GraphField | undefined {
  if (!ref.startsWith('custom:')) return undefined;
  const key = ref.slice(7);
  return graphFields(g).find((f) => f.key === key);
}

export const isFieldAction = (g: FlowGraph, a: FlowAction): a is Extract<FlowAction, { type: 'set_field' }> =>
  a.type === 'set_field' && !!fieldByRef(g, a.field);

/** A key valid for the backend (^[A-Za-z0-9_-]{1,50}$) and unused. */
export function newFieldKey(g: FlowGraph): string {
  const taken = new Set(graphFields(g).map((f) => f.key));
  for (let i = 1; i < 1000; i += 1) {
    const k = `extra_${i}`;
    if (!taken.has(k)) return k;
  }
  return `extra_${Date.now().toString(36)}`;
}

export function addField(g: FlowGraph, f: Omit<GraphField, 'key'>): { graph: FlowGraph; key: string } {
  const key = newFieldKey(g);
  return { graph: { ...g, fields: [...graphFields(g), { ...f, key }] }, key };
}

export function updateField(g: FlowGraph, key: string, patch: Partial<Omit<GraphField, 'key'>>): FlowGraph {
  return { ...g, fields: graphFields(g).map((f) => (f.key === key ? { ...f, ...patch } : f)) };
}

/** Rules that write this field. */
export function fieldUsage(g: FlowGraph, key: string): FlowEdge[] {
  const ref = fieldRef(key);
  return g.edges.filter((e) => e.actions.some((a) => a.type === 'set_field' && a.field === ref));
}

/** Remove the field and every rule action that writes it. */
export function removeField(g: FlowGraph, key: string): FlowGraph {
  const ref = fieldRef(key);
  return {
    ...g,
    fields: graphFields(g).filter((f) => f.key !== key),
    edges: g.edges.map((e) => (e.actions.some((a) => a.type === 'set_field' && a.field === ref)
      ? { ...e, actions: e.actions.filter((a) => !(a.type === 'set_field' && a.field === ref)) }
      : e)),
  };
}

/** Field problems in Hebrew (mirrors the backend validator), or null. */
export function fieldProblem(f: GraphField): string | null {
  if (!f.label.trim()) return 'צריך שם לשדה';
  if (f.label.length > FIELD_LIMITS.label) return `שם עד ${FIELD_LIMITS.label} תווים`;
  if (f.type !== 'choice') return null;
  const opts = f.options.map((o) => o.trim());
  if (opts.some((o) => !o)) return 'יש תשובה ריקה';
  if (opts.length < FIELD_LIMITS.minOptions) return 'צריך לפחות 2 תשובות';
  if (opts.length > FIELD_LIMITS.maxOptions) return 'עד 10 תשובות';
  if (new Set(opts).size !== opts.length) return 'יש תשובה כפולה';
  const long = opts.find((o) => o.length > FIELD_LIMITS.option);
  if (long) return `"${long}" ארוך מ-${FIELD_LIMITS.option} תווים`;
  return null;
}

/** The value a rule should store for a field: the choice it belongs to, else the guest's answer. */
export function defaultFieldValue(f: GraphField, choiceLabel?: string): string {
  if (f.type === 'choice' && choiceLabel && f.options.includes(choiceLabel.trim())) return choiceLabel.trim();
  return ANSWER;
}

export function fieldValueLabel(v: string): string {
  return v === ANSWER ? 'מה שהאורח ענה' : v;
}

/**
 * The editor's meta: the backend's guest columns (normalised to {value,label})
 * plus this graph's extra fields, so every set_field picker and summary knows them.
 */
export function withGraphFields(meta: FlowMeta | null, g: FlowGraph): FlowMeta | null {
  const extra = graphFields(g).map((f) => ({ value: fieldRef(f.key), label: `${f.label || f.key} (שדה נוסף)` }));
  if (!meta && !extra.length) return meta;
  const base = (meta?.fields || []).map((f: any) => ({ value: String(f.value ?? f.field ?? ''), label: String(f.label ?? f.value ?? f.field ?? '') }))
    .filter((f) => f.value);
  return { ...(meta || { variables: [], stages: [] }), fields: [...base, ...extra] } as FlowMeta;
}

/**
 * A new question node asking for `f`: one choice per answer (each storing that
 * answer) or a free-text catch-all storing {answer}. Every rule continues to `to`,
 * so inserting the question keeps the rest of the conversation as it was.
 */
export function fieldQuestion(
  g: FlowGraph, f: GraphField, nodeId: string, ids: { edge: () => string; button: () => string },
  to: string | null, near?: FlowNode,
): FlowGraph {
  const position = near?.position ? { x: near.position.x - 340, y: near.position.y + 60 } : { x: 0, y: 0 };
  const store = (value: string): FlowAction => ({ type: 'set_field', field: fieldRef(f.key), value });
  if (f.type === 'choice') {
    const buttons = f.options.map((label) => ({ id: ids.button(), label }));
    const node: FlowNode = {
      id: nodeId, type: 'question', title: f.label, text: `${f.label}?`, input: choiceInputFor(buttons.length), buttons, position,
    };
    const edges: FlowEdge[] = buttons.map((b, i) => ({
      id: ids.edge(), from: nodeId, to, when: { kind: 'button', button_id: b.id }, actions: [store(b.label)], priority: i,
    }));
    return { ...g, nodes: [...g.nodes, node], edges: [...g.edges, ...edges] };
  }
  const node: FlowNode = { id: nodeId, type: 'question', title: f.label, text: `${f.label}?`, input: 'text', buttons: [], position };
  return {
    ...g,
    nodes: [...g.nodes, node],
    edges: [...g.edges, { id: ids.edge(), from: nodeId, to, when: { kind: 'any_text' }, actions: [store(ANSWER)], priority: 0 }],
  };
}
