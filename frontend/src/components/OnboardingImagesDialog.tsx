import React from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import EventImagesPanel from './EventImagesPanel';

/**
 * First-run onboarding step: right after the event goes live, ask for the two
 * cover images (WhatsApp cover + digital-invitation cover). Both become the
 * event's defaults everywhere; both are replaceable later in Settings → תמונות.
 */
export default function OnboardingImagesDialog({ open, eventId, onClose }: {
  open: boolean;
  eventId: string;
  onClose: () => void;
}) {
  const [uploadedAny, setUploadedAny] = React.useState(false);
  return (
    <Dialog open={open} onClose={onClose} dir="rtl" maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 4 } }}>
      <DialogTitle sx={{ fontWeight: 800 }}>
        עוד רגע והכול מוכן 📸
        <Typography sx={{ fontWeight: 500, fontSize: '0.875rem', color: 'text.secondary', mt: 0.5 }}>
          שתי תמונות עושות את כל ההבדל: אחת תלווה את הודעות הוואטסאפ לאורחים, והשנייה תפתח את דף ההזמנה.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <EventImagesPanel eventId={eventId} onChanged={() => setUploadedAny(true)} />
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            אפשר להחליף את התמונות בכל רגע דרך הגדרות ← תמונות האירוע.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 700, color: 'text.secondary' }}>אחר כך</Button>
        <Button variant="contained" disableElevation onClick={onClose} disabled={!uploadedAny}
          sx={{ borderRadius: 99, px: 3, fontWeight: 700 }}>
          סיימתי 🎉
        </Button>
      </DialogActions>
    </Dialog>
  );
}
