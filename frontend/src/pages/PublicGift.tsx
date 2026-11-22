import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { resolveTheme } from '../components/invitation/theme';
import { ensureThemeFonts } from '../utils/fonts';

/**
 * Public gift page. Route: /g/:code (no auth - the code comes in the hosts' own
 * WhatsApp messages). Dressed in the hosts' invitation design (palette, fonts,
 * cover photo, display names) so it feels like part of the invitation.
 *
 * One way to give (a single link, no Bit phone) -> the guest is sent straight
 * to it; several -> one button each (credit card / Bit / PayBox) plus the Bit
 * phone to copy. The money never passes through ShowUp.
 * Backend: core-service app/routers/public_gift.py.
 */

type GiftData = {
  available: boolean;
  hosts: string;
  event_type: string | null;
  options?: Array<{ kind: 'card' | 'bit' | 'paybox'; url: string }>;
  bit_phone?: string | null;
  design?: {
    theme?: Record<string, string>;
    image_url?: string | null;
    names?: string | null;
    event_date?: string | null;
  };
};

const LINK_LABEL: Record<string, string> = { card: 'מתנה בכרטיס אשראי', bit: 'מתנה בביט', paybox: 'מתנה בפייבוקס' };
const LINK_ICON: Record<string, string> = { card: 'credit_card', bit: 'account_balance_wallet', paybox: 'account_balance_wallet' };

/** Readable text colour on a solid background (accent buttons vary per invitation). */
function onColor(hex: string, dark: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return dark;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#16150F' : '#ffffff';
}

function eventDateLabel(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
  } catch { return ''; }
}

function Names({ text, font, amp, size }: { text: string; font: string; amp: string; size: string }) {
  const parts = text.split(/\s*&\s*/);
  const base: React.CSSProperties = { fontFamily: font, fontSize: size, fontWeight: 500, lineHeight: 1.1, margin: 0, textWrap: 'balance' as any };
  if (parts.length !== 2) return <h1 style={base}>{text}</h1>;
  return (
    <h1 style={base}>
      {parts[0]} <span style={{ color: amp, fontStyle: 'italic' }}>&amp;</span> {parts[1]}
    </h1>
  );
}

