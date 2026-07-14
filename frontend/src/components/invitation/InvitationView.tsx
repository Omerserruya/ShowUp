import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, Popover, Stack, useMediaQuery, useTheme } from '@mui/material';
import { InvitationConfig, InvitationData, DEFAULT_INVITATION, formatLocation } from './types';
import { resolveTheme } from './theme';

/* ------------------------------------------------------------------ *
 * Editorial invitation - a two-column art-directed magazine.
 *
 *   RIGHT  a full-height photograph that stays pinned while you read,
 *          with the names + date set over it like a magazine cover.
 *   LEFT   a quiet storytelling column that scrolls, one editorial block
 *          at a time.
 *
 * `embedded`   render inside the studio frame (container-relative heights).
 * `forceLayout` override the media query for the device toggle.
 * `edit`       turn on in-place editing - per-widget hover chrome (drag,
 *              move, settings, show/hide), inline text editing, theme, and a
 *              clear photo drop-zone. None of it renders on the public page.
 * ------------------------------------------------------------------ */

const EDIT_ON = '#2f6bff';
const EDIT_HOVER = 'rgba(47,107,255,0.5)';

/** The movable content blocks of the left column, in default order. */
export const CONTENT_BLOCKS = ['personal', 'details', 'countdown', 'rsvp'] as const;
export type BlockId = typeof CONTENT_BLOCKS[number];

/** Controller the studio passes in to drive in-place editing. */
export interface EditCtl {
  onCommit: (key: string, value: string) => void;
  pickImage: () => void;
  removeImage: () => void;
  dropImage: (file: File) => void;
  order: string[];
  move: (id: string, dir: -1 | 1) => void;
  reorder: (fromId: string, toId: string) => void;
  isHidden: (id: string) => boolean;
  setHidden: (id: string, hidden: boolean) => void;
  toggleDetail: (key: 'showDate' | 'showTime' | 'showLocation') => void;
  details: { showDate: boolean; showTime: boolean; showLocation: boolean };
}

function hebDate(iso?: string | null) {
  if (!iso) return { date: '', time: '', weekday: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '', weekday: '' };
  return {
    date: d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }),
    time: d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    weekday: d.toLocaleDateString('he-IL', { weekday: 'long' }),
  };
}

const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
);

