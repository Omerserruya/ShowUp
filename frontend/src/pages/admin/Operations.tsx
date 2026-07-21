import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';
import {
  OPS,
  OpsCard,
  StatTile,
  StatusDot,
  SectionTitle,
  UsageBar,
  statusColor,
  fmtNum,
  fmtPct,
  fmtMs,
  fmtAge,
} from '../../components/ops/primitives';
import WhatsAppChart from '../../components/ops/WhatsAppChart';
import EventsTable from '../../components/ops/EventsTable';
import ErrorsPanel from '../../components/ops/ErrorsPanel';
import OpsSearch from '../../components/ops/OpsSearch';
import { OpsSummary } from '../../components/ops/types';

const POLL_MS = 10000;

// A responsive auto-fill grid of tiles.
const TileGrid: React.FC<{ children: React.ReactNode; min?: number }> = ({ children, min = 150 }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 1.5 }}>
    {children}
  </Box>
);

function Operations() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const firstLoad = useRef(true);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/admin/ops/summary');
      if (!res.ok) throw new Error(await res.text());
      setSummary(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load operations summary');
    } finally {
      firstLoad.current = false;
    }
  }, []);

  // Poll /summary every 10s.
  useEffect(() => {
    loadSummary();
    const id = setInterval(loadSummary, POLL_MS);
    return () => clearInterval(id);
  }, [loadSummary]);

  // Tick a clock so the "updated Ns ago" label advances between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const o = summary?.overview;
  const generatedAge = summary?.generated_at
    ? Math.max(0, Math.round((now - new Date(summary.generated_at).getTime()) / 1000))
    : null;

  return (
    <Box
      dir="ltr"
      sx={{
        // Break out of the light app shell into a full-bleed dark console. The
        // shell content column caps at 1280px and adds side padding; we cancel
        // both with negative margins so the console owns the full width.
        bgcolor: OPS.bg,
        color: OPS.text,
        minHeight: '100dvh',
        mx: { xs: -2.25, sm: -4 },
        mt: { xs: -2.5, md: -3.5 },
        mb: { xs: '-120px', md: -6 },
        px: { xs: 2, sm: 3 },
        py: 3,
        fontFamily: 'inherit',
      }}
    >
      <Box sx={{ maxWidth: 1500, mx: 'auto' }}>
        {/* 1. Header ------------------------------------------------------- */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2.5,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color: OPS.text, lineHeight: 1.1 }}>
              Operations Center
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
              <StatusDot color={error ? OPS.red : OPS.green} pulse={!error} size={8} />
              <Typography sx={{ color: OPS.textDim, fontSize: '0.75rem' }}>
                {error
                  ? 'Connection error — retrying'
                  : generatedAge != null
                  ? `Live · updated ${generatedAge}s ago`
                  : 'Connecting…'}
              </Typography>
            </Box>
          </Box>
          <OpsSearch />
        </Box>

        {firstLoad.current && !summary ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress sx={{ color: OPS.textDim }} />
          </Box>
        ) : (
          <>
            {/* 2. Alerts -------------------------------------------------- */}
            <AlertsPanel summary={summary} />

            {/* 3. Overview cards ----------------------------------------- */}
            {o && (
              <Box sx={{ mb: 3 }}>
                <SectionTitle>Overview</SectionTitle>
                <TileGrid>
                  <StatTile label="Active events" value={fmtNum(o.active_events)} accent={OPS.green} />
                  <StatTile label="Created today" value={fmtNum(o.events_today)} />
                  <StatTile label="Awaiting payment" value={fmtNum(o.waiting_payment)} color={o.waiting_payment > 0 ? OPS.amber : undefined} />
                  <StatTile label="Paid events" value={fmtNum(o.paid_events)} />
                  <StatTile label="Upcoming 7d" value={fmtNum(o.upcoming_7d)} />
                  <StatTile label="Finished" value={fmtNum(o.finished_events)} />
                  <StatTile label="Total guests" value={fmtNum(o.total_guests)} />
                  <StatTile label="Guests imported today" value={fmtNum(o.guests_imported_today)} />
                  <StatTile label="RSVP rate" value={fmtPct(o.rsvp_rate)} sub="responded / invited" accent={OPS.blue} />
                  <StatTile label="RSVP of all" value={fmtPct(o.rsvp_rate_of_all)} />
                  <StatTile label="Messages sent today" value={fmtNum(o.messages_sent_today)} />
                  <StatTile
                    label="Failed today"
                    value={fmtNum(o.messages_failed_today)}
                    color={o.messages_failed_today > 0 ? OPS.red : undefined}
                    accent={o.messages_failed_today > 0 ? OPS.red : undefined}
                  />
                  <StatTile label="Daily active users" value={fmtNum(o.daily_active_users)} />
                </TileGrid>
              </Box>
            )}

            {/* 4. Platform health ---------------------------------------- */}
            {summary && (
              <Box sx={{ mb: 3 }}>
                <SectionTitle>Live platform health</SectionTitle>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, gap: 1.5 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5 }}>
                    {summary.health.services.map((s) => (
                      <OpsCard key={s.service} accent={statusColor(s.status)} sx={{ p: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <StatusDot color={statusColor(s.status)} pulse={s.status === 'healthy'} />
                          <Typography sx={{ color: OPS.text, fontSize: '0.85rem', fontWeight: 700, flex: 1 }}>{s.label}</Typography>
                          {s.version && (
                            <Typography sx={{ color: OPS.textFaint, fontSize: '0.66rem', fontFamily: OPS.mono }}>{s.version}</Typography>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography sx={{ color: OPS.textDim, fontSize: '0.7rem' }}>
                            beat {fmtAge(s.heartbeat_age_seconds != null ? s.heartbeat_age_seconds : s.last_beat)}
                          </Typography>
                          <Typography sx={{ color: OPS.textFaint, fontSize: '0.7rem' }}>
                            restart {fmtAge(s.last_restart)}
                          </Typography>
                        </Box>
                      </OpsCard>
                    ))}
                    {summary.health.infra.map((s) => (
                      <OpsCard key={s.service} accent={statusColor(s.status)} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <StatusDot color={statusColor(s.status)} pulse={s.status === 'healthy'} />
                        <Typography sx={{ color: OPS.text, fontSize: '0.85rem', fontWeight: 700, flex: 1 }}>{s.label}</Typography>
                        <Typography sx={{ color: statusColor(s.status), fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize' }}>
                          {s.status}
                        </Typography>
                      </OpsCard>
                    ))}
                  </Box>

                  {/* Queue backlog */}
                  <OpsCard sx={{ p: 2 }}>
                    <Typography sx={{ color: OPS.textDim, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', mb: 0.5 }}>
                      Queue backlog
                    </Typography>
                    <Typography sx={{ color: summary.health.queue_backlog.total > 0 ? OPS.amber : OPS.text, fontSize: '2rem', fontWeight: 800, lineHeight: 1.1, mb: 1.5 }}>
                      {fmtNum(summary.health.queue_backlog.total)}
                    </Typography>
                    <BacklogRow label="Stuck messages" value={summary.health.queue_backlog.stuck_messages} />
                    <BacklogRow label="Pending notifications" value={summary.health.queue_backlog.pending_notifications} />
                    <BacklogRow label="Due campaign batches" value={summary.health.queue_backlog.due_campaign_batches} />
                  </OpsCard>
                </Box>
              </Box>
            )}

            {/* 5. Payments ------------------------------------------------ */}
            {summary && (
              <Box sx={{ mb: 3 }}>
                <SectionTitle>Payments</SectionTitle>
                <TileGrid>
                  <StatTile label="Pending" value={fmtNum(summary.payments.pending)} color={summary.payments.pending > 0 ? OPS.amber : undefined} />
                  <StatTile label="Completed" value={fmtNum(summary.payments.completed)} sub={`+${fmtNum(summary.payments.completed_today)} today`} accent={OPS.green} />
                  <StatTile label="Failed" value={fmtNum(summary.payments.failed)} color={summary.payments.failed > 0 ? OPS.red : undefined} />
                  <StatTile label="Expired" value={fmtNum(summary.payments.expired)} />
                  <StatTile label="Refunds" value={summary.payments.refunds == null ? '—' : fmtNum(summary.payments.refunds)} />
                </TileGrid>
              </Box>
            )}

            {/* 6. WhatsApp ----------------------------------------------- */}
            {summary && (
              <Box sx={{ mb: 3 }}>
                <SectionTitle>WhatsApp</SectionTitle>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1.4fr' }, gap: 1.5 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 1.5, alignContent: 'start' }}>
                    <StatTile label="Sent" value={fmtNum(summary.whatsapp.sent)} accent={OPS.blue} />
                    <StatTile label="Delivered" value={fmtNum(summary.whatsapp.delivered)} accent={OPS.green} />
                    <StatTile label="Failed" value={fmtNum(summary.whatsapp.failed)} color={summary.whatsapp.failed > 0 ? OPS.red : undefined} />
                    <StatTile label="Meta errors" value={fmtNum(summary.whatsapp.meta_errors)} color={summary.whatsapp.meta_errors > 0 ? OPS.amber : undefined} />
                    <StatTile label="Template errors" value={fmtNum(summary.whatsapp.template_errors)} color={summary.whatsapp.template_errors > 0 ? OPS.amber : undefined} />
                    <StatTile label="Opt-outs" value={fmtNum(summary.whatsapp.opt_outs)} sub={`+${fmtNum(summary.whatsapp.opt_outs_today)} today`} />
                  </Box>
                  <WhatsAppChart />
                </Box>
              </Box>
            )}

            {/* 7. AI Assistant ------------------------------------------- */}
            {summary && (
              <Box sx={{ mb: 3 }}>
                <SectionTitle>AI Assistant</SectionTitle>
                <TileGrid>
                  <StatTile label="Conversations" value={fmtNum(summary.assistant.conversations)} />
                  <StatTile label="Questions today" value={fmtNum(summary.assistant.questions_today)} />
                  <StatTile label="Actions executed" value={fmtNum(summary.assistant.actions_executed)} sub={`+${fmtNum(summary.assistant.actions_today)} today`} accent={OPS.violet} />
                  <StatTile label="Failed actions" value={fmtNum(summary.assistant.failed_actions)} color={summary.assistant.failed_actions > 0 ? OPS.red : undefined} />
                  <StatTile label="Avg response" value={fmtMs(summary.assistant.avg_response_ms)} />
                </TileGrid>
              </Box>
            )}

            {/* 8. System metrics ----------------------------------------- */}
            {summary && (
              <Box sx={{ mb: 3 }}>
                <SectionTitle>System</SectionTitle>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
                  <OpsCard sx={{ p: 2 }}>
                    <Typography sx={{ color: OPS.textDim, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', mb: 1.5 }}>
                      Host
                    </Typography>
                    {summary.system.host.available ? (
                      <>
                        <UsageBar
                          label="CPU"
                          percent={summary.system.host.cpu_percent}
                        />
                        <UsageBar
                          label="Memory"
                          percent={summary.system.host.mem_percent}
                          detail={`${fmtNum(summary.system.host.mem_used_mb)} / ${fmtNum(summary.system.host.mem_total_mb)} MB`}
                        />
                        <UsageBar
                          label="Disk"
                          percent={summary.system.host.disk_percent}
                          detail={`${fmtNum(summary.system.host.disk_used_gb)} / ${fmtNum(summary.system.host.disk_total_gb)} GB`}
                        />
                      </>
                    ) : (
                      <Typography sx={{ color: OPS.textFaint, fontSize: '0.8rem', py: 2 }}>
                        n/a — host metrics unavailable
                      </Typography>
                    )}
                  </OpsCard>

                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1.5, alignContent: 'start' }}>
                    <StatTile label="API avg" value={fmtMs(summary.system.api_latency.avg_ms)} sub={`${fmtNum(summary.system.api_latency.count)} reqs`} />
                    <StatTile label="API p50" value={fmtMs(summary.system.api_latency.p50_ms)} />
                    <StatTile label="API p95" value={fmtMs(summary.system.api_latency.p95_ms)} color={summary.system.api_latency.p95_ms > 1000 ? OPS.amber : undefined} />
                    <StatTile label="Req / min" value={fmtNum(summary.system.api_latency.rpm)} />
                    <StatTile label="Avg campaign send" value={fmtMs(summary.system.avg_campaign_send_ms)} />
                    <StatTile label="Avg assistant" value={fmtMs(summary.system.avg_assistant_response_ms)} />
                  </Box>
                </Box>
              </Box>
            )}

            {/* 9. Active events ------------------------------------------ */}
            <Box sx={{ mb: 3 }}>
              <SectionTitle>Events</SectionTitle>
              <EventsTable />
            </Box>

            {/* 10. Errors ------------------------------------------------- */}
            <Box sx={{ mb: 2 }}>
              <SectionTitle>System errors</SectionTitle>
              <ErrorsPanel />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

const BacklogRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4 }}>
    <Typography sx={{ color: OPS.textDim, fontSize: '0.78rem' }}>{label}</Typography>
    <Typography sx={{ color: value > 0 ? OPS.amber : OPS.text, fontSize: '0.78rem', fontWeight: 700 }}>{fmtNum(value)}</Typography>
  </Box>
);

// 2. Alerts panel: critical (red) + warning (amber), or a calm all-clear.
const AlertsPanel: React.FC<{ summary: OpsSummary | null }> = ({ summary }) => {
  const alerts = summary?.alerts || [];
  if (!summary) return null;

  if (alerts.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          bgcolor: 'rgba(34,197,94,0.08)',
          border: `1px solid rgba(34,197,94,0.25)`,
          borderRadius: 2.5,
          px: 2,
          py: 1.5,
          mb: 3,
        }}
      >
        <CheckCircleRoundedIcon sx={{ color: OPS.green }} />
        <Typography sx={{ color: OPS.text, fontSize: '0.9rem', fontWeight: 700 }}>All clear</Typography>
        <Typography sx={{ color: OPS.textDim, fontSize: '0.8rem' }}>No active alerts — everything is running normally.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 1.5, mb: 3 }}>
      {alerts.map((a) => {
        const critical = a.level === 'critical';
        const color = critical ? OPS.red : OPS.amber;
        return (
          <Box
            key={a.key}
            sx={{
              display: 'flex',
              gap: 1.25,
              bgcolor: critical ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${color}55`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 2,
              px: 1.75,
              py: 1.25,
            }}
          >
            {critical ? (
              <ReportProblemRoundedIcon sx={{ color, fontSize: 20, mt: 0.25 }} />
            ) : (
              <WarningAmberRoundedIcon sx={{ color, fontSize: 20, mt: 0.25 }} />
            )}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ color: OPS.text, fontSize: '0.85rem', fontWeight: 800 }}>{a.title}</Typography>
                {a.count > 0 && (
                  <Typography sx={{ color, fontSize: '0.72rem', fontWeight: 800, bgcolor: `${color}22`, px: 0.75, borderRadius: 1 }}>
                    {fmtNum(a.count)}
                  </Typography>
                )}
              </Box>
              <Typography sx={{ color: OPS.textDim, fontSize: '0.78rem', mt: 0.25 }}>{a.detail}</Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default Operations;
