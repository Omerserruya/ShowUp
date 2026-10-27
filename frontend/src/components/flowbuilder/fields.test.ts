import type { FlowGraph } from './types';
import { addField, defaultFieldValue, fieldProblem, fieldQuestion, fieldUsage, removeField, withGraphFields } from './fields';

const base = (): FlowGraph => ({
  schema_version: 1,
  entry: { default: 'invite' },
  nodes: [
    { id: 'invite', type: 'template', title: 'הזמנה', text: '', input: 'none', buttons: [] },
    { id: 'thanks', type: 'end', title: 'תודה', text: 'תודה!', input: 'none', buttons: [] },
  ],
  edges: [{ id: 'e1', from: 'invite', to: 'thanks', when: { kind: 'rsvp', value: 'confirmed' }, actions: [] }],
});

let n = 0;
const ids = { edge: () => `e_t${(n += 1)}`, button: () => `b_t${(n += 1)}` };

test('addField picks a valid unused key', () => {
  const a = addField(base(), { label: 'הסעה', type: 'choice', options: ['כן', 'לא'] });
  const b = addField(a.graph, { label: 'מנה', type: 'text', options: [] });
  expect(a.key).toBe('extra_1');
  expect(b.key).toBe('extra_2');
  expect(b.graph.fields?.map((f) => f.label)).toEqual(['הסעה', 'מנה']);
});

test('fieldQuestion inserts a choice question that stores each answer and continues', () => {
  const { graph, key } = addField(base(), { label: 'נקודת איסוף', type: 'choice', options: ['סבידור מרכז', 'קדימה צורן', 'לא צריך', 'אחר'] });
  const f = graph.fields![0];
  const g = fieldQuestion(graph, f, 'n_bus', ids, 'thanks');
  const node = g.nodes.find((x) => x.id === 'n_bus')!;
  expect(node.input).toBe('list');
  expect(node.buttons.map((b) => b.label)).toEqual(f.options);
  const out = g.edges.filter((e) => e.from === 'n_bus');
  expect(out).toHaveLength(4);
  expect(out.every((e) => e.to === 'thanks')).toBe(true);
  expect(out.map((e) => (e.actions[0] as any).value)).toEqual(f.options);
  expect(fieldUsage(g, key)).toHaveLength(4);
});

test('fieldQuestion for a text field stores {answer}', () => {
  const { graph } = addField(base(), { label: 'הערה', type: 'text', options: [] });
  const g = fieldQuestion(graph, graph.fields![0], 'n_note', ids, null);
  const e = g.edges.find((x) => x.from === 'n_note')!;
  expect(e.when.kind).toBe('any_text');
  expect(e.actions).toEqual([{ type: 'set_field', field: 'custom:extra_1', value: '{answer}' }]);
});

test('removeField drops the field and its actions only', () => {
  const { graph, key } = addField(base(), { label: 'הסעה', type: 'choice', options: ['כן', 'לא'] });
  const g = { ...graph, edges: graph.edges.map((e) => ({ ...e, actions: [{ type: 'set_rsvp' as const, value: 'confirmed' }, { type: 'set_field' as const, field: `custom:${key}`, value: 'כן' }] })) };
  const out = removeField(g, key);
  expect(out.fields).toEqual([]);
  expect(out.edges[0].actions).toEqual([{ type: 'set_rsvp', value: 'confirmed' }]);
});

test('defaultFieldValue and fieldProblem', () => {
  const f = { key: 'k', label: 'הסעה', type: 'choice' as const, options: ['כן', 'לא'] };
  expect(defaultFieldValue(f, 'כן')).toBe('כן');
  expect(defaultFieldValue(f, 'ברור שאגיע!')).toBe('{answer}');
  expect(fieldProblem(f)).toBeNull();
  expect(fieldProblem({ ...f, options: ['כן'] })).toMatch('לפחות 2');
  expect(fieldProblem({ ...f, options: ['כן', 'כן'] })).toMatch('כפולה');
});

test('withGraphFields normalises backend fields and adds the flow fields', () => {
  const { graph } = addField(base(), { label: 'הסעה', type: 'choice', options: ['כן', 'לא'] });
  const meta = withGraphFields({ fields: [{ field: 'guest_count', label: 'כמות' }] as any, variables: [], stages: [] }, graph)!;
  expect(meta.fields).toEqual([{ value: 'guest_count', label: 'כמות' }, { value: 'custom:extra_1', label: 'הסעה (שדה נוסף)' }]);
});
