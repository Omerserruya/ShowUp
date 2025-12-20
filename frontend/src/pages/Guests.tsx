import React, { useState } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Grid,
  Divider,
  useTheme,
  useMediaQuery,
  InputAdornment,
  Card,
  CardContent,
  Avatar,
  LinearProgress,
  alpha,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox
} from '@mui/material';
import {
  Add as AddIcon,
  Upload as UploadIcon,
  FileDownload as FileDownloadIcon,
  WhatsApp as WhatsAppIcon,
  Search as SearchIcon,
  People as PeopleIcon,
  AccessTime as AccessTimeIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  Note as NoteIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  TableChart as TableChartIcon
} from '@mui/icons-material';

// Types
interface Guest {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  group: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'whatsapp' | 'excel';
  note?: string;
  confirmedCount: number; // Number of people confirmed (including the guest)
}

// Mock data
const mockGuests: Guest[] = [
  { _id: '1', name: 'דני כהן', phone: '050-1234567', email: 'danny.cohen@gmail.com', group: 'משפחת כהן', status: 'confirmed', source: 'manual', note: 'אלרגי לבוטנים', confirmedCount: 3 },
  { _id: '2', name: 'שירה לוי', phone: '052-9876543', email: 'shira.levi@gmail.com', group: 'חברים', status: 'confirmed', source: 'whatsapp', confirmedCount: 2 },
  { _id: '3', name: 'יוסי מזרחי', phone: '054-5551234', email: 'yossi.m@gmail.com', group: 'משפחת כהן', status: 'pending', source: 'excel', note: 'צריך אישור נוסף', confirmedCount: 0 },
  { _id: '4', name: 'מיכל אברהם', phone: '053-7778899', email: 'michal.a@gmail.com', group: 'חברים', status: 'declined', source: 'manual', note: 'לא יכול להגיע', confirmedCount: 0 },
  { _id: '5', name: 'אבי ישראלי', phone: '050-3334455', email: 'avi.israeli@gmail.com', group: 'משפחת כהן', status: 'confirmed', source: 'whatsapp', note: 'יבוא עם בן/בת זוג', confirmedCount: 4 },
  { _id: '6', name: 'שרה כהן', phone: '052-7654321', email: 'sara.cohen@gmail.com', group: 'חברים', status: 'pending', source: 'whatsapp', confirmedCount: 0 },
  { _id: '7', name: 'רחל אברהם', phone: '053-4567890', email: 'rachel.a@gmail.com', group: 'חברים', status: 'maybe', source: 'manual', confirmedCount: 1 },
  { _id: '8', name: 'יעקב יעקובי', phone: '050-1112233', email: 'yaakov.y@gmail.com', group: 'משפחת כהן', status: 'confirmed', source: 'excel', confirmedCount: 2 },
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
  confirmed: 'מאשר הגעה',
  declined: 'לא מגיע',
  maybe: 'אולי'
} as const;

// Capacity constant
const EVENT_CAPACITY = 200;

