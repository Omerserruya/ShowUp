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
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  alpha,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Warning as WarningIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useGuestImports, approveGuestImportContact, rejectGuestImportContact, GuestImportContact } from '../hooks/useGuestImports';

interface ImportedGuestsSectionProps {
  onRefresh?: () => void;
}

/**
 * Desktop section for reviewing and approving imported guests
 * Displays between action buttons and guest table
 */
export function ImportedGuestsSection({ onRefresh }: ImportedGuestsSectionProps) {
  const { imports, loading, error } = useGuestImports();
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, { name: string; email: string }>>({});
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

  const handleEdit = (contactId: string, contact: GuestImportContact) => {
    setEditingContact(contactId);
    setEditValues({
      [contactId]: {
        name: contact.name || '',
        email: contact.email || '',
      },
    });
  };

  const handleSaveEdit = (contactId: string) => {
    setEditingContact(null);
    // In a real implementation, you might want to update the contact via API
    // For now, we'll just update local state
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

  const getValidationStatus = (contact: GuestImportContact) => {
    let errors: string[] = [];
    if (contact.validation_errors) {
      try {
        errors = JSON.parse(contact.validation_errors);
        if (!Array.isArray(errors)) {
          errors = [contact.validation_errors];
        }
      } catch {
        errors = [contact.validation_errors];
      }
    }
    if (errors.length > 0) {
      return { status: 'error', message: errors.join(', ') };
    }
    if (!contact.name) {
      return { status: 'warning', message: 'חסר שם' };
    }
    return { status: 'ok', message: '' };
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
    <Paper
      sx={{
        p: 3,
        mb: 3,
        borderRadius: 2,
        backgroundColor: alpha('#fff9c4', 0.3),
        border: '1px solid',
        borderColor: alpha('#f57c00', 0.3),
      }}
    >
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <WarningIcon sx={{ color: '#f57c00' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            אורחים שיובאו וממתינים לאישור
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
          האורחים האלו יובאו מ-WhatsApp ויש להשלים מידע ולאשר לפני שיופיעו ברשימה
        </Typography>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>שם</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>טלפון</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>אימייל</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>סטטוס</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="center">פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {allContacts.map((contact) => {
              const isEditing = editingContact === contact.id;
              const isProcessing = processing.has(contact.id);
              const validation = getValidationStatus(contact);

              return (
                <TableRow key={contact.id} sx={{ '&:hover': { backgroundColor: alpha('#fff9c4', 0.1) } }}>
                  <TableCell>
                    {isEditing ? (
                      <TextField
                        size="small"
                        value={editValues[contact.id]?.name || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            [contact.id]: { ...editValues[contact.id], name: e.target.value },
                          })
                        }
                        onBlur={() => handleSaveEdit(contact.id)}
                        autoFocus
                      />
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {contact.name || 'ללא שם'}
                        {!contact.name && (
                          <IconButton
                            size="small"
                            onClick={() => handleEdit(contact.id, contact)}
                            sx={{ p: 0.5 }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>{contact.phone || '-'}</TableCell>
                  <TableCell>
                    {isEditing ? (
                      <TextField
                        size="small"
                        type="email"
                        value={editValues[contact.id]?.email || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            [contact.id]: { ...editValues[contact.id], email: e.target.value },
                          })
                        }
                        onBlur={() => handleSaveEdit(contact.id)}
                      />
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {contact.email || '-'}
                        <IconButton
                          size="small"
                          onClick={() => handleEdit(contact.id, contact)}
                          sx={{ p: 0.5 }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    {validation.status === 'error' && (
                      <Chip
                        icon={<WarningIcon />}
                        label={validation.message}
                        size="small"
                        color="error"
                        sx={{ fontSize: '0.75rem' }}
                      />
                    )}
                    {validation.status === 'warning' && (
                      <Chip
                        icon={<WarningIcon />}
                        label={validation.message}
                        size="small"
                        color="warning"
                        sx={{ fontSize: '0.75rem' }}
                      />
                    )}
                    {validation.status === 'ok' && (
                      <Chip
                        icon={<CheckCircleIcon />}
                        label="מוכן לאישור"
                        size="small"
                        color="success"
                        sx={{ fontSize: '0.75rem' }}
                      />
                    )}
                  </TableCell>
                  <TableCell align="center">
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
  );
}

