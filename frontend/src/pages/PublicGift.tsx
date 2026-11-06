import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { color as C } from '../design/tokens';

/**
 * Public gift page. Route: /g/:code (no auth - the code comes in the hosts' own
 * WhatsApp messages). Sends the guest to the hosts' Bit/PayBox group, or shows a
 * phone number for a Bit transfer. The money never passes through ShowUp.
 * Backend: core-service app/routers/public_gift.py.
 */

type GiftData = {
  available: boolean;
  hosts: string;
  event_type: string | null;
  url?: string | null;
  provider?: 'paybox' | 'bit' | 'other' | null;
  bit_phone?: string | null;
};

const LINK_LABEL: Record<string, string> = { paybox: 'מעבר לפייבוקס', bit: 'מעבר לביט', other: 'מעבר להעברת המתנה' };

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

  const copy = async () => {
    const digits = (data?.bit_phone || '').replace(/\D/g, '');
    try { await navigator.clipboard.writeText(digits); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* number stays selectable */ }
  };

  const shell = (children: React.ReactNode) => (
    <div dir="rtl" style={{ minHeight: '100vh', background: C.paper, color: C.ink, display: 'flex', justifyContent: 'center', padding: '56px 20px', fontFamily: 'inherit' }}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 22, textAlign: 'center' }}>{children}</div>
    </div>
  );

  if (failed) return shell(<p style={{ fontSize: 16, color: C.body }}>הקישור לא נמצא.</p>);
  if (!data) return shell(<p style={{ fontSize: 16, color: C.muted }}>רגע...</p>);

  const btn: React.CSSProperties = {
    display: 'block', minHeight: 54, lineHeight: '54px', borderRadius: 14, background: C.lav, color: C.ink,
    fontSize: 17, fontWeight: 600, textDecoration: 'none', border: 'none', fontFamily: 'inherit', cursor: 'pointer', width: '100%',
  };

  return shell(
    <>
      <div style={{ fontSize: 44 }} aria-hidden>🎁</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, textWrap: 'balance' as any }}>
        {data.hosts ? `מתנה ל${data.hosts}` : 'מתנה'}
      </h1>
      {!data.available ? (
        <p style={{ fontSize: 16, color: C.body, margin: 0, lineHeight: 1.6 }}>פרטי המתנה כבר לא זמינים כאן. אפשר לפנות ישירות לבעלי האירוע.</p>
      ) : (
        <>
          {data.url && (
            <a href={data.url} rel="noopener noreferrer" style={btn}>{LINK_LABEL[data.provider || 'other']}</a>
          )}
          {data.bit_phone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 16, background: C.card, border: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 14, color: C.body }}>{data.url ? 'או העברה בביט למספר' : 'העברה בביט למספר'}</span>
              <span dir="ltr" style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1, userSelect: 'all', fontVariantNumeric: 'tabular-nums' }}>{data.bit_phone}</span>
              <button type="button" onClick={copy} style={{ ...btn, background: C.tint, minHeight: 46, lineHeight: '46px', fontSize: 15 }}>
                {copied ? 'הועתק ✓' : 'העתקת המספר'}
              </button>
            </div>
          )}
          <p style={{ fontSize: 13.5, color: C.muted, margin: 0, lineHeight: 1.6 }}>
            הכסף עובר ישירות לבעלי האירוע. ShowUp לא גובה עמלה ולא רואה את הסכום.
          </p>
        </>
      )}
    </>,
  );
}