function Guests() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // State
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage] = useState(25);

  // Calculate statistics
  const totalGuests = mockGuests.length;
  const confirmedGuests = mockGuests.filter(g => g.status === 'confirmed').length;
  const pendingGuests = mockGuests.filter(g => g.status === 'pending').length;
  const totalConfirmedCount = mockGuests
    .filter(g => g.status === 'confirmed')
    .reduce((sum, g) => sum + g.confirmedCount, 0);

  // Filtered guests
  const filteredGuests = mockGuests.filter(guest => {
    const matchesSearch = guest.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         guest.phone.includes(searchQuery) ||
                         (guest.email && guest.email.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'all' 
      ? true 
      : statusFilter === 'withNotes' 
        ? !!guest.note 
        : guest.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <Box>
      {/* Top Section - Full Width White Background */}
      <Box
        sx={{
          backgroundColor: 'white',
          width: '100%',
          py: 3,
          px: { xs: 2, sm: 3, md: 4 }
        }}
      >
        {/* Summary Statistics - Pastel cards */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={4}>
            <Paper
              sx={{
                p: { xs: 1.5, sm: 2.5 },
                backgroundColor: alpha('#90caf9', 0.2),
                borderRadius: 3,
                boxShadow: 'none',
                border: '1px solid',
                borderColor: alpha('#1976d2', 0.2),
                position: 'relative',
                minHeight: { xs: 70, sm: 100 }
              }}
            >
              <Typography 
                variant="h3"
                sx={{ 
                  fontWeight: 'bold', 
                  color: '#1565c0',
                  position: 'absolute',
                  top: { xs: 12, sm: 16 },
                  left: { xs: 12, sm: 16 },
                  fontSize: { xs: '1.5rem', sm: '2.5rem' }
                }}
              >
                {totalGuests}
              </Typography>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: { xs: 8, sm: 16 },
                  right: { xs: 8, sm: 16 },
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: 'row'
                }}
              >
                <Typography 
                  variant="body2" 
                  sx={{ 
                    color: '#1565c0',
                    fontWeight: 500,
                    fontSize: { xs: '0.65rem', sm: '0.875rem' },
                    lineHeight: 1.2
                  }}
                >
                  סך הכל
                </Typography>
                <PeopleIcon sx={{ color: '#1565c0', fontSize: { xs: 16, sm: 24 } }} />
              </Box>
            </Paper>
          </Grid>
          <Grid item xs={4}>
            <Paper
              sx={{
                p: { xs: 1.5, sm: 2.5 },
                backgroundColor: alpha('#fff59d', 0.3),
                borderRadius: 3,
                boxShadow: 'none',
                border: '1px solid',
                borderColor: alpha('#f57c00', 0.2),
                position: 'relative',
                minHeight: { xs: 80, sm: 100 }
              }}
            >
              <Typography 
                variant="h3"
                sx={{ 
                  fontWeight: 'bold', 
                  color: '#e65100',
                  position: 'absolute',
                  top: { xs: 12, sm: 16 },
                  left: { xs: 12, sm: 16 },
                  fontSize: { xs: '1.5rem', sm: '2.5rem' }
                }}
              >
                {pendingGuests}
              </Typography>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: { xs: 8, sm: 16 },
                  right: { xs: 8, sm: 16 },
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: 'row'
                }}
              >
                <Typography 
                  variant="body2" 
                  sx={{ 
                    color: '#e65100',
                    fontWeight: 500,
                    fontSize: { xs: '0.65rem', sm: '0.875rem' },
                    lineHeight: 1.2
                  }}
                >
                  ממתינים
                </Typography>
                <AccessTimeIcon sx={{ color: '#e65100', fontSize: { xs: 16, sm: 24 } }} />
              </Box>
            </Paper>
          </Grid>
          <Grid item xs={4}>
            <Paper
              sx={{
                p: { xs: 1.5, sm: 2.5 },
                backgroundColor: alpha('#a5d6a7', 0.3),
                borderRadius: 3,
                boxShadow: 'none',
                border: '1px solid',
                borderColor: alpha('#2e7d32', 0.2),
                position: 'relative',
                minHeight: { xs: 70, sm: 100 }
              }}
            >
              <Typography 
                variant="h3"
                sx={{ 
                  fontWeight: 'bold', 
                  color: '#2e7d32',
                  position: 'absolute',
                  top: 16,
                  left: 16
                }}
              >
                {confirmedGuests}
              </Typography>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 16,
                  right: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexDirection: { xs: 'column', sm: 'row' }
                }}
              >
                <Typography 
                  variant="body2" 
                  sx={{ 
                    color: '#2e7d32',
                    fontWeight: 500,
                    fontSize: { xs: '0.75rem', sm: '0.875rem' }
                  }}
                >
                  מאשרים הגעה
                </Typography>
                <CheckCircleIcon sx={{ color: '#2e7d32', fontSize: { xs: 20, sm: 24 } }} />
              </Box>
            </Paper>
          </Grid>
        </Grid>

        {/* Capacity Section */}
        <Box
          sx={{
            p: { xs: 2, sm: 2.5 },
            mb: 3,
            borderRadius: 2,
            backgroundColor: alpha(theme.palette.grey[100], 0.5)
          }}
        >
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            mb: 1.5,
            flexDirection: 'row',
            gap: 2
          }}>
            <Typography variant="body1" sx={{ fontWeight: 600, fontSize: { xs: '1rem', sm: '1.25rem' } }}>
              {EVENT_CAPACITY} / {totalConfirmedCount}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
              קיבולת: {EVENT_CAPACITY} אורחים
      </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={(totalConfirmedCount / EVENT_CAPACITY) * 100}
            sx={{
              height: 8,
              borderRadius: 4,
              backgroundColor: alpha(theme.palette.grey[300], 0.3),
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
                backgroundColor: '#2e7d32'
              }
            }}
          />
        </Box>

        {/* Action Buttons */}
        <Grid container spacing={2} sx={{ mb: 0 }}>
          <Grid item xs={4}>
          <Button
              variant="outlined"
            onClick={() => setGuestModalOpen(true)}
              fullWidth
              sx={{ 
                borderRadius: 3,
                backgroundColor: 'white',
                color: '#000000',
                fontWeight: 500,
                py: { xs: 1, sm: 1.5 },
                px: { xs: 0.5, sm: 1 },
                border: '1px solid #e0e0e0',
                boxShadow: 'none',
                textTransform: 'none',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: { xs: '0.7rem', sm: '1rem' },
                '&:hover': {
                  backgroundColor: '#fafafa',
                  border: '1px solid #d0d0d0'
                }
              }}
            >
              <Box sx={{ flex: 1, textAlign: 'center' }}>
                + הוסף אורח
              </Box>
              <Box
                sx={{
                  backgroundColor: alpha('#1976d2', 0.2),
                  borderRadius: 1.5,
                  p: { xs: 0.5, sm: 0.75 },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: { xs: 28, sm: 36 },
                  height: { xs: 28, sm: 36 },
                  ml: { xs: 0.5, sm: 1 }
                }}
              >
                <AddIcon sx={{ color: '#1976d2', fontSize: { xs: 16, sm: 20 } }} />
              </Box>
          </Button>
          </Grid>
          <Grid item xs={4}>
          <Button
            variant="outlined"
            onClick={() => setImportModalOpen(true)}
              fullWidth
              sx={{ 
                borderRadius: 3,
                backgroundColor: 'white',
                color: '#000000',
                fontWeight: 500,
                py: { xs: 1, sm: 1.5 },
                px: { xs: 0.5, sm: 1 },
                border: '1px solid #e0e0e0',
                boxShadow: 'none',
                textTransform: 'none',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: { xs: '0.7rem', sm: '1rem' },
                '&:hover': {
                  backgroundColor: '#fafafa',
                  border: '1px solid #d0d0d0'
                }
              }}
            >
              <Box sx={{ flex: 1, textAlign: 'center' }}>
                ייבא מאקסל
              </Box>
              <Box
                sx={{
                  backgroundColor: '#f5f5dc',
                  borderRadius: 1.5,
                  p: { xs: 0.5, sm: 0.75 },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: { xs: 28, sm: 36 },
                  height: { xs: 28, sm: 36 },
                  ml: { xs: 0.5, sm: 1 }
                }}
              >
                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                  <TableChartIcon sx={{ color: '#ff9800', fontSize: { xs: 16, sm: 20 } }} />
                  <UploadIcon 
                    sx={{ 
                      color: '#ff9800', 
                      fontSize: { xs: 9, sm: 12 },
                      position: 'absolute',
                      bottom: -1,
                      right: -1
                    }} 
                  />
                </Box>
              </Box>
          </Button>
          </Grid>
          <Grid item xs={4}>
          <Button
            variant="outlined"
            onClick={() => {/* TODO: Implement export to Excel */}}
              fullWidth
              sx={{ 
                borderRadius: 3,
                backgroundColor: 'white',
                color: '#000000',
                fontWeight: 500,
                py: { xs: 1, sm: 1.5 },
                px: { xs: 0.5, sm: 1 },
                border: '1px solid #e0e0e0',
                boxShadow: 'none',
                textTransform: 'none',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: { xs: '0.7rem', sm: '1rem' },
                '&:hover': {
                  backgroundColor: '#fafafa',
                  border: '1px solid #d0d0d0'
                }
              }}
            >
              <Box sx={{ flex: 1, textAlign: 'center' }}>
                ייצא לאקסל
              </Box>
              <Box
                sx={{
                  backgroundColor: '#e1bee7',
                  borderRadius: 1.5,
                  p: { xs: 0.5, sm: 0.75 },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: { xs: 28, sm: 36 },
                  height: { xs: 28, sm: 36 },
                  ml: { xs: 0.5, sm: 1 }
                }}
              >
                <TableChartIcon sx={{ color: '#9c27b0', fontSize: { xs: 16, sm: 20 } }} />
              </Box>
            </Button>
          </Grid>
        </Grid>
      </Box>

      {/* Content Section */}
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {/* Desktop Table View */}
        {!isMobile ? (
        <Paper 
          sx={{ 
            borderRadius: 2,
            backgroundColor: 'white',
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider',
            borderWidth: '1px',
            overflow: 'hidden',
            p: 3
          }}
        >
          {/* Quick Filter Buttons */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <Button
              onClick={() => {
                setStatusFilter('all');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'all' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'all' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'all' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              הכל
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('confirmed');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'confirmed' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'confirmed' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'confirmed' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              אישרו
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('pending');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'pending' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'pending' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'pending' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              ממתינים
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('declined');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'declined' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'declined' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'declined' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              דחו
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('withNotes');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 120,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'withNotes' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'withNotes' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'withNotes' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              עם הערות
            </Button>
          </Stack>

          {/* Search Bar */}
        <TextField
          fullWidth
            placeholder="חיפוש אורח..."
          variant="outlined"
          value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
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
          <TableContainer
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden'
            }}
          >
            <Table 
              sx={{ 
                borderCollapse: 'separate', 
                borderSpacing: 0
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" sx={{ backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>
                    <Checkbox />
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>שם מלא</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>טלפון</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>סטטוס</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>כמות אורחים סה״כ</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>פעולות</TableCell>
                </TableRow>
              </TableHead>
          <TableBody>
                {filteredGuests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ backgroundColor: 'white', borderBottom: 'none' }}>
                      <Typography variant="body1" color="text.secondary" sx={{ py: 4 }}>
                        {searchQuery ? 'לא נמצאו תוצאות' : 'אין מוזמנים'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGuests
                    .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                    .map((guest, index) => (
                    <TableRow 
                      key={guest._id} 
                      hover 
                      sx={{ 
                        backgroundColor: 'white',
                        borderBottom: index < Math.min(rowsPerPage, filteredGuests.length - page * rowsPerPage) - 1 ? '1px solid' : 'none',
                        borderBottomColor: 'divider'
                      }}
                    >
                      <TableCell padding="checkbox" sx={{ backgroundColor: 'white' }}>
                        <Checkbox />
                      </TableCell>
                      <TableCell align="right" sx={{ backgroundColor: 'white', textAlign: 'right' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexDirection: 'row-reverse', width: '100%' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500,width:"100%", textAlign: 'right' }}>
                            {guest.name}
                          </Typography>
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              bgcolor: statusColors[guest.status],
                              fontSize: '0.875rem'
                            }}
                          >
                            {guest.name.charAt(0)}
                          </Avatar>
                          
                        </Box>
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}>
                          <WhatsAppIcon sx={{ fontSize: 18, color: '#25D366' }} />
                          <Typography variant="body2">{guest.phone}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                          <Chip
                            icon={guest.status === 'confirmed' ? <CheckCircleIcon /> : 
                                  guest.status === 'declined' ? <CancelIcon /> : 
                                  <AccessTimeIcon />}
                            label={statusLabels[guest.status]}
                            size="small"
                            sx={{
                              backgroundColor: alpha(statusColors[guest.status], 0.1),
                              color: statusColors[guest.status],
                              fontWeight: 500,
                              '& .MuiChip-icon': {
                                color: statusColors[guest.status]
                              }
                            }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        {guest.status === 'confirmed' && guest.confirmedCount > 0 ? (
                          <Typography variant="body2" sx={{ fontWeight: 500, color: 'success.main' }}>
                            {guest.confirmedCount}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          <IconButton size="small" sx={{ color: '#25D366' }}>
                            <WhatsAppIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small">
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" sx={{ color: 'error.main' }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </TableCell>
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
        </Paper>
      ) : (
        /* Mobile Card View */
        <Paper 
          sx={{ 
            borderRadius: 2,
            backgroundColor: 'white',
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider',
            borderWidth: '1px',
            overflow: 'hidden',
            p: 3
          }}
        >
          {/* Quick Filter Buttons */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <Button
              onClick={() => {
                setStatusFilter('all');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'all' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'all' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'all' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              הכל
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('confirmed');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'confirmed' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'confirmed' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'confirmed' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              אישרו
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('pending');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'pending' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'pending' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'pending' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              ממתינים
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('declined');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'declined' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'declined' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'declined' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              דחו
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('withNotes');
                setPage(0);
              }}
              sx={{ 
                borderRadius: 3,
                minWidth: 120,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'withNotes' ? '#5236F7' : '#F2F3F5',
                color: statusFilter === 'withNotes' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'withNotes' ? '#5236F7' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              עם הערות
            </Button>
          </Stack>

          {/* Search Bar */}
          <TextField
            fullWidth
            placeholder="חיפוש אורח..."
            variant="outlined"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
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

          <Grid container spacing={2}>
            {filteredGuests.length === 0 ? (
              <Grid item xs={12}>
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="body1" color="text.secondary">
                    {searchQuery ? 'לא נמצאו תוצאות' : 'אין מוזמנים'}
                  </Typography>
                </Box>
              </Grid>
            ) : (
              filteredGuests
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((guest) => (
              <Grid item xs={12} key={guest._id}>
                <Card
                  sx={{
                    borderRadius: 3,
                    '&:hover': {
                      boxShadow: theme.shadows[2]
                    }
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <IconButton size="small">
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                      <Avatar
                        sx={{
                          width: 48,
                          height: 48,
                          bgcolor: statusColors[guest.status]
                        }}
                      >
                        {guest.name.charAt(0)}
                      </Avatar>
                    </Box>
                    
                    <Typography variant="h6" sx={{ mb: 1, fontWeight: 600, textAlign: 'right' }}>
                      {guest.name}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, justifyContent: 'flex-end' }}>
                      <WhatsAppIcon sx={{ fontSize: 18, color: '#25D366' }} />
                      <Typography variant="body2" color="text.secondary">
                        {guest.phone}
                      </Typography>
                    </Box>
                    
                    {guest.confirmedCount > 0 && guest.status === 'confirmed' && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5, justifyContent: 'flex-end' }}>
                        <PeopleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2" color="text.secondary">
                          +{guest.confirmedCount - 1} מלווים
                        </Typography>
                      </Box>
                    )}
                    
                    <Chip
                      icon={guest.status === 'confirmed' ? <CheckCircleIcon /> : 
                            guest.status === 'declined' ? <CancelIcon /> : 
                            <AccessTimeIcon />}
                      label={statusLabels[guest.status]}
                      sx={{
                        backgroundColor: alpha(statusColors[guest.status], 0.1),
                        color: statusColors[guest.status],
                        fontWeight: 500,
                        mb: 1.5,
                        width: '100%',
                        justifyContent: 'flex-start',
                        '& .MuiChip-icon': {
                          color: statusColors[guest.status]
                        }
                      }}
                    />
                    
                    {guest.note && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, textAlign: 'right' }}>
                        {guest.note}
                      </Typography>
                    )}
                    
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right' }}>
                      {guest.status === 'pending' ? 'נשלח היום' : 
                       guest.status === 'confirmed' ? 'לפני 2 שעות' : 'אתמול'}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', gap: 1, mt: 2, justifyContent: 'flex-end' }}>
                      <IconButton size="small" sx={{ color: '#25D366' }}>
                        <WhatsAppIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" sx={{ color: 'error.main' }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))
          )}
        </Grid>

        {/* Pagination */}
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          p: 2,
          mt: 2,
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
      </Paper>
      )}
      </Box>

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