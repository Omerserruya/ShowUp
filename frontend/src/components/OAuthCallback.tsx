import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { CircularProgress, Box, Typography } from '@mui/material';

const OAuthCallback = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useUser();
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return; 
    processedRef.current = true;

    console.log('OAuth callback received', location.search);

    const params = new URLSearchParams(location.search);
    
    const errorParam = params.get('error');
    if (errorParam) {
      // For all errors, immediately redirect to login with error param
      console.log('OAuth error:', errorParam);
      navigate(`/login?error=${errorParam}`);
      return;
    }

    const userId = params.get('userId');
    const username = params.get('username');
    const email = params.get('email');
    const role = params.get('role');
    const createdAt = params.get('createdAt');

    console.log('OAuth params:', { userId, username, email, role });

    if (userId && username && email) {
      const userObj = {
        _id: userId,
        username: decodeURIComponent(username),
        email,
        role: role || 'user',
        createdAt: createdAt ? new Date(createdAt) : new Date(),
        updatedAt: new Date(),
      };

      console.log('Setting user from OAuth:', userObj);
      setUser(userObj);
      
      // Use a slight delay to ensure the user is set in context before navigation
      setTimeout(() => {
        navigate('/home');
      }, 500);
    } else {
      console.error('Missing required user data in OAuth callback');
      navigate('/login?error=auth_failed');
    }
  }, [location.search, navigate, setUser]); 

  return (
    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100vh">
      <CircularProgress />
      <Typography variant="h6" mt={2}>
        Completing login...
      </Typography>
    </Box>
  );
};

export default OAuthCallback;
