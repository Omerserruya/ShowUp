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
  TablePagination,
  TextField,
  InputAdornment,
  Chip,
  styled,
  CircularProgress,
  Divider,
  Menu,
  MenuItem,
  IconButton,
  Popover,
  Button,
  useTheme,
  alpha,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';

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
  confirmed: '#16a34a', // Dark green for confirmed status
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

const sourceLabels = {
  manual: 'ידני',
  imported: 'יובא',
  whatsapp: 'וואטסאפ',
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
  background: theme.palette.mode === 'dark' 
    ? alpha(theme.palette.common.white, 0.1)
    : 'rgba(0, 0, 0, 0.1)',
  cursor: 'col-resize',
  opacity: 0,
  transition: 'opacity 0.3s',
  '&:hover, &.isResizing': {
    opacity: 1,
    background: theme.palette.mode === 'dark' 
      ? alpha(theme.palette.common.white, 0.2)
      : 'rgba(0, 0, 0, 0.2)',
  }
}));

export default function RSVPTable({ guests, loading = false }: RSVPTableProps) {
  const theme = useTheme();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editedNote, setEditedNote] = useState('');
  const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const tableRef = useRef<HTMLTableElement>(null);

  // Column definitions with initial widths
  const [columns, setColumns] = useState<Column[]>([
    { id: 'name', label: 'שם', width: 200, align: 'right' },
    { id: 'phone', label: 'טלפון', width: 150, align: 'right' },
    { id: 'status', label: 'סטטוס', width: 150, align: 'right' },
    { id: 'confirmedCount', label: 'כמות אורחים', width: 150, align: 'right' },
    { id: 'lastResponse', label: 'תאריך תגובה', width: 150, align: 'right' },
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
    if (!a.lastResponse) return 1; // No response goes to end
    if (!b.lastResponse) return -1; // No response goes to end
    
    const aTime = a.lastResponse instanceof Date 
      ? a.lastResponse.getTime() 
      : new Date(a.lastResponse).getTime();
    const bTime = b.lastResponse instanceof Date 
      ? b.lastResponse.getTime() 
      : new Date(b.lastResponse).getTime();
    
    return bTime - aTime; // Most recent first
  });

  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchorEl(event.currentTarget);
  };

  const handleFilterClose = () => {
    setFilterAnchorEl(null);
  };

  const handleStatusFilter = (status: string) => {
    setStatusFilter(status);
    handleFilterClose();
  };

  const handleNoteClick = (guest: Guest) => {
    setEditingNoteId(guest._id);
    setEditedNote(guest.note || '');
  };

  const handleNoteSave = (guestId: string) => {
    // Here you would typically make an API call to save the note
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

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
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

  return (
    <Box sx={{ width: '100%', mt: 2 }}>
      {/* Search + filter row */}
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          gap: 1.5,
          flexDirection: 'row-reverse',
          alignItems: 'stretch',
        }}
      >
        <TextField
          fullWidth
          placeholder="חיפוש אורח..."
          variant="outlined"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          size="small"
          sx={{
            maxWidth: 360,
            '& .MuiOutlinedInput-root': {
              height: 40,
              borderRadius: 9999,
            },
            '& .MuiOutlinedInput-input': {
              py: 0,
            },
          }}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={<FilterListIcon />}
          onClick={handleFilterClick}
          sx={{
            minWidth: 96,
            height: 40,
            borderRadius: 9999,
            px: 2.5,
          }}
        >
          סינון
        </Button>
      </Box>
      
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer sx={{ width: '100%', overflow: 'auto' }}>
            <Table 
              ref={tableRef}
              stickyHeader 
              aria-label="sticky table" 
              sx={{ borderCollapse: 'separate', borderSpacing: 0 }}
            >
              <TableHead>
                <TableRow sx={{ 
                  '& th': { 
                    backgroundColor: 'background.default', 
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
                    <TableCell colSpan={columns.length} align="center">
                      {searchTerm ? 'לא נמצאו תוצאות' : 'אין מוזמנים'}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedGuests
                    .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                    .map((guest) => (
                      <TableRow 
                        hover 
                        key={guest._id} 
                        sx={{ 
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
                              minWidth: 80 
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
                                    backgroundColor: guest.status === 'confirmed' 
                                      ? (theme.palette.mode === 'dark' 
                                          ? alpha(theme.palette.success.main, 0.2)
                                          : '#dcfce7')
                                      : (theme.palette.mode === 'dark'
                                          ? alpha(statusColors[guest.status] as string, 0.2)
                                          : `${statusColors[guest.status]}20`),
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
          <TablePagination
            sx={{ 
              borderTop: '1px solid',
              borderTopColor: 'divider',
              '.MuiTablePagination-toolbar': {
                paddingLeft: 1
              }
            }}
            rowsPerPageOptions={[5, 10, 25, 50]}
            component="div"
            count={filteredGuests.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            labelRowsPerPage="שורות בעמוד:"
            labelDisplayedRows={({ from, to, count }) => `${from}-${to} מתוך ${count}`}
          />
        </>
      )}

      <Menu
        anchorEl={filterAnchorEl}
        open={Boolean(filterAnchorEl)}
        onClose={handleFilterClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={() => handleStatusFilter('all')}>הכל</MenuItem>
        <MenuItem onClick={() => handleStatusFilter('pending')}>לא ענה</MenuItem>
        <MenuItem onClick={() => handleStatusFilter('confirmed')}>מגיע</MenuItem>
        <MenuItem onClick={() => handleStatusFilter('declined')}>לא מגיע</MenuItem>
        <MenuItem onClick={() => handleStatusFilter('maybe')}>אולי</MenuItem>
      </Menu>
    </Box>
  );
} 