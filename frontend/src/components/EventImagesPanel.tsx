import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Stack, Typography, alpha, useTheme } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import { fetchWithAuth } from '../utils/fetchWithAuth';

/**
 * The event's two cover images, each with its own upload slot:
 *
 *   wa_cover     - WhatsApp cover: the header image of Save-the-Date /
 *                  invitation WhatsApp templates (default for every send).
 *   invite_cover - Digital-invitation cover: the hero of the invitation
 *                  landing page / event website.
 *
 * Replacing an image goes through /uploads/finalize, which deletes the old
 * object, keeps the stable logical path, cache-busts the URL and updates every
 * place the image is used. Used in Settings ("תמונות") and in the first-run
 * onboarding dialog.
 */

type Purpose = 'wa_cover' | 'invite_cover';

const SLOTS: Array<{ purpose: Purpose; title: string; desc: string; icon: React.ReactNode }> = [
  {
    purpose: 'wa_cover',
    title: 'תמונת וואטסאפ',
    desc: 'נשלחת בראש הודעות ה-Save the Date וההזמנה בוואטסאפ',
    icon: <WhatsAppIcon sx={{ fontSize: 20 }} />,
  },
  {
    purpose: 'invite_cover',
    title: 'תמונת ההזמנה הדיגיטלית',
    desc: 'התמונה הראשית של דף ההזמנה ואתר האירוע',
    icon: <LanguageRoundedIcon sx={{ fontSize: 20 }} />,
  },
];

async function uploadSlotImage(eventId: string, file: File, purpose: Purpose): Promise<{ url?: string; error?: string }> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    return { error: 'סוג קובץ לא נתמך - ניתן להעלות תמונות בלבד' };
  }
  const presign = await fetchWithAuth('/api/uploads/generate-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, filename: file.name, content_type: file.type, folder: 'invitations', purpose }),
  });
  if (!presign.ok) {
    const d = await presign.json().catch(() => ({} as any));
    return { error: d.detail || 'העלאת התמונה נכשלה' };
  }
  const { url, fields, key, max_bytes } = await presign.json();
  if (max_bytes && file.size > max_bytes) {
    return { error: `הקובץ גדול מדי - מקסימום ${Math.round(max_bytes / 1024 / 1024)}MB` };
  }
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v as string));
  form.append('file', file);
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) return { error: 'העלאת התמונה נכשלה' };
  const fin = await fetchWithAuth('/api/uploads/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, purpose, key }),
  });
  if (!fin.ok) {
    const d = await fin.json().catch(() => ({} as any));
    return { error: d.detail || 'השלמת ההעלאה נכשלה' };
  }
  const { url: finalUrl } = await fin.json();
  return { url: finalUrl };
}

export default function EventImagesPanel({ eventId, onChanged, compact = false }: {
  eventId: string;
  /** Called after a successful replace (e.g. to refresh contexts). */
  onChanged?: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  const [images, setImages] = useState<Record<Purpose, string>>({ wa_cover: '', invite_cover: '' });
  const [busy, setBusy] = useState<Purpose | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetchWithAuth(`/api/events/${eventId}`);
      if (!r.ok) return;
      const ev = await r.json();
      setImages({
        wa_cover: ev.waImageUrl || ev.wa_image_url || '',
        invite_cover: ev.invitation?.hero?.imageUrl || '',
      });
    } catch { /* panel stays empty; uploads still work */ }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const pick = (purpose: Purpose) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(purpose);
      setError('');
      const res = await uploadSlotImage(eventId, file, purpose);
      setBusy(null);
      if (res.error) { setError(res.error); return; }
      setImages((prev) => ({ ...prev, [purpose]: res.url || '' }));
      onChanged?.();
    };
    input.click();
  };

  return (
    <Box>
      {error && <Typography sx={{ color: 'error.main', fontSize: 13, mb: 1.5 }}>{error}</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        {SLOTS.map((slot) => {
          const url = images[slot.purpose];
          const loading = busy === slot.purpose;
          return (
            <Box key={slot.purpose} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}>
              <Box
                onClick={() => !loading && pick(slot.purpose)}
                sx={{
                  position: 'relative', height: compact ? 130 : 168, cursor: 'pointer',
                  bgcolor: alpha(theme.palette.primary.main, 0.05),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  '&:hover .replace-hint': { opacity: 1 },
                }}
              >
                {url ? (
                  <Box component="img" src={url} alt={slot.title} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Stack alignItems="center" spacing={0.75} sx={{ color: 'text.secondary' }}>
                    <PhotoCameraRoundedIcon />
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>לחצו להעלאה</Typography>
                  </Stack>
                )}
                {loading && (
                  <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.6)' }}>
                    <CircularProgress size={26} />
                  </Box>
                )}
                {url && !loading && (
                  <Box className="replace-hint" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(15,18,30,0.45)', opacity: 0, transition: 'opacity .15s' }}>
                    <Button size="small" variant="contained" disableElevation startIcon={<PhotoCameraRoundedIcon sx={{ fontSize: 16 }} />} sx={{ borderRadius: 99, fontWeight: 700, pointerEvents: 'none' }}>
                      החלפת תמונה
                    </Button>
                  </Box>
                )}
              </Box>
              <Box sx={{ px: 1.75, py: 1.25 }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ color: 'primary.main', display: 'flex' }}>{slot.icon}</Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>{slot.title}</Typography>
                </Stack>
                <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.25 }}>{slot.desc}</Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
