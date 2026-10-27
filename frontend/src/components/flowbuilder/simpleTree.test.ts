/**
 * Pure logic of the simple flow editor (tree derivation, answer modes, subtree cloning).
 * The fixture is shared/domain/flow_graph.default_graph(). Set FLOW_DUMP_DIR to
 * write the transformed graphs out for the backend validator.
 */
import fs from 'fs';
import path from 'path';
import fixture from './__fixtures__/default_graph.json';
import { normalizeGraph } from './graph';
import type { FlowGraph } from './types';
import {
  addChoice, buildTree, cloneEntrySubtree, freshNodeId, modeSwitchCost, nodeRows, reachableFrom, removeChoice,
  setAnswerMode, unconnectedNodes, updateChoice, visibleEdges, syncNumberInput, type TreeBlock,
} from './simpleTree';
import { STAGES } from './labels';

const load = (): FlowGraph => normalizeGraph(JSON.parse(JSON.stringify(fixture)));
let n = 0;
const gen = () => `t_${(n += 1)}`;

function walk(b: TreeBlock | null, f: (b: TreeBlock) => void) {
  if (!b) return;
  f(b);
  b.rows.forEach((r) => { if (r.target.kind === 'nested') walk(r.target.block, f); });
}

const dump = (name: string, g: FlowGraph) => {
  const dir = process.env.FLOW_DUMP_DIR;
  if (dir) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(g));
};

describe('buildTree', () => {
  it('derives a finite tree per entry, each node once, the rest as links', () => {
    const g = load();
    STAGES.forEach((s) => {
      const t = buildTree(g, g.entry[s]);
      expect(t.root?.nodeId).toBe('rsvp_invite');
      expect(new Set(t.order).size).toBe(t.order.length); // rendered once
      expect(t.order.length).toBe(reachableFrom(g, [g.entry[s]]).size);
      const links: string[] = [];
      walk(t.root, (b) => b.rows.forEach((r) => { if (r.target.kind === 'link') links.push(r.target.nodeId); }));
      expect(links.length).toBeGreaterThan(0); // loops (didnt_understand ↔ invite) became back-links
      links.forEach((id) => expect(t.order).toContain(id));
    });
  });

  it('a shared node is nested once and later shown as a back-link', () => {
    const g = load();
    const t = buildTree(g, 'rsvp_invite');
    const seen: Record<string, { nested: number; link: number }> = {};
    walk(t.root, (b) => b.rows.forEach((r) => {
      const id = r.target.kind === 'nested' ? r.target.block.nodeId : r.target.kind === 'link' ? r.target.nodeId : null;
      if (!id) return;
      seen[id] = seen[id] || { nested: 0, link: 0 };
      seen[id][r.target.kind === 'nested' ? 'nested' : 'link'] += 1;
    }));
    // rsvp_count is reached from invite, decline, maybe, update…
    expect(seen.rsvp_count.nested).toBe(1);
    expect(seen.rsvp_count.link).toBeGreaterThan(0);
    Object.values(seen).forEach((v) => expect(v.nested).toBeLessThanOrEqual(1));
  });

  it('terminates on a self-loop-only graph and on a 2-cycle', () => {
    const g: FlowGraph = normalizeGraph({
      schema_version: 1, entry: { default: 'a' },
      nodes: [{ id: 'a', type: 'question', input: 'text' }, { id: 'b', type: 'question', input: 'text' }],
      edges: [
        { id: 'e1', from: 'a', to: 'a', when: { kind: 'any_text' } },
        { id: 'e2', from: 'a', to: 'b', when: { kind: 'text_contains', words: ['x'] } },
        { id: 'e3', from: 'b', to: 'a', when: { kind: 'any_text' } },
      ],
    });
    const t = buildTree(g, 'a');
    expect(t.order).toEqual(['a', 'b']);
  });
});

