import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import { color as C } from '../../design/tokens';
import useViewportWidth, { usePrefersReducedMotion } from '../../design/useViewport';
import { plans as PLAN_TIERS } from '../../config/plans';
import { featureFlags } from '../../config/featureFlags';
import { normalizePhoneNumber } from '../../utils/countryOptions';
import { ASSISTANT_EXAMPLES, LANDING_EVENT_TYPES, MARQUEE_EVENTS } from './landingContent';

/**
 * Public landing page, design v6 ("ShowUp Landing v6").
 *
 * Everything shown is backed by the real system:
 * - Prices / caps / rounds come from config/plans.ts (mirrors aub plans.json).
 * - "שלחו לי הזמנה לדוגמה" calls the existing POST /api/auth/demo/whatsapp.
 * - "התקשרו אליי לדוגמה" calls POST /api/voice/public/demo-call (voice-service:
 *   Israeli mobiles, 9:00-21:00, one call per number a day). The calls section
 *   only states what the dialer really does (call window, 2 attempts, pending
 *   guests only, voicemail hang-up) - see shared/domain/voice_calls.py.
 * - The assistant examples are limited to commands the WhatsApp assistant
 *   really executes (see landingContent.ts).
 * - Unverified claims and the placeholder testimonial sit behind featureFlags.
 */

const LD = C.purple;
const LT = C.tint;
const LB = C.tintBorder;
const hide: React.CSSProperties = { display: 'none' };

const Ms = ({ children, style }: { children: string; style?: React.CSSProperties }) => (
  <span className="ms" aria-hidden="true" style={style}>{children}</span>
);

function Dots({ bg = '#FFFFFF', dot = '#8E887C' }: { bg?: string; dot?: string }) {
  return (
    <div style={{ alignSelf: 'flex-start', background: bg, borderRadius: '10px 0 10px 10px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', padding: '13px 15px', display: 'flex', gap: 4, animation: 'su-pop-in .3s ease both' }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: dot, animation: `su-tdot 1.2s ${i * 0.16}s infinite ease-in-out` }} />
      ))}
    </div>
  );
}

const pop = (delay = 0): React.CSSProperties => ({ animation: `su-pop-in .38s cubic-bezier(.2,.8,.2,1) both`, animationDelay: `${delay}s` });

