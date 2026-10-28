import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { color as C } from '../design/tokens';
import { Btn, Chip, Ms } from '../components/v6/ui';

/**
 * Entrance hostess mode. Route: /hostess/:token (public - the link is the credential).
 * Runs on any tablet or phone at the door; several devices can work the same
 * event at once (polling + idempotent check-in on the server).
 * Backend: core-service app/routers/hostess.py.
 */

type HGuest = {
  id: string; name: string; group: string; table: number | null; status: string;
  expected: number; phone_tail: string; arrived: number; seated_table: number | null; arrived_at: string | null;
};
type HWalkin = { id: string; name: string; group: string; note: string; count: number; table: number | null; arrived_at: string };
type HTable = { number: number; name: string; seats: number; planned: number; seated: number };
type HData = {
  event: { name: string; event_date: string | null; location: string | null };
  tables: HTable[]; guests: HGuest[]; walkins: HWalkin[];
  stats: { expected_people: number; arrived_people: number; arrived_parties: number; walkin_people: number };
};

type Filter = 'all' | 'waiting' | 'arrived' | 'walkins';
type Sheet = { kind: 'guest'; id: string } | { kind: 'walkin'; id: string | null } | null;

const POLL_MS = 8000;
const CONFIRMED = new Set(['attending', 'confirmed']);

