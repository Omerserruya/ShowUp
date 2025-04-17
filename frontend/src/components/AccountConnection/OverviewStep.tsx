import React from 'react';
import { Box, Typography, Paper, Grid, Chip, CircularProgress } from '@mui/material';
import { AWSConnectionFormData } from '../../types/awsConnection';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

interface OverviewStepProps {
  formData: AWSConnectionFormData;
  isValidating: boolean;
  isValid?: boolean;
  validationOnly?: boolean;
}

export default function OverviewStep({ formData, isValidating, isValid, validationOnly = false }: OverviewStepProps) {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        {validationOnly ? 'Credential Validation' : 'Connection Overview'}
      </Typography>

      {validationOnly ? (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Validating AWS Credentials
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                We are validating your AWS credentials to ensure they have the necessary permissions to access your AWS account.
              </Typography>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Connection Status
                </Typography>
                {isValidating ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={20} />
                    <Typography variant="body2">Validating credentials...</Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isValid ? (
                      <>
                        <CheckCircleIcon color="success" />
                        <Typography variant="body2" color="success.main">
                          Credentials validated successfully
                        </Typography>
                      </>
                    ) : isValid === false ? (
                      <>
                        <ErrorIcon color="error" />
                        <Typography variant="body2" color="error">
                          Credential validation failed
                        </Typography>
                      </>
                    ) : null}
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      ) : (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Connection Details
              </Typography>
              <Typography variant="body2">
                <strong>Name:</strong> {formData.step1.name}
              </Typography>
              <Typography variant="body2">
                <strong>Provider:</strong> {formData.step1.provider}
              </Typography>
              <Typography variant="body2">
                <strong>Region:</strong> {formData.step1.region}
              </Typography>
              {formData.step1.description && (
                <Typography variant="body2">
                  <strong>Description:</strong> {formData.step1.description}
                </Typography>
              )}
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Credentials
              </Typography>
              <Typography variant="body2">
                <strong>Access Key ID:</strong> {formData.step2.accessKeyId}
              </Typography>
              <Typography variant="body2">
                <strong>Secret Access Key:</strong> ••••••••••••••••
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Selected Accounts
              </Typography>
              {formData.step3.accounts.length > 0 ? (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {formData.step3.accounts.map((accountId) => (
                    <Chip key={accountId} label={accountId} />
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No accounts selected
                </Typography>
              )}
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Connection Status
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isValid ? (
                  <>
                    <CheckCircleIcon color="success" />
                    <Typography variant="body2" color="success.main">
                      Connection is ready to be created
                    </Typography>
                  </>
                ) : (
                  <>
                    <ErrorIcon color="error" />
                    <Typography variant="body2" color="error">
                      Connection validation failed
                    </Typography>
                  </>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
} 