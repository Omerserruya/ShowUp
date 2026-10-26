/**
 * The template as its JSON document - read-only for catalog/system templates,
 * editable (apply-to-draft) for admin-authored ones.
 */
import React, { useEffect, useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Btn, Ms } from '../v6/ui';

interface Props {
  value: unknown;
  /** When given, the JSON is editable and "החלה" parses it into the draft. */
  onApply?: (obj: Record<string, unknown>) => void;
}

const pretty = (v: unknown) => JSON.stringify(v ?? null, null, 2);

export default function JsonPanel({ value, onApply }: Props) {
  const [text, setText] = useState(pretty(value));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setText(pretty(value)); setError(null); }, [value]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const apply = () => {
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { setError('צריך אובייקט JSON אחד (בין סוגריים מסולסלים)'); return; }
      setError(null);
      onApply?.(obj as Record<string, unknown>);
    } catch (e) {
      setError(`JSON לא תקין: ${(e as Error).message}`);
    }
  };

  const box: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', minHeight: 260, maxHeight: 520, overflow: 'auto', margin: 0,
    fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.55, direction: 'ltr', textAlign: 'left',
    background: C.paperSoft, border: `1px solid ${error ? C.errBorder : C.line2}`, borderRadius: radius.md,
    padding: 12, color: C.ink, whiteSpace: 'pre', resize: 'vertical',
  };

  return (
    <div>
      {onApply
        ? <textarea aria-label="JSON של התבנית" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} style={box} />
        : <pre style={box}>{text}</pre>}
      {error && <div style={{ color: C.err, fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {onApply && (
          <Btn kind="smallPrimary" disabled={text === pretty(value)} onClick={apply}>
            <Ms size={18}>check</Ms>החלה על הטיוטה
          </Btn>
        )}
        <Btn kind="smallGhost" onClick={copy}><Ms size={18}>{copied ? 'done' : 'content_copy'}</Ms>{copied ? 'הועתק' : 'העתקה'}</Btn>
        {onApply && text !== pretty(value) && (
          <Btn kind="smallGhost" onClick={() => { setText(pretty(value)); setError(null); }}>ביטול שינויים</Btn>
        )}
      </div>
    </div>
  );
}
