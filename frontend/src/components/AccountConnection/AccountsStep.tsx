import React, { useEffect, useState } from 'react';
import { Box, Typography, FormGroup, FormControlLabel, Checkbox, Paper, CircularProgress } from '@mui/material';
import { AWSConnectionFormData } from '../../types/awsConnection';

interface AccountsStepProps {
  formData: AWSConnectionFormData['step3'];
  onChange: (data: AWSConnectionFormData['step3']) => void;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
}

interface AWSAccount {
  id: string;
  name: string;
}

export default function AccountsStep({ formData, onChange, credentials }: AccountsStepProps) {
  const [accounts, setAccounts] = useState<AWSAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchAccounts = async () => {
      setIsLoading(true);
      try {
        // Temporary mock function to simulate fetching AWS accounts
        // This will be replaced with actual CloudQuery implementation later
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // For now, return empty list for new users as requested
        setAccounts([]);
        
        // Once CloudQuery is implemented, this is where the actual accounts will be fetched
      } catch (error) {
        console.error('Error fetching accounts:', error);
        setAccounts([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAccounts();
  }, [credentials]);

  const handleAccountChange = (accountId: string) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const newAccounts = event.target.checked
      ? [...formData.accounts, accountId]
      : formData.accounts.filter(id => id !== accountId);
    
    onChange({
      accounts: newAccounts
    });
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Select AWS Accounts
      </Typography>
      
      <Typography variant="body2" color="text.secondary" paragraph>
        Choose the AWS accounts you want to connect. This step is optional.
      </Typography>

      <Paper sx={{ p: 2, mt: 2 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : accounts.length > 0 ? (
          <FormGroup>
            {accounts.map((account) => (
              <FormControlLabel
                key={account.id}
                control={
                  <Checkbox
                    checked={formData.accounts.includes(account.id)}
                    onChange={handleAccountChange(account.id)}
                  />
                }
                label={account.name}
              />
            ))}
          </FormGroup>
        ) : (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
            No AWS accounts found with provided credentials.
          </Typography>
        )}
      </Paper>
    </Box>
  );
} 