export default function PublicGift() {
  const { code = '' } = useParams<{ code: string }>();
  const [data, setData] = useState<GiftData | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = 'מתנה';
    fetch(`/api/public/gift/${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, [code]);

  const t = useMemo(() => resolveTheme((data?.design?.theme || null) as any), [data]);
  useEffect(() => { ensureThemeFonts(t.titleFont, t.bodyFont); }, [t.titleFont, t.bodyFont]);

  const options = data?.options || [];
  // Exactly one way to give -> straight there (the page is only a hop).
  const direct = data?.available && options.length === 1 && !data.bit_phone ? options[0].url : null;
  useEffect(() => {
    if (direct) window.location.replace(direct);
  }, [direct]);

  useEffect(() => {
    if (data) document.title = data.hosts ? `מתנה ל${data.hosts}` : 'מתנה';
  }, [data]);

  const copy = async () => {
    const digits = (data?.bit_phone || '').replace(/\D/g, '');
    try { await navigator.clipboard.writeText(digits); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* number stays selectable */ }
  };

  const page: React.CSSProperties = {
    minHeight: '100vh', background: t.bg, color: t.ink, fontFamily: t.bodyFont,
    display: 'flex', flexDirection: 'column',
  };

  if (failed || !data) {
    return (
      <div dir="rtl" style={{ ...page, alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 16, color: t.muted }}>{failed ? 'הקישור לא נמצא.' : 'רגע...'}</p>
      </div>
    );
  }

  const d = data.design || {};
  const names = (d.names || data.hosts || '').trim();
  const date = eventDateLabel(d.event_date);
  const accentOn = onColor(t.accent, t.ink);
  const kicker: React.CSSProperties = { fontSize: 13, letterSpacing: '0.28em', textTransform: 'uppercase', fontWeight: 600 };

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 56, borderRadius: 14,
    fontSize: 17, fontWeight: 600, textDecoration: 'none', fontFamily: t.bodyFont, cursor: 'pointer', width: '100%',
    boxSizing: 'border-box', padding: '0 18px',
  };
  const primary: React.CSSProperties = { ...btn, background: t.accent, color: accentOn, border: `1px solid ${t.accent}` };
  const secondary: React.CSSProperties = { ...btn, background: 'transparent', color: t.ink, border: `1px solid ${t.line}` };

  const hero = d.image_url ? (
    <header style={{ position: 'relative', minHeight: '44vh', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
      <img src={d.image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,8,14,0.15), rgba(6,8,14,0.55) 60%, rgba(6,8,14,0.78))' }} />
      <div style={{ position: 'relative', textAlign: 'center', color: t.onImage, padding: '0 20px 34px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ ...kicker, opacity: 0.85 }}>מתנה</span>
        {names && <Names text={names} font={t.titleFont} amp={t.onImage} size="clamp(38px, 11vw, 60px)" />}
        {date && <span style={{ fontSize: 15, letterSpacing: '0.12em', opacity: 0.9 }}>{date}</span>}
      </div>
    </header>
  ) : (
    <header style={{ textAlign: 'center', padding: '64px 20px 8px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <span style={{ ...kicker, color: t.accentText }}>מתנה</span>
      {names && <Names text={names} font={t.titleFont} amp={t.accent} size="clamp(40px, 12vw, 64px)" />}
      {date && <span style={{ fontSize: 15, letterSpacing: '0.12em', color: t.muted }}>{date}</span>}
      <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6, color: t.accent }}>
        <span style={{ width: 56, height: 1, background: t.line }} />♥<span style={{ width: 56, height: 1, background: t.line }} />
      </div>
    </header>
  );

  let body: React.ReactNode;
  if (!data.available) {
    body = <p style={{ fontSize: 16, color: t.muted, margin: 0, lineHeight: 1.7, textAlign: 'center' }}>פרטי המתנה כבר לא זמינים כאן. אפשר לפנות ישירות לבעלי האירוע.</p>;
  } else if (direct) {
    body = (
      <>
        <p style={{ fontSize: 16, color: t.muted, margin: 0, textAlign: 'center' }}>מעבירים אתכם להעברת המתנה...</p>
        <a href={direct} rel="noopener noreferrer" style={primary}>
          <span className="ms" aria-hidden style={{ fontSize: 22 }}>{LINK_ICON[options[0].kind] || 'redeem'}</span>
          {LINK_LABEL[options[0].kind] || 'מעבר להעברת המתנה'}
        </a>
      </>
    );
  } else {
    body = (
      <>
        <p style={{ fontSize: 17, color: t.ink, margin: 0, lineHeight: 1.7, textAlign: 'center' }}>
          בחרו איך נוח לכם להעביר את המתנה:
        </p>
        {options.map((o, i) => (
          <a key={o.kind} href={o.url} rel="noopener noreferrer" style={i === 0 ? primary : secondary}>
            <span className="ms" aria-hidden style={{ fontSize: 22 }}>{LINK_ICON[o.kind] || 'redeem'}</span>
            {LINK_LABEL[o.kind] || 'מעבר להעברת המתנה'}
          </a>
        ))}
        {data.bit_phone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 16, border: `1px solid ${t.line}`, textAlign: 'center' }}>
            <span style={{ fontSize: 14, color: t.muted }}>{options.length ? 'או העברה בביט למספר' : 'העברה בביט למספר'}</span>
            <span dir="ltr" style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1, userSelect: 'all', fontVariantNumeric: 'tabular-nums' }}>{data.bit_phone}</span>
            <button type="button" onClick={copy} style={{ ...(options.length ? secondary : primary), minHeight: 46, fontSize: 15 }}>
              {copied ? 'הועתק ✓' : 'העתקת המספר'}
            </button>
          </div>
        )}
        <p style={{ fontSize: 13.5, color: t.muted, margin: 0, lineHeight: 1.6, textAlign: 'center' }}>
          הכסף עובר ישירות לבעלי האירוע. ShowUp לא גובה עמלה ולא רואה את הסכום.
        </p>
      </>
    );
  }

  return (
    <div dir="rtl" style={page}>
      {hero}
      <main style={{ width: '100%', maxWidth: 440, margin: '0 auto', padding: '32px 20px 40px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        {body}
      </main>
      <a href="https://showup-rsvp.com/?utm_source=gift&utm_medium=footer" target="_blank" rel="noopener"
        style={{ display: 'block', textAlign: 'center', padding: '20px 16px', borderTop: `1px solid ${t.line}`, fontSize: 12.5, color: t.muted, textDecoration: 'none' }}>
        נשלח באמצעות <b>ShowUp</b> · אישורי הגעה לאירועים
      </a>
    </div>
  );
}