/** Hebrew-tolerant search key: no niqqud/punctuation, final letters folded. */
function norm(s: string): string {
  return (s || '')
    .normalize('NFKD').replace(/[֑-ׇ]/g, '')
    .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
    .replace(/["'״׳`.,\-_()]/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function matches(q: string, name: string, extra: string[]): boolean {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = norm(name).split(' ');
  return words.every((w) => hay.some((h) => h.startsWith(w)) || extra.some((x) => x && x.startsWith(w)));
}

const people = (n: number) => (n === 1 ? 'אדם אחד' : `${n} אנשים`);

function statusChip(g: HGuest) {
  if (CONFIRMED.has(g.status)) return null;
  if (g.status === 'declined') return <Chip tone="err">אמר שלא מגיע</Chip>;
  if (g.status === 'maybe') return <Chip tone="warn">אמר אולי</Chip>;
  return <Chip tone="warn">לא אישר</Chip>;
}

export default function HostessMode() {
  const { token = '' } = useParams<{ token: string }>();
  const base = `/api/public/hostess/${encodeURIComponent(token)}`;
  const [data, setData] = useState<HData | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'guests' | 'tables'>('guests');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(base, { cache: 'no-store' });
      if (r.status === 404) { setFatal('הקישור לא תקף. בקשו מבעלי האירוע קישור חדש.'); return; }
      if (r.status === 410) { setFatal('האירוע הסתיים והקישור כבר לא פעיל.'); return; }
      if (!r.ok) throw new Error();
      const body: HData = await r.json();
      if (!busyRef.current) setData(body);
      setOffline(false);
    } catch { setOffline(true); }
  }, [base]);

  useEffect(() => {
    load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => { document.title = data?.event.name ? `כניסה · ${data.event.name}` : 'כניסה לאירוע'; }, [data?.event.name]);

  const call = useCallback(async (path: string, method: string, body?: unknown) => {
    busyRef.current = true;
    try {
      const r = await fetch(`${base}${path}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error(String(r.status));
      setOffline(false);
      return true;
    } catch {
      setToast({ text: 'לא נשמר. בדקו את החיבור לאינטרנט ונסו שוב.' });
      return false;
    } finally {
      busyRef.current = false;
      load();
    }
  }, [base, load]);

  /** Free seats per table = seats - already seated - held for confirmed parties not yet here. */
  const tableInfo = useMemo(() => {
    const m = new Map<number, HTable & { held: number; free: number }>();
    for (const t of data?.tables || []) m.set(t.number, { ...t, held: 0, free: 0 });
    for (const g of data?.guests || []) {
      if (!g.arrived && g.table != null && CONFIRMED.has(g.status) && m.has(g.table)) m.get(g.table)!.held += g.expected;
    }
    m.forEach((t) => { t.free = t.seats - t.seated - t.held; });
    return m;
  }, [data]);

  const tableLabel = (n: number | null) => {
    if (n == null) return '';
    const t = tableInfo.get(n);
    return t?.name && t.name !== `שולחן ${n}` ? `שולחן ${n} · ${t.name}` : `שולחן ${n}`;
  };

  const list = useMemo(() => {
    if (!data) return { guests: [] as HGuest[], walkins: [] as HWalkin[] };
    const qn = norm(q);
    const digits = q.replace(/\D/g, '');
    const g = data.guests.filter((x) => {
      if (filter === 'waiting' && x.arrived) return false;
      if (filter === 'arrived' && !x.arrived) return false;
      if (filter === 'walkins') return false;
      if (!qn) return true;
      return matches(q, x.name, [norm(x.group), digits && x.phone_tail.endsWith(digits) ? digits : '',
        digits && String(x.table ?? '') === digits ? digits : '']);
    });
    // Not-yet-arrived first, then by name - the door works through who is still coming.
    g.sort((a, b) => (a.arrived ? 1 : 0) - (b.arrived ? 1 : 0) || a.name.localeCompare(b.name, 'he'));
    const w = (filter === 'all' || filter === 'walkins' || filter === 'arrived')
      ? data.walkins.filter((x) => !qn || matches(q, x.name, [norm(x.group)])) : [];
    return { guests: g, walkins: w };
  }, [data, q, filter]);

  if (fatal) {
    return (
      <Shell>
        <div style={{ maxWidth: 420, margin: '18vh auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <Ms size={40} style={{ color: C.purple }}>link_off</Ms>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{fatal}</div>
        </div>
      </Shell>
    );
  }
  if (!data) {
    return <Shell><div style={{ textAlign: 'center', marginTop: '20vh', color: C.muted }}>טוענים את רשימת האורחים…</div></Shell>;
  }

  const s = data.stats;
  const guest = sheet?.kind === 'guest' ? data.guests.find((g) => g.id === sheet.id) || null : null;
  const walkin = sheet?.kind === 'walkin' && sheet.id ? data.walkins.find((w) => w.id === sheet.id) || null : null;
  const closeSheet = () => { setSheet(null); window.setTimeout(() => searchRef.current?.focus(), 50); };

  const checkIn = async (g: HGuest, count: number, table: number | null) => {
    const wasArrived = g.arrived;
    const prev = { count: g.arrived, table: g.seated_table };
    closeSheet();
    const ok = await call('/checkins', 'POST', { guest_id: g.id, count, table_number: table });
    if (!ok) return;
    setQ('');
    setToast({
      text: `${g.name} - ${people(count)}${table != null ? `, ${tableLabel(table)}` : ''}`,
      undo: () => (wasArrived
        ? call('/checkins', 'POST', { guest_id: g.id, count: prev.count, table_number: prev.table })
        : call(`/checkins/${g.id}`, 'DELETE')),
    });
  };

  return (
    <Shell>
      <header style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 5, background: C.paperApp, paddingBlock: '14px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ fontSize: 12, letterSpacing: '.06em', color: C.muted, fontWeight: 600 }}>כניסה לאירוע</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.event.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
            <Figure value={`${s.arrived_people}`} sub={`מתוך ${s.expected_people} שאישרו`} label="הגיעו" />
            <Figure value={`${s.arrived_parties}`} sub="הזמנות" label="נכנסו" />
          </div>
        </div>
        {offline && (
          <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 12, background: C.warnBg, border: `1.5px solid ${C.warnBorder}`, color: C.warn, fontSize: 14 }}>
            <Ms size={18}>wifi_off</Ms> אין חיבור. הרשימה אולי לא מעודכנת, שינויים לא נשמרים עד שהחיבור יחזור.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Seg on={view === 'guests'} onClick={() => setView('guests')} icon="person_search">אורחים</Seg>
          <Seg on={view === 'tables'} onClick={() => setView('tables')} icon="table_restaurant">שולחנות</Seg>
          <span style={{ flex: 1 }} />
          <Btn kind="smallPrimary" onClick={() => setSheet({ kind: 'walkin', id: null })}><Ms size={18}>person_add</Ms>אורח שלא ברשימה</Btn>
        </div>
        {view === 'guests' && (
          <>
            <div style={{ position: 'relative' }}>
              <Ms size={24} style={{ position: 'absolute', right: 14, top: 15, color: C.muted }}>search</Ms>
              <input
                ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="שם, סוף הטלפון או מספר שולחן"
                inputMode="search" enterKeyHint="search" autoComplete="off" aria-label="חיפוש אורח"
                style={{ width: '100%', boxSizing: 'border-box', minHeight: 54, padding: '0 48px 0 52px', borderRadius: 14, border: `1.5px solid ${C.field}`, background: '#FFFFFF', fontSize: 18, fontFamily: 'inherit', color: C.ink }}
              />
              {q && <button type="button" aria-label="ניקוי החיפוש" onClick={() => { setQ(''); searchRef.current?.focus(); }} style={{ position: 'absolute', left: 6, top: 5, width: 44, height: 44, border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer' }}><Ms size={22}>close</Ms></button>}
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {([['all', 'הכל'], ['waiting', 'עוד לא הגיעו'], ['arrived', 'הגיעו'], ['walkins', 'לא ברשימה']] as [Filter, string][]).map(([k, label]) => (
                <Seg key={k} small on={filter === k} onClick={() => setFilter(k)}>{label}</Seg>
              ))}
            </div>
          </>
        )}
      </header>

      {view === 'guests' ? (
        <main style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBlock: '4px 120px' }}>
          {list.guests.map((g) => (
            <button key={g.id} type="button" onClick={() => setSheet({ kind: 'guest', id: g.id })} style={rowStyle(!!g.arrived)}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 17.5, fontWeight: 600 }}>{g.name}</span>
                  {statusChip(g)}
                  {g.arrived > 0 && <Chip tone="ok">הגיעו {g.arrived}</Chip>}
                </span>
                <span style={{ fontSize: 13.5, color: C.muted }}>
                  {[g.group, people(g.expected), g.phone_tail && `טלפון שמסתיים ב-${g.phone_tail}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <TableBadge n={g.seated_table ?? g.table} />
            </button>
          ))}
          {list.walkins.map((w) => (
            <button key={w.id} type="button" onClick={() => setSheet({ kind: 'walkin', id: w.id })} style={rowStyle(true)}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 17.5, fontWeight: 600 }}>{w.name}</span>
                  <Chip tone="quiet">לא ברשימה</Chip>
                </span>
                <span style={{ fontSize: 13.5, color: C.muted }}>{[w.group, people(w.count), w.note].filter(Boolean).join(' · ')}</span>
              </span>
              <TableBadge n={w.table} />
            </button>
          ))}
          {list.guests.length === 0 && list.walkins.length === 0 && (
            <div style={{ textAlign: 'center', padding: '36px 12px', color: C.body, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 16 }}>{q ? `לא מצאנו "${q}" ברשימה.` : 'אין כאן אורחים.'}</span>
              {q && <Btn kind="ghost" onClick={() => setSheet({ kind: 'walkin', id: null })}><Ms size={18}>person_add</Ms>להוסיף כאורח שלא ברשימה</Btn>}
            </div>
          )}
        </main>
      ) : (
        <TablesView tables={Array.from(tableInfo.values())} />
      )}

      {guest && (
        <GuestSheet guest={guest} tables={tableInfo} tableLabel={tableLabel} onClose={closeSheet}
          onCheckIn={(n, t) => checkIn(guest, n, t)}
          onUndo={async () => { closeSheet(); await call(`/checkins/${guest.id}`, 'DELETE'); setToast({ text: `${guest.name} סומנו כלא הגיעו` }); }} />
      )}
      {sheet?.kind === 'walkin' && (
        <WalkinSheet walkin={walkin} initialName={walkin ? '' : q} tables={tableInfo} onClose={closeSheet}
          onSave={async (v) => {
            closeSheet();
            const ok = walkin
              ? await call(`/walkins/${walkin.id}`, 'PATCH', { name: v.name, count: v.count, table_number: v.table ?? undefined, clear_table: v.table == null })
              : await call('/walkins', 'POST', { name: v.name, count: v.count, table_number: v.table, note: v.note || undefined });
            if (ok) { setQ(''); setToast({ text: `${v.name} - ${people(v.count)}${v.table != null ? `, ${tableLabel(v.table)}` : ''}` }); }
          }}
          onDelete={walkin ? async () => { closeSheet(); await call(`/walkins/${walkin.id}`, 'DELETE'); } : undefined} />
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', insetInline: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', zIndex: 30, maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 16, background: C.ink, color: '#FFFFFF', fontSize: 15.5, boxShadow: '0 10px 30px rgba(22,21,15,.25)' }}>
          <Ms size={20} style={{ color: C.lav }}>check_circle</Ms>
          <span style={{ flex: 1, minWidth: 0 }}>{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => { const u = toast.undo; setToast(null); u?.(); }} style={{ border: 'none', background: 'transparent', color: C.lav, fontWeight: 700, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', minHeight: 40 }}>ביטול</button>}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" style={{ minHeight: '100dvh', background: C.paperApp, color: C.ink, fontFamily: 'Heebo, "Noto Sans Hebrew", Arial, sans-serif' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', paddingInline: 16 }}>{children}</div>
    </div>
  );
}

