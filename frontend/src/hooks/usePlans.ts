import { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';

export interface CampaignSchedule {
  enabled: boolean;
  label: string;
  offsetDays: number;
  time: string;
}

export interface Plan {
  id: string;
  title: string;
  subtitle: string;
  price: string;
  description: string;
  features: string[];
  color: string;
  isPopular: boolean;
  campaigns: CampaignSchedule[];
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // Use public endpoint (no auth required)
    fetch('/api/plans')
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load plans: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setPlans(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load plans:', err);
        setError(err.message || 'Failed to load plans');
        setLoading(false);
        setPlans([]);
      });
  }, []);

  return { plans, loading, error };
}

export function usePlan(planId: string | null) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/plans/${planId}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load plan: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setPlan(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load plan:', err);
        setError(err.message || 'Failed to load plan');
        setLoading(false);
        setPlan(null);
      });
  }, [planId]);

  return { plan, loading, error };
}

export function usePlanCampaigns(planId: string | null) {
  const [campaigns, setCampaigns] = useState<CampaignSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/plans/${planId}/campaigns`)
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
  }, [planId]);

  return { campaigns, loading, error };
}
