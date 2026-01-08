import React, { useState } from 'react';
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
  Autocomplete,
  FormControl,
  Select,
  MenuItem,
  Avatar,
  alpha,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Warning as WarningIcon,
  AccessTime as AccessTimeIcon,
} from '@mui/icons-material';
import { useGuestImports, approveGuestImportContact, rejectGuestImportContact, GuestImportContact } from '../hooks/useGuestImports';

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
  const { imports, loading, error } = useGuestImports();
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Flatten all contacts from all imports
  const allContacts: GuestImportContact[] = imports.flatMap((imp) => imp.contacts || []);

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

  const handleSaveEdit = (contactId: string, field: string) => {
    const newValue = editValues[`${contactId}_${field}`];
    // In a real implementation, you might want to update the contact via API
    // For now, we'll just update local state
    setEditingContact(null);
    setEditingField(null);
  };

  const handleApprove = async (contactId: string) => {
    setProcessing((prev) => new Set(prev).add(contactId));
    try {
      await approveGuestImportContact(contactId);
      setSnackbar({ open: true, message: 'האורח אושר בהצלחה', severity: 'success' });
      if (onRefresh) {
        onRefresh();
      }
      // Reload page data after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
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
      setSnackbar({ open: true, message: 'האורח נדחה', severity: 'success' });
      if (onRefresh) {
        onRefresh();
      }
      // Reload page data after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
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
                const isEditingEmail = editingContact === contact.id && editingField === 'email';
                const isEditingGroup = editingContact === contact.id && editingField === 'group';
                const isEditingStatus = editingContact === contact.id && editingField === 'status';
                const isEditingExpectedCount = editingContact === contact.id && editingField === 'expectedCount';
                const isEditingConfirmedCount = editingContact === contact.id && editingField === 'confirmedCount';
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

                    {/* Phone */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      <Typography variant="body2">
                        {(() => {
                          // Format phone number: if it starts with +972, show it as 972+ (RTL)
                          const phone = contact.phone || '';
                          if (phone.startsWith('+972')) {
                            const rest = phone.substring(4).trim();
                            return `${rest} 972+`;
                          }
                          return phone || '-';
                        })()}
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
                          onDoubleClick={() => handleEdit(contact.id, 'group', '')}
                        >
                          -
                        </Typography>
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      {isEditingStatus ? (
                        <FormControl size="small" sx={{ minWidth: 120 }}>
                          <Select
                            value={editValues[`${contact.id}_status`] ?? 'pending'}
                            onChange={(e) => {
                              setEditValues({ ...editValues, [`${contact.id}_status`]: e.target.value });
                              handleSaveEdit(contact.id, 'status');
                            }}
                            onBlur={() => {
                              handleSaveEdit(contact.id, 'status');
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
                          onClick={() => handleEdit(contact.id, 'status', 'pending')}
                        >
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
                      )}
                    </TableCell>

                    {/* Expected Count */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      {isEditingExpectedCount ? (
                        <TextField
                          size="small"
                          type="number"
                          value={editValues[`${contact.id}_expectedCount`] ?? ''}
                          onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_expectedCount`]: parseInt(e.target.value) || 0 })}
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
                          onDoubleClick={() => handleEdit(contact.id, 'expectedCount', 0)}
                        >
                          -
                        </Typography>
                      )}
                    </TableCell>

                    {/* Confirmed Count */}
                    <TableCell align="center" sx={{ backgroundColor: 'white' }}>
                      {isEditingConfirmedCount ? (
                        <TextField
                          size="small"
                          type="number"
                          value={editValues[`${contact.id}_confirmedCount`] ?? ''}
                          onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_confirmedCount`]: parseInt(e.target.value) || 0 })}
                          onBlur={() => {
                            handleSaveEdit(contact.id, 'confirmedCount');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveEdit(contact.id, 'confirmedCount');
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
                          onDoubleClick={() => handleEdit(contact.id, 'confirmedCount', 0)}
                        >
                          -
                        </Typography>
                      )}
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
                            onDoubleClick={() => handleEdit(contact.id, 'tableNumber', undefined)}
                          >
                            -
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
      {snackbar.open && (
        <Alert 
          severity={snackbar.severity} 
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}
        >
          {snackbar.message}
        </Alert>
      )}
    </>
  );
}
