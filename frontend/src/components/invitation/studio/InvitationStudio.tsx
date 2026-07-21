import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Stack, Typography, Button, IconButton, Tooltip, Snackbar, Popover, TextField, alpha, ToggleButtonGroup, ToggleButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import TabletMacRoundedIcon from '@mui/icons-material/TabletMacRounded';
import PhoneIphoneRoundedIcon from '@mui/icons-material/PhoneIphoneRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';

import InvitationView, { EditCtl, CONTENT_BLOCKS } from '../InvitationView';
import EnvelopeIntro from '../EnvelopeIntro';
import { InvitationConfig, InvitationData, InvitationTheme, DEFAULT_INVITATION } from '../types';
import { resolveTheme, THEME_PRESETS, TITLE_FONTS, BODY_FONTS, DEFAULT_THEME, LAYOUTS } from '../theme';
import { templatesForEventType, InvitationTemplate } from '../templates';
import { ensureAllFonts } from '../../../utils/fonts';

const BRAND = '#6f74e0';
const DEVICE_W: Record<string, number | string> = { desktop: '100%', tablet: 834, mobile: 402 };

export interface InvitationStudioProps {
  data: InvitationData;
  saving?: boolean;
  published?: boolean;
  publicUrl?: string;
  onSaveConfig: (cfg: InvitationConfig) => Promise<boolean> | void;
  onTogglePublish: (cfg: InvitationConfig) => Promise<boolean> | void;
  uploadImage?: (file: File) => Promise<string | null>;
  /** Leave the full-screen editor (studio runs as a viewport takeover). */
  onExit?: () => void;
}