/* ---------- Hero WhatsApp loop ---------- */
function HeroChat() {
  const reduce = usePrefersReducedMotion();
  const [w, setW] = useState(0);
  useEffect(() => {
    if (reduce) { setW(5); return; }
    const dur = [1300, 2300, 900, 1500, 1300, 4200];
    let t: ReturnType<typeof setTimeout>;
    let cur = 0;
    const tick = () => { t = setTimeout(() => { cur = (cur + 1) % 6; setW(cur); tick(); }, dur[cur]); };
    tick();
    return () => clearTimeout(t);
  }, [reduce]);
  const bubbleIn: React.CSSProperties = { alignSelf: 'flex-start', maxWidth: '86%', background: '#FFFFFF', borderRadius: '10px 0 10px 10px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', transformOrigin: 'top right' };
  const replyBtn: React.CSSProperties = { display: 'block', width: '86%', background: '#FFFFFF', color: C.waLink, textAlign: 'center', fontSize: 14.5, fontWeight: 500, padding: '9px 8px', borderRadius: 9, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' };
  const chipDay: React.CSSProperties = { alignSelf: 'center', fontSize: 12, color: '#54656F', background: '#FFFFFF', borderRadius: 8, padding: '4px 10px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' };
  return (
    <div id="demo" aria-label="דוגמה לשיחת וואטסאפ עם אורחת" style={{ flex: '1 1 340px', minWidth: 0, maxWidth: 400, alignSelf: 'center', borderRadius: 26, overflow: 'hidden', background: C.waChat, boxShadow: '0 30px 70px rgba(90,61,166,.16)', border: '1px solid #E2DCD2' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: C.waHeader, borderBottom: '1px solid #E2DCD2' }}>
        <span style={{ width: 38, height: 38, borderRadius: '50%', background: LD, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, flex: 'none' }}>ד</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: C.waText }}>דנה ויוסי</span>
          <span style={{ display: 'block', fontSize: 12, color: '#54656F' }}>WhatsApp Business</span>
        </span>
      </div>
      <div style={{ padding: '14px 12px 18px', display: 'flex', flexDirection: 'column', gap: 6, height: 548, overflow: 'hidden', backgroundImage: 'radial-gradient(rgba(17,27,33,.06) 1px,transparent 1px)', backgroundSize: '18px 18px' }}>
        <span style={{ ...chipDay, marginBottom: 4 }}>היום</span>
        {w >= 1 && (
          <>
            <div style={{ ...bubbleIn, padding: 5, ...pop() }}>
              <img src="/brand/invite.jpg" alt="ההזמנה המעוצבת" style={{ display: 'block', width: '100%', height: 150, objectFit: 'cover', borderRadius: 7 }} />
              <div style={{ padding: '7px 6px 0', fontSize: 14.5, lineHeight: 1.5, color: C.waText }}>
                <b style={{ fontWeight: 600 }}>היי שירה, מוזמנים לחתונה של דנה ויוסי 💍</b><br />יום שלישי, 19:30 · אולמי הגן, ראשון לציון
              </div>
              <span className="num" style={{ display: 'block', fontSize: 11, color: C.waMeta, textAlign: 'left', padding: '2px 6px 0' }}>10:00</span>
            </div>
            <span style={{ ...replyBtn, ...pop(0.12) }}>כן, באים 🎉</span>
            <span style={{ ...replyBtn, ...pop(0.2) }}>לא נצליח הפעם</span>
          </>
        )}
        {w >= 2 && (
          <div style={{ alignSelf: 'flex-end', maxWidth: '72%', background: C.waOut, borderRadius: '0 10px 10px 10px', padding: '7px 10px 5px', marginTop: 6, fontSize: 14.5, color: C.waText, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', transformOrigin: 'top left', ...pop() }}>
            כן, באים 🎉
            <span className="num" style={{ display: 'block', fontSize: 11, color: C.waMeta, textAlign: 'left', marginTop: 2 }}>
              10:04 <span style={{ color: w >= 3 ? '#53BDEB' : '#8696A0', transition: 'color .3s' }}>✓✓</span>
            </span>
          </div>
        )}
        {w >= 4 && <span style={{ ...chipDay, margin: '8px 0 4px', ...pop() }}>ביום האירוע</span>}
        {(w === 0 || w === 4) && <Dots dot="#8696A0" />}
        {w >= 5 && (
          <div style={{ ...bubbleIn, padding: '7px 10px 0', fontSize: 14.5, lineHeight: 1.5, color: C.waText, ...pop() }}>
            מתרגשים לקראת הערב. מזכירים: היום ב־19:30, אולמי הגן. וכדי שלא תתעכבו בדרך:
            <span className="num" style={{ display: 'block', fontSize: 11, color: C.waMeta, textAlign: 'left', marginTop: 2 }}>10:00</span>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, margin: '6px -10px 0', padding: 9, borderTop: '1px solid #E9EDEF', color: C.waLink, fontSize: 14, fontWeight: 500 }}>
              <Ms style={{ fontSize: 17 }}>near_me</Ms>ניווט עם Waze
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Hero start form ---------- */
function StartCard() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [evType, setEvType] = useState(LANDING_EVENT_TYPES[0].value);
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [calledFrom, setCalledFrom] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, '');
  const phoneOk = /^0?5\d{8}$/.test(digits);

  const start = () => {
    const params = new URLSearchParams();
    if (name.trim()) params.set('fullName', name.trim());
    if (digits) { params.set('phone', digits.startsWith('0') ? digits : `0${digits}`); params.set('countryCode', '+972'); }
    if (evType) params.set('eventType', evType);
    navigate(`/wizard${params.toString() ? `?${params}` : ''}`);
  };

  const sendSample = async () => {
    setSendErr(null);
    if (!phoneOk) { setPhoneErr(true); return; }
    if (!name.trim()) { setSendErr('רק צריך את השם שלכם כדי לשלוח'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/auth/demo/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: normalizePhoneNumber(digits, '+972'), countryCode: '+972', eventType: evType }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      setSendErr('לא הצלחנו לשלוח כרגע. נסו שוב בעוד רגע');
    } finally {
      setSending(false);
    }
  };

  const callMe = async () => {
    setSendErr(null);
    if (!phoneOk) { setPhoneErr(true); return; }
    if (!name.trim()) { setSendErr('רק צריך את השם שלכם כדי להתקשר'); return; }
    setCalling(true);
    try {
      const res = await fetch('/api/voice/public/demo-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: normalizePhoneNumber(digits, '+972') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = body?.detail?.error;
        setSendErr(
          code === 'outside_hours' ? 'שיחות לדוגמה יוצאות בין 9:00 ל־21:00, בשישי עד 14:00 ולא בשבת. בינתיים אפשר לשמוע דוגמה למטה בעמוד.'
          : code === 'already_called' ? 'כבר התקשרנו למספר הזה היום. אפשר לשמוע את הדוגמה למטה בעמוד.'
          : code === 'israeli_mobile_required' ? 'שיחה לדוגמה אפשר לקבל רק לנייד ישראלי'
          : 'לא הצלחנו להתקשר כרגע. נסו שוב מאוחר יותר');
        return;
      }
      setCalledFrom(body?.from || '');
    } catch {
      setSendErr('לא הצלחנו להתקשר כרגע. נסו שוב מאוחר יותר');
    } finally {
      setCalling(false);
    }
  };

  const input: React.CSSProperties = { height: 48, padding: '0 14px', border: `1px solid ${C.fieldSignup}`, borderRadius: 11, background: C.paper, fontSize: 15, outline: 'none', width: '100%' };
  const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
  const labelT: React.CSSProperties = { fontSize: 13.5, fontWeight: 500 };
  const primary: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 12, background: C.lav, color: C.ink, fontSize: 16, fontWeight: 600, border: 'none', cursor: 'pointer', width: '100%' };

  return (
    <div style={{ flex: '1 1 360px', minWidth: 0, maxWidth: 460, background: '#FFFFFF', borderRadius: 20, padding: 24, border: `1px solid ${C.line}`, boxShadow: '0 24px 60px rgba(22,21,15,.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {calledFrom !== null ? (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '6px 0' }}>
          <span style={{ width: 48, height: 48, borderRadius: '50%', background: LT, color: LD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PhoneInTalkIcon style={{ fontSize: 26 }} /></span>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>הטלפון שלכם עומד לצלצל</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, color: C.mutedSoft }}>
            תוך חצי דקה בערך תקבלו שיחה{calledFrom ? <> מהמספר <span className="num" dir="ltr" style={{ color: C.ink, fontWeight: 600, whiteSpace: 'nowrap' }}>{calledFrom}</span></> : null}. ענו, תקשיבו, ונסו ללחוץ על מקש כמו שאורח היה עושה. זו רק דוגמה, אז שום דבר לא נרשם.
          </div>
          <button type="button" onClick={start} className="su-hover-lav" style={primary}>יוצאים לדרך<Ms style={{ fontSize: 20 }}>arrow_back</Ms></button>
        </div>
      ) : !sent ? (
        <>
          <div>
            <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>יאללה, מתחילים</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: C.mutedSoft, marginTop: 5 }}>כמה פרטים, ויש לכם לוח הודעות מוכן לאירוע. רוצים לראות קודם איך זה מרגיש אצל האורחים? נשלח לכם הודעה לדוגמה, או שנתקשר.</div>
          </div>
          <label style={label}>
            <span style={labelT}>שם מלא</span>
            <input className="su-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={input} />
          </label>
          <label style={label}>
            <span style={labelT}>איזה אירוע?</span>
            <select className="su-input" value={evType} onChange={(e) => setEvType(e.target.value)} style={{ ...input, padding: '0 12px', cursor: 'pointer' }}>
              {LANDING_EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label style={label}>
            <span style={labelT}>טלפון נייד</span>
            <span style={{ display: 'flex', gap: 8, direction: 'ltr' }}>
              <span className="num" style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 12px', border: `1px solid ${C.fieldSignup}`, borderRadius: 11, background: '#F5F2EC', fontSize: 15, color: C.mutedSoft }}>+972</span>
              <input
                className="su-input num"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setPhoneErr(false); }}
                placeholder="50-000-0000"
                inputMode="tel"
                autoComplete="tel-national"
                aria-invalid={phoneErr}
                style={{ ...input, flex: 1, minWidth: 0, textAlign: 'left', borderColor: phoneErr ? C.danger : C.fieldSignup }}
              />
            </span>
          </label>
          {phoneErr && <span role="alert" style={{ fontSize: 13, fontWeight: 500, color: C.danger }}>צריך מספר נייד ישראלי תקין</span>}
          <button type="button" onClick={start} className="su-hover-lav" style={{ ...primary, marginTop: 2 }}>
            יוצאים לדרך<Ms style={{ fontSize: 20 }}>arrow_back</Ms>
          </button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={sendSample}
              disabled={sending || calling}
              className="su-hover-green"
              style={{ flex: '1 1 170px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, background: '#FFFFFF', border: '1px solid #B9DFC6', color: '#1E6B3F', fontSize: 14.5, fontWeight: 600, cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1 }}
            >
              <WhatsAppIcon style={{ fontSize: 19, color: C.waGreen }} />
              {sending ? 'שולחים...' : 'הודעה לדוגמה'}
            </button>
            <button
              type="button"
              onClick={callMe}
              disabled={sending || calling}
              className="su-hover-chip"
              style={{ flex: '1 1 170px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, background: '#FFFFFF', border: `1px solid ${LB}`, color: C.purpleDark, fontSize: 14.5, fontWeight: 600, cursor: calling ? 'wait' : 'pointer', opacity: calling ? 0.7 : 1 }}
            >
              <PhoneInTalkIcon style={{ fontSize: 19, color: LD }} />
              {calling ? 'מחייגים...' : 'התקשרו אליי לדוגמה'}
            </button>
          </div>
          {sendErr && <span role="alert" style={{ fontSize: 13, fontWeight: 500, color: C.danger }}>{sendErr}</span>}
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.mutedSoft }}>בלי מנוי, משלמים פעם אחת לאירוע. ההודעות יוצאות מוואטסאפ העסקי הרשמי, והתשלום מאובטח.</div>
        </>
      ) : (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '6px 0' }}>
          <span style={{ width: 48, height: 48, borderRadius: '50%', background: '#E7F4EC', color: '#1E6B3F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ms style={{ fontSize: 28, fontWeight: 500 }}>check</Ms></span>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>ההודעה בדרך לוואטסאפ שלכם</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.55, color: C.mutedSoft }}>פתחו את הוואטסאפ ותראו איך זה נראה מהצד של האורחים. אהבתם? פותחים אירוע בכמה דקות.</div>
          <button type="button" onClick={start} className="su-hover-lav" style={primary}>יוצאים לדרך<Ms style={{ fontSize: 20 }}>arrow_back</Ms></button>
        </div>
      )}
    </div>
  );
}

