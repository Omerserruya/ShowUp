/**
 * Frontend messaging module - the ONE place the UI derives templates, variables,
 * stages and event types, all from the backend catalog (`GET /api/catalog`, the
 * shared SSOT). There is no local template seed and no parallel variable/stage
 * maps: every helper here operates on the fetched `MessagingCatalog`.
 *
 * The wizard preview renders template `body` through `renderBody` - the exact
 * copy the worker delivers for that template definition (free-text delivery uses
 * the identical render; approved Meta templates carry the same body as their
 * source copy). One definition, one renderer.
 */
import {
  MessagingCatalog,
  CatalogTemplate,
  renderCatalogBody,
  sampleValues,
  isUsableTemplate,
} from '../hooks/useCatalog';

export type { MessagingCatalog, CatalogTemplate } from '../hooks/useCatalog';
export { useCatalog } from '../hooks/useCatalog';

export const renderBody = renderCatalogBody;

// The brit/brita "secret name" invitation flourish (content, not a definition).
export const BRIT_SECRET_INVITE_LINE = 'השם יישאר בסוד עד הרגע הגדול 🤫';

// ---- variable picker (derived from the catalog) -----------------------------

export interface TemplateVar {
  key: string;   // canonical variable name inserted as {{key}}
  label: string;
}
export interface TemplateVarGroup {
  category: string;
  items: TemplateVar[];
}

/** Variable chips for the custom-message editor, grouped, from the catalog. */
export function variableGroups(catalog: MessagingCatalog, eventType: string): TemplateVarGroup[] {
  const toItem = (name: string): TemplateVar | null => {
    const v = catalog.variables.find((x) => x.name === name);
    return v ? { key: v.name, label: v.label_he } : null;
  };
  const pick = (pred: (name: string) => boolean) =>
    catalog.variables.filter((v) => pred(v.name)).map((v) => ({ key: v.name, label: v.label_he }));

  const guest = pick((n) => {
    const v = catalog.variables.find((x) => x.name === n);
    return v?.scope === 'guest' || n === 'rsvp_link';
  });
  const event = pick((n) => {
    const v = catalog.variables.find((x) => x.name === n);
    return v?.scope === 'event' || n === 'nav_link' || n === 'invitation_link';
  });
  const et = catalog.event_types.find((e) => e.key === eventType);
  const subject = (et?.subject_vars || []).map(toItem).filter(Boolean) as TemplateVar[];

  const groups: TemplateVarGroup[] = [
    { category: '👤 אורח', items: guest },
    { category: '📅 אירוע', items: event },
  ];
  if (subject.length) groups.push({ category: '🎉 מותאם לאירוע', items: subject });
  return groups;
}

// ---- content blocks (canonical tokens) --------------------------------------

export interface ContentBlock {
  key: string;
  emoji: string;
  label: string;
  text: string;
}

export const CONTENT_BLOCKS: ContentBlock[] = [
  { key: 'event_details', emoji: '📅', label: 'פרטי האירוע', text: '📅 {{event_date}} בשעה {{event_time}}' },
  { key: 'location', emoji: '📍', label: 'מיקום', text: '📍 {{venue_name}}' },
  { key: 'rsvp_cta', emoji: '💬', label: 'קריאה לאישור', text: 'נשמח לראותכם! 🎉\nאישור הגעה כאן:\n{{rsvp_link}}' },
  { key: 'nav', emoji: '🧭', label: 'ניווט', text: 'הגעה קלה עם Waze:\n{{nav_link}}' },
];

// ---- template selection (by canonical stage + event type) -------------------

export function templatesForStage(
  catalog: MessagingCatalog,
  stage: string | undefined,
  eventType: string,
): CatalogTemplate[] {
  if (!stage) return [];
  // Only usable (active/approved) templates are offered; drafts are structural
  // placeholders awaiting copy + Meta approval.
  return catalog.templates.filter(
    (t) =>
      isUsableTemplate(t) &&
      t.flow_stage === stage &&
      (t.event_types.length === 0 || t.event_types.includes(eventType)),
  );
}

export function defaultTemplate(list: CatalogTemplate[]): CatalogTemplate | undefined {
  return list.find((t) => t.is_default) || list[0];
}

// ---- location parsing -------------------------------------------------------

/** Event.location may be a plain string OR a structured JSON object
 *  ({name, address, coordinates}). Return clean {name, address} display strings
 *  - never the raw JSON (which must never leak into a message or the UI).
 *  Mirrors the backend `parse_location` in the messaging resolver. */
export function parseLocation(loc?: string | null): { name: string; address: string } {
  if (!loc) return { name: '', address: '' };
  let data: any = loc;
  if (typeof loc === 'string') {
    const s = loc.trim();
    if (!s.startsWith('{')) return { name: s, address: s };
    try { data = JSON.parse(s); } catch { return { name: s, address: s }; }
  }
  if (data && typeof data === 'object') {
    const name = String(data.name || '').trim();
    const address = String(data.address || '').trim();
    return { name: name || address, address: address || name };
  }
  return { name: String(loc), address: String(loc) };
}

