import React, { createContext, useContext, useState, useEffect } from 'react';

export interface Account {
  _id: string;
  name: string;
}

interface AccountContextType {
  account: Account | null;
  setAccount: (account: Account | null) => void;
  refreshAccountDetails: () => Promise<void>;
  loading: boolean;
  clearAccount: () => void;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const saveAccountToStorage = (accountData: Account | null) => {
    if (accountData) {
      localStorage.setItem('account_id', accountData._id);
    } else {
      localStorage.removeItem('account_id');
    }
  };

  const refreshAccountDetails = async () => {
    const accountId = localStorage.getItem('account_id');
    if (accountId) {
      try {
        const response = await fetch(`/api/accounts/${accountId}`, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          cache: 'no-cache',
        });

        if (!response.ok) {
          throw new Error('Failed to fetch account details');
        }

        // Check if the response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Invalid response format - expected JSON');
        }

        const accountData = await response.json();
        setAccount(accountData);
        return accountData;
      } catch (error) {
        console.error('Error refreshing account details:', error);
        localStorage.removeItem('account_id');
        setAccount(null);
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  };

  // Custom setter function that also saves to storage
  const setAccountWithStorage = (accountData: Account | null) => {
    setAccount(accountData);
    saveAccountToStorage(accountData);
  };

  // Function to clear account data
  const clearAccount = () => {
    setAccount(null);
    localStorage.removeItem('account_id');
  };

  // Fetch account details when the component mounts
  useEffect(() => {
    refreshAccountDetails();
  }, []);

  return (
    <AccountContext.Provider value={{ 
      account, 
      setAccount: setAccountWithStorage, 
      refreshAccountDetails,
      loading,
      clearAccount
    }}>
      {children}
    </AccountContext.Provider>
  );
};

export const useAccount = () => {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}; 