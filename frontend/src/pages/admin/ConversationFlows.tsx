/**
 * Admin: guest WhatsApp RSVP conversation flow settings (/admin/flows).
 *
 * Edits the SPARSE override of one scope (ברירת מחדל / סוג אירוע / אירוע).
 * Every field shows whether it is the default, changed here, or inherited from
 * the general layer; "איפוס" removes the field from this scope's override.
 * Saving creates a new version (history + revert). The preview on the end side
 * is rendered by the server from the unsaved draft (shared/domain/flow_config).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { color as C, radius } from '../../design/tokens';
import { Btn, Card, Chip, Kicker, Ms } from '../../components/v6/ui';

// ---------------------------------------------------------------- types

type Json = Record<string, any>;

interface ScopeRow {
  scope: 'global' | 'event_type' | 'event';
  scope_key: string;
  label: string;
  version: number | null;
  updated_at: string | null;
  changed_count: number;
}

interface FieldSpec {
  kind: 'bool' | 'int' | 'text' | 'buttons' | 'enum';
  label: string;
  vars?: string[];
  max?: number;
  min?: number;
  keys?: string[];
  values?: string[];
}

interface Schema {
  fields: Record<string, FieldSpec>;
  variables: { name: string; label: string }[];
  limits: { buttons: number; button_label: number; interactive_body: number; text: number };
}

interface ScopePayload {
  scope: string;
  scope_key: string;
  version: number | null;
  updated_at: string | null;
  override: Json;
  inherited: Json;
  inherited_changed_paths: string[];
  effective: Json;
  defaults: Json;
}

interface VersionRow {
  version: number;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
  note: string | null;
  changed_paths: string[];
}

interface Turn {
  from: 'bot' | 'guest';
  text: string;
  buttons?: string[];
  step?: string;
  note?: string;
  tap?: boolean;
}

interface FieldError { path: string; code: string; message: string }

// ---------------------------------------------------------------- path utils

const getPath = (o: Json | undefined, path: string): any =>
  path.split('.').reduce<any>((cur, k) => (cur && typeof cur === 'object' ? cur[k] : undefined), o);

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? {}));

const setPath = (o: Json, path: string, value: any): Json => {
  const out = clone(o);
  const parts = path.split('.');
  let cur: Json = out;
  parts.slice(0, -1).forEach((k) => {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  });
  cur[parts[parts.length - 1]] = value;
  return out;
};

const delPath = (o: Json, path: string): Json => {
  const out = clone(o);
  const parts = path.split('.');
  const stack: [Json, string][] = [];
  let cur: Json = out;
  for (const k of parts.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') return out;
    stack.push([cur, k]);
    cur = cur[k];
  }
  delete cur[parts[parts.length - 1]];
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const [parent, k] = stack[i];
    if (parent[k] && typeof parent[k] === 'object' && !Object.keys(parent[k]).length) delete parent[k];
  }
  return out;
};

const deepMerge = (base: Json, over: Json): Json => {
  const out = clone(base);
  Object.entries(over || {}).forEach(([k, v]) => {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? deepMerge(out[k], v) : v;
  });
  return out;
};

const hasPath = (o: Json, path: string) => getPath(o, path) !== undefined;

// ---------------------------------------------------------------- copy

const PATHS_TABS: { id: string; label: string }[] = [
  { id: 'confirm', label: 'מגיעים' },
  { id: 'decline', label: 'לא מגיעים' },
  { id: 'maybe', label: 'אולי' },
  { id: 'didnt_understand', label: 'לא הבנו' },
  { id: 'already_answered', label: 'כבר ענו' },
  { id: 'update', label: 'עדכון' },
  { id: 'opt_out', label: 'הסרה' },
];

const BUTTON_KEY_LABELS: Record<string, string> = {
  no_notes: 'אין הערות',
  write_note: 'כתיבת הערה',
  update: 'עדכון הגעה',
  add_note: 'הוספת הערה',
  decline: 'ביטול / סירוב',
  change_count: 'שינוי כמות',
  change_mind: 'שינוי דעה',
  confirm: 'אישור הגעה',
};

const ENUM_LABELS: Record<string, string> = {
  restart: 'לרשום את התשובה החדשה ולהמשיך ממנה (כמו היום)',
  acknowledge: 'להשיב שכבר רשמנו, בלי לשנות',
};

const scopeId = (s: { scope: string; scope_key: string }) => `${s.scope}/${s.scope_key}`;

// ---------------------------------------------------------------- small UI

const inputBase: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14.5, color: C.ink,
  background: '#FFFFFF', border: `1.5px solid ${C.field}`, borderRadius: radius.md, padding: '10px 12px',
  outline: 'none', lineHeight: 1.55,
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 999, border: `1.5px solid ${checked ? C.purple : C.field}`,
        background: checked ? C.purple : C.paperWarm, position: 'relative', cursor: 'pointer', flex: 'none', padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, width: 19, height: 19, borderRadius: '50%', background: '#FFFFFF',
        insetInlineStart: checked ? 20 : 2, transition: 'inset-inline-start .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

type FieldState = 'default' | 'changed' | 'inherited';

function StateBadge({ state, onReset }: { state: FieldState; onReset: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {state === 'changed' && <Chip tone="lav">שונה</Chip>}
      {state === 'inherited' && <Chip tone="warn">שונה בברירת המחדל</Chip>}
      {state === 'default' && <Chip tone="quiet">ברירת מחדל</Chip>}
      {state === 'changed' && (
        <button type="button" onClick={onReset} className="su-hover-underline"
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: C.purple, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }}>
          איפוס לברירת המחדל
        </button>
      )}
    </span>
  );
}

function FieldRow({ label, state, onReset, error, children, hint }: {
  label: string; state: FieldState; onReset: () => void; error?: string; children: React.ReactNode; hint?: React.ReactNode;
}) {
  return (
    <div style={{ padding: '14px 0', borderTop: `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{label}</span>
        <StateBadge state={state} onReset={onReset} />
      </div>
      {children}
      {hint && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>{hint}</div>}
      {error && (
        <div role="alert" style={{ display: 'flex', gap: 6, alignItems: 'center', color: C.err, fontSize: 13, marginTop: 6 }}>
          <Ms size={16}>error</Ms>{error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- preview

function waFormat(text: string): React.ReactNode[] {
  // WhatsApp *bold* only - enough for a faithful preview.
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2
      ? <strong key={i}>{part.slice(1, -1)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>);
}

function WhatsAppPreview({ turns, loading }: { turns: Turn[]; loading: boolean }) {
  return (
    <div style={{ borderRadius: radius.xl, overflow: 'hidden', border: `1.5px solid ${C.lineApp}`, background: C.waChat }}>
      <div style={{ background: C.waHeader, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${C.lineApp}` }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: C.waGreen, color: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
          <Ms size={18}>celebration</Ms>
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.waText }}>ShowUp</div>
          <div style={{ fontSize: 11.5, color: C.waMeta }}>{loading ? 'מעדכן תצוגה…' : 'תצוגה מקדימה'}</div>
        </div>
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 320, maxHeight: '64vh', overflowY: 'auto', opacity: loading ? 0.6 : 1 }}>
        {turns.map((t, i) => (
          <div key={i} style={{ alignSelf: t.from === 'bot' ? 'flex-start' : 'flex-end', maxWidth: '86%' }}>
            {t.note && <div style={{ fontSize: 11, color: C.waMeta, margin: '0 4px 3px' }}>{t.note}</div>}
            <div style={{
              background: t.from === 'bot' ? '#FFFFFF' : C.waOut, color: C.waText, fontSize: 13.5, lineHeight: 1.5,
              padding: '7px 10px', borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              boxShadow: '0 1px 0.5px rgba(11,20,26,.13)',
            }}>
              {t.tap && <Ms size={14} style={{ color: C.waMeta, marginInlineEnd: 4, verticalAlign: '-2px' }}>touch_app</Ms>}
              {waFormat(t.text)}
            </div>
            {!!t.buttons?.length && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3 }}>
                {t.buttons.map((b) => (
                  <div key={b} style={{ background: '#FFFFFF', color: C.waLink, fontSize: 13.5, fontWeight: 500, textAlign: 'center', padding: '7px 10px', borderRadius: 10, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

function ConversationFlows() {
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [selected, setSelected] = useState<{ scope: string; scope_key: string }>({ scope: 'global', scope_key: 'default' });
  const [payload, setPayload] = useState<ScopePayload | null>(null);
  const [draft, setDraft] = useState<Json>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [previewPath, setPreviewPath] = useState('confirm');
  const [transcripts, setTranscripts] = useState<Record<string, Turn[]>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const textRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const dirty = useMemo(
    () => !!payload && JSON.stringify(draft) !== JSON.stringify(payload.override || {}),
    [draft, payload],
  );
  const effective = useMemo(() => deepMerge(payload?.inherited || {}, draft), [payload, draft]);
  const errorAt = (path: string) => errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message;

  const loadList = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/admin/flows');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setScopes(data.scopes);
      setSchema(data.schema);
    } catch (e: any) {
      setLoadError(e?.message || 'שגיאה בטעינת ההגדרות');
    }
  }, []);

  const loadScope = useCallback(async (s: { scope: string; scope_key: string }) => {
    try {
      const res = await fetchWithAuth(`/api/admin/flows/${s.scope}/${encodeURIComponent(s.scope_key)}`);
      if (!res.ok) throw new Error(await res.text());
      const data: ScopePayload = await res.json();
      setPayload(data);
      setDraft(clone(data.override || {}));
      setErrors([]);
      setVersions(null);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'שגיאה בטעינת ההגדרות');
    }
  }, []);

  const loadVersions = useCallback(async () => {
    const res = await fetchWithAuth(`/api/admin/flows/${selected.scope}/${encodeURIComponent(selected.scope_key)}/versions`);
    if (res.ok) setVersions((await res.json()).versions);
  }, [selected]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadScope(selected); }, [selected, loadScope]);
  useEffect(() => { if (showVersions) loadVersions(); }, [showVersions, loadVersions]);

  // Live preview of the unsaved draft (debounced).
  useEffect(() => {
    if (!payload) return undefined;
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithAuth('/api/admin/flows/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: payload.scope, scope_key: payload.scope_key, config: draft }),
        });
        if (res.ok) {
          const data = await res.json();
          setTranscripts(data.transcripts || {});
          setErrors(data.errors || []);
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [draft, payload]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const pick = (s: { scope: string; scope_key: string }) => {
    if (scopeId(s) === scopeId(selected)) return;
    if (dirty && !window.confirm('יש שינויים שלא נשמרו. לעבור בכל זאת?')) return;
    setSelected(s);
  };

  const fieldState = (path: string): FieldState => {
    if (hasPath(draft, path)) return 'changed';
    if ((payload?.inherited_changed_paths || []).some((p) => p === path || p.startsWith(`${path}.`))) return 'inherited';
    return 'default';
  };
  const change = (path: string, value: any) => setDraft((d) => setPath(d, path, value));
  const reset = (path: string) => setDraft((d) => delPath(d, path));

  const save = async () => {
    if (!payload) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/flows/${payload.scope}/${encodeURIComponent(payload.scope_key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: draft, note: note.trim() || null, expected_version: payload.version ?? 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422 && data?.detail?.errors) {
        setErrors(data.detail.errors);
        setToast('יש שדות שצריך לתקן לפני שמירה');
        return;
      }
      if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'השמירה נכשלה');
      setPayload(data);
      setDraft(clone(data.override || {}));
      setNote('');
      setToast(`נשמר - גרסה ${data.version}`);
      loadList();
      if (showVersions) loadVersions();
    } catch (e: any) {
      setToast(e?.message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const revert = async (version: number) => {
    if (!payload) return;
    const msg = version === 0 ? 'לאפס את כל ההגדרות בהיקף הזה לברירת המחדל?' : `לשחזר את גרסה ${version}? תיווצר גרסה חדשה.`;
    if (!window.confirm(msg)) return;
    const res = await fetchWithAuth(`/api/admin/flows/${payload.scope}/${encodeURIComponent(payload.scope_key)}/revert/${version}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast(typeof data?.detail === 'string' ? data.detail : 'השחזור נכשל');
      return;
    }
    setPayload(data);
    setDraft(clone(data.override || {}));
    setToast(version === 0 ? 'אופס לברירת המחדל' : `שוחזרה גרסה ${version}`);
    loadList();
    loadVersions();
  };

  // -------------------------------------------------------------- field renderers

  const spec = (path: string): FieldSpec => schema?.fields[path] || { kind: 'text', label: path };

  const insertVar = (path: string, name: string) => {
    const el = textRefs.current[path];
    const cur = String(getPath(effective, path) ?? '');
    const token = `{${name}}`;
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    change(path, cur.slice(0, start) + token + cur.slice(end));
    requestAnimationFrame(() => {
      if (el) { el.focus(); el.setSelectionRange(start + token.length, start + token.length); }
    });
  };

  const renderText = (path: string, label?: string) => {
    const s = spec(path);
    const value = String(getPath(effective, path) ?? '');
    const varLabel = (n: string) => schema?.variables.find((v) => v.name === n)?.label || n;
    return (
      <FieldRow key={path} label={label || s.label} state={fieldState(path)} onReset={() => reset(path)} error={errorAt(path)}
        hint={<span className="num">{value.length}/{s.max}</span>}>
        <textarea
          ref={(el) => { textRefs.current[path] = el; }}
          value={value}
          onChange={(e) => change(path, e.target.value)}
          rows={Math.min(8, Math.max(3, value.split('\n').length + 1))}
          dir="rtl"
          style={{ ...inputBase, resize: 'vertical', borderColor: errorAt(path) ? C.errBorder : C.field }}
        />
        {!!s.vars?.length && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {s.vars.map((v) => (
              <button key={v} type="button" onClick={() => insertVar(path, v)} title={`{${v}}`}
                style={{ height: 28, padding: '0 10px', borderRadius: 9, border: `1.5px solid ${C.tintBorder}`, background: C.tintApp, color: C.purpleDark, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                + {varLabel(v)}
              </button>
            ))}
          </div>
        )}
      </FieldRow>
    );
  };

  const renderBool = (path: string, label?: string) => {
    const s = spec(path);
    const value = !!getPath(effective, path);
    return (
      <FieldRow key={path} label={label || s.label} state={fieldState(path)} onReset={() => reset(path)} error={errorAt(path)}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: C.body, cursor: 'pointer' }}>
          <Toggle checked={value} onChange={(v) => change(path, v)} label={label || s.label} />
          {value ? 'פעיל' : 'כבוי'}
        </label>
      </FieldRow>
    );
  };

  const renderInt = (path: string) => {
    const s = spec(path);
    const value = getPath(effective, path);
    return (
      <FieldRow key={path} label={s.label} state={fieldState(path)} onReset={() => reset(path)} error={errorAt(path)}>
        <input type="number" inputMode="numeric" min={s.min} max={s.max} value={value ?? ''}
          onChange={(e) => change(path, e.target.value === '' ? '' : Math.trunc(Number(e.target.value)))}
          style={{ ...inputBase, width: 120 }} />
      </FieldRow>
    );
  };

  const renderEnum = (path: string) => {
    const s = spec(path);
    const value = getPath(effective, path);
    return (
      <FieldRow key={path} label={s.label} state={fieldState(path)} onReset={() => reset(path)} error={errorAt(path)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(s.values || []).map((v) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: C.body, cursor: 'pointer' }}>
              <input type="radio" name={path} checked={value === v} onChange={() => change(path, v)} style={{ accentColor: C.purple }} />
              {ENUM_LABELS[v] || v}
            </label>
          ))}
        </div>
      </FieldRow>
    );
  };

  const renderButtons = (path: string) => {
    const s = spec(path);
    const max = schema?.limits.button_label || 20;
    return (
      <div key={path} style={{ padding: '14px 0', borderTop: `1px solid ${C.line2}` }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: 4 }}>{s.label}</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>עד {schema?.limits.buttons || 3} כפתורים, עד {max} תווים לכפתור (מגבלת וואטסאפ)</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {(s.keys || []).map((k) => {
            const p = `${path}.${k}`;
            const value = String(getPath(effective, p) ?? '');
            const over = value.trim().length > max;
            const err = errors.find((e) => e.path === p)?.message;
            return (
              <div key={k}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: C.body }}>{BUTTON_KEY_LABELS[k] || k}</span>
                  <StateBadge state={fieldState(p)} onReset={() => reset(p)} />
                </div>
                <div style={{ position: 'relative' }}>
                  <input value={value} onChange={(e) => change(p, e.target.value)} dir="rtl"
                    style={{ ...inputBase, paddingInlineEnd: 64, borderColor: over || err ? C.errBorder : C.field }} />
                  <span className="num" style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12.5, fontWeight: 600, color: over ? C.err : C.muted }}>
                    {value.trim().length}/{max}
                  </span>
                </div>
                {err && <div role="alert" style={{ color: C.err, fontSize: 13, marginTop: 4 }}>{err}</div>}
              </div>
            );
          })}
        </div>
        {errors.filter((e) => e.path === path).map((e) => (
          <div key={e.code} role="alert" style={{ color: C.err, fontSize: 13, marginTop: 6 }}>{e.message}</div>
        ))}
      </div>
    );
  };

  // Plain render helpers (NOT components): a component declared in render would
  // remount its subtree on every keystroke and drop the textarea's focus.
  const sub = (title: string, children: React.ReactNode, off?: boolean) => (
    <div style={{ marginTop: title ? 18 : 0 }}>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: off ? C.muted : C.purple, letterSpacing: '.02em', marginBottom: 2 }}>{title}</div>}
      <div style={{ opacity: off ? 0.55 : 1 }}>{children}</div>
    </div>
  );

  const section = (id: string, kicker: string, title: string, children: React.ReactNode) => (
    <Card as="section" id={id} style={{ marginBottom: 16 }}>
      <Kicker>{kicker}</Kicker>
      <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: '6px 0 4px' }}>{title}</h3>
      {children}
    </Card>
  );

  const on = (path: string) => !!getPath(effective, path);
  const groups = [
    { title: 'ברירת מחדל', rows: scopes.filter((s) => s.scope === 'global') },
    { title: 'לפי סוג אירוע', rows: scopes.filter((s) => s.scope === 'event_type') },
    { title: 'אירועים ספציפיים', rows: scopes.filter((s) => s.scope === 'event') },
  ].filter((g) => g.rows.length);
  const current = scopes.find((s) => scopeId(s) === scopeId(selected));

  return (
    <div dir="rtl" style={{ background: C.paperApp, minHeight: '100%', color: C.ink, fontFamily: 'inherit' }}>
      <style>{`
        .cf-grid { display: grid; grid-template-columns: 220px minmax(0,1fr) 360px; gap: 20px; align-items: start; }
        .cf-sticky { position: sticky; top: 16px; }
        @media (max-width: 1180px) { .cf-grid { grid-template-columns: 200px minmax(0,1fr); } .cf-preview { grid-column: 1 / -1; } .cf-sticky { position: static; } }
        @media (max-width: 760px) { .cf-grid { grid-template-columns: minmax(0,1fr); } }
        .cf-scope:hover { background: ${C.paperSoft}; }
      `}</style>

      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <Kicker>הגדרות מערכת</Kicker>
          <h1 style={{ fontSize: 'clamp(26px,3vw,36px)', fontWeight: 600, letterSpacing: '-0.03em', margin: '6px 0 4px' }}>שיחת אישור ההגעה</h1>
          <p style={{ margin: 0, color: C.body, fontSize: 15, maxWidth: '62ch' }}>
            מה הבוט עונה לאורחים בוואטסאפ אחרי שהם עונים להזמנה. שינוי כאן חל על כל האירועים בהיקף שנבחר, בלי שינוי קוד.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {dirty && <Chip tone="warn">שינויים שלא נשמרו</Chip>}
          <Btn kind="smallGhost" onClick={() => setShowVersions((v) => !v)}>
            <Ms size={18}>history</Ms>היסטוריית גרסאות
          </Btn>
          <Btn kind="smallGhost" disabled={!dirty} onClick={() => payload && setDraft(clone(payload.override || {}))}>ביטול שינויים</Btn>
          <Btn kind="smallPrimary" disabled={!dirty || saving} onClick={save}>{saving ? 'שומר…' : 'שמירה כגרסה חדשה'}</Btn>
        </div>
      </header>

      {loadError && <Card style={{ borderColor: C.errBorder, background: C.errBg, color: C.err, marginBottom: 16 }}>{loadError}</Card>}

      <div className="cf-grid">
        {/* Scope picker */}
        <nav aria-label="היקף ההגדרות" className="cf-sticky">
          {groups.map((g) => (
            <div key={g.title} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, letterSpacing: '.05em', color: C.muted, fontWeight: 500, margin: '0 10px 6px' }}>{g.title}</div>
              {g.rows.map((s) => {
                const active = scopeId(s) === scopeId(selected);
                return (
                  <button key={scopeId(s)} type="button" className={active ? undefined : 'cf-scope'} onClick={() => pick(s)}
                    aria-current={active ? 'true' : undefined}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '9px 10px', borderRadius: radius.md, border: active ? `1.5px solid ${C.purple}` : '1.5px solid transparent',
                      background: active ? C.tintApp : 'transparent', color: active ? C.purpleDark : C.ink, fontWeight: active ? 600 : 500,
                      fontSize: 14.5, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
                    }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                    {s.changed_count > 0 && <Chip tone="lav" style={{ height: 22, fontSize: 11.5, padding: '0 7px' }}>{s.changed_count}</Chip>}
                  </button>
                );
              })}
            </div>
          ))}
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, margin: '0 10px' }}>
            סוג אירוע יורש מברירת המחדל, ומשנה רק את מה שתשנו בו.
          </p>
        </nav>

        {/* Editor */}
        <main style={{ minWidth: 0 }}>
          {payload && schema && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 2px 14px', color: C.body, fontSize: 14 }}>
                <strong style={{ color: C.ink, fontSize: 16 }}>{current?.label || payload.scope_key}</strong>
                <span>{payload.version ? `גרסה ${payload.version}` : 'ללא שינויים שמורים'}</span>
                {payload.updated_at && <span style={{ color: C.muted }}>· עודכן {new Date(payload.updated_at).toLocaleString('he-IL')}</span>}
                {payload.version ? (
                  <button type="button" onClick={() => revert(0)} className="su-hover-underline"
                    style={{ background: 'none', border: 0, color: C.purple, fontWeight: 600, cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit' }}>
                    איפוס כל ההיקף לברירת המחדל
                  </button>
                ) : null}
              </div>

              {showVersions && (
                <Card style={{ marginBottom: 16 }}>
                  <Kicker>היסטוריה</Kicker>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: '6px 0 8px' }}>גרסאות קודמות</h3>
                  {!versions && <div style={{ color: C.muted, fontSize: 14 }}>טוען…</div>}
                  {versions && !versions.length && <div style={{ color: C.muted, fontSize: 14 }}>עדיין לא נשמרו גרסאות בהיקף הזה.</div>}
                  {versions?.map((v) => (
                    <div key={v.version} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.line2}`, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          גרסה {v.version} {v.is_active && <Chip tone="ok" style={{ marginInlineStart: 6 }}>פעילה</Chip>}
                        </div>
                        <div style={{ fontSize: 12.5, color: C.muted }}>
                          {v.created_at ? new Date(v.created_at).toLocaleString('he-IL') : ''}
                          {' · '}{v.changed_paths.length} שדות שונו{v.note ? ` · ${v.note}` : ''}
                        </div>
                      </div>
                      {!v.is_active && <Btn kind="smallGhost" onClick={() => revert(v.version)}>שחזור</Btn>}
                    </div>
                  ))}
                </Card>
              )}

              {section('cf-confirm', 'מסלול 1', 'אחרי "מגיעים"', (<>
                {sub('שאלת כמות', (<>
                  {renderBool('after_confirm.ask_party_size.enabled')}
                </>))}
                {sub('', (<>
                  {renderText('after_confirm.ask_party_size.text')}
                  {renderText('after_confirm.ask_party_size.retry_text')}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', columnGap: 16 }}>
                    {renderInt('after_confirm.ask_party_size.min')}
                    {renderInt('after_confirm.ask_party_size.max')}
                  </div>
                </>), !on('after_confirm.ask_party_size.enabled'))}
                {sub('שאלות לאורחים', (<>
                  {renderBool('after_confirm.ask_guest_questions.enabled')}
                  <div style={{ fontSize: 12.5, color: C.muted }}>השאלות עצמן מוגדרות בכל אירוע ב"שאלות לאורחים".</div>
                </>))}
                {sub('הערות', (<>
                  {renderBool('after_confirm.ask_notes.enabled')}
                </>))}
                {sub('', (<>
                  {renderText('after_confirm.ask_notes.text')}
                  {renderButtons('after_confirm.ask_notes.buttons')}
                  {renderText('after_confirm.ask_notes.note_prompt_text')}
                </>), !on('after_confirm.ask_notes.enabled'))}
                {sub('סיום', (<>
                  {renderText('after_confirm.done_message.text')}
                  {renderButtons('after_confirm.done_message.buttons')}
                </>))}
                {sub('תפריט "לעדכן הגעה"', (<>
                  {renderText('after_confirm.update_menu.text')}
                  {renderButtons('after_confirm.update_menu.buttons')}
                </>))}
              </>))}

              {section('cf-decline', 'מסלול 2', 'אחרי "לא מגיעים"', (<>
                {renderText('after_decline.text')}
                {renderBool('after_decline.allow_change_mind')}
                {sub('', (<>
                  {renderButtons('after_decline.buttons')}
                </>), !on('after_decline.allow_change_mind'))}
              </>))}

              {section('cf-maybe', 'מסלול 3', 'אחרי "אולי"', (<>
                {renderText('after_maybe.text')}
                {renderBool('after_maybe.remind')}
                {renderButtons('after_maybe.buttons')}
              </>))}

              {section('cf-didnt', 'מצבים מיוחדים', 'לא הבנו את התשובה', (<>
                {renderText('didnt_understand.text')}
              </>))}

              {section('cf-already', 'מצבים מיוחדים', 'אורח שכבר ענה לוחץ שוב', (<>
                {renderEnum('already_answered.behavior')}
                {sub('', (<>
                  {renderText('already_answered.text')}
                </>), getPath(effective, 'already_answered.behavior') !== 'acknowledge')}
              </>))}

              {section('cf-optout', 'מצבים מיוחדים', 'הסרה מרשימת התפוצה', (<>
                {renderText('opt_out.text')}
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>נשלח לפני שידוע לאיזה אירוע ההודעה שייכת, לכן אין בו משתנים.</div>
              </>))}

              <Card style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="הערה לגרסה (לא חובה)"
                  style={{ ...inputBase, flex: '1 1 240px', width: 'auto' }} />
                {errors.length > 0 && <Chip tone="err">{errors.length} שגיאות</Chip>}
                <Btn kind="primary" disabled={!dirty || saving} onClick={save}>{saving ? 'שומר…' : 'שמירה כגרסה חדשה'}</Btn>
              </Card>
            </>
          )}
        </main>

        {/* Preview */}
        <aside className="cf-preview cf-sticky" aria-label="תצוגה מקדימה">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {PATHS_TABS.map((p) => {
              const active = previewPath === p.id;
              return (
                <button key={p.id} type="button" onClick={() => setPreviewPath(p.id)} aria-pressed={active}
                  style={{
                    height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1.5px solid ${active ? C.purple : C.lineApp}`, background: active ? C.tintApp : '#FFFFFF', color: active ? C.purpleDark : C.body,
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <WhatsAppPreview turns={transcripts[previewPath] || []} loading={previewLoading} />
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, marginTop: 8 }}>
            הדמיה עם נתוני דוגמה. ההזמנה עצמה היא תבנית מהקטלוג ואינה נערכת כאן.
          </p>
        </aside>
      </div>

      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 24, insetInlineStart: '50%', transform: 'translateX(50%)', background: C.purpleDark, color: '#FFFFFF', padding: '10px 18px', borderRadius: 12, fontSize: 14, zIndex: 50 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

export default ConversationFlows;
