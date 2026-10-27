/** Small form controls shared by the flow-builder panels (design v6 tokens). */
import React from 'react';
import { color as C, radius } from '../../design/tokens';
import { Ms } from '../v6/ui';

export const inputBase: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14, color: C.ink,
  background: '#FFFFFF', border: `1.5px solid ${C.field}`, borderRadius: radius.md, padding: '9px 11px',
  outline: 'none', lineHeight: 1.5,
};

export const selectBase: React.CSSProperties = { ...inputBase, paddingInlineEnd: 28, cursor: 'pointer' };

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 999, border: `1.5px solid ${checked ? C.purple : C.field}`,
        background: checked ? C.purple : C.paperWarm, position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        flex: 'none', padding: 0, opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, width: 19, height: 19, borderRadius: '50%', background: '#FFFFFF',
        insetInlineStart: checked ? 20 : 2, transition: 'inset-inline-start .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

export function Field({ label, hint, error, children, aside }: {
  label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; aside?: React.ReactNode;
}) {
  return (
    <div style={{ padding: '12px 0', borderTop: `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{label}</span>
        {aside}
      </div>
      {children}
      {hint && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

export const ErrorLine = ({ children }: { children: React.ReactNode }) => (
  <div role="alert" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', color: C.err, fontSize: 12.5, marginTop: 6, lineHeight: 1.45 }}>
    <Ms size={16} style={{ marginTop: 1 }}>error</Ms><span>{children}</span>
  </div>
);

export function IconBtn({ icon, label, onClick, disabled, tone = 'quiet', size = 32 }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean; tone?: 'quiet' | 'danger'; size?: number;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="su-hover-ink"
      style={{
        width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: 10, flex: 'none',
        border: `1.5px solid ${C.lineApp}`, background: '#FFFFFF', color: tone === 'danger' ? C.danger : C.body,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, padding: 0,
      }}
    >
      <Ms size={18}>{icon}</Ms>
    </button>
  );
}

export const Counter = ({ value, max }: { value: number; max: number }) => (
  <span className="num" style={{ fontSize: 11.5, color: value > max ? C.err : C.muted, fontWeight: 600, flex: 'none', minWidth: 36, textAlign: 'center' }}>
    {value}/{max}
  </span>
);

/** Insertable variable chip ("{guest_name}"). */
export const VarChip = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 9px', borderRadius: 8,
      border: `1.5px solid ${C.tintBorder}`, background: C.tintApp, color: C.purpleDark, fontSize: 12, fontWeight: 600,
      cursor: 'pointer', fontFamily: 'inherit',
    }}
  >
    <Ms size={14}>add</Ms>{label}
  </button>
);

export const PanelHeader = ({ kicker, title, onClose, children }: { kicker: string; title: string; onClose: () => void; children?: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: 10 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, letterSpacing: '.06em', color: C.purple, fontWeight: 500 }}>{kicker}</div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
    </div>
    {children}
    <IconBtn icon="close" label="סגירה" onClick={onClose} />
  </div>
);

/** Insert text at a textarea/input caret and return the new value. */
export function insertAtCaret(el: HTMLTextAreaElement | HTMLInputElement | null, value: string, insert: string): { next: string; caret: number } {
  if (!el) return { next: value + insert, caret: (value + insert).length };
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + insert + value.slice(end);
  return { next, caret: start + insert.length };
}

/** Textarea + "insert variable" chips ({guest_name} …) that insert at the caret. */
export function VarTextarea({ value, onChange, variables, rows = 4, placeholder, style, ariaLabel, chipsStyle }: {
  value: string; onChange: (v: string) => void; variables: { key: string; label: string }[];
  rows?: number; placeholder?: string; style?: React.CSSProperties; ariaLabel?: string; chipsStyle?: React.CSSProperties;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const insertVar = (key: string) => {
    const { next, caret } = insertAtCaret(ref.current, value || '', `{${key}}`);
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) { el.focus(); el.setSelectionRange(caret, caret); }
    });
  };
  return (
    <>
      <textarea ref={ref} rows={rows} style={{ ...inputBase, resize: 'vertical', ...style }} value={value}
        aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, ...chipsStyle }}>
        {variables.map((v) => <VarChip key={v.key} label={v.label} onClick={() => insertVar(v.key)} />)}
      </div>
    </>
  );
}
