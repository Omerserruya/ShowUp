import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  _id: string;
  username: string;
  email: string;
  role?: string;
  createdAt?: Date;
  updatedAt?: Date;
  avatarUrl?: string;
}

interface UserContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  refreshUserDetails: () => Promise<void>;
  loading: boolean;
  clearUser: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const saveUserToStorage = (userData: User | null) => {
    if (userData) {
      localStorage.setItem('user_id', userData._id);
    } else {
      localStorage.removeItem('user_id');
    }
  };

  // Helper function to decode JWT token and extract user_id
  const decodeToken = (token: string): { user_id?: string; sub?: string; exp?: number; iat?: number } | null => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  };

  // Helper function to check if token is expired
  const isTokenExpired = (token: string): boolean => {
    const decoded = decodeToken(token);
    if (!decoded || !decoded.exp) return true;
    return Date.now() >= decoded.exp * 1000;
  };

  const refreshUserDetails = async () => {
    // Check for JWT token first (from login/register)
    const token = localStorage.getItem('access_token') || localStorage.getItem('token');
    
    if (token) {
      // Check if token is expired
      if (isTokenExpired(token)) {
        // Token expired, clear it
        localStorage.removeItem('access_token');
        localStorage.removeItem('token');
        localStorage.removeItem('user_id');
        setUser(null);
        setLoading(false);
        return;
      }

      // Decode token to get user_id
      const decoded = decodeToken(token);
      if (decoded && decoded.user_id) {
        // Create a minimal user object from token
        // We don't have full user details, but we know the user is authenticated
        setUser({
          _id: decoded.user_id,
          username: decoded.sub || 'משתמש', // Use phone number as username
          email: '',
          role: 'user',
        });
        // Also save user_id for legacy support
        localStorage.setItem('user_id', decoded.user_id);
        setLoading(false);
        return;
      }
    }

    // Fallback to user_id if no token (legacy support)
    const userId = localStorage.getItem('user_id');
    if (userId) {
      // If we have user_id but no token, user might be logged out
      // Clear it to be safe
      localStorage.removeItem('user_id');
      setUser(null);
      setLoading(false);
    } else {
      setLoading(false);
    }
  };

  // Custom setter function that also saves to storage
  const setUserWithStorage = (userData: User | null) => {
    setUser(userData);
    saveUserToStorage(userData);
  };

  // Function to clear user data
  const clearUser = () => {
    setUser(null);
    localStorage.removeItem('user_id');
    localStorage.removeItem('access_token');
    localStorage.removeItem('token');
  };

  // Fetch user details when the component mounts
  useEffect(() => {
    refreshUserDetails();
  }, []);

  return (
    <UserContext.Provider value={{ 
      user, 
      setUser: setUserWithStorage, 
      refreshUserDetails,
      loading,
      clearUser
    }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}; 