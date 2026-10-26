/**
 * Conversation simulator: walks the CURRENT (unsaved) graph through
 * /simulate. Guest taps a button or types text; the server replays all inputs
 * and returns the transcript plus the actions that would have run.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Btn, Ms } from '../v6/ui';
import type { FlowButton, FlowGraph, FlowMeta, SimInput, SimResult, SimTurn } from './types';
import { flowApi, errMsg, FlowApiError } from './api';
import { EVENT_TYPES, actionSummary, simActionLabel } from './labels';
import { cleanGraph } from './graph';
import { PanelHeader, inputBase, selectBase } from './controls';

interface Props {
  graph: FlowGraph;
  meta: FlowMeta | null;
  onActiveNode: (id: string | null) => void;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

function waFormat(text: string): React.ReactNode[] {
  return (text || '').split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2
      ? <strong key={i}>{part.slice(1, -1)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>);
}

const asButton = (b: FlowButton | string, turn: SimTurn, graph: FlowGraph): FlowButton => {
  if (typeof b !== 'string') return b;
  const node = graph.nodes.find((n) => n.id === turn.node_id);
  return node?.buttons.find((x) => x.label === b) || { id: b, label: b };
};

function detailText(a: { type: string; detail?: unknown }, meta: FlowMeta | null): string {
  const d = a.detail as any;
  if (d == null) return '';
  if (typeof d === 'string' || typeof d === 'number') return String(d);
  if (typeof d === 'object' && d.type) {
    try { return actionSummary(d, meta); } catch { /* fall through */ }
  }
  if (typeof d === 'object') {
    return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
  }
  return '';
}

