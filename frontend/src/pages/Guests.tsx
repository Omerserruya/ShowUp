import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  CircularProgress,
  Snackbar,
  Alert,
  Autocomplete
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
  TableChart as TableChartIcon,
  ExpandMore as ExpandMoreIcon,
  Warning as WarningIcon,
  Send as SendIcon
} from '@mui/icons-material';
import { useGuests, useOverviewStats } from '../hooks/useOverviewData';
import { useEvent } from '../contexts/EventContext';
import { fetchWithAuth } from '../utils/fetchWithAuth';

// Types
interface Guest {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  group?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'maybe';
  source: 'manual' | 'whatsapp' | 'excel';
  note?: string;
  confirmedCount: number; // Number of people confirmed (including the guest)
  expectedCount?: number; // Expected number of guests
  tableNumber?: number; // Table number
  lastResponse?: Date;
}

// Map API guest to component format
function mapGuestFromAPI(apiGuest: any): Guest {
  const statusMap: Record<string, 'pending' | 'confirmed' | 'declined' | 'maybe'> = {
    'invited': 'pending',
    'pending': 'pending',
    'attending': 'confirmed',
    'confirmed': 'confirmed',
    'declined': 'declined',
    'maybe': 'maybe'
  };

  return {
    _id: apiGuest.id,
    name: apiGuest.name,
    phone: apiGuest.phone,
    email: apiGuest.email,
    group: apiGuest.group || '',
    status: statusMap[apiGuest.status] || 'pending',
    source: 'manual' as const,
    note: apiGuest.notes,
    confirmedCount: apiGuest.guest_count || (apiGuest.status === 'confirmed' || apiGuest.status === 'attending' ? apiGuest.import_count || 1 : 0),
    expectedCount: apiGuest.import_count,
    tableNumber: apiGuest.table_number,
    lastResponse: apiGuest.last_response ? new Date(apiGuest.last_response) : undefined
  };
}

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
  const { selectedEvent } = useEvent();
  const location = useLocation();
  const navigate = useNavigate();
  const tableRef = useRef<HTMLDivElement>(null);
  
  // Initialize statusFilter from URL query parameter
  const getInitialStatusFilter = () => {
    const searchParams = new URLSearchParams(location.search);
    // Support both "filter" and legacy/mistyped "filtering" params
    const filter = searchParams.get('filter') || searchParams.get('filtering');
    if (filter && ['all', 'confirmed', 'declined', 'pending'].includes(filter)) {
      return filter;
    }
    return 'all';
  };

  // State
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(getInitialStatusFilter);
  const [groupFilter, setGroupFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage] = useState(25);
  const [expandedGuests, setExpandedGuests] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [guestNotes, setGuestNotes] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  
  // Editing state
  const [editingGuest, setEditingGuest] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingGuestData, setEditingGuestData] = useState<Guest | null>(null);
  
  // Mobile editing & swipe state
  const [mobileEditingGuest, setMobileEditingGuest] = useState<string | null>(null);
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null);
  const [swipedGuestId, setSwipedGuestId] = useState<string | null>(null);
  
  // Read filter from URL query parameter on mount and when URL changes
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const filter = searchParams.get('filter') || searchParams.get('filtering');
    if (filter && ['all', 'confirmed', 'declined', 'pending'].includes(filter)) {
      // Apply filter from URL
      setStatusFilter(filter);
      setPage(0);
      setRefreshKey(prev => prev + 1);
      // Scroll to table after a short delay to ensure it's rendered
      setTimeout(() => {
        if (tableRef.current) {
          tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
      // Clear filter param from URL so subsequent local filters are not overridden
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, navigate, location.pathname]);

  // Determine if we need to fetch all guests (when filtering by status)
  // If filtering by status (not 'all'), fetch all matching guests without pagination
  const shouldFetchAll = statusFilter !== 'all' && statusFilter !== 'withNotes';
  const pageSizeForFetch = shouldFetchAll ? 200 : rowsPerPage; // Max allowed by API
  const pageForFetch = shouldFetchAll ? 1 : page + 1; // Always page 1 when fetching all
  
  // Fetch guests from API (paginated or all if filtering)
  // Add refreshKey to searchQuery to force refetch when needed, but remove it before API call
  const searchQueryForAPI = searchQuery.replace(/_refresh_\d+$/, ''); // Remove any refresh suffix
  
  const { guests: apiGuests, loading: guestsLoading, error: guestsError, total: totalGuestsFromAPI } = useGuests(
    pageForFetch,
    pageSizeForFetch,
    `${searchQueryForAPI}_refresh_${refreshKey}`, // Add refreshKey to trigger refetch
    'created_at',
    false, // Get all guests, not just with responses
    shouldFetchAll ? statusFilter : undefined // Pass status filter when fetching filtered results (API expects 'confirmed', 'pending', 'declined')
  );

  // Fetch stats from API - only refresh when explicitly needed (not on filter changes)
  const { stats, loading: statsLoading } = useOverviewStats(statsRefreshKey);
  
  // Use total from API when filtering, otherwise use stats.total_guests (number of invitations)
  const totalForDisplay = shouldFetchAll && totalGuestsFromAPI > 0 ? totalGuestsFromAPI : (stats?.total_guests || 0);

  // Map API guests to component format
  const guests = apiGuests.map(mapGuestFromAPI);

  // Calculate statistics from API stats (which now return correct sums)
  const totalGuests = stats?.total_guests || 0; // Count of guest records (number of invitations)
  const totalInvitedPeople = stats?.total || 0; // Sum of import_count (total people invited)
  const confirmedGuests = stats?.approved || 0; // Sum of guest_count (or import_count) for confirmed
  const confirmedPeople = stats?.approved || 0; // Same as confirmedGuests
  const pendingGuests = stats?.pending || 0; // Count of pending guests

  // Get unique groups from guests
  const uniqueGroups = Array.from(new Set(guests.map(guest => guest.group).filter(Boolean))).sort();

  // Filtered guests (client-side filtering only for group and notes, status filtering is done server-side)
  const filteredGuests = guests.filter(guest => {
    // Status filtering is done server-side when statusFilter !== 'all' and !== 'withNotes'
    const matchesStatus = statusFilter === 'all' 
      ? true 
      : statusFilter === 'withNotes' 
        ? !!guest.note 
        : true; // Status already filtered by API when shouldFetchAll is true
    const matchesGroup = groupFilter === 'all' || guest.group === groupFilter;
    return matchesStatus && matchesGroup;
  });

  // Check if any guest has a table number
  const hasTableNumbers = guests.some(guest => guest.tableNumber !== undefined);

  // Update guest status
  const updateGuestStatus = useCallback(async (guestId: string, newStatus: 'pending' | 'confirmed' | 'declined') => {
    const statusMap: Record<string, string> = {
      'pending': 'invited',
      'confirmed': 'attending',
      'declined': 'declined'
    };

    try {
      const response = await fetchWithAuth(`/api/guests/${guestId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: statusMap[newStatus] })
      });

      if (!response.ok) {
        throw new Error('Failed to update guest status');
      }

      setSnackbar({ open: true, message: 'סטטוס עודכן בהצלחה', severity: 'success' });
      // Trigger refresh by updating refreshKey
      setRefreshKey(prev => prev + 1);
      // Also refresh stats since status changed
      setStatsRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Error updating guest status:', error);
      setSnackbar({ open: true, message: 'שגיאה בעדכון הסטטוס', severity: 'error' });
    }
  }, []);

  // Delete guest
  const deleteGuest = useCallback(async (guestId: string) => {
    try {
      const response = await fetchWithAuth(`/api/guests/${guestId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete guest');
      }

      setSnackbar({ open: true, message: 'אורח נמחק בהצלחה', severity: 'success' });
      // Trigger refresh by updating refreshKey
      setRefreshKey(prev => prev + 1);
      // Also refresh stats since guest was deleted
      setStatsRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Error deleting guest:', error);
      setSnackbar({ open: true, message: 'שגיאה במחיקת האורח', severity: 'error' });
    }
  }, []);

  // Update guest note
  const updateGuestNote = useCallback(async (guestId: string, note: string) => {
    try {
      const response = await fetchWithAuth(`/api/guests/${guestId}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: note })
      });

      if (!response.ok) {
        throw new Error('Failed to update guest note');
      }

      setSnackbar({ open: true, message: 'הערה עודכנה בהצלחה', severity: 'success' });
    } catch (error) {
      console.error('Error updating guest note:', error);
      setSnackbar({ open: true, message: 'שגיאה בעדכון ההערה', severity: 'error' });
    }
  }, []);

  // Update guest field (inline editing)
  const updateGuestField = useCallback(async (guestId: string, field: string, value: any) => {
    try {
      // Map frontend field names to API field names
      const fieldMap: Record<string, string> = {
        'name': 'name',
        'phone': 'phone',
        'group': 'group',
        'expectedCount': 'import_count',
        'confirmedCount': 'guest_count',
        'tableNumber': 'table_number',
        'email': 'email'
      };
      
      const apiField = fieldMap[field] || field;
      const apiData: Record<string, any> = { [apiField]: value };
      
      const response = await fetchWithAuth(`/api/guests/${guestId}`, {
        method: 'PUT',
        body: JSON.stringify(apiData)
      });

      if (!response.ok) {
        throw new Error('Failed to update guest');
      }

      setSnackbar({ open: true, message: 'האורח עודכן בהצלחה', severity: 'success' });
      setRefreshKey(prev => prev + 1);
      setStatsRefreshKey(prev => prev + 1);
      setEditingGuest(null);
      setEditingField(null);
    } catch (error) {
      console.error('Error updating guest:', error);
      setSnackbar({ open: true, message: 'שגיאה בעדכון האורח', severity: 'error' });
    }
  }, []);

  // Update guest (full update from modal)
  const updateGuest = useCallback(async (guestId: string, guestData: Partial<Guest>) => {
    try {
      const updateData: Record<string, any> = {};
      
      if (guestData.name !== undefined) updateData.name = guestData.name;
      if (guestData.phone !== undefined) updateData.phone = guestData.phone;
      if (guestData.email !== undefined) updateData.email = guestData.email;
      if (guestData.group !== undefined) updateData.group = guestData.group;
      // Numeric fields – only send valid positive integers (backend enforces ge=1)
      if (guestData.expectedCount !== undefined && guestData.expectedCount !== null) {
        const expected = Number(guestData.expectedCount);
        if (Number.isFinite(expected) && expected >= 1) {
          updateData.import_count = expected;
        }
      }
      if (guestData.confirmedCount !== undefined && guestData.confirmedCount !== null) {
        const confirmed = Number(guestData.confirmedCount);
        if (Number.isFinite(confirmed) && confirmed >= 1) {
          updateData.guest_count = confirmed;
        }
      }
      if (guestData.tableNumber !== undefined) {
        const tableNum = guestData.tableNumber === null ? null : Number(guestData.tableNumber);
        if (tableNum === null) {
          updateData.table_number = null;
        } else if (Number.isFinite(tableNum) && tableNum >= 1) {
          updateData.table_number = tableNum;
        }
      }
      
      const response = await fetchWithAuth(`/api/guests/${guestId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        throw new Error('Failed to update guest');
      }

      setSnackbar({ open: true, message: 'האורח עודכן בהצלחה', severity: 'success' });
      setRefreshKey(prev => prev + 1);
      setStatsRefreshKey(prev => prev + 1);
      setEditModalOpen(false);
      setEditingGuestData(null);
    } catch (error) {
      console.error('Error updating guest:', error);
      setSnackbar({ open: true, message: 'שגיאה בעדכון האורח', severity: 'error' });
    }
  }, []);

  // Show loading state only on initial load, not when filtering
  const isInitialLoad = guestsLoading && apiGuests.length === 0;
  if (isInitialLoad && statsLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Show error state
  if (guestsError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">שגיאה בטעינת האורחים: {guestsError}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Top Section - Full Width White Background */}
      <Box
        sx={{
          backgroundColor: 'white',
          width: '100%',
          py: 3,
          px: { xs: 2, sm: 3, md: 4 }
        }}
      >
        {/* Summary Statistics */}
        {isMobile ? (
          <Paper
            sx={{
              p: 3,
              mb: 3,
              borderRadius: 2,
              background: 'linear-gradient(to left, #faf5ff, #eff6ff)',
              boxShadow: 'none',
              borderRight: '4px solid #5236F7',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'stretch',
                width: '100%',
              }}
            >
              {/* LEFT SIDE – Breakdown */}
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 1.5,
                  pl: 2,
                }}
              >
                {/* Coming */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: '#2e7d32',
                    }}
                  />
                  <Typography sx={{ fontSize: '0.9rem', color: '#111827' }}>
                    {confirmedGuests} מגיעים
                  </Typography>
                </Box>

                {/* Not coming */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: '#c62828',
                    }}
                  />
                  <Typography sx={{ fontSize: '0.9rem', color: '#111827' }}>
                    {stats?.declined || 0} לא מגיעים
                  </Typography>
                </Box>

                {/* No response */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: '#f57c00',
                    }}
                  />
                  <Typography sx={{ fontSize: '0.9rem', color: '#111827' }}>
                    {pendingGuests} ללא מענה
                  </Typography>
                </Box>
              </Box>

              {/* RIGHT SIDE – Total */}
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-end',
                  pr: 2,
                }}
              >
                <Typography
                  sx={{
                    fontSize: '0.9rem',
                    color: '#6b7280',
                    mb: 0.5,
                  }}
                >
                  סה״כ מוזמנים
                </Typography>

                <Typography
                  sx={{
                    fontWeight: 'bold',
                    fontSize: '3rem',
                    lineHeight: 1,
                    color: '#111827',
                  }}
                >
                  {totalInvitedPeople}
                </Typography>
              </Box>
            </Box>
          </Paper>

        ) : (
          /* Desktop: Three separate cards */
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
                  minHeight: { xs: 80, sm: 100 }
                }}
              >                <Box
                  sx={{
                    position: 'absolute',
                    bottom: { xs: 8, sm: 16 },
                    right: { xs: 8, sm: 16 },
                    display: 'flex',
                    alignItems: 'center',
                    gap: { xs: 0.5, sm: 1 },
                    flexDirection: 'row-reverse'
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#1565c0',
                      flexShrink: 0
                    }}
                  />
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
                </Box>
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
                  {totalInvitedPeople}
                </Typography>

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
                    flexDirection: 'row-reverse'
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#e65100',
                      flexShrink: 0
                    }}
                  />
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
                  minHeight: { xs: 80, sm: 100 }
                }}
              >
                <Typography 
                  variant="h3"
                  sx={{ 
                    fontWeight: 'bold', 
                    color: '#2e7d32',
                    position: 'absolute',
                    top: { xs: 12, sm: 16 },
                    left: { xs: 12, sm: 16 },
                    fontSize: { xs: '1.5rem', sm: '2.5rem' }
                  }}
                >
                  {confirmedPeople}
                </Typography>
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: { xs: 8, sm: 16 },
                    right: { xs: 8, sm: 16 },
                    display: 'flex',
                    alignItems: 'center',
                    gap: { xs: 0.5, sm: 1 },
                    flexDirection: 'row-reverse'
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#2e7d32',
                      flexShrink: 0
                    }}
                  />
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      color: '#2e7d32',
                      fontWeight: 500,
                      fontSize: { xs: '0.65rem', sm: '0.875rem' },
                      lineHeight: 1.2
                    }}
                  >
                    מאשרים הגעה
                  </Typography>
                </Box>
              </Paper>
            </Grid>
          </Grid>
        )}

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
              {totalGuests} / {EVENT_CAPACITY}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
              קיבולת: {EVENT_CAPACITY} הזמנות
      </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={EVENT_CAPACITY > 0 ? (totalGuests / EVENT_CAPACITY) * 100 : 0}
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
        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 0 }}>
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
                justifyContent: 'flex-start',
                flexDirection: 'row',
                fontSize: { xs: '0.7rem', sm: '1rem' },
                '&:hover': {
                  backgroundColor: '#fafafa',
                  border: '1px solid #d0d0d0'
                }
              }}
            >
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
                  mr: { xs: 1, sm: 1.5 }
                }}
              >
                <AddIcon sx={{ color: '#1976d2', fontSize: { xs: 16, sm: 20 } }} />
              </Box>
              <Box sx={{ flex: 1, textAlign: 'right', mr: {xs:1, md:2}}}>
                הוסף
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
                justifyContent: 'flex-start',
                flexDirection: 'row',
                fontSize: { xs: '0.7rem', sm: '1rem' },
                '&:hover': {
                  backgroundColor: '#fafafa',
                  border: '1px solid #d0d0d0'
                }
              }}
            >
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
                  mr: { xs: 1, sm: 1.5 }
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
              <Box sx={{ flex: 1, textAlign: 'right', mr: {xs:1, md:2}}}>
                ייבא
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
                justifyContent: 'flex-start',
                flexDirection: 'row',
                fontSize: { xs: '0.7rem', sm: '1rem' },
                '&:hover': {
                  backgroundColor: '#fafafa',
                  border: '1px solid #d0d0d0'
                }
              }}
            >
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
                  mr: { xs: 1, sm: 1.5 }
                }}
              >
                <TableChartIcon sx={{ color: '#9c27b0', fontSize: { xs: 16, sm: 20 } }} />
              </Box>
              <Box sx={{ flex: 1, textAlign: 'right', mr: {xs:1, md:2}}}>
                ייצא
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
            {/* Group Filter */}
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <Select
                value={groupFilter}
                onChange={(e) => {
                  setGroupFilter(e.target.value);
                  setPage(0);
                }}
                displayEmpty
                sx={{
                  borderRadius: 3,
                  minWidth: 120,
                  px: 2,
                  py: 1,
                  backgroundColor: groupFilter === 'all' ? '#F2F3F5' : '#FFFFFF',
                  color: groupFilter === 'all' ? '#363B4D' : '#111827',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'transparent',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'transparent',
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'transparent',
                  },
                  '& .MuiSelect-select': {
                    py: 0,
                    px: 0,
                  },
                }}
              >
                <MenuItem value="all">כל הקבוצות</MenuItem>
                {uniqueGroups.map((group) => (
                  <MenuItem key={group} value={group}>
                    {group}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
            ref={tableRef}
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
                  <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>שם מלא</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>טלפון</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>קבוצה</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>סטטוס</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>כמות אורחים צפויה</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>כמות אורחים שאושרה</TableCell>
                  {hasTableNumbers && (
                    <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>מספר שולחן</TableCell>
                  )}
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>פעולות</TableCell>
                </TableRow>
              </TableHead>
          <TableBody>
            {guestsLoading ? (
              <TableRow>
                <TableCell colSpan={hasTableNumbers ? 8 : 7} align="center" sx={{ backgroundColor: 'white', borderBottom: 'none' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
                    <CircularProgress size={40} />
                  </Box>
                </TableCell>
              </TableRow>
            ) : filteredGuests.length === 0 ? (
              <TableRow>
                    <TableCell colSpan={hasTableNumbers ? 8 : 7} align="center" sx={{ backgroundColor: 'white', borderBottom: 'none' }}>
                      <Typography variant="body1" color="text.secondary" sx={{ py: 4 }}>
                  {searchQuery ? 'לא נמצאו תוצאות' : 'אין מוזמנים'}
                      </Typography>
                </TableCell>
              </TableRow>
                ) : (
                  filteredGuests
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
                      <TableCell align="right" sx={{ backgroundColor: 'white', textAlign: 'right' }}>
                        {editingGuest === guest._id && editingField === 'name' ? (
                          <TextField
                            size="small"
                            value={editValues[`${guest._id}_name`] ?? guest.name}
                            onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_name`]: e.target.value })}
                            onBlur={() => {
                              const newValue = editValues[`${guest._id}_name`];
                              if (newValue && newValue !== guest.name) {
                                updateGuestField(guest._id, 'name', newValue);
                              } else {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const newValue = editValues[`${guest._id}_name`];
                                if (newValue && newValue !== guest.name) {
                                  updateGuestField(guest._id, 'name', newValue);
                                } else {
                                  setEditingGuest(null);
                                  setEditingField(null);
                                }
                              } else if (e.key === 'Escape') {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            autoFocus
                            sx={{ width: '100%' }}
                          />
                        ) : (
                          <Box 
                            sx={{ display: 'flex', alignItems: 'center', gap: 1, flexDirection: 'row-reverse', width: '100%', cursor: 'pointer' }}
                            onDoubleClick={() => {
                              setEditingGuest(guest._id);
                              setEditingField('name');
                              setEditValues({ ...editValues, [`${guest._id}_name`]: guest.name });
                            }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 500, width: "100%", textAlign: 'right' }}>
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
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        {editingGuest === guest._id && editingField === 'phone' ? (
                          <TextField
                            size="small"
                            value={editValues[`${guest._id}_phone`] ?? guest.phone}
                            onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_phone`]: e.target.value })}
                            onBlur={() => {
                              const newValue = editValues[`${guest._id}_phone`];
                              if (newValue && newValue !== guest.phone) {
                                updateGuestField(guest._id, 'phone', newValue);
                              } else {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const newValue = editValues[`${guest._id}_phone`];
                                if (newValue && newValue !== guest.phone) {
                                  updateGuestField(guest._id, 'phone', newValue);
                                } else {
                                  setEditingGuest(null);
                                  setEditingField(null);
                                }
                              } else if (e.key === 'Escape') {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            autoFocus
                            sx={{ width: '100%' }}
                          />
                        ) : (
                          <Typography 
                            variant="body2" 
                            sx={{ cursor: 'pointer' }}
                            onDoubleClick={() => {
                              setEditingGuest(guest._id);
                              setEditingField('phone');
                              setEditValues({ ...editValues, [`${guest._id}_phone`]: guest.phone });
                            }}
                          >
                            {guest.phone}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        {editingGuest === guest._id && editingField === 'group' ? (
                          <Autocomplete
                            freeSolo
                            size="small"
                            options={uniqueGroups}
                            value={editValues[`${guest._id}_group`] ?? guest.group ?? ''}
                            onChange={(event, newValue) => {
                              const value = typeof newValue === 'string' ? newValue : newValue || '';
                              setEditValues({ ...editValues, [`${guest._id}_group`]: value });
                              updateGuestField(guest._id, 'group', value);
                            }}
                            onBlur={() => {
                              const value = editValues[`${guest._id}_group`] ?? guest.group ?? '';
                              if (value !== guest.group) {
                                updateGuestField(guest._id, 'group', value);
                              } else {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            onInputChange={(event, newInputValue) => {
                              setEditValues({ ...editValues, [`${guest._id}_group`]: newInputValue });
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                autoFocus
                                sx={{ width: 150 }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const value = editValues[`${guest._id}_group`] ?? guest.group ?? '';
                                    if (value !== guest.group) {
                                      updateGuestField(guest._id, 'group', value);
                                    } else {
                                      setEditingGuest(null);
                                      setEditingField(null);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setEditingGuest(null);
                                    setEditingField(null);
                                  }
                                }}
                              />
                            )}
                          />
                        ) : (
                          <Typography 
                            variant="body2" 
                            sx={{ cursor: 'pointer' }}
                            onDoubleClick={() => {
                              setEditingGuest(guest._id);
                              setEditingField('group');
                              setEditValues({ ...editValues, [`${guest._id}_group`]: guest.group ?? '' });
                            }}
                          >
                            {guest.group || '-'}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        {editingGuest === guest._id && editingField === 'status' ? (
                          <FormControl size="small" sx={{ minWidth: 120 }}>
                            <Select
                              value={editValues[`${guest._id}_status`] ?? guest.status}
                              onChange={(e) => {
                                const newValue = e.target.value as 'pending' | 'confirmed' | 'declined';
                                updateGuestStatus(guest._id, newValue);
                                setEditingGuest(null);
                                setEditingField(null);
                              }}
                              onBlur={() => {
                                setEditingGuest(null);
                                setEditingField(null);
                              }}
                              autoFocus
                            >
                              <MenuItem value="pending">ממתין</MenuItem>
                              <MenuItem value="confirmed">מאשר הגעה</MenuItem>
                              <MenuItem value="declined">דחה</MenuItem>
                            </Select>
                          </FormControl>
                        ) : (
                          <Box 
                            sx={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }}
                            onClick={() => {
                              setEditingGuest(guest._id);
                              setEditingField('status');
                              setEditValues({ ...editValues, [`${guest._id}_status`]: guest.status });
                            }}
                          >
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
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        {editingGuest === guest._id && editingField === 'expectedCount' ? (
                          <TextField
                            size="small"
                            type="number"
                            value={editValues[`${guest._id}_expectedCount`] ?? guest.expectedCount ?? ''}
                            onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_expectedCount`]: parseInt(e.target.value) || 0 })}
                            onBlur={() => {
                              const newValue = editValues[`${guest._id}_expectedCount`];
                              if (newValue !== undefined && newValue !== guest.expectedCount) {
                                updateGuestField(guest._id, 'expectedCount', newValue);
                              } else {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const newValue = editValues[`${guest._id}_expectedCount`];
                                if (newValue !== undefined && newValue !== guest.expectedCount) {
                                  updateGuestField(guest._id, 'expectedCount', newValue);
                                } else {
                                  setEditingGuest(null);
                                  setEditingField(null);
                                }
                              } else if (e.key === 'Escape') {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            autoFocus
                            sx={{ width: 80 }}
                          />
                        ) : (
                          <Typography 
                            variant="body2" 
                            sx={{ fontWeight: 500, cursor: 'pointer' }}
                            onDoubleClick={() => {
                              setEditingGuest(guest._id);
                              setEditingField('expectedCount');
                              setEditValues({ ...editValues, [`${guest._id}_expectedCount`]: guest.expectedCount ?? 0 });
                            }}
                          >
                            {guest.expectedCount !== undefined ? guest.expectedCount : '-'}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        {editingGuest === guest._id && editingField === 'confirmedCount' ? (
                          <TextField
                            size="small"
                            type="number"
                            value={editValues[`${guest._id}_confirmedCount`] ?? guest.confirmedCount ?? ''}
                            onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_confirmedCount`]: parseInt(e.target.value) || 0 })}
                            onBlur={() => {
                              const newValue = editValues[`${guest._id}_confirmedCount`];
                              if (newValue !== undefined && newValue !== guest.confirmedCount) {
                                updateGuestField(guest._id, 'confirmedCount', newValue);
                              } else {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const newValue = editValues[`${guest._id}_confirmedCount`];
                                if (newValue !== undefined && newValue !== guest.confirmedCount) {
                                  updateGuestField(guest._id, 'confirmedCount', newValue);
                                } else {
                                  setEditingGuest(null);
                                  setEditingField(null);
                                }
                              } else if (e.key === 'Escape') {
                                setEditingGuest(null);
                                setEditingField(null);
                              }
                            }}
                            autoFocus
                            sx={{ width: 80 }}
                          />
                        ) : (
                          <Typography 
                            variant="body2" 
                            sx={{ fontWeight: 500, color: guest.confirmedCount > 0 ? 'success.main' : 'text.secondary', cursor: 'pointer' }}
                            onDoubleClick={() => {
                              setEditingGuest(guest._id);
                              setEditingField('confirmedCount');
                              setEditValues({ ...editValues, [`${guest._id}_confirmedCount`]: guest.confirmedCount ?? 0 });
                            }}
                          >
                            {guest.confirmedCount > 0 ? guest.confirmedCount : '-'}
                          </Typography>
                        )}
                      </TableCell>
                      {hasTableNumbers && (
                        <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                          {editingGuest === guest._id && editingField === 'tableNumber' ? (
                            <TextField
                              size="small"
                              type="number"
                              value={editValues[`${guest._id}_tableNumber`] ?? guest.tableNumber ?? ''}
                              onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_tableNumber`]: parseInt(e.target.value) || undefined })}
                              onBlur={() => {
                                const newValue = editValues[`${guest._id}_tableNumber`];
                                if (newValue !== guest.tableNumber) {
                                  updateGuestField(guest._id, 'tableNumber', newValue || undefined);
                                } else {
                                  setEditingGuest(null);
                                  setEditingField(null);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const newValue = editValues[`${guest._id}_tableNumber`];
                                  if (newValue !== guest.tableNumber) {
                                    updateGuestField(guest._id, 'tableNumber', newValue || undefined);
                                  } else {
                                    setEditingGuest(null);
                                    setEditingField(null);
                                  }
                                } else if (e.key === 'Escape') {
                                  setEditingGuest(null);
                                  setEditingField(null);
                                }
                              }}
                              autoFocus
                              sx={{ width: 80 }}
                            />
                          ) : (
                            <Typography 
                              variant="body2" 
                              sx={{ fontWeight: 500, cursor: 'pointer' }}
                              onDoubleClick={() => {
                                setEditingGuest(guest._id);
                                setEditingField('tableNumber');
                                setEditValues({ ...editValues, [`${guest._id}_tableNumber`]: guest.tableNumber ?? '' });
                              }}
                            >
                              {guest.tableNumber !== undefined ? guest.tableNumber : '-'}
                            </Typography>
                          )}
                        </TableCell>
                      )}
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          <IconButton 
                            size="small"
                            onClick={() => {
                              setEditingGuestData(guest);
                              setEditModalOpen(true);
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton 
                            size="small" 
                            sx={{ color: 'error.main' }}
                            onClick={() => {
                              if (window.confirm('האם אתה בטוח שברצונך למחוק את האורח?')) {
                                deleteGuest(guest._id);
                              }
                            }}
                          >
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
              {shouldFetchAll 
                ? `מציג ${filteredGuests.length} מתוך ${totalForDisplay}`
                : `מציג ${page * rowsPerPage + 1}-${Math.min((page + 1) * rowsPerPage, totalForDisplay)} מתוך ${totalForDisplay}`
              }
            </Typography>
            {!shouldFetchAll && (
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
                  disabled={(page + 1) * rowsPerPage >= totalForDisplay}
                  sx={{ borderRadius: 2 }}
                >
                  הבא
                </Button>
              </Box>
            )}
          </Box>
        </Paper>
      ) : (
        /* Mobile Card View */
        <>
          {/* Filters and Search Widget */}
          <Paper 
            sx={{ 
              borderRadius: 2,
              backgroundColor: 'white',
              boxShadow: 'none',
              border: '1px solid',
              borderColor: 'divider',
              borderWidth: '1px',
              overflow: 'hidden',
              p: 3,
              mb: 2
            }}
          >
            {/* Quick Filter Buttons - Horizontal Scroll */}
            <Box sx={{ 
              mb: 2, 
              overflowX: 'auto',
              '&::-webkit-scrollbar': {
                display: 'none'
              },
              scrollbarWidth: 'none',
              msOverflowStyle: 'none'
            }}>
              <Stack 
                direction="row" 
                spacing={1} 
                sx={{ 
                  minWidth: 'max-content',
                  pb: 1
                }}
              >
                {/* Group Filter - First */}
                <FormControl size="small" sx={{ minWidth: 120, flexShrink: 0 }}>
                  <Select
                    value={groupFilter}
                    onChange={(e) => {
                      setGroupFilter(e.target.value);
                      setPage(0);
                    }}
                    displayEmpty
                    sx={{
                      borderRadius: 3,
                      minWidth: 120,
                      px: 2,
                      py: 1,
                      backgroundColor: groupFilter === 'all' ? '#F2F3F5' : '#FFFFFF',
                      color: groupFilter === 'all' ? '#363B4D' : '#111827',
                      fontWeight: 500,
                      fontSize: '0.875rem',
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'transparent',
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'transparent',
                      },
                      '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'transparent',
                      },
                      '& .MuiSelect-select': {
                        py: 0,
                        px: 0,
                      },
                    }}
                  >
                    <MenuItem value="all">כל הקבוצות</MenuItem>
                    {uniqueGroups.map((group) => (
                      <MenuItem key={group} value={group}>
                        {group}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
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
                    flexShrink: 0,
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
                    flexShrink: 0,
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
                    flexShrink: 0,
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
                    flexShrink: 0,
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
                    flexShrink: 0,
                    '&:hover': {
                      backgroundColor: statusFilter === 'withNotes' ? '#5236F7' : '#E5E7EB',
                      boxShadow: 'none'
                    }
                  }}
                >
                  עם הערות
                </Button>
              </Stack>
            </Box>

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
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3,
                }
              }}
            />
          </Paper>

          {/* Guest Cards without widget */}
          <Grid container spacing={2} ref={tableRef}>
            {guestsLoading ? (
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                  <CircularProgress size={40} />
                </Box>
              </Grid>
            ) : filteredGuests.length === 0 ? (
              <Grid item xs={12}>
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="body1" color="text.secondary">
                    {searchQuery ? 'לא נמצאו תוצאות' : 'אין מוזמנים'}
                  </Typography>
                </Box>
              </Grid>
            ) : (
              filteredGuests
                .map((guest) => {
                  const isExpanded = expandedGuests.has(guest._id);
                  const totalCount = guest.confirmedCount || guest.expectedCount || 1;
                  const hasResponded = guest.status !== 'pending';
                  
                  return (
                    <Grid item xs={12} key={guest._id}>
                      {/* Swipe container with red delete background on the right */}
                      <Box
                        sx={{
                          position: 'relative',
                          overflow: 'hidden',
                          borderRadius: 3,
                          border: '1px solid',
                          borderColor: alpha('#E0E0E0', 0.5),
                          backgroundColor: 'transparent',
                        }}
                      >
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            right: 0,
                            width: 80,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#EF4444',
                            borderTopRightRadius: 2,
                            borderBottomRightRadius: 2,
                          }}
                        >
                          <IconButton
                            onClick={() => {
                              if (window.confirm('האם אתה בטוח שברצונך למחוק את האורח?')) {
                                deleteGuest(guest._id);
                              }
                            }}
                            sx={{ color: 'white' }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>

                        <Card
                          sx={{
                            position: 'relative',
                            borderRadius: 2,
                            backgroundColor: 'white',
                            boxShadow: 'none',
                            transform: swipedGuestId === guest._id ? 'translateX(-80px)' : 'translateX(0)',
                            transition: 'transform 0.2s ease-out',
                            '&:hover': {
                              boxShadow: theme.shadows[1]
                            }
                          }}
                          onTouchStart={(e) => {
                            if (e.touches.length === 1) {
                              setSwipeStartX(e.touches[0].clientX);
                            }
                          }}
                          onTouchEnd={(e) => {
                            if (swipeStartX === null) return;
                            const endX = e.changedTouches[0].clientX;
                            const deltaX = endX - swipeStartX;
                            // Swipe left to reveal delete (small threshold for better UX)
                            if (deltaX < -20) {
                              setSwipedGuestId(guest._id);
                            }
                            // Swipe right to close
                            if (deltaX > 20 && swipedGuestId === guest._id) {
                              setSwipedGuestId(null);
                            }
                            setSwipeStartX(null);
                          }}
                        >
                        <CardContent 
                          onClick={(e) => {
                            // Don't toggle expand if clicking on edit button or in edit mode
                            if ((e.target as HTMLElement).closest('.edit-button') || mobileEditingGuest === guest._id) {
                              return;
                            }
                            const newExpanded = new Set(expandedGuests);
                            if (isExpanded) {
                              newExpanded.delete(guest._id);
                            } else {
                              newExpanded.add(guest._id);
                            }
                            setExpandedGuests(newExpanded);
                          }}
                          sx={{ 
                            p: 2, 
                            '&:last-child': { pb: 2 },
                            cursor: mobileEditingGuest === guest._id ? 'default' : 'pointer',
                            position: 'relative'
                          }}
                        >
                          {mobileEditingGuest === guest._id ? (
                            /* Edit Mode */
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                              <TextField
                                size="small"
                                fullWidth
                                label="שם מלא"
                                value={editValues[`${guest._id}_mobile_name`] ?? guest.name}
                                onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_mobile_name`]: e.target.value })}
                                sx={{ backgroundColor: 'white' }}
                              />
                              <TextField
                                size="small"
                                fullWidth
                                label="מספר טלפון"
                                value={editValues[`${guest._id}_mobile_phone`] ?? guest.phone}
                                onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_mobile_phone`]: e.target.value })}
                                sx={{ backgroundColor: 'white' }}
                              />
                              <FormControl fullWidth size="small">
                                <InputLabel>סטטוס</InputLabel>
                                <Select
                                  value={editValues[`${guest._id}_mobile_status`] ?? guest.status}
                                  onChange={(e) => {
                                    const newStatus = e.target.value as 'pending' | 'confirmed' | 'declined';
                                    setEditValues({ ...editValues, [`${guest._id}_mobile_status`]: newStatus });
                                    updateGuestStatus(guest._id, newStatus);
                                  }}
                                  label="סטטוס"
                                  sx={{ backgroundColor: 'white' }}
                                >
                                  <MenuItem value="pending">ממתין</MenuItem>
                                  <MenuItem value="confirmed">מאשר הגעה</MenuItem>
                                  <MenuItem value="declined">דחה</MenuItem>
                                </Select>
                              </FormControl>
                              <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                  size="small"
                                  fullWidth
                                  type="number"
                                  label="כמות צפויה"
                                  value={editValues[`${guest._id}_mobile_expectedCount`] ?? guest.expectedCount ?? ''}
                                  onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_mobile_expectedCount`]: parseInt(e.target.value) || 0 })}
                                  sx={{ backgroundColor: 'white' }}
                                />
                                <TextField
                                  size="small"
                                  fullWidth
                                  type="number"
                                  label="כמות שאושרה"
                                  value={editValues[`${guest._id}_mobile_confirmedCount`] ?? guest.confirmedCount ?? ''}
                                  onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_mobile_confirmedCount`]: parseInt(e.target.value) || 0 })}
                                  sx={{ backgroundColor: 'white' }}
                                />
                              </Box>
                              <Autocomplete
                                freeSolo
                                size="small"
                                fullWidth
                                options={uniqueGroups}
                                value={editValues[`${guest._id}_mobile_group`] ?? guest.group ?? ''}
                                onChange={(event, newValue) => {
                                  const value = typeof newValue === 'string' ? newValue : newValue || '';
                                  setEditValues({ ...editValues, [`${guest._id}_mobile_group`]: value });
                                }}
                                onInputChange={(event, newInputValue) => {
                                  setEditValues({ ...editValues, [`${guest._id}_mobile_group`]: newInputValue });
                                }}
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    label="קבוצה"
                                    sx={{ backgroundColor: 'white' }}
                                  />
                                )}
                              />
                              {guest.tableNumber !== undefined && (
                                <TextField
                                  size="small"
                                  fullWidth
                                  type="number"
                                  label="מספר שולחן"
                                  value={editValues[`${guest._id}_mobile_tableNumber`] ?? guest.tableNumber ?? ''}
                                  onChange={(e) => setEditValues({ ...editValues, [`${guest._id}_mobile_tableNumber`]: parseInt(e.target.value) || undefined })}
                                  sx={{ backgroundColor: 'white' }}
                                />
                              )}
                              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                <Button
                                  variant="outlined"
                                  fullWidth
                                  onClick={() => {
                                    setMobileEditingGuest(null);
                                  }}
                                  sx={{ borderRadius: 2, py: 1.25 }}
                                >
                                  ביטול
                                </Button>
                                <Button
                                  variant="contained"
                                  fullWidth
                                  onClick={() => {
                                    const updatedData: Partial<Guest> = {};

                                    const nameValue = editValues[`${guest._id}_mobile_name`];
                                    const phoneValue = editValues[`${guest._id}_mobile_phone`];
                                    const groupValue = editValues[`${guest._id}_mobile_group`];
                                    const expectedRaw = editValues[`${guest._id}_mobile_expectedCount`];
                                    const confirmedRaw = editValues[`${guest._id}_mobile_confirmedCount`];
                                    const tableRaw = editValues[`${guest._id}_mobile_tableNumber`];

                                    if (nameValue !== undefined && nameValue !== guest.name) {
                                      updatedData.name = nameValue;
                                    }
                                    if (phoneValue !== undefined && phoneValue !== guest.phone) {
                                      updatedData.phone = phoneValue;
                                    }
                                    if (groupValue !== undefined && groupValue !== guest.group) {
                                      updatedData.group = groupValue;
                                    }

                                    const expected = expectedRaw ?? guest.expectedCount;
                                    if (expected !== undefined && expected !== null) {
                                      const n = Number(expected);
                                      if (Number.isFinite(n) && n >= 1) {
                                        updatedData.expectedCount = n;
                                      }
                                    }

                                    const confirmed = confirmedRaw ?? guest.confirmedCount;
                                    if (confirmed !== undefined && confirmed !== null) {
                                      const n = Number(confirmed);
                                      if (Number.isFinite(n) && n >= 1) {
                                        updatedData.confirmedCount = n;
                                      }
                                    }

                                    const table = tableRaw ?? guest.tableNumber;
                                    if (table !== undefined) {
                                      const n = Number(table);
                                      if (Number.isFinite(n) && n >= 1) {
                                        updatedData.tableNumber = n;
                                      }
                                    }

                                    updateGuest(guest._id, updatedData);
                                    setMobileEditingGuest(null);
                                  }}
                                  sx={{ borderRadius: 2, py: 1.25 }}
                                >
                                  שמור
                                </Button>
                              </Box>
                            </Box>
                          ) : (
                            /* View Mode */
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexDirection: 'row-reverse', position: 'relative' }}>
                              {/* Edit Button */}
                              <IconButton
                                className="edit-button"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMobileEditingGuest(guest._id);
                                  setEditValues({
                                    ...editValues,
                                    [`${guest._id}_mobile_name`]: guest.name,
                                    [`${guest._id}_mobile_phone`]: guest.phone,
                                    [`${guest._id}_mobile_group`]: guest.group ?? '',
                                    [`${guest._id}_mobile_expectedCount`]: guest.expectedCount ?? '',
                                    [`${guest._id}_mobile_confirmedCount`]: guest.confirmedCount ?? '',
                                    [`${guest._id}_mobile_tableNumber`]: guest.tableNumber ?? '',
                                    [`${guest._id}_mobile_status`]: guest.status
                                  });
                                }}
                                sx={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  backgroundColor: 'background.default',
                                  color: 'text.secondary',
                                  '&:hover': {
                                    backgroundColor: 'action.hover'
                                  },
                                  zIndex: 1,
                                  width: 32,
                                  height: 32
                                }}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                              
                              {/* WhatsApp Icon on left */}
                              <Box
                                sx={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: '50%',
                                  backgroundColor: '#25D366',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                  ml: 5 // Add margin to avoid overlap with edit button
                                }}
                              >
                                <WhatsAppIcon sx={{ fontSize: 20, color: 'white' }} />
                              </Box>
                              
                              {/* Content - Right aligned */}
                              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100%' }}>
                                {/* Name */}
                                <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.25, textAlign: 'right', width: '100%' }}>
                                  {guest.name}
                                </Typography>
                                
                                {/* Phone */}
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, textAlign: 'right', width: '100%' }}>
                                  {guest.phone}
                                </Typography>
                                
                                {/* Status Chip and Total Count */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%', flexDirection: 'row-reverse' }}>
                                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>
                                    {totalCount} אורחים
                                  </Typography>
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
                                
                                {/* Response status with expand icon */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end', width: '100%', flexDirection: 'row-reverse' }}>
                                  <ExpandMoreIcon 
                                    sx={{ 
                                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                      transition: 'transform 0.3s',
                                      color: 'text.secondary',
                                      flexShrink: 0
                                    }}
                                  />
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexDirection: 'row-reverse' }}>
                                    {!hasResponded && (
                                      <WarningIcon sx={{ fontSize: 16, color: '#f57c00' }} />
                                    )}
                                    <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
                                      {hasResponded 
                                        ? `הגיב${guest.status === 'confirmed' ? 'ה' : ''} לפני ${guest.status === 'confirmed' ? 'יומיים' : guest.status === 'declined' ? '3 ימים' : 'שבוע'}`
                                        : `הודעה נשלחה לפני ${guest.status === 'pending' ? '5 ימים' : 'יומיים'}`}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Box>
                            </Box>
                          )}
                        </CardContent>

                        {/* Expanded Content */}
                        {isExpanded && (
                          <Box sx={{ 
                            borderTop: '1px solid', 
                            borderColor: alpha('#E0E0E0', 0.5), 
                            p: 1.5,
                            backgroundColor: alpha('#F5F5F9', 0.5)
                          }}>
                            {/* Response History */}
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                                היסטוריית תגובות
                              </Typography>
                              <Box
                                sx={{
                                  p: 1.5,
                                  borderRadius: 2,
                                  backgroundColor: 'white'
                                }}
                              >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: 'row-reverse' }}>
                                  <Box sx={{ flex: 1 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'right' }}>
                                      {guest.status === 'confirmed' ? 'אישרה הגעה' : 
                                       guest.status === 'declined' ? 'דיווח שלא מגיע' : 
                                       'הזמנה נשלחה'}
                                    </Typography>
                                    {guest.status === 'pending' && (
                                      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', display: 'block' }}>
                                        נקרא ב-WhatsApp, לא הגיב
                                      </Typography>
                                    )}
                                  </Box>
                                  <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                                    {guest.status === 'confirmed' ? '20/12/2024' : 
                                     guest.status === 'declined' ? '17/12/2024' : 
                                     '15/12/2024'}
                                  </Typography>
                                </Box>
                              </Box>
                            </Box>

                            {/* Quick Actions */}
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                                {guest.status === 'pending' ? 'פעולות מומלצות' : 'פעולות מהירות'}
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {guest.status === 'confirmed' ? (
                                  <>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button
                                        variant="outlined"
                                        startIcon={<CancelIcon />}
                                        onClick={() => updateGuestStatus(guest._id, 'declined')}
                                        sx={{
                                          flex: 1,
                                          borderRadius: 2,
                                          textTransform: 'none',
                                          justifyContent: 'flex-start',
                                          borderColor: alpha('#D32F2F', 0.5),
                                          borderWidth: 1,
                                          backgroundColor: alpha('#FFEBEE', 0.5),
                                          color: '#D32F2F',
                                          boxShadow: 'none',
                                          py: 1.5,
                                          '& .MuiButton-startIcon': {
                                            ml: 1.5
                                          },
                                          '&:hover': {
                                            borderColor: alpha('#D32F2F', 0.7),
                                            backgroundColor: alpha('#FFEBEE', 0.7),
                                            boxShadow: 'none'
                                          }
                                        }}
                                      >
                                        סמן כלא מגיע
                                      </Button>
                                      <Button
                                        variant="outlined"
                                        startIcon={<PeopleIcon />}
                                        sx={{
                                          flex: 1,
                                          borderRadius: 2,
                                          textTransform: 'none',
                                          justifyContent: 'flex-start',
                                          borderColor: alpha('#D0D0D0', 0.6),
                                          borderWidth: 1,
                                          backgroundColor: 'white',
                                          color: '#111827',
                                          boxShadow: 'none',
                                          py: 1.5,
                                          '& .MuiButton-startIcon': {
                                            ml: 1.5
                                          },
                                          '&:hover': {
                                            borderColor: alpha('#C0C0C0', 0.8),
                                            backgroundColor: alpha('#F5F5F5', 0.3),
                                            boxShadow: 'none'
                                          }
                                        }}
                                      >
                                        שנה כמות
                                      </Button>
                                    </Box>
                                  </>
                                ) : guest.status === 'pending' ? (
                                  <>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button
                                        variant="outlined"
                                        startIcon={<CancelIcon />}
                                        onClick={() => updateGuestStatus(guest._id, 'declined')}
                                        sx={{
                                          flex: 1,
                                          borderRadius: 2,
                                          textTransform: 'none',
                                          justifyContent: 'flex-start',
                                          borderColor: alpha('#D32F2F', 0.5),
                                          borderWidth: 1,
                                          backgroundColor: alpha('#FFEBEE', 0.5),
                                          color: '#D32F2F',
                                          boxShadow: 'none',
                                          py: 1.5,
                                          '& .MuiButton-startIcon': {
                                            ml: 1.5
                                          },
                                          '&:hover': {
                                            borderColor: alpha('#D32F2F', 0.7),
                                            backgroundColor: alpha('#FFEBEE', 0.7),
                                            boxShadow: 'none'
                                          }
                                        }}
                                      >
                                        סמן לא מגיע
                                      </Button>
                                      <Button
                                        variant="outlined"
                                        startIcon={<CheckCircleIcon />}
                                        onClick={() => updateGuestStatus(guest._id, 'confirmed')}
                                        sx={{
                                          flex: 1,
                                          borderRadius: 2,
                                          textTransform: 'none',
                                          justifyContent: 'flex-start',
                                          borderColor: alpha('#4CAF50', 0.4),
                                          borderWidth: 1,
                                          backgroundColor: alpha('#E8F5E9', 0.5),
                                          color: '#2E7D32',
                                          boxShadow: 'none',
                                          py: 1.5,
                                          '& .MuiButton-startIcon': {
                                            ml: 1.5
                                          },
                                          '&:hover': {
                                            borderColor: alpha('#4CAF50', 0.6),
                                            backgroundColor: alpha('#E8F5E9', 0.7),
                                            boxShadow: 'none'
                                          }
                                        }}
                                      >
                                        סמן מגיע
                                      </Button>
                                    </Box>
                                  </>
                                ) : (
                                  <Button
                                    variant="outlined"
                                    startIcon={<CheckCircleIcon />}
                                    onClick={() => updateGuestStatus(guest._id, 'confirmed')}
                                    fullWidth
                                    sx={{
                                      borderRadius: 2,
                                      textTransform: 'none',
                                      justifyContent: 'flex-start',
                                      borderColor: alpha('#4CAF50', 0.4),
                                      borderWidth: 1,
                                      backgroundColor: alpha('#E8F5E9', 0.5),
                                      color: '#2E7D32',
                                      boxShadow: 'none',
                                      py: 1.5,
                                      '& .MuiButton-startIcon': {
                                        ml: 1.5
                                      },
                                      '&:hover': {
                                        borderColor: alpha('#4CAF50', 0.6),
                                        backgroundColor: alpha('#E8F5E9', 0.7),
                                        boxShadow: 'none'
                                      }
                                    }}
                                  >
                                    שנה ל"מגיע"
                                  </Button>
                                )}
                              </Box>
                            </Box>

                            {/* Private Note */}
                            <Box>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                                הערה פרטית
                              </Typography>
                              <TextField
                                fullWidth
                                multiline
                                rows={3}
                                placeholder="הוסף הערה פנימית (רק בשבילך)"
                                variant="outlined"
                                value={guestNotes[guest._id] || guest.note || ''}
                                onChange={(e) => {
                                  setGuestNotes({ ...guestNotes, [guest._id]: e.target.value });
                                }}
                                onBlur={() => {
                                  const note = guestNotes[guest._id] || '';
                                  if (note !== (guest.note || '')) {
                                    updateGuestNote(guest._id, note);
                                  }
                                }}
                                sx={{
                                  '& .MuiOutlinedInput-root': {
                                    borderRadius: 2,
                                    backgroundColor: 'white',
                                    borderColor: alpha('#E0E0E0', 0.3),
                                    '& fieldset': {
                                      borderColor: alpha('#E0E0E0', 0.3),
                                    },
                                    '&:hover fieldset': {
                                      borderColor: alpha('#E0E0E0', 0.5),
                                    },
                                    '&.Mui-focused fieldset': {
                                      borderColor: alpha('#E0E0E0', 0.5),
                                    }
                                  }
                                }}
                              />
                              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
                                ההערה לא תישלח לאורח
                              </Typography>
                            </Box>
                          </Box>
                        )}
                        {/* Delete action overlay on the right when swiped */}
                        {/* right-side delete background is rendered in parent swipe container */}
                      </Card>
                      </Box>
                    </Grid>
                  );
                })
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
            {shouldFetchAll 
              ? `מציג ${filteredGuests.length} מתוך ${totalForDisplay}`
              : `מציג ${page * rowsPerPage + 1}-${Math.min((page + 1) * rowsPerPage, totalForDisplay)} מתוך ${totalForDisplay}`
            }
          </Typography>
          {!shouldFetchAll && (
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
                disabled={(page + 1) * rowsPerPage >= totalForDisplay}
                sx={{ borderRadius: 2 }}
              >
                הבא
              </Button>
            </Box>
          )}
        </Box>
        </>
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

      {/* Edit Guest Modal */}
      <Dialog 
        open={editModalOpen} 
        onClose={() => {
          setEditModalOpen(false);
          setEditingGuestData(null);
        }}
        maxWidth="sm"
        fullWidth
        dir="rtl"
      >
        <DialogTitle>עריכת אורח</DialogTitle>
        <DialogContent>
          {editingGuestData && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
              <TextField
                label="שם מלא"
                fullWidth
                value={editValues[`${editingGuestData._id}_modal_name`] ?? editingGuestData.name}
                onChange={(e) => setEditValues({ ...editValues, [`${editingGuestData._id}_modal_name`]: e.target.value })}
              />
              <TextField
                label="מספר טלפון"
                fullWidth
                value={editValues[`${editingGuestData._id}_modal_phone`] ?? editingGuestData.phone}
                onChange={(e) => setEditValues({ ...editValues, [`${editingGuestData._id}_modal_phone`]: e.target.value })}
              />
              <TextField
                label="אימייל"
                fullWidth
                type="email"
                value={editValues[`${editingGuestData._id}_modal_email`] ?? editingGuestData.email ?? ''}
                onChange={(e) => setEditValues({ ...editValues, [`${editingGuestData._id}_modal_email`]: e.target.value })}
              />
              <Autocomplete
                freeSolo
                fullWidth
                options={uniqueGroups}
                value={editValues[`${editingGuestData._id}_modal_group`] ?? editingGuestData.group ?? ''}
                onChange={(event, newValue) => {
                  const value = typeof newValue === 'string' ? newValue : newValue || '';
                  setEditValues({ ...editValues, [`${editingGuestData._id}_modal_group`]: value });
                }}
                onInputChange={(event, newInputValue) => {
                  setEditValues({ ...editValues, [`${editingGuestData._id}_modal_group`]: newInputValue });
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="קבוצה"
                  />
                )}
              />
              <TextField
                label="כמות אורחים צפויה"
                fullWidth
                type="number"
                value={editValues[`${editingGuestData._id}_modal_expectedCount`] ?? editingGuestData.expectedCount ?? ''}
                onChange={(e) => setEditValues({ ...editValues, [`${editingGuestData._id}_modal_expectedCount`]: parseInt(e.target.value) || 0 })}
              />
              <TextField
                label="כמות אורחים שאושרה"
                fullWidth
                type="number"
                value={editValues[`${editingGuestData._id}_modal_confirmedCount`] ?? editingGuestData.confirmedCount ?? ''}
                onChange={(e) => setEditValues({ ...editValues, [`${editingGuestData._id}_modal_confirmedCount`]: parseInt(e.target.value) || 0 })}
              />
              <TextField
                label="מספר שולחן"
                fullWidth
                type="number"
                value={editValues[`${editingGuestData._id}_modal_tableNumber`] ?? editingGuestData.tableNumber ?? ''}
                onChange={(e) => setEditValues({ ...editValues, [`${editingGuestData._id}_modal_tableNumber`]: parseInt(e.target.value) || undefined })}
              />
              <FormControl fullWidth>
                <InputLabel>סטטוס</InputLabel>
                <Select
                  value={editValues[`${editingGuestData._id}_modal_status`] ?? editingGuestData.status}
                  onChange={(e) => setEditValues({ ...editValues, [`${editingGuestData._id}_modal_status`]: e.target.value })}
                  label="סטטוס"
                >
                  <MenuItem value="pending">ממתין</MenuItem>
                  <MenuItem value="confirmed">מאשר הגעה</MenuItem>
                  <MenuItem value="declined">דחה</MenuItem>
                </Select>
              </FormControl>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button 
            onClick={() => {
              setEditModalOpen(false);
              setEditingGuestData(null);
            }}
          >
            ביטול
          </Button>
          <Button 
            variant="contained"
            onClick={() => {
              if (editingGuestData) {
                const updatedData: Partial<Guest> = {
                  name: editValues[`${editingGuestData._id}_modal_name`] ?? editingGuestData.name,
                  phone: editValues[`${editingGuestData._id}_modal_phone`] ?? editingGuestData.phone,
                  email: editValues[`${editingGuestData._id}_modal_email`] ?? editingGuestData.email,
                  group: editValues[`${editingGuestData._id}_modal_group`] ?? editingGuestData.group,
                  expectedCount: editValues[`${editingGuestData._id}_modal_expectedCount`] ?? editingGuestData.expectedCount,
                  confirmedCount: editValues[`${editingGuestData._id}_modal_confirmedCount`] ?? editingGuestData.confirmedCount,
                  tableNumber: editValues[`${editingGuestData._id}_modal_tableNumber`] ?? editingGuestData.tableNumber,
                };
                const newStatus = editValues[`${editingGuestData._id}_modal_status`] ?? editingGuestData.status;
                if (newStatus !== editingGuestData.status) {
                  updateGuestStatus(editingGuestData._id, newStatus as 'pending' | 'confirmed' | 'declined');
                }
                updateGuest(editingGuestData._id, updatedData);
              }
            }}
          >
            שמור
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Guests; 