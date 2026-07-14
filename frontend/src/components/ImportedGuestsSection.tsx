import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Snackbar,
  Autocomplete,
  Avatar,
  alpha,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Warning as WarningIcon,
  AccessTime as AccessTimeIcon,
} from '@mui/icons-material';
import { useGuestImports, approveGuestImportContactWithData, rejectGuestImportContact, updateGuestImportContact, GuestImportContact } from '../hooks/useGuestImports';

interface ImportedGuestsSectionProps {
  onRefresh?: () => void;
  uniqueGroups: string[];
  hasTableNumbers: boolean;
}

/**
 * Desktop section for reviewing and approving imported guests
 * Displays as a separate section before the main guest table
 */
export function ImportedGuestsSection({ onRefresh, uniqueGroups, hasTableNumbers }: ImportedGuestsSectionProps) {
  const { imports, loading, error, refresh } = useGuestImports();
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [removedContactIds, setRemovedContactIds] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Flatten all contacts from all imports, excluding removed ones
  const allContacts: GuestImportContact[] = imports
    .flatMap((imp) => imp.contacts || [])
    .filter((contact) => !removedContactIds.has(contact.id));

  // Clean up removedContactIds when imports change (after refresh from backend)
  // Only keep IDs that are still in the current imports list
  useEffect(() => {
    const currentContactIds = new Set(imports.flatMap((imp) => (imp.contacts || []).map((c) => c.id)));
    setRemovedContactIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        // Only keep removed IDs if they're still in the imports (shouldn't happen, but just in case)
        if (currentContactIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [imports]);

  // If no pending imports, don't render
  if (!loading && allContacts.length === 0) {
    return null;
  }

  const handleEdit = (contactId: string, field: string, currentValue: any) => {
    setEditingContact(contactId);
    setEditingField(field);
    setEditValues({
      ...editValues,
      [`${contactId}_${field}`]: currentValue ?? '',
    });
  };

  const handleSaveEdit = async (contactId: string, field: string) => {
    const newValue = editValues[`${contactId}_${field}`];
    
    // Update via API for name, phone, email
    if (field === 'name' || field === 'phone' || field === 'email') {
      try {
        const updateData: { name?: string; phone?: string; email?: string } = {};
        if (field === 'name') updateData.name = newValue;
        if (field === 'phone') updateData.phone = newValue;
        if (field === 'email') updateData.email = newValue;
        
        await updateGuestImportContact(contactId, updateData);
        setSnackbar({ open: true, message: 'השדה עודכן בהצלחה', severity: 'success' });
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || 'שגיאה בעדכון השדה', severity: 'error' });
        return; // Don't close edit mode on error
      }
    }
    
    setEditingContact(null);
    setEditingField(null);
  };

  const handleApprove = async (contactId: string) => {
    setProcessing((prev) => new Set(prev).add(contactId));
    try {
      // Get edited values for this contact
      const contact = allContacts.find(c => c.id === contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      const approveData: { name?: string; group?: string; import_count?: number; table_number?: number } = {};
      
      // Use edited name if available, otherwise use contact name
      const editedName = editValues[`${contactId}_name`];
      if (editedName !== undefined && editedName !== contact.name) {
        approveData.name = editedName;
      }
      
      // Get edited group, expected count, table number
      const editedGroup = editValues[`${contactId}_group`];
      if (editedGroup) {
        approveData.group = editedGroup;
      }
      
      const editedExpectedCount = editValues[`${contactId}_expectedCount`];
      // Default to 1 if not set
      approveData.import_count = editedExpectedCount !== undefined && editedExpectedCount > 0 ? editedExpectedCount : 1;
      
      const editedTableNumber = editValues[`${contactId}_tableNumber`];
      if (editedTableNumber !== undefined && editedTableNumber > 0) {
        approveData.table_number = editedTableNumber;
      }

      await approveGuestImportContactWithData(contactId, approveData);
      // Remove contact from list immediately
      setRemovedContactIds((prev) => new Set(prev).add(contactId));
      setSnackbar({ open: true, message: 'האורח אושר בהצלחה', severity: 'success' });
      // Refresh the imports list
      refresh();
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'שגיאה באישור האורח', severity: 'error' });
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(contactId);
        return next;
      });
    }
  };

  const handleReject = async (contactId: string) => {
    setProcessing((prev) => new Set(prev).add(contactId));
    try {
      await rejectGuestImportContact(contactId);
      // Remove contact from list immediately
      setRemovedContactIds((prev) => new Set(prev).add(contactId));
      setSnackbar({ open: true, message: 'האורח נדחה', severity: 'success' });
      // Refresh the imports list
      refresh();
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'שגיאה בדחיית האורח', severity: 'error' });
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(contactId);
        return next;
      });
    }
  };

  const statusColors: Record<string, string> = {
    pending: '#ff9800',
    confirmed: '#4caf50',
    declined: '#f44336',
  };

  const statusLabels: Record<string, string> = {
    pending: 'ממתין',
    confirmed: 'מאשר הגעה',
    declined: 'דחה',
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <>
      <Paper
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 2,
          backgroundColor: 'white',
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <WarningIcon sx={{ color: 'warning.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              אורחים שיובאו וממתינים לאישור
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
            האורחים האלו יובאו מ-WhatsApp ויש להשלים מידע ולאשר לפני שיופיעו ברשימה
          </Typography>
        </Box>

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
              {allContacts.map((contact, index) => {
                const isProcessing = processing.has(contact.id);
                const isEditingName = editingContact === contact.id && editingField === 'name';
                const isEditingGroup = editingContact === contact.id && editingField === 'group';
                const isEditingExpectedCount = editingContact === contact.id && editingField === 'expectedCount';
                const isEditingTableNumber = editingContact === contact.id && editingField === 'tableNumber';

                return (
                  <TableRow 
                    key={contact.id}
                    hover
                    sx={{ 
                      backgroundColor: 'white',
                      borderBottom: index < allContacts.length - 1 ? '1px solid' : 'none',
                      borderBottomColor: 'divider'
                    }}
                  >
                    {/* Name */}
                    <TableCell align="right" sx={{ backgroundColor: 'white', textAlign: 'right' }}>
                      {isEditingName ? (
                        <TextField
                          size="small"
                          value={editValues[`${contact.id}_name`] ?? contact.name ?? ''}
                          onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_name`]: e.target.value })}
                          onBlur={() => {
                            handleSaveEdit(contact.id, 'name');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveEdit(contact.id, 'name');
                            } else if (e.key === 'Escape') {
                              setEditingContact(null);
                              setEditingField(null);
                            }
                          }}
                          autoFocus
                          sx={{ width: '100%' }}
                        />
                      ) : (
                        <Box 
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, flexDirection: 'row-reverse', width: '100%', cursor: 'pointer' }}
                          onDoubleClick={() => handleEdit(contact.id, 'name', contact.name)}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 500, width: "100%", textAlign: 'right' }}>
                            {contact.name || 'ללא שם'}
                          </Typography>
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              bgcolor: statusColors.pending,
                              fontSize: '0.875rem'
                            }}
                          >
                            {(contact.name || '?').charAt(0)}
                          </Avatar>
                        </Box>
                      )}
                    </TableCell>

                    {/* Phone - rendered LTR so E.164 numbers don't get reordered in RTL context */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      <Typography variant="body2" dir="ltr" sx={{ unicodeBidi: 'isolate' }}>
                        {contact.phone || '-'}
                      </Typography>
                    </TableCell>

                    {/* Group */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      {isEditingGroup ? (
                        <Autocomplete
                          freeSolo
                          size="small"
                          options={uniqueGroups}
                          value={editValues[`${contact.id}_group`] ?? ''}
                          onChange={(event, newValue) => {
                            const value = typeof newValue === 'string' ? newValue : newValue || '';
                            setEditValues({ ...editValues, [`${contact.id}_group`]: value });
                            handleSaveEdit(contact.id, 'group');
                          }}
                          onBlur={() => {
                            handleSaveEdit(contact.id, 'group');
                          }}
                          onInputChange={(event, newInputValue) => {
                            setEditValues({ ...editValues, [`${contact.id}_group`]: newInputValue });
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              autoFocus
                              sx={{ width: 150 }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSaveEdit(contact.id, 'group');
                                } else if (e.key === 'Escape') {
                                  setEditingContact(null);
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
                          onDoubleClick={() => handleEdit(contact.id, 'group', editValues[`${contact.id}_group`] ?? '')}
                        >
                          {editValues[`${contact.id}_group`] || '-'}
                        </Typography>
                      )}
                    </TableCell>

                    {/* Status - imported contacts are always pending until approved (not editable here) */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Chip
                          icon={<AccessTimeIcon />}
                          label={statusLabels.pending}
                          size="small"
                          sx={{
                            backgroundColor: alpha(statusColors.pending, 0.1),
                            color: statusColors.pending,
                            fontWeight: 500,
                            '& .MuiChip-icon': {
                              color: statusColors.pending
                            }
                          }}
                        />
                      </Box>
                    </TableCell>

                    {/* Expected Count */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      {isEditingExpectedCount ? (
                        <TextField
                          size="small"
                          type="number"
                          value={editValues[`${contact.id}_expectedCount`] ?? 1}
                          onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_expectedCount`]: parseInt(e.target.value) || 1 })}
                          onBlur={() => {
                            handleSaveEdit(contact.id, 'expectedCount');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveEdit(contact.id, 'expectedCount');
                            } else if (e.key === 'Escape') {
                              setEditingContact(null);
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
                          onDoubleClick={() => handleEdit(contact.id, 'expectedCount', editValues[`${contact.id}_expectedCount`] ?? 1)}
                        >
                          {editValues[`${contact.id}_expectedCount`] ?? 1}
                        </Typography>
                      )}
                    </TableCell>

                    {/* Confirmed Count - determined by the guest's RSVP after approval (not editable here) */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                        -
                      </Typography>
                    </TableCell>

                    {/* Table Number */}
                    {hasTableNumbers && (
                      <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                        {isEditingTableNumber ? (
                          <TextField
                            size="small"
                            type="number"
                            value={editValues[`${contact.id}_tableNumber`] ?? ''}
                            onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_tableNumber`]: parseInt(e.target.value) || undefined })}
                            onBlur={() => {
                              handleSaveEdit(contact.id, 'tableNumber');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveEdit(contact.id, 'tableNumber');
                              } else if (e.key === 'Escape') {
                                setEditingContact(null);
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
                            onDoubleClick={() => handleEdit(contact.id, 'tableNumber', editValues[`${contact.id}_tableNumber`])}
                          >
                            {editValues[`${contact.id}_tableNumber`] ?? '-'}
                          </Typography>
                        )}
                      </TableCell>
                    )}

                    {/* Actions */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                        <Button
                          variant="contained"
                          color="success"
                          size="small"
                          startIcon={<CheckCircleIcon />}
                          onClick={() => handleApprove(contact.id)}
                          disabled={isProcessing}
                          sx={{ minWidth: 80 }}
                        >
                          {isProcessing ? '...' : 'אשר'}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          startIcon={<CancelIcon />}
                          onClick={() => handleReject(contact.id)}
                          disabled={isProcessing}
                          sx={{ minWidth: 80 }}
                        >
                          {isProcessing ? '...' : 'דחה'}
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

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
    </>
  );
}
