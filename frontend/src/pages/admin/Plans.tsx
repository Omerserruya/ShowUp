import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Stack,
  Switch,
  Divider,
  CircularProgress,
  Alert,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

interface PlanRow {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  price: string;
  color: string;
  count_limit: number | null;
  is_popular: boolean;
  is_active_default: boolean;
  is_active: boolean;
  is_overridden: boolean;
  overridden_by: string | null;
  overridden_at: string | null;
  features: string[];
  capabilities: string[];
  campaigns_count: number;
}

// Hebrew labels for the entitlement capability keys (presentation only - the
// backend `shared/domain/entitlements.py` is the source of truth for the keys).
const CAPABILITY_LABELS: Record<string, string> = {
  dashboard: 'דשבורד תגובות',
  csv_export: 'ייצוא CSV',
  web_invitation: 'הזמנה דיגיטלית',
  invitation_customization: 'עיצוב הזמנה מתקדם',
  whatsapp_campaigns: 'קמפייני וואטסאפ',
  templates: 'תבניות הודעה',
  advanced_scheduling: 'תזמון מתקדם',
  tags: 'תיוגים',
  custom_fields: 'שדות מותאמים',
  seating: 'הושבה',
  team_members: 'חברי צוות',
  ai_assistant: 'עוזר חכם',
  read_analytics: 'אנליטיקת קריאה',
  sms_campaigns: 'קמפייני SMS',
  custom_domain: 'דומיין מותאם',
};

const capLabel = (k: string) => CAPABILITY_LABELS[k] || k;

function Plans() {
  const theme = useTheme();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [capabilitiesAvailable, setCapabilitiesAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/plans');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPlans(data.plans || []);
      setCapabilitiesAvailable(data.capabilities_available !== false);
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינת החבילות');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleToggle = async (plan: PlanRow) => {
    setSavingId(plan.id);
    // Optimistic update; revert on failure.
    setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, is_active: !p.is_active } : p)));
    try {
      const res = await fetchWithAuth(`/api/admin/plans/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !plan.is_active }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchPlans();
    } catch (e: any) {
      setError(e?.message || 'שגיאה בעדכון החבילה');
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, is_active: plan.is_active } : p)));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        חבילות ומהדורות
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        מחירים, מגבלות ויכולות מוגדרים בקונפיגורציה. כאן ניתן להפעיל או להשבית חבילה - השבתה מסתירה אותה
        מדף התמחור, אך אירועים קיימים ממשיכים לעבוד.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!capabilitiesAvailable && !loading && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          מטריצת היכולות אינה זמינה כרגע (שירות הליבה לא נגיש) - מוצגים מחיר ומגבלות בלבד.
        </Alert>
      )}

      {loading && plans.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {plans.map((plan) => {
            const accent = plan.color || theme.palette.primary.main;
            const dimmed = !plan.is_active;
            return (
              <Paper
                key={plan.id}
                elevation={0}
                sx={{
                  p: 2.5,
                  borderRadius: 3,
                  position: 'relative',
                  border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
                  borderTop: `3px solid ${accent}`,
                  opacity: dimmed ? 0.6 : 1,
                  transition: 'opacity 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Header: title + price + toggle */}
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {plan.title}
                      </Typography>
                      {plan.is_popular && (
                        <Tooltip title="חבילה מומלצת">
                          <StarRoundedIcon sx={{ fontSize: 18, color: accent }} />
                        </Tooltip>
                      )}
                    </Stack>
                    <Typography
                      variant="caption"
                      dir="ltr"
                      sx={{ color: 'text.secondary', fontFamily: 'monospace', display: 'block', textAlign: 'right' }}
                    >
                      {plan.id}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: accent, lineHeight: 1 }}>
                      {plan.price}
                    </Typography>
                    <Tooltip title={plan.is_active ? 'פעילה (ניתנת לרכישה)' : 'מושבתת'}>
                      <Switch
                        size="small"
                        checked={plan.is_active}
                        disabled={savingId === plan.id}
                        onChange={() => handleToggle(plan)}
                      />
                    </Tooltip>
                  </Box>
                </Stack>

                {plan.subtitle && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {plan.subtitle}
                  </Typography>
                )}

                {/* Status chips */}
                <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
                  <Chip
                    size="small"
                    label={plan.is_active ? 'פעילה' : 'מושבתת'}
                    sx={{
                      bgcolor: alpha(plan.is_active ? theme.palette.success.main : theme.palette.text.disabled, 0.12),
                      color: plan.is_active ? theme.palette.success.dark : theme.palette.text.secondary,
                      fontWeight: 600,
                    }}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={plan.count_limit == null ? 'אורחים: ללא הגבלה' : `עד ${plan.count_limit} אורחים`}
                  />
                  {plan.campaigns_count > 0 && (
                    <Chip size="small" variant="outlined" label={`${plan.campaigns_count} קמפיינים`} />
                  )}
                  {plan.is_overridden && (
                    <Tooltip title={plan.overridden_at ? `עודכן ${new Date(plan.overridden_at).toLocaleString('he-IL')}` : 'עודכן ידנית'}>
                      <Chip size="small" variant="outlined" color="warning" label="נערך ידנית" />
                    </Tooltip>
                  )}
                </Stack>

                <Divider sx={{ my: 1.75 }} />

                {/* Capabilities (entitlements SSOT) */}
                <Typography variant="overline" color="text.secondary">
                  יכולות
                </Typography>
                {plan.capabilities.length > 0 ? (
                  <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {plan.capabilities.map((cap) => (
                      <Chip
                        key={cap}
                        size="small"
                        icon={<CheckRoundedIcon sx={{ fontSize: 14 }} />}
                        label={capLabel(cap)}
                        sx={{ bgcolor: alpha(accent, 0.1), color: theme.palette.text.primary }}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {capabilitiesAvailable ? 'ללא יכולות מוגדרות' : '-'}
                  </Typography>
                )}

                {/* Marketing bullets, if any */}
                {plan.features.length > 0 && (
                  <>
                    <Typography variant="overline" color="text.secondary" sx={{ mt: 1.75, display: 'block' }}>
                      מה כולל (שיווקי)
                    </Typography>
                    <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                      {plan.features.map((f, i) => (
                        <Typography key={i} variant="body2" color="text.secondary">
                          • {f}
                        </Typography>
                      ))}
                    </Stack>
                  </>
                )}
              </Paper>
            );
          })}
          {plans.length === 0 && !loading && (
            <Typography color="text.secondary" sx={{ py: 4 }}>
              לא נמצאו חבילות.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

export default Plans;