const Figure = ({ value, sub, label }: { value: string; sub: string; label: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
    <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</span>
    <span className="num" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em', color: C.purpleDark }}>{value}</span>
    <span style={{ fontSize: 12, color: C.muted }}>{sub}</span>
  </div>
);

function Seg({ on, onClick, children, icon, small }: { on: boolean; onClick: () => void; children: React.ReactNode; icon?: string; small?: boolean }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: small ? 38 : 40, padding: '0 14px', borderRadius: 12, border: `1.5px solid ${on ? C.purple : C.field}`, background: on ? C.tintApp : '#FFFFFF', color: on ? C.purpleDark : C.ink, fontSize: 14.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {icon && <Ms size={18}>{icon}</Ms>}{children}
    </button>
  );
}

const rowStyle = (arrived: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'right', padding: '14px 16px', minHeight: 72,
  borderRadius: 16, border: `1.5px solid ${arrived ? C.okBorder : C.lineApp}`, background: arrived ? '#FBFDF7' : '#FFFFFF',
  color: C.ink, fontFamily: 'inherit', cursor: 'pointer',
});

function TableBadge({ n }: { n: number | null }) {
  if (n == null) return <span style={{ flex: 'none', fontSize: 13, color: C.muted, minWidth: 64, textAlign: 'center' }}>בלי שולחן</span>;
  return (
    <span style={{ flex: 'none', minWidth: 64, height: 56, padding: '0 10px', borderRadius: 14, background: C.tintApp, border: `1.5px solid ${C.tintBorder}`, color: C.purpleDark, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 600 }}>שולחן</span>
      <span className="num" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{n}</span>
    </span>
  );
}

