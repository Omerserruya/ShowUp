import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Stack,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  Grid,
  Divider,
  useTheme,
  useMediaQuery,
  InputAdornment,
  TablePagination,
  styled,
  CircularProgress,
  Menu
} from '@mui/material';
import {
  Add as AddIcon,
  Upload as UploadIcon,
  FileDownload as FileDownloadIcon,
  WhatsApp as WhatsAppIcon,
  TableChart as TableChartIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon
} from '@mui/icons-material';

// Types
interface Guest {
  _id: string;
  name: string;
  phone: string;
  group: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'whatsapp' | 'excel';
  note?: string;
  confirmedCount: number; // Number of people confirmed (including the guest)
}

// Mock data
const mockGuests: Guest[] = [
  { _id: '1', name: 'ישראל ישראלי', phone: '050-1234567', group: 'משפחת כהן', status: 'confirmed', source: 'manual', note: 'אלרגי לבוטנים', confirmedCount: 2 },
  { _id: '2', name: 'שרה כהן', phone: '052-7654321', group: 'חברים', status: 'pending', source: 'whatsapp', confirmedCount: 0 },
  { _id: '3', name: 'דוד לוי', phone: '054-9876543', group: 'משפחת כהן', status: 'declined', source: 'excel', note: 'לא יכול להגיע', confirmedCount: 0 },
  { _id: '4', name: 'רחל אברהם', phone: '053-4567890', group: 'חברים', status: 'maybe', source: 'manual', confirmedCount: 1 },
  { _id: '5', name: 'יעקב יעקובי', phone: '050-1112233', group: 'משפחת כהן', status: 'confirmed', source: 'whatsapp', note: 'יבוא עם בן/בת זוג', confirmedCount: 2 },
];

// Status colors
const statusColors = {
  pending: '#f57c00',
  confirmed: '#2e7d32',
  declined: '#c62828',
  maybe: '#1976d2'
} as const;

// Status labels
const statusLabels = {
  pending: 'ממתין',
  confirmed: 'אישר',
  declined: 'ביטל',
  maybe: 'אולי'
} as const;

// Source icons
const sourceIcons = {
  manual: <TableChartIcon fontSize="small" />,
  whatsapp: <WhatsAppIcon fontSize="small" />,
  excel: <TableChartIcon fontSize="small" />
} as const;

// Source labels
const sourceLabels = {
  manual: 'ידני',
  whatsapp: 'וואטסאפ',
  excel: 'אקסל'
} as const;

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

