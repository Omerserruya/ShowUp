/**
 * Messaging catalog client - the frontend's single source for template
 * definitions, pulled from the backend SSOT (`GET /api/catalog`, backed by
 * `shared/domain/messaging`). The wizard preview renders from THESE definitions,
 * which are the exact ones the worker delivers - no parallel frontend catalog.
 *
 * Mirrors the `useEntitlements`/`useTemplates` pattern: one cached fetch per
 * session, graceful when the API is unavailable.
 */
import { useEffect, useState } from 'react';

export interface CatalogPreview {
  emoji: string;
  accent: string;
  header: 'none' | 'image';
  length_hint: 'short' | 'medium' | 'long';
  note: string;
}

export interface CatalogTemplate {
  id: string;                 // canonical catalog key - stored on the campaign
  title: string;              // placeholder until copy is populated
  body: string;               // placeholder; copy used for preview + free_text
  description: string;
  flow_stage: string;         // canonical FlowStage
  category: string;           // TemplateCategory
  tone: string;               // Tone
  cta_type: string;           // CtaType
  channel: string;
  language: string;           // data-driven language (he/en/…)
  event_types: string[];      // empty = all
  visibility: string;
  lifecycle: string;          // 'active'/'approved' = usable; 'draft' = placeholder
  is_default: boolean;
  premium: boolean;
  priority: number;
  delivery: 'meta_template' | 'free_text';
  // True only if the template can actually be delivered right now: a usable
  // lifecycle AND (for meta_template delivery) a real approved Meta mapping.
  // Gate selection on this, NOT on lifecycle alone.
  sendable: boolean;
  variables: string[];        // canonical variable names the copy will use
  preview: CatalogPreview;
  meta_template: string | null;
  version: number;
  metadata: Record<string, unknown>;
}

/** Templates offered in the wizard: any active/approved template. Actual
 *  deliverability is enforced server-side per event (the backend resolves the
 *  event-type-specific approved variant, e.g. `<key>__wedding`), because whether
 *  a base template can be delivered depends on the event's type - which this
 *  global catalog payload doesn't know. `sendable` is a global hint only. */
export function isUsableTemplate(t: CatalogTemplate): boolean {
  return t.lifecycle === 'active' || t.lifecycle === 'approved';
}

export interface CatalogEventType {
  key: string;
  name_he: string;
  name_en: string;
  emoji: string;
  schedule_key: string;
  subject_vars: string[];
}

export interface CatalogVariable {
  name: string;
  scope: string;
  label_he: string;
  sample: string;
  send_available: boolean;
  legacy_tokens: string[];
}

export interface CatalogChannelImpl {
  channel: string;
  template_key: string;
}

export interface CatalogVariant {
  id: string;
  name: string;
  description: string;
  tone: string;
  event_types: string[];
  is_default: boolean;
  premium: boolean;
  lifecycle: string;
  channels: CatalogChannelImpl[];
}

/** A Stage Definition - the business object (Event Type → Stage → Variant → Campaign). */
export interface CatalogStage {
  id: string;
  title: string;
  description: string;
  event_types: string[];
  trigger: string;
  audience_rule: string;
  completion_rule: string;
  flow_steps: string[];
  next_stages: string[];
  variants: CatalogVariant[];
}

export interface MessagingCatalog {
  schema_version?: number;
  catalog_version?: number;
  stages: CatalogStage[];
  /** Recommended variant per event_type → stage (a recommendation, not a limit). */
  default_variants: Record<string, Record<string, string>>;
  /** Which stages are recommended per event_type: 'true' | 'optional' | 'false'.
   *  The wizard's default enable-state - a recommendation, not a restriction. */
  availability: Record<string, Record<string, 'true' | 'optional' | 'false'>>;
  triggers: string[];
  audience_rules: string[];
  completion_rules: string[];
  templates: CatalogTemplate[];
  flow_stages: string[];
  categories: string[];
  tones: string[];
  cta_types: string[];
  event_types: CatalogEventType[];
  variables: CatalogVariable[];
}

const EMPTY: MessagingCatalog = {
  stages: [], default_variants: {}, availability: {}, triggers: [], audience_rules: [], completion_rules: [],
  templates: [], flow_stages: [], categories: [], tones: [], cta_types: [], event_types: [], variables: [],
};

let cache: MessagingCatalog | null = null;
let inflight: Promise<MessagingCatalog> | null = null;

async function load(): Promise<MessagingCatalog> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((d: MessagingCatalog) => {
        cache = d && Array.isArray(d.templates) ? d : EMPTY;
        return cache;
      })
      .catch(() => {
        cache = EMPTY;
        return cache;
      });
  }
  return inflight;
}

/** Resolve the sample values map used to render a preview (canonical + legacy tokens). */
export function sampleValues(catalog: MessagingCatalog): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of catalog.variables) {
    out[v.name] = v.sample;
    for (const tok of v.legacy_tokens) out[tok] = v.sample;
  }
  return out;
}

/** Fill a template body's {{token}} placeholders (canonical or legacy Hebrew). */
export function renderCatalogBody(body: string, values: Record<string, string>): string {
  return (body || '').replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (m, key) =>
    key in values ? values[key] : m,
  );
}

/** The messaging catalog (one cached fetch). Preview + selection consume this. */
export function useCatalog() {
  const [catalog, setCatalog] = useState<MessagingCatalog | null>(cache);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let alive = true;
    load().then((c) => {
      if (alive) {
        setCatalog(c);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return { catalog: catalog || EMPTY, loading };
}