type TInfo = HTable & { held: number; free: number };

function TablesView({ tables }: { tables: TInfo[] }) {
  if (!tables.length) {
    return <div style={{ padding: '36px 8px', color: C.body, textAlign: 'center' }}>לאירוע הזה עוד לא הוגדרו שולחנות.</div>;
  }
  return (
    <main style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, paddingBlock: '4px 120px' }}>
      {tables.map((t) => {
        const full = t.seats > 0 && t.free <= 0;
        return (
          <div key={t.number} style={{ background: '#FFFFFF', border: `1.5px solid ${full ? C.lineApp : C.okBorder}`, borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="num" style={{ fontSize: 24, fontWeight: 700, color: C.purpleDark }}>{t.number}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
            </div>
            <div style={{ fontSize: 13.5, color: C.body }}>יושבים <b className="num">{t.seated}</b> מתוך <span className="num">{t.seats || '?'}</span></div>
            {t.held > 0 && <div style={{ fontSize: 13, color: C.muted }}>שמורים עוד <span className="num">{t.held}</span> למי שאישר</div>}
            <div style={{ fontSize: 14, fontWeight: 700, color: full ? C.muted : C.ok }}>{t.seats ? (t.free > 0 ? `${t.free} מקומות פנויים` : 'מלא') : ''}</div>
          </div>
        );
      })}
    </main>
  );
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(22,21,15,.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '90dvh', overflowY: 'auto', background: '#FFFFFF', borderRadius: '22px 22px 0 0', padding: '18px 18px calc(18px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 16, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</div>
          <button type="button" aria-label="סגירה" onClick={onClose} style={{ width: 44, height: 44, border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer' }}><Ms size={24}>close</Ms></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const b: React.CSSProperties = { width: 56, height: 56, borderRadius: 16, border: `1.5px solid ${C.field}`, background: '#FFFFFF', color: C.ink, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <button type="button" aria-label="פחות" style={b} onClick={() => onChange(Math.max(1, value - 1))}><Ms size={26}>remove</Ms></button>
      <span className="num" aria-live="polite" style={{ minWidth: 48, textAlign: 'center', fontSize: 34, fontWeight: 700 }}>{value}</span>
      <button type="button" aria-label="יותר" style={b} onClick={() => onChange(Math.min(50, value + 1))}><Ms size={26}>add</Ms></button>
    </div>
  );
}

function TablePicker({ value, onChange, tables, need }: { value: number | null; onChange: (n: number | null) => void; tables: Map<number, TInfo>; need: number }) {
  const opts = Array.from(tables.values()).sort((a, b) => (b.free >= need ? 1 : 0) - (a.free >= need ? 1 : 0) || a.number - b.number);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} aria-label="שולחן"
      style={{ minHeight: 52, padding: '0 12px', borderRadius: 13, border: `1.5px solid ${C.field}`, background: C.paperSoft, fontSize: 16, fontFamily: 'inherit', color: C.ink }}>
      <option value="">בלי שולחן</option>
      {opts.map((t) => (
        <option key={t.number} value={t.number}>
          {`שולחן ${t.number}${t.name && t.name !== `שולחן ${t.number}` ? ` · ${t.name}` : ''}${t.seats ? ` - ${t.free > 0 ? `${t.free} פנויים` : 'מלא'}` : ''}`}
        </option>
      ))}
    </select>
  );
}

