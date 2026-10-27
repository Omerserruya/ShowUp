/** Render smoke test of the simple editor over the real default graph (jsdom). */
/* eslint-disable testing-library/no-node-access -- block DOM ids are the editor's jump/scroll contract */
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import fixture from './__fixtures__/default_graph.json';
import SimpleFlowEditor from './SimpleFlowEditor';
import { indexIssues, normalizeGraph } from './graph';
import type { FlowGraph } from './types';

jest.mock('react-router-dom', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }), { virtual: true });

let latest: FlowGraph;
function Harness() {
  const [g, setG] = useState<FlowGraph>(() => normalizeGraph(JSON.parse(JSON.stringify(fixture))));
  latest = g;
  const empty = indexIssues([], g);
  return (
    <SimpleFlowEditor graph={g} meta={null} errors={empty} warns={empty} simNodeId={null} focus={null}
      setGraph={(fn) => setG((x) => fn(x))} onDeleteNodes={() => undefined} onDeleteEdges={() => undefined} />
  );
}

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => { try { window.localStorage.clear(); } catch { /* */ } });

it('renders every category, nests sub-logic and back-links without looping', () => {
  render(<Harness />);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  // all 12 messages rendered once in the invitation tab
  expect(document.querySelectorAll('.sfe-block')).toHaveLength(12);
  expect(screen.getAllByText(/חוזר להודעה/).length).toBeGreaterThan(0);
  expect(screen.getByText(/משותף גם ל/)).toBeTruthy();
  // template choices are presented as the template's buttons
  expect(screen.getAllByText('ברור שאגיע!').length).toBeGreaterThan(0);
  // three answer-mode controls on a message header
  const seg = screen.getAllByRole('radiogroup', { name: 'איך האורח עונה' })[0];
  expect(within(seg).getAllByRole('radio').map((b) => b.textContent)).toEqual(['בחירות', 'טקסט חופשי', 'גם וגם']);
});

it('adding a choice adds a row; splitting a category clones its messages', () => {
  render(<Harness />);
  const before = latest.edges.length;
  const maybeBlock = document.getElementById('sfe-invitation-rsvp_maybe') as HTMLElement;
  fireEvent.click(within(maybeBlock).getAllByText('הוספת בחירה')[0]);
  expect(latest.edges.length).toBe(before + 1);
  expect(latest.nodes.find((n) => n.id === 'rsvp_maybe')!.buttons).toHaveLength(3);

  fireEvent.click(screen.getByRole('tab', { name: /^תזכורת\s*\d*$/ }));
  fireEvent.click(screen.getByText('פיצול לקטגוריה נפרדת'));
  fireEvent.click(screen.getByText('כן, לפצל'));
  expect(latest.nodes).toHaveLength(24);
  expect(latest.entry.reminder).toBe('rsvp_invite_rem');
  expect(latest.entry.invitation).toBe('rsvp_invite');
});

it('picking "+ הודעה חדשה" creates a message and nests it under the row', () => {
  render(<Harness />);
  const invite = document.getElementById('sfe-invitation-rsvp_invite') as HTMLElement;
  const firstTarget = within(invite).getAllByLabelText('מה שולחים')[0] as HTMLSelectElement;
  fireEvent.change(firstTarget, { target: { value: '__new_message__' } });
  const created = latest.nodes[latest.nodes.length - 1];
  expect(created.type).toBe('message');
  expect(latest.edges.find((e) => e.from === 'rsvp_invite' && e.when.kind === 'rsvp' && (e.when as any).value === 'confirmed')!.to).toBe(created.id);
  expect(document.getElementById(`sfe-invitation-${created.id}`)).toBeTruthy();
});