export default function InvitationStudio({ data, saving, published, publicUrl, onSaveConfig, onTogglePublish, uploadImage, onExit }: InvitationStudioProps) {
  const [cfg, setCfg] = useState<InvitationConfig>({ ...DEFAULT_INVITATION, ...(data.invitation || {}) });
  const [savedCfg, setSavedCfg] = useState<InvitationConfig>(() => ({ ...DEFAULT_INVITATION, ...(data.invitation || {}) }));
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [toast, setToast] = useState<string | null>(null);
  const [designAnchor, setDesignAnchor] = useState<HTMLElement | null>(null);
  const [envPreview, setEnvPreview] = useState(false);
  const [unpublishConfirm, setUnpublishConfirm] = useState(false);
  // Guest-eye mode: the exact page guests see - no edit chrome, no outlines.
  const [guestPreview, setGuestPreview] = useState(false);
  // Step 1 of the editor: a design must be chosen before fiddling with details -
  // first-ever visit (no preset saved) opens the gallery automatically.
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(() => !(data.invitation?.theme?.preset));
  const fileRef = useRef<HTMLInputElement | null>(null);

  const templates = useMemo(() => templatesForEventType(data.event_type), [data.event_type]);

  // Apply a ready-made design: replace theme + envelope, keep the couple's own
  // photo, names and any personal text they already wrote.
  const applyTemplate = (tpl: InvitationTemplate) => {
    setCfg((c) => ({
      ...c,
      theme: { layout: c.theme?.layout || 'editorial', ...(tpl.config.theme || {}) },
      envelope: { ...c.envelope, ...(tpl.config.envelope || {}) },
      hero: { ...c.hero, ...(tpl.config.hero?.font ? { font: tpl.config.hero.font } : {}) },
      personalText: c.personalText && c.personalText.trim() ? c.personalText : (tpl.config.personalText ?? c.personalText),
    }));
    setTemplatesOpen(false);
    setToast('העיצוב הוחל - אפשר להמשיך ולערוך');
  };

  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(savedCfg), [cfg, savedCfg]);

  // Couples browse the full font menu here - load every family (guests never do).
  useEffect(() => { ensureAllFonts(); }, []);

  // A session of design work must not be lost to a stray refresh / tab close.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const handleSave = async () => {
    const ok = await onSaveConfig(cfg);
    if (ok === false) { setToast('השמירה נכשלה - נסו שוב'); return; }
    setSavedCfg(cfg);
    setToast(published ? 'נשמר - השינויים פורסמו לאורחים' : 'נשמר');
  };

  const handlePublish = async () => {
    const ok = await onTogglePublish(cfg);
    if (ok !== false) setSavedCfg(cfg);
  };

  const previewData: InvitationData = { ...data, invitation: cfg };
  // A real 834px tablet falls below the md breakpoint and gets the stacked layout,
  // so the tablet preview must show it too - not a cramped desktop split.
  const forceLayout = device === 'desktop' ? 'desktop' : 'mobile';
  const coupleNames = cfg.hero?.bigText
    || (data.inviters?.length ? data.inviters.map((i) => `${i.fn} ${i.ln}`.trim()).join(' & ') : data.name)
    || '';

  const uploadAndSet = async (file?: File | null) => {
    if (!file || !uploadImage) return;
    setToast('מעלה תמונה…');
    const url = await uploadImage(file);
    if (url) { setCfg((c) => ({ ...c, hero: { ...c.hero, imageUrl: url } })); setToast('התמונה הועלתה'); }
    // On failure the parent (uploadImage owner) shows the detailed error toast -
    // just dismiss our progress toast so the two don't overlap.
    else setToast(null);
  };

  const order = useMemo(() => {
    const cur = (cfg.order || []).filter((x) => (CONTENT_BLOCKS as readonly string[]).includes(x));
    return [...cur, ...CONTENT_BLOCKS.filter((x) => !cur.includes(x))];
  }, [cfg.order]);

  const edit: EditCtl = useMemo(() => ({
    onCommit: (key, value) => setCfg((c) => {
      if (key === 'overline') return { ...c, envelope: { ...c.envelope, envelopeText: value } };
      if (key === 'names') return { ...c, hero: { ...c.hero, bigText: value } };
      if (key === 'personalText') return { ...c, personalText: value };
      // Any other key is an editable UI label.
      return { ...c, labels: { ...c.labels, [key]: value } };
    }),
    pickImage: () => fileRef.current?.click(),
    removeImage: () => setCfg((c) => ({ ...c, hero: { ...c.hero, imageUrl: '' } })),
    dropImage: (file) => uploadAndSet(file),
    order,
    move: (id, dir) => setCfg((c) => {
      const o = [...order]; const i = o.indexOf(id); const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return c;
      [o[i], o[j]] = [o[j], o[i]];
      return { ...c, order: o };
    }),
    reorder: (fromId, toId) => setCfg((c) => {
      const o = order.filter((x) => x !== fromId); const at = o.indexOf(toId);
      o.splice(at < 0 ? o.length : at, 0, fromId);
      return { ...c, order: o };
    }),
    isHidden: (id) => (id === 'rsvp' ? cfg.rsvpEnabled === false : (cfg.hidden || []).includes(id)),
    setHidden: (id, hidden) => setCfg((c) => {
      if (id === 'rsvp') return { ...c, rsvpEnabled: !hidden };
      const set = new Set(c.hidden || []);
      if (hidden) set.add(id); else set.delete(id);
      return { ...c, hidden: Array.from(set) };
    }),
    toggleDetail: (key) => setCfg((c) => {
      const d = { showDate: true, showTime: true, showLocation: true, ...c.details };
      return { ...c, details: { ...d, [key]: d[key] === false } };
    }),
    details: { showDate: cfg.details?.showDate !== false, showTime: cfg.details?.showTime !== false, showLocation: cfg.details?.showLocation !== false },
  }), [cfg, order]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = cfg.theme || {};
  const setTheme = (patch: InvitationTheme) => setCfg((c) => ({ ...c, theme: { ...c.theme, ...patch } }));
  const en = cfg.envelope || {};
  const setEnv = (patch: Record<string, any>) => setCfg((c) => ({ ...c, envelope: { ...c.envelope, ...patch } }));

  return (
    <Box sx={{
      direction: 'rtl',
      position: 'fixed', inset: 0, zIndex: 1290,
      bgcolor: 'background.default',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* toolbar */}
      <Stack direction="row" alignItems="center" justifyContent="space-between"
        sx={{ flexWrap: 'wrap', gap: 1.5, px: { xs: 1.5, sm: 3 }, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {onExit && (
            <Tooltip title="חזרה">
              <IconButton size="small" onClick={onExit} sx={{ color: 'text.secondary' }}>
                <ArrowForwardRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-0.02em' }}>אולפן ההזמנה</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>לחצו על טקסט לעריכה · גררו לשינוי סדר · לחצו על תמונה להחלפה · ⚙ להגדרות.</Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Tooltip title={guestPreview ? 'חזרה לעריכה' : 'תצוגת אורח - בדיוק מה שהאורחים יראו'}>
            <IconButton size="small" onClick={() => setGuestPreview((v) => !v)} sx={{ color: guestPreview ? '#fff' : BRAND, bgcolor: guestPreview ? BRAND : 'transparent', '&:hover': { bgcolor: guestPreview ? '#5f64d6' : alpha(BRAND, 0.08) } }}>
              {guestPreview ? <EditRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="תצוגת מעטפה"><IconButton size="small" onClick={() => setEnvPreview(true)} sx={{ color: BRAND }}><MailRoundedIcon fontSize="small" /></IconButton></Tooltip>
          <Button startIcon={<AutoAwesomeRoundedIcon />} size="small" onClick={() => setTemplatesOpen(true)} sx={{ borderRadius: 99, px: 2, fontWeight: 700, color: BRAND, bgcolor: alpha(BRAND, 0.08), '&:hover': { bgcolor: alpha(BRAND, 0.16) } }}>תבניות</Button>
          <Button startIcon={<PaletteRoundedIcon />} size="small" onClick={(e) => setDesignAnchor(e.currentTarget)} sx={{ borderRadius: 99, px: 2, fontWeight: 700, color: BRAND, bgcolor: alpha(BRAND, 0.08), '&:hover': { bgcolor: alpha(BRAND, 0.16) } }}>עיצוב</Button>
          <ToggleButtonGroup exclusive size="small" value={device} onChange={(_, v) => v && setDevice(v)} sx={{ bgcolor: alpha(BRAND, 0.06), borderRadius: 99, p: 0.5, '& .MuiToggleButton-root': { border: 0, borderRadius: '99px !important', px: 1.25, color: 'text.secondary', '&.Mui-selected': { bgcolor: '#fff', color: BRAND, boxShadow: '0 1px 3px rgba(16,24,40,0.12)' } } }}>
            <ToggleButton value="desktop"><DesktopWindowsRoundedIcon fontSize="small" /></ToggleButton>
            <ToggleButton value="tablet"><TabletMacRoundedIcon fontSize="small" /></ToggleButton>
            <ToggleButton value="mobile"><PhoneIphoneRoundedIcon fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
          {published && publicUrl && (
            <Tooltip title={publicUrl}><IconButton href={publicUrl} target="_blank" size="small"><OpenInNewRoundedIcon fontSize="small" /></IconButton></Tooltip>
          )}
          {dirty && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.4, borderRadius: 99, bgcolor: alpha('#f59e0b', 0.12), color: '#b45309', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#f59e0b' }} />
              שינויים לא נשמרו
            </Box>
          )}
          <Button variant={dirty ? 'contained' : 'text'} disableElevation disabled={saving || !dirty} onClick={handleSave}
            sx={dirty
              ? { borderRadius: 99, px: 2.5, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#5f64d6' } }
              : { fontWeight: 700, color: 'text.secondary' }}>
            שמירה
          </Button>
          {published ? (
            <Button variant="outlined" disabled={saving} onClick={() => setUnpublishConfirm(true)}
              sx={{ borderRadius: 99, px: 2.5, fontWeight: 700, color: '#15803d', borderColor: alpha('#15803d', 0.4), '&:hover': { borderColor: '#15803d', bgcolor: alpha('#15803d', 0.06) } }}>
              מפורסם ✓
            </Button>
          ) : (
            <Button variant="contained" disableElevation disabled={saving} onClick={handlePublish}
              sx={{ borderRadius: 99, px: 3, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: '#5f64d6' } }}>
              פרסום
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Unpublishing takes the live page away from guests - it must never be one accidental click. */}
      <Dialog open={unpublishConfirm} onClose={() => setUnpublishConfirm(false)} dir="rtl" PaperProps={{ sx: { borderRadius: 3, p: 0.5 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>ההזמנה מפורסמת</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: publicUrl ? 1.5 : 0 }}>
            הקישור פעיל וזמין לאורחים. הסרה מפרסום תנתק את הקישור - אורחים שיפתחו אותו לא יראו את ההזמנה.
          </DialogContentText>
          {publicUrl && (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', direction: 'ltr', textAlign: 'left', wordBreak: 'break-all' }}>{publicUrl}</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setUnpublishConfirm(false)} sx={{ fontWeight: 700 }}>השארת ההזמנה באוויר</Button>
          <Button color="error" disabled={saving} onClick={async () => { setUnpublishConfirm(false); await handlePublish(); }} sx={{ fontWeight: 700 }}>
            הסרה מפרסום
          </Button>
        </DialogActions>
      </Dialog>

      {/* Full-viewport editing canvas (fills the remaining height below the toolbar). */}
      <Box sx={{ flex: 1, minHeight: 0, bgcolor: '#e7e3dc', p: { xs: 1, sm: 2 }, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
        <Box sx={{ width: DEVICE_W[device], maxWidth: '100%', height: '100%', borderRadius: device === 'desktop' ? 2 : 5, overflow: 'hidden', boxShadow: '0 30px 70px -30px rgba(16,24,40,0.4)', bgcolor: resolveTheme(cfg.theme).bg, transition: 'width .35s cubic-bezier(.2,.8,.2,1)' }}>
          <Box sx={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', scrollBehavior: 'smooth', containerType: 'size' }}>
            <InvitationView data={previewData} embedded forceLayout={forceLayout} edit={guestPreview ? undefined : edit} rsvpSlot={<PreviewRsvp themeCfg={cfg.theme} />} />
          </Box>
        </Box>
      </Box>

      {/* Design gallery - STEP 1 of the editor. Design templates first (each a
          genuinely different page layout), then event-type color palettes. */}
      <Dialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} dir="rtl" maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>
          באיזה סגנון ההזמנה שלכם?
          <Typography sx={{ fontWeight: 500, fontSize: '0.85rem', color: 'text.secondary', mt: 0.25 }}>
            בחרו עיצוב פתיחה - הכול נשאר ניתן לעריכה, והתמונות והשמות שלכם נשמרים.
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: 'text.secondary', mb: 1 }}>עיצובי בסיס</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)' }, gap: 1.5, pb: 2 }}>
            {templates.filter((tpl) => tpl.eventTypes.length === 0).map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} coupleNames={coupleNames}
                active={(cfg.theme?.preset || '') === ((tpl.config.theme?.preset) || tpl.id)}
                onClick={() => applyTemplate(tpl)} />
            ))}
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: 'text.secondary', mb: 1 }}>עיצובים לפי סוג האירוע</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(4,1fr)' }, gap: 1.5, py: 0.5 }}>
            {templates.filter((tpl) => tpl.eventTypes.length > 0).map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} coupleNames={coupleNames} compact
                active={(cfg.theme?.preset || '') === ((tpl.config.theme?.preset) || tpl.id)}
                onClick={() => applyTemplate(tpl)} />
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setTemplatesOpen(false)} sx={{ fontWeight: 700 }}>סגירה</Button>
        </DialogActions>
      </Dialog>

      {/* Envelope intro preview (over the whole studio) */}
      {envPreview && (
        <EnvelopeIntro config={cfg} names={coupleNames} onDone={() => setEnvPreview(false)} />
      )}

      {/* Design / theme panel */}
      <Popover open={!!designAnchor} anchorEl={designAnchor} onClose={() => setDesignAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { direction: 'rtl', p: 2.5, borderRadius: 4, width: 320, mt: 1, maxHeight: '82vh', overflowY: 'auto' } } }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1rem', mb: 1.5 }}>עיצוב ההזמנה</Typography>

        <PanelLabel>ערכת נושא</PanelLabel>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1, mb: 2 }}>
          {THEME_PRESETS.map((p) => {
            const active = (cfg.theme?.preset || 'ivory') === p.key;
            return (
              <Tooltip key={p.key} title={p.label}>
                <Box onClick={() => setTheme(p.theme)} sx={{ cursor: 'pointer', height: 46, borderRadius: 2, bgcolor: p.theme.bg || '#f5efe6', border: '2px solid', borderColor: active ? BRAND : 'rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Box sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: p.theme.accent || '#95836b' }} />
                </Box>
              </Tooltip>
            );
          })}
        </Box>

        <PanelLabel>צבעים</PanelLabel>
        <Stack spacing={1} sx={{ mb: 2 }}>
          <ColorRow label="רקע" value={th.bg || DEFAULT_THEME.bg} onChange={(v) => setTheme({ bg: v })} />
          <ColorRow label="טקסט" value={th.ink || DEFAULT_THEME.ink} onChange={(v) => setTheme({ ink: v })} />
          <ColorRow label="הדגשה / כפתורים" value={th.accent || DEFAULT_THEME.accent} onChange={(v) => setTheme({ accent: v })} />
        </Stack>

        <PanelLabel>גופנים</PanelLabel>
        <Stack spacing={1.25} sx={{ mb: 2 }}>
          <FontSelect label="כותרות" value={th.titleFont || DEFAULT_THEME.titleFont} options={TITLE_FONTS} onChange={(v) => setTheme({ titleFont: v })} />
          <FontSelect label="טקסט" value={th.bodyFont || DEFAULT_THEME.bodyFont} options={BODY_FONTS} onChange={(v) => setTheme({ bodyFont: v })} />
        </Stack>

        <Box sx={{ height: '1px', bgcolor: 'rgba(0,0,0,0.08)', mb: 2 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <PanelLabel>מעטפת פתיחה</PanelLabel>
          <SwitchToggle on={!!en.enabled} onClick={() => setEnv({ enabled: !en.enabled })} />
        </Box>
        {en.enabled && (
          <Stack spacing={1.5}>
            <ColorRow label="צבע הנייר" value={en.color || '#3e121a'} onChange={(v) => setEnv({ color: v })} />
            <ColorRow label="צבע החותם" value={en.waxColor || '#d8ccb8'} onChange={(v) => setEnv({ waxColor: v })} />
            <FontSelect label="גופן" value={en.font || DEFAULT_THEME.titleFont} options={TITLE_FONTS} onChange={(v) => setEnv({ font: v })} />
            <TextField size="small" fullWidth label="טקסט על החותם" placeholder="ראשי תיבות / ♥" value={en.stampText || ''} onChange={(e) => setEnv({ stampText: e.target.value })} />
            <TextField size="small" fullWidth multiline minRows={2} label="טקסט על המעטפה" placeholder="הזמנה אישית - נשמח לחגוג יחד" value={en.paperText || ''} onChange={(e) => setEnv({ paperText: e.target.value })} />
            <Button size="small" startIcon={<MailRoundedIcon />} onClick={() => { setDesignAnchor(null); setEnvPreview(true); }} sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, color: BRAND, bgcolor: alpha(BRAND, 0.08), '&:hover': { bgcolor: alpha(BRAND, 0.16) } }}>תצוגה מקדימה</Button>
          </Stack>
        )}
      </Popover>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { uploadAndSet(e.target.files?.[0]); e.target.value = ''; }} />
      <Snackbar open={!!toast} autoHideDuration={2200} onClose={() => setToast(null)} message={toast || ''} />
    </Box>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', color: 'text.secondary', mb: 1 }}>{children}</Typography>;
}

function SwitchToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{ width: 42, height: 24, borderRadius: 99, bgcolor: on ? BRAND : 'rgba(0,0,0,0.18)', position: 'relative', transition: 'background .2s', cursor: 'pointer', flexShrink: 0 }}>
      <Box sx={{ position: 'absolute', top: 2, insetInlineStart: on ? 20 : 2, width: 20, height: 20, borderRadius: '50%', bgcolor: '#fff', transition: 'inset-inline-start .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </Box>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Typography sx={{ fontSize: '0.85rem' }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', fontFamily: 'monospace' }}>{value}</Typography>
        <Box component="label" sx={{ width: 32, height: 32, borderRadius: 1.5, border: '1px solid rgba(0,0,0,0.15)', bgcolor: value, cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', border: 'none' }} />
        </Box>
      </Box>
    </Box>
  );
}

