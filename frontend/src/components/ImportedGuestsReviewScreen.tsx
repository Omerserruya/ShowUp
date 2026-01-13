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
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
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
  Edit as EditIcon,
} from '@mui/icons-material';
import { Autocomplete } from '@mui/material';
import { useGuestImports, approveGuestImportContactWithData, rejectGuestImportContact, updateGuestImportContact, GuestImportContact } from '../hooks/useGuestImports';
import { useGuests } from '../hooks/useOverviewData';

/**
 * Mobile screen for reviewing and approving imported guests
 * One guest per card layout with summary card
 */
export function ImportedGuestsReviewScreen() {
  const navigate = useNavigate();
  const { imports, loading, error, refresh } = useGuestImports();
  const { guests } = useGuests();
  
  // Get unique groups from existing guests
  const uniqueGroups = Array.from(new Set(guests.map(guest => guest.group).filter((g): g is string => Boolean(g)))).sort();
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [removedContactIds, setRemovedContactIds] = useState<Set<string>>(new Set());
  const [approveAllDialogOpen, setApproveAllDialogOpen] = useState(false);
  const [fullEditMode, setFullEditMode] = useState<Set<string>>(new Set()); // Full edit mode for contacts
  const [menuAnchor, setMenuAnchor] = useState<{ contactId: string; anchor: HTMLElement } | null>(null);
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
    const expectedCount = editValues[`${contact.id}_expectedCount`] ?? 1;
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

  const handleSaveEdit = async (contactId: string, field: string) => {
    // Update via API for name, phone, email
    if (field === 'name' || field === 'phone' || field === 'email') {
      try {
        const updateData: { name?: string; phone?: string; email?: string } = {};
        if (field === 'name') updateData.name = editValues[`${contactId}_name`];
        if (field === 'phone') updateData.phone = editValues[`${contactId}_phone`];
        if (field === 'email') updateData.email = editValues[`${contactId}_email`];
        
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
        const approveData: { name?: string; group?: string; import_count?: number; table_number?: number } = {};
        
        // Get edited values for this contact
        const editedName = editValues[`${contact.id}_name`];
        if (editedName !== undefined && editedName !== contact.name) {
          approveData.name = editedName;
        }
        
        const editedGroup = editValues[`${contact.id}_group`];
        if (editedGroup) {
          approveData.group = editedGroup;
        }
        
        const editedExpectedCount = editValues[`${contact.id}_expectedCount`];
        // Default to 1 if not set
        approveData.import_count = editedExpectedCount !== undefined && editedExpectedCount > 0 ? editedExpectedCount : 1;
        
        const editedTableNumber = editValues[`${contact.id}_tableNumber`];
        if (editedTableNumber !== undefined && editedTableNumber > 0) {
          approveData.table_number = editedTableNumber;
        }
        
        await approveGuestImportContactWithData(contact.id, approveData);
      }
      // Remove all contacts from list immediately
      setRemovedContactIds((prev) => {
        const next = new Set(prev);
        allContacts.forEach((c) => next.add(c.id));
        return next;
      });
      setSnackbar({ open: true, message: 'כל האורחים אושרו בהצלחה', severity: 'success' });
      refresh();
      setTimeout(() => {
        navigate('/guests');
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
      // Remove all contacts from list immediately
      setRemovedContactIds((prev) => {
        const next = new Set(prev);
        allContacts.forEach((c) => next.add(c.id));
        return next;
      });
      setSnackbar({ open: true, message: 'כל האורחים נדחו', severity: 'success' });
      refresh();
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

      <Box sx={{ p: 1.5 }}>
        {/* Summary Card */}
        <Card
          sx={{
            mb: 1.5,
            borderRadius: 3,
            background: 'linear-gradient(180deg, #5236F7 0%, #6B4CE6 100%)',
            color: 'white',
            boxShadow: 'none',
          }}
        >
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, fontSize: '1.35rem' }}>
                {totalContacts} אורחים חדשים
              </Typography>
              <Box
                sx={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '50%',
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <WhatsAppIcon sx={{ fontSize: 24, color: 'white' }} />
              </Box>
            </Box>
            <Typography variant="body2" sx={{ mb: 1.5, opacity: 0.9, fontSize: '0.875rem' }}>
              נתקבלו מהבוט • דורש אישור
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(approvedCount / totalContacts) * 100}
              sx={{
                height: 4,
                borderRadius: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.3)',
                mb: 0.75,
                '& .MuiLinearProgress-bar': {
                  backgroundColor: 'white',
                },
              }}
            />
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.875rem' }}>
              {approvedCount} מתוך {totalContacts} אושרו
            </Typography>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Button
            variant="contained"
            fullWidth
            endIcon={<CheckCircleIcon />}
            onClick={handleApproveAll}
            disabled={processing.size > 0}
            size="small"
            sx={{
              borderRadius: 3,
              backgroundColor: '#5236F7',
              color: 'white',
              textTransform: 'none',
              py: 0.75,
              gap: 1,
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
            size="small"
            sx={{
              borderRadius: 3,
              borderColor: 'divider',
              color: 'text.primary',
              textTransform: 'none',
              py: 0.75,
              gap: 1,
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
        <Stack spacing={1.5}>
          {allContacts.map((contact) => {
            const isProcessing = processing.has(contact.id);
            const validation = getValidationStatus(contact);
            const isFullEditMode = fullEditMode.has(contact.id);
            const isEditingName = isFullEditMode || (editingContact === contact.id && editingField === 'name');
            const isEditingPhone = isFullEditMode || (editingContact === contact.id && editingField === 'phone');

            const expectedCount = editValues[`${contact.id}_expectedCount`] ?? 1;
            const group = editValues[`${contact.id}_group`] ?? '';
            const tableNumber = editValues[`${contact.id}_tableNumber`] ?? '';

            const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, contactId: string) => {
              setMenuAnchor({ contactId, anchor: event.currentTarget });
            };

            const handleMenuClose = () => {
              setMenuAnchor(null);
            };

            const handleEditAll = (contactId: string) => {
              setFullEditMode((prev) => new Set(prev).add(contactId));
              setEditValues({
                ...editValues,
                [`${contactId}_name`]: contact.name ?? '',
                [`${contactId}_phone`]: contact.phone ?? '',
                [`${contactId}_group`]: group,
                [`${contactId}_expectedCount`]: expectedCount,
                [`${contactId}_tableNumber`]: tableNumber,
              });
              handleMenuClose();
            };

            const handleSaveAll = async (contactId: string) => {
              // Save name, phone, email changes via API
              try {
                const updateData: { name?: string; phone?: string; email?: string } = {};
                const editedName = editValues[`${contactId}_name`];
                const editedPhone = editValues[`${contactId}_phone`];
                const editedEmail = editValues[`${contactId}_email`];
                
                if (editedName !== undefined && editedName !== contact.name) {
                  updateData.name = editedName;
                }
                if (editedPhone !== undefined && editedPhone !== contact.phone) {
                  updateData.phone = editedPhone;
                }
                if (editedEmail !== undefined && editedEmail !== contact.email) {
                  updateData.email = editedEmail;
                }
                
                if (Object.keys(updateData).length > 0) {
                  await updateGuestImportContact(contactId, updateData);
                }
              } catch (err: any) {
                setSnackbar({ open: true, message: err.message || 'שגיאה בשמירת השינויים', severity: 'error' });
                return; // Don't exit edit mode on error
              }
              
              // Exit full edit mode
              setFullEditMode((prev) => {
                const next = new Set(prev);
                next.delete(contactId);
                return next;
              });
            };

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
                <CardContent sx={{ p: 2, position: 'relative' }}>
                  {/* Status Chip - Absolute positioned in top left */}
                  {validation.status !== 'ok' && (
                    <Chip
                      label={validation.status === 'warning' ? 'דורש בדיקה' : validation.message}
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 1,
                        height: 24,
                        fontSize: '0.7rem',
                        backgroundColor: validation.status === 'warning' ? alpha('#ff9800', 0.1) : alpha('#f44336', 0.1),
                        color: validation.status === 'warning' ? '#ff9800' : '#f44336',
                        fontWeight: 500,
                        border: `1px solid ${validation.status === 'warning' ? '#ff9800' : '#f44336'}`,
                      }}
                    />
                  )}

                  {/* Name, Phone and Avatar */}
                  <Box
                    sx={{
                      mb: 1.5,
                      textAlign: 'right',
                      direction: 'rtl',
                    }}
                  >
                    <Box sx={{ textAlign: 'right' }}>
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
                          sx={{ mb: 0.5 }}
                        />
                      ) : (
                        <Typography
                          variant="h6"
                          sx={{ fontWeight: 600, cursor: 'pointer', mb: 0.5, textAlign: 'right', fontSize: '1.1rem' }}
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
                            direction: 'rtl',
                          }}
                        >
                          <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                          <Typography
                            variant="body2"
                            sx={{ color: 'text.primary', cursor: 'pointer', direction: 'rtl', textAlign: 'right', fontSize: '0.875rem' }}
                            onDoubleClick={() =>
                              handleEdit(contact.id, 'phone', contact.phone)
                            }
                          >
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
                        </Box>
                      )}
                    </Box>
                  </Box>


                  {/* Details Container - Light gray background */}
                  <Box
                    sx={{
                      backgroundColor: '#F8F9FA',
                      borderRadius: 2,
                      p: 1.5,
                      mb: 1.5,
                    }}
                  >
                    {/* Group - Always editable */}
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, display: 'block', mb: 0.5, fontSize: '0.75rem' }}>
                        קבוצה
                      </Typography>
                      <Autocomplete
                        freeSolo
                        size="small"
                        options={uniqueGroups}
                        value={group}
                        onChange={(event, newValue) => {
                          const value = typeof newValue === 'string' ? newValue : newValue || '';
                          setEditValues({ ...editValues, [`${contact.id}_group`]: value });
                        }}
                        onInputChange={(event, newInputValue) => {
                          setEditValues({ ...editValues, [`${contact.id}_group`]: newInputValue });
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            fullWidth
                          />
                        )}
                      />
                    </Box>

                    {/* Expected Count - Always editable */}
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, display: 'block', mb: 0.5, fontSize: '0.75rem' }}>
                        מספר אורחים צפויים
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        value={expectedCount}
                        onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_expectedCount`]: parseInt(e.target.value) || 1 })}
                      />
                    </Box>

                    {/* Table Number - Always editable */}
                    <Box>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, display: 'block', mb: 0.5, fontSize: '0.75rem' }}>
                        מספר שולחן
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        value={tableNumber}
                        onChange={(e) => setEditValues({ ...editValues, [`${contact.id}_tableNumber`]: parseInt(e.target.value) || undefined })}
                      />
                    </Box>
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                    <IconButton 
                      size="small" 
                      sx={{ color: 'text.secondary' }}
                      onClick={(e) => handleMenuOpen(e, contact.id)}
                    >
                      <MoreVertIcon />
                    </IconButton>
                    <Button
                      variant="contained"
                      endIcon={<CheckCircleIcon />}
                      onClick={async () => {
                        if (isFullEditMode) {
                          await handleSaveAll(contact.id);
                        }
                        handleApprove(contact.id);
                      }}
                      disabled={isProcessing}
                      size="small"
                      sx={{
                        borderRadius: 2,
                        background: 'linear-gradient(90deg, #5236F7 0%, #6B4CE6 100%)',
                        color: 'white',
                        textTransform: 'none',
                        px: 2.5,
                        py: 0.75,
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
                      {isProcessing ? 'מעבד...' : isFullEditMode ? 'שמור ואשר' : 'אשר'}
                    </Button>
                  </Box>

                  {/* Menu for three dots */}
                  <Menu
                    anchorEl={menuAnchor?.contactId === contact.id ? menuAnchor.anchor : null}
                    open={menuAnchor?.contactId === contact.id}
                    onClose={handleMenuClose}
                    anchorOrigin={{
                      vertical: 'bottom',
                      horizontal: 'left',
                    }}
                    transformOrigin={{
                      vertical: 'top',
                      horizontal: 'left',
                    }}
                  >
                    <MenuItem
                      onClick={() => handleEditAll(contact.id)}
                    >
                      <ListItemIcon>
                        <EditIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText>עריכה</ListItemText>
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        handleReject(contact.id);
                        handleMenuClose();
                      }}
                      sx={{ color: 'error.main' }}
                    >
                      <ListItemIcon>
                        <CancelIcon fontSize="small" sx={{ color: 'error.main' }} />
                      </ListItemIcon>
                      <ListItemText>מחיקה</ListItemText>
                    </MenuItem>
                  </Menu>
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
