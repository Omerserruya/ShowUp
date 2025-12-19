import { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';

export interface RSVPStats {
  approved: number;
  declined: number;
  pending: number;
  total: number;
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

export function useOverviewStats() {
  const { selectedEvent } = useEvent();
  const [stats, setStats] = useState<RSVPStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/guests/stats?event_id=${selectedEvent.id}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load stats: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setStats({
          approved: data.confirmed || 0,
          declined: data.declined || 0,
          pending: data.pending || 0,
          total: data.total || 0
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
          total: 0
        });
      });
  }, [selectedEvent?.id]);

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
  onlyWithResponses: boolean = true
) {
  const { selectedEvent } = useEvent();
  const [guests, setGuests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!selectedEvent?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const searchParam = searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : '';
    const orderByParam = orderBy ? `&order_by=${orderBy}` : '';
    const onlyWithResponsesParam = onlyWithResponses ? `&only_with_responses=true` : '';
    
    const url = `/api/guests?event_id=${selectedEvent.id}&page=${page}&page_size=${pageSize}${searchParam}${orderByParam}${onlyWithResponsesParam}`;
    console.log('Fetching guests with URL:', url);
    
    fetchWithAuth(url)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load guests: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        const guestsList = Array.isArray(data) ? data : [];
        setGuests(guestsList);
        // Note: API doesn't return total, so we'll use the length for now
        setTotal(guestsList.length);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load guests:', err);
        setError(err.message || 'Failed to load guests');
        setLoading(false);
        setGuests([]);
        setTotal(0);
      });
  }, [selectedEvent?.id, page, pageSize, searchTerm, orderBy, onlyWithResponses]);

  return { guests, loading, error, total };
}

