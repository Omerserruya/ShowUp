import React, { useState } from 'react';
import { Box, Typography, Paper, Stack, Button } from '@mui/material';
import CodeSnippet from '../components/CodeSnippet';
import ResourceSelector from '../components/ResourceSelector';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import JSZip from 'jszip';
import axios from 'axios';
import {providerTfContent, tfvarsContent, variablesTfContent} from '../consts/iacFiles'
import { useUser } from '../contexts/UserContext';
import { useAccount } from '../contexts/AccountContext'
import {resourcesType} from '../components/ResourceSelector'


interface ResourceConfigs {
  [key: string]: string;
}

interface ApiResponse {
  data: {
    amis: string;
    instances: string;
    subnets: string;
    vpcs: string;
  };
}

function IAC() {
  const [selectedResource, setSelectedResource] = useState('');
  const [resourceKeys, setResourcesKeys] = useState<resourcesType[]>([])
  const [resourceConfigs, setResourceConfigs] = useState<ResourceConfigs>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useUser();
  const { account } = useAccount();


  const generateConfigs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await axios.get<ApiResponse>('http://localhost/api/iac/generate_tf', {
        params: {
          user_id: user?._id,
          account_id: account?._id
        },
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        withCredentials: true
      });
      const res = response.data as ApiResponse
      
      const filteredData = {
        data: Object.fromEntries(
          Object.entries(res.data).filter(([_, value]) => value !== "")
        )
      };
      const resourceKeys = Object.keys(filteredData.data) as resourcesType[];
      setSelectedResource(resourceKeys[0])
      setResourcesKeys(resourceKeys);
      setResourceConfigs(filteredData.data);
    } catch (error) {
      console.error('Error fetching resource configs:', error);
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        setError(error.response.data.message);
      } else {
        setError('Something went wrong while generating the configurations. Please try again later.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResourceChange = (resource: string) => {
    setSelectedResource(resource);
  };

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    
    Object.entries(resourceConfigs).forEach(([key, value]) => {
      zip.file(`${key}.tf`, value.trim());
    });
    
    zip.file('provider.tf', providerTfContent);
    zip.file('variables.tf', variablesTfContent);
    zip.file('terraform.tfvars', tfvarsContent);
    zip.file('README.txt', 'This ZIP contains Terraform configuration files for various AWS resources.');

    try {
      const content = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'terraform-configs.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating zip file:', error);
    }
  };

  const hasData = Object.keys(resourceConfigs).length > 0;

  return (
    <Box sx={{ padding: 3 }}>
      <Typography variant="h4" gutterBottom>
        Infrastructure as Code
      </Typography>
      
      <Paper 
        elevation={3} 
        sx={{ 
          padding: 3,
          backgroundColor: 'background.paper'
        }}
      >
        <Stack spacing={1}>
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            width: '100%'
          }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="h6" sx={{ flexShrink: 0 }}>
                TF Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {hasData 
                  ? 'You can copy the entire configuration using the copy button in the top-right corner.'
                  : 'Click the Generate button to create your Terraform configurations.'}
              </Typography>
            </Box>
            <Stack spacing={1} alignItems="flex-end" sx={{ flexShrink: 0 }}>
              {hasData ? (
                <>
                  <ResourceSelector onResourceChange={handleResourceChange} resourcesView={resourceKeys} />
                  <Button
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    onClick={handleDownloadAll}
                    size="small"
                    sx={{ width: '215px' }}
                  >
                    Download All as ZIP
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  onClick={generateConfigs}
                  size="small"
                  sx={{ width: '215px' }}
                  disabled={isLoading}
                >
                  {isLoading ? 'Generating...' : 'Generate Configs'}
                </Button>
              )}
            </Stack>
          </Box>
          
          <Box sx={{ mt: 1 }}>
            {isLoading ? (
              <Typography>Generating your configurations...</Typography>
            ) : hasData ? (
              <CodeSnippet 
                code={resourceConfigs[selectedResource] || ''}
                filename={`${selectedResource}.tf`}
              />
            ) : (
              <Box sx={{ 
                p: 4, 
                textAlign: 'center',
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1
              }}>
                <Typography color={error ? 'error' : 'text.secondary'}>
                  {error || 'No configurations generated yet. Click the Generate button above to create your Terraform configurations.'}
                </Typography>
              </Box>
            )}
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}

export default IAC; 