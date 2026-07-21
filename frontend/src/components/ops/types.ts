// Shared types for the internal Operations console (admin-only).
// Mirror the shapes returned by /api/admin/ops/*.

export type ServiceStatus = 'healthy' | 'warning' | 'offline';
export type InfraStatus = 'healthy' | 'offline' | 'unknown';
export type EventHealth = 'ok' | 'waiting_payment' | 'inactive' | 'no_guests';
export type AlertLevel = 'critical' | 'warning';

export interface OpsOverview {
  active_events: number;
  events_today: number;
  waiting_payment: number;
  paid_events: number;
  upcoming_7d: number;
  finished_events: number;
  total_guests: number;
  guests_imported_today: number;
  rsvp_rate: number;
  rsvp_rate_of_all: number;
  messages_sent_today: number;
  messages_failed_today: number;
  daily_active_users: number;
}

export interface OpsService {
  service: string;
  label: string;
  status: ServiceStatus;
  last_beat: string | null;
  last_restart: string | null;
  version: string | null;
  heartbeat_age_seconds: number | null;
}

export interface OpsInfra {
  service: string;
  label: string;
  status: InfraStatus;
}

export interface OpsHealth {
  services: OpsService[];
  infra: OpsInfra[];
  queue_backlog: {
    total: number;
    stuck_messages: number;
    pending_notifications: number;
    due_campaign_batches: number;
  };
}

export interface OpsPayments {
  pending: number;
  completed: number;
  completed_today: number;
  failed: number;
  expired: number;
  refunds: number | null;
}

export interface OpsWhatsApp {
  sent: number;
  delivered: number;
  failed: number;
  meta_errors: number;
  template_errors: number;
  opt_outs: number;
  opt_outs_today: number;
  quality_rating: string | null;
}

export interface OpsAssistant {
  conversations: number;
  questions_today: number;
  actions_executed: number;
  actions_today: number;
  failed_actions: number;
  avg_response_ms: number | null;
}

export interface OpsSystem {
  host: {
    available: boolean;
    cpu_percent: number;
    mem_percent: number;
    mem_used_mb: number;
    mem_total_mb: number;
    disk_percent: number;
    disk_used_gb: number;
    disk_total_gb: number;
  };
  api_latency: {
    count: number;
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    rpm: number;
  };
  avg_campaign_send_ms: number | null;
  avg_assistant_response_ms: number | null;
}

export interface OpsAlert {
  level: AlertLevel;
  key: string;
  title: string;
  detail: string;
  count: number;
}

export interface OpsSummary {
  overview: OpsOverview;
  health: OpsHealth;
  payments: OpsPayments;
  whatsapp: OpsWhatsApp;
  assistant: OpsAssistant;
  system: OpsSystem;
  alerts: OpsAlert[];
  generated_at: string;
}

export interface TimeseriesPoint {
  ts: string;
  sent: number;
  delivered: number;
  failed: number;
}

export interface TimeseriesResponse {
  range: string;
  points: TimeseriesPoint[];
}

export interface OpsEventRow {
  id: number | string;
  name: string;
  owner_name: string | null;
  owner_phone: string | null;
  venue_name: string | null;
  plan_id: string | null;
  payment_status: string | null;
  active: boolean;
  state: string | null;
  guests: number;
  rsvp_rate: number;
  rounds_used: number;
  messages_sent: number;
  last_activity: string | null;
  event_date: string | null;
  health: EventHealth;
}

export interface OpsEventsResponse {
  total: number;
  page: number;
  page_size: number;
  items: OpsEventRow[];
}

export interface OpsErrorRow {
  id: number | string;
  time: string;
  service: string;
  severity: string;
  error: string;
  error_type: string | null;
  event_id: number | string | null;
  user_id: number | string | null;
  stack: string | null;
  context: unknown;
  resolved: boolean;
  resolved_at: string | null;
}

export interface OpsErrorsResponse {
  total: number;
  items: OpsErrorRow[];
}

export interface OpsSearchResults {
  events: Array<{ id: number | string; name: string; plan_id: string | null; payment_status: string | null; event_date: string | null }>;
  owners: Array<{ id: number | string; name: string | null; phone: string | null; email: string | null }>;
  guests: Array<{ id: number | string; event_id: number | string; name: string | null; phone: string | null; email: string | null; status: string | null }>;
  payments: Array<{ id: number | string; event_name: string | null; plan: string | null; status: string | null; phone: string | null; date: string | null }>;
  campaigns: Array<{ id: number | string; event_id: number | string; name: string | null; status: string | null; recipient_count: number }>;
}
