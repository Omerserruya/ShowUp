import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useEvent } from './EventContext';

interface BannerContextType {
  isBannerVisible: boolean;
}

const BannerContext = createContext<BannerContextType | undefined>(undefined);

export function BannerProvider({ children }: { children: ReactNode }) {
  const { selectedEvent } = useEvent();
  const [isDismissed, setIsDismissed] = useState(false);

  // Check if event is inactive
  // Note: active can be false, true, undefined, or null
  // We check explicitly for false, null, or undefined
  const isEventInactive = selectedEvent && (
    selectedEvent.active === false || 
    selectedEvent.active === null || 
    selectedEvent.active === undefined
  );

  // Load dismissed state from localStorage when selectedEvent changes (including on mount/refresh)
  useEffect(() => {
    // Wait for selectedEvent to be fully loaded (with all properties)
    // Check if selectedEvent has an id (meaning it's loaded from API)
    if (selectedEvent && selectedEvent.id) {
      const dismissedKey = `event_inactive_dismissed_${selectedEvent.id}`;
      const dismissed = localStorage.getItem(dismissedKey) === 'true';
      setIsDismissed(dismissed);

      // If event is inactive but was dismissed, show banner again after refresh
      // This allows the banner to reappear on each page refresh if event is still inactive
      if ((selectedEvent.active === false || selectedEvent.active === null || selectedEvent.active === undefined) && dismissed) {
        localStorage.removeItem(dismissedKey);
        setIsDismissed(false);
      }
    } else {
      setIsDismissed(false);
    }
  }, [selectedEvent?.id, selectedEvent?.active]);

  // Listen for storage changes (when banner is dismissed)
  useEffect(() => {
    const handleStorageChange = () => {
      if (selectedEvent && selectedEvent.id) {
        const dismissedKey = `event_inactive_dismissed_${selectedEvent.id}`;
        const dismissed = localStorage.getItem(dismissedKey) === 'true';
        setIsDismissed(dismissed);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    // Also listen to custom event for same-tab updates
    window.addEventListener('banner-dismissed', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('banner-dismissed', handleStorageChange);
    };
  }, [selectedEvent?.id]);

  // Reset dismissed state when event becomes active again
  useEffect(() => {
    if (selectedEvent && selectedEvent.active === true) {
      const dismissedKey = `event_inactive_dismissed_${selectedEvent.id}`;
      localStorage.removeItem(dismissedKey);
      setIsDismissed(false);
    }
  }, [selectedEvent]);

  const isBannerVisible = Boolean(isEventInactive && !isDismissed);

  return (
    <BannerContext.Provider value={{ isBannerVisible }}>
      {children}
    </BannerContext.Provider>
  );
}

export const useBanner = () => {
  const context = useContext(BannerContext);
  if (!context) {
    return { isBannerVisible: false };
  }
  return context;
};

