import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Stack, Switch, FormControlLabel, TextField, Typography,
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon } from '@mui/icons-material';
import { fetchWithAuth } from '../../utils/fetchWithAuth';

/**
 * Admin: round categories (/admin/round-categories). Every message round has a
 * category, and the category's audience alone decides who receives it.
 * Changing an audience here re-applies it to every round that has not gone out.
 * Backend: core app/routers/round_categories_admin.py,
 * dictionary: shared/domain/round_categories.py.
 */

interface Category {
  id: string;
  base_stage: string;
  kind_he: string;
  title: string;
  description: string;
  audience: string;
  audience_param: string | null;
  audience_label: string;
  sort_order: number;
  builtin: boolean;
  archived: boolean;
  open_rounds: number;
}
interface AudienceOpt { key: string; label: string; hint: string; param: 'tag' | 'group' | null }
interface Tpl {
  id: string; title: string; flow_stage: string; own_stage?: string; category_id?: string;
  lifecycle: string; source?: string; replaced_by?: string; replaces?: string; event_types: string[];
}
interface StageOpt { id: string; label: string }

type Draft = {
  id: string | null; title: string; description: string; base_stage: string;
  audience: string; audience_param: string; sort_order: number; archived: boolean; builtin: boolean;
};

const EMPTY: Draft = {
  id: null, title: '', description: '', base_stage: 'reminder', audience: 'no_response',
  audience_param: '', sort_order: 500, archived: false, builtin: false,
};

