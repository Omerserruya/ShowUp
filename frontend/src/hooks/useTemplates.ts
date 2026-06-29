import { useEffect, useState } from 'react';
import {
  MessageTemplate,
  templates as LOCAL_TEMPLATES,
  STAGE_BY_LABEL,
  TemplateFlowStage,
} from '../config/templates';

/**
 * useTemplates
 * ------------
 * The wizard no longer hardcodes which templates to show. It asks the backend for
 * the available templates (public, plus any private ones scoped to the event) and
 * filters them by metadata via `selectTemplates`. New PUBLIC templates added on the
 * backend therefore appear automatically — no frontend change needed.
 *
 * Until the backend template service is live (or if the request fails), this hook
 * gracefully falls back to the built-in local seed so the wizard always works.
 */

// Shape of a template row as returned by core-service (WaTemplate + metadata).
interface BackendTemplate {
  id: string;
  name?: string;
  title?: string;
  body: string;
  language?: string;
  campaign_label?: string;
  flow_stage?: TemplateFlowStage;
  category?: string;
  event_types?: string[];
  event_type?: string | null;
  visibility?: 'public' | 'private';
  status?: 'active' | 'archived';
  lifecycle?: string; // approval status
  event_id?: string | null;
  expires_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  is_default?: boolean;
  components?: { is_default?: boolean; buttons?: Array<{ id: string; text: string; type?: 'url' | 'quick_reply' }> } | null;
}

const LABEL_BY_STAGE: Record<string, string> = Object.entries(STAGE_BY_LABEL).reduce(
  (acc, [label, stage]) => ({ ...acc, [stage]: label }),
  {} as Record<string, string>
);

function mapBackendTemplate(row: BackendTemplate): MessageTemplate {
  const flowStage = (row.flow_stage || (row.category as TemplateFlowStage | undefined)) as TemplateFlowStage | undefined;
  const campaignLabel = row.campaign_label || (flowStage ? LABEL_BY_STAGE[flowStage] : '') || '';
  const eventTypes = row.event_types || (row.event_type ? [row.event_type] : []);
  return {
    id: row.id,
    campaignLabel,
    name: row.name || row.title || 'תבנית',
    title: row.title || '',
    body: row.body,
    isDefault: Boolean(row.is_default ?? row.components?.is_default),
    flowStage,
    eventTypes,
    visibility: row.visibility || (row.event_id ? 'private' : 'public'),
    language: row.language || 'he',
    status: row.status || 'active',
    approvalStatus: (row.lifecycle as MessageTemplate['approvalStatus']) || 'approved',
    eventId: row.event_id ?? null,
    expiresAt: row.expires_at ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    buttons: row.components?.buttons,
  };
}

export interface UseTemplatesOptions {
  eventId?: string | null;
}

export function useTemplates(opts: UseTemplatesOptions = {}): { pool: MessageTemplate[]; loading: boolean } {
  const { eventId } = opts;
  const [pool, setPool] = useState<MessageTemplate[]>(LOCAL_TEMPLATES);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = eventId ? `?event_id=${encodeURIComponent(eventId)}` : '';
    fetch(`/api/templates/public${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('templates unavailable'))))
      .then((rows: BackendTemplate[]) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        // Backend is the source of truth when it has templates; the local seed is
        // pure fallback (used only when the request fails or returns nothing).
        setPool(rows.map(mapBackendTemplate));
      })
      .catch(() => {
        // Backend not available yet — keep the local seed. Recovery is silent.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return { pool, loading };
}
