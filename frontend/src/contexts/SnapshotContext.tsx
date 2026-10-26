import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useEvent } from './EventContext';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { buildSnapshot, Snapshot, ApiGuest, ApiCampaign } from '../adapters/eventSnapshot';

interface SnapshotState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const Ctx = createContext<SnapshotState>({ snapshot: null, loading: false, error: null, refresh: () => {} });

const json = async (url: string) => {
  const r = await fetchWithAuth(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

/**
 * Loads the selected event's guests, campaigns and pending WhatsApp imports
 * once, and exposes the derived Snapshot (adapters/eventSnapshot.ts) to the
 * sidebar and the v6 pages. Refreshes when the event changes, on `refresh()`,
 * and every 60s while the tab is visible so new RSVPs show up.
 */
export function SnapshotProvider({ children }: { children: React.ReactNode }) {
  const { selectedEvent } = useEvent();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') setTick((t) => t + 1); }, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedEvent?.id) { setSnapshot(null); return; }
    let cancelled = false;
    const eid = selectedEvent.id;
    // Show the spinner only on the first load for this event, not on polls.
    setLoading((prev) => prev || !snapshot || snapshot.event.id !== eid);
    Promise.all([
      json(`/api/guests?event_id=${eid}&page=1&page_size=2000`),
      json(`/api/campaigns?event_id=${eid}&order_by=schedule_time&page_size=100`).catch(() => []),
      json(`/api/guest-imports/summary?event_id=${eid}`).catch(() => ({ pending_count: 0 })),
    ])
      .then(([g, c, imp]) => {
        if (cancelled) return;
        const guests: ApiGuest[] = Array.isArray(g) ? g : (g?.items || []);
        const campaigns: ApiCampaign[] = Array.isArray(c) ? c : (c?.items || []);
        setSnapshot(buildSnapshot(selectedEvent, guests, campaigns, Number(imp?.pending_count) || 0));
        setError(null);
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent, tick]);

  const value = useMemo(() => ({ snapshot, loading, error, refresh }), [snapshot, loading, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSnapshot = () => useContext(Ctx);