// ---- preview variable values (canonical + legacy tokens) --------------------

export interface PreviewCtx {
  eventName?: string;
  eventDate?: string;
  eventTime?: string;
  venue?: string;         // venue_name (the place's name)
  venueAddress?: string;  // venue_address (street address); falls back to venue
  host?: string;
  hostDisplay?: string;   // canonical host_display_name (couple / family / company)
  eventTypeName?: string;
  couple?: string;
  parents?: string;
  bride?: string;
  groom?: string;
  mother?: string;
  father?: string;
  baby?: string;
  celebrant?: string;
  company?: string;
}

/** REAL event details only (no samples), keyed by BOTH the canonical name and
 * its legacy Hebrew tokens. Used to pre-fill the custom-message editor: tokens
 * without a real value ({{guest_name}}, {{rsvp_link}}, subject vars…) are left
 * intact so the saved text still personalizes per guest at send time. */
export function buildEventValues(catalog: MessagingCatalog, ctx: PreviewCtx): Record<string, string> {
  const vals: Record<string, string> = {};
  const set = (canon: string, value?: string) => {
    if (!value) return;
    vals[canon] = value;
    catalog.variables.find((v) => v.name === canon)?.legacy_tokens.forEach((t) => { vals[t] = value; });
  };
  set('event_name', ctx.eventName);
  set('event_date', ctx.eventDate);
  set('event_time', ctx.eventTime);
  set('venue_name', ctx.venue);
  set('venue_address', ctx.venueAddress || ctx.venue);
  set('host_name', ctx.host);
  set('host_display_name', ctx.hostDisplay || ctx.company || ctx.couple || ctx.host);
  set('event_type_name', ctx.eventTypeName);
  set('couple_names', ctx.couple);
  set('parents_names', ctx.parents);
  set('bride_name', ctx.bride);
  set('groom_name', ctx.groom);
  set('mother_name', ctx.mother);
  set('father_name', ctx.father);
  set('baby_name', ctx.baby);
  set('celebrant_name', ctx.celebrant);
  set('company_name', ctx.company);
  return vals;
}

/** Sample values overridden by real event details, keyed by BOTH the canonical
 * name and its legacy Hebrew tokens so any body (new or old) renders. */
export function buildPreviewValues(catalog: MessagingCatalog, ctx: PreviewCtx): Record<string, string> {
  return { ...sampleValues(catalog), ...buildEventValues(catalog, ctx) };
}

// ---- event types (derived from the catalog) ---------------------------------

export function eventTypeLabel(catalog: MessagingCatalog, key: string): string {
  return catalog.event_types.find((e) => e.key === key)?.name_he || 'אירוע';
}

// ---- stage definitions (business objects) -----------------------------------

/** The Stage Definition for a canonical stage id (trigger/audience/flow/variants). */
export function stageById(catalog: MessagingCatalog, stageId: string | undefined) {
  if (!stageId) return undefined;
  return catalog.stages.find((s) => s.id === stageId);
}

/** Recommended variant id for an (event type, stage), with a sensible fallback. */
export function defaultVariantFor(
  catalog: MessagingCatalog,
  eventType: string,
  stageId: string | undefined,
): string | undefined {
  if (!stageId) return undefined;
  const rec = catalog.default_variants?.[eventType]?.[stageId];
  if (rec) return rec;
  const stage = stageById(catalog, stageId);
  return stage?.variants.find((v) => v.is_default)?.id || stage?.variants[0]?.id;
}

// ---- Meta body validation (unchanged rules) ---------------------------------

/** WhatsApp/Meta body rules: not empty, cannot start/end with a variable, no two
 * adjacent variables, must contain real text. Returns human-friendly issues. */
export function validateTemplateBodyMeta(body: string): string[] {
  const issues: string[] = [];
  const VAR_G = /\{\{\s*[^}]+?\s*\}\}/g;
  if (!body.trim()) {
    issues.push('ההודעה ריקה. כתבו את הטקסט לפני שמוסיפים שדות.');
    return issues;
  }
  if (/^\s*\{\{\s*[^}]+?\s*\}\}/.test(body)) {
    issues.push('הודעה לא יכולה להתחיל בשדה אישי. פתחו במילה (למשל "שלום") ואז הוסיפו את השדה.');
  }
  if (/\{\{\s*[^}]+?\s*\}\}\s*$/.test(body)) {
    issues.push('הודעה לא יכולה להסתיים בשדה אישי. הוסיפו טקסט אחרי השדה האחרון.');
  }
  if (/\}\}\s*\{\{/.test(body)) {
    issues.push('אי אפשר לשים שני שדות צמודים. הפרידו ביניהם בטקסט קצר.');
  }
  if (!body.replace(VAR_G, '').replace(/\s+/g, '')) {
    issues.push('ההודעה צריכה לכלול טקסט אמיתי, לא רק שדות אישיים.');
  }
  return issues;
}
