import React, { useMemo, useState } from 'react';
import { color as C } from '../../design/tokens';
import {
  useGuestImports,
  GuestImportContact,
  approveGuestImportContactWithData,
  rejectGuestImportContact,
  updateGuestImportContact,
} from '../../hooks/useGuestImports';
import { Kicker, Chip, Btn, Ms, initialsOf } from './ui';
import { agoLabel } from '../../adapters/eventSnapshot';

/** Phone sanity for contacts that came in from WhatsApp. */
function phoneIssue(raw: string | null): { kind: 'err' | 'warn'; label: string; hint: string } | null {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return { kind: 'err', label: 'מספר חסר', hint: 'אין מספר טלפון. אפשר להוסיף כאן' };
  const local = d.startsWith('972') ? `0${d.slice(3)}` : d;
  if (local.startsWith('0')) {
    if (local.length < 10 && local.startsWith('05')) return { kind: 'err', label: 'מספר חסר', hint: `חסרות ${10 - local.length} ספרות במספר` };
    if (local.length < 9) return { kind: 'err', label: 'מספר חסר', hint: 'המספר קצר מדי' };
    return null;
  }
  return { kind: 'warn', label: 'מספר מחו״ל', hint: 'ההודעות יישלחו גם למספר מחו״ל' };
}

const pill = (on: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, height: 40, padding: '0 12px', borderRadius: 11,
  fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
  border: `1.5px solid ${on ? C.purple : C.field}`, background: on ? C.tintApp : '#FFFFFF', color: on ? C.purpleDark : C.ink,
});
const field: React.CSSProperties = { minHeight: 48, padding: '0 14px', borderRadius: 13, background: '#FFFFFF', border: `1.5px solid ${C.field}`, fontSize: 15, width: '100%', fontFamily: 'inherit', color: C.ink };

interface Props {
  groups: string[];
  onChanged: () => void;
}

/**
 * "ממתינים לאישור · מוואטסאפ" (Platform v6 guests screen): contacts the host
 * shared to the ShowUp WhatsApp number wait here and become guests only after
 * approve / edit. Backed by /api/guest-imports (approve, reject, update).
 */
