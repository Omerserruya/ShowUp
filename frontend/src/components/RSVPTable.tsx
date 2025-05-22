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
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';

interface Guest {
  _id: string;
  eventId: string;
  name: string;
  phone: string;
  group?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'imported' | 'whatsapp';
  note?: string;
  reminderSentAt?: Date;
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
  confirmed: '#2e7d32',
  declined: '#c62828',
  maybe: '#1976d2',
};

const statusLabels = {
  pending: 'ממתין',
  confirmed: 'אישר',
  declined: 'ביטל',
  maybe: 'אולי',
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
const Resizer = styled('div')({
  position: 'absolute',
  right: 0,
  top: 0,
  height: '100%',
  width: '5px',
  background: 'rgba(0, 0, 0, 0.1)',
  cursor: 'col-resize',
  opacity: 0,
  transition: 'opacity 0.3s',
  '&:hover, &.isResizing': {
    opacity: 1,
    background: 'rgba(0, 0, 0, 0.2)',
  }
});

export default function RSVPTable({ guests, loading = false }: RSVPTableProps) {
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
    { id: 'name', label: 'שם', width: 200 },
    { id: 'group', label: 'קבוצה', width: 200 },
    { id: 'status', label: 'סטטוס', width: 150 },
    { id: 'note', label: 'הערות', width: 300 },
  ]);

  // State for tracking resizing
  const [resizing, setResizing] = useState<{
    columnIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const filteredGuests = guests.filter((guest) => {
    const matchesSearch = guest.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (guest.group && guest.group.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = statusFilter === 'all' || guest.status === statusFilter;

    return matchesSearch && matchesStatus;
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
    <Box sx={{ width: '100%', mx: 'auto', px: 2 }}>
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          placeholder="חיפוש לפי שם או קבוצה..."
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
        />
      </Box>
      
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer sx={{ maxHeight: 600, width: '100%', overflow: 'auto' }}>
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
                      align="right"
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                        {column.label}
                        {column.id === 'status' && (
                          <IconButton
                            size="small"
                            onClick={handleFilterClick}
                            sx={{ p: 0.5 }}
                          >
                            <FilterListIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
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
                  filteredGuests
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
                            {column.id === 'status' ? (
                              <Chip
                                label={statusLabels[guest.status]}
                                sx={{
                                  backgroundColor: `${statusColors[guest.status]}20`,
                                  color: statusColors[guest.status],
                                  fontWeight: 500,
                                  minWidth: 80,
                                }}
                              />
                            ) : column.id === 'note' ? (
                              editingNoteId === guest._id ? (
                                <TextField
                                  fullWidth
                                  size="small"
                                  value={editedNote}
                                  onChange={(e) => setEditedNote(e.target.value)}
                                  onKeyDown={(e) => handleNoteKeyPress(e, guest._id)}
                                  onBlur={() => handleNoteSave(guest._id)}
                                  autoFocus
                                />
                              ) : (
                                <Typography 
                                  onClick={() => handleNoteClick(guest)}
                                  sx={{ cursor: 'pointer' }}
                                >
                                  {guest.note || '-'}
                                </Typography>
                              )
                            ) : (
                              String(guest[column.id as keyof Guest] || '-')
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
        <MenuItem onClick={() => handleStatusFilter('pending')}>ממתין</MenuItem>
        <MenuItem onClick={() => handleStatusFilter('confirmed')}>אישר</MenuItem>
        <MenuItem onClick={() => handleStatusFilter('declined')}>ביטל</MenuItem>
        <MenuItem onClick={() => handleStatusFilter('maybe')}>אולי</MenuItem>
      </Menu>
    </Box>
  );
} 