/** Fade + gentle rise as a block enters the viewport. Disabled while editing. */
function Reveal({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(!!disabled);
  useEffect(() => {
    if (disabled) { setShown(true); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled]);
  return (
    <Box ref={ref} sx={{
      opacity: shown ? 1 : 0,
      transform: shown ? 'translateY(0)' : 'translateY(28px)',
      transition: 'opacity 1.1s cubic-bezier(.22,.61,.36,1), transform 1.1s cubic-bezier(.22,.61,.36,1)',
      willChange: 'opacity, transform',
    }}>
      {children}
    </Box>
  );
}

/** Editable text - plain Typography, or click-to-edit with a blue outline. */
function ET({ edit, k, value, placeholder, sx, multiline }: {
  edit?: EditCtl; k: string; value: string; placeholder?: string; sx?: any; multiline?: boolean;
}) {
  if (!edit) return <Typography sx={sx}>{value}</Typography>;
  return (
    <Typography
      contentEditable suppressContentEditableWarning dir="rtl"
      data-ph={placeholder || 'טקסט…'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => { const t = (e.currentTarget.textContent || '').trim(); if (t !== value) edit.onCommit(k, t); }}
      onKeyDown={(e) => { if (!multiline && e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
      sx={{
        ...sx,
        outline: '2px solid transparent', outlineOffset: 6, borderRadius: '3px',
        cursor: 'text', transition: 'outline-color .15s',
        '&:hover': { outlineColor: EDIT_HOVER }, '&:focus': { outlineColor: EDIT_ON },
        '&:empty::before': { content: 'attr(data-ph)', opacity: 0.45 },
      }}
    >
      {value}
    </Typography>
  );
}

/** Small square toolbar button used in the per-widget hover chrome. */
function ToolBtn({ title, onClick, draggable, onDragStart, onDragEnd, children }: {
  title: string; onClick?: (e: React.MouseEvent<HTMLElement>) => void; draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; children: React.ReactNode;
}) {
  return (
    <Box
      component="button" title={title} onClick={onClick}
      draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
      sx={{
        width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', borderRadius: 1.5, bgcolor: '#fff', color: '#2b2f3a',
        boxShadow: '0 2px 8px rgba(16,24,40,0.18)', cursor: draggable ? 'grab' : 'pointer',
        fontSize: 15, lineHeight: 1, p: 0, '&:hover': { bgcolor: EDIT_ON, color: '#fff' },
      }}
    >
      {children}
    </Box>
  );
}

interface Props {
  data: InvitationData;
  rsvpSlot?: React.ReactNode;
  forceOpen?: boolean;
  embedded?: boolean;
  forceLayout?: 'desktop' | 'mobile';
  edit?: EditCtl;
}

export default function InvitationView({ data, rsvpSlot, embedded, forceLayout, edit }: Props) {
  const theme = useTheme();
  const mq = useMediaQuery(theme.breakpoints.up('md'));
  const isDesktop = forceLayout ? forceLayout === 'desktop' : mq;
  const VH = embedded ? '100cqh' : '100vh';
  const cfg: InvitationConfig = { ...DEFAULT_INVITATION, ...(data.invitation || {}) };
  const t = resolveTheme(cfg.theme);

  const { date, time, weekday } = hebDate(data.event_date);
  const loc = formatLocation(data.location);
  const imageUrl = cfg.hero?.imageUrl || '';
  const couple = (data.inviters && data.inviters.length
    ? data.inviters.map((i) => `${i.fn} ${i.ln}`.trim()).join(' & ')
    : data.name) || '';
  const names = cfg.hero?.bigText || couple;
  const overline = cfg.envelope?.envelopeText || 'הזמנה';

  const daysUntil = useMemo(() => {
    if (!data.event_date) return null;
    const ts = new Date(data.event_date).getTime();
    if (isNaN(ts)) return null;
    return Math.ceil((ts - Date.now()) / 86400000);
  }, [data.event_date]);

  // The two highest-intent guest actions besides RSVP: navigate there, save the date.
  const wazeUrl = loc ? `https://waze.com/ul?q=${encodeURIComponent(loc)}&navigate=yes` : '';
  const gmapsUrl = loc ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}` : '';
  const calendarUrl = useMemo(() => {
    if (!data.event_date) return '';
    const d = new Date(data.event_date);
    if (isNaN(d.getTime())) return '';
    const fmt = (x: Date) => x.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const end = new Date(d.getTime() + 5 * 3600000);
    const title = data.name || names || 'אירוע';
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(d)}/${fmt(end)}${loc ? `&location=${encodeURIComponent(loc)}` : ''}`;
  }, [data.event_date, data.name, names, loc]);
  const rsvpOn = cfg.rsvpEnabled !== false;

  // ---- editor-only UI state (harmless when not editing) ----
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [photoDrop, setPhotoDrop] = useState(false);

  // Resolve the block order, tolerating stale/missing ids.
  const order: string[] = useMemo(() => {
    const base = (edit?.order?.length ? edit.order : cfg.order?.length ? cfg.order : CONTENT_BLOCKS) as string[];
    const known = base.filter((id) => (CONTENT_BLOCKS as readonly string[]).includes(id));
    return [...known, ...CONTENT_BLOCKS.filter((id) => !known.includes(id))];
  }, [edit?.order, cfg.order]);

  const detailsVis = { showDate: cfg.details?.showDate !== false, showTime: cfg.details?.showTime !== false, showLocation: cfg.details?.showLocation !== false };
  const blockHidden = (id: string) => (edit ? edit.isHidden(id) : (id === 'rsvp' ? !rsvpOn : (cfg.hidden || []).includes(id)));
  const available = (id: string): boolean => {
    if (id === 'personal') return !!edit || !!cfg.personalText;
    if (id === 'details') return !!(date || time || loc);
    if (id === 'countdown') return daysUntil !== null && daysUntil >= 0;
    if (id === 'rsvp') return !!rsvpSlot;
    return false;
  };

  // ---- render helpers (plain functions → inlined, no remount) ----

  // Editable UI label: uses cfg.labels[key] if set, else the default; inline
  // editable (blue outline) in edit mode.
  const L = (key: string, fallback: string) => (cfg.labels?.[key] ?? fallback);
  // Hebrew glyphs are not designed for wide tracking - keep letterSpacing subtle,
  // and set label text in the ink-blended accent so it clears contrast for older guests.
  const overlineEl = (key: string, fallback: string) => (
    <ET edit={edit} k={key} value={L(key, fallback)} placeholder={fallback}
      sx={{ fontFamily: t.bodyFont, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: t.accentText, mb: 4 }} />
  );

  const ornament = (mark = '✦') => (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2.5, my: { xs: 4, md: 5 } }}>
      <Box sx={{ width: 44, height: '1px', bgcolor: t.line }} />
      <Box sx={{ color: t.accent, fontSize: 13, letterSpacing: 2 }}>{mark}</Box>
      <Box sx={{ width: 44, height: '1px', bgcolor: t.line }} />
    </Box>
  );

  const detailLine = (labelKey: string, labelFb: string, value: string, opts?: { links?: { label: string; href: string }[]; visKey?: 'showDate' | 'showTime' | 'showLocation'; visible?: boolean }) => (
    <Box sx={{ opacity: edit && opts?.visible === false ? 0.4 : 1, transition: 'opacity .2s' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.25, mb: 1.25 }}>
        <ET edit={edit} k={labelKey} value={L(labelKey, labelFb)} placeholder={labelFb}
          sx={{ fontFamily: t.bodyFont, fontSize: 14, letterSpacing: 1, color: t.accentText }} />
        {edit && opts?.visKey && (
          <Box component="button" onClick={() => edit.toggleDetail(opts.visKey!)}
            title={opts.visible ? 'מוצג - לחצו להסתרה' : 'מוסתר - לחצו להצגה'}
            sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.5, border: `1px solid ${opts.visible ? EDIT_ON : 'rgba(43,38,34,0.3)'}`, color: opts.visible ? EDIT_ON : t.muted, bgcolor: opts.visible ? 'rgba(47,107,255,0.08)' : 'transparent', borderRadius: 99, px: 1, py: 0.25, fontFamily: t.bodyFont, fontSize: 11, lineHeight: 1 }}>
            <EyeIcon off={!opts.visible} />
          </Box>
        )}
      </Box>
      <Typography sx={{ fontFamily: t.titleFont, fontWeight: 400, fontSize: { xs: 22, md: 26 }, lineHeight: 1.4, color: t.ink }}>{value}</Typography>
      {!edit && !!opts?.links?.length && (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3.5, mt: 2 }}>
          {opts.links.map((lnk) => (
            <Box key={lnk.label} component="a" href={lnk.href} target="_blank" rel="noopener noreferrer"
              sx={{ display: 'inline-block', fontFamily: t.bodyFont, fontSize: 14, letterSpacing: 0.5, color: t.ink, textDecoration: 'none', borderBottom: `1px solid ${t.accent}`, pb: '3px', py: 0.5, transition: 'opacity .4s ease', '&:hover': { opacity: 0.6 } }}>
              {lnk.label} ←
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );

  const blockInner = (id: string): React.ReactNode => {
    switch (id) {
      case 'personal':
        return (<>
          {overlineEl('personal_over', 'מילה אישית')}
          <ET edit={edit} k="personalText" value={cfg.personalText || ''} multiline placeholder="כמה מילים חמות למוזמנים…"
            sx={{ fontFamily: t.titleFont, fontWeight: 300, fontSize: { xs: 22, md: 27 }, lineHeight: 2, color: t.ink, whiteSpace: 'pre-wrap' }} />
        </>);
      case 'details':
        return (<>
          {overlineEl('details_over', 'מתי והיכן')}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {date && (edit || detailsVis.showDate) && detailLine('detail_date', 'התאריך', [weekday, date].filter(Boolean).join(', '), {
              links: calendarUrl ? [{ label: L('detail_cal', 'הוספה ליומן'), href: calendarUrl }] : [],
              visKey: 'showDate', visible: detailsVis.showDate,
            })}
            {time && (edit || detailsVis.showTime) && detailLine('detail_time', 'השעה', time, { visKey: 'showTime', visible: detailsVis.showTime })}
            {loc && (edit || detailsVis.showLocation) && detailLine('detail_loc', 'המקום', loc, {
              links: [
                ...(wazeUrl ? [{ label: 'Waze', href: wazeUrl }] : []),
                ...(gmapsUrl ? [{ label: 'Google Maps', href: gmapsUrl }] : []),
              ],
              visKey: 'showLocation', visible: detailsVis.showLocation,
            })}
          </Box>
        </>);
      case 'countdown':
        return (<>
          {overlineEl('countdown_over', 'הספירה לאחור')}
          <Typography sx={{ fontFamily: t.titleFont, fontWeight: 300, fontSize: { xs: 84, md: 120 }, lineHeight: 1, color: t.ink }}>{daysUntil}</Typography>
          {(() => {
            const k = daysUntil === 0 ? 'countdown_today' : daysUntil === 1 ? 'countdown_one' : 'countdown_label';
            const fb = daysUntil === 0 ? 'היום חוגגים' : daysUntil === 1 ? 'עוד יום אחד' : 'ימים עד לאירוע';
            return <ET edit={edit} k={k} value={L(k, fb)} placeholder={fb}
              sx={{ fontFamily: t.bodyFont, mt: 2, fontSize: 15, letterSpacing: 1, color: t.muted }} />;
          })()}
        </>);
      case 'rsvp':
        return (<>
          {overlineEl('rsvp_over', 'אישור הגעה')}
          <ET edit={edit} k="rsvp_title" value={L('rsvp_title', 'נשמח לחגוג יחד')} placeholder="נשמח לחגוג יחד"
            sx={{ fontFamily: t.titleFont, fontWeight: 300, fontSize: { xs: 30, md: 40 }, lineHeight: 1.2, color: t.ink, mb: 5 }} />
          <Box sx={{ textAlign: 'right' }}>{rsvpSlot}</Box>
        </>);
      default: return null;
    }
  };

  const blockBox = (inner: React.ReactNode, opts: { first?: boolean; last?: boolean; dim?: boolean }) => (
    <Box component="section" sx={{
      position: 'relative', minHeight: isDesktop ? VH : 'auto',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      px: isDesktop ? { md: 10, lg: 12 } : { xs: 4, sm: 8 },
      py: isDesktop ? 14 : 0,
      pt: isDesktop ? undefined : (opts.first ? 12 : 8),
      pb: isDesktop ? undefined : (opts.last ? 12 : 8),
      textAlign: 'center', opacity: opts.dim ? 0.4 : 1, transition: 'opacity .2s',
    }}>
      <Box sx={{ maxWidth: 420, mx: 'auto', width: '100%' }}>{inner}</Box>
    </Box>
  );

  // Wrap a movable block with the editor chrome (hover highlight + toolbar + DnD).
  const chrome = (id: string, node: React.ReactNode) => {
    if (!edit) return node;
    const hidden = edit.isHidden(id);
    return (
      <Box
        onDragOver={(e) => { if (dragId && dragId !== id) { e.preventDefault(); setOverId(id); } }}
        onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== id) edit.reorder(dragId, id); setDragId(null); setOverId(null); }}
        sx={{
          position: 'relative', transition: 'box-shadow .15s',
          boxShadow: overId === id ? `inset 0 0 0 2px ${EDIT_ON}` : 'inset 0 0 0 0 transparent',
          '&:hover': { boxShadow: overId === id ? `inset 0 0 0 2px ${EDIT_ON}` : `inset 0 0 0 1.5px ${EDIT_HOVER}` },
          '&:hover .blk-tools': { opacity: 1, pointerEvents: 'auto' },
        }}
      >
        <Box className="blk-tools" sx={{ position: 'absolute', top: 12, insetInlineStart: 12, zIndex: 6, display: 'flex', gap: 0.75, opacity: 0, pointerEvents: 'none', transition: 'opacity .15s' }}>
          <ToolBtn title="גרירה לשינוי סדר" draggable onDragStart={() => setDragId(id)} onDragEnd={() => { setDragId(null); setOverId(null); }}>⠿</ToolBtn>
          <ToolBtn title="הזזה למעלה" onClick={() => edit.move(id, -1)}>↑</ToolBtn>
          <ToolBtn title="הזזה למטה" onClick={() => edit.move(id, 1)}>↓</ToolBtn>
          <ToolBtn title="הגדרות" onClick={(e) => { setSettingsFor(id); setSettingsAnchor(e.currentTarget); }}>⚙</ToolBtn>
          <ToolBtn title={hidden ? 'הצגה לאורחים' : 'הסתרה מהאורחים'} onClick={() => edit.setHidden(id, !hidden)}><EyeIcon off={hidden} /></ToolBtn>
        </Box>
        {node}
      </Box>
    );
  };

  // Ordered movable blocks (skip unavailable; skip hidden unless editing).
  const rendered = order.filter((id) => available(id) && (edit || !blockHidden(id)));
  const movable = rendered.map((id, i) => {
    const node = blockBox(<Reveal disabled={!!edit}>{blockInner(id)}</Reveal>, {
      first: !isDesktop && i === 0,
      dim: !!edit && blockHidden(id),
    });
    return <React.Fragment key={id}>{chrome(id, node)}</React.Fragment>;
  });

  const welcomeOpener = isDesktop ? blockBox(
    <Reveal disabled={!!edit}>
      <ET edit={edit} k="welcome_over" value={L('welcome_over', 'ברוכים הבאים')} placeholder="ברוכים הבאים"
        sx={{ fontFamily: t.bodyFont, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: t.accentText, mb: 4 }} />
      <ET edit={edit} k="welcome_body" value={L('welcome_body', cfg.personalText ? 'הוזמנתם לחגוג' : 'שמחים להזמין אתכם')} placeholder="שמחים להזמין אתכם"
        sx={{ fontFamily: t.titleFont, fontWeight: 300, fontSize: 30, lineHeight: 1.5, color: t.ink }} />
      {ornament()}
      {date && <Typography sx={{ fontFamily: t.bodyFont, fontSize: 14, letterSpacing: 1, color: t.muted }}>{[weekday, date].filter(Boolean).join(' · ')}</Typography>}
    </Reveal>, { first: true }) : null;

  const footer = blockBox(
    <Reveal disabled={!!edit}>
      {ornament('♥')}
      <Typography sx={{ fontFamily: t.titleFont, fontWeight: 300, fontSize: { xs: 26, md: 34 }, color: t.ink }}>{names}</Typography>
      {date && <Typography sx={{ fontFamily: t.bodyFont, mt: 2.5, fontSize: 14, letterSpacing: 1, color: t.muted }}>{date}</Typography>}
      <ET edit={edit} k="footer_note" value={L('footer_note', 'מחכים לראותכם')} placeholder="מחכים לראותכם"
        sx={{ fontFamily: t.bodyFont, mt: 5, fontSize: 14, letterSpacing: 1, color: t.accentText }} />
    </Reveal>, { last: true });

  // RSVP switched off must not be a silent hole - guests assume the page is broken
  // and message the couple. A quiet line explains, without breaking the composition.
  const rsvpClosedNote = !edit && rsvpSlot && !rsvpOn && (daysUntil === null || daysUntil >= 0) ? blockBox(
    <Reveal>
      <Typography sx={{ fontFamily: t.bodyFont, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: t.accentText, mb: 3 }}>אישור הגעה</Typography>
      <Typography sx={{ fontFamily: t.titleFont, fontWeight: 300, fontSize: { xs: 24, md: 30 }, lineHeight: 1.5, color: t.ink }}>
        אישורי ההגעה נסגרו - נתראה באירוע
      </Typography>
    </Reveal>, {}) : null;

  const story = (<>{welcomeOpener}{movable}{rsvpClosedNote}{footer}</>);

  // The photograph - cover title, edit controls, and a clear drop-zone.
  const photo = (mobile?: boolean) => (
    <Box
      onDragOver={edit ? (e) => { e.preventDefault(); setPhotoDrop(true); } : undefined}
      onDragLeave={edit ? () => setPhotoDrop(false) : undefined}
      onDrop={edit ? (e) => { e.preventDefault(); setPhotoDrop(false); const f = e.dataTransfer.files?.[0]; if (f && f.type.startsWith('image/')) edit.dropImage(f); } : undefined}
      sx={{ position: 'relative', width: '100%', height: VH, overflow: 'hidden', bgcolor: '#ded3c2' }}
    >
      {imageUrl ? (
        <Box component="img" src={imageUrl} alt={names} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontFamily: t.titleFont, fontSize: 96, color: 'rgba(43,38,34,0.18)' }}>{(names || '♥').trim().charAt(0)}</Typography>
        </Box>
      )}
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(30,24,18,0.22)' }} />
      <Box sx={{ position: 'absolute', inset: 0, background: mobile ? 'linear-gradient(180deg, rgba(20,15,10,0.28) 0%, rgba(20,15,10,0.1) 45%, rgba(20,15,10,0.5) 100%)' : 'linear-gradient(180deg, rgba(20,15,10,0) 45%, rgba(20,15,10,0.55) 100%)' }} />

      {/* Edit affordances */}
      {edit && !imageUrl && (
        <Box onClick={() => edit.pickImage()} sx={{ position: 'absolute', inset: 24, zIndex: 5, border: `2px dashed ${photoDrop ? EDIT_ON : 'rgba(255,255,255,0.7)'}`, borderRadius: 3, bgcolor: photoDrop ? 'rgba(47,107,255,0.15)' : 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, cursor: 'pointer', color: '#fff', textAlign: 'center', px: 3 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
          <Typography sx={{ fontFamily: t.bodyFont, fontWeight: 600, fontSize: 16 }}>הוספת תמונת רקע</Typography>
          <Typography sx={{ fontFamily: t.bodyFont, fontSize: 13, opacity: 0.85 }}>לחצו לבחירה, או גררו תמונה לכאן</Typography>
        </Box>
      )}
      {edit && imageUrl && (
        <Box sx={{ position: 'absolute', top: 16, insetInlineStart: 16, display: 'flex', gap: 1, zIndex: 5 }}>
          <Box component="button" onClick={() => edit.pickImage()} sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.75, fontFamily: t.bodyFont, fontSize: 12.5, fontWeight: 600, color: '#fff', bgcolor: EDIT_ON, border: 'none', borderRadius: 99, px: 1.75, py: 0.75 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            החלפת תמונה
          </Box>
          <Box component="button" onClick={() => edit.removeImage()} title="הסרת התמונה" sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', fontFamily: t.bodyFont, fontSize: 12.5, color: '#fff', bgcolor: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 99, px: 1.5, py: 0.75 }}>הסרה</Box>
        </Box>
      )}
      {edit && imageUrl && photoDrop && (
        <Box sx={{ position: 'absolute', inset: 16, zIndex: 4, border: `2px dashed ${EDIT_ON}`, borderRadius: 3, bgcolor: 'rgba(47,107,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: t.bodyFont, fontWeight: 600 }}>שחררו כדי להחליף תמונה</Box>
      )}

      <Box dir="rtl" sx={{ position: 'absolute', color: t.onImage, zIndex: 3, ...(mobile ? { inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 4 } : { bottom: 56, right: 56, left: 56, textAlign: 'right' }) }}>
        <ET edit={edit} k="overline" value={overline} placeholder="מילת פתיחה" sx={{ fontFamily: t.bodyFont, fontSize: 14, fontWeight: 600, letterSpacing: 1.5, color: 'rgba(255,255,255,0.9)', mb: mobile ? 3 : 2 }} />
        <ET edit={edit} k="names" value={names} placeholder={couple || 'שמות'} sx={{ fontFamily: t.titleFont, fontWeight: 400, lineHeight: 1.08, fontSize: mobile ? 'clamp(40px, 13vw, 68px)' : 'clamp(36px, 3.4vw, 56px)', textShadow: '0 2px 40px rgba(0,0,0,0.4)' }} />
        {date && <Typography sx={{ fontFamily: t.bodyFont, mt: mobile ? 3 : 2.5, fontSize: 14.5, letterSpacing: 1, color: 'rgba(255,255,255,0.9)' }}>{[weekday, date].filter(Boolean).join(' · ')}</Typography>}
      </Box>

      {mobile && !edit && (
        <Box sx={{ position: 'absolute', bottom: 34, left: 0, right: 0, textAlign: 'center' }}>
          <Typography sx={{ fontFamily: t.bodyFont, fontSize: 13, letterSpacing: 1, color: 'rgba(255,255,255,0.85)' }}>גללו ↓</Typography>
        </Box>
      )}
    </Box>
  );

  const settingsPopover = edit && (
    <Popover
      open={!!settingsFor} anchorEl={settingsAnchor} onClose={() => setSettingsFor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { direction: 'rtl', p: 2, borderRadius: 3, minWidth: 220 } } }}
    >
      {settingsFor && <SettingsPanel id={settingsFor} edit={edit} detailsVis={detailsVis} />}
    </Popover>
  );

  if (!isDesktop) {
    return (
      <Box sx={{ bgcolor: t.bg, color: t.ink }}>
        {photo(true)}
        {story}
        {settingsPopover}
      </Box>
    );
  }

  return (
    <Box dir="ltr" sx={{ display: 'flex', bgcolor: t.bg, color: t.ink }}>
      <Box dir="rtl" sx={{ width: '50%', minWidth: 0 }}>{story}</Box>
      <Box sx={{ width: '50%' }}>
        <Box sx={{ position: 'sticky', top: 0, height: VH }}>{photo()}</Box>
      </Box>
      {settingsPopover}
    </Box>
  );
}