export default function RoundCategories() {
  const [cats, setCats] = useState<Category[]>([]);
  const [audiences, setAudiences] = useState<AudienceOpt[]>([]);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth('/api/admin/messaging/round-categories');
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setCats(d.categories); setAudiences(d.audiences); setStages(d.stages);
      const cr = await fetchWithAuth('/api/catalog');
      if (cr.ok) {
        const cd = await cr.json();
        setTemplates((cd.templates || []).filter((t: Tpl) => t.lifecycle === 'active' || t.lifecycle === 'approved' || t.source === 'custom'));
      }
    } catch (e: any) {
      setError(e?.message || 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const aud = audiences.find((a) => a.key === draft?.audience);
  const stageLabel = (id?: string) => stages.find((s) => s.id === id)?.label || id || '';
  const templatesOf = (catId: string) => templates.filter((t) => (t.category_id || t.flow_stage) === catId);

  // Move a template (and its per-event-type versions) into another category.
  // Rounds already scheduled with it follow and take that category's audience.
  const moveTemplate = async (t: Tpl, categoryId: string) => {
    setMoving(t.id); setError(null);
    try {
      const r = await fetchWithAuth('/api/admin/messaging/template-placements', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: t.id, category_id: categoryId === '__own' ? null : categoryId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'ההעברה נכשלה');
      setNotice(`״${t.title}״ הועברה.${d.moved_rounds ? ` ${d.moved_rounds} סבבים מתוזמנים עברו איתה.` : ''}`);
      load();
    } catch (e: any) {
      setError(e?.message || 'ההעברה נכשלה');
    } finally {
      setMoving(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    const body = {
      title: draft.title, description: draft.description, base_stage: draft.base_stage,
      audience: draft.audience, audience_param: aud?.param ? draft.audience_param : null,
      sort_order: draft.sort_order, archived: draft.archived,
    };
    try {
      const r = await fetchWithAuth(
        draft.id ? `/api/admin/messaging/round-categories/${draft.id}` : '/api/admin/messaging/round-categories',
        { method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'שמירה נכשלה');
      setNotice(draft.id
        ? `נשמר. הקהל עודכן ב־${d.synced_rounds ?? 0} סבבים שעוד לא נשלחו.`
        : 'הקטגוריה נוספה.');
      setDraft(null);
      load();
    } catch (e: any) {
      setError(e?.message || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const edit = (c: Category) => setDraft({
    id: c.id, title: c.title, description: c.description, base_stage: c.base_stage, audience: c.audience,
    audience_param: c.audience_param || '', sort_order: c.sort_order, archived: c.archived, builtin: c.builtin,
  });

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, direction: 'rtl', maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>קטגוריות סבבים</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDraft({ ...EMPTY })}>קטגוריה חדשה</Button>
      </Stack>
      <Typography sx={{ color: 'text.secondary', fontSize: 14, mb: 2, maxWidth: 720, lineHeight: 1.7 }}>
        לכל סבב הודעות יש קטגוריה, והקהל של הקטגוריה קובע למי הסבב נשלח. בעלי האירוע רק בוחרים קטגוריה.
        שינוי קהל כאן חל גם על סבבים שכבר תוזמנו ועוד לא נשלחו.
      </Typography>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>{notice}</Alert>}

      {loading && !cats.length ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <Stack spacing={1.25}>
          {cats.map((c) => (
            <Paper key={c.id} elevation={0} sx={{ p: 2, borderRadius: 2, opacity: c.archived ? 0.55 : 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 16 }}>{c.title}</Typography>
                    <Chip size="small" label={c.kind_he} />
                    {c.builtin && <Chip size="small" variant="outlined" label="מובנית" />}
                    {c.archived && <Chip size="small" color="warning" label="מוסתרת" />}
                  </Stack>
                  {c.description && (
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.5 }}>{c.description}</Typography>
                  )}
                </Box>
                <Box sx={{ minWidth: 200 }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>נשלח ל</Typography>
                  <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{c.audience_label}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {c.open_rounds ? `${c.open_rounds} סבבים מתוזמנים` : 'אין סבבים מתוזמנים'}
                  </Typography>
                </Box>
                <Button size="small" startIcon={<EditIcon />} onClick={() => edit(c)}>עריכה</Button>
              </Stack>
              <Button size="small" sx={{ mt: 1, px: 0 }} onClick={() => setOpenCat(openCat === c.id ? null : c.id)}>
                {openCat === c.id ? 'הסתרת התבניות' : `תבניות בקטגוריה (${templatesOf(c.id).length})`}
              </Button>
              {openCat === c.id && (
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {templatesOf(c.id).length === 0 && (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      אין כאן תבניות משלה. סבבים בקטגוריה הזו משתמשים בתבניות של ״{stageLabel(c.base_stage)}״.
                    </Typography>
                  )}
                  {templatesOf(c.id).map((t) => (
                    <Stack key={t.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}
                      sx={{ p: 1, borderRadius: 1.5, bgcolor: 'action.hover' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{t.title}</Typography>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }} dir="ltr" align="right">
                          {t.id}
                          {t.own_stage && t.own_stage !== t.flow_stage ? ` · במקור: ${stageLabel(t.own_stage)}` : ''}
                          {t.replaced_by ? ' · הוחלפה בעריכה מאושרת' : ''}
                          {t.replaces ? ` · עריכה של ${t.replaces}` : ''}
                        </Typography>
                      </Box>
                      <TextField select size="small" label="העברה ל" value="" disabled={moving === t.id}
                        sx={{ minWidth: 200 }} onChange={(e) => moveTemplate(t, e.target.value)}>
                        {cats.filter((x) => !x.archived && x.id !== c.id).map((x) => (
                          <MenuItem key={x.id} value={x.id}>{x.title}</MenuItem>
                        ))}
                        {t.own_stage && t.own_stage !== t.flow_stage && (
                          <MenuItem value="__own">חזרה למקום המקורי ({stageLabel(t.own_stage)})</MenuItem>
                        )}
                      </TextField>
                    </Stack>
                  ))}
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                    לעריכת הנוסח של תבנית מובנית: ״תבניות הודעה״ ← בוחרים את התבנית ← ״עריכה״.
                  </Typography>
                </Stack>
              )}
            </Paper>
          ))}
        </Stack>
      )}

      <Dialog open={!!draft} onClose={() => !saving && setDraft(null)} fullWidth maxWidth="sm" dir="rtl">
        <DialogTitle>{draft?.id ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}</DialogTitle>
        {draft && (
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="שם" value={draft.title} inputProps={{ maxLength: 80 }}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <TextField label="תיאור" value={draft.description} multiline minRows={2} inputProps={{ maxLength: 400 }}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <TextField select label="סוג (קובע אילו תבניות מתאימות)" value={draft.base_stage}
                disabled={draft.builtin}
                helperText={draft.builtin ? 'בקטגוריה מובנית אי אפשר לשנות את הסוג' : undefined}
                onChange={(e) => setDraft({ ...draft, base_stage: e.target.value })}>
                {stages.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
              </TextField>
              <TextField select label="נשלח ל" value={draft.audience} helperText={aud?.hint}
                onChange={(e) => setDraft({ ...draft, audience: e.target.value })}>
                {audiences.map((a) => <MenuItem key={a.key} value={a.key}>{a.label}</MenuItem>)}
              </TextField>
              {aud?.param && (
                <TextField label={aud.param === 'tag' ? 'שם התגית' : 'שם הקבוצה'} value={draft.audience_param}
                  inputProps={{ maxLength: 100 }}
                  onChange={(e) => setDraft({ ...draft, audience_param: e.target.value })} />
              )}
              <TextField label="סדר הצגה" type="number" value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })} />
              {!draft.builtin && draft.id && (
                <FormControlLabel label="להסתיר מבעלי האירוע"
                  control={<Switch checked={draft.archived} onChange={(e) => setDraft({ ...draft, archived: e.target.checked })} />} />
              )}
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setDraft(null)} disabled={saving}>ביטול</Button>
          <Button variant="contained" onClick={save}
            disabled={saving || !draft?.title.trim() || (!!aud?.param && !draft?.audience_param.trim())}>
            {saving ? <CircularProgress size={20} /> : 'שמירה'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