/* ---------- Moments (How it works) visuals ---------- */
function InviteVisual() {
  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 30px 70px rgba(22,21,15,.10)' }}>
      <div style={{ alignSelf: 'flex-start', maxWidth: '88%', background: '#F5F2EC', borderRadius: '14px 14px 4px 14px', padding: '14px 16px', borderInlineStart: `3px solid ${C.lavMid}` }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>החתונה של דנה ויוסי 💍</div>
        <div style={{ fontSize: 13.5, color: C.mutedSoft, marginTop: 4 }}>יום שלישי, 19:30 · אולמי הגן, ראשון לציון</div>
        <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, background: '#FFFFFF', border: `1px solid ${LB}`, color: C.purpleDark, borderRadius: 9, padding: '7px 12px' }}>כן, אני מגיע 🎉</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, background: '#FFFFFF', border: `1px solid ${C.fieldSignup}`, borderRadius: 9, padding: '7px 12px' }}>לא אוכל הפעם</span>
        </div>
      </div>
      <div style={{ alignSelf: 'flex-end', background: C.waOut, color: C.waText, borderRadius: '14px 14px 14px 4px', padding: '10px 16px', fontSize: 14.5, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>כן, אני מגיע 🎉</div>
    </div>
  );
}

function StatVisual() {
  const rows: [string, string, string][] = [['מגיעים', '248', '#2E7D5B'], ['טרם ענו', '63', '#C98A1B'], ['לא יגיעו', '29', '#8E887C']];
  return (
    <div style={{ background: C.lav, borderRadius: 18, padding: '30px 32px', color: C.ink, display: 'flex', alignItems: 'center', gap: '24px 32px', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 180px' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>מצב אישורי הגעה</div>
        <div className="num" style={{ fontSize: 'clamp(64px,7vw,104px)', fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 0.9, marginTop: 10 }}>84%</div>
        <div style={{ fontSize: 15, marginTop: 8 }}>כבר ענו</div>
      </div>
      <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,.55)', borderRadius: 14, padding: '6px 16px' }}>
        {rows.map(([l, n, c], i) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: i ? '1px solid rgba(22,21,15,.1)' : 'none' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />
            <span style={{ flex: 1, fontSize: 14.5 }}>{l}</span>
            <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeqVisual() {
  const seq: [string, string, string][] = [['mail', 'הזמנה', '30 יום לפני'], ['notifications', 'תזכורת', 'שבוע לפני'], ['notifications_active', 'תזכורת אחרונה', 'יום לפני'], ['celebration', 'תודה', 'אחרי האירוע']];
  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 18, padding: '20px 22px', boxShadow: '0 30px 70px rgba(22,21,15,.10)' }}>
      {seq.map(([i, t, when], k) => (
        <div key={t} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', columnGap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignSelf: 'stretch' }}>
            <span style={{ position: 'absolute', top: k === 0 ? '50%' : 0, bottom: k === seq.length - 1 ? '50%' : 0, width: 2, background: LB }} />
            <span style={{ position: 'relative', margin: '10px 0', width: 36, height: 36, borderRadius: '50%', background: LT, color: LD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ms style={{ fontSize: 19 }}>{i}</Ms></span>
          </div>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>{t}</span>
          <span style={{ fontSize: 13, color: C.mutedSoft, background: '#F5F2EC', borderRadius: 99, padding: '4px 11px', whiteSpace: 'nowrap' }}>{when}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, paddingTop: 12, borderTop: `1px solid ${C.line2}`, fontSize: 13.5, fontWeight: 500, color: LD }}>
        <Ms style={{ fontSize: 18 }}>schedule</Ms>מתכוונן לבד לזמן שנשאר עד האירוע
      </div>
    </div>
  );
}

function ChatVisual() {
  const q: React.CSSProperties = { maxWidth: '80%', background: C.waOut, color: C.waText, borderRadius: '14px 14px 14px 4px', padding: '10px 14px', fontSize: 14, lineHeight: 1.5, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' };
  const a: React.CSSProperties = { maxWidth: '88%', background: '#FFFFFF', color: C.waText, borderRadius: '14px 14px 4px 14px', padding: '11px 14px', fontSize: 14, lineHeight: 1.55, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' };
  return (
    <div style={{ background: LT, border: `1px solid ${LB}`, borderRadius: 18, padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 9, boxShadow: '0 30px 70px rgba(90,61,166,.14)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#25A35A' }} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>עוזר האירוע</span>
        <span style={{ fontSize: 12.5, color: C.body }}>מחובר</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><div style={q}>מי עוד לא ענה?</div></div>
      <div style={{ display: 'flex' }}><div style={a}>63 אורחים עוד לא ענו. הנה הרשימה.</div></div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><div style={q}>כמה אישרו עד עכשיו?</div></div>
      <div style={{ display: 'flex' }}><div style={a}>248 אישרו הגעה, 63 עוד לא ענו ו־29 לא יגיעו.</div></div>
    </div>
  );
}

const MOMENTS = [
  { n: '01', t: 'הזמנה שמרגישה אישית', note: 'כל אורח מקבל הזמנה ישר לוואטסאפ, ומאשר בלחיצה. ככה עונים יותר אנשים, ובאמת. כי כולם כבר שם, כל היום.', bullets: ['בצ׳אט שכולם מכירים', 'בלי קישור לפתוח ובלי טופס'], V: InviteVisual },
  { n: '02', t: 'אתם תמיד יודעים כמה באים', note: 'מי אישר, מי עוד מתלבט, וכמה בדיוק יושבים מול האולם. הכול מתעדכן לבד, בזמן אמת. סוף סוף אפשר לנשום.', bullets: ['עדכון חי עד הרגע האחרון', 'מספר מדויק לאולם ולהושבה'], V: StatVisual },
  { n: '03', t: 'הם ישכחו. אנחנו לא.', note: 'אנחנו בונים לבד את רצף ההודעות לפי התאריך שלכם: הזמנה, תזכורת, תזכורת אחרונה ותודה שאחרי. גם הדודה הרחוקה תקבל תזכורת בזמן.', bullets: ['לוח שליחה שמתאים את עצמו לתאריך', 'אתם רואים את לוח השליחה ויכולים לשנות אותו'], V: SeqVisual },
  { n: '04', t: 'שואלים, והוא עונה', note: 'לא צריך לחפש בטבלאות. שואלים את העוזר בוואטסאפ, ומקבלים מספרים. בלי להיכנס לשום מסך.', bullets: ['מכיר את האירוע שלכם'], V: ChatVisual },
];

/* ---------- Phone calls ---------- */
const CALL_FACTS: [string, string][] = [
  ['record_voice_over', 'השיחה נפתחת ב״כאן ShowUp״ ובשמות שלכם, ככה שברור מהשנייה הראשונה מי מתקשר ולמה.'],
  ['person_search', 'מתקשרים רק למי שעוד לא ענה. מי שכבר אישר או אמר שלא יגיע, לא יקבל טלפון.'],
  ['schedule', 'בשעות סבירות: בין 10:00 ל־20:00, בשישי עד 13:00, ובשבת אף פעם.'],
  ['voicemail', 'לא ענו? ננסה עוד פעם אחת, וזהו. לתא קולי לא משאירים הודעה.'],
];

function CallVisual() {
  const reduce = usePrefersReducedMotion();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => setPlaying(false)); } else { a.pause(); }
  };
  const keys: [string, string, boolean][] = [['1', 'מגיעים', true], ['2', 'לא נגיע', false], ['3', 'עוד לא יודעים', false]];
  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 22, overflow: 'hidden', boxShadow: '0 30px 70px rgba(90,61,166,.14)' }}>
      <div style={{ background: LT, borderBottom: `1px solid ${LB}`, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 46, height: 46, borderRadius: '50%', background: '#FFFFFF', border: `1px solid ${LB}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <img src="/brand/seal.png" alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>ShowUp</span>
          <span style={{ display: 'block', fontSize: 13, color: C.body }}>מתקשרים בשם דנה ויוסי</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: '#1E6B3F', background: '#E7F4EC', borderRadius: 99, padding: '5px 10px', whiteSpace: 'nowrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#25A35A', animation: reduce ? 'none' : 'su-pulse 2.6s ease-in-out infinite' }} />בשיחה
        </span>
      </div>
      <div style={{ padding: '20px 20px 6px' }}>
        <div style={{ fontSize: 15.5, lineHeight: 1.65, color: C.ink, borderInlineStart: `3px solid ${C.lavMid}`, paddingInlineStart: 14 }}>
          ״היי שירה! כאן ShowUp, אני מתקשרת בשם דנה ויוסי, שמזמינים אתכם לחתונה שלהם ביום שלישי, ה־17 בנובמבר. אם אתם מגיעים, הקישו אחת...״
        </div>
        <button type="button" onClick={toggle} aria-label={playing ? 'עצירת ההקלטה' : 'השמעת דוגמה לשיחה'}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', marginTop: 18, padding: '10px 12px', borderRadius: 14, border: `1px solid ${LB}`, background: '#FFFFFF', cursor: 'pointer', textAlign: 'right', color: C.ink }}>
          <span style={{ width: 40, height: 40, borderRadius: '50%', background: LD, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Ms style={{ fontSize: 24 }}>{playing ? 'pause' : 'play_arrow'}</Ms>
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{playing ? 'מקשיבים...' : 'ככה זה נשמע'}</span>
            <span aria-hidden="true" style={{ display: 'block', height: 4, borderRadius: 99, background: C.line2, marginTop: 8, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.round(t * 100)}%`, background: LD, transition: 'width .25s linear' }} />
            </span>
          </span>
          <span className="num" style={{ fontSize: 13, color: C.mutedSoft }}>0:19</span>
        </button>
        <audio ref={audio} src="/brand/call-sample.mp3" preload="none"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setT(0); }}
          onTimeUpdate={(e) => { const a = e.currentTarget; setT(a.duration ? a.currentTime / a.duration : 0); }} />
      </div>
      <div style={{ padding: '14px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
        {keys.map(([k, l, on]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 4px', borderRadius: 14, background: on ? LD : '#F5F2EC', color: on ? '#FFFFFF' : C.ink }}>
            <span className="num" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{k}</span>
            <span style={{ fontSize: 12.5, textAlign: 'center' }}>{l}</span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${C.line2}`, padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: '#2E7D5B' }}>
        <Ms style={{ fontSize: 19 }}>check_circle</Ms>שירה לחצה 1 ואז 2. ברשימה שלכם עכשיו: מגיעים, 2 אנשים.
      </div>
    </div>
  );
}

function CallsSection({ compact }: { compact: boolean }) {
  return (
    <section id="calls" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(40px,6vw,72px) clamp(16px,2vw,24px) 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '36px 64px', alignItems: 'center' }}>
        <div style={{ flex: '1 1 440px', minWidth: 0, maxWidth: 560 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.04em', color: LD }}>שיחות טלפון</div>
          <h2 style={{ margin: '14px 0 0', fontSize: 'clamp(32px,4vw,50px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.06, textWrap: 'balance' } as React.CSSProperties}>
            ומי שלא ענה בוואטסאפ, <span style={{ color: LD }}>מקבל טלפון.</span>
          </h2>
          <p style={{ fontSize: 16.5, lineHeight: 1.7, color: C.body, margin: '18px 0 0' }}>
            תמיד נשארים כמה. סבא שלא פותח הודעות, הדודה שהשתיקה את כל הקבוצות, החבר שראה ושכח לענות. אחרי התזכורות בוואטסאפ, מי שעדיין לא ענה מקבל מאיתנו שיחה קצרה. הוא שומע מי מתקשר ובשם מי, לוחץ על מקש בטלפון, והתשובה נכנסת לרשימה שלכם כמו כל אישור אחר.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 26 }}>
            {CALL_FACTS.map(([i, txt]) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, background: LT, color: LD, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Ms style={{ fontSize: 18 }}>{i}</Ms></span>
                <span style={{ fontSize: 15, lineHeight: 1.6, color: C.ink, paddingTop: 5 }}>{txt}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: C.mutedSoft, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.line2}` }}>
            כלול ב־Plus (סבב שיחות אחד) וב־Pro (עד שלושה סבבים). את מועד השיחות קובעים יחד איתכם.
          </div>
          <a href="#top" className="su-hover-deep" style={{ display: compact ? 'flex' : 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 9, marginTop: 22, fontSize: 15, fontWeight: 600, background: LD, color: '#FFFFFF', borderRadius: 12, padding: '14px 22px' }}>
            <PhoneInTalkIcon style={{ fontSize: 19 }} />רוצים לשמוע על עצמכם? נתקשר אליכם
          </a>
        </div>
        <div style={{ flex: '1 1 380px', minWidth: 0, maxWidth: 480, marginInline: compact ? 'auto' : 0 }}>
          <CallVisual />
        </div>
      </div>
    </section>
  );
}

/* ---------- Assistant demo ---------- */
function AssistantSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [asked, setAsked] = useState<number[]>([0, 1, 2]);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [asked.length, typing]);
  const ask = (i: number) => {
    if (typing) return;
    setAsked((a) => [...a, i]);
    setTyping(true);
    window.setTimeout(() => setTyping(false), 900);
  };
  const qS: React.CSSProperties = { maxWidth: '82%', background: C.waOut, color: C.waText, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', borderRadius: '14px 14px 14px 4px', padding: '10px 14px', fontSize: 14.5, lineHeight: 1.5 };
  const aS: React.CSSProperties = { maxWidth: '88%', background: '#FFFFFF', color: C.waText, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', borderRadius: '14px 14px 4px 14px', padding: '11px 14px', fontSize: 14.5, lineHeight: 1.55 };
  return (
    <section id="assistant" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(40px,6vw,64px) clamp(16px,2vw,24px) 0' }}>
      <div style={{ background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 26, overflow: 'hidden', display: 'flex', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 440px', minWidth: 0, padding: 'clamp(28px,4.5vw,52px)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.04em', color: LD }}>העוזר של ShowUp</div>
          <h2 style={{ margin: '14px 0 0', fontSize: 'clamp(32px,4vw,50px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05, textWrap: 'balance' } as React.CSSProperties}>לא צ׳אטבוט. <span style={{ color: LD }}>עוזר אישי לאירוע.</span></h2>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: C.body, margin: '18px 0 0', maxWidth: 500 }}>שואלים, מבקשים, והוא פשוט עושה. הוא מכיר את האירוע שלכם ואת רשימת המוזמנים, ועונה בתוך וואטסאפ. בלי לחפש איפה לחצתם פעם שעברה.</p>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 28 }}>פשוט אומרים לו, לחצו לנסות:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {ASSISTANT_EXAMPLES.map(([q], i) => (
              <button key={q} type="button" onClick={() => ask(i)} className="su-hover-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: `1px solid ${LB}`, borderRadius: 99, padding: '8px 14px', fontSize: 14, color: C.ink, cursor: 'pointer', transition: 'border-color .2s ease,color .2s ease', minHeight: 40 }}>״{q}״</button>
            ))}
          </div>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: C.body, margin: '24px 0 0', maxWidth: 480 }}>במקום ללמוד עוד מערכת, פשוט מדברים. הוא זוכר את ההקשר ועושה את העבודה. אתם מרוויחים שעות.</p>
          <Link to="/wizard" className="su-hover-deep" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginTop: 26, fontSize: 15, fontWeight: 600, background: LD, color: '#FFFFFF', borderRadius: 12, padding: '14px 22px' }}>
            <WhatsAppIcon style={{ fontSize: 18 }} />בואו תכירו אותו
          </Link>
        </div>
        <div style={{ flex: '1 1 420px', minWidth: 0, background: 'linear-gradient(160deg,#9D83E0 0%,#B9A6F0 55%,#D4C7F7 100%)', padding: 'clamp(20px,3vw,32px)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,.22) 1px,transparent 1px)', backgroundSize: '18px 18px', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', background: 'rgba(255,255,255,.82)', borderRadius: 14 }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${LB}` }}><img src="/brand/seal.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} /></span>
            <span>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>עוזר האירוע</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.body }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#25A35A', animation: 'su-pulse 2.6s ease-in-out infinite' }} />מחובר בוואטסאפ</span>
            </span>
          </div>
          <div ref={ref} aria-live="polite" style={{ position: 'relative', flex: 1, minHeight: 380, maxHeight: 440, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 16 }}>
            {asked.map((qi, k) => (
              <React.Fragment key={k}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><div style={qS}>{ASSISTANT_EXAMPLES[qi][0]}</div></div>
                {!(typing && k === asked.length - 1) && <div style={{ display: 'flex' }}><div style={aS}>{ASSISTANT_EXAMPLES[qi][1]}</div></div>}
              </React.Fragment>
            ))}
            {typing && <Dots />}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Pricing ---------- */
function PricingSection() {
  const [guests, setGuests] = useState(180);
  const fit = PLAN_TIERS.find((p) => p.countLimit == null || guests <= p.countLimit) || PLAN_TIERS[PLAN_TIERS.length - 1];
  return (
    <section id="pricing" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(72px,9vw,104px) clamp(16px,2vw,24px) 0' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.04em', color: LD }}>תעריפים</div>
        <h2 style={{ margin: '12px auto 0', fontSize: 'clamp(36px,5vw,64px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.02 }}>מחיר אחד. בלי כוכביות.</h2>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: C.mutedSoft, margin: '18px auto 0', maxWidth: 560 }}>בכל חבילה יש את העוזר, ההזמנה, ההושבה וכל השאר. ההבדל הוא כמות האורחים, סבבי ההודעות ושיחות הטלפון. משלמים פעם אחת, בלי מנוי.</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 30 }}>
        <div style={{ width: 'min(100%,520px)', background: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 20px' }}>
          <label htmlFor="guests-range" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>כמה אורחים אתם מזמינים?</span>
            <span className="num" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em' }}>{guests >= 600 ? '600+' : guests}</span>
          </label>
          <input id="guests-range" type="range" min={10} max={600} step={10} value={guests} onChange={(e) => setGuests(+e.target.value)} style={{ width: '100%', margin: '12px 0 2px', accentColor: LD, height: 24, cursor: 'pointer' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 14, marginTop: 22, alignItems: 'stretch' }}>
        {PLAN_TIERS.map((p) => {
          const on = p === fit;
          const badge = on ? 'מתאימה לכם' : p.isPopular ? 'הבחירה של רוב המארחים' : '';
          return (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', padding: 26, borderRadius: 22, background: '#FFFFFF', border: on ? `1.5px solid ${C.ink}` : `1px solid ${C.line}`, boxShadow: on ? '0 22px 50px rgba(22,21,15,.10)' : 'none', transition: 'box-shadow .25s, border-color .25s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span dir="ltr" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>{p.title}</span>
                <span style={badge ? { fontSize: 12, fontWeight: 600, borderRadius: 7, padding: '4px 9px', whiteSpace: 'nowrap', background: on ? LD : LT, color: on ? '#FFFFFF' : C.purpleDark, border: `1px solid ${on ? LD : LB}` } : hide}>{badge}</span>
              </div>
              <div style={{ fontSize: 14.5, color: C.mutedSoft, marginTop: 4 }}>{p.subtitle}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 20 }}>
                <span className="num" style={{ fontSize: 48, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1 }}>{p.price}</span>
                <span style={{ fontSize: 14, color: C.mutedSoft }}>לאירוע</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: LD, marginTop: 10 }}>{p.description}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.line2}` }}>
                {p.features.map((f) => (
                  <span key={f} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 15 }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: LT, color: LD, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Ms style={{ fontSize: 15, fontWeight: 500 }}>check</Ms></span>{f}
                  </span>
                ))}
              </div>
              <Link to={`/wizard?package=${p.id}`} className="su-hover-dim" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 50, marginTop: 24, borderRadius: 12, fontSize: 15.5, color: C.ink, background: on ? C.lav : '#FFFFFF', border: on ? `1px solid ${C.lav}` : '1px solid #D8D2C6', marginBlockStart: 'auto' }}>יוצאים לדרך</Link>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px 32px', marginTop: 26, fontSize: 14, color: '#3A3833' }}>
        {featureFlags.claimRefund14Days && <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Ms style={{ fontSize: 18, color: LD }}>verified_user</Ms>החזר כספי מלא תוך 14 יום</span>}
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Ms style={{ fontSize: 18, color: LD }}>lock</Ms>תשלום מאובטח, בלי לשמור פרטי אשראי</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Ms style={{ fontSize: 18, color: LD }}>check</Ms>תשלום חד־פעמי, בלי מנוי</span>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const FAQS: [string, string][] = [
  ['ההודעות יוצאות מהמספר שלי?', 'לא. הן יוצאות ממספר וואטסאפ עסקי של ShowUp, עם השמות שלכם בתוך ההודעה. הטלפון שלכם נשאר שקט, והתשובות נכנסות ישר לרשימה.'],
  ['ומה אם סבתא לא תבין?', 'אין קישור לפתוח ואין טופס. ההזמנה מגיעה לוואטסאפ שהיא כבר מכירה, עם כפתורי תשובה. לוחצים, וזהו.'],
  ['ומה עם מי שלא עונה?', 'תזכורות יוצאות לפי לוח השליחה. ב־Plus וב־Pro, מי שעדיין לא ענה מקבל גם שיחת טלפון קצרה. ואם צריך, שואלים את העוזר ״מי עוד לא ענה?״ ומקבלים רשימה.'],
  ['השיחה היא מבן אדם?', 'לא, זו שיחה אוטומטית, ואנחנו לא מנסים להסתיר את זה. היא נשמעת טבעית, אומרת שזה ShowUp ובשם מי, ומבקשת ללחוץ על מקש. לא צריך לדבר ולא צריך להבין בטכנולוגיה. רוצים לשמוע? בראש העמוד אפשר לבקש שנתקשר אליכם.'],
  ['איך מכניסים את רשימת האורחים?', 'מעלים קובץ אקסל, מוסיפים אחד אחד, או משתפים אנשי קשר בוואטסאפ למספר של ShowUp. מי שמגיע מוואטסאפ מחכה לאישור שלכם לפני שהוא נכנס לרשימה.'],
  ['מה זה סבב הודעות?', 'כל הודעה שיוצאת לרשימה: הזמנה, תזכורת, תזכורת אחרונה, תודה. Basic כולל 2 סבבים, Plus ו־Pro כוללים 4.'],
];
const FAQ_REFUND: [string, string] = ['מה אם התחרטנו?', 'יש החזר כספי מלא תוך 14 יום, בלי שאלות.'];

function FaqSection({ compact }: { compact: boolean }) {
  const [open, setOpen] = useState(0);
  const faqs = featureFlags.claimRefund14Days ? [...FAQS, FAQ_REFUND] : FAQS;
  return (
    <section id="faq" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(80px,10vw,128px) clamp(16px,2vw,24px) 0' }}>
      <div style={{ display: 'flex', gap: '32px 56px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: compact ? '1 1 100%' : '0 0 340px', position: compact ? 'static' : 'sticky', top: 128 }}>
          <h2 style={{ margin: 0, fontSize: 40, fontWeight: 600, letterSpacing: '-0.032em', lineHeight: 1.08 }}>שאלות נפוצות.</h2>
          <div style={{ fontSize: 15, color: C.mutedSoft, lineHeight: 1.6, marginTop: 16 }}>בעיקר גרסאות של ״ומה אם סבתא לא תבין?״. שאלה הוגנת.</div>
          <Link to="/go/whatsapp" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 20, fontSize: 14.5, color: C.ink, borderBottom: '1px solid #C8C2B6', paddingBottom: 2 }}>שאלה אחרת? כתבו לנו בוואטסאפ</Link>
        </div>
        <div style={{ flex: '1 1 460px', minWidth: 0, borderTop: `1px solid ${C.line}` }}>
          {faqs.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <div key={q} style={{ borderBottom: `1px solid ${C.line}` }}>
                <button type="button" onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen} style={{ display: 'flex', alignItems: 'baseline', gap: 20, width: '100%', padding: '21px 4px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'right' }}>
                  <span style={{ fontSize: 18, fontWeight: 500, flex: 1, lineHeight: 1.35 }}>{q}</span>
                  <span aria-hidden="true" style={{ fontSize: 20, color: '#6B6660', lineHeight: 1, flex: 'none' }}>{isOpen ? '−' : '+'}</span>
                </button>
                <div style={{ maxHeight: isOpen ? 260 : 0, opacity: isOpen ? 1 : 0, overflow: 'hidden', transition: 'max-height .45s ease, opacity .35s ease' }}>
                  <div style={{ fontSize: 15, lineHeight: 1.7, color: C.mutedSoft, padding: '0 4px 22px', maxWidth: 640 }}>{a}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------- Page ---------- */
export default function Landing() {
  const w = useViewportWidth();
  const compact = w < 820;
  const minPrice = PLAN_TIERS[0]?.price || '';

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = C.paper;
    return () => { document.body.style.background = prev; };
  }, []);

  const navLink: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: C.ink, padding: '8px 12px', borderRadius: 11, whiteSpace: 'nowrap' };
  const sectionHead = (_k: string): React.CSSProperties => ({ fontSize: 13, fontWeight: 600, letterSpacing: '.04em', color: LD });

  return (
    <div className="su-scope" dir="rtl" lang="he" style={{ background: C.paper, minHeight: '100vh', overflowX: 'clip' }}>
      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 90, padding: '14px 0', pointerEvents: 'none' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 clamp(12px,2vw,24px)' }}>
          <div style={{ pointerEvents: 'auto', background: 'rgba(253,251,247,.74)', backdropFilter: 'blur(20px) saturate(1.7)', WebkitBackdropFilter: 'blur(20px) saturate(1.7)', border: '1px solid rgba(22,21,15,.08)', borderRadius: 20, boxShadow: '0 8px 30px rgba(22,21,15,.1)', padding: '0 22px 0 14px', height: 62, display: 'flex', alignItems: 'center', gap: 4 }}>
            <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 9, color: C.ink, marginInlineEnd: 18, flex: 'none' }}>
              <img src="/brand/seal.png" alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
              <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em' }}>ShowUp</span>
            </a>
            <nav aria-label="ראשי" style={{ display: w < 1060 ? 'none' : 'flex', alignItems: 'center', gap: 2 }}>
              <a href="#what" className="su-hover-nav" style={navLink}>מה מקבלים</a>
              <a href="#how" className="su-hover-nav" style={navLink}>איך זה עובד</a>
              <a href="#calls" className="su-hover-nav" style={navLink}>שיחות טלפון</a>
              <a href="#assistant" className="su-hover-nav" style={navLink}>העוזר</a>
              <a href="#pricing" className="su-hover-nav" style={navLink}>תעריפים</a>
              <a href="#faq" className="su-hover-nav" style={navLink}>שאלות נפוצות</a>
            </nav>
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
              <Link to="/login" style={{ fontSize: 13.5, fontWeight: 500, color: C.ink, borderBottom: '1px solid #C8C2B6', paddingBottom: 1, whiteSpace: 'nowrap' }}>התחברות</Link>
              <Link to="/wizard" className="su-hover-lav" style={{ fontSize: 13.5, fontWeight: 600, background: C.lav, color: C.ink, borderRadius: 11, padding: '10px 16px', whiteSpace: 'nowrap' }}>יוצאים לדרך</Link>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section id="top" style={{ position: 'relative', overflow: 'hidden', background: C.paper }}>
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(90,61,166,.13) 1px,transparent 1px)', backgroundSize: '26px 26px', pointerEvents: 'none' }} />
          <div aria-hidden="true" style={{ position: 'absolute', top: -180, left: -160, width: 640, height: 640, borderRadius: '50%', background: 'radial-gradient(circle,rgba(201,184,243,.55),rgba(201,184,243,0) 70%)', pointerEvents: 'none' }} />
          <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, background: `linear-gradient(to bottom,rgba(250,248,244,0),${C.paper} 88%)`, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', maxWidth: 1240, margin: '0 auto', padding: compact ? '112px 18px 72px' : '140px 48px 110px' }}>
            <div style={{ maxWidth: 760 }}>
              <h1 style={{ margin: 0, fontSize: 'clamp(42px,6vw,76px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.0, color: C.ink, textWrap: 'balance' } as React.CSSProperties}>
                אתם מזמינים.<br />אנחנו דואגים <span style={{ color: LD }}>שכולם יגיעו.</span>
              </h1>
              <p style={{ fontSize: 'clamp(17px,1.6vw,19px)', lineHeight: 1.6, color: C.body, margin: '24px 0 0', maxWidth: 500 }}>שולחים את ההזמנות, ומי ששכח כבר יקבל תזכורת. האישורים נאספים לבד, בתוך וואטסאפ. אנחנו נרדוף אחרי האישורים, אתם תרדפו אחרי הרחבה.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px 18px', marginTop: 24, flexWrap: 'wrap' }}>
                {['בלי התחייבות ובלי מנוי', 'וואטסאפ העסקי הרשמי', ...(featureFlags.claimRefund14Days ? ['החזר מלא תוך 14 יום'] : ['משלמים פעם אחת לאירוע'])].map((t) => (
                  <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: C.body, whiteSpace: 'nowrap' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.lavMid }} />{t}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 24, marginTop: 36 }}>
              <StartCard />
              <HeroChat />
            </div>
          </div>
        </section>

        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '44px clamp(16px,2vw,24px) 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <span style={compact ? hide : { fontSize: 13.5, color: '#6B6660', whiteSpace: 'nowrap' }}>מתאים לכל שמחה</span>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', maskImage: 'linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)', WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)' }}>
              <div style={{ display: 'flex', width: 'max-content', alignItems: 'center', opacity: 0.8, animation: 'su-marq-rtl 26s linear infinite' }}>
                {[0, 1].map((k) => (
                  <div key={k} aria-hidden={k ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 46, paddingInlineEnd: 46 }}>
                    {MARQUEE_EVENTS.map((t) => (
                      <span key={t} style={{ fontSize: 17, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 46 }}>
                        {t}<span style={{ width: 4, height: 4, borderRadius: '50%', background: C.lav }} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <section id="what" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(72px,9vw,104px) clamp(16px,2vw,24px) 0' }}>
          <div style={sectionHead('what')}>מה באמת מקבלים פה</div>
          <h2 style={{ margin: '12px 0 0', fontSize: 'clamp(28px,3vw,38px)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.15 }}>זאת לא עוד תוכנה. זה שקט נפשי.</h2>
          <p style={{ fontSize: 17, lineHeight: 1.7, color: C.mutedSoft, margin: '14px 0 0', maxWidth: 600 }}>תכף תרגישו שיש לכם צוות שלם מאחורי הקלעים. כזה שזוכר הכול, רודף אחרי האישורים במקומכם, ולא נלחץ אפילו יומיים לפני.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: '36px 32px', marginTop: 56 }}>
            {[
              { i: 'auto_awesome', t: 'עוזר אישי שמבין עניין', d: 'שואלים אותו בוואטסאפ, והוא עונה. כמה אישרו, מי עוד לא ענה, מי ביקש צמחוני. כאילו שכרתם מפיק, רק בלי המחיר של מפיק.' },
              { i: 'person_add', t: 'שלא תדעו מאקסלים', d: 'שולחים את אנשי הקשר בוואטסאפ, או מעלים קובץ, והרשימה מסתדרת. בלי הקלדה ידנית, בלי קובץ שנעלם בדיוק כשצריך אותו.' },
              { i: 'how_to_reg', t: 'אישור הגעה בלחיצה', d: 'האורחים עונים ישר בוואטסאפ, בלחיצה אחת. בלי אפליקציה להוריד, בלי לינק מסתורי, בלי טופס שאף אחד לא ממלא.' },
              { i: 'forum', t: 'שואלים, ומקבלים תשובה', d: '״כמה אישרו?״ ״מי עוד לא ענה?״ הוא עונה על המקום. גם ב־2 בלילה, כשאתם לא מצליחים להירדם.' },
            ].map((f) => (
              <div key={f.t} style={{ borderTop: `1px solid ${C.fieldSignup}`, paddingTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 40, height: 40, borderRadius: 11, background: '#F1EDFB', color: LD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ms style={{ fontSize: 21, fontWeight: 400 }}>{f.i}</Ms></span>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em', marginTop: 18 }}>{f.t}</div>
                <div style={{ fontSize: 15, lineHeight: 1.75, color: C.mutedSoft }}>{f.d}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="how" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(72px,9vw,104px) clamp(16px,2vw,24px) 0' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={sectionHead('how')}>הכול קורה בוואטסאפ</div>
            <h2 style={{ margin: '12px auto 0', fontSize: 'clamp(36px,5vw,64px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.02, maxWidth: 820 }}>אתם מארגנים אירוע, לא מערכת.</h2>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: C.mutedSoft, margin: '18px auto 0', maxWidth: 600 }}>המעקב, התזכורות והתשובות לאורחים? עלינו. אתם פשוט רואים איך האישורים נכנסים, אחד אחרי השני.</p>
          </div>
          <div style={{ marginTop: 64 }}>
            {MOMENTS.map((m, i) => {
              const visFirst = i % 2 === 0;
              const V = m.V;
              return (
                <div key={m.n} style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0,1fr)' : 'minmax(0,1fr) 58px minmax(0,1fr)', alignItems: 'center' }}>
                  <div style={{ order: compact ? 2 : visFirst ? 1 : 3, padding: compact ? '0 0 48px' : '0 0 72px', display: 'flex', justifyContent: compact ? 'stretch' : visFirst ? 'flex-end' : 'flex-start' }}>
                    <div style={{ width: '100%', maxWidth: 560 }}><V /></div>
                  </div>
                  <div style={compact ? hide : { order: 2, position: 'relative', display: 'flex', justifyContent: 'center', alignSelf: 'stretch' }}>
                    <span style={{ width: 2, background: C.line }} />
                    <span style={{ position: 'absolute', top: 'calc(50% - 38px)', width: 11, height: 11, borderRadius: '50%', background: LD, boxShadow: `0 0 0 4px ${C.paper}` }} />
                  </div>
                  <div style={{ order: compact ? 1 : visFirst ? 3 : 1, padding: compact ? '0 0 18px' : '0 0 72px', display: 'flex', justifyContent: compact ? 'flex-start' : visFirst ? 'flex-start' : 'flex-end' }}>
                    <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <span className="num" style={{ fontSize: 15, fontWeight: 600, color: LD }}>{m.n}</span>
                      <div style={{ fontSize: 'clamp(26px,2.6vw,36px)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.08 }}>{m.t}</div>
                      <div style={{ fontSize: 15.5, lineHeight: 1.65, color: C.mutedSoft }}>{m.note}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 6 }}>
                        {m.bullets.map((b) => (
                          <span key={b} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 500 }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', background: LT, color: LD, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Ms style={{ fontSize: 15, fontWeight: 500 }}>check</Ms></span>{b}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <CallsSection compact={compact} />
        <AssistantSection />
        <PricingSection />

        <section style={{ marginTop: 'clamp(72px,9vw,96px)', background: '#F5F2EC', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', padding: '56px clamp(16px,2vw,24px)' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1.35 1 420px', minWidth: 0, background: '#FFFFFF', border: '1px solid #E4DFD4', borderRadius: 20, padding: '26px 30px', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
                <span style={{ width: 76, height: 76, borderRadius: 20, background: '#E9F6EE', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><WhatsAppIcon style={{ fontSize: 40, color: C.waGreen }} /></span>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>וואטסאפ העסקי הרשמי</div>
                  <div style={{ fontSize: 14.5, color: C.mutedSoft, lineHeight: 1.55, marginTop: 6, maxWidth: 440 }}>ההודעות יוצאות ממספר עסקי של ShowUp, עם השמות שלכם בתוך ההודעה. לא מהטלפון הפרטי שלכם.</div>
                </div>
              </div>
              <div style={{ flex: '1 1 330px', minWidth: 0, background: '#FFFFFF', border: '1px solid #E4DFD4', borderRadius: 20, padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: '#EDF4E7', color: '#2E7D5B', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Ms style={{ fontSize: 19 }}>shield</Ms></span>
                  <div><div style={{ fontSize: 15, fontWeight: 600 }}>הרשימה שלכם</div><div style={{ fontSize: 13.5, color: C.mutedSoft, lineHeight: 1.55, marginTop: 3 }}>משמשת רק לשליחת ההודעות של האירוע שלכם, ולא עוברת לאף אחד.</div></div>
                </div>
                <div style={{ height: 1, background: C.line2 }} />
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: '#EFEBFA', color: '#4B3E8E', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Ms style={{ fontSize: 19 }}>lock</Ms></span>
                  <div><div style={{ fontSize: 15, fontWeight: 600 }}>תשלום מאובטח</div><div style={{ fontSize: 13.5, color: C.mutedSoft, lineHeight: 1.55, marginTop: 3 }}>התשלום מתבצע בעמוד הסליקה המאובטח, ופרטי האשראי לא נשמרים אצלנו.{featureFlags.claimInvoiceEmail ? ' חשבונית נשלחת למייל.' : ''}</div></div>
                </div>
              </div>
            </div>
            {featureFlags.landingTestimonial && (
              <figure style={{ margin: '44px 0 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px 32px' }}>
                {/* Real, approved testimonial goes here (see DESIGN_GAP.md). */}
              </figure>
            )}
          </div>
        </section>

        <FaqSection compact={compact} />

        <section id="cta" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(72px,9vw,104px) clamp(16px,2vw,24px) 0' }}>
          <div style={{ background: LD, color: '#FFFFFF', borderRadius: 26, overflow: 'hidden', display: 'flex', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 460px', minWidth: 0, padding: 'clamp(28px,5vw,56px) clamp(22px,4.5vw,52px)' }}>
              <div style={{ fontSize: 19, color: '#E4DAFA', fontWeight: 500 }}>אנחנו נרדוף אחרי האישורים.</div>
              <h2 style={{ margin: '12px 0 0', fontSize: 'clamp(34px,4.4vw,56px)', fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.02, maxWidth: 560 }}>אתם תרדפו אחרי הרחבה.</h2>
              <div style={{ fontSize: 16, color: '#EDE6FB', lineHeight: 1.6, marginTop: 18, maxWidth: 480 }}>כמה פרטים, ויש לכם לוח הודעות מוכן לאירוע. משלמים פעם אחת, ומתחילים להוסיף אורחים.</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 30, flexWrap: 'wrap' }}>
                <Link to="/wizard" className="su-hover-white" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 16, fontWeight: 600, background: '#FFFFFF', color: C.purpleDark, borderRadius: 12, padding: '15px 26px' }}>יוצאים לדרך<Ms style={{ fontSize: 20 }}>arrow_back</Ms></Link>
                <a href="#top" className="su-hover-ghost-white" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 500, color: '#FFFFFF', border: '1px solid rgba(255,255,255,.5)', borderRadius: 12, padding: '15px 22px' }}><WhatsAppIcon style={{ fontSize: 18 }} />שלחו לי הודעה לדוגמה</a>
              </div>
              <div style={{ display: 'flex', gap: '6px 18px', marginTop: 22, flexWrap: 'wrap', fontSize: 13.5, color: '#E4DAFA' }}>
                <span>החל מ־{minPrice} לאירוע</span><span>בלי מנוי</span>{featureFlags.claimRefund14Days && <span>החזר מלא תוך 14 יום</span>}
              </div>
            </div>
            <div style={{ flex: '1 1 360px', minWidth: 0, minHeight: 300, position: 'relative' }}>
              <img src="/brand/guest-phone.jpg" alt="אורחת מאשרת הגעה מהטלפון" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </div>
        </section>
      </main>

      <footer style={{ marginTop: 'clamp(72px,9vw,104px)', background: LT, borderTop: `1px solid ${LB}` }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '44px clamp(16px,2vw,24px) 0' }}>
          <div style={{ display: 'flex', gap: '32px 56px', paddingBottom: 34, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><img src="/brand/seal.png" alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} /><span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.03em' }}>ShowUp</span></div>
              <div style={{ fontSize: 14, color: C.body, lineHeight: 1.6 }}>אתם מזמינים. אנחנו דואגים שכולם יגיעו. אישורי הגעה בוואטסאפ לחתונות, בר ובת מצווה, בריתות ואירועי חברה.</div>
            </div>
            <div style={{ flex: '1 1 480px', minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 24 }}>
              {[
                { t: 'המוצר', items: [['מה מקבלים', '#what'], ['איך זה עובד', '#how'], ['שיחות טלפון', '#calls'], ['העוזר', '#assistant'], ['תעריפים', '#pricing']] },
                { t: 'עזרה', items: [['שאלות נפוצות', '#faq'], ['וואטסאפ אלינו', '/go/whatsapp']] },
                { t: 'חשבון', items: [['התחברות', '/login'], ['יוצאים לדרך', '/wizard']] },
              ].map((col) => (
                <div key={col.t} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.04em', color: C.purpleDark }}>{col.t}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                    {col.items.map(([t, href]) => href.startsWith('#')
                      ? <a key={t} href={href} style={{ fontSize: 14, fontWeight: 400, color: C.body, lineHeight: 1.35 }}>{t}</a>
                      : <Link key={t} to={href} style={{ fontSize: 14, fontWeight: 400, color: C.body, lineHeight: 1.35 }}>{t}</Link>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: `20px 0 ${compact ? 96 : 26}px`, borderTop: `1px solid ${LB}`, display: 'flex', alignItems: 'center', gap: '12px 22px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: C.body }}>© {new Date().getFullYear()} ShowUp</span>
            <Link to="/terms" style={{ fontSize: 13, fontWeight: 400, color: C.body }}>תנאי שימוש</Link>
            <Link to="/privacy" style={{ fontSize: 13, fontWeight: 400, color: C.body }}>פרטיות</Link>
            <Link to="/accessibility" style={{ fontSize: 13, fontWeight: 400, color: C.body }}>הצהרת נגישות</Link>
          </div>
        </div>
      </footer>

      {compact && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', background: 'rgba(250,248,244,.96)', backdropFilter: 'blur(10px)', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.35, color: C.mutedSoft }}>החל מ־{minPrice} לאירוע<br />בלי מנוי</span>
          <Link to="/wizard" style={{ display: 'inline-flex', alignItems: 'center', height: 48, padding: '0 20px', borderRadius: 12, background: C.lav, color: C.ink, fontSize: 15.5, fontWeight: 600, whiteSpace: 'nowrap' }}>יוצאים לדרך</Link>
        </div>
      )}
    </div>
  );
}
