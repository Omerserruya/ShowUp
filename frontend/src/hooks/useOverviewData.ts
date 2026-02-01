import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';

export interface RSVPStats {
  approved: number;
  declined: number;
  pending: number;
  total: number; // Sum of import_count (total people invited)
  total_guests: number; // Count of guest records (number of invitations)
}

export interface DailyResponseData {
  date: string;
  dateLabel: string;
  confirmed: number;
  declined: number;
}

export interface Milestone {
  date: string;
  dateLabel: string;
  label: string;
}

export interface DailyResponses {
  data: DailyResponseData[];
  milestones: Milestone[];
}

export function useOverviewStats(refreshKey?: number) {
  const { selectedEvent } = useEvent();
  const [stats, setStats] = useState<RSVPStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventId = selectedEvent?.id;

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/guests/stats?event_id=${eventId}`)
      .then(async res => {
        if (!res.ok) {
          // Handle 401 specifically - might need to refresh token or redirect to login
          if (res.status === 401) {
            const errorData = await res.json().catch(() => ({ detail: 'Unauthorized' }));
            console.error('Authentication error:', errorData);
            // Clear invalid token
            localStorage.removeItem('access_token');
            localStorage.removeItem('token');
            throw new Error('Authentication failed. Please log in again.');
          }
          throw new Error(`Failed to load stats: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setStats({
          approved: data.confirmed || 0,
          declined: data.declined || 0,
          pending: data.pending || 0,
          total: data.total || 0,
          total_guests: data.total_guests || 0
        });
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load stats:', err);
        setError(err.message || 'Failed to load statistics');
        setLoading(false);
        // Set default values on error
        setStats({
          approved: 0,
          declined: 0,
          pending: 0,
          total: 0,
          total_guests: 0
        });
      });
  }, [eventId, refreshKey]);

  return { stats, loading, error };
}

export function useDailyResponses(period: 'week' | 'month' | 'year' = 'week') {
  const { selectedEvent } = useEvent();
  const [data, setData] = useState<DailyResponses | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/guests/daily-responses?event_id=${selectedEvent.id}&period=${period}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load daily responses: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        console.log('Daily responses data:', data); // Debug log
        setData({
          data: data.data || [],
          milestones: data.milestones || []
        });
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load daily responses:', err);
        setError(err.message || 'Failed to load daily responses');
        setLoading(false);
        // Set default values on error
        setData({
          data: [],
          milestones: []
        });
      });
  }, [selectedEvent?.id, period]);

  return { data, loading, error };
}

export function useCampaigns() {
  const { selectedEvent } = useEvent();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/campaigns?event_id=${selectedEvent.id}&order_by=schedule_time&page_size=100`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load campaigns: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setCampaigns(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load campaigns:', err);
        setError(err.message || 'Failed to load campaigns');
        setLoading(false);
        setCampaigns([]);
      });
  }, [selectedEvent?.id]);

  return { campaigns, loading, error };
}

export function useGuests(
  page: number = 1,
  pageSize: number = 10,
  searchTerm: string = '',
  orderBy: 'last_response' | 'created_at' = 'last_response',
  onlyWithResponses: boolean = true,
  statusFilter?: string
) {
  const { selectedEvent } = useEvent();
  const [guests, setGuests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const depsRef = useRef({ page, pageSize, searchTerm, orderBy, onlyWithResponses, statusFilter });
  depsRef.current = { page, pageSize, searchTerm, orderBy, onlyWithResponses, statusFilter };

  const fetchGuests = useCallback(async () => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { page: p, pageSize: ps, searchTerm: st, orderBy: ob, onlyWithResponses: owr, statusFilter: sf } = depsRef.current;
    const cleanSearchTerm = st.replace(/_refresh_\d+$/, '');
    const searchParam = cleanSearchTerm ? `&search=${encodeURIComponent(cleanSearchTerm)}` : '';
    const orderByParam = ob ? `&order_by=${ob}` : '';
    const onlyWithResponsesParam = owr ? `&only_with_responses=true` : '';
    const statusParam = sf && sf !== 'all' ? `&status=${encodeURIComponent(sf)}` : '';
    const returnTotalParam = (sf && sf !== 'all') || ps >= 200 ? `&return_total=true` : '';
    const url = `/api/guests?event_id=${selectedEvent.id}&page=${p}&page_size=${ps}${searchParam}${orderByParam}${onlyWithResponsesParam}${statusParam}${returnTotalParam}`;
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      if (res.status === 401) {
        const errorData = await res.json().catch(() => ({ detail: 'Unauthorized' }));
        console.error('Authentication error:', errorData);
        localStorage.removeItem('access_token');
        localStorage.removeItem('token');
        throw new Error('Authentication failed. Please log in again.');
      }
      throw new Error(`Failed to load guests: ${res.statusText}`);
    }
    const data = await res.json();
    if (data && typeof data === 'object' && 'items' in data && 'total' in data) {
      setGuests(data.items || []);
      setTotal(data.total || 0);
    } else {
      const guestsList = Array.isArray(data) ? data : [];
      setGuests(guestsList);
      setTotal(guestsList.length);
    }
    setLoading(false);
  }, [selectedEvent?.id]);

  useEffect(() => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }
    fetchGuests().catch(err => {
      console.error('Failed to load guests:', err);
      setError(err.message || 'Failed to load guests');
      setLoading(false);
      setGuests([]);
      setTotal(0);
    });
  }, [selectedEvent?.id, page, pageSize, searchTerm, orderBy, onlyWithResponses, statusFilter, fetchGuests]);

  const refetch = useCallback(async () => {
    await fetchGuests();
  }, [fetchGuests]);

  return { guests, loading, error, total, refetch };
}

