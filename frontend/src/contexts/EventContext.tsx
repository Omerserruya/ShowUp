import React, { createContext, useContext, useState, useEffect } from 'react';

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
  createdAt: string;
  updatedAt?: string;
}

interface EventContextType {
  selectedEvent: Event | null;
  events: Event[];
  setSelectedEvent: (event: Event | null) => void;
  addEvent: (event: Event) => void;
  updateEvent: (event: Event) => void;
  deleteEvent: (eventId: string) => void;
  loading: boolean;
  error: string | null;
  fetchEvents: () => Promise<void>;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

export function EventProvider({ children }: { children: React.ReactNode }) {
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/events');
      if (!response.ok) throw new Error('Failed to fetch events');
      const data = await response.json();
      setEvents(data);
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
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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

  const deleteEvent = async (eventId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/events/${eventId}`, {
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