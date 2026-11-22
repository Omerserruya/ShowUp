/**
 * Thin client for /api/admin/templates/* (Template Studio). Every call resolves
 * to a typed value or throws a TemplatesApiError with a Hebrew message.
 */
import { fetchWithAuth } from '../../utils/fetchWithAuth';

export type HeaderType = 'none' | 'text' | 'image';
export type ButtonType = 'QUICK_REPLY' | 'URL';
export type MetaStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled';

export interface TplButton {
  type: ButtonType;
  text: string;
  action?: string;
  url_var?: string;
  url?: string;
}

export interface TplHeader {
  type: HeaderType;
  text?: string;
  url?: string;
  source?: 'event' | 'fixed';
}

export interface TemplateDoc {
  name: string;
  title: string;
  group: string;
  language: string;
  category: string;
  header: TplHeader;
  body: string;
  footer: string;
  buttons: TplButton[];
  notes: string;
  event_types: string[];
  samples: Record<string, string>;
}

export interface Issue { field: string; code: string; message: string }
export interface Validation { errors: Issue[]; warnings: Issue[] }

export interface ParamHint {
  index: number;
  var: string;
  label_he: string;
  sample: string;
  flow_var: string | null;
  suggested: string;
}

export interface TemplateView {
  key: string;
  ref: string;
  doc: TemplateDoc;
  title: string;
  group: string;
  group_label: string;
  meta_name: string | null;
  meta_id: string | null;
  meta_status: MetaStatus;
  status_label: string;
  rejection_reason: string | null;
  version: number;
  archived: boolean;
  submitted_at: string | null;
  last_sync: string | null;
  created_at: string | null;
  updated_at: string | null;
  has_unsubmitted_changes: boolean;
  submitted: boolean;
  live: { meta_name: string; meta_id: string | null; version: number; status: string; approved_at: string | null } | null;
  deliverable: boolean;
  usable_in: string[];
  params: ParamHint[];
  validation?: Validation;
}

export interface ReadonlyTemplate {
  source: 'catalog' | 'system';
  key: string;
  title: string;
  group: string;
  group_label: string;
  event_types: string[];
  body: string;
  meta_name: string | null;
  meta_status: string;
  sendable?: boolean;
  placeholder?: boolean;
  category?: string;
  language?: string;
  rejection_reason?: string;
  doc?: Record<string, unknown> | null;
  meta_live?: { id?: string; status?: string; category?: string; language?: string } | null;
}

export interface GroupDef { id: string; label: string; guest: boolean }

export interface ListResponse {
  templates: TemplateView[];
  catalog: ReadonlyTemplate[];
  system: ReadonlyTemplate[];
  groups: GroupDef[];
  statuses: { id: MetaStatus; label: string }[];
  meta_configured: boolean;
  meta_live?: boolean;
}

export interface VariableDef { name: string; label_he: string; sample: string; scope: string; in_text: boolean; flow_var: string | null }

export interface VariablesResponse {
  variables: VariableDef[];
  url_vars: { name: string; label_he: string; base: string; sample: string }[];
  quick_reply_actions: { id: string; label: string }[];
  groups: GroupDef[];
  categories: string[];
  event_types: { key: string; name_he: string }[];
  limits: Record<string, number>;
}

export interface Rendered {
  header_text: string | null;
  header_image: string | null;
  body: string;
  footer: string | null;
  buttons: { type: ButtonType; text: string; url?: string }[];
  text: string;
}

export interface PreviewResponse {
  source: 'sample' | 'event';
  rendered: Rendered;
  values: Record<string, string>;
  params: ParamHint[];
  meta_create_payload: Record<string, unknown>;
  whatsapp_send_payload: Record<string, unknown> | null;
  validation: Validation;
}

export interface SubmitResponse {
  dry_run: boolean;
  ok: boolean;
  simulated?: boolean;
  mode: 'create' | 'edit';
  meta_name: string;
  meta_payload?: Record<string, unknown>;
  error?: string | null;
  meta_configured: boolean;
  warnings?: Issue[];
  template?: TemplateView;
}

export interface ImportResult {
  dry_run: boolean;
  counts: Record<'created' | 'updated' | 'unchanged' | 'conflict' | 'error', number>;
  results: { index: number; name: string | null; action: string; reason?: string; errors?: Issue[] }[];
}

export interface ApprovedTemplate {
  key: string;
  ref: string;
  title: string;
  group: string;
  group_label: string;
  name: string;
  language: string;
  body: string;
  params: ParamHint[];
  body_params_only: boolean;
}

const BASE = '/api/admin/templates';

