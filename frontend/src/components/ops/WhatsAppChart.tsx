import React, { useEffect, useState, useCallback } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography, CircularProgress } from '@mui/material';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import { OPS } from './primitives';
import { TimeseriesPoint, TimeseriesResponse } from './types';

type Range = '24h' | '7d';

const SERIES: { key: keyof Pick<TimeseriesPoint, 'sent' | 'delivered' | 'failed'>; label: string; color: string }[] = [
  { key: 'sent', label: 'Sent', color: OPS.blue },
  { key: 'delivered', label: 'Delivered', color: OPS.green },
  { key: 'failed', label: 'Failed', color: OPS.red },
];

const OpsTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <Box
      sx={{
        bgcolor: '#0d1220',
        border: `1px solid ${OPS.borderStrong}`,
        borderRadius: 1.5,
        px: 1.5,
        py: 1,
      }}
    >
      <Typography sx={{ color: OPS.textDim, fontSize: '0.7rem', mb: 0.5 }}>{label}</Typography>
      {payload.map((p: any) => (
        <Box key={p.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color }} />
          <Typography sx={{ color: OPS.text, fontSize: '0.75rem', textTransform: 'capitalize' }}>
            {p.dataKey}: <b>{Number(p.value).toLocaleString('en-US')}</b>
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

const formatTick = (ts: string, range: Range): string => {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return range === '24h'
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const WhatsAppChart: React.FC = () => {
  const [range, setRange] = useState<Range>('24h');
  const [points, setPoints] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/ops/whatsapp/timeseries?range=${r}`);
      if (!res.ok) throw new Error(await res.text());
      const data: TimeseriesResponse = await res.json();
      setPoints(Array.isArray(data.points) ? data.points : []);
    } catch {
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  return (
    <Box
      sx={{
        bgcolor: OPS.card,
        border: `1px solid ${OPS.border}`,
        borderRadius: 2.5,
        p: 2,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography sx={{ color: OPS.text, fontSize: '0.85rem', fontWeight: 800 }}>
          Message throughput
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={range}
          onChange={(_, v) => v && setRange(v)}
          sx={{
            '& .MuiToggleButton-root': {
              color: OPS.textDim,
              borderColor: OPS.border,
              px: 1.5,
              py: 0.25,
              fontSize: '0.72rem',
              textTransform: 'none',
            },
            '& .Mui-selected': {
              color: `${OPS.text} !important`,
              bgcolor: 'rgba(96,165,250,0.18) !important',
            },
          }}
        >
          <ToggleButton value="24h">24h</ToggleButton>
          <ToggleButton value="7d">7d</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ height: 260, position: 'relative' }}>
        {loading && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
            }}
          >
            <CircularProgress size={26} sx={{ color: OPS.textDim }} />
          </Box>
        )}
        {!loading && points.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography sx={{ color: OPS.textFaint, fontSize: '0.85rem' }}>No data for this range</Typography>
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`ops-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={(v) => formatTick(v, range)}
                tick={{ fill: OPS.textFaint, fontSize: 11 }}
                stroke="rgba(255,255,255,0.1)"
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: OPS.textFaint, fontSize: 11 }}
                stroke="rgba(255,255,255,0.1)"
                allowDecimals={false}
                width={44}
              />
              <Tooltip content={<OpsTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: OPS.textDim }}
                formatter={(value) => <span style={{ color: OPS.textDim }}>{value}</span>}
              />
              {SERIES.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#ops-grad-${s.key})`}
                  isAnimationActive={false}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Box>
    </Box>
  );
};

export default WhatsAppChart;
