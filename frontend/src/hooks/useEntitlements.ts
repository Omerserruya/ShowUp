import { useState, useEffect } from 'react';

/**
 * Plan-tier feature entitlements. Mirrors the backend SSOT
 * (shared/domain/entitlements.py) fetched from the public /api/entitlements
 * endpoint. The frontend uses this to hide features a plan does not include;
 * the backend independently enforces the same matrix on every write.
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

interface EntitlementMatrix {
  features: string[];
  plans: Record<string, string[]>;
}

// Module-level cache so the matrix is fetched once per session.
let cache: EntitlementMatrix | null = null;

export function useEntitlements(planId: string | null | undefined) {
  const [matrix, setMatrix] = useState<EntitlementMatrix | null>(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) {
      setMatrix(cache);
      setLoading(false);
      return;
    }
    let active = true;
    fetch('/api/entitlements')
      .then((res) => (res.ok ? res.json() : Promise.reject(res.statusText)))
      .then((data: EntitlementMatrix) => {
        cache = data;
        if (active) {
          setMatrix(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * True if the given plan unlocks the feature. Unknown / null plan ids are
   * treated as fully entitled (legacy bridge — matches backend behavior), so
   * existing pre-tiering events never lose access in the UI.
   */
  const hasFeature = (feature: Feature): boolean => {
    if (!matrix) return true; // optimistic until loaded; backend still enforces
    if (!planId) return true;
    const granted = matrix.plans[planId];
    if (!granted) return true; // unknown plan id => fully entitled
    return granted.includes(feature);
  };

  return { hasFeature, matrix, loading };
}
