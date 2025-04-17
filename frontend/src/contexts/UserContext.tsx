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

  const refreshUserDetails = async () => {
    const userId = localStorage.getItem('user_id');
    if (userId) {
      try {
        const response = await fetch(`/api/users/${userId}`, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          cache: 'no-cache',
        });

        if (!response.ok) {
          throw new Error('Failed to fetch user details');
        }

        const userData = await response.json();
        setUser(userData);
        return userData;
      } catch (error) {
        console.error('Error refreshing user details:', error);
        localStorage.removeItem('user_id');
        setUser(null);
      } finally {
        setLoading(false);
      }
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