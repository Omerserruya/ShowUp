import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useUser } from './UserContext';
import { useEvent } from './EventContext';

/**
 * Admin support sessions: a platform admin stepping into one live event to see
 * it exactly as its owner does and help them.
 *
 * The session lives on the server (core-service `admin_support_sessions`), so
 * it survives a reload and is what actually grants access - this context only
 * mirrors it, keeps the event switcher pointed at the supported event, and
 * makes sure the shell can never look like an ordinary session by mistake.
 */
export interface SupportSession {
  event_id: string;
  event_name: string | null;
  owner_name: string | null;
  started_at: string | null;
  expires_at: string | null;
}

interface SupportContextType {
  session: SupportSession | null;
  loading: boolean;
  /** Open a support session on an event and switch the app into it. */
  enterEvent: (eventId: string) => Promise<SupportSession | null>;
  /** Close the session and drop back to the admin's own events. */
  exitSupport: () => Promise<void>;
}

const SupportContext = createContext<SupportContextType | undefined>(undefined);

export function SupportProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useUser();
  const { fetchEvents, selectEventById, setSelectedEvent } = useEvent();
  const [session, setSession] = useState<SupportSession | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setSession(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/support/session');
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setSession(data.session ?? null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enterEvent = useCallback(
    async (eventId: string): Promise<SupportSession | null> => {
      const res = await fetchWithAuth('/api/admin/support/enter', {
        method: 'POST',
        body: JSON.stringify({ event_id: eventId }),
      });
      if (!res.ok) throw new Error('failed to enter event');
      const data = await res.json();
      setSession(data.session ?? null);
      // Point the switcher at the supported event BEFORE refetching, so the
      // list's reconciliation resolves it instead of falling back to the
      // admin's newest own event.
      selectEventById(eventId);
      await fetchEvents();
      return data.session ?? null;
    },
    [fetchEvents, selectEventById],
  );

  const exitSupport = useCallback(async () => {
    try {
      await fetchWithAuth('/api/admin/support/exit', { method: 'POST' });
    } finally {
      setSession(null);
      // The event is no longer readable, so clear the selection before
      // refetching - otherwise the switcher keeps asking for a 404.
      setSelectedEvent(null);
      await fetchEvents();
    }
  }, [fetchEvents, setSelectedEvent]);

  return (
    <SupportContext.Provider value={{ session, loading, enterEvent, exitSupport }}>
      {children}
    </SupportContext.Provider>
  );
}

export function useSupport() {
  const context = useContext(SupportContext);
  if (context === undefined) {
    throw new Error('useSupport must be used within a SupportProvider');
  }
  return context;
}
