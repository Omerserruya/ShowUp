import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  Button,
  Collapse,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { OPS, fmtDateTime } from './primitives';
import { OpsErrorRow, OpsErrorsResponse } from './types';

const severityColor = (sev: string): string => {
  const s = (sev || '').toLowerCase();
  if (s === 'critical' || s === 'error' || s === 'fatal') return OPS.red;
  if (s === 'warning' || s === 'warn') return OPS.amber;
  return OPS.grey;
};

const ErrorRow: React.FC<{ row: OpsErrorRow; onResolve: (id: OpsErrorRow['id']) => void; resolving: boolean }> = ({
  row,
  onResolve,
  resolving,
}) => {
  const [open, setOpen] = useState(false);
  const sevColor = severityColor(row.severity);

  let contextStr = '';
  if (row.context != null) {
    try {
      contextStr = typeof row.context === 'string' ? row.context : JSON.stringify(row.context, null, 2);
    } catch {
      contextStr = String(row.context);
    }
  }

  return (
    <Box sx={{ borderTop: `1px solid ${OPS.border}` }}>
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 1.5,
          py: 1.1,
          cursor: 'pointer',
          '&:hover': { bgcolor: OPS.cardHover },
          opacity: row.resolved ? 0.55 : 1,
        }}
      >
        <ExpandMoreRoundedIcon
          sx={{ color: OPS.textFaint, fontSize: 18, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
        />
        <Typography sx={{ color: OPS.textFaint, fontSize: '0.72rem', width: 96, flexShrink: 0, fontFamily: OPS.mono }}>
          {fmtDateTime(row.time)}
        </Typography>
        <Box
          sx={{
            px: 0.9,
            py: 0.15,
            borderRadius: 1,
            bgcolor: `${sevColor}22`,
            color: sevColor,
            fontSize: '0.65rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            flexShrink: 0,
            letterSpacing: '0.04em',
          }}
        >
          {row.severity || 'info'}
        </Box>
        <Typography sx={{ color: OPS.textDim, fontSize: '0.72rem', width: 130, flexShrink: 0, fontFamily: OPS.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.service || '—'}
        </Typography>
        <Typography sx={{ color: OPS.text, fontSize: '0.8rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.error}
        </Typography>
        {row.resolved && <CheckCircleRoundedIcon sx={{ color: OPS.green, fontSize: 16, flexShrink: 0 }} />}
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.5, pb: 2, pt: 0.5 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1.25 }}>
            {row.error_type && <Meta label="Type" value={row.error_type} />}
            <Meta label="Event" value={row.event_id != null ? String(row.event_id) : '—'} mono />
            <Meta label="User" value={row.user_id != null ? String(row.user_id) : '—'} mono />
            <Meta label="ID" value={String(row.id)} mono />
          </Box>

          {row.stack && (
            <Block title="Stack trace">
              {row.stack}
            </Block>
          )}
          {contextStr && (
            <Block title="Context">
              {contextStr}
            </Block>
          )}

          {!row.resolved && (
            <Button
              size="small"
              variant="outlined"
              disabled={resolving}
              onClick={(e) => {
                e.stopPropagation();
                onResolve(row.id);
              }}
              startIcon={resolving ? <CircularProgress size={14} sx={{ color: OPS.green }} /> : <CheckCircleRoundedIcon />}
              sx={{
                mt: 1.5,
                color: OPS.green,
                borderColor: `${OPS.green}66`,
                textTransform: 'none',
                '&:hover': { borderColor: OPS.green, bgcolor: `${OPS.green}14` },
              }}
            >
              Resolve
            </Button>
          )}
          {row.resolved && (
            <Typography sx={{ color: OPS.green, fontSize: '0.72rem', mt: 1.5 }}>
              Resolved {row.resolved_at ? fmtDateTime(row.resolved_at) : ''}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

const Meta: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <Box>
    <Typography sx={{ color: OPS.textFaint, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {label}
    </Typography>
    <Typography sx={{ color: OPS.text, fontSize: '0.78rem', fontFamily: mono ? OPS.mono : undefined }}>{value}</Typography>
  </Box>
);

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box sx={{ mb: 1.25 }}>
    <Typography sx={{ color: OPS.textFaint, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>
      {title}
    </Typography>
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.25,
        bgcolor: '#0a0d15',
        border: `1px solid ${OPS.border}`,
        borderRadius: 1.5,
        color: OPS.textDim,
        fontFamily: OPS.mono,
        fontSize: '0.72rem',
        lineHeight: 1.5,
        overflowX: 'auto',
        whiteSpace: 'pre',
        maxHeight: 240,
      }}
    >
      {children}
    </Box>
  </Box>
);

const ErrorsPanel: React.FC = () => {
  const [showResolved, setShowResolved] = useState(false);
  const [data, setData] = useState<OpsErrorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<OpsErrorRow['id'] | null>(null);

  const load = useCallback(async (resolvedMode: boolean) => {
    setLoading(true);
    try {
      // showResolved=false → only unresolved. showResolved=true → all (omit filter).
      const params = new URLSearchParams({ page: '1', page_size: '50' });
      if (!resolvedMode) params.set('resolved', 'false');
      const res = await fetchWithAuth(`/api/admin/ops/errors?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch {
      setData({ total: 0, items: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(showResolved);
  }, [showResolved, load]);

  const handleResolve = useCallback(
    async (id: OpsErrorRow['id']) => {
      setResolvingId(id);
      try {
        const res = await fetchWithAuth(`/api/admin/ops/errors/${id}/resolve?resolved=true`, { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
        await load(showResolved);
      } catch {
        /* leave the row as-is on failure */
      } finally {
        setResolvingId(null);
      }
    },
    [load, showResolved]
  );

  return (
    <Box sx={{ bgcolor: OPS.card, border: `1px solid ${OPS.border}`, borderRadius: 2.5, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1.5, borderBottom: `1px solid ${OPS.border}` }}>
        <Typography sx={{ color: OPS.text, fontSize: '0.85rem', fontWeight: 800 }}>
          Errors {data ? <span style={{ color: OPS.textFaint }}>· {data.total}</span> : null}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={showResolved ? 'all' : 'open'}
          onChange={(_, v) => {
            if (v) setShowResolved(v === 'all');
          }}
          sx={{
            '& .MuiToggleButton-root': { color: OPS.textDim, borderColor: OPS.border, px: 1.5, py: 0.25, fontSize: '0.72rem', textTransform: 'none' },
            '& .Mui-selected': { color: `${OPS.text} !important`, bgcolor: 'rgba(96,165,250,0.18) !important' },
          }}
        >
          <ToggleButton value="open">Unresolved</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ position: 'relative', minHeight: 80, maxHeight: 560, overflowY: 'auto' }}>
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(11,14,22,0.4)', zIndex: 2 }}>
            <CircularProgress size={24} sx={{ color: OPS.textDim }} />
          </Box>
        )}
        {data && data.items.length > 0 ? (
          data.items.map((row) => (
            <ErrorRow key={row.id} row={row} onResolve={handleResolve} resolving={resolvingId === row.id} />
          ))
        ) : (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <CheckCircleRoundedIcon sx={{ color: OPS.green, fontSize: 30, mb: 1 }} />
            <Typography sx={{ color: OPS.textDim, fontSize: '0.85rem' }}>
              {loading ? '' : showResolved ? 'No errors logged' : 'No unresolved errors'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ErrorsPanel;
