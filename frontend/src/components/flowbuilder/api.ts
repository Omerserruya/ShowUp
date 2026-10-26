/**
 * Thin client for /api/admin/flow-graph/*. Every call resolves to a typed value
 * or throws a FlowApiError with a calm Hebrew message; `unavailable` marks the
 * case where the endpoint is not deployed yet (404/405/5xx gateway errors).
 */
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import type {
  FlowGraph, FlowMeta, GraphIssue, ScopeGraph, ScopeRow, SimInput, SimResult, VersionRow,
} from './types';

const BASE = '/api/admin/flow-graph';

export class FlowApiError extends Error {
  status: number;
  unavailable: boolean;
  issues: GraphIssue[];
  constructor(message: string, status: number, issues: GraphIssue[] = []) {
    super(message);
    this.status = status;
    this.unavailable = status === 404 || status === 405 || status === 501 || status === 502 || status === 503 || status === 504 || status === 0;
    this.issues = issues;
  }
}

/** Pull `{errors:[…]}` from either the body or FastAPI's `detail` wrapper. */
function extractIssues(data: any): GraphIssue[] {
  const src = data?.errors ?? data?.detail?.errors;
  if (Array.isArray(src)) {
    return src.map((e: any) => ({
      path: e?.path, node_id: e?.node_id, edge_id: e?.edge_id, message: String(e?.message ?? e?.msg ?? 'שגיאה'),
    }));
  }
  // Plain pydantic validation error: detail: [{loc, msg}]
  if (Array.isArray(data?.detail)) {
    return data.detail.map((e: any) => ({
      path: Array.isArray(e?.loc) ? e.loc.filter((p: any) => p !== 'body').join('.') : undefined,
      message: String(e?.msg ?? 'שגיאה'),
    }));
  }
  return [];
}

function messageFor(status: number, data: any): string {
  if (typeof data?.detail === 'string') return data.detail;
  if (typeof data?.message === 'string') return data.message;
  if (status === 401 || status === 403) return 'אין הרשאה. יש להתחבר מחדש כמנהל מערכת.';
  if (status === 404 || status === 405) return 'בונה השיחה עדיין לא זמין בשרת.';
  if (status === 409) return 'מישהו אחר שמר גרסה חדשה בינתיים. יש לטעון מחדש לפני שמירה.';
  if (status >= 500) return 'השרת לא זמין כרגע. כדאי לנסות שוב בעוד רגע.';
  return 'הפעולה נכשלה';
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithAuth(`${BASE}${path}`, init);
  } catch {
    throw new FlowApiError('אין חיבור לשרת כרגע.', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new FlowApiError(messageFor(res.status, data), res.status, extractIssues(data));
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const seg = (scope: string, key: string) => `/${encodeURIComponent(scope)}/${encodeURIComponent(key)}`;

export const flowApi = {
  listScopes: async (): Promise<ScopeRow[]> => {
    const data = await call<{ scopes?: ScopeRow[] } | ScopeRow[]>('');
    return Array.isArray(data) ? data : data?.scopes || [];
  },
  meta: () => call<FlowMeta>('/meta'),
  get: (scope: string, key: string) => call<ScopeGraph>(seg(scope, key)),
  save: (scope: string, key: string, graph: FlowGraph, note: string | null, expectedVersion: number | null) =>
    call<{ version: number }>(seg(scope, key), json('PUT', { graph, note, expected_version: expectedVersion })),
  setEnabled: (scope: string, key: string, enabled: boolean) =>
    call<unknown>(`${seg(scope, key)}/enable`, json('POST', { enabled })),
  versions: async (scope: string, key: string): Promise<VersionRow[]> => {
    const data = await call<VersionRow[] | { versions?: VersionRow[] }>(`${seg(scope, key)}/versions`);
    return Array.isArray(data) ? data : data?.versions || [];
  },
  revert: (scope: string, key: string, version: number) =>
    call<unknown>(`${seg(scope, key)}/revert/${version}`, { method: 'POST' }),
  validate: (graph: FlowGraph) =>
    call<{ errors?: GraphIssue[]; warnings?: GraphIssue[] }>('/validate', json('POST', { graph })),
  simulate: (graph: FlowGraph, eventType: string, inputs: SimInput[]) =>
    call<SimResult>('/simulate', json('POST', { graph, event_type: eventType, inputs })),
};

export const errMsg = (e: unknown, fallback = 'הפעולה נכשלה'): string =>
  e instanceof FlowApiError ? e.message : (e as any)?.message || fallback;
