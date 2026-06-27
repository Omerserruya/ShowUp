import * as React from 'react';
import ResponsiveDialog from './ResponsiveDialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { fetchWithAuth } from '../utils/fetchWithAuth';

export interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

interface TagPickerDialogProps {
  open: boolean;
  eventId: string;
  selectedCount: number;
  onClose: () => void;
  /** Called with the chosen tag; parent assigns it to the selected guests. */
  onPick: (tag: Tag) => void;
}

export default function TagPickerDialog({ open, eventId, selectedCount, onClose, onPick }: TagPickerDialogProps) {
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !eventId) return;
    setLoading(true);
    setError(null);
    fetchWithAuth(`/api/events/${eventId}/tags`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setTags(Array.isArray(data) ? data : []))
      .catch(() => setError('שגיאה בטעינת התגיות'))
      .finally(() => setLoading(false));
  }, [open, eventId]);

  const createTag = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/events/${eventId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        if (res.status === 409) throw new Error('כבר קיימת תגית בשם הזה');
        throw new Error('שגיאה ביצירת התגית');
      }
      const tag: Tag = await res.json();
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      onPick(tag);
    } catch (e: any) {
      setError(e.message || 'שגיאה ביצירת התגית');
    } finally {
      setCreating(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="xs" fullWidth dir="rtl">
      <DialogTitle>תיוג {selectedCount} אורחים</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : tags.length > 0 ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                בחרו תגית קיימת:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {tags.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    onClick={() => onPick(t)}
                    sx={{
                      cursor: 'pointer',
                      bgcolor: t.color ? `${t.color}22` : undefined,
                      borderColor: t.color || undefined,
                    }}
                    variant="outlined"
                  />
                ))}
              </Box>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              עדיין אין תגיות. צרו אחת חדשה:
            </Typography>
          )}

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              size="small"
              fullWidth
              label="תגית חדשה"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createTag();
                }
              }}
            />
            <Button
              variant="contained"
              onClick={createTag}
              disabled={creating || !newName.trim()}
              startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <AddRoundedIcon />}
              sx={{ whiteSpace: 'nowrap' }}
            >
              צור ותייג
            </Button>
          </Box>

          {error && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>סגור</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
