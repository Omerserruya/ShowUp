/**
 * Plan-tier feature entitlements (frontend mirror).
 *
 * This is a static mirror of the backend single-source-of-truth in
 * `shared/domain/entitlements.py`. The frontend uses it to hide features a plan
 * does not include; the backend independently enforces the same matrix on every
 * write, so this is purely a UX gate (safe to keep client-side).
 *
 * Keep this in sync with `shared/domain/entitlements.py`.
 */

export type Feature =
  | 'dashboard'
  | 'csv_export'
  | 'web_invitation'
  | 'invitation_customization'
  | 'whatsapp_campaigns'
  | 'templates'
  | 'advanced_scheduling'
  | 'tags'
  | 'custom_fields'
  | 'seating'
  | 'team_members'
  | 'ai_assistant';

const ALL_FEATURES: Feature[] = [
  'dashboard',
  'csv_export',
  'web_invitation',
  'invitation_customization',
  'whatsapp_campaigns',
  'templates',
  'advanced_scheduling',
  'tags',
  'custom_fields',
  'seating',
  'team_members',
  'ai_assistant',
];

// Explicit grants per plan. Anything not listed is denied (default-deny).
export const entitlementMatrix: Record<string, Feature[]> = {
  free: ['dashboard', 'csv_export', 'web_invitation'],
  basic: [
    'dashboard',
    'csv_export',
    'web_invitation',
    'invitation_customization',
    'whatsapp_campaigns',
    'templates',
  ],
  plus: [
    'dashboard',
    'csv_export',
    'web_invitation',
    'invitation_customization',
    'whatsapp_campaigns',
    'templates',
    'advanced_scheduling',
    'tags',
    'custom_fields',
    'seating',
    'team_members',
  ],
  pro: ALL_FEATURES,
};

/**
 * True if the given plan unlocks the feature.
 *
 * Null / unknown plan ids are treated as fully entitled (legacy bridge - mirrors
 * the backend), so existing pre-tiering events never lose access in the UI.
 */
export const hasFeature = (planId: string | null | undefined, feature: Feature): boolean => {
  if (!planId) return true;
  const granted = entitlementMatrix[String(planId).trim().toLowerCase()];
  if (!granted) return true; // unknown plan id => fully entitled
  return granted.includes(feature);
};