export default function Simulator({ graph, meta, onActiveNode, onSelectNode, onClose }: Props) {
  const [eventType, setEventType] = useState('wedding');
  const [inputs, setInputs] = useState<SimInput[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const graphKey = useMemo(() => JSON.stringify(cleanGraph(graph)), [graph]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await flowApi.simulate(JSON.parse(graphKey), eventType, inputs);
        if (!alive) return;
        setResult({ turns: r.turns || [], actions: r.actions || [], ended: !!r.ended });
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof FlowApiError && e.unavailable ? 'הסימולטור עדיין לא זמין בשרת. אפשר להמשיך לערוך ולנסות שוב אחר כך.' : errMsg(e, 'הסימולציה נכשלה'));
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [graphKey, eventType, inputs]);

  const turns = result?.turns || [];
  const lastBot = [...turns].reverse().find((t) => t.from === 'bot');
  const lastIsBot = turns.length > 0 && turns[turns.length - 1].from === 'bot';

  useEffect(() => { onActiveNode(lastBot?.node_id || null); }, [lastBot?.node_id, onActiveNode]);
  useEffect(() => () => onActiveNode(null), [onActiveNode]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [turns.length]);

  const sendText = () => {
    const v = text.trim();
    if (!v) return;
    setInputs((p) => [...p, { kind: 'text', text: v }]);
    setText('');
  };

  const ended = !!result?.ended;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PanelHeader kicker="ניסיון שיחה" title="סימולטור" onClose={onClose} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <select style={{ ...selectBase, flex: 1 }} value={eventType} onChange={(e) => { setEventType(e.target.value); setInputs([]); }} aria-label="סוג אירוע">
          {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Btn kind="smallGhost" onClick={() => setInputs((p) => p.slice(0, -1))} disabled={!inputs.length} title="ביטול הצעד האחרון">
          <Ms size={18}>undo</Ms>
        </Btn>
        <Btn kind="smallGhost" onClick={() => setInputs([])} disabled={!inputs.length}><Ms size={18}>restart_alt</Ms>מההתחלה</Btn>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>הסימולציה רצה על הגרסה שעל המסך, כולל שינויים שלא נשמרו. שום הודעה לא נשלחת.</div>

      <div style={{ borderRadius: radius.xl, overflow: 'hidden', border: `1.5px solid ${C.lineApp}`, background: C.waChat, display: 'flex', flexDirection: 'column', minHeight: 260, flex: '1 1 auto' }}>
        <div style={{ background: C.waHeader, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: `1px solid ${C.lineApp}` }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: C.waGreen, color: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
            <Ms size={17}>celebration</Ms>
          </span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.waText }}>ShowUp</div>
            <div style={{ fontSize: 11, color: C.waMeta }}>{loading ? 'מקליד/ה…' : ended ? 'השיחה הסתיימה' : 'מחכה לתשובה'}</div>
          </div>
        </div>
        <div ref={scrollRef} style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto', flex: 1, maxHeight: 420, opacity: loading ? 0.65 : 1 }}>
          {error && (
            <div style={{ background: '#FFFFFF', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: C.body, display: 'flex', gap: 6 }}>
              <Ms size={17} style={{ color: C.purple }}>info</Ms>{error}
            </div>
          )}
          {!error && !turns.length && !loading && <div style={{ fontSize: 13, color: C.waMeta, textAlign: 'center', padding: 20 }}>אין הודעת פתיחה. סמנו צומת כנקודת התחלה.</div>}
          {turns.map((t, i) => {
            const isLastBot = t === lastBot && lastIsBot && !ended;
            return (
              <div key={i} style={{ alignSelf: t.from === 'bot' ? 'flex-start' : 'flex-end', maxWidth: '88%' }}>
                <div
                  onClick={() => t.node_id && onSelectNode(t.node_id)}
                  title={t.node_id ? 'הצגת הצומת בקנבס' : undefined}
                  style={{
                    background: t.from === 'bot' ? '#FFFFFF' : C.waOut, color: C.waText, fontSize: 13, lineHeight: 1.5,
                    padding: '6px 9px', borderRadius: 9, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', cursor: t.node_id ? 'pointer' : 'default',
                  }}>
                  {waFormat(t.text)}
                </div>
                {!!t.buttons?.length && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3 }}>
                    {t.buttons.map((raw, j) => {
                      const b = asButton(raw, t, graph);
                      return (
                        <button key={`${b.id}-${j}`} type="button" disabled={!isLastBot || loading}
                          onClick={() => setInputs((p) => [...p, { kind: 'button', button_id: b.id }])}
                          style={{
                            background: '#FFFFFF', color: C.waLink, fontSize: 13, fontWeight: 500, textAlign: 'center', padding: '6px 10px',
                            borderRadius: 9, border: 0, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', fontFamily: 'inherit',
                            cursor: isLastBot ? 'pointer' : 'default', opacity: isLastBot ? 1 : 0.6,
                          }}>
                          {b.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, padding: 8, background: C.waHeader, borderTop: `1px solid ${C.lineApp}` }}>
          <input style={{ ...inputBase, borderRadius: 999 }} value={text} disabled={ended || !!error}
            placeholder={ended ? 'השיחה הסתיימה' : 'כתבו תשובה כאורח…'}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendText(); }} />
          <button type="button" onClick={sendText} disabled={ended || !text.trim()} aria-label="שליחה"
            style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: C.waGreen, color: '#FFFFFF', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none', opacity: ended || !text.trim() ? 0.5 : 1 }}>
            <Ms size={19} style={{ transform: 'scaleX(-1)' }}>send</Ms>
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>פעולות שהיו מתבצעות</div>
        {!result?.actions?.length && <div style={{ fontSize: 13, color: C.muted }}>עדיין אין פעולות.</div>}
        <ol style={{ margin: 0, paddingInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(result?.actions || []).map((a, i) => {
            const d = detailText(a, meta);
            return (
              <li key={i} style={{ fontSize: 13, color: C.body, lineHeight: 1.5 }}>
                <strong style={{ color: C.ink }}>{simActionLabel(a.type)}</strong>{d ? ` - ${d}` : ''}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
