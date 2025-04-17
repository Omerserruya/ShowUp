import React from 'react';
import { Box, TextField, Typography, IconButton, InputAdornment } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { AWSConnectionFormData } from '../../types/awsConnection';

interface CredentialsStepProps {
  formData: AWSConnectionFormData['step2'];
  onChange: (data: AWSConnectionFormData['step2']) => void;
}

export default function CredentialsStep({ formData, onChange }: CredentialsStepProps) {
  const [showSecret, setShowSecret] = React.useState(false);

  const handleChange = (field: keyof AWSConnectionFormData['step2']) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    onChange({
      ...formData,
      [field]: event.target.value
    });
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        AWS Credentials
      </Typography>
      
      <TextField
        fullWidth
        label="Access Key ID"
        value={formData.accessKeyId}
        onChange={handleChange('accessKeyId')}
        margin="normal"
        required
        helperText="Enter your AWS Access Key ID"
      />

      <TextField
        fullWidth
        label="Secret Access Key"
        value={formData.secretAccessKey}
        onChange={handleChange('secretAccessKey')}
        margin="normal"
        required
        type={showSecret ? 'text' : 'password'}
        helperText="Enter your AWS Secret Access Key"
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setShowSecret(!showSecret)}
                edge="end"
              >
                {showSecret ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );
} 