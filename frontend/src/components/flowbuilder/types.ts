/**
 * Flow-graph types (guest WhatsApp conversation as a graph).
 * Mirrors the backend contract of /api/admin/flow-graph/*.
 */

export type NodeType = 'template' | 'message' | 'question' | 'end';
export type InputType = 'buttons' | 'list' | 'number' | 'text' | 'none';
export type Stage = 'invitation' | 'reminder' | 'final_reminder' | 'default';
export type RsvpValue = 'confirmed' | 'declined' | 'maybe';

export interface FlowButton {
  id: string;
  label: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  title: string;
  text: string;
  input: InputType;
  buttons: FlowButton[];
  number?: { min?: number | null; max?: number | null } | null;
  guest_questions?: boolean;
  position?: { x: number; y: number } | null;
}

export type EdgeWhen =
  | { kind: 'button'; button_id: string }
  | { kind: 'rsvp'; value: RsvpValue | string }
  | { kind: 'number' }
  | { kind: 'number_invalid' }
  | { kind: 'text_contains'; words: string[] }
  | { kind: 'any_text' }
  | { kind: 'done' };

export type EdgeKind = EdgeWhen['kind'];

export type FlowAction =
  | { type: 'set_rsvp'; value: RsvpValue | string }
  | { type: 'set_field'; field: string; value: string }
  | { type: 'add_tag'; tag: string }
  | { type: 'notify_host'; text: string }
  | { type: 'stop_reminders' };

export type ActionType = FlowAction['type'];

export interface FlowEdge {
  id: string;
  from: string;
  to: string | null;
  when: EdgeWhen;
  actions: FlowAction[];
  priority?: number;
}

export interface FlowGraph {
  schema_version: number;
  entry: Partial<Record<Stage, string>>;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type Scope = 'global' | 'event_type' | 'event';

export interface ScopeRow {
  scope: Scope;
  key: string;
  label: string;
  enabled: boolean;
  version: number | null;
  is_default: boolean;
}

export interface ScopeGraph {
  graph: FlowGraph;
  version: number | null;
  enabled: boolean;
  is_default: boolean;
  inherited_from?: { scope: string; key: string; label?: string } | string | null;
}

export interface VersionRow {
  version: number;
  created_at: string | null;
  created_by_name: string | null;
  note: string | null;
  is_active: boolean;
}

export interface GraphIssue {
  path?: string;
  node_id?: string;
  edge_id?: string;
  message: string;
}

export interface MetaField {
  value: string;
  label: string;
}

export interface FlowMeta {
  fields: MetaField[];
  custom?: unknown;
  variables: { key: string; label: string }[];
  stages: string[];
  node_types?: unknown;
  edge_kinds?: unknown;
}

export type SimInput = { kind: 'button'; button_id: string } | { kind: 'text'; text: string };

export interface SimTurn {
  from: 'bot' | 'guest';
  text: string;
  buttons?: (FlowButton | string)[];
  node_id?: string | null;
}

export interface SimAction {
  node_id?: string | null;
  edge_id?: string | null;
  type: string;
  detail?: unknown;
}

export interface SimResult {
  turns: SimTurn[];
  actions: SimAction[];
  ended: boolean;
}

/** Selection on the canvas. */
export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;
