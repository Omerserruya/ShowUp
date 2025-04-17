import * as React from 'react';
import MuiAvatar from '@mui/material/Avatar';
import MuiListItemAvatar from '@mui/material/ListItemAvatar';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import CloudIcon from '@mui/icons-material/Cloud';
import ListSubheader from '@mui/material/ListSubheader';
import Select, { SelectChangeEvent, selectClasses } from '@mui/material/Select';
import Divider from '@mui/material/Divider';
import { styled } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { AddAccountDialog } from '../AccountConnection';
import { AWSConnection } from '../../types/awsConnection';
import api from '../../utils/api';
import { useAccount } from '../../contexts/AccountContext';
import { fetchAwsConnections as fetchAwsConnectionsApi, createAwsConnection } from '../../api/awsConnectionApi';

const Avatar = styled(MuiAvatar)(({ theme }) => ({
  width: 28,
  height: 28,
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.secondary,
  border: `1px solid ${theme.palette.divider}`,
}));

const ListItemAvatar = styled(MuiListItemAvatar)({
  minWidth: 0,
  marginRight: 12,
});

export default function SelectContent() {
  const { account, setAccount } = useAccount();
  const [selectedAccount, setSelectedAccount] = React.useState<string>(account?._id || '');
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [listAccounts, setListAccounts] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  // Fetch AWS connections on component mount
  React.useEffect(() => {
    fetchAwsConnections();
  }, []);

  // Update selected account when account context changes
  React.useEffect(() => {
    if (account?._id) {
      setSelectedAccount(account._id);
    }
  }, [account]);

  const fetchAwsConnections = async () => {
    setIsLoading(true);
    try {
      // Use the fetchAwsConnections API function
      const data = await fetchAwsConnectionsApi();
      
      // Process the data based on its structure
      if (Array.isArray(data)) {
        const formattedConnections = data.map((conn: any) => ({
          id: conn._id,
          name: conn.name,
          provider: conn.provider,
          region: conn.credentials.region,
          isValid: conn.isValidated
        }));
        setListAccounts(formattedConnections);
      } else if (data && typeof data === 'object') {
        // Check if data has a property that contains the array
        const connections = data.connections || data.results || data.items || data.data || [];
        
        if (Array.isArray(connections)) {
          const formattedConnections = connections.map((conn: any) => ({
            id: conn._id,
            name: conn.name,
            provider: conn.provider,
            region: conn.credentials.region,
            isValid: conn.isValidated
          }));
          setListAccounts(formattedConnections);
        } else {
          console.error('Response data format is not recognized:', data);
          setListAccounts([]);
        }
      } else {
        console.error('Unexpected response format:', data);
        setListAccounts([]);
      }
    } catch (error) {
      console.error('Error fetching AWS connections:', error);
      // Start with empty list on error
      setListAccounts([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value;
    if (value === 'new') {
      setIsAddDialogOpen(true);
    } else {
      setSelectedAccount(value);
      
      // Find the selected account object and update the AccountContext
      const selectedAccountObj = listAccounts.find(acc => acc.id === value);
      if (selectedAccountObj) {
        setAccount({
          _id: selectedAccountObj.id,
          name: selectedAccountObj.name
        });
      }
    }
  };

  const handleAddAccount = async (connection: AWSConnection) => {
    try {
      const data = await createAwsConnection(connection);
      
      // Refresh the full list of connections
      await fetchAwsConnections();
      
      // Set the newly created account as the selected account
      if (data && data._id) {
        setSelectedAccount(data._id);
        setAccount({
          _id: data._id,
          name: data.name
        });
      }
      
      setIsAddDialogOpen(false);
    } catch (error) {
      console.error('Error creating connection:', error);
      // Here you would typically show an error notification
    }
  };

  return (
    <>
      <Box 
        display="flex" 
        justifyContent="center" 
        width="100%" 
        px={2}
      >
        <Select
          labelId="account-select"
          id="account-simple-select"
          value={selectedAccount}
          onChange={handleChange}
          displayEmpty
          renderValue={(selected) => {
            if (!selected) {
              return <Box sx={{ color: 'text.secondary' }}>Select Account</Box>;
            }
            const account = listAccounts.find(acc => acc.id === selected);
            return account ? account.name : 'Select Account';
          }}
          sx={{
            maxHeight: 56,
            width: 215,
            margin: '0 auto',
            '& .MuiList-root': {
              p: '8px',
            },
            [`& .${selectClasses.select}`]: {
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              pl: 1,
            },
          }}
        >
          <ListSubheader sx={{ pt: 0 }}>Accounts</ListSubheader>
          {isLoading ? (
            <MenuItem disabled>
              <Box display="flex" alignItems="center" justifyContent="center" width="100%" py={1}>
                <CircularProgress size={24} />
              </Box>
            </MenuItem>
          ) : listAccounts.length > 0 ? (
            listAccounts.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                <ListItemAvatar>
                  <Avatar alt={item.name}>
                    <CloudIcon color={item.isValid ? "primary" : "disabled"} sx={{ fontSize: '1rem' }} />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText 
                  primary={item.name} 
                  secondary={`${item.provider.toUpperCase()} - ${item.region}`} 
                />
              </MenuItem>
            ))
          ) : (
            <MenuItem disabled>
              <ListItemText primary="No accounts found" />
            </MenuItem>
          )}

          <Divider sx={{ mx: -1 }} />
          <MenuItem value="new">
            <ListItemIcon>
              <AddRoundedIcon />
            </ListItemIcon>
            <ListItemText primary="Add Account" secondary="Create New" />
          </MenuItem>
        </Select>
      </Box>

      <AddAccountDialog
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSubmit={handleAddAccount}
      />
    </>
  );
}
