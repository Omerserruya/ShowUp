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
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Grid,
  Divider,
  Checkbox,
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
  Autocomplete,
  Menu
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
  Send as SendIcon,
  ContentCopy as ContentCopyIcon
} from '@mui/icons-material';
import { useGuests, useOverviewStats } from '../hooks/useOverviewData';
import { useEvent } from '../contexts/EventContext';
import { getPlan } from '../config/plans';
import { fetchWithAuth } from '../utils/fetchWithAuth';
import { countryOptions, normalizePhoneNumber } from '../utils/countryOptions';
import { ImportedGuestsSection } from '../components/ImportedGuestsSection';
import { ImportedGuestsWidget } from '../components/ImportedGuestsWidget';

import ResponsiveDialog from '../components/ResponsiveDialog';
import GuestTimeline from '../components/GuestTimeline';
import BulkActionsBar from '../components/BulkActionsBar';
import TagPickerDialog, { Tag } from '../components/TagPickerDialog';
import CopyGuestsDialog from '../components/CopyGuestsDialog';
import GuestsSummary from '../components/GuestsSummary';
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

// Status colors - brand-aligned, dark enough for chip text on a 10% tint.
const statusColors = {
  pending: '#d97706',
  confirmed: '#15803d',
  declined: '#dc2626',
  maybe: '#6f74e0'
} as const;

// Status labels
const statusLabels = {
  pending: 'ממתין',
  confirmed: 'מאשר הגעה',
  declined: 'לא מגיע',
  maybe: 'אולי'
} as const;

