/**
 * Small design-v6 building blocks for the host platform (Platform v6 / Mobile
 * Flows). Plain elements + tokens, so they render identically to the design.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { color as C, chipTone, ChipTone } from '../../design/tokens';

export const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: `1.5px solid ${C.lineApp}`,
  borderRadius: 20,
  padding: 'clamp(18px,2.2vw,24px)',
  minWidth: 0,
};

export function Card({ children, style, hero, as = 'section', ...rest }: { children: React.ReactNode; style?: React.CSSProperties; hero?: boolean; as?: 'section' | 'div' } & React.HTMLAttributes<HTMLElement>) {
  const Tag = as as any;
  return (
    <Tag style={{ ...cardStyle, ...(hero ? { borderRadius: 22, boxShadow: '0 18px 44px rgba(22,21,15,.07)' } : null), ...style }} {...rest}>
      {children}
    </Tag>
  );
}

export const Kicker = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ fontSize: 12, letterSpacing: '.06em', color: C.purple, fontWeight: 500, ...style }}>{children}</div>
);

export const CardTitle = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: '8px 0 0', ...style }}>{children}</h3>
);

export const Ms = ({ children, size = 20, style }: { children: string; size?: number; style?: React.CSSProperties }) => (
  <span className="ms" aria-hidden="true" style={{ fontSize: size, ...style }}>{children}</span>
);

export function chipStyle(tone: ChipTone = 'quiet'): React.CSSProperties {
  const [bg, bc, fg] = chipTone[tone];
  return { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 26, padding: '0 10px', borderRadius: 9, border: `1.5px solid ${bc}`, background: bg, color: fg, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' };
}
export const Chip = ({ tone = 'quiet', children, style }: { tone?: ChipTone; children: React.ReactNode; style?: React.CSSProperties }) => (
  <span style={{ ...chipStyle(tone), ...style }}>{children}</span>
);

export const Dot = ({ color, size = 10 }: { color: string; size?: number }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flex: 'none' }} />
);

const btnBase: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, padding: '0 20px', borderRadius: 14, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' };
export const primaryBtn: React.CSSProperties = { ...btnBase, background: C.lav, color: C.ink, border: `1.5px solid ${C.lav}` };
export const ghostBtn: React.CSSProperties = { ...btnBase, background: '#FFFFFF', color: C.ink, border: `1.5px solid ${C.field}` };
export const smallPrimary: React.CSSProperties = { ...primaryBtn, minHeight: 40, padding: '0 14px', borderRadius: 12, fontSize: 14 };
export const smallGhost: React.CSSProperties = { ...ghostBtn, minHeight: 40, padding: '0 14px', borderRadius: 12, fontSize: 14 };

type BtnProps = { kind?: 'primary' | 'ghost' | 'smallPrimary' | 'smallGhost'; to?: string; style?: React.CSSProperties } & React.ButtonHTMLAttributes<HTMLButtonElement>;
export function Btn({ kind = 'primary', to, style, children, ...rest }: BtnProps) {
  const base = kind === 'primary' ? primaryBtn : kind === 'ghost' ? ghostBtn : kind === 'smallPrimary' ? smallPrimary : smallGhost;
  const cls = kind.toLowerCase().includes('primary') ? 'su-hover-lav' : 'su-hover-ink';
  if (to) return <Link to={to} className={cls} style={{ ...base, color: C.ink, ...style }}>{children}</Link>;
  return <button type="button" className={cls} style={{ ...base, ...(rest.disabled ? { opacity: 0.55, cursor: 'not-allowed' } : null), ...style }} {...rest}>{children}</button>;
}

/** Underlined text link in the design's style ("לתמונת המצב"). */
export const TextLink = ({ to, children, style }: { to: string; children: React.ReactNode; style?: React.CSSProperties }) => (
  <Link to={to} className="su-hover-underline" style={{ fontSize: 13.5, fontWeight: 600, color: C.purple, ...style }}>{children}</Link>
);

/** A gap-separated strip of figures (design "figures" row). */
export function FigureStrip({ items }: { items: { label: string; value: React.ReactNode; hint: string; color?: string }[] }) {
  return (
    <section style={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, background: C.lineApp, border: `1.5px solid ${C.lineApp}`, borderRadius: 20, overflow: 'hidden' }}>
      {items.map((f) => (
        <div key={f.label} style={{ flex: '1 1 150px', minWidth: 0, background: '#FFFFFF', padding: '16px 18px' }}>
          <div style={{ fontSize: 12, letterSpacing: '.05em', color: C.muted, fontWeight: 500 }}>{f.label}</div>
          <div className="num" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1, color: f.color || C.ink, margin: '10px 0 6px' }}>{f.value}</div>
          <div style={{ fontSize: 13, color: C.body, lineHeight: 1.5 }}>{f.hint}</div>
        </div>
      ))}
    </section>
  );
}

/** Honest empty state used where the design shows data the event doesn't have yet. */
export const EmptyNote = ({ icon = 'info', children }: { icon?: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 4px', color: C.body, fontSize: 14, lineHeight: 1.55 }}>
    <Ms size={19} style={{ color: C.purple }}>{icon}</Ms>
    <span>{children}</span>
  </div>
);

export const initialsOf = (name: string) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}״${parts[parts.length - 1][0]}`;
};

export const STATUS_TONE: Record<string, ChipTone> = { confirmed: 'ok', declined: 'err', maybe: 'warn', pending: 'warn' };
