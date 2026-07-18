import React, { useEffect, useState } from 'react';
import { Alert, Box, Snackbar, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { useEvent } from '../contexts/EventContext';
import InvitationStudio from '../components/invitation/studio/InvitationStudio';
import { InvitationConfig, InvitationData, DEFAULT_INVITATION } from '../components/invitation/types';

export default function Invitation() {
  const { selectedEvent } = useEvent();
  const navigate = useNavigate();
  const eventId = selectedEvent?.id;

  const [data, setData] = useState<InvitationData | null>(null);
  const [slug, setSlug] = useState('');
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    fetchWithAuth(`/api/events/${eventId}`)
      .then((r) => r.json())
      .then((ev) => {
        const cfg: InvitationConfig = { ...DEFAULT_INVITATION, ...(ev.invitation || {}) };
        setData({ name: ev.name, event_date: ev.event_date, location: ev.location, event_type: ev.eventType ?? ev.event_type ?? null, inviters: ev.inviters || [], invitation: cfg });
        setSlug(ev.publicSlug || ev.public_slug || '');
        setPublished(!!(ev.invitationPublished ?? ev.invitation_published));
      })
      .catch(() => setError('שגיאה בטעינת ההזמנה'))
      .finally(() => setLoading(false));
  }, [eventId]);

  const saveConfig = async (cfg: any): Promise<boolean> => {
    if (!eventId) return false;
    setSaving(true); setError(null);
    try {
      const r = await fetchWithAuth(`/api/events/${eventId}/invitation`, { method: 'PUT', body: JSON.stringify(cfg) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'שגיאה בשמירה');
      return true;
    } catch (e: any) { setError(e.message); return false; } finally { setSaving(false); }
  };

  const togglePublish = async (cfg: any): Promise<boolean> => {
    if (!eventId) return false;
    setSaving(true); setError(null);
    try {
      await fetchWithAuth(`/api/events/${eventId}/invitation`, { method: 'PUT', body: JSON.stringify(cfg) });
      const r = await fetchWithAuth(`/api/events/${eventId}/invitation/publish`, { method: 'POST', body: JSON.stringify({ published: !published, slug: slug || undefined }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'שגיאה בפרסום');
      const ev = await r.json();
      setSlug(ev.publicSlug || ev.public_slug || '');
      setPublished(!!(ev.invitationPublished ?? ev.invitation_published));
      setToast(!published ? 'ההזמנה פורסמה - הקישור פעיל' : 'ההזמנה הוסרה מפרסום');
      return true;
    } catch (e: any) { setError(e.message); return false; } finally { setSaving(false); }
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      if (!eventId) return null;
      // Client-side pre-checks are UX-only; the server + S3 enforce the real rules.
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
        setToast('סוג קובץ לא נתמך - ניתן להעלות תמונות בלבד');
        return null;
      }
      // The hero IS the invitation cover - upload into its stable slot so a
      // replacement overwrites the old object instead of orphaning it.
      const presign = await fetchWithAuth('/api/uploads/generate-upload-url', {
        method: 'POST',
        body: JSON.stringify({ event_id: eventId, filename: file.name, content_type: file.type, folder: 'invitations', purpose: 'invite_cover' }),
      });
      if (!presign.ok) {
        const d = await presign.json().catch(() => ({} as any));
        setToast(d.detail || 'העלאת התמונה נכשלה');
        return null;
      }
      const { url, fields, object_url, key, max_bytes } = await presign.json();
      if (max_bytes && file.size > max_bytes) {
        setToast(`הקובץ גדול מדי - מקסימום ${Math.round(max_bytes / 1024 / 1024)}MB`);
        return null;
      }
      // Presigned POST: append the signed fields first, then the file (order matters).
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => form.append(k, v as string));
      form.append('file', file);
      const up = await fetch(url, { method: 'POST', body: form });
      if (!up.ok) throw new Error('upload failed');
      // Finalize: prunes the previous cover from storage, cache-busts the URL
      // and updates the event default in one server-side step.
      const fin = await fetchWithAuth('/api/uploads/finalize', {
        method: 'POST',
        body: JSON.stringify({ event_id: eventId, purpose: 'invite_cover', key }),
      });
      if (fin.ok) {
        const { url: finalUrl } = await fin.json();
        return finalUrl;
      }
      return object_url;
    } catch { setToast('העלאת התמונה נכשלה'); return null; }
  };

  const publicUrl = slug ? `${window.location.origin}/i/${slug}` : '';

  if (!eventId) return <Box sx={{ p: 4 }}><Typography>בחר/י אירוע כדי לערוך הזמנה.</Typography></Box>;
  if (loading || !data) return <Box sx={{ p: 4 }}><Typography>טוען…</Typography></Box>;

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ position: 'fixed', top: 12, left: 12, right: 12, zIndex: 1300 }}>{error}</Alert>
      )}
      <InvitationStudio
        data={data}
        saving={saving}
        published={published}
        publicUrl={publicUrl}
        onSaveConfig={saveConfig}
        onTogglePublish={togglePublish}
        uploadImage={uploadImage}
        onExit={() => navigate('/overview')}
      />
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast || ''} />
    </>
  );
}