export default function PendingImportsPanel({ groups, onChanged }: Props) {
  const { imports, loading, refresh } = useGuestImports();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; phone: string; party: number; group: string }>({ name: '', phone: '', party: 1, group: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [handledAll, setHandledAll] = useState(false);

  const contacts = useMemo(() => {
    const out: (GuestImportContact & { at: string })[] = [];
    imports.forEach((imp) => (imp.contacts || []).forEach((c) => {
      if (c.status === 'pending' || c.status === 'validated') out.push({ ...c, at: c.created_at || imp.created_at });
    }));
    return out;
  }, [imports]);

  const done = () => { refresh(); onChanged(); };

  const approve = async (c: GuestImportContact, withDraft: boolean) => {
    setBusy(c.id); setErr(null);
    try {
      if (withDraft) {
        if (draft.name !== (c.name || '') || draft.phone !== (c.phone || '')) {
          await updateGuestImportContact(c.id, { name: draft.name.trim(), phone: draft.phone.trim() });
        }
        await approveGuestImportContactWithData(c.id, { name: draft.name.trim() || undefined, group: draft.group || undefined, import_count: draft.party });
      } else {
        await approveGuestImportContactWithData(c.id, {});
      }
      setEditing(null);
      done();
    } catch (e: any) {
      setErr(e?.message || 'לא הצלחנו לאשר. נסו שוב');
    } finally { setBusy(null); }
  };

  const dismiss = async (c: GuestImportContact) => {
    setBusy(c.id); setErr(null);
    try { await rejectGuestImportContact(c.id); done(); } catch (e: any) { setErr(e?.message || 'לא הצלחנו להסיר. נסו שוב'); } finally { setBusy(null); }
  };

  const approveAll = async () => {
    setBusy('all'); setErr(null);
    let failed = 0;
    for (const c of contacts) {
      if (phoneIssue(c.phone)?.kind === 'err') continue; // needs a fix first
      try { await approveGuestImportContactWithData(c.id, {}); } catch { failed += 1; }
    }
    setBusy(null);
    if (failed) setErr(`${failed} אנשי קשר לא אושרו. נסו שוב`);
    setHandledAll(true);
    done();
  };

  const openEdit = (c: GuestImportContact) => {
    if (editing === c.id) { setEditing(null); return; }
    setDraft({ name: c.name || '', phone: c.phone || '', party: 1, group: '' });
    setEditing(c.id);
  };

  if (loading && !contacts.length) return null;
  if (!contacts.length) {
    if (!handledAll) return null;
    return (
      <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderRadius: 14, background: C.okBg, border: `1.5px solid ${C.okBorder}`, color: C.ok, fontSize: 14, fontWeight: 600 }}>
        <Ms size={19}>check_circle</Ms>כל אנשי הקשר מוואטסאפ טופלו. מה שאושר נוסף לרשימה
      </div>
    );
  }

  const blocked = contacts.filter((c) => phoneIssue(c.phone)?.kind === 'err').length;

  return (
    <section aria-label="ממתינים לאישור" style={{ background: '#FFFFFF', border: `1.5px solid ${C.tintBorder}`, borderRadius: 20, padding: 'clamp(18px,2.2vw,24px)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Kicker>ממתינים לאישור · מוואטסאפ</Kicker>
          <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: '8px 0 0' }}>{contacts.length === 1 ? 'איש קשר אחד הגיע מוואטסאפ' : `${contacts.length} אנשי קשר הגיעו מוואטסאפ`}</h3>
          <p style={{ fontSize: 14, color: C.body, margin: '6px 0 0', lineHeight: 1.6, maxWidth: '62ch' }}>אנשי קשר ששלחתם בוואטסאפ למספר של ShowUp. הם נכנסים לרשימת המוזמנים רק אחרי שתאשרו או תתקנו</p>
        </div>
        <Btn kind="ghost" onClick={approveAll} disabled={busy !== null || blocked === contacts.length}>
          {busy === 'all' ? 'מאשרים...' : blocked ? `אישור ${contacts.length - blocked} התקינים` : 'אישור הכול'}
        </Btn>
      </div>
      {err && <div role="alert" style={{ marginTop: 10, fontSize: 13.5, fontWeight: 500, color: C.danger }}>{err}</div>}
      <div style={{ marginTop: 8 }}>
        {contacts.map((c) => {
          const issue = phoneIssue(c.phone);
          const isEd = editing === c.id;
          const at = c.at ? new Date(c.at) : null;
          return (
            <div key={c.id} style={{ padding: '14px 0', borderBottom: `1.5px solid ${C.line2}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <span style={{ width: 40, height: 40, flex: 'none', borderRadius: '50%', background: C.tintApp, color: C.purpleDark, fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initialsOf(c.name || '') || <Ms size={18}>person</Ms>}</span>
                <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{c.name || 'בלי שם'}</span>
                  <span className="ltr num" style={{ display: 'block', fontSize: 12.5, color: C.muted, marginTop: 3, textAlign: 'right' }}>{c.phone || '—'}</span>
                </span>
                <span style={{ flex: '1 1 150px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.body }}>
                  <Ms size={17} style={{ color: C.purple }}>forward_to_inbox</Ms>הגיע {at ? (agoLabel(at).includes(':') ? `היום ${agoLabel(at)}` : agoLabel(at)) : ''}
                </span>
                {issue && <Chip tone={issue.kind}>{issue.label}</Chip>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Btn kind="smallGhost" onClick={() => openEdit(c)} disabled={busy !== null}>{isEd ? 'סגירה' : 'עריכה'}</Btn>
                  <Btn kind="smallPrimary" onClick={() => (issue?.kind === 'err' ? openEdit(c) : approve(c, false))} disabled={busy !== null}>{busy === c.id ? '...' : 'אישור'}</Btn>
                  <button type="button" aria-label={`לא להוסיף את ${c.name || 'איש הקשר'}`} onClick={() => dismiss(c)} disabled={busy !== null} className="su-hover-danger" style={{ width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: '#FFFFFF', color: C.muted, border: `1.5px solid ${C.field}`, cursor: 'pointer' }}>
                    <Ms size={18}>close</Ms>
                  </button>
                </div>
              </div>
              {isEd && (
                <div style={{ marginTop: 14, padding: 18, borderRadius: 16, background: C.paperSoft, border: `1.5px solid ${C.lineApp}`, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 16 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>שם</span>
                    <input className="su-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={field} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>טלפון</span>
                    <input className="su-input num" dir="ltr" inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={{ ...field, textAlign: 'left', borderColor: phoneIssue(draft.phone)?.kind === 'err' ? C.err : C.field }} />
                    {phoneIssue(draft.phone) && <span style={{ fontSize: 12.5, color: phoneIssue(draft.phone)!.kind === 'err' ? C.err : C.muted }}>{phoneIssue(draft.phone)!.hint}</span>}
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>כמה אנשים</span>
                    <span role="radiogroup" aria-label="כמה אנשים" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={draft.party === n} onClick={() => setDraft({ ...draft, party: n })} style={pill(draft.party === n)}>{n === 5 ? '5+' : n}</button>
                      ))}
                    </span>
                  </div>
                  {groups.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>קבוצה</span>
                      <span role="radiogroup" aria-label="קבוצה" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {groups.slice(0, 6).map((g) => (
                          <button key={g} type="button" role="radio" aria-checked={draft.group === g} onClick={() => setDraft({ ...draft, group: draft.group === g ? '' : g })} style={pill(draft.group === g)}>{g}</button>
                        ))}
                      </span>
                    </div>
                  )}
                  <div style={{ gridColumn: '1/-1', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Btn onClick={() => approve(c, true)} disabled={busy !== null || phoneIssue(draft.phone)?.kind === 'err' || !draft.name.trim()}>שמירה והוספה למוזמנים</Btn>
                    <Btn kind="ghost" onClick={() => setEditing(null)}>ביטול</Btn>
                    <span style={{ fontSize: 13, color: C.muted }}>לא נשלחת הודעה למוזמן בעקבות האישור</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