describe('answer modes on the default graph', () => {
  it('classifies nodes and hides typed RSVP twins of buttons', () => {
    const g = load();
    const node = (id: string) => g.nodes.find((x) => x.id === id)!;
    const invite = nodeRows(g, node('rsvp_invite'));
    expect(invite.templateChoices).toBe(true);
    expect(invite.mode).toBe('both'); // 3 template replies + "didn't understand" catch-all
    expect(invite.choices.map((c) => c.rsvp)).toEqual(['confirmed', 'declined', 'maybe']);
    expect(invite.choices.every((c) => c.edge)).toBe(true);
    expect(invite.text.map((e) => e.when.kind)).toEqual(['any_text']);

    expect(nodeRows(g, node('didnt_understand')).mode).toBe('text');
    expect(nodeRows(g, node('rsvp_count')).mode).toBe('text');
    expect(nodeRows(g, node('rsvp_count')).fixed.map((e) => e.when.kind)).toEqual(['done']);
    expect(nodeRows(g, node('question_answer')).mode).toBe('questions');

    const maybe = nodeRows(g, node('rsvp_maybe'));
    expect(maybe.mode).toBe('both');
    expect(maybe.choices).toHaveLength(2);
    expect(maybe.choices[0].linked.map((e) => e.when.kind)).toEqual(['rsvp']); // typed "מגיע" twin
    expect(maybe.text.map((e) => e.when.kind)).toEqual(['any_text']);
    // twins are not rendered as separate rows
    expect(visibleEdges(g, node('rsvp_maybe'))).toHaveLength(3);
  });

  it('every edge is either a visible row or a synced twin (nothing lost)', () => {
    const g = load();
    g.nodes.forEach((x) => {
      const r = nodeRows(g, x);
      const all = [...r.choices.flatMap((c) => [c.edge, ...c.linked]), ...r.text, ...r.fixed].filter(Boolean).map((e) => e!.id).sort();
      expect(all).toEqual(g.edges.filter((e) => e.from === x.id).map((e) => e.id).sort());
    });
  });

  it('choice edits keep twins in sync; add/remove choice adds/removes its row', () => {
    let g = load();
    g = updateChoice(g, 'rsvp_maybe', 'button:confirm', { to: 'rsvp_done' }, gen);
    const r = nodeRows(g, g.nodes.find((x) => x.id === 'rsvp_maybe')!);
    expect(r.choices[0].edge!.to).toBe('rsvp_done');
    expect(r.choices[0].linked[0].to).toBe('rsvp_done');

    g = addChoice(g, 'rsvp_maybe', 'b_new', gen(), null, 'אולי מחר');
    g = addChoice(g, 'rsvp_maybe', 'b_new2', gen(), null, 'עוד אחד');
    let node = g.nodes.find((x) => x.id === 'rsvp_maybe')!;
    expect(node.input).toBe('list'); // >3 choices
    expect(nodeRows(g, node).choices).toHaveLength(4);
    g = removeChoice(g, 'rsvp_maybe', 'b_new2');
    node = g.nodes.find((x) => x.id === 'rsvp_maybe')!;
    expect(node.input).toBe('buttons');
    expect(nodeRows(g, node).choices).toHaveLength(3);
    expect(g.edges.some((e) => e.when.kind === 'button' && e.when.button_id === 'b_new2')).toBe(false);
    dump('choices_edit', g);
  });

  it('mode switches map onto the schema', () => {
    let g = load();
    // didnt_understand: text → choices drops its 4 text rules, creates 2 choices with rules
    expect(modeSwitchCost(g, 'didnt_understand', 'choices').rules).toBe(4);
    g = setAnswerMode(g, 'didnt_understand', 'choices', gen, gen);
    let du = g.nodes.find((x) => x.id === 'didnt_understand')!;
    expect(du.input).toBe('buttons');
    expect(nodeRows(g, du).mode).toBe('choices');
    expect(nodeRows(g, du).choices.every((c) => c.edge)).toBe(true);
    // → both adds a catch-all
    g = setAnswerMode(g, 'didnt_understand', 'both', gen, gen);
    du = g.nodes.find((x) => x.id === 'didnt_understand')!;
    expect(nodeRows(g, du).mode).toBe('both');
    // → text removes buttons
    g = setAnswerMode(g, 'didnt_understand', 'text', gen, gen);
    du = g.nodes.find((x) => x.id === 'didnt_understand')!;
    expect(du.buttons).toHaveLength(0);
    expect(nodeRows(g, du).mode).toBe('text');
    // number rules force input=number
    g = { ...g, edges: g.edges.map((e) => (e.from === 'didnt_understand' && e.when.kind === 'any_text' ? { ...e, when: { kind: 'number' as const } } : e)) };
    g = syncNumberInput(g, 'didnt_understand');
    expect(g.nodes.find((x) => x.id === 'didnt_understand')!.input).toBe('number');
    // template cannot go text-only
    expect(setAnswerMode(g, 'rsvp_invite', 'text', gen, gen)).toBe(g);
    dump('mode_switch', g);
  });
});

describe('cloneEntrySubtree', () => {
  it('gives the stage fresh ids and leaves other entries untouched', () => {
    const g = load();
    const res = cloneEntrySubtree(g, 'reminder')!;
    expect(res).not.toBeNull();
    const out = res.graph;
    expect(out.entry.reminder).not.toBe('rsvp_invite');
    expect(out.entry.invitation).toBe('rsvp_invite');
    expect(out.entry.final_reminder).toBe('rsvp_invite');
    expect(out.entry.default).toBe('rsvp_invite');
    expect(out.nodes).toHaveLength(24);
    expect(out.edges).toHaveLength(94);
    const ids = out.nodes.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(out.edges.map((e) => e.id)).size).toBe(out.edges.length);
    Object.values(res.idMap).forEach((id) => expect(id).toMatch(/^[a-z][a-z0-9_]{0,63}$/));
    Object.values(res.idMap).forEach((id) => expect(id).not.toContain('__'));
    // original nodes/edges unchanged
    expect(out.nodes.slice(0, 12)).toEqual(g.nodes);
    expect(out.edges.slice(0, 47)).toEqual(g.edges);
    // the clone is closed: cloned edges only point at cloned nodes
    const cloned = new Set(Object.values(res.idMap));
    const tail = out.edges.slice(47);
    expect(tail.every((e) => cloned.has(e.from) && (e.to == null || cloned.has(e.to)))).toBe(true);
    // the reminder tree is now independent of the invitation tree
    const a = new Set(buildTree(out, out.entry.invitation).order);
    buildTree(out, out.entry.reminder).order.forEach((id) => expect(a.has(id)).toBe(false));
    expect(unconnectedNodes(out)).toHaveLength(0);
    dump('cloned_reminder', out);

    const twice = cloneEntrySubtree(out, 'final_reminder')!.graph;
    expect(twice.nodes).toHaveLength(36);
    dump('cloned_twice', twice);
  });

  it('freshNodeId avoids collisions and reserved patterns', () => {
    const taken = new Set(['rsvp_invite_rem']);
    expect(freshNodeId('rsvp_invite', 'rem', taken)).toBe('rsvp_invite_rem2');
    expect(freshNodeId('9x__y', 'rem', taken)).toMatch(/^n_9x_y_rem$/);
  });

  it('refuses past the node limit', () => {
    const g = load();
    let big = g;
    for (let i = 0; i < 7; i += 1) big = cloneEntrySubtree(big, 'reminder', 'rsvp_invite')!.graph; // 96 nodes
    expect(cloneEntrySubtree(big, 'final_reminder')).toBeNull();
  });
});

