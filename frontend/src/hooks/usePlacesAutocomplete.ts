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

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
}

interface UsePlacesAutocompleteOptions {
  onPlaceSelected?: (location: LocationData) => void;
  language?: string;
  region?: string;
}

declare global {
  interface Window {
    google: {
      maps: {
        importLibrary: (library: string) => Promise<any>;
        places: {
          // New Places API (Places API New)
          AutocompleteSessionToken: new () => any;
          AutocompleteSuggestion: {
            fetchAutocompleteSuggestions: (request: any) => Promise<{ suggestions: any[] }>;
          };
        };
      };
    };
  }
}

export function usePlacesAutocomplete({
  onPlaceSelected,
  language = 'he',
  region = 'il',
}: UsePlacesAutocompleteOptions = {}) {
  const [inputValue, setInputValue] = useState('');
  const [location, setLocation] = useState<LocationData | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionTokenRef = useRef<any>(null);
  // Raw predictions kept around so we can resolve a selection back to a Place.
  const predictionsRef = useRef<Map<string, any>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPlaceSelectedRef = useRef(onPlaceSelected);

  // Keep the callback ref updated
  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected;
  }, [onPlaceSelected]);

  // Load Google Maps (Places library) once
  useEffect(() => {
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsLoaded(true);
      return;
    }

    loadGooglePlacesScript(() => {
      setIsLoaded(true);
    }).catch((error) => {
      console.error('Failed to load Google Places API:', error);
    });
  }, []);

  // A session token groups autocomplete keystrokes + the final place fetch
  // into a single billable session. We mint a fresh one after each selection.
  const ensureSessionToken = useCallback(() => {
    if (!sessionTokenRef.current && window.google?.maps?.places?.AutocompleteSessionToken) {
      sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
    }
  }, []);

  const fetchSuggestions = useCallback(
    async (input: string) => {
      if (!isLoaded || !input.trim()) {
        setSuggestions([]);
        predictionsRef.current.clear();
        return;
      }

      try {
        ensureSessionToken();
        const { AutocompleteSuggestion } = window.google.maps.places;
        const { suggestions: results } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: sessionTokenRef.current,
          language,
          region,
          includedRegionCodes: [region],
        });

        predictionsRef.current.clear();
        const mapped: PlaceSuggestion[] = [];
        for (const result of results) {
          const prediction = result.placePrediction;
          if (!prediction) continue;
          predictionsRef.current.set(prediction.placeId, prediction);
          mapped.push({
            placeId: prediction.placeId,
            primaryText: prediction.mainText?.text ?? prediction.text?.text ?? '',
            secondaryText: prediction.secondaryText?.text ?? '',
          });
        }
        setSuggestions(mapped);
      } catch (error) {
        console.error('Error fetching place suggestions:', error);
        setSuggestions([]);
      }
    },
    [isLoaded, language, region, ensureSessionToken]
  );

  // Resolve a chosen suggestion to full place details
  const selectSuggestion = useCallback(async (placeId: string) => {
    const prediction = predictionsRef.current.get(placeId);
    if (!prediction) return;

    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });

      const lat = typeof place.location?.lat === 'function' ? place.location.lat() : place.location?.lat;
      const lng = typeof place.location?.lng === 'function' ? place.location.lng() : place.location?.lng;

      const locationData: LocationData = {
        name: place.displayName || place.formattedAddress || '',
        address: place.formattedAddress || '',
        coordinates: { lat, lng },
      };

      setLocation(locationData);
      setInputValue(locationData.address);
      setSuggestions([]);
      predictionsRef.current.clear();
      // The session ends once a place is fetched; start a new one next time.
      sessionTokenRef.current = null;

      if (onPlaceSelectedRef.current) {
        onPlaceSelectedRef.current(locationData);
      }
    } catch (error) {
      console.error('Error fetching place details:', error);
    }
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (!value) {
        setLocation(null);
        setSuggestions([]);
        predictionsRef.current.clear();
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(value), 250);
    },
    [fetchSuggestions]
  );

  // Cleanup pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    inputRef,
    inputValue,
    location,
    suggestions,
    selectSuggestion,
    setInputValue: handleInputChange,
    isLoaded,
  };
}