export class TemplatesApiError extends Error {
  status: number;
  issues: Issue[];
  constructor(message: string, status: number, issues: Issue[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

function messageFor(status: number, data: any): string {
  if (typeof data?.detail === 'string') return data.detail;
  if (data?.detail?.message === 'validation_failed') return 'יש שדות שצריך לתקן';
  if (status === 401 || status === 403) return 'אין הרשאה. יש להתחבר מחדש כמנהל מערכת.';
  if (status === 404) return 'לא נמצא';
  if (status >= 500) return 'השרת לא זמין כרגע. כדאי לנסות שוב בעוד רגע.';
  return 'הפעולה נכשלה';
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithAuth(`${BASE}${path}`, init);
  } catch {
    throw new TemplatesApiError('אין חיבור לשרת כרגע.', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const issues: Issue[] = Array.isArray(data?.detail?.errors) ? data.detail.errors : [];
    throw new TemplatesApiError(messageFor(res.status, data), res.status, issues);
  }
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const k = (key: string) => `/${encodeURIComponent(key)}`;

export const templatesApi = {
  list: (refresh = false) => call<ListResponse>(refresh ? '?refresh=true' : ''),
  variables: () => call<VariablesResponse>('/variables'),
  approved: (group?: string) =>
    call<{ templates: ApprovedTemplate[] }>(`/approved${group ? `?group=${encodeURIComponent(group)}` : ''}`),
  get: (key: string) => call<TemplateView>(k(key)),
  create: (doc: Partial<TemplateDoc>) => call<TemplateView>('', json('POST', { doc })),
  update: (key: string, doc: TemplateDoc, expectedUpdatedAt?: string | null) =>
    call<TemplateView>(k(key), json('PUT', { doc, expected_updated_at: expectedUpdatedAt || null })),
  remove: (key: string) => call<{ deleted: string }>(k(key), { method: 'DELETE' }),
  setGroup: (key: string, group: string) => call<TemplateView>(`${k(key)}/group`, json('POST', { group })),
  archive: (key: string, archived: boolean) => call<TemplateView>(`${k(key)}/archive`, json('POST', { archived })),
  validate: (doc: TemplateDoc, key?: string | null) =>
    call<Validation & { valid: boolean; suggested_name: string }>('/validate', json('POST', { doc, key: key || null })),
  preview: (doc: TemplateDoc, key?: string | null, eventId?: string | null) =>
    call<PreviewResponse>('/preview', json('POST', { doc, key: key || null, event_id: eventId || null })),
  submit: (key: string, dryRun: boolean) => call<SubmitResponse>(`${k(key)}/submit`, json('POST', { dry_run: dryRun })),
  sync: (key: string) => call<TemplateView>(`${k(key)}/sync`, { method: 'POST' }),
  syncAll: () => call<{ synced: number }>('/sync', { method: 'POST' }),
  duplicate: (source: 'custom' | 'catalog' | 'system', sourceKey: string, extra: { name?: string; title?: string; group?: string; replace?: boolean } = {}) =>
    call<TemplateView>('/duplicate', json('POST', { source, source_key: sourceKey, ...extra })),
  importDocs: (templates: unknown[], dryRun: boolean) =>
    call<ImportResult>('/import', json('POST', { templates, dry_run: dryRun })),
  exportUrl: `${BASE}/export`,
  exportDocs: async (scope: 'custom' | 'all' = 'custom'): Promise<Blob> => {
    const res = await fetchWithAuth(`${BASE}/export?scope=${scope}`);
    if (!res.ok) throw new TemplatesApiError('הייצוא נכשל', res.status);
    return res.blob();
  },
};

export const errMsg = (e: unknown, fallback = 'הפעולה נכשלה'): string =>
  e instanceof TemplatesApiError ? e.message : (e as any)?.message || fallback;

export const STATUS_TONE: Record<string, 'ok' | 'warn' | 'err' | 'lav' | 'quiet'> = {
  draft: 'quiet', pending: 'warn', approved: 'ok', rejected: 'err', paused: 'warn', disabled: 'err',
  managed: 'lav', none: 'quiet',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'טיוטה', pending: 'ממתין לאישור Meta', approved: 'מאושר', rejected: 'נדחה',
  paused: 'מושהה', disabled: 'מושבת', managed: 'מנוהל בקוד', none: 'לא נשלח',
};

export const emptyDoc = (group = 'invitation'): TemplateDoc => ({
  name: '', title: '', group, language: 'he', category: 'UTILITY', header: { type: 'none' },
  body: '', footer: '', buttons: [], notes: '', event_types: [], samples: {},
});

/** Client mirror of the server rules (instant inline feedback; server is authoritative). */
export function quickValidate(doc: TemplateDoc): Issue[] {
  const out: Issue[] = [];
  const add = (field: string, code: string, message: string) => out.push({ field, code, message });
  if (!doc.name) add('name', 'required', 'חסר שם תבנית ל-Meta');
  else if (!/^[a-z0-9_]+$/.test(doc.name)) add('name', 'invalid', 'רק אותיות אנגליות קטנות, ספרות וקו תחתון');
  else if (doc.name.length > 80) add('name', 'too_long', 'עד 80 תווים');
  if (!doc.title.trim()) add('title', 'required', 'חסר שם תצוגה');
  const body = doc.body.trim();
  if (!body) add('body', 'required', 'גוף ההודעה ריק');
  else {
    const numbered = body.replace(/\{\{\s*[^{}]*?\s*\}\}/g, '{{1}}');
    if (numbered.length > 1024) add('body', 'too_long', `גוף ההודעה ארוך מדי (${numbered.length}/1024)`);
    if (/^\{\{[^{}]*\}\}/.test(body)) add('body', 'var_at_start', 'ההודעה לא יכולה להתחיל במשתנה');
    if (/\{\{[^{}]*\}\}\s*$/.test(body)) add('body', 'var_at_end', 'ההודעה לא יכולה להסתיים במשתנה');
    if (/\}\}\s*\{\{/.test(body)) add('body', 'adjacent_vars', 'אסור ששני משתנים יופיעו צמודים');
  }
  if (doc.header.type === 'text' && (doc.header.text || '').length > 60) add('header', 'too_long', 'עד 60 תווים בכותרת');
  if (doc.footer.length > 60) add('footer', 'too_long', 'עד 60 תווים בכותרת התחתונה');
  if (/\{\{/.test(doc.footer)) add('footer', 'vars', 'אין משתנים בכותרת התחתונה');
  doc.buttons.forEach((b, i) => {
    if (!b.text.trim()) add(`buttons[${i}]`, 'required', `לכפתור ${i + 1} חסר טקסט`);
    if (b.text.length > 25) add(`buttons[${i}]`, 'too_long', `כפתור ${i + 1}: עד 25 תווים`);
  });
  return out;
}

/** Latin-safe Meta name from a title (server suggests a unique one too). */
export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_').slice(0, 60);
}
