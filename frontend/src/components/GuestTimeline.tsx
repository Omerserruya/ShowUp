import * as React from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import HelpRoundedIcon from '@mui/icons-material/HelpRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import { fetchWithAuth } from '../utils/fetchWithAuth';

interface GuestActivity {
  id: string;
  type: string;
  actor_type: string;
  actor_id?: string | null;
  data?: Record<string, any> | null;
  occurred_at: string;
}

// Backend GuestEventType → Hebrew label + icon + color
const TYPE_META: Record<string, { label: string; Icon: React.ElementType; color: string }> = {
  message_sent: { label: 'הודעה נשלחה', Icon: SendRoundedIcon, color: '#6D28D9' },
  message_delivered: { label: 'הודעה נמסרה', Icon: DoneAllRoundedIcon, color: '#2563EB' },
  message_read: { label: 'ההודעה נקראה', Icon: VisibilityRoundedIcon, color: '#2563EB' },
  confirmed: { label: 'אישר/ה הגעה', Icon: CheckCircleRoundedIcon, color: '#16A34A' },
  declined: { label: 'לא מגיע/ה', Icon: CancelRoundedIcon, color: '#DC2626' },
  maybe: { label: 'אולי יגיע/ה', Icon: HelpRoundedIcon, color: '#F59E0B' },
  count_updated: { label: 'עודכן מספר אורחים', Icon: GroupsRoundedIcon, color: '#6D28D9' },
  manual_override: { label: 'עודכן ידנית', Icon: EditRoundedIcon, color: '#6B7280' },
  staff_edit: { label: 'נערך על ידי הצוות', Icon: EditRoundedIcon, color: '#6B7280' },
  ai_action: { label: 'פעולת עוזר חכם', Icon: AutoAwesomeRoundedIcon, color: '#EC4899' },
  tagged: { label: 'תויג/ה', Icon: LocalOfferRoundedIcon, color: '#EC4899' },
  imported: { label: 'נוסף/ה לרשימה', Icon: PersonAddRoundedIcon, color: '#6D28D9' },
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('he-IL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function GuestTimeline({ guestId }: { guestId: string }) {
  const [activities, setActivities] = React.useState<GuestActivity[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchWithAuth(`/api/guests/${guestId}/timeline`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setActivities(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [guestId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
        לא ניתן לטעון את הציר כרגע
      </Typography>
    );
  }

  if (activities.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
        עדיין אין פעילות לאורח/ת זה
      </Typography>
    );
  }

  return (
    <Stack spacing={0} sx={{ position: 'relative', pr: 0.5 }}>
      {activities.map((a, idx) => {
        const meta = TYPE_META[a.type] || {
          label: a.type,
          Icon: EditRoundedIcon,
          color: '#6B7280',
        };
        const Icon = meta.Icon;
        const isLast = idx === activities.length - 1;
        return (
          <Box key={a.id} sx={{ display: 'flex', gap: 1.5, position: 'relative' }}>
            {/* Rail + dot */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: `${meta.color}1A`,
                  color: meta.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon sx={{ fontSize: 18 }} />
              </Box>
              {!isLast && <Box sx={{ width: 2, flexGrow: 1, bgcolor: 'divider', my: 0.5, minHeight: 16 }} />}
            </Box>
            {/* Content */}
            <Box sx={{ pb: isLast ? 0 : 2, pt: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                {meta.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatWhen(a.occurred_at)}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
