/**
 * Canvas node: a WhatsApp-like card. Every reply button is its own source
 * handle ("button → next node"); generic outcomes (number / text / rsvp / done)
 * get their own rows + handles under the bubble. Target handle sits on top.
 */
import React, { memo, useEffect } from 'react';
import { Handle, NodeProps, Position, useUpdateNodeInternals } from 'reactflow';
import { color as C, radius } from '../../design/tokens';
import { Ms, chipStyle } from '../v6/ui';
import type { FlowNode, Stage } from './types';
import type { Port } from './graph';
import { TARGET_HANDLE } from './graph';
import { NODE_TYPE_ICON, NODE_TYPE_LABEL, NODE_TYPE_TONE, STAGE_LABEL } from './labels';

export interface NodeCardData {
  node: FlowNode;
  ports: Port[];
  entries: Stage[];
  errors: string[];
  simActive: boolean;
  connectedPorts: string[];
}

export const NODE_WIDTH = 280;

const handleStyle = (connected: boolean): React.CSSProperties => ({
  width: 12, height: 12, borderRadius: '50%', left: -7,
  background: connected ? C.purple : '#FFFFFF', border: `2px solid ${C.purple}`,
});

const preview = (text: string) => {
  const t = (text || '').trim();
  return t.length > 150 ? `${t.slice(0, 150)}…` : t;
};

function NodeCardImpl({ id, data, selected }: NodeProps<NodeCardData>) {
  const { node, ports, entries, errors, simActive, connectedPorts } = data;
  // Handle positions are cached by ReactFlow; refresh them when ports change.
  const updateInternals = useUpdateNodeInternals();
  const portsKey = ports.map((p) => p.id).join('|') + (node.guest_questions ? '+q' : '') + errors.length;
  useEffect(() => { updateInternals(id); }, [id, portsKey, updateInternals]);
  const hasErr = errors.length > 0;
  const border = hasErr ? C.danger : selected ? C.purple : simActive ? C.waGreen : C.lineApp;
  const buttonPorts = ports.filter((p) => p.kind === 'button');
  const genericPorts = ports.filter((p) => p.kind === 'generic');

  return (
    <div
      dir="rtl"
      style={{
        width: NODE_WIDTH, background: '#FFFFFF', borderRadius: radius.lg, border: `2px solid ${border}`,
        boxShadow: selected ? '0 14px 34px rgba(90,61,166,.16)' : simActive ? '0 0 0 4px rgba(37,211,102,.18)' : '0 2px 8px rgba(22,21,15,.06)',
        fontFamily: 'inherit', color: C.ink, position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Top} id={TARGET_HANDLE}
        style={{ width: 14, height: 14, top: -8, background: '#FFFFFF', border: `2px solid ${C.lavMid}` }} />

      {!!entries.length && (
        <div style={{ position: 'absolute', top: -30, insetInlineStart: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {entries.map((s) => (
            <span key={s} style={{ ...chipStyle('ok'), height: 22, fontSize: 11.5, gap: 3 }}>
              <Ms size={13}>play_arrow</Ms>התחלה: {STAGE_LABEL[s] || s}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px' }}>
        <span style={{ ...chipStyle(NODE_TYPE_TONE[node.type] || 'quiet'), height: 24, gap: 4, fontSize: 11.5 }}>
          <Ms size={14}>{NODE_TYPE_ICON[node.type] || 'chat'}</Ms>{NODE_TYPE_LABEL[node.type] || node.type}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.title || 'ללא כותרת'}
        </span>
        {hasErr && <Ms size={18} style={{ color: C.danger }}>error</Ms>}
      </div>

      <div style={{ background: C.waChat, margin: '0 8px', borderRadius: 12, padding: 8 }}>
        <div style={{
          background: '#FFFFFF', color: C.waText, fontSize: 12.5, lineHeight: 1.5, padding: '7px 9px', borderRadius: 9,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', minHeight: 20,
        }}>
          {preview(node.text) || <span style={{ color: C.placeholder }}>אין טקסט עדיין</span>}
          {node.input === 'number' && (
            <div style={{ fontSize: 11.5, color: C.waMeta, marginTop: 4 }}>
              מחכה למספר{node.number && (node.number.min != null || node.number.max != null) ? ` (${node.number.min ?? '…'}-${node.number.max ?? '…'})` : ''}
            </div>
          )}
          {node.input === 'text' && <div style={{ fontSize: 11.5, color: C.waMeta, marginTop: 4 }}>מחכה לתשובה בטקסט</div>}
          {node.input === 'list' && <div style={{ fontSize: 11.5, color: C.waLink, marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}><Ms size={14}>list</Ms>רשימת בחירה</div>}
        </div>
        {buttonPorts.map((p) => (
          <div key={p.id} style={{
            position: 'relative', marginTop: 3, background: '#FFFFFF', color: p.label === 'כפתור שנמחק' ? C.danger : C.waLink,
            fontSize: 12.5, fontWeight: 500, textAlign: 'center', padding: '6px 10px', borderRadius: 9,
            boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {p.label}
            <Handle type="source" position={Position.Left} id={p.id} style={handleStyle(connectedPorts.includes(p.id))} />
          </div>
        ))}
      </div>

      {node.guest_questions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.purpleDark, padding: '7px 12px 0' }}>
          <Ms size={15}>quiz</Ms>שואלים את שאלות המארח
        </div>
      )}

      <div style={{ padding: '6px 0 8px' }}>
        {genericPorts.map((p) => (
          <div key={p.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, color: C.body }}>
            <Ms size={14} style={{ color: C.muted }}>subdirectory_arrow_left</Ms>
            {p.label}
            <Handle type="source" position={Position.Left} id={p.id} style={handleStyle(connectedPorts.includes(p.id))} />
          </div>
        ))}
        {!ports.length && (
          <div style={{ padding: '4px 12px', fontSize: 12, color: C.muted }}>
            {node.type === 'end' ? 'כאן השיחה מסתיימת' : 'אין יציאות - בחרו סוג תשובה בפאנל'}
          </div>
        )}
      </div>

      {hasErr && (
        <div style={{ borderTop: `1px solid ${C.errBorder}`, background: C.errBg, color: C.err, fontSize: 11.5, padding: '6px 12px', borderRadius: `0 0 ${radius.lg - 2}px ${radius.lg - 2}px`, lineHeight: 1.45 }}>
          {errors.slice(0, 2).map((m, i) => <div key={i}>{m}</div>)}
          {errors.length > 2 && <div>ועוד {errors.length - 2}…</div>}
        </div>
      )}
    </div>
  );
}

export const NodeCard = memo(NodeCardImpl);

/** Small terminal pill for edges whose `to` is null (conversation ends there). */
function StubNodeImpl({ data, selected }: NodeProps<{ error: boolean }>) {
  return (
    <div dir="rtl" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 12px', borderRadius: 999,
      background: C.paperWarm, border: `1.5px solid ${data.error ? C.danger : selected ? C.purple : C.field}`,
      fontSize: 12, color: C.body, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <Handle type="target" position={Position.Top} id={TARGET_HANDLE} isConnectable={false}
        style={{ opacity: 0, width: 6, height: 6, top: -2 }} />
      <Ms size={14}>stop_circle</Ms>סוף השיחה
    </div>
  );
}

export const StubNode = memo(StubNodeImpl);
