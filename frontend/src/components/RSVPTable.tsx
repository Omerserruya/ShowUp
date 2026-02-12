import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  InputAdornment,
  Chip,
  styled,
  CircularProgress,
  IconButton,
  Button,
  useTheme,
  alpha,
  type Theme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import { Stack } from '@mui/material';

interface Guest {
  _id: string;
  eventId: string;
  name: string;
  phone: string;
  email?: string;
  group?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'imported' | 'whatsapp';
  note?: string;
  reminderSentAt?: Date;
  confirmedCount?: number;
  lastResponse?: string | Date;
  avatarUrl?: string;
}

interface RSVPTableProps {
  guests: Guest[];
  loading?: boolean;
}

interface Column {
  id: keyof Guest | 'actions';
  label: string;
  width: number;
  align?: 'right' | 'left' | 'center';
}

const statusColors = {
  pending: '#f57c00',
  confirmed: '#16a34a',
  declined: '#c62828',
  maybe: '#1976d2',
};

const statusLabels = {
  pending: 'לא ענה',
  confirmed: 'מגיע',
  declined: 'לא מגיע',
  maybe: 'אולי',
};

const statusIcons = {
  pending: <QuestionAnswerIcon sx={{ fontSize: 16 }} />,
  confirmed: <CheckCircleIcon sx={{ fontSize: 16 }} />,
  declined: <CancelIcon sx={{ fontSize: 16 }} />,
  maybe: <QuestionAnswerIcon sx={{ fontSize: 16 }} />,
};

// Custom styled resizable header cell
const ResizableTableCell = styled(TableCell)<{ width: number }>(({ theme, width }) => ({
  position: 'relative',
  width: width,
  minWidth: 80,
  boxSizing: 'border-box',
  cursor: 'default',
  '&:hover .resizer': {
    opacity: 1,
  }
}));

// Resizer component
const Resizer = styled('div')(({ theme }) => ({
  position: 'absolute',
  right: 0,
  top: 0,
  height: '100%',
  width: '5px',
  background: alpha(theme.palette.text.primary, 0.1),
  cursor: 'col-resize',
  opacity: 0,
  transition: 'opacity 0.3s',
  '&:hover, &.isResizing': {
    opacity: 1,
    background: alpha(theme.palette.text.primary, 0.2),
  }
}));

// Filter button styles helper
const getFilterButtonSx = (isActive: boolean, theme: Theme) => ({
  borderRadius: 3,
  minWidth: 80,
  px: 2,
  py: 1,
  textTransform: 'none' as const,
  fontWeight: 500,
  boxShadow: 'none',
  bgcolor: isActive
    ? theme.palette.primary.main
    : theme.palette.mode === 'dark'
      ? alpha(theme.palette.action.selected, 0.2)
      : theme.palette.grey[100],
  color: isActive
    ? theme.palette.primary.contrastText
    : theme.palette.text.primary,
  '&:hover': {
    bgcolor: isActive
      ? theme.palette.primary.dark
      : theme.palette.mode === 'dark'
        ? alpha(theme.palette.action.selected, 0.3)
        : theme.palette.grey[200],
    boxShadow: 'none',
  },
});

