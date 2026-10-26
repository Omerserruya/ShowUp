/** WhatsApp-like message bubble for template previews (RTL, sample values). */
import React from 'react';
import { color as C } from '../../design/tokens';
import { Ms } from '../v6/ui';
import type { TemplateDoc } from './api';

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function fillVars(text: string, values: Record<string, string>): string {
  return (text || '').replace(TOKEN, (m, name: string) => (name in values ? values[name] : m));
}

/** *bold* _italic_ ~strike~ - rendered as React nodes (never innerHTML). */
function formatWa(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const inner = m[0].slice(1, -1);
    const ch = m[0][0];
    out.push(ch === '*' ? <strong key={i++}>{inner}</strong> : ch === '_' ? <em key={i++}>{inner}</em> : <s key={i++}>{inner}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function WaBubble({ doc, values, imageUrl }: { doc: TemplateDoc; values: Record<string, string>; imageUrl?: string | null }) {
  const header = doc.header.type === 'text' ? fillVars(doc.header.text || '', values) : '';
  const body = fillVars(doc.body, values);
  const img = doc.header.type === 'image' ? (imageUrl || doc.header.url || '') : '';
  const empty = !doc.body.trim();
  return (
    <div dir="rtl" style={{ background: C.waChat, borderRadius: 18, padding: '18px 14px', minHeight: 220 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <div style={{
          background: '#FFFFFF', borderRadius: 12, borderStartStartRadius: 4, maxWidth: 320, width: '100%',
          boxShadow: '0 1px 1px rgba(0,0,0,.08)', overflow: 'hidden', color: C.waText,
        }}>
          {doc.header.type === 'image' && (
            <div style={{ background: C.waHeader, aspectRatio: '1.91 / 1', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
              {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Ms size={32} style={{ color: C.waMeta }}>image</Ms>}
            </div>
          )}
          <div style={{ padding: '8px 10px 6px' }}>
            {header && <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{header}</div>}
            <div style={{ fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: empty ? C.waMeta : C.waText }}>
              {empty ? 'כאן יופיע גוף ההודעה…' : formatWa(body)}
            </div>
            {doc.footer && <div style={{ fontSize: 12.5, color: C.waMeta, marginTop: 6 }}>{doc.footer}</div>}
            <div style={{ fontSize: 11, color: C.waMeta, textAlign: 'left', marginTop: 2 }} className="num">10:24</div>
          </div>
          {doc.buttons.map((b, i) => (
            <div key={i} style={{
              borderTop: `1px solid ${C.waHeader}`, padding: '9px 10px', textAlign: 'center', color: C.waLink,
              fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Ms size={16}>{b.type === 'URL' ? 'open_in_new' : 'reply'}</Ms>
              {b.text || <span style={{ color: C.waMeta }}>כפתור {i + 1}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
