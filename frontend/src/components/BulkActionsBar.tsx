import * as React from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Slide from '@mui/material/Slide';
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

interface BulkActionsBarProps {
  count: number;
  busy?: boolean;
  onTag: () => void;
  onMoveGroup: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/**
 * Floating action bar shown when one or more guests are selected.
 * Sits above the mobile bottom-nav so it never overlaps it.
 */
export default function BulkActionsBar({ count, busy, onTag, onMoveGroup, onDelete, onClear }: BulkActionsBarProps) {
  return (
    <Slide direction="up" in={count > 0} mountOnEnter unmountOnExit>
      <Paper
        elevation={8}
        sx={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: { xs: 88, md: 24 },
          zIndex: (theme) => theme.zIndex.appBar + 2,
          width: 'calc(100% - 24px)',
          maxWidth: 560,
          borderRadius: 4,
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
        dir="rtl"
      >
        <IconButton size="small" onClick={onClear} aria-label="נקה בחירה" disabled={busy}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap', mr: 0.5 }}>
          {count} נבחרו
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto' }}>
          <Button
            size="small"
            startIcon={<LocalOfferRoundedIcon />}
            onClick={onTag}
            disabled={busy}
            sx={{ whiteSpace: 'nowrap' }}
          >
            תייג
          </Button>
          <Button
            size="small"
            startIcon={<GroupsRoundedIcon />}
            onClick={onMoveGroup}
            disabled={busy}
            sx={{ whiteSpace: 'nowrap' }}
          >
            העבר לקבוצה
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineRoundedIcon />}
            onClick={onDelete}
            disabled={busy}
            sx={{ whiteSpace: 'nowrap' }}
          >
            מחק
          </Button>
        </Box>
      </Paper>
    </Slide>
  );
}
