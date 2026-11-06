/**
 * Admin: Template Studio (/admin/templates).
 *
 * Create, edit, group, preview and submit WhatsApp templates to Meta, and track
 * their approval. Each template is a JSON document (core /admin/templates,
 * shared/domain/messaging/custom_templates.py). An approved template in a guest
 * stage group is offered in the wizard / campaigns as `custom__<key>`; one in
 * the "flow" group feeds the flow builder's template picker. Catalog and system
 * templates are listed read-only and can be duplicated into a new draft.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { color as C, radius } from '../../design/tokens';
import { Btn, Card, Chip, Kicker, Ms } from '../../components/v6/ui';
import { inputBase, selectBase } from '../../components/flowbuilder/controls';
import TemplateEditor from '../../components/templates/TemplateEditor';
import WaBubble from '../../components/templates/WaBubble';
import JsonPanel from '../../components/templates/JsonPanel';
import {
  emptyDoc, errMsg, quickValidate, STATUS_LABEL, STATUS_TONE, templatesApi,
  type ImportResult, type Issue, type ListResponse, type ReadonlyTemplate, type SubmitResponse,
  type TemplateDoc, type TemplateView, type Validation, type VariablesResponse,
} from '../../components/templates/api';

type Selection = { kind: 'custom'; key: string } | { kind: 'new' } | { kind: 'readonly'; item: ReadonlyTemplate } | null;
type Confirm =
  | { kind: 'submit'; dry: SubmitResponse }
  | { kind: 'delete' }
  | { kind: 'import'; result: ImportResult; docs: unknown[] }
  | null;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '');

function StatusChip({ status, small }: { status: string; small?: boolean }) {
  return (
    <Chip tone={STATUS_TONE[status] || 'quiet'} style={small ? { height: 22, fontSize: 11.5, padding: '0 7px' } : undefined}>
      {STATUS_LABEL[status] || status}
    </Chip>
  );
}

export default function Templates() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [vars, setVars] = useState<VariablesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [view, setView] = useState<TemplateView | null>(null);
  const [draft, setDraft] = useState<TemplateDoc | null>(null);
  const [baseline, setBaseline] = useState<TemplateDoc | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [serverVal, setServerVal] = useState<(Validation & { suggested_name?: string }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showBuiltIn, setShowBuiltIn] = useState(true);
  const [catFilter, setCatFilter] = useState('');
  const [etFilter, setEtFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [roTab, setRoTab] = useState<'view' | 'json'>('view');
  const [showJson, setShowJson] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (m: string) => setToast(m);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async (refresh = false) => {
    try {
      const d = await templatesApi.list(refresh);
      setData(d);
      setLoadError(null);
      return d;
    } catch (e) {
      setLoadError(errMsg(e, 'טעינת התבניות נכשלה'));
      return null;
    }
  }, []);

  useEffect(() => {
    load();
    templatesApi.variables().then(setVars).catch(() => setVars(null));
  }, [load]);

  const dirty = !!draft && !!baseline && !same(draft, baseline);
  const isNew = sel?.kind === 'new';
  const nameLocked = !!view?.submitted;

  // ---------------------------------------------------------------- selection

  const openCustom = useCallback(async (key: string) => {
    setBusy('open');
    try {
      const v = await templatesApi.get(key);
      setSel({ kind: 'custom', key });
      setView(v);
      setDraft(clone(v.doc));
      setBaseline(clone(v.doc));
      setNameTouched(true);
      setConfirm(null);
      setShowPayload(false);
    } catch (e) {
      say(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  /** Unsaved edits: ask in-page (never window.confirm) before navigating away. */
  const guarded = (go: () => void) => {
    if (!dirty) { go(); return; }
    setPendingNav(() => go);
  };

  const pick = (s: Selection) => guarded(() => pickNow(s));

  const pickNow = (s: Selection) => {
    setPendingNav(null);
    if (s?.kind === 'custom') { openCustom(s.key); return; }
    setSel(s);
    setView(null);
    setConfirm(null);
    setShowPayload(false);
    if (s?.kind === 'new') {
      const d = emptyDoc(groupFilter && groupFilter !== 'all' ? groupFilter : 'invitation');
      setDraft(d);
      setBaseline(clone(d));
      setNameTouched(false);
    } else {
      setDraft(null);
      setBaseline(null);
    }
  };

  // ---------------------------------------------------------------- validation (debounced, server-authoritative)

  useEffect(() => {
    if (!draft) { setServerVal(null); return undefined; }
    const t = setTimeout(() => {
      templatesApi.validate(draft, view?.key || null).then((r) => {
        setServerVal(r);
        if (!nameTouched && !nameLocked && !draft.name && r.suggested_name) {
          setDraft((d) => (d && !d.name ? { ...d, name: r.suggested_name } : d));
        }
      }).catch(() => setServerVal(null));
    }, 450);
    return () => clearTimeout(t);
  }, [draft, view?.key, nameTouched, nameLocked]);

  const issues: Issue[] = useMemo(() => {
    if (!draft) return [];
    if (serverVal) return serverVal.errors;
    return quickValidate(draft);
  }, [draft, serverVal]);
  const warnings = serverVal?.warnings || [];

  // ---------------------------------------------------------------- preview values

  const sampleValues = useMemo(() => {
    const out: Record<string, string> = {};
    (vars?.variables || []).forEach((v) => { out[v.name] = v.sample; });
    Object.entries(draft?.samples || {}).forEach(([k, v]) => { if (v) out[k] = v; });
    return out;
  }, [vars, draft?.samples]);

  useEffect(() => {
    if (!showPayload || !draft) return undefined;
    const t = setTimeout(() => {
      templatesApi.preview(draft, view?.key || null).then((r) => setPayload(r.meta_create_payload)).catch(() => setPayload(null));
    }, 400);
    return () => clearTimeout(t);
  }, [showPayload, draft, view?.key]);

  // ---------------------------------------------------------------- actions

  const refreshAfter = async (v: TemplateView) => {
    setView(v);
    setDraft(clone(v.doc));
    setBaseline(clone(v.doc));
    setSel({ kind: 'custom', key: v.key });
    await load();
  };

  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const v = isNew ? await templatesApi.create(draft) : await templatesApi.update(view!.key, draft, view?.updated_at);
      await refreshAfter(v);
      say(isNew ? 'הטיוטה נשמרה' : view?.submitted && v.has_unsubmitted_changes ? `נשמר כגרסה ${v.version} (טיוטה)` : 'נשמר');
    } catch (e) {
      say(errMsg(e, 'השמירה נכשלה'));
    } finally {
      setBusy(null);
    }
  };

  const changeGroup = async (group: string) => {
    if (!draft) return;
    if (!view) { setDraft({ ...draft, group }); return; }
    setBusy('group');
    try {
      const v = await templatesApi.setGroup(view.key, group);
      setView(v);
      setDraft((d) => (d ? { ...d, group } : d));
      setBaseline((b) => (b ? { ...b, group } : b));
      await load();
      say(`הועבר לקבוצה "${v.group_label}"`);
    } catch (e) {
      say(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const startSubmit = async () => {
    if (!view) return;
    if (dirty) { say('יש לשמור את השינויים לפני השליחה ל-Meta'); return; }
    setBusy('submit');
    try {
      const dry = await templatesApi.submit(view.key, true);
      setConfirm({ kind: 'submit', dry });
    } catch (e) {
      say(errMsg(e, 'אי אפשר לשלוח כרגע'));
    } finally {
      setBusy(null);
    }
  };

  const doSubmit = async () => {
    if (!view) return;
    setBusy('submit');
    try {
      const r = await templatesApi.submit(view.key, false);
      setConfirm(null);
      if (r.template) await refreshAfter(r.template);
      if (!r.ok) say(`Meta דחתה את הבקשה: ${r.error || 'שגיאה לא ידועה'}`);
      else if (r.simulated) say('Meta לא מוגדר בשרת - נשמר כממתין (סימולציה)');
      else say('נשלח ל-Meta. הסטטוס יתעדכן אחרי הבדיקה שלהם');
    } catch (e) {
      say(errMsg(e, 'השליחה נכשלה'));
    } finally {
      setBusy(null);
    }
  };

  const syncOne = async () => {
    if (!view) return;
    setBusy('sync');
    try {
      const v = await templatesApi.sync(view.key);
      await refreshAfter(v);
      say(`סטטוס עודכן: ${v.status_label}`);
    } catch (e) {
      say(errMsg(e, 'רענון הסטטוס נכשל'));
    } finally {
      setBusy(null);
    }
  };

  const syncAll = async () => {
    setBusy('syncAll');
    try {
      const r = await templatesApi.syncAll().catch(() => ({ synced: 0 }));
      await load(true);
      if (view) await openCustom(view.key);
      say(`עודכנו ${r.synced} תבניות`);
    } catch (e) {
      say(errMsg(e, 'רענון הסטטוסים נכשל'));
    } finally {
      setBusy(null);
    }
  };

  const toggleArchive = async () => {
    if (!view) return;
    setBusy('archive');
    try {
      const v = await templatesApi.archive(view.key, !view.archived);
      await refreshAfter(v);
      say(v.archived ? 'הועבר לארכיון' : 'הוחזר מהארכיון');
    } catch (e) {
      say(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (!view) return;
    setBusy('delete');
    try {
      await templatesApi.remove(view.key);
      setConfirm(null);
      setSel(null); setView(null); setDraft(null); setBaseline(null);
      await load();
      say('הטיוטה נמחקה');
    } catch (e) {
      say(errMsg(e, 'המחיקה נכשלה'));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = (source: 'custom' | 'catalog' | 'system', key: string, replace = false) =>
    guarded(() => duplicateNow(source, key, replace));

  // replace=true edits a built-in template: the copy stands in for it everywhere
  // once Meta approves it (core app/template_placement.py).
  const duplicateNow = async (source: 'custom' | 'catalog' | 'system', key: string, replace = false) => {
    setPendingNav(null);
    setBusy('dup');
    try {
      const v = await templatesApi.duplicate(source, key, replace ? { replace: true } : {});
      await refreshAfter(v);
      setNameTouched(true);
      say(replace
        ? 'נוצרה טיוטת עריכה. אחרי שתשלחו ל־Meta ותאושר, היא תחליף את המקורית בכל מקום, גם בסבבים שכבר תוזמנו.'
        : 'נוצר עותק חדש כטיוטה');
    } catch (e) {
      say(errMsg(e, 'השכפול נכשל'));
    } finally {
      setBusy(null);
    }
  };

  const doExport = async (scope: 'custom' | 'all' = 'custom') => {
    try {
      const blob = await templatesApi.exportDocs(scope);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `showup-templates${scope === 'all' ? '-all' : ''}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      say(errMsg(e, 'הייצוא נכשל'));
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const docs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.templates) ? parsed.templates : null;
      if (!docs) { say('הקובץ צריך להכיל מערך JSON של תבניות'); return; }
      const result = await templatesApi.importDocs(docs, true);
      setConfirm({ kind: 'import', result, docs });
    } catch (e) {
      say(e instanceof SyntaxError ? 'הקובץ אינו JSON תקין' : errMsg(e, 'הייבוא נכשל'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doImport = async (docs: unknown[]) => {
    setBusy('import');
    try {
      const r = await templatesApi.importDocs(docs, false);
      setConfirm(null);
      await load();
      say(`יובאו ${r.counts.created} חדשות, עודכנו ${r.counts.updated}${r.counts.conflict ? `, ${r.counts.conflict} לא נדרסו` : ''}`);
    } catch (e) {
      say(errMsg(e, 'הייבוא נכשל'));
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------- list

  const groups = data?.groups || vars?.groups || [];
  const etName = (k: string) => vars?.event_types?.find((e) => e.key === k)?.name_he || k;
  const etLabel = (ets?: string[]) => (ets && ets.length ? ets.map(etName).join(', ') : 'כל סוגי האירועים');
  const etOk = (ets?: string[]) => !etFilter || !ets || !ets.length || ets.includes(etFilter);
  const q = search.trim().toLowerCase();
  const matches = (title: string, key: string, body: string) =>
    !q || title.toLowerCase().includes(q) || key.toLowerCase().includes(q) || body.toLowerCase().includes(q);
  const customRows = (data?.templates || []).filter((t) =>
    (showArchived || !t.archived) && (!statusFilter || t.meta_status === statusFilter)
    && (!groupFilter || t.group === groupFilter) && (!catFilter || t.doc.category === catFilter) && etOk(t.doc.event_types)
    && matches(t.title, t.key, t.doc.body));
  const builtInRows = showBuiltIn ? [...(data?.catalog || []), ...(data?.system || [])].filter((t) =>
    !t.placeholder && (!groupFilter || t.group === groupFilter) && (!catFilter || t.category === catFilter) && etOk(t.event_types)
    && (!statusFilter || t.meta_status === statusFilter) && matches(t.title, t.key, t.body)) : [];
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    (data?.templates || []).forEach((t) => { if (!t.archived) out[t.meta_status] = (out[t.meta_status] || 0) + 1; });
    return out;
  }, [data]);

  const selectedKey = sel?.kind === 'custom' ? sel.key : sel?.kind === 'readonly' ? `${sel.item.source}:${sel.item.key}` : null;
  const pane = sel ? 'editor' : 'list';

  const listItem = (key: string, title: string, sub: string, status: string, active: boolean, onClick: () => void, extra?: React.ReactNode) => (
    <button key={key} type="button" onClick={onClick} aria-current={active ? 'true' : undefined} className={active ? undefined : 'ts-row'}
      style={{
        display: 'block', width: '100%', textAlign: 'start', padding: '10px 12px', borderRadius: radius.md, cursor: 'pointer',
        border: active ? `1.5px solid ${C.purple}` : '1.5px solid transparent', background: active ? C.tintApp : 'transparent',
        fontFamily: 'inherit', color: C.ink,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title || 'ללא שם'}</span>
        <StatusChip status={status} small />
      </div>
      <div dir="ltr" style={{ fontSize: 12, color: C.muted, marginTop: 3, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, Menlo, monospace' }}>{sub}</div>
      {extra}
    </button>
  );

  const grouped = groups.map((g) => ({
    g,
    custom: customRows.filter((t) => t.group === g.id),
    builtIn: builtInRows.filter((t) => t.group === g.id),
  })).filter((x) => x.custom.length || x.builtIn.length);

  // ---------------------------------------------------------------- render

  const canSubmit = !!view && !dirty && !issues.length && view.meta_status !== 'pending'
    && !(view.meta_status === 'approved' && !view.has_unsubmitted_changes);
  const submitLabel = view?.meta_status === 'rejected' ? 'שליחה מחדש לאישור' : view?.live ? 'שליחת הגרסה החדשה לאישור' : 'שליחה לאישור Meta';

  return (
    <div dir="rtl" style={{ background: C.paperApp, minHeight: '100%', color: C.ink }}>
      <style>{`
        .ts-grid { display: grid; grid-template-columns: 300px minmax(0,1fr) 340px; gap: 20px; align-items: start; }
        .ts-sticky { position: sticky; top: 16px; }
        .ts-two { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); column-gap: 16px; }
        .ts-row:hover { background: ${C.paperSoft}; }
        .ts-back { display: none; }
        @media (max-width: 1240px) { .ts-grid { grid-template-columns: 280px minmax(0,1fr); } .ts-preview { grid-column: 2; } .ts-sticky { position: static; } }
        @media (max-width: 900px) {
          .ts-grid { grid-template-columns: minmax(0,1fr); }
          .ts-preview { grid-column: auto; }
          .ts-grid[data-pane="editor"] .ts-list { display: none; }
          .ts-grid[data-pane="list"] .ts-editor, .ts-grid[data-pane="list"] .ts-preview { display: none; }
          .ts-back { display: inline-flex; }
          .ts-two { grid-template-columns: minmax(0,1fr); }
        }
      `}</style>

      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <Kicker>הגדרות מערכת</Kicker>
          <h1 style={{ fontSize: 'clamp(26px,3vw,36px)', fontWeight: 600, letterSpacing: '-0.03em', margin: '6px 0 4px' }}>תבניות הודעה</h1>
          <p style={{ margin: 0, color: C.body, fontSize: 15, maxWidth: '64ch' }}>
            יוצרים תבנית וואטסאפ, שולחים לאישור Meta, ואחרי האישור היא זמינה בסבבים לאורחים או בבונה השיחה.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn kind="smallGhost" onClick={() => doExport('all')}><Ms size={18}>download</Ms>ייצוא כל התבניות (JSON)</Btn>
          <Btn kind="smallGhost" onClick={() => doExport('custom')}><Ms size={18}>download</Ms>ייצוא שלי</Btn>
          <Btn kind="smallGhost" onClick={() => fileRef.current?.click()}><Ms size={18}>upload</Ms>ייבוא JSON</Btn>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); }} />
          <Btn kind="smallGhost" disabled={busy === 'syncAll' || !data?.meta_configured} onClick={syncAll}
            title={data?.meta_configured ? undefined : 'Meta לא מוגדר בשרת'}>
            <Ms size={18}>sync</Ms>{busy === 'syncAll' ? 'מרענן…' : 'רענון כל הסטטוסים'}
          </Btn>
          <Btn kind="smallPrimary" onClick={() => pick({ kind: 'new' })}><Ms size={18}>add</Ms>תבנית חדשה</Btn>
        </div>
      </header>

      {data && !data.meta_configured && (
        <Card style={{ background: C.warnBg, borderColor: C.warnBorder, color: C.warn, marginBottom: 16, padding: '12px 16px', fontSize: 14 }}>
          Meta לא מוגדר בשרת הזה (WA_WABA_ID / WA_API_B). שליחה לאישור תישמר כסימולציה בלבד.
        </Card>
      )}
      {loadError && <Card style={{ borderColor: C.errBorder, background: C.errBg, color: C.err, marginBottom: 16 }}>{loadError}</Card>}

      {pendingNav && (
        <Card role="alertdialog" aria-label="שינויים שלא נשמרו" style={{ marginBottom: 16, background: C.warnBg, borderColor: C.warnBorder, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, color: C.warn, fontWeight: 600 }}>יש שינויים שלא נשמרו בתבנית הפתוחה.</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn kind="smallGhost" onClick={() => setPendingNav(null)}>חזרה לעריכה</Btn>
              <Btn kind="smallGhost" style={{ color: C.danger }} onClick={() => { const go = pendingNav; setPendingNav(null); go(); }}>המשך בלי לשמור</Btn>
            </div>
          </div>
        </Card>
      )}

      {confirm?.kind === 'import' && (
        <Card style={{ marginBottom: 16, borderColor: C.tintBorder }}>
          <Kicker>ייבוא</Kicker>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '6px 0 8px' }}>לפני שמייבאים</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <Chip tone="ok">{confirm.result.counts.created} חדשות</Chip>
            <Chip tone="lav">{confirm.result.counts.updated} יעודכנו</Chip>
            <Chip>{confirm.result.counts.unchanged} ללא שינוי</Chip>
            {!!confirm.result.counts.conflict && <Chip tone="warn">{confirm.result.counts.conflict} לא יידרסו</Chip>}
            {!!confirm.result.counts.error && <Chip tone="err">{confirm.result.counts.error} שגויות</Chip>}
          </div>
          {confirm.result.results.filter((r) => r.action === 'conflict' || r.action === 'error').slice(0, 8).map((r) => (
            <div key={r.index} style={{ fontSize: 13, color: r.action === 'error' ? C.err : C.warn, marginBottom: 4 }}>
              <span dir="ltr">{r.name || `#${r.index + 1}`}</span> - {r.reason || r.errors?.map((e) => e.message).join(' · ')}
            </div>
          ))}
          <div style={{ fontSize: 13, color: C.muted, margin: '6px 0 12px' }}>תבנית שכבר נשלחה ל-Meta לעולם לא נדרסת בייבוא.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="smallPrimary" disabled={busy === 'import' || !(confirm.result.counts.created + confirm.result.counts.updated)}
              onClick={() => doImport(confirm.docs)}>{busy === 'import' ? 'מייבא…' : 'ייבוא'}</Btn>
            <Btn kind="smallGhost" onClick={() => setConfirm(null)}>ביטול</Btn>
          </div>
        </Card>
      )}

      <div className="ts-grid" data-pane={pane}>
        {/* ------------------------------------------------ list */}
        <nav className="ts-list ts-sticky" aria-label="רשימת התבניות">
          <Card style={{ padding: 14 }}>
            <div style={{ position: 'relative' }}>
              <Ms size={18} style={{ position: 'absolute', insetInlineStart: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }}>search</Ms>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם או תוכן" aria-label="חיפוש"
                style={{ ...inputBase, paddingInlineStart: 34 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <select style={selectBase} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="סינון לפי סטטוס">
                <option value="">כל הסטטוסים</option>
                {(data?.statuses || []).map((s) => <option key={s.id} value={s.id}>{s.label}{counts[s.id] ? ` (${counts[s.id]})` : ''}</option>)}
              </select>
              <select style={selectBase} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="סינון לפי קבוצה">
                <option value="">כל הקבוצות</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <select style={{ ...selectBase, gridColumn: '1 / -1' }} value={etFilter} onChange={(e) => setEtFilter(e.target.value)} aria-label="סינון לפי סוג אירוע">
                <option value="">כל סוגי האירועים</option>
                {(vars?.event_types || []).map((et) => <option key={et.key} value={et.key}>{et.name_he}</option>)}
              </select>
              <select style={{ ...selectBase, gridColumn: '1 / -1' }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="סינון לפי קטגוריית Meta">
                <option value="">כל הקטגוריות (שיווק / שירות)</option>
                <option value="MARKETING">שיווק (MARKETING)</option>
                <option value="UTILITY">שירות (UTILITY)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 13, color: C.body }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={showBuiltIn} onChange={(e) => setShowBuiltIn(e.target.checked)} style={{ accentColor: C.purple }} />
                גם תבניות הקטלוג והמערכת
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ accentColor: C.purple }} />
                ארכיון
              </label>
            </div>
          </Card>

          <div style={{ marginTop: 12 }}>
            {!data && !loadError && <div style={{ color: C.muted, fontSize: 14, padding: 12 }}>טוען…</div>}
            {data && !grouped.length && (
              <div style={{ color: C.muted, fontSize: 14, padding: 12, lineHeight: 1.6 }}>
                {data.templates.length ? 'אין תבניות שמתאימות לסינון.' : 'עדיין אין תבניות. אפשר ליצור תבנית חדשה או לשכפל תבנית מהקטלוג.'}
              </div>
            )}
            {grouped.map(({ g, custom, builtIn }) => {
              const filtering = !!(q || statusFilter || groupFilter || catFilter || etFilter);
              const open = filtering || openGroups.has(g.id);
              const all = [...custom.map((t) => t.meta_status), ...builtIn.map((t) => t.meta_status)];
              const nApproved = all.filter((x) => x === 'approved').length;
              const nRejected = all.filter((x) => x === 'rejected').length;
              return (
              <div key={g.id} style={{ marginBottom: 8 }}>
                <button type="button" aria-expanded={open}
                  onClick={() => setOpenGroups((s0) => { const n = new Set(s0); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 0, cursor: 'pointer',
                    fontFamily: 'inherit', color: C.ink, padding: '8px 12px', textAlign: 'start' }}>
                  <Ms size={18} style={{ color: C.muted }}>{open ? 'expand_more' : 'chevron_left'}</Ms>
                  <span style={{ fontWeight: 600, fontSize: 14.5, flex: 1 }}>{g.label}</span>
                  <span style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {all.length}{nApproved ? ` · ${nApproved} מאושרות` : ''}{nRejected ? ` · ${nRejected} נדחו` : ''}
                  </span>
                </button>
                {open && <>
                {custom.map((t) => listItem(t.key, t.title, t.meta_name || t.key, t.meta_status, selectedKey === t.key,
                  () => pick({ kind: 'custom', key: t.key }),
                  (t.archived || t.has_unsubmitted_changes || (t.live && t.meta_status !== 'approved')) ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      {t.archived && <Chip style={{ height: 20, fontSize: 11, padding: '0 6px' }}>בארכיון</Chip>}
                      {t.has_unsubmitted_changes && <Chip tone="lav" style={{ height: 20, fontSize: 11, padding: '0 6px' }}>טיוטה v{t.version}</Chip>}
                      {t.live && t.meta_status !== 'approved' && <Chip tone="ok" style={{ height: 20, fontSize: 11, padding: '0 6px' }}>v{t.live.version} פעילה</Chip>}
                    </div>
                  ) : undefined))}
                {builtIn.map((t) => listItem(`${t.source}:${t.key}`, t.title, t.meta_name || t.key, t.meta_status,
                  selectedKey === `${t.source}:${t.key}`, () => pick({ kind: 'readonly', item: t }),
                  <div style={{ fontSize: 11.5, color: C.purple, marginTop: 3 }}>{t.source === 'catalog' ? 'קטלוג' : 'מערכת'}{t.category ? ` · ${t.category === 'MARKETING' ? 'שיווק' : 'שירות'}` : ''}{` · ${etLabel(t.event_types)}`}</div>))}
                </>}
              </div>
              );
            })}
          </div>
        </nav>

        {/* ------------------------------------------------ editor */}
        <main className="ts-editor" style={{ minWidth: 0 }}>
          <button type="button" className="ts-back" onClick={() => pick(null)}
            style={{ alignItems: 'center', gap: 4, background: 'none', border: 0, color: C.purple, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', padding: '0 0 10px' }}>
            <Ms size={18}>arrow_forward</Ms>חזרה לרשימה
          </button>

          {!sel && (
            <Card style={{ textAlign: 'center', padding: '48px 24px', color: C.body }}>
              <Ms size={36} style={{ color: C.purple }}>edit_note</Ms>
              <h2 style={{ fontSize: 20, fontWeight: 600, margin: '10px 0 6px', color: C.ink }}>בחרו תבנית מהרשימה</h2>
              <p style={{ margin: '0 auto 16px', maxWidth: '44ch', fontSize: 14.5, lineHeight: 1.6 }}>
                או צרו תבנית חדשה. כל תבנית נשמרת כטיוטה עד שתשלחו אותה לאישור Meta.
              </p>
              <Btn kind="smallPrimary" onClick={() => pick({ kind: 'new' })}><Ms size={18}>add</Ms>תבנית חדשה</Btn>
            </Card>
          )}

          {sel?.kind === 'readonly' && (
            <Card>
              <Kicker>{sel.item.source === 'catalog' ? 'תבנית קטלוג' : 'תבנית מערכת'} · קריאה בלבד</Kicker>
              <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: '6px 0 8px' }}>{sel.item.title}</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <StatusChip status={sel.item.meta_status} />
                <Chip>{sel.item.group_label}</Chip>
                <code dir="ltr" style={{ fontSize: 12.5, color: C.muted }}>{sel.item.meta_name}</code>
              </div>
              <p style={{ fontSize: 14, color: C.body, lineHeight: 1.6, margin: '0 0 14px' }}>
                {sel.item.source === 'catalog'
                  ? 'התבנית מוגדרת בקטלוג ההודעות בקוד. כדי לשנות אותה, שכפלו אותה לטיוטה חדשה ושלחו לאישור.'
                  : 'התבנית מוגדרת בקוד ונשלחת למארחים אוטומטית. שכפול יוצר טיוטה בקבוצת "למארחים".'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {sel.item.category && <Chip>{sel.item.category === 'MARKETING' ? 'שיווק · MARKETING' : 'שירות · UTILITY'}</Chip>}
                {sel.item.language && <Chip>שפה: {sel.item.language}</Chip>}
                <Chip>סוג אירוע: {etLabel(sel.item.event_types)}</Chip>
                {sel.item.rejection_reason && <Chip tone="err">סיבת דחייה: {sel.item.rejection_reason}</Chip>}
              </div>
              <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {(['view', 'json'] as const).map((tb) => (
                  <Btn key={tb} kind={roTab === tb ? 'smallPrimary' : 'smallGhost'} role="tab" aria-selected={roTab === tb} onClick={() => setRoTab(tb)}>
                    {tb === 'view' ? 'תוכן' : 'JSON'}
                  </Btn>
                ))}
              </div>
              {roTab === 'json' ? (
                <div style={{ marginBottom: 14 }}><JsonPanel value={sel.item.doc ?? sel.item} /></div>
              ) : (
              <pre dir="rtl" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, background: C.paperSoft, border: `1px solid ${C.line2}`, borderRadius: radius.md, padding: 12, margin: '0 0 14px' }}>
                {sel.item.body}
              </pre>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {sel.item.source === 'catalog' && (
                  <Btn kind="smallPrimary" disabled={busy === 'dup'} onClick={() => duplicate(sel.item.source, sel.item.key, true)}>
                    <Ms size={18}>edit</Ms>עריכה (תחליף את המקורית אחרי אישור)
                  </Btn>
                )}
                <Btn kind={sel.item.source === 'catalog' ? 'smallGhost' : 'smallPrimary'} disabled={busy === 'dup'}
                  onClick={() => duplicate(sel.item.source, sel.item.key)}>
                  <Ms size={18}>content_copy</Ms>שכפול לטיוטה חדשה
                </Btn>
              </div>
            </Card>
          )}

          {draft && (sel?.kind === 'custom' || sel?.kind === 'new') && (
            <>
              <Card style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <Kicker>{isNew ? 'תבנית חדשה' : `גרסה ${view?.version ?? 1}`}</Kicker>
                    <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: '6px 0 6px', overflowWrap: 'anywhere' }}>{draft.title || 'ללא שם'}</h2>
                    {view && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: C.muted }}>
                        <StatusChip status={view.meta_status} />
                        {view.live && <Chip tone="ok">פעילה: <span dir="ltr" style={{ marginInlineStart: 4 }}>{view.live.meta_name}</span></Chip>}
                        {view.archived && <Chip>בארכיון</Chip>}
                        {view.has_unsubmitted_changes && <Chip tone="lav">שינויים שלא נשלחו</Chip>}
                        {view.updated_at && <span>עודכן {fmt(view.updated_at)}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {dirty && <Chip tone="warn">לא נשמר</Chip>}
                    <Btn kind="smallPrimary" disabled={!dirty || busy === 'save' || !draft.name || !draft.title.trim()} onClick={save}>
                      {busy === 'save' ? 'שומר…' : 'שמירה'}
                    </Btn>
                    {view && <Btn kind="smallGhost" disabled={busy === 'dup'} onClick={() => duplicate('custom', view.key)}><Ms size={18}>content_copy</Ms>שכפול</Btn>}
                  </div>
                </div>

                {view?.meta_status === 'rejected' && (
                  <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: radius.md, background: C.errBg, border: `1px solid ${C.errBorder}`, color: C.err, fontSize: 13.5, lineHeight: 1.5 }}>
                    <strong>Meta דחתה את התבנית.</strong> {view.rejection_reason ? `הסיבה: ${view.rejection_reason}` : 'לא נמסרה סיבה.'} אפשר לתקן ולשלוח שוב.
                  </div>
                )}
                {view?.meta_status === 'pending' && (
                  <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: radius.md, background: C.warnBg, border: `1px solid ${C.warnBorder}`, color: C.warn, fontSize: 13.5, lineHeight: 1.5 }}>
                    ממתינה לבדיקה של Meta{view.submitted_at ? ` (נשלחה ${fmt(view.submitted_at)})` : ''}. בדרך כלל זה לוקח מכמה דקות ועד יום.
                    {view.live ? ' בינתיים הגרסה המאושרת הקודמת ממשיכה להישלח.' : ''}
                  </div>
                )}
                {view?.deliverable && (
                  <div style={{ marginTop: 12, fontSize: 13.5, color: C.ok, display: 'flex', gap: 6, alignItems: 'flex-start', lineHeight: 1.5 }}>
                    <Ms size={18}>check_circle</Ms>
                    <span>
                      {view.usable_in.includes('campaigns') ? 'זמינה לבחירה בסבבים לאורחים בשלב הזה' : view.usable_in.includes('flow') ? 'זמינה בבונה השיחה' : view.archived ? 'בארכיון - לא מוצעת לבחירה' : 'מאושרת לשליחה למארחים'}
                      {view.usable_in.includes('campaigns') && ' ובבונה השיחה'}.
                    </span>
                  </div>
                )}
              </Card>

              <Card style={{ marginBottom: 16 }}>
                <button type="button" aria-expanded={showJson} onClick={() => setShowJson((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 0, cursor: 'pointer', fontFamily: 'inherit', color: C.ink, padding: 0, textAlign: 'start' }}>
                  <Ms size={18} style={{ color: C.muted }}>{showJson ? 'expand_more' : 'chevron_left'}</Ms>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>עריכה כ-JSON</span>
                  <span style={{ fontSize: 12.5, color: C.muted }}>התבנית נשמרת כמסמך JSON - אפשר לערוך אותו ישירות</span>
                </button>
                {showJson && (
                  <div style={{ marginTop: 12 }}>
                    <JsonPanel value={draft} onApply={(obj) => setDraft((d) => (d ? { ...d, ...(obj as Partial<TemplateDoc>) } : d))} />
                  </div>
                )}
              </Card>

              <Card style={{ marginBottom: 16 }}>
                <TemplateEditor
                  doc={draft}
                  onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                  onGroupChange={changeGroup}
                  vars={vars}
                  groups={groups}
                  issues={issues}
                  warnings={warnings}
                  nameLocked={nameLocked}
                  nameTouched={nameTouched}
                  onNameTouched={() => setNameTouched(true)}
                />
              </Card>

              {/* ---------------------------------------- lifecycle actions */}
              {view && (
                <Card style={{ marginBottom: 24 }}>
                  <Kicker>Meta</Kicker>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: '6px 0 4px' }}>אישור ושליחה</h3>
                  <p style={{ fontSize: 13.5, color: C.body, margin: '0 0 12px', lineHeight: 1.55 }}>
                    {view.live
                      ? 'עריכה של תבנית מאושרת נשלחת לאישור כתבנית חדשה. הגרסה המאושרת ממשיכה להישלח עד שהחדשה תאושר.'
                      : 'אחרי השליחה Meta בודקת את התבנית. אפשר לרענן את הסטטוס בכל רגע.'}
                  </p>
                  {issues.length > 0 && <div style={{ fontSize: 13, color: C.err, marginBottom: 10 }}>יש {issues.length} דברים לתקן לפני השליחה.</div>}
                  {dirty && <div style={{ fontSize: 13, color: C.warn, marginBottom: 10 }}>יש לשמור לפני השליחה.</div>}

                  {confirm?.kind === 'submit' ? (
                    <div style={{ padding: 14, borderRadius: radius.md, border: `1.5px solid ${C.tintBorder}`, background: C.tintApp }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>לשלוח את התבנית ל-Meta?</div>
                      <div style={{ fontSize: 13.5, color: C.body, lineHeight: 1.6 }}>
                        {confirm.dry.mode === 'edit' ? 'התבנית שנדחתה תתעדכן ותיבדק שוב' : 'תיווצר תבנית חדשה'} בשם{' '}
                        <code dir="ltr">{confirm.dry.meta_name}</code>.
                        {!confirm.dry.meta_configured && ' (Meta לא מוגדר - זו סימולציה בלבד.)'}
                      </div>
                      {(confirm.dry.warnings || []).map((w, i) => (
                        <div key={i} style={{ fontSize: 12.5, color: C.warn, marginTop: 4 }}>{w.message}</div>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <Btn kind="smallPrimary" disabled={busy === 'submit'} onClick={doSubmit}>{busy === 'submit' ? 'שולח…' : 'כן, לשלוח'}</Btn>
                        <Btn kind="smallGhost" onClick={() => setConfirm(null)}>ביטול</Btn>
                      </div>
                    </div>
                  ) : confirm?.kind === 'delete' ? (
                    <div style={{ padding: 14, borderRadius: radius.md, border: `1.5px solid ${C.errBorder}`, background: C.errBg }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: C.err, marginBottom: 6 }}>למחוק את הטיוטה לצמיתות?</div>
                      <div style={{ fontSize: 13.5, color: C.body }}>אי אפשר לשחזר אחרי המחיקה.</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <Btn kind="smallGhost" style={{ color: C.danger, borderColor: C.errBorder }} disabled={busy === 'delete'} onClick={doDelete}>
                          {busy === 'delete' ? 'מוחק…' : 'מחיקה'}
                        </Btn>
                        <Btn kind="smallGhost" onClick={() => setConfirm(null)}>ביטול</Btn>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Btn kind="smallPrimary" disabled={!canSubmit || busy === 'submit'} onClick={startSubmit}>
                        <Ms size={18}>send</Ms>{busy === 'submit' ? 'בודק…' : submitLabel}
                      </Btn>
                      {view.submitted && (
                        <Btn kind="smallGhost" disabled={busy === 'sync' || !data?.meta_configured} onClick={syncOne}>
                          <Ms size={18}>sync</Ms>{busy === 'sync' ? 'מרענן…' : 'רענון סטטוס'}
                        </Btn>
                      )}
                      <Btn kind="smallGhost" disabled={busy === 'archive'} onClick={toggleArchive}>
                        <Ms size={18}>{view.archived ? 'unarchive' : 'archive'}</Ms>{view.archived ? 'החזרה מהארכיון' : 'ארכיון'}
                      </Btn>
                      {!view.submitted && (
                        <Btn kind="smallGhost" style={{ color: C.danger }} onClick={() => setConfirm({ kind: 'delete' })}>
                          <Ms size={18}>delete</Ms>מחיקה
                        </Btn>
                      )}
                    </div>
                  )}
                  {view.last_sync && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>סטטוס עודכן לאחרונה {fmt(view.last_sync)}</div>}
                </Card>
              )}
            </>
          )}
        </main>

        {/* ------------------------------------------------ preview */}
        {draft && (sel?.kind === 'custom' || sel?.kind === 'new') && (
          <aside className="ts-preview ts-sticky" aria-label="תצוגה מקדימה">
            <Card style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>תצוגה מקדימה</span>
                <span style={{ fontSize: 12, color: C.muted }}>עם נתוני דוגמה</span>
              </div>
              <WaBubble doc={draft} values={sampleValues} imageUrl={draft.header.type === 'image' ? draft.header.url : null} />
              {!!issues.length && (
                <div style={{ marginTop: 12, display: 'grid', gap: 4 }}>
                  {issues.slice(0, 6).map((i, n) => (
                    <div key={n} style={{ display: 'flex', gap: 6, fontSize: 12.5, color: C.err, lineHeight: 1.45 }}>
                      <Ms size={15}>error</Ms><span>{i.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {view && view.params.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: C.body }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>סדר המשתנים ב-Meta</div>
                  {view.params.map((p) => (
                    <div key={p.index} style={{ display: 'flex', gap: 6 }}>
                      <code dir="ltr">{`{{${p.index}}}`}</code><span>{p.label_he}</span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setShowPayload((s) => !s)} aria-expanded={showPayload}
                style={{ marginTop: 12, background: 'none', border: 0, padding: 0, color: C.purple, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Ms size={16}>{showPayload ? 'expand_less' : 'code'}</Ms>{showPayload ? 'הסתרת' : 'מה נשלח ל-Meta'}
              </button>
              {showPayload && (
                <pre dir="ltr" style={{ marginTop: 8, maxHeight: 320, overflow: 'auto', fontSize: 11.5, background: C.paperSoft, border: `1px solid ${C.line2}`, borderRadius: radius.md, padding: 10, textAlign: 'left' }}>
                  {payload ? JSON.stringify(payload, null, 2) : 'טוען…'}
                </pre>
              )}
            </Card>
          </aside>
        )}
      </div>

      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 24, insetInlineStart: '50%', transform: 'translateX(50%)', background: C.purpleDark, color: '#FFFFFF', padding: '10px 18px', borderRadius: 12, fontSize: 14, zIndex: 50, maxWidth: 'calc(100vw - 32px)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