const BLOCK_LABELS: Record<string, string> = { personal: 'מילה אישית', details: 'מתי והיכן', countdown: 'ספירה לאחור', rsvp: 'אישור הגעה' };

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', py: 0.75 }}>
      <Typography sx={{ fontFamily: '"Assistant", sans-serif', fontSize: 14 }}>{label}</Typography>
      <Box sx={{ width: 40, height: 22, borderRadius: 99, bgcolor: on ? '#2f6bff' : 'rgba(0,0,0,0.18)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
        <Box sx={{ position: 'absolute', top: 2, insetInlineStart: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', bgcolor: '#fff', transition: 'inset-inline-start .2s' }} />
      </Box>
    </Box>
  );
}

function SettingsPanel({ id, edit, detailsVis }: { id: string; edit: EditCtl; detailsVis: { showDate: boolean; showTime: boolean; showLocation: boolean } }) {
  const hidden = edit.isHidden(id);
  return (
    <Stack spacing={0.5}>
      <Typography sx={{ fontFamily: '"Assistant", sans-serif', fontWeight: 800, fontSize: 15, mb: 0.5 }}>{BLOCK_LABELS[id] || 'מקטע'}</Typography>
      <ToggleRow label="מוצג לאורחים" on={!hidden} onClick={() => edit.setHidden(id, hidden)} />
      {id === 'details' && (<>
        <Box sx={{ height: '1px', bgcolor: 'rgba(0,0,0,0.08)', my: 0.5 }} />
        <ToggleRow label="הצגת תאריך" on={detailsVis.showDate} onClick={() => edit.toggleDetail('showDate')} />
        <ToggleRow label="הצגת שעה" on={detailsVis.showTime} onClick={() => edit.toggleDetail('showTime')} />
        <ToggleRow label="הצגת מיקום" on={detailsVis.showLocation} onClick={() => edit.toggleDetail('showLocation')} />
      </>)}
      <Box sx={{ height: '1px', bgcolor: 'rgba(0,0,0,0.08)', my: 0.5 }} />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box component="button" onClick={() => edit.move(id, -1)} sx={{ flex: 1, cursor: 'pointer', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 1.5, py: 0.75, bgcolor: '#fff', fontFamily: '"Assistant", sans-serif', fontSize: 13 }}>↑ למעלה</Box>
        <Box component="button" onClick={() => edit.move(id, 1)} sx={{ flex: 1, cursor: 'pointer', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 1.5, py: 0.75, bgcolor: '#fff', fontFamily: '"Assistant", sans-serif', fontSize: 13 }}>↓ למטה</Box>
      </Box>
    </Stack>
  );
}
