import React, { createContext, useContext, useState, useEffect } from 'react';
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
  error: string | null;
  fetchEvents: () => Promise<void>;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

export function EventProvider({ children }: { children: React.ReactNode }) {
  // Load selected event from localStorage on mount
  const [selectedEvent, setSelectedEventState] = useState<Event | null>(() => {
    const saved = localStorage.getItem('selected_event_id');
    return saved ? ({ id: saved } as Event) : null;
  });
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom setter that also saves to localStorage
  const setSelectedEvent = (event: Event | null) => {
    setSelectedEventState(event);
    if (event) {
      localStorage.setItem('selected_event_id', event.id);
    } else {
      localStorage.removeItem('selected_event_id');
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  // When events are loaded, try to restore selected event
  useEffect(() => {
    if (events.length > 0 && selectedEvent?.id) {
      const foundEvent = events.find(e => e.id === selectedEvent.id);
      if (foundEvent) {
        setSelectedEventState(foundEvent);
      } else {
        // Selected event not found, clear it
        setSelectedEventState(null);
        localStorage.removeItem('selected_event_id');
      }
    } else if (events.length > 0 && !selectedEvent) {
      // If no event is selected but we have events, try to restore from localStorage
      const savedEventId = localStorage.getItem('selected_event_id');
      if (savedEventId) {
        const foundEvent = events.find(e => e.id === savedEventId);
        if (foundEvent) {
          setSelectedEventState(foundEvent);
          return;
        } else {
          localStorage.removeItem('selected_event_id');
        }
      }

      // No saved event or saved one not found – auto-select the newest event (by createdAt)
      const latestEvent = [...events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];
      if (latestEvent) {
        // Use full setter so it also updates localStorage
        setSelectedEvent(latestEvent);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth('/api/events');
      if (!response.ok) throw new Error('Failed to fetch events');
      const data = await response.json();
      // Map plan_id to planId for frontend compatibility
      const mappedData = data.map((event: any) => ({
        ...event,
        planId: event.planId || event.plan_id || null,
      }));
      setEvents(mappedData);
    } catch (err) {
      setError('שגיאה בטעינת האירועים');
      console.error('Error fetching events:', err);
    } finally {
      setLoading(false);
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