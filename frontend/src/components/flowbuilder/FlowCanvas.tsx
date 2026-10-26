/**
 * ReactFlow canvas for the conversation graph. The graph (FlowGraph) is the
 * source of truth; nodes are mirrored locally only so dragging stays smooth and
 * positions are committed back on drag stop.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  BaseEdge,
  Connection,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  ReactFlowInstance,
  applyNodeChanges,
  getSmoothStepPath,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { color as C } from '../../design/tokens';
import { Ms } from '../v6/ui';
import type { FlowEdge, FlowGraph, Selection, Stage } from './types';
import { IssueIndex, TARGET_HANDLE, edgeLabel, estimateHeight, handleForWhen, portsFor } from './graph';
import { NODE_WIDTH, NodeCard, NodeCardData, StubNode } from './NodeCard';

interface CondEdgeData {
  label: string;
  actions: number;
  error: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

function CondEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<CondEdgeData>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 22 });
  const stroke = data?.error ? C.danger : data?.selected ? C.purple : C.lavMid;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke, strokeWidth: data?.selected ? 2.6 : 1.8 }} interactionWidth={18} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          dir="rtl"
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); data?.onSelect(id); }}
          onKeyDown={(e) => { if (e.key === 'Enter') data?.onSelect(id); }}
          style={{
            position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all',
            display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 220, padding: '3px 9px', borderRadius: 999,
            background: data?.error ? C.errBg : data?.selected ? C.tintApp : '#FFFFFF',
            border: `1.5px solid ${data?.error ? C.danger : data?.selected ? C.purple : C.tintBorder}`,
            fontSize: 11.5, fontWeight: 600, color: data?.error ? C.err : C.purpleDark, cursor: 'pointer',
            fontFamily: 'Heebo, "Noto Sans Hebrew", Arial, sans-serif', boxShadow: '0 1px 3px rgba(22,21,15,.06)',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data?.label}</span>
          {!!data?.actions && (
            <span title={`${data.actions} פעולות`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 2, height: 18, padding: '0 6px', borderRadius: 999,
              background: C.purple, color: '#FFFFFF', fontSize: 10.5, flex: 'none',
            }}>
              <Ms size={12}>bolt</Ms>{data.actions}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { card: NodeCard, stub: StubNode };
const edgeTypes = { cond: CondEdge };

export interface FlowCanvasProps {
  graph: FlowGraph;
  issues: IssueIndex;
  selection: Selection;
  simNodeId: string | null;
  fitKey: string;
  onSelect: (s: Selection) => void;
  onMoveNode: (id: string, pos: { x: number; y: number }) => void;
  onConnectHandles: (from: string, handle: string | null, to: string) => void;
  onConnectToEmpty: (from: string, handle: string | null, pos: { x: number; y: number }) => void;
  onDeleteNodes: (ids: string[]) => void;
  onDeleteEdges: (ids: string[]) => void;
  onInit?: (rf: ReactFlowInstance) => void;
}

const STUB = 'stub:';

export default function FlowCanvas(props: FlowCanvasProps) {
  const { graph, issues, selection, simNodeId, fitKey, onSelect, onMoveNode, onConnectHandles, onConnectToEmpty, onDeleteNodes, onDeleteEdges } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const connectRef = useRef<{ nodeId: string | null; handleId: string | null; connected: boolean }>({ nodeId: null, handleId: null, connected: false });

  const entriesByNode = useMemo(() => {
    const m: Record<string, Stage[]> = {};
    Object.entries(graph.entry || {}).forEach(([stage, id]) => { if (id) (m[id] = m[id] || []).push(stage as Stage); });
    return m;
  }, [graph.entry]);

  const built: Node[] = useMemo(() => {
    const out: Node[] = graph.nodes.map((n) => {
      const data: NodeCardData = {
        node: n,
        ports: portsFor(n, graph),
        entries: entriesByNode[n.id] || [],
        errors: issues.nodes[n.id] || [],
        simActive: simNodeId === n.id,
        connectedPorts: graph.edges.filter((e) => e.from === n.id).map((e) => handleForWhen(e.when)),
      };
      return {
        id: n.id, type: 'card', position: n.position || { x: 0, y: 0 }, data,
        selected: selection?.kind === 'node' && selection.id === n.id,
      };
    });
    // Terminal pills for edges that end the conversation.
    const perSource: Record<string, number> = {};
    graph.edges.filter((e) => !e.to).forEach((e) => {
      const src = graph.nodes.find((n) => n.id === e.from);
      if (!src) return;
      const i = (perSource[src.id] = (perSource[src.id] ?? -1) + 1);
      const p = src.position || { x: 0, y: 0 };
      out.push({
        id: `${STUB}${e.id}`, type: 'stub', draggable: false, connectable: false,
        position: { x: p.x - 150 - i * 20, y: p.y + estimateHeight(src, graph) + 40 + i * 44 },
        data: { error: !!issues.edges[e.id] },
        selected: selection?.kind === 'edge' && selection.id === e.id,
      });
    });
    return out;
  }, [graph, entriesByNode, issues, selection, simNodeId]);

  const [nodes, setNodes] = useNodesState([]);
  useEffect(() => {
    setNodes((prev) => built.map((n) => {
      const p = prev.find((x) => x.id === n.id);
      return p ? { ...n, width: p.width, height: p.height } : n;
    }));
  }, [built, setNodes]);

  const selectEdge = useCallback((id: string) => onSelect({ kind: 'edge', id }), [onSelect]);

  const edges: Edge[] = useMemo(() => graph.edges
    .filter((e) => graph.nodes.some((n) => n.id === e.from))
    .filter((e) => !e.to || graph.nodes.some((n) => n.id === e.to))
    .map((e: FlowEdge) => {
      const sel = selection?.kind === 'edge' && selection.id === e.id;
      const err = !!issues.edges[e.id];
      return {
        id: e.id, type: 'cond', source: e.from, sourceHandle: handleForWhen(e.when),
        target: e.to || `${STUB}${e.id}`, targetHandle: TARGET_HANDLE, selected: sel,
        markerEnd: { type: MarkerType.ArrowClosed, color: err ? C.danger : sel ? C.purple : C.lavMid, width: 16, height: 16 },
        data: { label: edgeLabel(e, graph), actions: e.actions.length, error: err, selected: sel, onSelect: selectEdge },
        zIndex: sel ? 10 : 0,
      };
    }), [graph, selection, issues, selectEdge]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const keep = changes.filter((c) => c.type !== 'select' && c.type !== 'remove');
    if (keep.length) setNodes((nds) => applyNodeChanges(keep, nds));
  }, [setNodes]);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (!node.id.startsWith(STUB)) onMoveNode(node.id, node.position);
  }, [onMoveNode]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id.startsWith(STUB)) onSelect({ kind: 'edge', id: node.id.slice(STUB.length) });
    else onSelect({ kind: 'node', id: node.id });
  }, [onSelect]);

  const onConnect = useCallback((c: Connection) => {
    connectRef.current.connected = true;
    if (!c.source || !c.target || c.target.startsWith(STUB)) return;
    onConnectHandles(c.source, c.sourceHandle, c.target);
  }, [onConnectHandles]);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const { nodeId, handleId, connected } = connectRef.current;
    connectRef.current = { nodeId: null, handleId: null, connected: false };
    if (connected || !nodeId) return;
    const target = event.target as HTMLElement | null;
    if (!target?.classList?.contains('react-flow__pane')) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
    const bounds = wrapRef.current?.getBoundingClientRect();
    if (!bounds || !rfRef.current) return;
    const pos = rfRef.current.project({ x: pt.clientX - bounds.left, y: pt.clientY - bounds.top });
    onConnectToEmpty(nodeId, handleId, { x: pos.x - NODE_WIDTH / 2, y: pos.y });
  }, [onConnectToEmpty]);

  useEffect(() => {
    const t = setTimeout(() => rfRef.current?.fitView({ padding: 0.2, maxZoom: 1 }), 80);
    return () => clearTimeout(t);
  }, [fitKey]);

  return (
    <div ref={wrapRef} dir="ltr" style={{ width: '100%', height: '100%', background: C.paperSoft }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={(_, e) => selectEdge(e.id)}
        onPaneClick={() => onSelect(null)}
        onConnect={onConnect}
        onConnectStart={(_, p) => { connectRef.current = { nodeId: p.nodeId, handleId: p.handleId, connected: false }; }}
        onConnectEnd={onConnectEnd}
        onNodesDelete={(ns) => onDeleteNodes(ns.filter((n) => !n.id.startsWith(STUB)).map((n) => n.id))}
        onEdgesDelete={(es) => onDeleteEdges(es.map((e) => e.id))}
        deleteKeyCode={['Delete']}
        onInit={(rf) => { rfRef.current = rf; props.onInit?.(rf); rf.fitView({ padding: 0.2, maxZoom: 1 }); }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{ stroke: C.purple, strokeWidth: 2 }}
      >
        <Background gap={22} size={1.4} color={C.line} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === 'stub' ? C.field : C.lav)}
          style={{ border: `1.5px solid ${C.lineApp}`, borderRadius: 12 }} />
      </ReactFlow>
    </div>
  );
}
