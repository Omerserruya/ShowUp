import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';

export interface Event {
  id: string;
  name: string;
  description?: string;
  date: string; // ISO string
  location: string;
  organizerId: string;
  type?: 'wedding' | 'birthday' | 'corporate' | 'custom';
  imageUrl?: string;
  rsvpDeadline?: string;
  active?: boolean;
  planId?: string | null; // Plan ID from MongoDB
  /** True when this event's access was granted by a partner venue (Venue Edition). */
  isVenue?: boolean;
  /** The partner venue's name (for "Provided by <Venue>"), when isVenue. */
  venueName?: string | null;
  /** Persistent lifecycle state of the event (from backend) */
  state?: 'draft' | 'active' | 'completed' | 'archived' | 'cancelled';
  /** Persistent payment status of the event (from backend) */
  paymentStatus?: 'paid' | 'free' | 'pending' | 'unpaid';
  /** Saved seating map: { tables: [ { id, name, seats, style, side, position, size, ... } ] } */
  seatingLayout?: { tables?: Array<Record<string, unknown>> } | null;
  createdAt: string;
  updatedAt?: string;
}

interface EventContextType {
  selectedEvent: Event | null;
  events: Event[];
  setSelectedEvent: (event: Event | null) => void;
  addEvent: (event: Event) => void;
  updateEvent: (event: Event) => void;
  deleteEvent: (eventId: string) => Promise<void>;
  loading: boolean;
  /** True once the first /api/events fetch has settled (success or failure). */
  eventsLoaded: boolean;
  error: string | null;
  fetchEvents: () => Promise<void>;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

export function EventProvider({ children }: { children: React.ReactNode }) {
  // `selectedEvent` is exposed as null until it's been validated against the
  // fetched events list - we never hand pages an unverified id. The desired
  // selection (from localStorage / manual switch) is tracked separately.
  const [selectedEvent, setSelectedEventState] = useState<Event | null>(null);
  const desiredEventIdRef = useRef<string | null>(localStorage.getItem('selected_event_id'));
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom setter that also records the desired id + persists it.
  const setSelectedEvent = (event: Event | null) => {
    setSelectedEventState(event);
    desiredEventIdRef.current = event ? event.id : null;
    if (event) {
      localStorage.setItem('selected_event_id', event.id);
    } else {
      localStorage.removeItem('selected_event_id');
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  // Resilient reconciliation. Once events have loaded:
  //  • if the desired event exists → select it (full object).
  //  • if it's gone/inaccessible → auto-select the newest event and persist it.
  //  • if there are no events → clear the selection (Layout routes to onboarding).
  // This guarantees pages only ever fetch with a valid id, so a stale
  // localStorage id can never cause repeated 404s.
  useEffect(() => {
    if (!eventsLoaded) return;

    if (events.length === 0) {
      if (selectedEvent !== null) setSelectedEventState(null);
      localStorage.removeItem('selected_event_id');
      return;
    }

    const desired = desiredEventIdRef.current;
    const target =
      (desired ? events.find((e) => e.id === desired) : undefined) ||
      [...events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (target) {
      desiredEventIdRef.current = target.id;
      localStorage.setItem('selected_event_id', target.id);
      setSelectedEventState((prev) => (prev && prev.id === target.id ? prev : target));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, eventsLoaded]);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth('/api/events');
      if (!response.ok) throw new Error('Failed to fetch events');
      const data = await response.json();
      // Map plan_id to planId for frontend compatibility
      const mappedData = data.map((event: any) => ({
        ...event,
        planId: event.planId || event.plan_id || null,
        paymentStatus: event.paymentStatus ?? event.payment_status ?? undefined,
        state: event.state ?? undefined,
        isVenue: event.isVenue ?? event.is_venue ?? undefined,
        venueName: event.venueName ?? event.venue_name ?? null,
      }));
      setEvents(mappedData);
    } catch (err) {
      setError('שגיאה בטעינת האירועים');
      console.error('Error fetching events:', err);
    } finally {
      setLoading(false);
      setEventsLoaded(true);
    }
  };

  const addEvent = async (event: Event) => {
    setLoading(true);
    try {
      const response = await fetchWithAuth('/api/events', {
        method: 'POST',
        body: JSON.stringify(event),
      });
      if (!response.ok) throw new Error('Failed to add event');
      const newEvent = await response.json();
      setEvents(prev => [...prev, newEvent]);
    } catch (err) {
      setError('שגיאה בהוספת אירוע');
      console.error('Error adding event:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateEvent = async (event: Event) => {
    setLoading(true);
    try {
      const response = await fetchWithAuth(`/api/events/${event.id}`, {
        method: 'PUT',
        body: JSON.stringify(event),
      });
      if (!response.ok) throw new Error('Failed to update event');
      setEvents(prev => prev.map(e => e.id === event.id ? event : e));
    } catch (err) {
      setError('שגיאה בעדכון אירוע');
      console.error('Error updating event:', err);
    } finally {
      setLoading(false);
    }
  };

  const deleteEvent = async (eventId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(`/api/events/${eventId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete event');
      setEvents(prev => prev.filter(e => e.id !== eventId));
      if (selectedEvent?.id === eventId) {
        setSelectedEvent(null);
      }
    } catch (err) {
      setError('שגיאה במחיקת אירוע');
      console.error('Error deleting event:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return (
    <EventContext.Provider
      value={{
        selectedEvent,
        events,
        setSelectedEvent,
        addEvent,
        updateEvent,
        deleteEvent,
        loading,
        eventsLoaded,
        error,
        fetchEvents,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEvent() {
  const context = useContext(EventContext);
  if (context === undefined) {
    throw new Error('useEvent must be used within an EventProvider');
  }
  return context;
} 