function Guests() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { selectedEvent, events } = useEvent();
  // Map plan_id from API to planId for frontend compatibility
  const planId = selectedEvent?.planId || (selectedEvent as any)?.plan_id || null;
  const plan = getPlan(planId);
  const location = useLocation();
  const navigate = useNavigate();
  const tableRef = useRef<HTMLDivElement>(null);
  
  // Initialize statusFilter from URL query parameter
  const getInitialStatusFilter = () => {
    const searchParams = new URLSearchParams(location.search);
    // Support both "filter" and legacy/mistyped "filtering" params
    const filter = searchParams.get('filter') || searchParams.get('filtering');
    if (filter && ['all', 'confirmed', 'declined', 'pending', 'maybe'].includes(filter)) {
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
  // Once the page has shown real content once, never blank the whole page again -
  // filtering/searching refetch in place, not via the full-page loader.
  const [firstLoadDone, setFirstLoadDone] = useState(false);

  // Editing state
  const [editingGuest, setEditingGuest] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingGuestData, setEditingGuestData] = useState<Guest | null>(null);

  // Bulk selection / actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false);
  const [bulkGroupValue, setBulkGroupValue] = useState('');
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [copyGuestsOpen, setCopyGuestsOpen] = useState(false);

  // New guest (manual add)
  const [newGuest, setNewGuest] = useState({
    name: '',
    phone: '',
    countryCode: '+972',
    group: '',
    status: 'pending' as 'pending' | 'confirmed' | 'declined' | 'maybe',
    expectedCount: 1 as number | string,
    confirmedCount: '' as number | string,
    tableNumber: '' as number | string,
    note: ''
  });
  const [savingNewGuest, setSavingNewGuest] = useState(false);
  
  // Mobile editing & swipe state
  const [mobileEditingGuest, setMobileEditingGuest] = useState<string | null>(null);
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null);
  const [swipedGuestId, setSwipedGuestId] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<null | HTMLElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<null | {
    rows: { name: string; phone: string; valid: boolean; issue?: string }[];
    total: number; validCount: number; invalidCount: number; duplicateCount: number;
  }>(null);
  const [importing, setImporting] = useState(false);
  const [importTab, setImportTab] = useState<'whatsapp' | 'upload'>('whatsapp');
  const [importDragOver, setImportDragOver] = useState(false);
  const [deleteConfirmGuestId, setDeleteConfirmGuestId] = useState<string | null>(null);
  const [changeCountGuestId, setChangeCountGuestId] = useState<string | null>(null);
  const [changeCountValues, setChangeCountValues] = useState<{ expectedCount: number | string; confirmedCount: number | string }>({ expectedCount: '', confirmedCount: '' });
  const [copiedPhone, setCopiedPhone] = useState(false);
  
  // Read filter from URL query parameter on mount and when URL changes
  // Respond to global keyboard shortcuts (see KeyboardShortcuts.tsx).
  useEffect(() => {
    const openAdd = () => setGuestModalOpen(true);
    const focusSearch = () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="חיפוש אורח..."]');
      input?.focus();
    };
    window.addEventListener('showup:new-guest', openAdd);
    window.addEventListener('showup:focus-search', focusSearch);
    return () => {
      window.removeEventListener('showup:new-guest', openAdd);
      window.removeEventListener('showup:focus-search', focusSearch);
    };
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const filter = searchParams.get('filter') || searchParams.get('filtering');
    if (filter && ['all', 'confirmed', 'declined', 'pending', 'maybe'].includes(filter)) {
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

  // Determine if we need to fetch all guests.
  // Status filters are served by the API with real pagination + totals, so they
  // stay paginated. Group / "with notes" filters are applied client-side, so they
  // must operate on the full list - filtering a single 25-row page would silently
  // hide matching guests from other pages.
  const clientSideFilterActive = statusFilter === 'withNotes' || groupFilter !== 'all';
  const shouldFetchAll = clientSideFilterActive;
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
    // Only real statuses go to the API; 'withNotes'/group filtering happens client-side on the full list.
    statusFilter !== 'all' && statusFilter !== 'withNotes' ? statusFilter : undefined
  );

  // Fetch stats from API - only refresh when explicitly needed (not on filter changes)
  const { stats, loading: statsLoading } = useOverviewStats(statsRefreshKey);

  // After the first load settles, never show the full-page loader again.
  useEffect(() => {
    if (!guestsLoading && !statsLoading && !firstLoadDone) setFirstLoadDone(true);
  }, [guestsLoading, statsLoading, firstLoadDone]);

  // Use the real filtered total from the API when a server-side filter (status/search)
  // or a fetch-all is active; otherwise use stats.total_guests (number of invitations).
  const serverFilterActive = Boolean(searchQueryForAPI) || (statusFilter !== 'all' && statusFilter !== 'withNotes');
  const totalForDisplay = (shouldFetchAll || serverFilterActive) ? totalGuestsFromAPI : (stats?.total_guests || 0);

  // Clamp pagination: if a refetch shrinks the result set below the current page
  // (e.g. while typing a search), snap back to the first page.
  useEffect(() => {
    if (!guestsLoading && !shouldFetchAll && page > 0 && page * rowsPerPage >= totalForDisplay) {
      setPage(0);
    }
  }, [guestsLoading, shouldFetchAll, page, rowsPerPage, totalForDisplay]);

  // Map API guests to component format
  const guests = apiGuests.map(mapGuestFromAPI);

  // Calculate statistics from API stats (which now return correct sums)
  const totalGuests = stats?.total_guests || 0; // Count of guest records (number of invitations)
  const totalInvitedPeople = stats?.total || 0; // Sum of import_count (total people invited)
  const confirmedGuests = stats?.approved || 0; // Sum of guest_count (or import_count) for confirmed
  const confirmedPeople = stats?.approved || 0; // Same as confirmedGuests
  const pendingGuests = stats?.pending || 0; // Count of pending guests

  // Get capacity from plan, or use default if no plan or no limit
  const eventCapacity = plan?.countLimit ?? null; // null means unlimited

  // Get unique groups from guests
  const uniqueGroups = Array.from(new Set(guests.map(guest => guest.group).filter((g): g is string => Boolean(g)))).sort();

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

  // Any status/group filter active (used to distinguish "no guests yet" from "no matches")
  const filtersActive = statusFilter !== 'all' || groupFilter !== 'all';
  const clearFilters = () => {
    setStatusFilter('all');
    setGroupFilter('all');
    setPage(0);
  };

  // Update guest status
  const updateGuestStatus = useCallback(async (guestId: string, newStatus: 'pending' | 'confirmed' | 'declined' | 'maybe') => {
    const statusMap: Record<string, string> = {
      'pending': 'invited',
      'confirmed': 'attending',
      'declined': 'declined',
      'maybe': 'maybe'
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
      // Refresh so the saved note is reflected in the fetched guest data
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Error updating guest note:', error);
      setSnackbar({ open: true, message: 'שגיאה בעדכון ההערה', severity: 'error' });
    }
  }, []);

  // --- Bulk selection helpers ---
  const toggleSelect = useCallback((guestId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(guestId)) next.delete(guestId); else next.add(guestId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, []);

  // Bulk delete the selected guests.
  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let failed = 0;
    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetchWithAuth(`/api/guests/${id}`, { method: 'DELETE' });
        if (!res.ok) failed++;
      } catch { failed++; }
    }));
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    clearSelection();
    setRefreshKey(prev => prev + 1);
    setStatsRefreshKey(prev => prev + 1);
    setSnackbar({
      open: true,
      message: failed ? `נמחקו ${ids.length - failed}, נכשלו ${failed}` : `${ids.length} אורחים נמחקו`,
      severity: failed ? 'error' : 'success',
    });
  }, [selectedIds, clearSelection]);

  // Move all selected guests into a group.
  const bulkMoveGroup = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const group = bulkGroupValue.trim();
    if (ids.length === 0) return;
    setBulkBusy(true);
    let failed = 0;
    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetchWithAuth(`/api/guests/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ group }),
        });
        if (!res.ok) failed++;
      } catch { failed++; }
    }));
    setBulkBusy(false);
    setBulkGroupOpen(false);
    setBulkGroupValue('');
    clearSelection();
    setRefreshKey(prev => prev + 1);
    setSnackbar({
      open: true,
      message: failed ? `עודכנו ${ids.length - failed}, נכשלו ${failed}` : `${ids.length} אורחים הועברו לקבוצה`,
      severity: failed ? 'error' : 'success',
    });
  }, [selectedIds, bulkGroupValue, clearSelection]);

  // Assign a tag to all selected guests.
  const bulkAssignTag = useCallback(async (tag: Tag) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let failed = 0;
    await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetchWithAuth(`/api/guests/${id}/tags/${tag.id}`, { method: 'POST' });
        if (!res.ok && res.status !== 204) failed++;
      } catch { failed++; }
    }));
    setBulkBusy(false);
    setTagDialogOpen(false);
    clearSelection();
    setRefreshKey(prev => prev + 1);
    setSnackbar({
      open: true,
      message: failed ? `תויגו ${ids.length - failed}, נכשלו ${failed}` : `התגית "${tag.name}" נוספה ל-${ids.length} אורחים`,
      severity: failed ? 'error' : 'success',
    });
  }, [selectedIds, clearSelection]);

  // Export guests (CSV/XLSX)
  const handleExport = useCallback(async (format: 'csv' | 'xlsx') => {
    if (!selectedEvent?.id) return;
    setExportMenuAnchor(null); // Close menu
    try {
      setExportLoading(true);
      const params = new URLSearchParams({
        event_id: selectedEvent.id,
        export_format: format,
      });
      const response = await fetchWithAuth(`/api/guests/export?${params.toString()}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Export error response:', errorText);
        throw new Error(`Failed to export guests: ${response.status} ${errorText}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'csv' ? 'guests.csv' : 'guests.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting guests:', error);
      setSnackbar({ open: true, message: 'שגיאה ביצוא האורחים', severity: 'error' });
    } finally {
      setExportLoading(false);
    }
  }, [selectedEvent?.id]);

  // Download import template
  const handleDownloadTemplate = useCallback(async (format: 'csv' | 'xlsx') => {
    try {
      const response = await fetchWithAuth(`/api/guests/import-template?export_format=${format}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `תבנית_ייבוא_אורחים.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading template:', error);
      setSnackbar({ open: true, message: 'שגיאה בהורדת התבנית', severity: 'error' });
    }
  }, []);

  // Import guests from CSV/XLSX
  // --- CSV preview & validation (gives users confidence before they commit) ---
  const splitCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
        } else { cur += c; }
      } else if (c === '"') { q = true; }
      else if (c === ',') { out.push(cur); cur = ''; }
      else { cur += c; }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const buildCsvPreview = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { rows: [], total: 0, validCount: 0, invalidCount: 0, duplicateCount: 0 };
    const header = splitCsvLine(lines[0]);
    const findIdx = (subs: string[]) => header.findIndex((h) => subs.some((s) => h.includes(s)));
    let nameIdx = findIdx(['שם']);
    let phoneIdx = findIdx(['טלפון', 'נייד', 'phone', 'tel']);
    let dataLines = lines.slice(1);
    if (nameIdx === -1 && phoneIdx === -1) { nameIdx = 0; phoneIdx = 1; dataLines = lines; }
    else { if (nameIdx === -1) nameIdx = 0; if (phoneIdx === -1) phoneIdx = 1; }
    const seen = new Set<string>();
    let duplicateCount = 0;
    const rows = dataLines.map((line) => {
      const cells = splitCsvLine(line);
      const name = (cells[nameIdx] || '').trim();
      const phoneRaw = (cells[phoneIdx] || '').trim();
      const phoneDigits = phoneRaw.replace(/\D/g, '');
      let valid = true;
      let issue: string | undefined;
      if (!name) { valid = false; issue = 'חסר שם'; }
      else if (phoneDigits.length < 7) { valid = false; issue = 'טלפון לא תקין'; }
      else if (seen.has(phoneDigits)) { valid = false; issue = 'כפילות'; duplicateCount++; }
      if (valid) seen.add(phoneDigits);
      return { name, phone: phoneRaw, valid, issue };
    });
    const validCount = rows.filter((r) => r.valid).length;
    const invalidCount = rows.filter((r) => !r.valid && r.issue !== 'כפילות').length;
    return { rows, total: rows.length, validCount, invalidCount, duplicateCount };
  };

  const handleImportFile = useCallback((file: File | null) => {
    setImportFile(file);
    setImportPreview(null);
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
    if (!isCsv) return; // Excel files are parsed server-side; preview is CSV-only.
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setImportPreview(buildCsvPreview(String(reader.result || '')));
      } catch {
        setImportPreview(null);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleImportFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    handleImportFile(event.target.files?.[0] || null);
  }, [handleImportFile]);

  const handleImportGuests = useCallback(async () => {
    if (!selectedEvent?.id) return;
    if (!importFile) {
      setSnackbar({ open: true, message: 'אנא בחר קובץ לייבוא', severity: 'error' });
      return;
    }

    try {
      setImporting(true);
      const formData = new FormData();
      formData.append('file', importFile);

      const response = await fetchWithAuth(`/api/guests/bulk?event_id=${selectedEvent.id}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Import error response:', errorText);
        throw new Error(`Failed to import guests: ${response.status} ${errorText}`);
      }

      setSnackbar({ open: true, message: 'האורחים יובאו בהצלחה', severity: 'success' });
      setImportModalOpen(false);
      setImportFile(null);
      setImportPreview(null);
      setRefreshKey(prev => prev + 1);
      setStatsRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Error importing guests:', error);
      setSnackbar({ open: true, message: 'שגיאה בייבוא האורחים', severity: 'error' });
    } finally {
      setImporting(false);
    }
  }, [importFile, selectedEvent?.id]);

  // Get WhatsApp number from environment variable
  const whatsappNumber = process.env.REACT_APP_WHATSAPP_NUMBER || '+972-50-1234567';
  
  // Copy phone number to clipboard
  const handleCopyPhone = useCallback(async () => {
    const phoneNumber = whatsappNumber;
    
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(phoneNumber);
        setCopiedPhone(true);
        setSnackbar({ open: true, message: 'מספר הטלפון הועתק ללוח', severity: 'success' });
        setTimeout(() => setCopiedPhone(false), 2000);
        return;
      } catch (error) {
        console.error('Clipboard API failed, trying fallback:', error);
      }
    }
    
    // Fallback method for older browsers or non-HTTPS contexts
    try {
      const textArea = document.createElement('textarea');
      textArea.value = phoneNumber;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopiedPhone(true);
        setSnackbar({ open: true, message: 'מספר הטלפון הועתק ללוח', severity: 'success' });
        setTimeout(() => setCopiedPhone(false), 2000);
      } else {
        throw new Error('execCommand copy failed');
      }
    } catch (error) {
      console.error('Failed to copy phone number:', error);
      setSnackbar({ open: true, message: 'שגיאה בהעתקת מספר הטלפון', severity: 'error' });
    }
  }, []);

  // Create new guest (manual add)
  const createGuest = useCallback(async () => {
    if (!selectedEvent?.id) return;

    const trimmedName = newGuest.name.trim();
    const trimmedPhone = newGuest.phone.trim();

    if (!trimmedName || !trimmedPhone) {
      setSnackbar({ open: true, message: 'שם ומספר טלפון הם שדות חובה', severity: 'error' });
      return;
    }

    // Normalize phone number with country code
    const fullPhoneNumber = normalizePhoneNumber(trimmedPhone, newGuest.countryCode);

    const payload: Record<string, any> = {
      name: trimmedName,
      phone: fullPhoneNumber,
    };

    if (newGuest.group) {
      payload.group = newGuest.group;
    }

    // Map frontend status to backend status
    const statusMap: Record<string, string> = {
      pending: 'invited',
      confirmed: 'attending',
      declined: 'declined',
      maybe: 'maybe',
    };
    payload.status = statusMap[newGuest.status] || 'invited';

    // Numeric fields – only send valid positive integers
    if (newGuest.expectedCount !== '') {
      const expected = Number(newGuest.expectedCount);
      if (Number.isFinite(expected) && expected >= 1) {
        payload.import_count = expected;
      }
    }
    if (newGuest.confirmedCount !== '') {
      const confirmed = Number(newGuest.confirmedCount);
      if (Number.isFinite(confirmed) && confirmed >= 1) {
        payload.guest_count = confirmed;
      }
    }
    if (newGuest.tableNumber !== '') {
      const tableNum = Number(newGuest.tableNumber);
      if (Number.isFinite(tableNum) && tableNum >= 1) {
        payload.table_number = tableNum;
      }
    }

    if (newGuest.note) {
      payload.notes = newGuest.note;
    }

    try {
      setSavingNewGuest(true);
      const response = await fetchWithAuth(`/api/guests?event_id=${selectedEvent.id}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to create guest');
      }

      setSnackbar({ open: true, message: 'האורח נוסף בהצלחה', severity: 'success' });
      setGuestModalOpen(false);
      setNewGuest({
        name: '',
        phone: '',
        countryCode: '+972',
        group: '',
        status: 'pending',
        expectedCount: 1,
        confirmedCount: '',
        tableNumber: '',
        note: ''
      });
      setRefreshKey(prev => prev + 1);
      setStatsRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Error creating guest:', error);
      setSnackbar({ open: true, message: 'שגיאה בהוספת האורח', severity: 'error' });
    } finally {
      setSavingNewGuest(false);
    }
  }, [newGuest, selectedEvent?.id]);

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

  // Full-page loader ONLY on the very first load (before any content has shown).
  // After that, filtering/searching refetch in place inside the table.
  if (!firstLoadDone && apiGuests.length === 0 && (guestsLoading || statsLoading)) {
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

      {/* Top Section: summary infographic - ring + breakdown + capacity + actions */}
      <GuestsSummary
        confirmed={confirmedGuests}
        pending={pendingGuests}
        declined={stats?.declined || 0}
        totalInvited={totalInvitedPeople}
        capacity={eventCapacity}
        daysUntil={(() => {
          const d = (selectedEvent as any)?.event_date || (selectedEvent as any)?.date;
          if (!d || isNaN(new Date(d).getTime())) return null;
          return Math.floor((new Date(d).getTime() - Date.now()) / 86400000);
        })()}
        onAdd={() => setGuestModalOpen(true)}
        onImport={() => setImportModalOpen(true)}
        onExport={(e) => setExportMenuAnchor(e.currentTarget)}
        exportLoading={exportLoading}
      />

      {/* Export format menu */}
      <Menu
        anchorEl={exportMenuAnchor}
        open={Boolean(exportMenuAnchor)}
        onClose={() => setExportMenuAnchor(null)}
        disableAutoFocusItem
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => handleExport('csv')} disabled={exportLoading}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <FileDownloadIcon sx={{ fontSize: 20 }} />
            <Typography>ייצוא ל-CSV</Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={() => handleExport('xlsx')} disabled={exportLoading}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <TableChartIcon sx={{ fontSize: 20 }} />
            <Typography>ייצוא ל-Excel</Typography>
          </Box>
        </MenuItem>
      </Menu>


      {/* Delete confirmation dialog */}
      <ResponsiveDialog
        open={!!deleteConfirmGuestId}
        onClose={() => setDeleteConfirmGuestId(null)}
      >
        <DialogTitle>מחיקת אורח</DialogTitle>
        <DialogContent>
          <Typography>
            האם אתה בטוח שברצונך למחוק את האורח?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmGuestId(null)}>
            ביטול
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (deleteConfirmGuestId) {
                deleteGuest(deleteConfirmGuestId);
                setDeleteConfirmGuestId(null);
              }
            }}
          >
            מחיקה
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Change count dialog */}
      <ResponsiveDialog
        open={!!changeCountGuestId}
        onClose={() => setChangeCountGuestId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>שנה כמות</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="כמות צפויה"
              type="number"
              inputMode="numeric"
              fullWidth
              value={changeCountValues.expectedCount}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : parseInt(e.target.value) || 0;
                setChangeCountValues({ ...changeCountValues, expectedCount: val });
              }}
              inputProps={{ min: 1 }}
            />
            <TextField
              label="כמות שאושרה"
              type="number"
              inputMode="numeric"
              fullWidth
              value={changeCountValues.confirmedCount}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : parseInt(e.target.value) || 0;
                setChangeCountValues({ ...changeCountValues, confirmedCount: val });
              }}
              inputProps={{ min: 1 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChangeCountGuestId(null)}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (changeCountGuestId) {
                const updatedData: Partial<Guest> = {};
                
                const expected = changeCountValues.expectedCount;
                if (expected !== undefined && expected !== null && expected !== '') {
                  const n = Number(expected);
                  if (Number.isFinite(n) && n >= 1) {
                    updatedData.expectedCount = n;
                  }
                }
                
                const confirmed = changeCountValues.confirmedCount;
                if (confirmed !== undefined && confirmed !== null && confirmed !== '') {
                  const n = Number(confirmed);
                  if (Number.isFinite(n) && n >= 1) {
                    updatedData.confirmedCount = n;
                  }
                }
                
                updateGuest(changeCountGuestId, updatedData);
                setChangeCountGuestId(null);
                setChangeCountValues({ expectedCount: '', confirmedCount: '' });
              }
            }}
          >
            שמור
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Content Section */}
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {/* Imported Guests Section - Desktop */}
        {!isMobile && (
          <ImportedGuestsSection 
            onRefresh={() => setRefreshKey(prev => prev + 1)} 
            uniqueGroups={uniqueGroups}
            hasTableNumbers={hasTableNumbers}
          />
        )}

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
                backgroundColor: statusFilter === 'all' ? '#6f74e0' : '#F2F3F5',
                color: statusFilter === 'all' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'all' ? '#6f74e0' : '#E5E7EB',
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
                backgroundColor: statusFilter === 'confirmed' ? '#6f74e0' : '#F2F3F5',
                color: statusFilter === 'confirmed' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'confirmed' ? '#6f74e0' : '#E5E7EB',
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
                backgroundColor: statusFilter === 'pending' ? '#6f74e0' : '#F2F3F5',
                color: statusFilter === 'pending' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'pending' ? '#6f74e0' : '#E5E7EB',
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
                backgroundColor: statusFilter === 'declined' ? '#6f74e0' : '#F2F3F5',
                color: statusFilter === 'declined' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'declined' ? '#6f74e0' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              דחו
            </Button>
            <Button
              onClick={() => {
                setStatusFilter('maybe');
                setPage(0);
              }}
              sx={{
                borderRadius: 3,
                minWidth: 80,
                px: 2,
                py: 1,
                textTransform: 'none',
                backgroundColor: statusFilter === 'maybe' ? '#6f74e0' : '#F2F3F5',
                color: statusFilter === 'maybe' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'maybe' ? '#6f74e0' : '#E5E7EB',
                  boxShadow: 'none'
                }
              }}
            >
              אולי
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
                backgroundColor: statusFilter === 'withNotes' ? '#6f74e0' : '#F2F3F5',
                color: statusFilter === 'withNotes' ? 'white' : '#363B4D',
                fontWeight: 500,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: statusFilter === 'withNotes' ? '#6f74e0' : '#E5E7EB',
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
              position: 'relative',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden'
            }}
          >
            {/* In-place loader: refetch keeps the rows visible, just shows a bar */}
            {guestsLoading && filteredGuests.length > 0 && (
              <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, height: 3, bgcolor: 'transparent', '& .MuiLinearProgress-bar': { backgroundColor: '#6f74e0' } }} />
            )}
            <Table
              sx={{ 
                borderCollapse: 'separate', 
                borderSpacing: 0
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" sx={{ backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>
                    <Checkbox
                      size="small"
                      checked={filteredGuests.length > 0 && filteredGuests.every(g => selectedIds.has(g._id))}
                      indeterminate={filteredGuests.some(g => selectedIds.has(g._id)) && !filteredGuests.every(g => selectedIds.has(g._id))}
                      onChange={() => toggleSelectAll(filteredGuests.map(g => g._id))}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>שם מלא</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>טלפון</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>קבוצה</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>סטטוס</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>כמות אורחים צפויה</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>כמות אורחים שאושרה</TableCell>
                  {hasTableNumbers && (
                    <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>מספר שולחן</TableCell>
                  )}
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>הערות</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, backgroundColor: 'background.default', borderBottom: '1px solid', borderBottomColor: 'divider' }}>פעולות</TableCell>
                </TableRow>
              </TableHead>
          <TableBody sx={{ opacity: guestsLoading && filteredGuests.length > 0 ? 0.5 : 1, transition: 'opacity .2s ease' }}>
            {guestsLoading && filteredGuests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={hasTableNumbers ? 10 : 9} align="center" sx={{ backgroundColor: 'white', borderBottom: 'none' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
                    <CircularProgress size={40} />
                  </Box>
                </TableCell>
              </TableRow>
            ) : filteredGuests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={hasTableNumbers ? 10 : 9} align="center" sx={{ backgroundColor: 'white', borderBottom: 'none' }}>
                  <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ fontSize: '2.6rem', mb: 0.5 }}>{searchQuery || filtersActive ? '🔍' : '📋'}</Box>
                    <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: 'text.primary' }}>
                      {searchQuery ? 'לא נמצאו תוצאות' : filtersActive ? 'אין אורחים שתואמים לסינון' : 'עוד אין מוזמנים'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 340, lineHeight: 1.6 }}>
                      {searchQuery ? 'נסו שם אחר, או נקו את החיפוש.' : filtersActive ? 'נסו סינון אחר, או נקו את הסינון.' : 'מוסיפים את רשימת המוזמנים - ומכאן אנחנו שולחים את ההזמנות ורודפים אחרי האישורים.'}
                    </Typography>
                    {!searchQuery && filtersActive && (
                      <Button onClick={clearFilters} variant="outlined"
                        sx={{ mt: 1.5, borderRadius: 2.5, px: 3, py: 1, fontWeight: 700, textTransform: 'none', color: '#6f74e0', borderColor: '#6f74e0', '&:hover': { borderColor: '#5f64d6', bgcolor: alpha('#6f74e0', 0.04) } }}>
                        ניקוי סינון
                      </Button>
                    )}
                    {!searchQuery && !filtersActive && (
                      <Button onClick={() => setGuestModalOpen(true)} startIcon={<AddIcon />} variant="contained" disableElevation
                        sx={{ mt: 1.5, borderRadius: 2.5, px: 3, py: 1, fontWeight: 700, textTransform: 'none', bgcolor: '#6f74e0', '&:hover': { bgcolor: '#5f64d6' } }}>
                        הוספת אורחים
                      </Button>
                    )}
                  </Box>
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
                      <TableCell padding="checkbox" sx={{ backgroundColor: 'white' }}>
                        <Checkbox
                          size="small"
                          checked={selectedIds.has(guest._id)}
                          onChange={() => toggleSelect(guest._id)}
                        />
                      </TableCell>
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
                            dir="ltr"
                            sx={{ cursor: 'pointer', unicodeBidi: 'isolate' }}
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
                                const newValue = e.target.value as 'pending' | 'confirmed' | 'declined' | 'maybe';
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
                              <MenuItem value="maybe">אולי</MenuItem>
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
                      {/* Notes column */}
                      <TableCell align="center" sx={{ backgroundColor: 'white', maxWidth: 240 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            textAlign: 'right',
                            color: guest.note ? 'text.primary' : 'text.secondary',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={guest.note || undefined}
                        >
                          {guest.note && guest.note.trim().length > 0 ? guest.note : '-'}
                        </Typography>
                      </TableCell>
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
                            onClick={() => setDeleteConfirmGuestId(guest._id)}
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
                : `מציג ${Math.min(page * rowsPerPage + 1, totalForDisplay)}-${Math.min((page + 1) * rowsPerPage, totalForDisplay)} מתוך ${totalForDisplay}`
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
          {/* Imported Guests Widget - Mobile */}
          {isMobile && (
            <ImportedGuestsWidget onClick={() => navigate('/guests/imported')} />
          )}

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
                    backgroundColor: statusFilter === 'all' ? '#6f74e0' : '#F2F3F5',
                    color: statusFilter === 'all' ? 'white' : '#363B4D',
                    fontWeight: 500,
                    boxShadow: 'none',
                    flexShrink: 0,
                    '&:hover': {
                      backgroundColor: statusFilter === 'all' ? '#6f74e0' : '#E5E7EB',
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
                    backgroundColor: statusFilter === 'confirmed' ? '#6f74e0' : '#F2F3F5',
                    color: statusFilter === 'confirmed' ? 'white' : '#363B4D',
                    fontWeight: 500,
                    boxShadow: 'none',
                    flexShrink: 0,
                    '&:hover': {
                      backgroundColor: statusFilter === 'confirmed' ? '#6f74e0' : '#E5E7EB',
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
                    backgroundColor: statusFilter === 'pending' ? '#6f74e0' : '#F2F3F5',
                    color: statusFilter === 'pending' ? 'white' : '#363B4D',
                    fontWeight: 500,
                    boxShadow: 'none',
                    flexShrink: 0,
                    '&:hover': {
                      backgroundColor: statusFilter === 'pending' ? '#6f74e0' : '#E5E7EB',
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
                    backgroundColor: statusFilter === 'declined' ? '#6f74e0' : '#F2F3F5',
                    color: statusFilter === 'declined' ? 'white' : '#363B4D',
                    fontWeight: 500,
                    boxShadow: 'none',
                    flexShrink: 0,
                    '&:hover': {
                      backgroundColor: statusFilter === 'declined' ? '#6f74e0' : '#E5E7EB',
                      boxShadow: 'none'
                    }
                  }}
                >
                  דחו
                </Button>
                <Button
                  onClick={() => {
                    setStatusFilter('maybe');
                    setPage(0);
                  }}
                  sx={{
                    borderRadius: 3,
                    minWidth: 80,
                    px: 2,
                    py: 1,
                    textTransform: 'none',
                    backgroundColor: statusFilter === 'maybe' ? '#6f74e0' : '#F2F3F5',
                    color: statusFilter === 'maybe' ? 'white' : '#363B4D',
                    fontWeight: 500,
                    boxShadow: 'none',
                    flexShrink: 0,
                    '&:hover': {
                      backgroundColor: statusFilter === 'maybe' ? '#6f74e0' : '#E5E7EB',
                      boxShadow: 'none'
                    }
                  }}
                >
                  אולי
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
                    backgroundColor: statusFilter === 'withNotes' ? '#6f74e0' : '#F2F3F5',
                    color: statusFilter === 'withNotes' ? 'white' : '#363B4D',
                    fontWeight: 500,
                    boxShadow: 'none',
                    flexShrink: 0,
                    '&:hover': {
                      backgroundColor: statusFilter === 'withNotes' ? '#6f74e0' : '#E5E7EB',
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
          {guestsLoading && filteredGuests.length > 0 && (
            <LinearProgress sx={{ mb: 2, height: 3, borderRadius: 2, bgcolor: 'transparent', '& .MuiLinearProgress-bar': { backgroundColor: '#6f74e0' } }} />
          )}
          <Grid container spacing={2} ref={tableRef} sx={{ opacity: guestsLoading && filteredGuests.length > 0 ? 0.5 : 1, transition: 'opacity .2s ease' }}>
            {guestsLoading && filteredGuests.length === 0 ? (
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                  <CircularProgress size={40} />
                </Box>
              </Grid>
            ) : filteredGuests.length === 0 ? (
              <Grid item xs={12}>
                <Box sx={{ p: 5, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ fontSize: '2.6rem', mb: 0.5 }}>{searchQuery || filtersActive ? '🔍' : '📋'}</Box>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: 'text.primary' }}>
                    {searchQuery ? 'לא נמצאו תוצאות' : filtersActive ? 'אין אורחים שתואמים לסינון' : 'עוד אין מוזמנים'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, lineHeight: 1.6 }}>
                    {searchQuery ? 'נסו שם אחר, או נקו את החיפוש.' : filtersActive ? 'נסו סינון אחר, או נקו את הסינון.' : 'מוסיפים את רשימת המוזמנים ומכאן אנחנו דואגים לשאר.'}
                  </Typography>
                  {!searchQuery && filtersActive && (
                    <Button onClick={clearFilters} variant="outlined"
                      sx={{ mt: 1.5, borderRadius: 2.5, px: 3, py: 1, fontWeight: 700, textTransform: 'none', color: '#6f74e0', borderColor: '#6f74e0', '&:hover': { borderColor: '#5f64d6', bgcolor: alpha('#6f74e0', 0.04) } }}>
                      ניקוי סינון
                    </Button>
                  )}
                  {!searchQuery && !filtersActive && (
                    <Button onClick={() => setGuestModalOpen(true)} startIcon={<AddIcon />} variant="contained" disableElevation
                      sx={{ mt: 1.5, borderRadius: 2.5, px: 3, py: 1, fontWeight: 700, textTransform: 'none', bgcolor: '#6f74e0', '&:hover': { bgcolor: '#5f64d6' } }}>
                      הוספת אורחים
                    </Button>
                  )}
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
                            onClick={() => setDeleteConfirmGuestId(guest._id)}
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
                          {/* Selection checkbox (top-leading corner) */}
                          <Checkbox
                            size="small"
                            checked={selectedIds.has(guest._id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSelect(guest._id)}
                            sx={{ position: 'absolute', top: 4, left: 4, p: 0.5, zIndex: 1 }}
                          />
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
                                    const newStatus = e.target.value as 'pending' | 'confirmed' | 'declined' | 'maybe';
                                    setEditValues({ ...editValues, [`${guest._id}_mobile_status`]: newStatus });
                                    updateGuestStatus(guest._id, newStatus);
                                  }}
                                  label="סטטוס"
                                  sx={{ backgroundColor: 'white' }}
                                >
                                  <MenuItem value="pending">ממתין</MenuItem>
                                  <MenuItem value="confirmed">מאשר הגעה</MenuItem>
                                  <MenuItem value="declined">דחה</MenuItem>
                                  <MenuItem value="maybe">אולי</MenuItem>
                                </Select>
                              </FormControl>
                              <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                  size="small"
                                  fullWidth
                                  type="number"
                                  label="כמות צפויה"
                                  value={editValues[`${guest._id}_mobile_expectedCount`] ?? guest.expectedCount ?? ''}
                                inputMode="numeric"
                                onChange={(e) => {
                                  const digitsOnly = e.target.value.replace(/\D/g, '');
                                  const numericValue = digitsOnly === '' ? '' : Number(digitsOnly);
                                  setEditValues({ ...editValues, [`${guest._id}_mobile_expectedCount`]: numericValue });
                                }}
                                  sx={{ backgroundColor: 'white' }}
                                />
                                <TextField
                                  size="small"
                                  fullWidth
                                  type="number"
                                  label="כמות שאושרה"
                                  value={editValues[`${guest._id}_mobile_confirmedCount`] ?? guest.confirmedCount ?? ''}
                                inputMode="numeric"
                                onChange={(e) => {
                                  const digitsOnly = e.target.value.replace(/\D/g, '');
                                  const numericValue = digitsOnly === '' ? '' : Number(digitsOnly);
                                  setEditValues({ ...editValues, [`${guest._id}_mobile_confirmedCount`]: numericValue });
                                }}
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

                                    const expected = expectedRaw === '' ? undefined : (expectedRaw ?? guest.expectedCount);
                                    if (expected !== undefined && expected !== null) {
                                      const n = Number(expected);
                                      if (Number.isFinite(n) && n >= 1) {
                                        updatedData.expectedCount = n;
                                      }
                                    }

                                    const confirmed = confirmedRaw === '' ? undefined : (confirmedRaw ?? guest.confirmedCount);
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
                                <Typography variant="body2" color="text.secondary" dir="ltr" sx={{ mb: 1, textAlign: 'right', width: '100%', unicodeBidi: 'isolate' }}>
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
                                      <WarningIcon sx={{ fontSize: 16, color: '#d97706' }} />
                                    )}
                                    <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
                                      {hasResponded
                                        ? (guest.lastResponse
                                            ? `ענו ב-${guest.lastResponse.toLocaleDateString('he-IL')}`
                                            : statusLabels[guest.status])
                                        : 'ממתין לתשובה'}
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
                            {/* Response History - real activity timeline */}
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
                                <GuestTimeline guestId={guest._id} />
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
                                        onClick={() => {
                                          setChangeCountGuestId(guest._id);
                                          setChangeCountValues({
                                            expectedCount: guest.expectedCount ?? '',
                                            confirmedCount: guest.confirmedCount ?? '',
                                          });
                                        }}
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
                                value={guestNotes[guest._id] ?? guest.note ?? ''}
                                onChange={(e) => {
                                  setGuestNotes({ ...guestNotes, [guest._id]: e.target.value });
                                }}
                                onBlur={() => {
                                  const note = guestNotes[guest._id];
                                  // Only save if the field was actually edited (including clearing it)
                                  if (note !== undefined && note !== (guest.note || '')) {
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
              : `מציג ${Math.min(page * rowsPerPage + 1, totalForDisplay)}-${Math.min((page + 1) * rowsPerPage, totalForDisplay)} מתוך ${totalForDisplay}`
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
      <ResponsiveDialog 
        open={guestModalOpen} 
        onClose={() => setGuestModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>הוספת אורח חדש</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
                  label="שם מלא"
              required
                  value={newGuest.name}
                  onChange={(e) => setNewGuest(prev => ({ ...prev, name: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Box sx={{ display: 'flex', flexDirection: 'row-reverse', gap: 1 }}>
                  <TextField
                    select
                    value={newGuest.countryCode}
                    onChange={(e) => setNewGuest(prev => ({ ...prev, countryCode: e.target.value }))}
                    sx={{
                      minWidth: { xs: 90, sm: 110 },
                      width: { xs: 90, sm: 110 },
                      flexShrink: 0,
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 1.5,
                        height: 56,
                        bgcolor: '#f9fafb',
                        '& fieldset': {
                          borderColor: '#e0e0e0',
                        },
                        '&:hover fieldset': {
                          borderColor: '#d1d5db',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#6f74e0',
                          boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
                        },
                        '& .MuiSelect-select': {
                          fontSize: { xs: 12, sm: 13 },
                        },
                      },
                    }}
                    SelectProps={{
                      renderValue: (value) => (value as string) || '+972',
                    }}
                    inputProps={{ style: { direction: 'rtl', textAlign: 'right' } }}
                  >
                    {countryOptions.map((option) => (
                      <MenuItem key={option.code + option.dialCode} value={option.dialCode}>
                        {option.flag} {option.name} ({option.dialCode})
                      </MenuItem>
                    ))}
                  </TextField>
            <TextField
              fullWidth
                    label="מספר טלפון"
              required
                    type="tel"
                    inputMode="numeric"
                    value={newGuest.phone}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const onlyDigits = e.target.value.replace(/\D/g, '');
                      setNewGuest(prev => ({ ...prev, phone: onlyDigits }));
                    }}
                    inputProps={{
                      style: { direction: 'rtl', textAlign: 'right' },
                      pattern: '[0-9]*',
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 1.5,
                        bgcolor: '#f9fafb',
                        '& fieldset': {
                          borderColor: '#e0e0e0',
                        },
                        '&:hover fieldset': {
                          borderColor: '#d1d5db',
                        },
                        '&.Mui-focused fieldset': {
                          borderColor: '#6f74e0',
                          boxShadow: '0 0 0 1px rgba(59,130,246,0.45)',
                        },
                      },
                    }}
                  />
                </Box>
              </Grid>
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  freeSolo
                  fullWidth
                  options={uniqueGroups}
                  value={newGuest.group}
                  onChange={(event, newValue) => {
                    const value = typeof newValue === 'string' ? newValue : newValue || '';
                    setNewGuest(prev => ({ ...prev, group: value }));
                  }}
                  onInputChange={(event, newInputValue) => {
                    setNewGuest(prev => ({ ...prev, group: newInputValue }));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="קבוצה"
                      placeholder="לדוגמה: משפחה, חברים, עבודה"
                      fullWidth
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>סטטוס</InputLabel>
                  <Select
                    label="סטטוס"
                    value={newGuest.status}
                    onChange={(e) =>
                      setNewGuest(prev => ({ ...prev, status: e.target.value as 'pending' | 'confirmed' | 'declined' | 'maybe' }))
                    }
                  >
                    <MenuItem value="pending">ממתין</MenuItem>
                    <MenuItem value="confirmed">מאשר הגעה</MenuItem>
                    <MenuItem value="declined">לא מגיע</MenuItem>
                    <MenuItem value="maybe">אולי</MenuItem>
              </Select>
            </FormControl>
              </Grid>
            </Grid>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  type="number"
                  label="כמות מוזמנים"
                  value={newGuest.expectedCount}
                  onChange={(e) =>
                    setNewGuest(prev => ({ ...prev, expectedCount: e.target.value }))
                  }
                  inputProps={{ min: 1 }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  type="number"
                  label="כמות שאישרו"
                  value={newGuest.confirmedCount}
                  onChange={(e) =>
                    setNewGuest(prev => ({ ...prev, confirmedCount: e.target.value }))
                  }
                  inputProps={{ min: 1 }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  type="number"
                  label="מספר שולחן"
                  value={newGuest.tableNumber}
                  onChange={(e) =>
                    setNewGuest(prev => ({ ...prev, tableNumber: e.target.value }))
                  }
                  inputProps={{ min: 1 }}
                />
              </Grid>
            </Grid>

            <TextField
              fullWidth
              label="הערה"
              multiline
              rows={3}
              value={newGuest.note}
              onChange={(e) => setNewGuest(prev => ({ ...prev, note: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGuestModalOpen(false)}>ביטול</Button>
          <Button 
            variant="contained" 
            onClick={createGuest}
            disabled={savingNewGuest}
          >
            {savingNewGuest ? 'שומר...' : 'שמירה'}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Import Modal */}
      <ResponsiveDialog
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ px: 3, pt: 3, pb: 0 }}>
          <Typography component="div" sx={{ fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            איפה האורחים שלכם?
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: '0.9rem', color: 'text.secondary' }}>
            בחרו כיצד תרצו לייבא את רשימת האורחים.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ px: 3, pt: 3, pb: 1 }}>
          {/* segmented control */}
          <Box sx={{ display: 'flex', gap: 0.5, p: '4px', bgcolor: alpha('#6f74e0', 0.07), borderRadius: 2.5, mb: 3 }}>
            {([
              { key: 'whatsapp' as const, label: 'וואטסאפ' },
              { key: 'upload' as const, label: 'קובץ' },
            ]).map((t) => {
              const active = importTab === t.key;
              return (
                <Box key={t.key} onClick={() => setImportTab(t.key)}
                  sx={{ flex: 1, textAlign: 'center', py: 0.85, borderRadius: 2, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
                    color: active ? '#5f64d6' : 'text.secondary', bgcolor: active ? '#fff' : 'transparent',
                    boxShadow: active ? '0 1px 3px rgba(16,24,40,0.12)' : 'none', transition: 'all .15s ease' }}>
                  {t.label}
                </Box>
              );
            })}
          </Box>

          {importTab === 'whatsapp' ? (
            <Stack spacing={2.5} sx={{ pb: 1 }}>
              <Card elevation={0} sx={{ borderRadius: 3, bgcolor: alpha('#25D366', 0.05), p: 2.5 }}>
                <Stack spacing={1.5} alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <WhatsAppIcon sx={{ color: '#25D366', fontSize: 22 }} />
                    <Typography sx={{ fontWeight: 700, fontSize: '0.95rem' }}>סרקו את הקוד</Typography>
                  </Stack>
                  <Box sx={{ width: 148, height: 148, borderRadius: 2.5, bgcolor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    <Box sx={{ position: 'absolute', textAlign: 'center', color: alpha('#0b3d2e', 0.35) }}>
                      <WhatsAppIcon sx={{ fontSize: 34, color: alpha('#25D366', 0.5) }} />
                      <Typography variant="caption" sx={{ display: 'block' }}>QR</Typography>
                    </Box>
                    <img src="/import-whatsapp-qr.png" alt="QR" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'contain' }} />
                  </Box>
                </Stack>
              </Card>

              <Divider sx={{ color: 'text.disabled', fontSize: '0.8rem', '&::before, &::after': { borderColor: 'divider' } }}>או</Divider>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button fullWidth variant="outlined" startIcon={<ContentCopyIcon sx={{ fontSize: 18 }} />} onClick={handleCopyPhone}
                  sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, color: 'text.primary', borderColor: 'divider', '&:hover': { borderColor: '#6f74e0', bgcolor: alpha('#6f74e0', 0.04) } }}>
                  {copiedPhone ? 'הועתק ✓' : whatsappNumber}
                </Button>
                <Button fullWidth variant="contained" disableElevation startIcon={<WhatsAppIcon sx={{ fontSize: 20 }} />}
                  href={`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
                  sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, bgcolor: '#25D366', '&:hover': { bgcolor: '#128C7E' } }}>
                  פתיחת וואטסאפ
                </Button>
              </Stack>

              <Typography sx={{ textAlign: 'center', fontSize: '0.82rem', color: 'text.secondary' }}>
                שלחו, והאורחים יופיעו מיד תחת ״אורחים שיובאו״.
              </Typography>

              {events.filter((e) => e.id !== selectedEvent?.id).length > 0 && (
                <Box sx={{ textAlign: 'center' }}>
                  <Button variant="text" startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />} onClick={() => setCopyGuestsOpen(true)}
                    sx={{ textTransform: 'none', color: '#6f74e0', fontWeight: 600, fontSize: '0.85rem' }}>
                    או העתקה מאירוע קודם
                  </Button>
                </Box>
              )}
            </Stack>
          ) : (
            <Stack spacing={2.5} sx={{ pb: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }}>הורדת תבנית</Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" startIcon={<FileDownloadIcon sx={{ fontSize: 16 }} />} onClick={() => handleDownloadTemplate('csv')}
                    sx={{ borderRadius: 2, textTransform: 'none', borderColor: 'divider', color: 'text.primary' }}>CSV</Button>
                  <Button size="small" variant="outlined" startIcon={<FileDownloadIcon sx={{ fontSize: 16 }} />} onClick={() => handleDownloadTemplate('xlsx')}
                    sx={{ borderRadius: 2, textTransform: 'none', borderColor: 'divider', color: 'text.primary' }}>Excel</Button>
                </Stack>
              </Stack>

              <Box
                onDragOver={(e) => { e.preventDefault(); setImportDragOver(true); }}
                onDragLeave={() => setImportDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setImportDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleImportFile(f); }}
                onClick={() => document.getElementById('excel-upload')?.click()}
                sx={{ cursor: 'pointer', borderRadius: 3, py: 5, px: 3, textAlign: 'center', border: '1.5px dashed', borderColor: importDragOver ? '#6f74e0' : alpha('#6f74e0', 0.28), bgcolor: importDragOver ? alpha('#6f74e0', 0.06) : alpha('#6f74e0', 0.02), transition: 'all .15s ease' }}>
                <UploadIcon sx={{ fontSize: 36, color: '#6f74e0', mb: 1 }} />
                <Typography sx={{ fontWeight: 700, fontSize: '1rem' }}>{importFile ? importFile.name : 'גררו קובץ לכאן'}</Typography>
                {!importFile && <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: 0.25 }}>או לחצו לבחירת קובץ</Typography>}
                <input accept=".xlsx,.xls,.csv" style={{ display: 'none' }} id="excel-upload" type="file" onChange={handleImportFileChange} />
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }} sx={{ color: 'text.secondary' }}>
                <Typography sx={{ fontSize: '0.82rem' }}>פורמטים נתמכים: CSV, Excel</Typography>
                <Typography sx={{ fontSize: '0.82rem' }}>שדות חובה: שם מלא, טלפון</Typography>
              </Stack>

              {importPreview && (
                <Box>
                  <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                    <Chip size="small" color="success" label={`${importPreview.validCount} תקינים`} />
                    {importPreview.duplicateCount > 0 && <Chip size="small" color="warning" label={`${importPreview.duplicateCount} כפילויות`} />}
                    {importPreview.invalidCount > 0 && <Chip size="small" color="error" label={`${importPreview.invalidCount} שגויים`} />}
                  </Stack>
                  <Box sx={{ maxHeight: 180, overflowY: 'auto', borderRadius: 2, bgcolor: alpha('#6f74e0', 0.03) }}>
                    {importPreview.rows.slice(0, 50).map((r, i) => (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.75 }}>
                        <Box sx={{ display: 'flex', gap: 2, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{r.name || '-'}</Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>{r.phone || '-'}</Typography>
                        </Box>
                        {r.valid ? <CheckCircleIcon color="success" fontSize="small" /> : <Chip size="small" color={r.issue === 'כפילות' ? 'warning' : 'error'} label={r.issue} />}
                      </Box>
                    ))}
                  </Box>
                  {importPreview.validCount === 0 && (
                    <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2 }}>לא נמצאו שורות תקינות. ודאו שהקובץ כולל עמודות ״שם״ ו״טלפון״.</Alert>
                  )}
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, pt: 1.5, justifyContent: 'space-between' }}>
          {importTab === 'upload' ? (
            <Button variant="contained" disableElevation onClick={handleImportGuests}
              disabled={importing || !importFile || (importPreview !== null && importPreview.validCount === 0)}
              sx={{ borderRadius: 2, px: 3, fontWeight: 700, textTransform: 'none', bgcolor: '#6f74e0', '&:hover': { bgcolor: '#5f64d6' } }}>
              {importing ? 'מייבא...' : importPreview ? `ייבוא ${importPreview.validCount} אורחים` : 'ייבוא'}
            </Button>
          ) : <Box />}
          <Button variant="text" onClick={() => setImportModalOpen(false)} sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'none' }}>ביטול</Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Edit Guest Modal */}
      <ResponsiveDialog 
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
                  <MenuItem value="maybe">אולי</MenuItem>
                </Select>
              </FormControl>

              {/* Activity timeline */}
              <Divider sx={{ mt: 1 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                היסטוריית פעילות
              </Typography>
              <GuestTimeline guestId={editingGuestData._id} />
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
                  updateGuestStatus(editingGuestData._id, newStatus as 'pending' | 'confirmed' | 'declined' | 'maybe');
                }
                updateGuest(editingGuestData._id, updatedData);
              }
            }}
          >
            שמור
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Bulk action bar (appears when guests are selected) */}
      <BulkActionsBar
        count={selectedIds.size}
        busy={bulkBusy}
        onTag={() => setTagDialogOpen(true)}
        onMoveGroup={() => setBulkGroupOpen(true)}
        onDelete={() => setBulkDeleteOpen(true)}
        onClear={clearSelection}
      />

      {/* Multi-event reuse: copy guests from another event */}
      {selectedEvent?.id && (
        <CopyGuestsDialog
          open={copyGuestsOpen}
          currentEventId={selectedEvent.id}
          events={events}
          onClose={() => setCopyGuestsOpen(false)}
          onDone={(copied, failed) => {
            setCopyGuestsOpen(false);
            setImportModalOpen(false);
            setRefreshKey(prev => prev + 1);
            setStatsRefreshKey(prev => prev + 1);
            setSnackbar({
              open: true,
              message: failed ? `הועתקו ${copied} אורחים, נכשלו ${failed}` : `${copied} אורחים הועתקו בהצלחה`,
              severity: failed ? 'error' : 'success',
            });
          }}
        />
      )}

      {/* Bulk: tag picker */}
      {selectedEvent?.id && (
        <TagPickerDialog
          open={tagDialogOpen}
          eventId={selectedEvent.id}
          selectedCount={selectedIds.size}
          onClose={() => setTagDialogOpen(false)}
          onPick={bulkAssignTag}
        />
      )}

      {/* Bulk: move to group */}
      <ResponsiveDialog open={bulkGroupOpen} onClose={() => setBulkGroupOpen(false)} maxWidth="xs" fullWidth dir="rtl">
        <DialogTitle>העברת {selectedIds.size} אורחים לקבוצה</DialogTitle>
        <DialogContent>
          <Autocomplete
            freeSolo
            fullWidth
            options={uniqueGroups}
            value={bulkGroupValue}
            onChange={(_, v) => setBulkGroupValue(typeof v === 'string' ? v : v || '')}
            onInputChange={(_, v) => setBulkGroupValue(v)}
            renderInput={(params) => <TextField {...params} label="שם הקבוצה" sx={{ mt: 1 }} />}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkGroupOpen(false)} disabled={bulkBusy}>ביטול</Button>
          <Button variant="contained" onClick={bulkMoveGroup} disabled={bulkBusy || !bulkGroupValue.trim()}>
            העבר
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Bulk: delete confirmation */}
      <ResponsiveDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} maxWidth="xs" fullWidth dir="rtl">
        <DialogTitle>מחיקת {selectedIds.size} אורחים</DialogTitle>
        <DialogContent>
          <Typography>האם למחוק את {selectedIds.size} האורחים שנבחרו? לא ניתן לבטל פעולה זו.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDeleteOpen(false)} disabled={bulkBusy}>ביטול</Button>
          <Button variant="contained" color="error" onClick={bulkDelete} disabled={bulkBusy}>
            מחק
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}

export default Guests; 