function Guests() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const tableRef = useRef<HTMLTableElement>(null);
  
  // State
  const [selectedGuests, setSelectedGuests] = useState<string[]>([]);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);

  // Column definitions with initial widths
  const [columns, setColumns] = useState([
    { id: 'name', label: 'שם', width: 200 },
    { id: 'phone', label: 'טלפון', width: 150 },
    { id: 'group', label: 'קבוצה', width: 150 },
    { id: 'status', label: 'סטטוס', width: 150 },
    { id: 'confirmedCount', label: 'מספר אישורים', width: 120 },
    { id: 'source', label: 'מקור', width: 100 },
    { id: 'note', label: 'הערה', width: 200 },
    { id: 'actions', label: 'פעולות', width: 100 }
  ]);

  // State for tracking resizing
  const [resizing, setResizing] = useState<{
    columnIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Filtered guests
  const filteredGuests = mockGuests.filter(guest => {
    const matchesSearch = guest.name.includes(searchQuery) || guest.phone.includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || guest.status === statusFilter;
    const matchesGroup = groupFilter === 'all' || guest.group === groupFilter;
    const matchesSource = sourceFilter === 'all' || guest.source === sourceFilter;
    return matchesSearch && matchesStatus && matchesGroup && matchesSource;
  });

  // Pagination
  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Handlers
  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedGuests(filteredGuests.map(guest => guest._id));
    } else {
      setSelectedGuests([]);
    }
  };

  const handleSelectGuest = (guestId: string) => {
    setSelectedGuests(prev => 
      prev.includes(guestId) 
        ? prev.filter(id => id !== guestId)
        : [...prev, guestId]
    );
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

  return (
    <Box sx={{ p: 3 }}>
      {/* Top Toolbar */}
      <Stack 
        direction={{ xs: 'column', sm: 'row' }} 
        spacing={2} 
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 3 }}
      >
        <Typography variant="h4" component="h1">
          Demo Wedding - June 30
      </Typography>
        <Stack direction="row" spacing={3}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setGuestModalOpen(true)}
          >
            הוסף אורח
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setImportModalOpen(true)}
          >
            ייבוא מאקסל / וואטסאפ
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={() => {/* TODO: Implement export to Excel */}}
          >
            ייצוא לאקסל
          </Button>
        </Stack>
      </Stack>

      {/* Search and Filters */}
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          placeholder="חיפוש לפי שם או טלפון..."
          variant="outlined"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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

      {/* Guests Table */}
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
                textAlign: 'right',
                padding: '16px'
              }
            }}>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedGuests.length === filteredGuests.length}
                  indeterminate={selectedGuests.length > 0 && selectedGuests.length < filteredGuests.length}
                  onChange={handleSelectAll}
                />
              </TableCell>
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
                <TableCell colSpan={columns.length + 1} align="center">
                  {searchQuery ? 'לא נמצאו תוצאות' : 'אין מוזמנים'}
                </TableCell>
              </TableRow>
            ) : (
              filteredGuests
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((guest) => (
                  <TableRow 
                    hover 
                    key={guest._id}
                    selected={selectedGuests.includes(guest._id)}
                    sx={{ 
                      '&:last-child td, &:last-child th': { 
                        borderBottom: 0 
                      },
                      '& td': {
                        padding: '16px',
                        borderBottom: '1px solid',
                        borderBottomColor: 'divider'
                      }
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedGuests.includes(guest._id)}
                        onChange={() => handleSelectGuest(guest._id)}
                      />
                    </TableCell>
                    <TableCell>{guest.name}</TableCell>
                    <TableCell>{guest.phone}</TableCell>
                    <TableCell>{guest.group}</TableCell>
                    <TableCell>
                      <Chip
                        label={statusLabels[guest.status]}
                        sx={{
                          backgroundColor: `${statusColors[guest.status]}20`,
                          color: statusColors[guest.status],
                          fontWeight: 500,
                          minWidth: 80,
                          height: 24,
                          '& .MuiChip-label': {
                            px: 1
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      {guest.status === 'confirmed' ? (
                        <Typography
                          sx={{
                            fontWeight: 500,
                            color: 'success.main'
                          }}
                        >
                          {guest.confirmedCount}
                        </Typography>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={sourceLabels[guest.source]}>
                        {sourceIcons[guest.source]}
                      </Tooltip>
                    </TableCell>
                    <TableCell>{guest.note || '-'}</TableCell>
                    <TableCell align="center">
                      <IconButton size="small">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
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

      {/* Status Filter Menu */}
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

      {/* Guest Modal */}
      <Dialog 
        open={guestModalOpen} 
        onClose={() => setGuestModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>הוספת אורח חדש</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="שם"
              required
            />
            <TextField
              fullWidth
              label="טלפון"
              required
            />
            <FormControl fullWidth>
              <InputLabel>קבוצה</InputLabel>
              <Select label="קבוצה">
                <MenuItem value="משפחת כהן">משפחת כהן</MenuItem>
                <MenuItem value="חברים">חברים</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>סטטוס</InputLabel>
              <Select label="סטטוס">
                {Object.entries(statusLabels).map(([value, label]) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="הערה"
              multiline
              rows={3}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGuestModalOpen(false)}>ביטול</Button>
          <Button variant="contained">שמירה</Button>
        </DialogActions>
      </Dialog>

      {/* Import Modal */}
      <Dialog
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>ייבוא אורחים</DialogTitle>
        <DialogContent>
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            sx={{ mb: 2 }}
          >
            <Tab label="העלאת קובץ אקסל" />
            <Tab label="הדבקה ידנית" />
          </Tabs>
          
          {activeTab === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <input
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                id="excel-upload"
                type="file"
              />
              <label htmlFor="excel-upload">
                <Button
                  variant="contained"
                  component="span"
                  startIcon={<UploadIcon />}
                >
                  בחר קובץ אקסל
                </Button>
              </label>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                או גרור קובץ לכאן
              </Typography>
            </Box>
          ) : (
            <TextField
              fullWidth
              multiline
              rows={6}
              placeholder="הדבק כאן את רשימת האורחים (שם, טלפון, קבוצה)"
              sx={{ mt: 2 }}
            />
          )}
          
          <Divider sx={{ my: 3 }} />
          
          <Typography variant="subtitle2" gutterBottom>
            מספר וואטסאפ לייבוא:
        </Typography>
          <Typography variant="body2" color="text.secondary">
            שלח את רשימת אנשי הקשר למספר: +972-50-1234567
        </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportModalOpen(false)}>ביטול</Button>
          <Button variant="contained">ייבוא</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Guests; 