import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  InputBase,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  IconButton,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { getPlan } from '../../config/plans';
import { OPS, StatusDot, fmtAge, fmtDate, fmtPct, fmtNum } from './primitives';
import { OpsEventRow, OpsEventsResponse, EventHealth } from './types';

type StatusFilter = 'all' | 'active' | 'paid' | 'pending' | 'finished';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'finished', label: 'Finished' },
];

const HEALTH_META: Record<EventHealth, { color: string; label: string }> = {
  ok: { color: OPS.green, label: 'OK' },
  waiting_payment: { color: OPS.amber, label: 'Awaiting payment' },
  inactive: { color: OPS.grey, label: 'Inactive' },
  no_guests: { color: OPS.amber, label: 'No guests' },
};

const PAGE_SIZE = 15;

const planLabel = (planId: string | null): string => {
  if (!planId) return '—';
  return getPlan(planId)?.title || planId;
};

const th = { color: OPS.textDim, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, textAlign: 'start' as const, py: 1, px: 1.25, whiteSpace: 'nowrap' as const };
const td = { color: OPS.text, fontSize: '0.8rem', py: 1, px: 1.25, borderTop: `1px solid ${OPS.border}`, whiteSpace: 'nowrap' as const };

const EventsTable: React.FC = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OpsEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, st: StatusFilter, pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), page_size: String(PAGE_SIZE) });
      if (q.trim()) params.set('search', q.trim());
      if (st !== 'all') params.set('status', st);
      const res = await fetchWithAuth(`/api/admin/ops/events?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch {
      setData({ total: 0, page: pg, page_size: PAGE_SIZE, items: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search; immediate on status/page change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(search, status, page), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, status, page, load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <Box sx={{ bgcolor: OPS.card, border: `1px solid ${OPS.border}`, borderRadius: 2.5, overflow: 'hidden' }}>
      {/* Controls */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1.5,
          borderBottom: `1px solid ${OPS.border}`,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: OPS.bg,
            border: `1px solid ${OPS.border}`,
            borderRadius: 2,
            px: 1.25,
            py: 0.5,
            minWidth: 220,
          }}
        >
          <SearchRoundedIcon sx={{ color: OPS.textFaint, fontSize: 18 }} />
          <InputBase
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search events, owners, phones…"
            sx={{ color: OPS.text, fontSize: '0.82rem', flex: 1, '& input::placeholder': { color: OPS.textFaint, opacity: 1 } }}
          />
        </Box>

        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_, v) => {
            if (v) {
              setPage(1);
              setStatus(v);
            }
          }}
          sx={{
            flexWrap: 'wrap',
            '& .MuiToggleButton-root': {
              color: OPS.textDim,
              borderColor: OPS.border,
              px: 1.5,
              py: 0.3,
              fontSize: '0.72rem',
              textTransform: 'none',
            },
            '& .Mui-selected': { color: `${OPS.text} !important`, bgcolor: 'rgba(96,165,250,0.18) !important' },
          }}
        >
          {STATUS_FILTERS.map((f) => (
            <ToggleButton key={f.value} value={f.value}>
              {f.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Table */}
      <Box sx={{ overflowX: 'auto', position: 'relative', minHeight: 120 }}>
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(11,14,22,0.4)', zIndex: 2 }}>
            <CircularProgress size={24} sx={{ color: OPS.textDim }} />
          </Box>
        )}
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <Box component="thead">
            <Box component="tr">
              {['Event', 'Owner', 'Venue', 'Plan', 'Guests', 'RSVP', 'Rounds', 'Msgs', 'Last activity', 'Event date', 'Health'].map(
                (h) => (
                  <Box component="th" key={h} sx={th}>
                    {h}
                  </Box>
                )
              )}
            </Box>
          </Box>
          <Box component="tbody">
            {data && data.items.length > 0 ? (
              data.items.map((ev: OpsEventRow) => {
                const hm = HEALTH_META[ev.health] || HEALTH_META.inactive;
                return (
                  <Box component="tr" key={ev.id} sx={{ '&:hover td': { bgcolor: OPS.cardHover } }}>
                    <Box component="td" sx={{ ...td, fontWeight: 700, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ev.name || '—'}
                    </Box>
                    <Box component="td" sx={td}>
                      <Box sx={{ color: OPS.text }}>{ev.owner_name || '—'}</Box>
                      <Box sx={{ color: OPS.textFaint, fontSize: '0.7rem', fontFamily: OPS.mono }}>{ev.owner_phone || ''}</Box>
                    </Box>
                    <Box component="td" sx={{ ...td, color: OPS.textDim }}>{ev.venue_name || '—'}</Box>
                    <Box component="td" sx={td}>{planLabel(ev.plan_id)}</Box>
                    <Box component="td" sx={td}>{fmtNum(ev.guests)}</Box>
                    <Box component="td" sx={td}>{fmtPct(ev.rsvp_rate)}</Box>
                    <Box component="td" sx={td}>{ev.rounds_used}</Box>
                    <Box component="td" sx={td}>{fmtNum(ev.messages_sent)}</Box>
                    <Box component="td" sx={{ ...td, color: OPS.textDim }}>{fmtAge(ev.last_activity)}</Box>
                    <Box component="td" sx={{ ...td, color: OPS.textDim }}>{fmtDate(ev.event_date)}</Box>
                    <Box component="td" sx={td}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <StatusDot color={hm.color} size={8} />
                        <Typography sx={{ color: hm.color, fontSize: '0.72rem', fontWeight: 600 }}>{hm.label}</Typography>
                      </Box>
                    </Box>
                  </Box>
                );
              })
            ) : (
              <Box component="tr">
                <Box component="td" colSpan={11} sx={{ ...td, textAlign: 'center', color: OPS.textFaint, py: 4 }}>
                  {loading ? '' : 'No events match these filters'}
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Pagination */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.25, borderTop: `1px solid ${OPS.border}` }}>
        <Typography sx={{ color: OPS.textFaint, fontSize: '0.75rem' }}>
          {data ? `${data.total.toLocaleString('en-US')} events` : ''}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton
            size="small"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            sx={{ color: OPS.textDim, '&.Mui-disabled': { color: OPS.textFaint, opacity: 0.4 } }}
          >
            <ChevronRightRoundedIcon />
          </IconButton>
          <Typography sx={{ color: OPS.textDim, fontSize: '0.78rem' }}>
            {page} / {totalPages}
          </Typography>
          <IconButton
            size="small"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            sx={{ color: OPS.textDim, '&.Mui-disabled': { color: OPS.textFaint, opacity: 0.4 } }}
          >
            <ChevronLeftRoundedIcon />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

export default EventsTable;
