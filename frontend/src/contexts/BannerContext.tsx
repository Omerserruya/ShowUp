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
      // Debug log
      console.log('BannerContext: selectedEvent loaded', {
        eventId: selectedEvent.id,
        active: selectedEvent.active,
        activeType: typeof selectedEvent.active,
        activeValue: selectedEvent.active,
        activeIsFalse: selectedEvent.active === false,
        activeIsNull: selectedEvent.active === null,
        activeIsUndefined: selectedEvent.active === undefined,
        isEventInactive: selectedEvent.active === false || selectedEvent.active === null || selectedEvent.active === undefined,
        dismissed,
        dismissedKey,
        localStorageValue: localStorage.getItem(dismissedKey),
        willShow: (selectedEvent.active === false || selectedEvent.active === null || selectedEvent.active === undefined) && !dismissed
      });
      
      // If event is inactive but was dismissed, show banner again after refresh
      // This allows the banner to reappear on each page refresh if event is still inactive
      if ((selectedEvent.active === false || selectedEvent.active === null || selectedEvent.active === undefined) && dismissed) {
        console.log('BannerContext: Event is inactive but was dismissed. Clearing dismissal to show banner again.');
        localStorage.removeItem(dismissedKey);
        setIsDismissed(false);
      }
    } else {
      setIsDismissed(false);
      if (selectedEvent) {
        console.log('BannerContext: selectedEvent not fully loaded yet', {
          eventId: selectedEvent.id,
          active: selectedEvent.active,
          activeDefined: selectedEvent.active !== undefined
        });
      } else {
        console.log('BannerContext: no selectedEvent');
      }
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
  
  // Debug log
  useEffect(() => {
    console.log('BannerContext: visibility check', {
      selectedEvent: selectedEvent ? { 
        id: selectedEvent.id, 
        active: selectedEvent.active,
        activeType: typeof selectedEvent.active,
        activeValue: selectedEvent.active
      } : null,
      isEventInactive,
      isDismissed,
      isBannerVisible,
      calculation: {
        hasSelectedEvent: !!selectedEvent,
        activeIsFalse: selectedEvent?.active === false,
        activeIsNull: selectedEvent?.active === null,
        activeIsUndefined: selectedEvent?.active === undefined,
        finalCheck: selectedEvent && (selectedEvent.active === false || selectedEvent.active === null || selectedEvent.active === undefined) && !isDismissed
      }
    });
  }, [selectedEvent, isEventInactive, isDismissed, isBannerVisible]);

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

