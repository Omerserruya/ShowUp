import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/fetchWithAuth';

export interface User {
  _id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string; // expected E.164 like +9725...
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
        // Try to fetch user details from backend
        try {
          const response = await fetchWithAuth(`/api/auth/me`, {
            method: 'GET',
          });

          if (response.ok) {
            const userData = await response.json();
            // Save user details to localStorage for future use
            if (userData.first_name) {
              localStorage.setItem('user_first_name', userData.first_name);
            }
            if (userData.last_name) {
              localStorage.setItem('user_last_name', userData.last_name);
            }
            if (userData.email) {
              localStorage.setItem('user_email', userData.email);
            }
            if (userData.phone) {
              localStorage.setItem('user_phone', userData.phone);
            }
            
            // Map backend user data to frontend User interface
            // Prefer full_name/name/username from backend, fallback to combining first_name + last_name
            // IMPORTANT: Don't use decoded.sub (phone number) as fallback - prefer empty name over phone
            let fullName = userData.full_name || userData.name || userData.username;
            
            // If no full_name/name/username, try to combine first_name + last_name
            if (!fullName && userData.first_name && userData.last_name) {
              fullName = `${userData.first_name} ${userData.last_name}`.trim();
            }
            
            // If still no name, use a default (but NOT phone number)
            if (!fullName || fullName.trim() === '') {
              fullName = 'משתמש';
            }
            
            setUser({
              _id: userData.id || userData._id || decoded.user_id,
              username: fullName,
              email: userData.email || '',
              firstName: userData.first_name || undefined,
              lastName: userData.last_name || undefined,
              phone: userData.phone || undefined,
              role: 'user',
              createdAt: userData.created_at || userData.createdAt,
              updatedAt: userData.updated_at || userData.updatedAt,
            });
            localStorage.setItem('user_id', decoded.user_id);
            setLoading(false);
            return;
          }
        } catch (error) {
          // If endpoint doesn't exist or fails, fall back to localStorage
          console.warn('Error fetching user details, using localStorage:', error);
        }

        // Fallback: Try to get user details from localStorage
        const savedFirstName = localStorage.getItem('user_first_name');
        const savedLastName = localStorage.getItem('user_last_name');
        const savedEmail = localStorage.getItem('user_email');
        const savedPhone = localStorage.getItem('user_phone');
        
        // Create user object from saved data
        // IMPORTANT: Don't use decoded.sub (phone number) as fallback - prefer empty name over phone
        let username = '';
        if (savedFirstName && savedLastName) {
          username = `${savedFirstName} ${savedLastName}`.trim();
        }
        
        // If still no name, use a default (but NOT phone number)
        if (!username || username.trim() === '') {
          username = 'משתמש';
        }
        
        setUser({
          _id: decoded.user_id,
          username: username,
          email: savedEmail || '',
          firstName: savedFirstName || undefined,
          lastName: savedLastName || undefined,
          phone: savedPhone || undefined,
          role: 'user',
        });
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
    localStorage.removeItem('user_first_name');
    localStorage.removeItem('user_last_name');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_phone');
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