function FontSelect({ label, value, options, onChange }: { label: string; value: string; options: { label: string; value: string }[]; onChange: (v: string) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Typography sx={{ fontSize: '0.85rem' }}>{label}</Typography>
      <Box component="select" value={value} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        sx={{ fontFamily: value, fontSize: '0.9rem', p: '6px 10px', borderRadius: 1.5, border: '1px solid rgba(0,0,0,0.18)', bgcolor: '#fff', minWidth: 150 }}>
        {options.map((o) => <option key={o.value} value={o.value} style={{ fontFamily: o.value }}>{o.label}</option>)}
      </Box>
    </Box>
  );
}

/** Non-functional RSVP mock for the preview - mirrors the editorial public form. */
function PreviewRsvp({ themeCfg }: { themeCfg?: InvitationTheme | null }) {
  const t = resolveTheme(themeCfg);
  return (
    <Box sx={{ opacity: 0.9, pointerEvents: 'none' }}>
      <Stack spacing={3}>
        <Stack direction="row" sx={{ '& > div': { flex: 1, textAlign: 'center', py: 1, fontFamily: t.bodyFont, fontSize: 14, color: t.muted, border: `1px solid ${t.line}` } }}>
          <Box sx={{ color: `${t.ink} !important`, borderBottom: `2px solid ${t.accent} !important`, fontWeight: 600 }}>מגיע/ה</Box>
          <Box>אולי</Box>
          <Box>לא מגיע/ה</Box>
        </Stack>
        {['שם מלא', 'טלפון', 'מספר אורחים'].map((l) => (
          <Box key={l} sx={{ borderBottom: `1px solid ${t.line}`, pb: 0.5 }}>
            <Typography sx={{ fontFamily: t.bodyFont, fontSize: 12, color: t.accentText }}>{l}</Typography>
          </Box>
        ))}
        <Box sx={{ mt: 1, py: 1.4, textAlign: 'center', border: `1px solid ${t.accent}`, color: t.ink, fontFamily: t.bodyFont, letterSpacing: 3, fontWeight: 500 }}>שליחת אישור</Box>
      </Stack>
    </Box>
  );
}