function GuestSheet({ guest, tables, tableLabel, onClose, onCheckIn, onUndo }: {
  guest: HGuest; tables: Map<number, TInfo>; tableLabel: (n: number | null) => string;
  onClose: () => void; onCheckIn: (count: number, table: number | null) => void; onUndo: () => void;
}) {
  const [count, setCount] = useState(guest.arrived || guest.expected);
  const [table, setTable] = useState<number | null>(guest.seated_table ?? guest.table);
  const [changeTable, setChangeTable] = useState(false);
  const planned = guest.seated_table ?? guest.table;
  return (
    <SheetFrame title={guest.name} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <TableBadge n={table} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{table != null ? tableLabel(table) : 'לא שובצו לשולחן'}</span>
          <span style={{ fontSize: 14, color: C.muted }}>{[guest.group, `הוזמנו/אישרו: ${people(guest.expected)}`].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {!CONFIRMED.has(guest.status) && (
        <div style={{ padding: '10px 12px', borderRadius: 12, background: C.warnBg, border: `1.5px solid ${C.warnBorder}`, color: C.warn, fontSize: 14 }}>
          {guest.status === 'declined' ? 'האורחים האלה אמרו שהם לא מגיעים. אם הם כאן, בדקו שיש להם מקום.' : 'האורחים האלה לא אישרו הגעה, ולכן לא נשמר להם מקום בוודאות.'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>כמה הגיעו</span>
        <Stepper value={count} onChange={setCount} />
      </div>
      {changeTable || planned == null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>שולחן</span>
          <TablePicker value={table} onChange={setTable} tables={tables} need={count} />
        </div>
      ) : (
        <button type="button" onClick={() => setChangeTable(true)} style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', color: C.purple, fontWeight: 600, fontSize: 14.5, fontFamily: 'inherit', cursor: 'pointer', padding: 0, minHeight: 32 }}>להושיב בשולחן אחר</button>
      )}
      <Btn onClick={() => onCheckIn(count, table)} style={{ minHeight: 58, fontSize: 18 }}>
        <Ms size={22}>how_to_reg</Ms>{guest.arrived ? 'עדכון' : `הגיעו ${count}`}
      </Btn>
      {guest.arrived > 0 && <Btn kind="ghost" onClick={onUndo}>סימנתי בטעות - עוד לא הגיעו</Btn>}
    </SheetFrame>
  );
}

function WalkinSheet({ walkin, initialName, tables, onClose, onSave, onDelete }: {
  walkin: HWalkin | null; initialName: string; tables: Map<number, TInfo>; onClose: () => void;
  onSave: (v: { name: string; count: number; table: number | null; note: string }) => void; onDelete?: () => void;
}) {
  const [name, setName] = useState(walkin?.name ?? (/\d/.test(initialName) ? '' : initialName));
  const [count, setCount] = useState(walkin?.count ?? 1);
  const [table, setTable] = useState<number | null>(walkin?.table ?? null);
  const [note, setNote] = useState(walkin?.note ?? '');
  const field: React.CSSProperties = { minHeight: 52, padding: '0 14px', borderRadius: 13, border: `1.5px solid ${C.field}`, background: C.paperSoft, fontSize: 16, fontFamily: 'inherit', color: C.ink };
  return (
    <SheetFrame title={walkin ? walkin.name : 'אורח שלא ברשימה'} onClose={onClose}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>שם</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="שם מלא" style={field} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>כמה הגיעו</span>
        <Stepper value={count} onChange={setCount} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>שולחן</span>
        <TablePicker value={table} onChange={setTable} tables={tables} need={count} />
      </div>
      {!walkin && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>הערה <span style={{ color: C.muted, fontWeight: 400 }}>(לא חובה)</span></span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: חבר של החתן מהעבודה" style={field} />
        </label>
      )}
      <Btn disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), count, table, note: note.trim() })} style={{ minHeight: 58, fontSize: 18 }}>
        <Ms size={22}>how_to_reg</Ms>{walkin ? 'שמירה' : `הגיעו ${count}`}
      </Btn>
      {onDelete && <Btn kind="ghost" onClick={onDelete}>מחיקה</Btn>}
    </SheetFrame>
  );
}
