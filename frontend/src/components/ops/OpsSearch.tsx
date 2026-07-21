import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, InputBase, Typography, CircularProgress, ClickAwayListener } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { getPlan } from '../../config/plans';
import { OPS } from './primitives';
import { OpsSearchResults } from './types';

const EMPTY: OpsSearchResults = { events: [], owners: [], guests: [], payments: [], campaigns: [] };

const planLabel = (planId: string | null): string => (planId ? getPlan(planId)?.title || planId : '—');

const Group: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => {
  if (count === 0) return null;
  return (
    <Box sx={{ py: 0.5 }}>
      <Typography sx={{ color: OPS.textFaint, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', px: 1.5, pt: 1, pb: 0.5 }}>
        {title} · {count}
      </Typography>
      {children}
    </Box>
  );
};

const ResultRow: React.FC<{ primary: string; secondary?: string; tag?: string }> = ({ primary, secondary, tag }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, '&:hover': { bgcolor: OPS.cardHover } }}>
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography sx={{ color: OPS.text, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {primary}
      </Typography>
      {secondary && (
        <Typography sx={{ color: OPS.textFaint, fontSize: '0.7rem', fontFamily: OPS.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {secondary}
        </Typography>
      )}
    </Box>
    {tag && (
      <Typography sx={{ color: OPS.textDim, fontSize: '0.68rem', flexShrink: 0, bgcolor: 'rgba(255,255,255,0.05)', px: 0.75, py: 0.15, borderRadius: 1 }}>
        {tag}
      </Typography>
    )}
  </Box>
);

const OpsSearch: React.FC = () => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<OpsSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/ops/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults({ ...EMPTY, ...data });
    } catch {
      setResults(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => run(trimmed), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, run]);

  const total = results
    ? results.events.length + results.owners.length + results.guests.length + results.payments.length + results.campaigns.length
    : 0;

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box sx={{ position: 'relative', width: { xs: '100%', sm: 340 } }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: OPS.panel,
            border: `1px solid ${OPS.border}`,
            borderRadius: 2,
            px: 1.5,
            py: 0.75,
          }}
        >
          <SearchRoundedIcon sx={{ color: OPS.textFaint, fontSize: 19 }} />
          <InputBase
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search everything…"
            sx={{ color: OPS.text, fontSize: '0.85rem', flex: 1, '& input::placeholder': { color: OPS.textFaint, opacity: 1 } }}
          />
          {loading && <CircularProgress size={15} sx={{ color: OPS.textFaint }} />}
        </Box>

        {open && q.trim().length >= 2 && (
          <Box
            sx={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              zIndex: 30,
              bgcolor: OPS.card,
              border: `1px solid ${OPS.borderStrong}`,
              borderRadius: 2,
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              maxHeight: 460,
              overflowY: 'auto',
            }}
          >
            {loading && total === 0 ? (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <CircularProgress size={20} sx={{ color: OPS.textDim }} />
              </Box>
            ) : total === 0 ? (
              <Typography sx={{ color: OPS.textFaint, fontSize: '0.82rem', p: 2, textAlign: 'center' }}>
                No matches
              </Typography>
            ) : (
              results && (
                <>
                  <Group title="Events" count={results.events.length}>
                    {results.events.map((e) => (
                      <ResultRow key={`e${e.id}`} primary={e.name} secondary={e.event_date || undefined} tag={planLabel(e.plan_id)} />
                    ))}
                  </Group>
                  <Group title="Owners" count={results.owners.length}>
                    {results.owners.map((o) => (
                      <ResultRow key={`o${o.id}`} primary={o.name || o.phone || o.email || `#${o.id}`} secondary={[o.phone, o.email].filter(Boolean).join(' · ') || undefined} />
                    ))}
                  </Group>
                  <Group title="Guests" count={results.guests.length}>
                    {results.guests.map((g) => (
                      <ResultRow key={`g${g.id}`} primary={g.name || g.phone || `#${g.id}`} secondary={[g.phone, g.email].filter(Boolean).join(' · ') || undefined} tag={g.status || undefined} />
                    ))}
                  </Group>
                  <Group title="Payments" count={results.payments.length}>
                    {results.payments.map((p) => (
                      <ResultRow key={`p${p.id}`} primary={p.event_name || `#${p.id}`} secondary={[p.phone, p.date].filter(Boolean).join(' · ') || undefined} tag={p.status || undefined} />
                    ))}
                  </Group>
                  <Group title="Campaigns" count={results.campaigns.length}>
                    {results.campaigns.map((c) => (
                      <ResultRow key={`c${c.id}`} primary={c.name || `#${c.id}`} secondary={`${c.recipient_count} recipients`} tag={c.status || undefined} />
                    ))}
                  </Group>
                </>
              )
            )}
          </Box>
        )}
      </Box>
    </ClickAwayListener>
  );
};

export default OpsSearch;
