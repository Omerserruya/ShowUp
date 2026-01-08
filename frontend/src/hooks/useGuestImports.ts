import { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';

export interface GuestImportContact {
  id: string;
  import_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  validation_errors: string | null;
  created_at: string;
}

export interface GuestImport {
  id: string;
  event_id: string;
  source: string;
  raw_payload: string;
  status: string;
  message_id: string | null;
  created_at: string;
  updated_at: string;
  contacts: GuestImportContact[];
}

export interface GuestImportSummary {
  pending_count: number;
  total_count: number;
}

/**
 * Hook to fetch pending guest imports
 */
export function useGuestImports() {
  const { selectedEvent } = useEvent();
  const [imports, setImports] = useState<GuestImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/guest-imports?status=pending&event_id=${selectedEvent.id}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            localStorage.removeItem('access_token');
            localStorage.removeItem('token');
            throw new Error('Authentication failed. Please log in again.');
          }
          throw new Error(`Failed to load guest imports: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        // API might return array or paginated response
        const importsList = Array.isArray(data) ? data : (data.items || []);
        setImports(importsList);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load guest imports:', err);
        setError(err.message || 'Failed to load guest imports');
        setLoading(false);
        setImports([]);
      });
  }, [selectedEvent?.id]);

  return { imports, loading, error };
}

/**
 * Hook to fetch guest import summary (count of pending imports)
 */
export function useGuestImportSummary() {
  const { selectedEvent } = useEvent();
  const [summary, setSummary] = useState<GuestImportSummary>({ pending_count: 0, total_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/guest-imports/summary?event_id=${selectedEvent.id}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            localStorage.removeItem('access_token');
            localStorage.removeItem('token');
            throw new Error('Authentication failed. Please log in again.');
          }
          throw new Error(`Failed to load guest import summary: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        setSummary(data || { pending_count: 0, total_count: 0 });
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load guest import summary:', err);
        setError(err.message || 'Failed to load guest import summary');
        setLoading(false);
        setSummary({ pending_count: 0, total_count: 0 });
      });
  }, [selectedEvent?.id]);

  return { summary, loading, error };
}

/**
 * Approve an imported guest contact
 */
export async function approveGuestImportContact(contactId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/guest-import-contacts/${contactId}/approve`, {
    method: 'POST',
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('token');
      throw new Error('Authentication failed. Please log in again.');
    }
    const errorData = await response.json().catch(() => ({ detail: 'Failed to approve guest import' }));
    throw new Error(errorData.detail || 'Failed to approve guest import');
  }
}

/**
 * Reject an imported guest contact
 */
export async function rejectGuestImportContact(contactId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/guest-import-contacts/${contactId}/reject`, {
    method: 'POST',
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('token');
      throw new Error('Authentication failed. Please log in again.');
    }
    const errorData = await response.json().catch(() => ({ detail: 'Failed to reject guest import' }));
    throw new Error(errorData.detail || 'Failed to reject guest import');
  }
}