export default function RSVPTable({ guests, loading = false }: RSVPTableProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editedNote, setEditedNote] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage] = useState(25);
  const tableRef = useRef<HTMLTableElement>(null);

  // Column definitions with initial widths
  const [columns, setColumns] = useState<Column[]>([
    { id: 'name', label: 'שם', width: 200, align: 'right' },
    { id: 'phone', label: 'טלפון', width: 150, align: 'right' },
    { id: 'status', label: 'סטטוס', width: 150, align: 'right' },
    { id: 'confirmedCount', label: 'כמות אורחים', width: 150, align: 'right' },
    { id: 'lastResponse', label: 'תאריך תגובה', width: 150, align: 'right' },
    { id: 'note', label: 'הערות', width: 220, align: 'right' },
    { id: 'actions', label: 'פעולות', width: 80, align: 'right' },
  ]);

  // State for tracking resizing
  const [resizing, setResizing] = useState<{
    columnIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const filteredGuests = guests.filter((guest) => {
    const matchesSearch = guest.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      guest.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (guest.email && guest.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (guest.group && guest.group.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || guest.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Ensure guests are always ordered by lastResponse (most recent first)
  const sortedGuests = [...filteredGuests].sort((a, b) => {
    if (!a.lastResponse && !b.lastResponse) return 0;
    if (!a.lastResponse) return 1;
    if (!b.lastResponse) return -1;

    const aTime = a.lastResponse instanceof Date
      ? a.lastResponse.getTime()
      : new Date(a.lastResponse).getTime();
    const bTime = b.lastResponse instanceof Date
      ? b.lastResponse.getTime()
      : new Date(b.lastResponse).getTime();

    return bTime - aTime;
  });

  const handleNoteClick = (guest: Guest) => {
    setEditingNoteId(guest._id);
    setEditedNote(guest.note || '');
  };

  const handleNoteSave = (guestId: string) => {
    console.log('Saving note for guest:', guestId, editedNote);
    setEditingNoteId(null);
  };

  const handleNoteKeyPress = (e: React.KeyboardEvent, guestId: string) => {
    if (e.key === 'Enter') {
      handleNoteSave(guestId);
    } else if (e.key === 'Escape') {
      setEditingNoteId(null);
    }
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  // Column resizing handlers
  const handleResizeStart = useCallback((e: React.MouseEvent, columnIndex: number) => {
    e.preventDefault();
    const column = columns[columnIndex];
    setResizing({
      columnIndex,
      startX: e.clientX,
      startWidth: column.width
    });

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }, [columns]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizing) return;

    const { columnIndex, startX, startWidth } = resizing;
    const newWidth = Math.max(80, startWidth + (e.clientX - startX));

    setColumns(prevColumns =>
      prevColumns.map((col, index) =>
        index === columnIndex ? { ...col, width: newWidth } : col
      )
    );
  }, [resizing]);

  const handleResizeEnd = useCallback(() => {
    setResizing(null);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  }, [handleResizeMove]);

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      if (resizing) {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      }
    };
  }, [resizing, handleResizeMove, handleResizeEnd]);

  const filterButtons = [
    { key: 'all', label: 'הכל' },
    { key: 'confirmed', label: 'אישרו' },
    { key: 'pending', label: 'ממתינים' },
    { key: 'declined', label: 'דחו' },
  ];

  const rowBgColor = isDark ? 'background.paper' : '#ffffff';

  return (
    <Box sx={{ width: '100%', mt: 2 }}>
      {/* Quick Filter Buttons */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        {filterButtons.map((btn) => (
          <Button
            key={btn.key}
            onClick={() => {
              setStatusFilter(btn.key);
              setPage(0);
            }}
            sx={getFilterButtonSx(statusFilter === btn.key, theme)}
          >
            {btn.label}
          </Button>
        ))}
      </Stack>

      {/* Search Bar */}
      <TextField
        fullWidth
        placeholder="חיפוש אורח..."
        variant="outlined"
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setPage(0);
        }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
        size="small"
        sx={{
          mb: 3,
          '& .MuiOutlinedInput-root': {
            borderRadius: 3,
          }
        }}
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer
            sx={{
              width: { xs: 'calc(100% + 8px)', sm: '100%' },
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: { xs: 0, sm: 2 },
              overflow: 'auto',
              mx: { xs: -1, sm: 0 },
            }}
          >
            <Table
              ref={tableRef}
              stickyHeader
              aria-label="sticky table"
              sx={{
                borderCollapse: 'separate',
                borderSpacing: 0
              }}
            >
              <TableHead>
                <TableRow sx={{
                  '& th': {
                    bgcolor: 'background.default',
                    color: 'text.primary',
                    fontWeight: 'bold',
                    borderBottom: '2px solid',
                    borderBottomColor: 'divider',
                    whiteSpace: 'nowrap',
                    textAlign: 'right'
                  }
                }}>
                  {columns.map((column, index) => (
                    <ResizableTableCell
                      key={column.id}
                      width={column.width}
                      align={column.align || 'right'}
                    >
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 'inherit' }}>
                        {column.label}
                      </Typography>
                      <Resizer
                        className={resizing?.columnIndex === index ? 'isResizing' : ''}
                        onMouseDown={(e) => handleResizeStart(e, index)}
                      />
                    </ResizableTableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredGuests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} align="center" sx={{ bgcolor: rowBgColor, borderBottom: 'none' }}>
                      <Typography variant="body1" color="text.secondary" sx={{ py: 4 }}>
                        {searchTerm ? 'לא נמצאו תוצאות' : 'אין מוזמנים'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedGuests
                    .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                    .map((guest, index) => (
                      <TableRow
                        hover
                        key={guest._id}
                        sx={{
                          bgcolor: rowBgColor,
                          borderBottom: index < Math.min(rowsPerPage, filteredGuests.length - page * rowsPerPage) - 1 ? '1px solid' : 'none',
                          borderBottomColor: 'divider',
                          '&:last-child td, &:last-child th': {
                            borderBottom: 0
                          }
                        }}
                      >
                        {columns.map((column) => (
                          <TableCell
                            key={`${guest._id}-${column.id}`}
                            align={column.align || 'right'}
                            sx={{
                              width: column.width,
                              minWidth: 80,
                              bgcolor: rowBgColor,
                            }}
                          >
                            {column.id === 'name' ? (
                              <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'right' }}>
                                {guest.name}
                              </Typography>
                            ) : column.id === 'status' ? (
                              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Chip
                                  icon={statusIcons[guest.status]}
                                  label={statusLabels[guest.status]}
                                  sx={{
                                    bgcolor: alpha(statusColors[guest.status], isDark ? 0.2 : 0.1),
                                    color: statusColors[guest.status],
                                    fontWeight: 500,
                                    minWidth: 100,
                                    height: 28,
                                    '& .MuiChip-icon': {
                                      color: statusColors[guest.status],
                                    },
                                  }}
                                />
                              </Box>
                            ) : column.id === 'confirmedCount' ? (
                              guest.status === 'confirmed' && typeof guest.confirmedCount === 'number' ? (
                                <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'right' }}>
                                  {guest.confirmedCount}
                                </Typography>
                              ) : (
                                <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'right' }}>
                                  -
                                </Typography>
                              )
                            ) : column.id === 'lastResponse' ? (
                              guest.lastResponse ? (
                                <Typography variant="body2" sx={{ textAlign: 'right' }}>
                                  {typeof guest.lastResponse === 'string'
                                    ? guest.lastResponse
                                    : new Date(guest.lastResponse).toLocaleDateString('he-IL')}
                                </Typography>
                              ) : (
                                <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'right' }}>
                                  -
                                </Typography>
                              )
                            ) : column.id === 'note' ? (
                              <Typography
                                variant="body2"
                                sx={{
                                  textAlign: 'right',
                                  color: guest.note ? 'text.primary' : 'text.secondary',
                                  maxWidth: 220,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={guest.note || undefined}
                              >
                                {guest.note && guest.note.trim().length > 0 ? guest.note : '-'}
                              </Typography>
                            ) : column.id === 'actions' ? (
                              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <IconButton size="small">
                                  <MoreVertIcon fontSize="small" />
                                </IconButton>
                              </Box>
                            ) : (
                              <Typography variant="body2" sx={{ textAlign: 'right' }}>
                                {String(guest[column.id as keyof Guest] || '-')}
                              </Typography>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            p: 2,
            borderTop: '1px solid',
            borderColor: 'divider'
          }}>
            <Typography variant="body2" color="text.secondary">
              מציג {page * rowsPerPage + 1}-{Math.min((page + 1) * rowsPerPage, filteredGuests.length)} מתוך {filteredGuests.length}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setPage(page - 1)}
                disabled={page === 0}
                sx={{ borderRadius: 2 }}
              >
                הקודם
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * rowsPerPage >= filteredGuests.length}
                sx={{ borderRadius: 2 }}
              >
                הבא
              </Button>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}