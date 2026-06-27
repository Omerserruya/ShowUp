import * as React from 'react';
import ResponsiveDialog from './ResponsiveDialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import { fetchWithAuth } from '../utils/fetchWithAuth';

interface EventLike {
  id: string;
  name: string;
}

interface CopyGuestsDialogProps {
  open: boolean;
  currentEventId: string;
  /** All of the user's events; the current one is filtered out internally. */
  events: EventLike[];
  onClose: () => void;
  /** Called after a copy run with the number successfully copied. */
  onDone: (copied: number, failed: number) => void;
}

/**
 * Multi-event reuse: copy the guest list (name / phone / group) from another of
 * the user's events into the current event. Statuses are reset to "invited" so
 * the new event starts fresh.
 */
export default function CopyGuestsDialog({ open, currentEventId, events, onClose, onDone }: CopyGuestsDialogProps) {
  const sourceEvents = events.filter((e) => e.id !== currentEventId);
  const [sourceId, setSourceId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);

  React.useEffect(() => {
    if (open) {
      setSourceId('');
      setProgress(null);
    }
  }, [open]);

  const handleCopy = async () => {
    if (!sourceId) return;
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    let copied = 0;
    let failed = 0;
    try {
      const res = await fetchWithAuth(`/api/guests?event_id=${sourceId}`);
      if (!res.ok) throw new Error('failed to load source guests');
      const data = await res.json();
      const list: any[] = Array.isArray(data) ? data : data.guests || data.items || [];
      setProgress({ done: 0, total: list.length });
      for (const g of list) {
        const payload: Record<string, any> = {
          name: g.name,
          phone: g.phone,
          status: 'invited',
        };
        if (g.group) payload.group = g.group;
        if (g.import_count) payload.import_count = g.import_count;
        try {
          const r = await fetchWithAuth(`/api/guests?event_id=${currentEventId}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          if (r.ok) copied++; else failed++;
        } catch {
          failed++;
        }
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    } catch {
      failed++;
    } finally {
      setBusy(false);
      onDone(copied, failed);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth dir="rtl">
      <DialogTitle>העתקת אורחים מאירוע קודם</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            בחרו אירוע שממנו תרצו להעתיק את רשימת האורחים (שם, טלפון וקבוצה). הסטטוסים יתאפסו לאירוע החדש.
          </Typography>
          {sourceEvents.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              אין אירועים נוספים להעתקה.
            </Typography>
          ) : (
            <FormControl fullWidth size="small">
              <InputLabel>אירוע מקור</InputLabel>
              <Select
                value={sourceId}
                label="אירוע מקור"
                onChange={(e) => setSourceId(e.target.value)}
                disabled={busy}
              >
                {sourceEvents.map((e) => (
                  <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {progress && (
            <Stack spacing={0.5}>
              <LinearProgress
                variant={progress.total ? 'determinate' : 'indeterminate'}
                value={progress.total ? (progress.done / progress.total) * 100 : undefined}
              />
              <Typography variant="caption" color="text.secondary">
                {progress.done} / {progress.total} הועתקו
              </Typography>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>ביטול</Button>
        <Button variant="contained" onClick={handleCopy} disabled={busy || !sourceId}>
          העתק אורחים
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
