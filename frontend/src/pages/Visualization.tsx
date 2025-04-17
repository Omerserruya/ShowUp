import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, Alert, IconButton, Tooltip } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import AWSArchitectureVisualizer, { AWSArchitecture } from '../components/aws-architecture-visualizer';
import axios from 'axios';
import { useAccount } from '../contexts/AccountContext';

function Visualization() {
  const [data, setData] = useState<AWSArchitecture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { account } = useAccount();

  const fetchData = async () => {
    if (!account?._id) {
      setError('No AWS connection selected');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log('Fetching data for connectionId:', account._id);
      const url = `/api/db/neo/cloud-query-results/${account._id}`;
      console.log('Request URL:', url);
      
      const response = await axios.get(url, {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      console.log('Response received:', response.data);
      setData(response.data);
    } catch (err) {
      console.error('Detailed error:', err);
      setError('Failed to fetch infrastructure data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [account?._id]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert 
          severity="error" 
          action={
            <Tooltip title="Refresh data">
              <IconButton color="inherit" size="small" onClick={fetchData}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert 
          severity="info" 
          action={
            <Tooltip title="Refresh data">
              <IconButton color="inherit" size="small" onClick={fetchData}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          }
        >
          No data available
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, height: '100%', width: '100%', position: 'relative' }}>
      <Tooltip title="Refresh data">
        <IconButton 
          onClick={fetchData}
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 1000,
            bgcolor: 'background.paper',
            '&:hover': {
              bgcolor: 'action.hover',
            },
          }}
        >
          <RefreshIcon />
        </IconButton>
      </Tooltip>
      <AWSArchitectureVisualizer data={data} />
    </Box>
  );
}

export default Visualization; 