import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Card,
  CardContent,
  Chip,
  Tooltip
} from '@mui/material';
import { Edit as EditIcon, PhotoCamera, Delete as DeleteIcon, Add as AddIcon, Lock as LockIcon } from '@mui/icons-material';
import { useUser } from '../contexts/UserContext';
import UserAvatar from '../components/UserAvatar';
import Toast from '../components/Toast';
import api from '../utils/api';

interface User {
  _id: string;
  username: string;
  email: string;
  role?: string;
  createdAt?: string;
  avatarUrl?: string;
  authProvider?: 'google' | 'github' | 'local';
}

interface FormErrors {
  username?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export default function Profile() {
  const { user: contextUser, refreshUserDetails } = useUser();
  const user = contextUser as User;
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Edit profile state
  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  
  // Photo upload dialog
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState<'error' | 'warning' | 'info' | 'success'>('error');

  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<FormErrors>({});
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  useEffect(() => {
    if (user?._id) {
      setUsername(user.username || '');
      setEmail(user.email || '');
    }
  }, [user?._id]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    
    if (!username.trim()) {
      newErrors.username = 'Username is required';
    }
    
    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user?._id) return;
    
    if (!validateForm()) {
      return;
    }
    
    try {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(false);
      
      await api.put(`/users/${user._id}`, { username, email });
      await refreshUserDetails();
      setSaveSuccess(true);
      setIsEditing(false);
      
      // Reset success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } catch (error) {
      console.error('Failed to update user:', error);
      setSaveError('Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoDialogOpen = () => {
    setPhotoDialogOpen(true);
  };

  const handlePhotoDialogClose = () => {
    setPhotoDialogOpen(false);
    setSelectedFile(null);
    setPhotoPreview(null);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      
      if (file.size > 5000000) {
        setToastMessage('Image too large! Maximum size is 5MB.');
        setToastSeverity('error');
        setToastOpen(true);
        event.target.value = '';
        return;
      }
      
      setSelectedFile(file);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setPhotoPreview(e.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadPhoto = async () => {
    if (!selectedFile || !user?._id) return;

    const formData = new FormData();
    formData.append('avatar', selectedFile);

    try {
      await api.post(`/users/${user._id}/avatar`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      await refreshUserDetails();
      handlePhotoDialogClose();
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      
      if (error.response && error.response.status === 413) {
        setToastMessage('Image file size is too large for upload. Maximum size allowed is 5MB.');
      } else {
        setToastMessage('Failed to upload image. Please try again.');
      }
      setToastSeverity('error');
      setToastOpen(true);
    }
  };

  const handleToastClose = () => {
    setToastOpen(false);
  };

  if (!user) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', mx: 'auto', px: 2 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Profile Details
      </Typography>
      
      {/* Alerts Section */}
      <Box sx={{ mb: 4 }}>
        {saveSuccess && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Profile updated successfully!
          </Alert>
        )}
        
        {saveError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {saveError}
          </Alert>
        )}
      </Box>
      
      {/* Profile Information Section */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h5" component="h2" fontWeight="500" gutterBottom>
          Profile Information
        </Typography>
        <Divider sx={{ mb: 3 }} />
        
        <form onSubmit={handleSubmit}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Box position="relative">
                  <UserAvatar
                    username={user.username}
                    avatarUrl={user.avatarUrl}
                    size={80}
                    showUsername={false}
                    userFromProps={true}
                  />
                  <IconButton
                    size="small"
        sx={{ 
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      backgroundColor: 'background.paper'
                    }}
                    onClick={handlePhotoDialogOpen}
                  >
                    <PhotoCamera fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Username"
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={!!errors.username}
                helperText={errors.username}
                disabled={!isEditing}
                required
              />
            </Grid>
            
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={!!errors.email}
                helperText={errors.email}
                disabled={!isEditing}
                required
              />
            </Grid>
            
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Role"
                value={user.role || 'User'}
                disabled
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Member Since"
                value={new Date(user.createdAt || '').toLocaleDateString()}
                disabled
              />
            </Grid>

            {user.authProvider === 'local' && (
              <Grid item xs={12}>
                <Button
                  variant="outlined"
                  startIcon={<LockIcon />}
                  onClick={() => setResetPasswordDialogOpen(true)}
                >
                  Reset Password
                </Button>
              </Grid>
            )}
          </Grid>
          
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 4 }}>
            {isEditing ? (
              <>
                <Button 
                  variant="outlined" 
                  onClick={() => {
                    setIsEditing(false);
                    setUsername(user.username);
                    setEmail(user.email);
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="contained" 
                  disabled={saving}
                  startIcon={saving ? <CircularProgress size={20} /> : null}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            ) : (
              <Button 
                variant="contained" 
                startIcon={<EditIcon />}
                onClick={() => setIsEditing(true)}
              >
                Edit Profile
              </Button>
            )}
          </Box>
        </form>
      </Box>

      {/* Photo Upload Dialog */}
      <Dialog open={photoDialogOpen} onClose={handlePhotoDialogClose}>
        <DialogTitle>Change Profile Photo</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', my: 2 }}>
            {photoPreview ? (
              <Avatar 
                src={photoPreview} 
                sx={{ width: 150, height: 150, mb: 2 }}
              />
            ) : (
              <UserAvatar
                username={user.username}
                avatarUrl={user.avatarUrl}
                size={150}
                showUsername={false}
                userFromProps={true}
              />
            )}
            
            <Button
              variant="contained"
              component="label"
              startIcon={<PhotoCamera />}
      >
              Select Photo
              <input
                type="file"
                hidden
                accept="image/*"
                onChange={handleFileSelect}
              />
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handlePhotoDialogClose}>Cancel</Button>
          <Button 
            onClick={handleUploadPhoto} 
            variant="contained" 
            disabled={!selectedFile}
          >
            Upload
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog 
        open={resetPasswordDialogOpen} 
        onClose={() => {
          setResetPasswordDialogOpen(false);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setPasswordErrors({});
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reset Password</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Current Password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  error={!!passwordErrors.currentPassword}
                  helperText={passwordErrors.currentPassword}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="New Password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  error={!!passwordErrors.newPassword}
                  helperText={passwordErrors.newPassword}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Confirm New Password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={!!passwordErrors.confirmPassword}
                  helperText={passwordErrors.confirmPassword}
                  required
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setResetPasswordDialogOpen(false);
              setCurrentPassword('');
              setNewPassword('');
              setConfirmPassword('');
              setPasswordErrors({});
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              const errors: FormErrors = {};
              
              if (!currentPassword) {
                errors.currentPassword = 'Current password is required';
              }
              
              if (!newPassword) {
                errors.newPassword = 'New password is required';
              } else if (newPassword.length < 8) {
                errors.newPassword = 'Password must be at least 8 characters long';
              }
              
              if (!confirmPassword) {
                errors.confirmPassword = 'Please confirm your new password';
              } else if (newPassword !== confirmPassword) {
                errors.confirmPassword = 'Passwords do not match';
              }
              
              setPasswordErrors(errors);
              
              if (Object.keys(errors).length === 0) {
                setIsResettingPassword(true);
                try {
                  await api.post('/users/reset-password', {
                    currentPassword,
                    newPassword
                  });
                  
                  setToastMessage('Password updated successfully');
                  setToastSeverity('success');
                  setToastOpen(true);
                  
                  setResetPasswordDialogOpen(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordErrors({});
                } catch (error: any) {
                  if (error.response?.status === 401) {
                    setPasswordErrors({
                      currentPassword: 'Current password is incorrect'
                    });
                  } else {
                    setToastMessage('Failed to update password. Please try again.');
                    setToastSeverity('error');
                    setToastOpen(true);
                  }
                } finally {
                  setIsResettingPassword(false);
                }
              }
            }}
            disabled={isResettingPassword}
          >
            {isResettingPassword ? (
              <>
                <CircularProgress size={20} sx={{ mr: 1 }} />
                Updating...
              </>
            ) : (
              'Update Password'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Toast notification */}
      <Toast
        open={toastOpen}
        message={toastMessage}
        severity={toastSeverity}
        onClose={handleToastClose}
      />
    </Box>
  );
}