import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';

export interface VenueSummary {
  id: string;
  name: string | null;
  status?: string;
  event_capacity: number | null;   // monthly allowance (null = unlimited)
  events_used: number;             // used this calendar month
  events_used_total?: number;      // lifetime total
  events_remaining: number | null;
  has_partner_coupon: boolean;
}

// Module-level cache: `/api/venues/mine` is stable for a session (venue
// membership rarely changes), so we fetch it once and share across AppRail,
// Layout and VenueRoute instead of refetching per mount.
let cache: VenueSummary[] | null = null;
let inflight: Promise<VenueSummary[]> | null = null;

async function load(): Promise<VenueSummary[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetchWithAuth('/api/venues/mine')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        cache = Array.isArray(d) ? d : [];
        return cache;
      })
      .catch(() => {
        cache = [];
        return cache;
      });
  }
  return inflight;
}

/** Reset the cache (e.g. on logout). */
export function resetVenueAdminCache() {
  cache = null;
  inflight = null;
}

/**
 * Whether the logged-in user administers any partner venue. Used to gate the
 * /venue area and its nav entry. One cached request per session.
 */
export function useVenueAdmin() {
  const [venues, setVenues] = useState<VenueSummary[] | null>(cache);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let alive = true;
    load().then((v) => {
      if (alive) {
        setVenues(v);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return { venues: venues || [], isVenueAdmin: (venues || []).length > 0, loading };
}
