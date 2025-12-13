import { useEffect, useRef, useState, useCallback } from 'react';
import { loadGooglePlacesScript } from '../config/googlePlaces';

interface LocationData {
  name: string;
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

interface UsePlacesAutocompleteOptions {
  onPlaceSelected?: (location: LocationData) => void;
  language?: string;
}

declare global {
  interface Window {
    google: {
      maps: {
        places: {
          PlaceAutocompleteElement: {
            prototype: HTMLElement & {
              componentRestrictions?: { country: string };
              language?: string;
              addEventListener: (type: 'gmp-placeselect', listener: (e: CustomEvent) => void) => void;
              removeEventListener: (type: 'gmp-placeselect', listener: (e: CustomEvent) => void) => void;
            };
          };
          Autocomplete: new (input: HTMLInputElement, options: any) => {
            getPlace: () => any;
            addListener: (event: string, callback: () => void) => void;
          };
        };
        event: {
          clearInstanceListeners: (instance: any) => void;
        };
      };
    };
  }
}

export function usePlacesAutocomplete({
  onPlaceSelected,
  language = 'he',
}: UsePlacesAutocompleteOptions = {}) {
  const [inputValue, setInputValue] = useState('');
  const [location, setLocation] = useState<LocationData | null>(null);
  const autocompleteRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const onPlaceSelectedRef = useRef(onPlaceSelected);

  // Keep the callback ref updated
  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected;
  }, [onPlaceSelected]);

  // Load Google Places API script
  useEffect(() => {
    const checkGoogleMaps = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setIsLoaded(true);
        return true;
      }
      return false;
    };

    if (checkGoogleMaps()) {
      setIsLoaded(true);
      return;
    }

    // Load script dynamically using the new API loader
    loadGooglePlacesScript(() => {
      setIsLoaded(true);
    }).catch((error) => {
      console.error('Failed to load Google Places API:', error);
    });
  }, []);

  // Initialize Autocomplete when Google Maps is loaded
  // Using legacy Autocomplete for now (will work for existing customers)
  // For new customers, we should migrate to PlaceAutocompleteElement
  useEffect(() => {
    if (!isLoaded || !inputRef.current) return;

    // Clean up previous instance if it exists
    if (autocompleteRef.current) {
      try {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      } catch (e) {
        // Ignore cleanup errors
      }
      autocompleteRef.current = null;
    }

    try {
      // Try to use the new PlaceAutocompleteElement if available
      if (customElements.get('gmp-place-autocomplete')) {
        // PlaceAutocompleteElement is available - but we need to use it differently
        // For now, fall back to legacy Autocomplete
        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'il' },
          fields: ['name', 'formatted_address', 'geometry', 'place_id'],
          language: language,
        });

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          
          if (place.geometry && place.geometry.location) {
            const locationData: LocationData = {
              name: place.name || place.formatted_address || '',
              address: place.formatted_address || '',
              coordinates: {
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
              },
            };

            setLocation(locationData);
            setInputValue(locationData.address);
            
            if (onPlaceSelectedRef.current) {
              onPlaceSelectedRef.current(locationData);
            }
          }
        });

        autocompleteRef.current = autocomplete;
      } else {
        // Use legacy Autocomplete (will show warning but should still work)
        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'il' },
          fields: ['name', 'formatted_address', 'geometry', 'place_id'],
          language: language,
        });

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          
          if (place.geometry && place.geometry.location) {
            const locationData: LocationData = {
              name: place.name || place.formatted_address || '',
              address: place.formatted_address || '',
              coordinates: {
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
              },
            };

            setLocation(locationData);
            setInputValue(locationData.address);
            
            if (onPlaceSelectedRef.current) {
              onPlaceSelectedRef.current(locationData);
            }
          }
        });

        autocompleteRef.current = autocomplete;
      }
    } catch (error) {
      console.error('Error initializing Places Autocomplete:', error);
    }

    return () => {
      if (autocompleteRef.current) {
        try {
          window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
        } catch (e) {
          // Ignore cleanup errors
        }
        autocompleteRef.current = null;
      }
    };
  }, [isLoaded, language]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (!value) {
      setLocation(null);
    }
  }, []);

  return {
    inputRef,
    inputValue,
    location,
    setInputValue: handleInputChange,
    isLoaded,
  };
}

