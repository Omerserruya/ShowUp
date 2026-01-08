import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  alpha,
  AppBar,
  Toolbar,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Warning as WarningIcon,
  Edit as EditIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { useGuestImports, approveGuestImportContact, rejectGuestImportContact, GuestImportContact } from '../hooks/useGuestImports';

/**
 * Mobile screen for reviewing and approving imported guests
 * One guest per card layout
 */
export function ImportedGuestsReviewScreen() {
  const navigate = useNavigate();
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
  };

  const handleApprove = async (contactId: string) => {
    setProcessing((prev) => new Set(prev).add(contactId));
    try {
      await approveGuestImportContact(contactId);
      setSnackbar({ open: true, message: 'האורח אושר בהצלחה', severity: 'success' });
      
      // Reload data to refresh the list
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
      
      // Check if all contacts are processed
      const remainingContacts = allContacts.filter((c) => c.id !== contactId);
      if (remainingContacts.length === 0) {
        // Navigate back to guest list after a short delay
        setTimeout(() => {
          navigate('/guests');
        }, 1000);
      } else {
        // Reload data
        setTimeout(() => {
          window.location.reload();
        }, 1000);
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
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  // If all contacts are processed, navigate back
  if (allContacts.length === 0 && !loading) {
    // Use useEffect to navigate after render
    React.useEffect(() => {
      const timer = setTimeout(() => {
        navigate('/guests');
      }, 100);
      return () => clearTimeout(timer);
    }, [navigate]);
    
    return (
      <Box>
        <AppBar position="static" sx={{ backgroundColor: 'white', color: 'black' }}>
          <Toolbar>
            <IconButton edge="start" color="inherit" onClick={() => navigate('/guests')} sx={{ mr: 2 }}>
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              אורחים שיובאו
            </Typography>
          </Toolbar>
        </AppBar>
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            אין אורחים ממתינים לאישור
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <AppBar position="static" sx={{ backgroundColor: 'white', color: 'black' }}>
        <Toolbar>
          <IconButton edge="start" color="inherit" onClick={() => navigate('/guests')} sx={{ mr: 2 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            אורחים שיובאו – סקירה ואישור
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2, textAlign: 'right' }}>
          האורחים האלו יובאו מ-WhatsApp ויש להשלים מידע ולאשר לפני שיופיעו ברשימה
        </Typography>

        <Stack spacing={2}>
          {allContacts.map((contact) => {
            const isEditing = editingContact === contact.id;
            const isProcessing = processing.has(contact.id);
            const validation = getValidationStatus(contact);

            return (
              <Card
                key={contact.id}
                sx={{
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: alpha('#f57c00', 0.3),
                  backgroundColor: alpha('#fff9c4', 0.2),
                }}
              >
                <CardContent>
                  <Box sx={{ mb: 2 }}>
                    <Chip
                      label="יובא מ-WhatsApp"
                      size="small"
                      sx={{
                        backgroundColor: alpha('#f57c00', 0.2),
                        color: '#f57c00',
                        fontWeight: 600,
                      }}
                    />
                  </Box>

                  {/* Name */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                      שם
                    </Typography>
                    {isEditing ? (
                      <TextField
                        fullWidth
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
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="body1" sx={{ fontWeight: 500 }}>
                          {contact.name || 'ללא שם'}
                        </Typography>
                        <IconButton size="small" onClick={() => handleEdit(contact.id, contact)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </Box>

                  {/* Phone */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                      טלפון
                    </Typography>
                    <Typography variant="body1">{contact.phone || '-'}</Typography>
                  </Box>

                  {/* Email */}
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                      אימייל
                    </Typography>
                    {isEditing ? (
                      <TextField
                        fullWidth
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
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="body1">{contact.email || '-'}</Typography>
                        <IconButton size="small" onClick={() => handleEdit(contact.id, contact)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </Box>

                  {/* Validation Status */}
                  {validation.status !== 'ok' && (
                    <Box sx={{ mb: 2 }}>
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
                    </Box>
                  )}

                  {/* Actions */}
                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    <Button
                      variant="contained"
                      color="success"
                      fullWidth
                      startIcon={<CheckCircleIcon />}
                      onClick={() => handleApprove(contact.id)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? 'מעבד...' : 'אשר'}
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      fullWidth
                      startIcon={<CancelIcon />}
                      onClick={() => handleReject(contact.id)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? 'מעבד...' : 'דחה'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      </Box>
    </Box>
  );
}

