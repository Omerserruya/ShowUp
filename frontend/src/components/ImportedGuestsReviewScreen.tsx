import React, { useState, useEffect } from 'react';
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
  LinearProgress,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Warning as WarningIcon,
  ArrowBack as ArrowBackIcon,
  WhatsApp as WhatsAppIcon,
  Phone as PhoneIcon,
  Restaurant as RestaurantIcon,
  Info as InfoIcon,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material';
import { Autocomplete } from '@mui/material';
import { useGuestImports, approveGuestImportContact, rejectGuestImportContact, GuestImportContact } from '../hooks/useGuestImports';
import { useGuests } from '../hooks/useOverviewData';

/**
 * Mobile screen for reviewing and approving imported guests
 * One guest per card layout with summary card
 */
export function ImportedGuestsReviewScreen() {
  const navigate = useNavigate();
  const { imports, loading, error } = useGuestImports();
  const { guests } = useGuests();
  
  // Get unique groups from existing guests
  const uniqueGroups = Array.from(new Set(guests.map(guest => guest.group).filter((g): g is string => Boolean(g)))).sort();
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [approveAllDialogOpen, setApproveAllDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Flatten all contacts from all imports
  const allContacts: GuestImportContact[] = imports.flatMap((imp) => imp.contacts || []);

  // Helper function to get validation status (must be defined before use)
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
    // Check if required fields are filled
    const expectedCount = editValues[`${contact.id}_expectedCount`] ?? 0;
    if (!expectedCount || expectedCount === 0) {
      return { status: 'warning', message: 'דורש בדיקה' };
    }
    return { status: 'ok', message: '' };
  };

  // Calculate statistics
  const totalContacts = allContacts.length;
  const approvedCount = 0; // Will be updated when we track approvals

  // Navigate back if all contacts are processed
  useEffect(() => {
    if (allContacts.length === 0 && !loading) {
      const timer = setTimeout(() => {
        navigate('/guests');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [allContacts.length, loading, navigate]);

  const handleEdit = (contactId: string, field: string, currentValue: any) => {
    setEditingContact(contactId);
    setEditingField(field);
    setEditValues({
      ...editValues,
      [`${contactId}_${field}`]: currentValue ?? '',
    });
  };

  const handleSaveEdit = (contactId: string, field: string) => {
    // In a real implementation, you might want to update the contact via API
    setEditingContact(null);
    setEditingField(null);
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

  const handleApproveAll = async () => {
    // Check if all contacts are ready
    const notReady = allContacts.filter((c) => {
      const validation = getValidationStatus(c);
      return validation.status !== 'ok';
    });

    if (notReady.length > 0) {
      setApproveAllDialogOpen(true);
      return;
    }

    // Approve all contacts
    setProcessing(new Set(allContacts.map(c => c.id)));
    try {
      for (const contact of allContacts) {
        await approveGuestImportContact(contact.id);
      }
      setSnackbar({ open: true, message: 'כל האורחים אושרו בהצלחה', severity: 'success' });
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'שגיאה באישור האורחים', severity: 'error' });
    } finally {
      setProcessing(new Set());
    }
  };

  const handleRejectAll = async () => {
    setProcessing(new Set(allContacts.map(c => c.id)));
    try {
      for (const contact of allContacts) {
        await rejectGuestImportContact(contact.id);
      }
      setSnackbar({ open: true, message: 'כל האורחים נדחו', severity: 'success' });
      setTimeout(() => {
        navigate('/guests');
      }, 1000);
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'שגיאה בדחיית האורחים', severity: 'error' });
    } finally {
      setProcessing(new Set());
    }
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

  // If all contacts are processed, show empty state
  if (allContacts.length === 0 && !loading) {
    return (
      <Box>
        <AppBar position="static" sx={{ backgroundColor: 'white', color: 'black', boxShadow: 'none' }}>
          <Toolbar>
            <IconButton edge="start" color="inherit" onClick={() => navigate('/guests')} sx={{ mr: 2 }}>
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600 }}>
              אישור אורחים מווטסאפ
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
    <Box sx={{ backgroundColor: '#F5F5F5', minHeight: '100vh' }}>
      <AppBar position="static" sx={{ backgroundColor: 'white', color: 'black', boxShadow: 'none' }}>
        <Toolbar>
          <IconButton edge="start" color="inherit" onClick={() => navigate('/guests')} sx={{ mr: 2 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600 }}>
            אישור אורחים מווטסאפ
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 2 }}>
        {/* Summary Card */}
        <Card
          sx={{
            mb: 2,
            borderRadius: 3,
            background: 'linear-gradient(180deg, #5236F7 0%, #6B4CE6 100%)',
            color: 'white',
            boxShadow: 'none',
          }}
        >
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, fontSize: '1.5rem' }}>
                {totalContacts} אורחים חדשים
              </Typography>
              <Box
                sx={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '50%',
                  width: 48,
                  height: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <WhatsAppIcon sx={{ fontSize: 28, color: 'white' }} />
              </Box>
            </Box>
            <Typography variant="body2" sx={{ mb: 2, opacity: 0.9 }}>
              נתקבלו מהבוט • דורש אישור
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(approvedCount / totalContacts) * 100}
              sx={{
                height: 4,
                borderRadius: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.3)',
                mb: 1,
                '& .MuiLinearProgress-bar': {
                  backgroundColor: 'white',
                },
              }}
            />
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {approvedCount} מתוך {totalContacts} אושרו
            </Typography>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <Stack direction="row">
          <Button
            variant="contained"
            fullWidth
            endIcon={<CheckCircleIcon />}
            onClick={handleApproveAll}
            disabled={processing.size > 0}
            sx={{
              borderRadius: 3,
              backgroundColor: '#5236F7',
              color: 'white',
              textTransform: 'none',
              py: 0.5,
              px: 1,
              mx: 1,
              mb: 1,
              gap: 1.5,
              flexDirection: 'row-reverse',
              '&:hover': {
                backgroundColor: '#4529D9',
              },
              '& .MuiButton-endIcon': {
                marginLeft: 0,
                marginRight: 0,
              },
            }}
          >
            אשר הכל
          </Button>
          <Button
            variant="outlined"
            fullWidth
            endIcon={<CancelIcon />}
            onClick={handleRejectAll}
            disabled={processing.size > 0}
            sx={{
              borderRadius: 3,
              borderColor: 'divider',
              color: 'text.primary',
              textTransform: 'none',
              py: 0.5,
              px: 1,
              mx: 1,
              mb: 1,
              gap: 1.5,
              flexDirection: 'row-reverse',
              '& .MuiButton-endIcon': {
                marginLeft: 0,
                marginRight: 0,
              },
            }}
          >
            דחה הכל
          </Button>
        </Stack>

        {/* Guest Cards */}
        <Stack spacing={2}>
          {allContacts.map((contact) => {
            const isProcessing = processing.has(contact.id);
            const validation = getValidationStatus(contact);
            const isEditingName = editingContact === contact.id && editingField === 'name';
            const isEditingPhone = editingContact === contact.id && editingField === 'phone';
            const isEditingGroup = editingContact === contact.id && editingField === 'group';
            const isEditingExpectedCount = editingContact === contact.id && editingField === 'expectedCount';
            const isEditingTableNumber = editingContact === contact.id && editingField === 'tableNumber';

            const expectedCount = editValues[`${contact.id}_expectedCount`] ?? 0;
            const group = editValues[`${contact.id}_group`] ?? '';
            const tableNumber = editValues[`${contact.id}_tableNumber`] ?? '';

            return (
              <Card
                key={contact.id}
                sx={{
                  borderRadius: 2,
                  backgroundColor: 'white',
                  boxShadow: 'none',
                  border: '1px solid',
                  borderColor: 'divider',
                  position: 'relative',
                }}
              >
                <CardContent sx={{ p: 2.5, position: 'relative' }}>
                  {/* Status Chip - Absolute positioned in top left */}
                  {validation.status !== 'ok' && (
                    <Chip
                      label={validation.status === 'warning' ? 'דורש בדיקה' : validation.message}
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        zIndex: 1,
                        backgroundColor: validation.status === 'warning' ? alpha('#ff9800', 0.1) : alpha('#f44336', 0.1),
                        color: validation.status === 'warning' ? '#ff9800' : '#f44336',
                        fontWeight: 500,
                        border: `1px solid ${validation.status === 'warning' ? '#ff9800' : '#f44336'}`,
                      }}
                    />
                  )}

                  {/* Name, Phone and Avatar */}
                  <Box
                    dir="rtl"
                    sx={{
                      display: 'flex',
                      flexDirection: 'row-reverse',
                      alignItems: 'flex-start',
                      gap: 2,
                      mb: 2,
                      pr: validation.status !== 'ok' ? 8 : 0,
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 48,
                        height: 48,
                        bgcolor: '#5236F7',
                        fontSize: '1.25rem',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {(contact.name || '?').charAt(0)}
                    </Avatar>

                    <Box sx={{ flex: 1, textAlign: 'right' }}>
                      {/* Name */}
                      {isEditingName ? (
                        <TextField
                          fullWidth
                          size="small"
                          value={editValues[`${contact.id}_name`] ?? contact.name ?? ''}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              [`${contact.id}_name`]: e.target.value,
                            })
                          }
                          onBlur={() => handleSaveEdit(contact.id, 'name')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(contact.id, 'name');
                            else if (e.key === 'Escape') {
                              setEditingContact(null);
                              setEditingField(null);
                            }
                          }}
                          autoFocus
                          sx={{ mb: 1 }}
                        />
                      ) : (
                        <Typography
                          variant="h6"
                          sx={{ fontWeight: 600, cursor: 'pointer', mb: 1 }}
                          onDoubleClick={() =>
                            handleEdit(contact.id, 'name', contact.name)
                          }
                        >
                          {contact.name || 'ללא שם'}
                        </Typography>
                      )}

                      {/* Phone */}
                      {isEditingPhone ? (
                        <TextField
                          fullWidth
                          size="small"
                          value={editValues[`${contact.id}_phone`] ?? contact.phone ?? ''}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              [`${contact.id}_phone`]: e.target.value,
                            })
                          }
                          onBlur={() => handleSaveEdit(contact.id, 'phone')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(contact.id, 'phone');
                            else if (e.key === 'Escape') {
                              setEditingContact(null);
                              setEditingField(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            flexDirection: 'row-reverse',
                          }}
                        >
                          <PhoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          <Typography
                            variant="body2"
                            sx={{ color: 'text.primary', cursor: 'pointer' }}
                            onDoubleClick={() =>
                              handleEdit(contact.id, 'phone', contact.phone)
                            }
                          >
                            {contact.phone || '-'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>


                  {/* Details Container - Light gray background */}
                  <Box
                    sx={{
                      backgroundColor: '#F8F9FA',
                      borderRadius: 2,
                      p: 2,
                      mb: 2,
                    }}
                  >
                    {/* Group */}
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, display: 'block', mb: 0.5 }}>
                        קבוצה
                      </Typography>
                      {isEditingGroup ? (
                        <Autocomplete
                          freeSolo
                          size="small"
                          options={uniqueGroups}
                          value={group}
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
                              fullWidth
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
                          sx={{ cursor: 'pointer', color: group ? 'text.primary' : 'text.secondary' }}
                          onDoubleClick={() => handleEdit(contact.id, 'group', group)}
                        >
                          {group || 'לא צוין'}
                        </Typography>
                      )}
                    </Box>

                    {/* Expected Count */}
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, display: 'block', mb: 0.5 }}>
                        מספר אורחים צפויים
                      </Typography>
                      {isEditingExpectedCount ? (
                        <TextField
                          fullWidth
                          size="small"
                          type="number"
                          value={expectedCount}
                          onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_expectedCount`]: parseInt(e.target.value) || 0 })}
                          onBlur={() => handleSaveEdit(contact.id, 'expectedCount')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveEdit(contact.id, 'expectedCount');
                            } else if (e.key === 'Escape') {
                              setEditingContact(null);
                              setEditingField(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{ cursor: 'pointer', color: expectedCount > 0 ? 'text.primary' : 'text.secondary' }}
                          onDoubleClick={() => handleEdit(contact.id, 'expectedCount', expectedCount)}
                        >
                          {expectedCount > 0 ? expectedCount : 'לא צוין'}
                        </Typography>
                      )}
                    </Box>

                    {/* Table Number */}
                    <Box>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, display: 'block', mb: 0.5 }}>
                        מספר שולחן
                      </Typography>
                      {isEditingTableNumber ? (
                        <TextField
                          fullWidth
                          size="small"
                          type="number"
                          value={tableNumber}
                          onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_tableNumber`]: parseInt(e.target.value) || undefined })}
                          onBlur={() => handleSaveEdit(contact.id, 'tableNumber')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveEdit(contact.id, 'tableNumber');
                            } else if (e.key === 'Escape') {
                              setEditingContact(null);
                              setEditingField(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{ cursor: 'pointer', color: tableNumber ? 'text.primary' : 'text.secondary' }}
                          onDoubleClick={() => handleEdit(contact.id, 'tableNumber', tableNumber)}
                        >
                          {tableNumber || 'לא צוין'}
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <IconButton size="small" sx={{ color: 'text.secondary' }}>
                      <MoreVertIcon />
                    </IconButton>
                    <Button
                      variant="contained"
                      endIcon={<CheckCircleIcon />}
                      onClick={() => handleApprove(contact.id)}
                      disabled={isProcessing}
                      sx={{
                        borderRadius: 2,
                        background: 'linear-gradient(90deg, #5236F7 0%, #6B4CE6 100%)',
                        color: 'white',
                        textTransform: 'none',
                        px: 3,
                        flexDirection: 'row-reverse',
                        '&:hover': {
                          background: 'linear-gradient(90deg, #4529D9 0%, #5A3FD4 100%)',
                        },
                        '& .MuiButton-endIcon': {
                          marginLeft: 0,
                          marginRight: 0,
                        },
                      }}
                    >
                      {isProcessing ? 'מעבד...' : 'אשר'}
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      </Box>

      {/* Approve All Warning Dialog */}
      <Dialog open={approveAllDialogOpen} onClose={() => setApproveAllDialogOpen(false)}>
        <DialogTitle>אין אפשרות לאשר הכל</DialogTitle>
        <DialogContent>
          <DialogContentText>
            לא ניתן לאשר את כל האורחים כי חלק מהם עדיין לא נערכו או נבדקו. יש חסרים נתונים כמו כמות אורחים צפויה ופרטים נוספים.
            <br /><br />
            אנא בדוק את כל האורחים עם התגית "דורש בדיקה" והשלם את המידע החסר לפני אישור.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveAllDialogOpen(false)} sx={{ color: '#5236F7' }}>
            הבנתי
          </Button>
        </DialogActions>
      </Dialog>

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
    </Box>
  );
}
