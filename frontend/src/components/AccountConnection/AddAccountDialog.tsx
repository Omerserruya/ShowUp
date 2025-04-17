import React from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AWSConnectionForm from './AWSConnectionForm';
import { AWSConnection } from '../../types/awsConnection';

interface AddAccountDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (connection: AWSConnection) => void;
}

export default function AddAccountDialog({ open, onClose, onSubmit }: AddAccountDialogProps) {
  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        Add AWS Account
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <AWSConnectionForm
          onSubmit={onSubmit}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
} 