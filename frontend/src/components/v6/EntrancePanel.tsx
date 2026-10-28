import React, { useCallback, useEffect, useState } from 'react';
import { color as C } from '../../design/tokens';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { Btn, Ms } from './ui';

/**
 * "כניסה לאולם" on the seating page - two ways the list reaches the door:
 * 1. ShowUp's hostess screen (/hostess/:token) on any tablet or phone.
 * 2. An Excel for the venue's seating system (iPlan etc.); their own hostess
 *    app syncs from there. iPlan has no public API, so a file is the bridge.
 */
type Link = { enabled: boolean; token: string | null; path: string | null; expires_at: string | null };

export default function EntrancePanel({ eventId }: { eventId?: string }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    const r = await fetchWithAuth(`/api/events/${eventId}/hostess`);
    if (r.ok) setLink(await r.json());
  }, [eventId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const url = link?.path ? `${window.location.origin}${link.path}` : '';

  const act = async (method: 'POST' | 'DELETE', rotate = false) => {
    if (!eventId) return;
    setBusy(true); setMsg(null); setConfirmRevoke(false);
    try {
      const r = await fetchWithAuth(`/api/events/${eventId}/hostess${rotate ? '?rotate=true' : ''}`, { method });
      if (r.status === 403) { setMsg('רק מי שמנהל את האירוע יכול לשנות את הקישור.'); return; }
      if (!r.ok) throw new Error();
      if (method === 'DELETE') setLink({ enabled: false, token: null, path: null, expires_at: null });
      else setLink(await r.json());
    } catch { setMsg('הפעולה לא הצליחה. נסו שוב.'); } finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setMsg('לא הצלחנו להעתיק. סמנו את הקישור והעתיקו ידנית.'); }
  };

  const download = async () => {
    if (!eventId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetchWithAuth(`/api/guests/export/seating?event_id=${eventId}`);
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'הושבה-לאולם.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch { setMsg('ההורדה לא הצליחה. נסו שוב.'); } finally { setBusy(false); }
  };

  return (
    <section style={{ background: '#FFFFFF', border: `1.5px solid ${C.lineApp}`, borderRadius: 16, overflow: 'hidden' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', border: 'none', background: 'transparent', fontFamily: 'inherit', color: C.ink, cursor: 'pointer', textAlign: 'right' }}>
        <Ms size={22} style={{ color: C.purple }}>door_open</Ms>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600 }}>כניסה לאולם</span>
          <span style={{ display: 'block', fontSize: 13, color: C.muted }}>מסך למארחת בכניסה, או קובץ למערכת ההושבה של האולם (iPlan)</span>
        </span>
        <Ms size={22} style={{ color: C.muted }}>{open ? 'expand_less' : 'expand_more'}</Ms>
      </button>

      {open && (
        <div style={{ borderTop: `1.5px solid ${C.line2}`, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>מסך מארחת של ShowUp</div>
            <div style={{ fontSize: 13.5, color: C.body, lineHeight: 1.55 }}>
              עובד על כל טאבלט או טלפון, בלי התקנה ובלי סיסמה. המארחת מחפשת שם, רואה את השולחן ומסמנת כמה הגיעו. אפשר לפתוח אותו בכמה מכשירים במקביל.
            </div>
            {link?.enabled ? (
              <>
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="קישור למארחת" dir="ltr"
                  style={{ minHeight: 44, padding: '0 12px', borderRadius: 12, border: `1.5px solid ${C.field}`, background: C.paperSoft, fontSize: 13.5, fontFamily: 'inherit', color: C.ink, minWidth: 0 }} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn kind="smallPrimary" onClick={copy}><Ms size={18}>{copied ? 'check' : 'content_copy'}</Ms>{copied ? 'הועתק' : 'העתקת הקישור'}</Btn>
                  <a href={link.path!} target="_blank" rel="noreferrer" className="su-hover-ink" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${C.field}`, color: C.ink, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}><Ms size={18}>open_in_new</Ms>פתיחה</a>
                </div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
                  מי שיש לו את הקישור רואה את שמות האורחים והשולחנות. הקישור מפסיק לעבוד יומיים אחרי האירוע.
                </div>
                {confirmRevoke ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
                    <span>לבטל? מי שפתח את הקישור יאבד גישה.</span>
                    <Btn kind="smallGhost" disabled={busy} onClick={() => act('DELETE')} style={{ color: C.danger }}>כן, לבטל</Btn>
                    <Btn kind="smallGhost" onClick={() => setConfirmRevoke(false)}>לא</Btn>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 14 }}>
                    <button type="button" disabled={busy} onClick={() => act('POST', true)} style={linkBtn}>קישור חדש (הישן יפסיק לעבוד)</button>
                    <button type="button" onClick={() => setConfirmRevoke(true)} style={{ ...linkBtn, color: C.danger }}>ביטול הקישור</button>
                  </div>
                )}
              </>
            ) : (
              <Btn kind="smallPrimary" disabled={busy || !link} onClick={() => act('POST')} style={{ alignSelf: 'flex-start' }}><Ms size={18}>add_link</Ms>יצירת קישור למארחת</Btn>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>האולם עובד עם iPlan?</div>
            <div style={{ fontSize: 13.5, color: C.body, lineHeight: 1.55 }}>
              מורידים קובץ אקסל ומעלים אותו למערכת ההושבה של האולם. משם הרשימה מגיעה לאפליקציית ה-Hostess שלהם בכניסה. בקובץ רק מי שאישר הגעה: שורה לכל הזמנה, עם כמות המגיעים, קבוצה ושולחן אם כבר שובץ.
            </div>
            <Btn kind="smallGhost" disabled={busy} onClick={download} style={{ alignSelf: 'flex-start' }}><Ms size={18}>download</Ms>הורדת קובץ להושבה באולם</Btn>
          </div>

          {msg && <div role="alert" style={{ gridColumn: '1 / -1', fontSize: 13.5, color: C.danger, fontWeight: 500 }}>{msg}</div>}
        </div>
      )}
    </section>
  );
}

const linkBtn: React.CSSProperties = { border: 'none', background: 'transparent', padding: 0, color: C.purple, fontWeight: 600, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', minHeight: 32 };
