import React from 'react';
import { Box, TextField, FormControl, InputLabel, Select, MenuItem, Typography, SelectChangeEvent } from '@mui/material';
import { AWSConnectionFormData } from '../../types/awsConnection';

interface AboutStepProps {
  formData: AWSConnectionFormData['step1'];
  onChange: (data: AWSConnectionFormData['step1']) => void;
}

const regions = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-southeast-1', 'ap-southeast-2',
  'ap-northeast-1', 'ap-northeast-2'
];

export default function AboutStep({ formData, onChange }: AboutStepProps) {
  const handleTextChange = (field: keyof AWSConnectionFormData['step1']) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    onChange({
      ...formData,
      [field]: event.target.value
    });
  };

  const handleSelectChange = (event: SelectChangeEvent) => {
    onChange({
      ...formData,
      region: event.target.value
    });
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        About Your AWS Connection
      </Typography>
      
      <TextField
        fullWidth
        label="Connection Name"
        value={formData.name}
        onChange={handleTextChange('name')}
        margin="normal"
        required
      />

      <FormControl fullWidth margin="normal">
        <InputLabel>Region</InputLabel>
        <Select
          value={formData.region}
          onChange={handleSelectChange}
          label="Region"
        >
          {regions.map((region) => (
            <MenuItem key={region} value={region}>
              {region}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        fullWidth
        label="Description (Optional)"
        value={formData.description || ''}
        onChange={handleTextChange('description')}
        margin="normal"
        multiline
        rows={3}
      />
    </Box>
  );
} 