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
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchImports = async () => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const url = `/api/guest-imports?status=pending&event_id=${selectedEvent.id}`;
    console.log('Fetching guest imports from:', url);
    
    try {
      const res = await fetchWithAuth(url);
      console.log('Guest imports response status:', res.status, res.statusText);
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('token');
          throw new Error('Authentication failed. Please log in again.');
        }
        // If endpoint doesn't exist (404), return empty array
        if (res.status === 404) {
          console.warn('Guest imports endpoint not found (404) - API may not be implemented yet');
          setImports([]);
          setLoading(false);
          return;
        }
        // Check if response is HTML (404 page)
        const contentType = res.headers.get('content-type');
        console.log('Response content-type:', contentType);
        if (contentType && contentType.includes('text/html')) {
          console.warn('Received HTML response (likely 404 page) - API may not be implemented yet');
          setImports([]);
          setLoading(false);
          return;
        }
        throw new Error(`Failed to load guest imports: ${res.statusText}`);
      }
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // Response is not JSON, likely HTML error page
        console.warn('Response is not JSON - API may not be implemented yet');
        setImports([]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      console.log('Guest imports data received:', data);
      // API might return array or paginated response
      const importsList = Array.isArray(data) ? data : (data.items || []);
      console.log('Processed imports list:', importsList);
      console.log('Total imports:', importsList.length);
      if (importsList.length > 0) {
        console.log('First import contacts:', importsList[0]?.contacts);
      }
      setImports(importsList);
      setLoading(false);
    } catch (err: any) {
      console.error('Failed to load guest imports:', err);
      setError(err.message || 'Failed to load guest imports');
      setLoading(false);
      setImports([]);
    }
  };

  useEffect(() => {
    fetchImports();
  }, [selectedEvent?.id, refreshTrigger]);

  const refresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return { imports, loading, error, refresh };
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
          // If endpoint doesn't exist (404), return default summary
          if (res.status === 404) {
            return { pending_count: 0, total_count: 0 };
          }
          // Check if response is HTML (404 page)
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('text/html')) {
            return { pending_count: 0, total_count: 0 };
          }
          throw new Error(`Failed to load guest import summary: ${res.statusText}`);
        }
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          // Response is not JSON, likely HTML error page
          return { pending_count: 0, total_count: 0 };
        }
        return res.json();
      })
      .then((data) => {
        setSummary(data || { pending_count: 0, total_count: 0 });
        setLoading(false);
      })
      .catch((err) => {
        // Silently handle errors - endpoint may not exist yet
        console.warn('Guest import summary endpoint not available:', err.message);
        setLoading(false);
        setSummary({ pending_count: 0, total_count: 0 });
        // Don't set error state - just return empty summary
      });
  }, [selectedEvent?.id]);

  return { summary, loading, error };
}

/**
 * Approve an imported guest contact
 */
export async function approveGuestImportContact(contactId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/guest-imports/contacts/${contactId}/approve`, {
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
  const response = await fetchWithAuth(`/api/guest-imports/contacts/${contactId}/reject`, {
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

/**
 * Update an imported guest contact
 */
export async function updateGuestImportContact(
  contactId: string,
  data: { name?: string; phone?: string; email?: string }
): Promise<void> {
  const response = await fetchWithAuth(`/api/guest-imports/contacts/${contactId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('token');
      throw new Error('Authentication failed. Please log in again.');
    }
    const errorData = await response.json().catch(() => ({ detail: 'Failed to update guest import' }));
    throw new Error(errorData.detail || 'Failed to update guest import');
  }
}

/**
 * Approve an imported guest contact with optional fields
 */
export async function approveGuestImportContactWithData(
  contactId: string,
  data?: { name?: string; group?: string; import_count?: number; table_number?: number }
): Promise<void> {
  const response = await fetchWithAuth(`/api/guest-imports/contacts/${contactId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data || {}),
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