/** Visual gallery card. Design templates get a mini PAGE SKELETON of their
 *  layout (two columns / medallion / arch / glass...), so the choice is about
 *  structure, not just a color chip. */
function TemplateCard({ tpl, coupleNames, active, compact, onClick }: {
  tpl: InvitationTemplate; coupleNames: string; active: boolean; compact?: boolean; onClick: () => void;
}) {
  const th: any = tpl.config.theme || {};
  const layoutKey: string = th.layout || 'editorial';
  const spec = LAYOUTS.find((l) => l.key === layoutKey);
  const bg = th.bg || '#f5efe6';
  const ink = th.ink || '#2b2622';
  const accent = th.accent || '#95836b';
  const line = (w: string | number, h = 3, c = ink, o = 0.5) => (
    <Box sx={{ width: w, height: h, bgcolor: c, opacity: o, borderRadius: 1, mx: 'auto' }} />
  );

  const skeleton = (() => {
    switch (layoutKey) {
      case 'classic':
        return (
          <Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.9 }}>
            <Box sx={{ position: 'absolute', inset: 7, border: `1px solid ${accent}`, outline: `1px solid ${accent}55`, outlineOffset: 2, pointerEvents: 'none' }} />
            <Box sx={{ width: 34, height: 44, borderRadius: '50% / 40%', border: `1.5px solid ${accent}`, bgcolor: `${accent}33` }} />
            <Typography sx={{ fontFamily: th.titleFont, color: ink, fontSize: '0.8rem', lineHeight: 1 }}>{coupleNames || 'שם ושם'}</Typography>
            {line(46, 1.5, accent, 0.7)}
            {line(30, 1.5, accent, 0.4)}
          </Box>
        );
      case 'minimal':
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.4 }}>
            <Typography sx={{ fontFamily: th.titleFont, color: ink, fontSize: '1.05rem', fontWeight: 300, letterSpacing: 1, lineHeight: 1 }}>{coupleNames || 'שם ושם'}</Typography>
            {line(28, 1, ink, 0.4)}
            {line(52, 2, ink, 0.14)}
          </Box>
        );
      case 'luxury':
        return (
          <Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.9 }}>
            {[{ top: 6, right: 6, borderTop: `1.5px solid ${accent}`, borderRight: `1.5px solid ${accent}` },
              { top: 6, left: 6, borderTop: `1.5px solid ${accent}`, borderLeft: `1.5px solid ${accent}` },
              { bottom: 6, right: 6, borderBottom: `1.5px solid ${accent}`, borderRight: `1.5px solid ${accent}` },
              { bottom: 6, left: 6, borderBottom: `1.5px solid ${accent}`, borderLeft: `1.5px solid ${accent}` }].map((sx, i) => (
              <Box key={i} sx={{ position: 'absolute', width: 13, height: 13, ...sx }} />
            ))}
            <Box sx={{ width: 32, height: 42, borderRadius: '16px 16px 2px 2px', border: `1.5px solid ${accent}`, bgcolor: `${accent}22` }} />
            <Typography sx={{ fontFamily: th.titleFont, color: ink, fontSize: '0.78rem', letterSpacing: 1, lineHeight: 1 }}>{coupleNames || 'שם ושם'}</Typography>
            <Box sx={{ width: 40, height: 2, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
          </Box>
        );
      case 'floral':
        return (
          <Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.9 }}>
            {[0, 1].map((i) => (
              <Typography key={i} sx={{ position: 'absolute', color: accent, opacity: 0.55, fontSize: 13, top: i === 0 ? 4 : undefined, bottom: i === 1 ? 2 : undefined, right: i === 0 ? 6 : undefined, left: i === 1 ? 6 : undefined }}>✿</Typography>
            ))}
            <Box sx={{ width: 36, height: 36, borderRadius: 2.5, border: `1.5px solid ${accent}`, bgcolor: `${accent}26` }} />
            <Typography sx={{ fontFamily: th.titleFont, color: ink, fontSize: '0.8rem', lineHeight: 1 }}>{coupleNames || 'שם ושם'}</Typography>
            <Typography sx={{ color: accent, fontSize: 9, lineHeight: 1 }}>❀ ─ ❀</Typography>
          </Box>
        );
      case 'night':
        return (
          <Box sx={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `radial-gradient(circle at 30% 20%, ${accent}33, transparent 60%), linear-gradient(180deg, #171a28, #0c0e16)` }}>
            <Box sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)', backdropFilter: 'blur(2px)', textAlign: 'center' }}>
              <Typography sx={{ fontFamily: th.titleFont, color: '#fff', fontSize: '0.78rem', lineHeight: 1.1, textShadow: `0 0 10px ${accent}` }}>{coupleNames || 'שם ושם'}</Typography>
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: accent, boxShadow: `0 0 8px 1px ${accent}`, mx: 'auto', mt: 0.75 }} />
            </Box>
          </Box>
        );
      case 'editorial':
        return (
          <Box sx={{ height: '100%', display: 'flex', gap: 0.75, p: 1 }}>
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.8 }}>
              <Typography sx={{ fontFamily: th.titleFont, color: ink, fontSize: '0.72rem', lineHeight: 1.05, textAlign: 'center' }}>{coupleNames || 'שם ושם'}</Typography>
              {line('60%', 1.5, accent, 0.7)}
              {line('42%', 1.5, ink, 0.25)}
              {line('50%', 1.5, ink, 0.25)}
            </Box>
            <Box sx={{ flex: 1, borderRadius: 1, bgcolor: `${accent}44`, border: `1px solid ${accent}55` }} />
          </Box>
        );
      default:
        // Palette swatch (no layout) - the classic mini-invite chip.
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75, px: 1.5, textAlign: 'center' }}>
            <Box sx={{ width: 22, height: 2, bgcolor: accent, opacity: 0.9 }} />
            <Typography sx={{ fontFamily: th.titleFont || '"Frank Ruhl Libre", serif', color: ink, fontSize: '1.05rem', lineHeight: 1.15 }}>
              {coupleNames || 'ההזמנה שלכם'}
            </Typography>
            <Typography sx={{ fontFamily: th.bodyFont || '"Assistant", sans-serif', color: accent, fontSize: '0.62rem', letterSpacing: 2 }}>
              SAVE THE DATE
            </Typography>
            <Box sx={{ width: 22, height: 2, bgcolor: accent, opacity: 0.9 }} />
          </Box>
        );
    }
  })();

  return (
    <Box onClick={onClick}
      sx={{ cursor: 'pointer', borderRadius: 3, overflow: 'hidden', border: '2px solid', borderColor: active ? BRAND : 'transparent', boxShadow: '0 2px 10px rgba(16,24,40,0.08)', transition: 'transform .15s, box-shadow .15s', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 8px 22px rgba(16,24,40,0.16)' } }}>
      <Box sx={{ bgcolor: bg, height: compact ? 118 : 148 }}>{skeleton}</Box>
      <Box sx={{ px: 1.25, py: 0.85, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.82rem' }}>{tpl.label}</Typography>
          {tpl.trending && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, px: 0.75, py: 0.15, borderRadius: 99, bgcolor: alpha(BRAND, 0.12), color: BRAND, fontSize: '0.62rem', fontWeight: 800 }}>
              <AutoAwesomeRoundedIcon sx={{ fontSize: 11 }} /> טרנד
            </Box>
          )}
        </Box>
        {spec && !compact && (
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.25, lineHeight: 1.3 }}>{spec.description}</Typography>
        )}
      </Box>
    </Box>
  );
}
